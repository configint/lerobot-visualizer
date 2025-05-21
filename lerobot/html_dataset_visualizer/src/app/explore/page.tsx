import React from "react";
import ExploreGrid from "./explore-grid";
import {
  DatasetMetadata,
  fetchJson,
  formatStringWithVars,
} from "@/utils/parquetUtils";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Server component for data fetching
export default async function ExplorePage({
  searchParams,
}: {
  searchParams: { p?: string };
}) {
  let datasets: any[] = [];
  let currentPage = 1;
  let totalPages = 1;
  try {
    // --- Fetch dataset list from DynamoDB ---
    const ddbClient = new DynamoDBClient({ region: "us-east-2" });
    const docClient = DynamoDBDocumentClient.from(ddbClient);

    const scanRes = await docClient.send(
      new ScanCommand({
        TableName: process.env.DYNAMO_TABLE_NAME || "lerobot-visualizer",
        ProjectionExpression: "s3_dir",
      }),
    );

    const allDatasets: string[] =
      (scanRes.Items || []).map(
        (item: { s3_dir: string }) => item.s3_dir,
      );

    // Use searchParams from props
    const page = parseInt(searchParams?.p || "1", 10);
    const perPage = 30;

    currentPage = page;
    totalPages = Math.ceil(allDatasets.length / perPage);

    const startIdx = (currentPage - 1) * perPage;
    const endIdx = startIdx + perPage;
    datasets = allDatasets.slice(startIdx, endIdx);
  } catch (e) {
    console.error(e);
    return <div className="p-8 text-red-600">Failed to load datasets.</div>;
  }

  // Fetch episode 0 data for each dataset
  const s3Client = new S3Client({ region: "us-east-2" });
  const datasetWithVideos = (
    await Promise.all(
      datasets.map(async (s3Dir: string) => {
        try {
          // Parse S3 URI (e.g. s3://my-bucket/path/to/dataset)
          const match = s3Dir.match(/^s3:\/\/([^/]+)\/(.+)$/);
          if (!match) throw new Error(`Invalid S3 URI: ${s3Dir}`);
          const bucket = match[1];
          const keyPrefix = match[2].replace(/\/$/, ""); // trim trailing slash

          // repoId is the last folder name of the prefix
          const repoId = keyPrefix.split("/").pop()!;

          // ------- meta/info.json -------
          const infoKey = `${keyPrefix}/meta/info.json`;
          const infoUrl = await getSignedUrl(
            s3Client,
            new GetObjectCommand({ Bucket: bucket, Key: infoKey }),
            { expiresIn: 3600 },
          );
          const info = await fetchJson<DatasetMetadata>(infoUrl);

          // Find first video‑type feature
          const videoEntry = Object.entries(info.features).find(
            ([, v]) => v.dtype === "video",
          );

          let videoUrl: string | null = null;
          if (videoEntry) {
            const [videoKeyPlaceholder] = videoEntry;

            // Re‑create video relative path (episode 0, chunk 0)
            const videoPath = formatStringWithVars(info.video_path, {
              video_key: videoKeyPlaceholder,
              episode_chunk: "0".padStart(3, "0"),
              episode_index: "0".padStart(6, "0"),
            });
            const videoKey = `${keyPrefix}/${videoPath}`;

            try {
              // Check object exists
              await s3Client.send(
                new HeadObjectCommand({ Bucket: bucket, Key: videoKey }),
              );

              // Sign and keep URL
              videoUrl = await getSignedUrl(
                s3Client,
                new GetObjectCommand({ Bucket: bucket, Key: videoKey }),
                { expiresIn: 3600 },
              );
            } catch {
              /* object missing – leave videoUrl null */
            }
          }

          return videoUrl ? { id: repoId, videoUrl } : null;
        } catch (err) {
          console.error(`Failed to fetch or parse dataset info for ${s3Dir}:`, err);
          return null;
        }
      }),
    )
  ).filter(Boolean) as { id: string; videoUrl: string | null }[];

  return (
    <ExploreGrid
      datasets={datasetWithVideos}
      currentPage={currentPage}
      totalPages={totalPages}
    />
  );
}
