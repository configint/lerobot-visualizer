import {
  DatasetMetadata,
  fetchJson,
  fetchParquetFile,
  formatStringWithVars,
  readParquetColumn,
} from "@/utils/parquetUtils";
import { pick } from "@/utils/pick";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DATASET_URL =
  process.env.DATASET_URL || "https://huggingface.co/datasets";

const SERIES_NAME_DELIMITER = " | ";

export async function getEpisodeData(
  org: string,
  dataset: string,
  episodeId: number,
) {
  const repoId = `${org}/${dataset}`.replace(/~/g, "/");
  const [bucket, ...prefixParts] = repoId.split("/");
  const keyPrefix = prefixParts.join("/").replace(/\/$/, "");
  const s3Client = new S3Client({ region: "us-east-2" });

  const getSignedS3Url = async (key: string) => {
    const command = new GetObjectCommand({ Bucket: bucket, Key: `${keyPrefix}/${key}` });
    return getSignedUrl(s3Client, command, { expiresIn: 3600 });
  };

  try {
    const episode_chunk = Math.floor(0 / 1000);
    const jsonUrl = await getSignedS3Url("meta/info.json");

    const info = await fetchJson<DatasetMetadata>(jsonUrl);

    // Dataset information
    const datasetInfo = {
      repoId,
      total_frames: info.total_frames,
      total_episodes: info.total_episodes,
      fps: info.fps,
    };

    // Generate list of episodes
    const episodes = Array.from(
      { length: datasetInfo.total_episodes },
      // episode id starts from 1
      (_, i) => i + 1,
    );

    // Videos information
    const videosInfo = Object.entries(info.features)
      .filter(([key, value]) => value.dtype === "video")
      .map(async ([key, _]) => {
        const videoPath = formatStringWithVars(info.video_path, {
          video_key: key,
          episode_chunk: episode_chunk.toString().padStart(3, "0"),
          episode_index: episodeId.toString().padStart(6, "0"),
        });
        return {
          filename: key,
          url: await getSignedS3Url(videoPath),
        };
      });
    // videosInfo is now array of promises, resolve them
    const resolvedVideosInfo = await Promise.all(videosInfo);

    // Column data
    const columnNames = Object.entries(info.features)
      .filter(
        ([key, value]) =>
          ["float32", "int32"].includes(value.dtype) &&
          value.shape.length === 1,
      )
      .map(([key, { shape }]) => ({ key, length: shape[0] }));

    // Exclude specific columns
    const excludedColumns = [
      "timestamp",
      "frame_index",
      "episode_index",
      "index",
      "task_index",
    ];
    const filteredColumns = columnNames.filter(
      (column) => !excludedColumns.includes(column.key),
    );
    const filteredColumnNames = [
      "timestamp",
      ...filteredColumns.map((column) => column.key),
    ];

    const columns = filteredColumns.map(({ key }) => {
      let column_names = info.features[key].names;
      while (typeof column_names === "object") {
        if (Array.isArray(column_names)) break;
        column_names = Object.values(column_names ?? {})[0];
      }
      return {
        key,
        value: Array.isArray(column_names)
          ? column_names.map((name) => `${key}${SERIES_NAME_DELIMITER}${name}`)
          : Array.from(
              { length: columnNames.find((c) => c.key === key)?.length ?? 1 },
              (_, i) => `${key}${SERIES_NAME_DELIMITER}${i}`,
            ),
      };
    });

    const parquetKey = formatStringWithVars(info.data_path, {
      episode_chunk: episode_chunk.toString().padStart(3, "0"),
      episode_index: episodeId.toString().padStart(6, "0"),
    });

    const parquetUrl = await getSignedS3Url(parquetKey);

    const arrayBuffer = await fetchParquetFile(parquetUrl);
    const data = await readParquetColumn(arrayBuffer, filteredColumnNames);
    // Flatten and map to array of objects for chartData
    const seriesNames = [
      "timestamp",
      ...columns.map(({ value }) => value).flat(),
    ];

    const chartData = data.map((row) => {
      const flatRow = row.flat();
      const obj: Record<string, number> = {};
      seriesNames.forEach((key, idx) => {
        obj[key] = flatRow[idx];
      });
      return obj;
    });

    // List of columns that are ignored (e.g., 2D or 3D data)
    const ignoredColumns = Object.entries(info.features)
      .filter(
        ([key, value]) =>
          ["float32", "int32"].includes(value.dtype) && value.shape.length > 1,
      )
      .map(([key]) => key);

    // --- Consolidate all data into a single chart ---
    const duration = chartData[chartData.length - 1].timestamp;
    const chartDataGroups = [chartData];

    return {
      datasetInfo,
      episodeId: episodeId + 1,
      videosInfo: resolvedVideosInfo,
      chartDataGroups,
      episodes,
      ignoredColumns,
      duration,
    };
  } catch (err) {
    console.error("Error loading episode data:", err);
    throw err;
  }
}

// Safe wrapper for UI error display
export async function getEpisodeDataSafe(
  org: string,
  dataset: string,
  episodeId: number,
): Promise<{ data?: any; error?: string }> {
  try {
    const data = await getEpisodeData(org, dataset, episodeId);
    return { data };
  } catch (err: any) {
    // Only expose the error message, not stack or sensitive info
    return { error: err?.message || String(err) || "Unknown error" };
  }
}

function groupIdenticalSeriesNames(seriesNames: string[]): string[] {
  const seenSuffixes = new Set<string>();
  const suffixMap = new Map<string, string[]>();

  // Build a map from suffix to all items with that suffix (preserve order)
  for (const name of seriesNames) {
    const parts = name.split(SERIES_NAME_DELIMITER);
    const suffix = parts[1] || "";
    if (!suffixMap.has(suffix)) {
      suffixMap.set(suffix, []);
    }
    suffixMap.get(suffix)!.push(name);
  }

  const result: string[] = [];
  for (const name of seriesNames) {
    const parts = name.split(SERIES_NAME_DELIMITER);
    const suffix = parts[1] || "";
    if (!seenSuffixes.has(suffix)) {
      // Insert all items with this suffix
      result.push(...suffixMap.get(suffix)!);
      seenSuffixes.add(suffix);
    }
    // else: already inserted as part of a group, skip
  }
  return result;
}
