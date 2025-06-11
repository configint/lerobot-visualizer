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
  const repoId = `${org}/${dataset}`;
  const bucket = "configint";
  const keyPrefix = `data-builder/${org}/data/${dataset}`.replace(/\/$/, "");
  const s3Client = new S3Client({ region: "us-east-2" });

  const getSignedS3Url = async (key: string) => {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: `${keyPrefix}/${key}`,
    });
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

    // Fetch episode metadata to build labels and tasks
    const episodesLabels: Record<number, string> = {};
    const episodesTasks: Record<number, string[]> = {};
    try {
      const episodesUrl = await getSignedS3Url("meta/episodes.jsonl");
      const text = await (await fetch(episodesUrl)).text();
      const episodesData = text
        .split("\n")
        .filter((line) => line.trim().length)
        .map((line) => JSON.parse(line));
      for (const ep of episodesData) {
        const epNum = Number(ep.episode_index) + 1;
        const labelPath = Array.isArray(ep.input_key)
          ? ep.input_key[1].split("/").slice(-5).join("/")
          : "";
        episodesLabels[epNum] = `${epNum}: ${labelPath}`;
        episodesTasks[epNum] = Array.isArray(ep.tasks) ? ep.tasks : [];
      }
    } catch (err) {
      console.warn("Failed to fetch episodes.jsonl", err);
    }

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

    // --- Group columns by their base names ---
    // Each top-level feature becomes a chart. If a feature has multiple
    // sub-values (e.g. an array), all of those series are shown on the same
    // chart.
    const chartGroups = columns
      .map(({ value }) =>
        value.length > 6
          ? value.reduce<string[][]>((acc, name, idx) => {
              const groupIdx = Math.floor(idx / 6);
              if (!acc[groupIdx]) acc[groupIdx] = [];
              acc[groupIdx].push(name);
              return acc;
            }, [])
          : [value],
      )
      .flat();

    const duration = chartData[chartData.length - 1].timestamp;

    const chartDataGroups = chartGroups.map((group) =>
      chartData.map((row) => pick(row, [...group, "timestamp"])),
    );

    return {
      datasetInfo,
      episodeId: episodeId + 1,
      videosInfo: resolvedVideosInfo,
      chartDataGroups,
      episodes,
      episodeLabels: episodesLabels,
      tasks: episodesTasks[episodeId + 1] ?? [],
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
