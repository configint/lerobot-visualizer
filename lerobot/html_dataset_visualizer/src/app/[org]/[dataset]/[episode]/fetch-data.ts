import {
  DatasetMetadata,
  fetchJson,
  fetchParquetFile,
  formatStringWithVars,
  readParquetColumn,
} from "@/utils/parquetUtils";
import { pick } from "@/utils/pick";
import { getSignedUrl } from "@/utils/cloudfront";
import { SubtaskSegment } from "@/types/subtask";

const DATASET_URL =
  process.env.DATASET_URL || "https://huggingface.co/datasets";

const SERIES_NAME_DELIMITER = " | ";

export async function getEpisodeData(
  org: string,
  dataset: string,
  episodeId: number,
) {
  const repoId = `${org}/${dataset}`;
  const keyPrefix = `data-builder/${org}/data/${dataset}`.replace(/\/$/, "");

  const sign = async (key: string) => {
    return getSignedUrl("configint-main", `${keyPrefix}/${key}`);
  };

  try {
    const jsonUrl = await sign("meta/info.json");

    const info = await fetchJson<DatasetMetadata>(jsonUrl);

    const episode_chunk = Math.floor(
      episodeId / (info.chunks_size ?? 1000),
    );

    // Dataset information
    const datasetInfo = {
      repoId,
      total_frames: info.total_frames,
      total_episodes: info.total_episodes,
      fps: info.fps,
      total_duration_hours: info.total_frames / info.fps / 3600,
    };

    // Generate list of episodes
    const episodes = Array.from(
      { length: datasetInfo.total_episodes },
      // episode index starts from 0
      (_, i) => i,
    );

    // Fetch episode metadata to build labels and tasks
    const episodesLabels: Record<number, string> = {};
    const episodesTasks: Record<number, string[]> = {};
    try {
      const episodesUrl = await sign("meta/episodes.jsonl");
      const text = await (await fetch(episodesUrl)).text();
      const episodesData = text
        .split("\n")
        .filter((line) => line.trim().length)
        .map((line) => JSON.parse(line));
      for (const ep of episodesData) {
        const epNum = Number(ep.episode_index);
        let labelPath = "";
        if (Array.isArray(ep.input_key)) {
          labelPath = ep.input_key[1]
            .split("/")
            .filter(Boolean)
            .slice(-5)
            .join("/");
        } else if (typeof ep.input_key === "string") {
          labelPath = ep.input_key
            .split("/")
            .filter(Boolean)
            .slice(-5)
            .join("/");
        }
        episodesLabels[epNum] = `${epNum}: ${labelPath}`;
        episodesTasks[epNum] = Array.isArray(ep.tasks) ? ep.tasks : [];
      }
    } catch (err) {
      console.warn("Failed to fetch episodes.jsonl", err);
    }

    // Fetch subtask metadata
    const subtasksMap: Record<number, string> = {};
    try {
      const subtasksUrl = await sign("meta/subtasks.jsonl");
      const subtasksText = await (await fetch(subtasksUrl)).text();
      const subtasksData = subtasksText
        .split("\n")
        .filter((line) => line.trim().length)
        .map((line) => JSON.parse(line));
      for (const st of subtasksData) {
        const idx = Number(st.task_index);
        subtasksMap[idx] = st.task ?? `Subtask ${idx}`;
      }
    } catch (err) {
      console.warn("Failed to fetch subtasks.jsonl (may not exist)", err);
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
          url: await sign(videoPath),
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

    const parquetUrl = await sign(parquetKey);

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

    const duration = chartData[chartData.length - 1].timestamp;

    // Compute subtask segments from parquet low_level_task_index
    let subtaskSegments: SubtaskSegment[] = [];
    if (Object.keys(subtasksMap).length > 0) {
      try {
        const subtaskFrames = await readParquetColumn(arrayBuffer, [
          "timestamp",
          "low_level_task_index",
        ]);
        if (subtaskFrames.length > 0) {
          let currentIndex = Number(subtaskFrames[0][1]);
          let segmentStart = Number(subtaskFrames[0][0]);

          for (let i = 1; i < subtaskFrames.length; i++) {
            const frameIndex = Number(subtaskFrames[i][1]);
            if (frameIndex !== currentIndex) {
              subtaskSegments.push({
                subtaskIndex: currentIndex,
                text: subtasksMap[currentIndex] ?? `Subtask ${currentIndex}`,
                startTime: segmentStart,
                endTime: Number(subtaskFrames[i][0]),
              });
              currentIndex = frameIndex;
              segmentStart = Number(subtaskFrames[i][0]);
            }
          }
          // Close the last segment
          subtaskSegments.push({
            subtaskIndex: currentIndex,
            text: subtasksMap[currentIndex] ?? `Subtask ${currentIndex}`,
            startTime: segmentStart,
            endTime: duration,
          });
        }
      } catch (err) {
        console.warn("Failed to read low_level_task_index from parquet", err);
      }
    }

    return {
      datasetInfo,
      episodeId,
      videosInfo: resolvedVideosInfo,
      chartData,
      columns,
      episodes,
      episodeLabels: episodesLabels,
      tasks: episodesTasks[episodeId] ?? [],
      subtaskSegments,
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
