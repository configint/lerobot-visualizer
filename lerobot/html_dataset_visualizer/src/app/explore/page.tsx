import React from "react";
import ExploreGrid from "./explore-grid";
import {
  DatasetMetadata,
  fetchJson,
  formatStringWithVars,
} from "@/utils/parquetUtils";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@/utils/cloudfront";

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
    // --- Fetch dataset list from DynamoDB (both data-builder and lerobot-visualizer) ---
    const ddbClient = new DynamoDBClient({ region: "us-west-2" });
    const docClient = DynamoDBDocumentClient.from(ddbClient);

    const scanBuilder = await docClient.send(
      new ScanCommand({
        TableName: "data-builder",
        ProjectionExpression: "version, data_name",
      }),
    );

    const builderDatasets = (scanBuilder.Items || []).map(
      (item: { version: string; data_name: string }) => ({
        id: `${item.version}/${item.data_name}`,
        s3_dir: `configint-main/data-builder/${item.version}/data/${item.data_name}/`,
      }),
    );

    const scanVisualizer = await docClient.send(
      new ScanCommand({
        TableName: "lerobot-visualizer",
        ProjectionExpression: "s3_dir",
      }),
    );

    const visualizerDatasets = (scanVisualizer.Items || [])
      .map((item: { s3_dir: string }) => {
        const match = item.s3_dir.match(
          /^configint-main\/data-builder\/(.+)\/data\/(.+)\/$/,
        );
        if (!match) return null;
        return {
          id: `${match[1]}/${match[2]}`,
          s3_dir: item.s3_dir,
        };
      })
      .filter(Boolean) as { id: string; s3_dir: string }[];
    const allDatasets = [...builderDatasets, ...visualizerDatasets];

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
  const s3Client = new S3Client({ region: "us-west-2" });
  const datasetWithVideos = (
    await Promise.all(
      datasets.map(async (ds: { id: string; s3_dir: string }) => {
        try {
          const { id, s3_dir } = ds;
          // Parse S3 URI (e.g. s3://my-bucket/path/to/dataset)
          const [bucket, ...keyParts] = s3_dir.split("/");
          const keyPrefix = keyParts.join("/").replace(/\/$/, "");

          // ------- meta/info.json -------
          const infoKey = `${keyPrefix}/meta/info.json`;
          const infoUrl = await getSignedUrl(bucket, infoKey);
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
              videoUrl = await getSignedUrl(bucket, videoKey);
            } catch {
              /* object missing – leave videoUrl null */
            }
          }

          return videoUrl ? { id, videoUrl } : null;
        } catch (err) {
          console.error(
            `Failed to fetch or parse dataset info for ${ds.s3_dir}:`,
            err,
          );
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
