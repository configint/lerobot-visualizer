"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { postParentMessageWithParams } from "@/utils/postParentMessage";
import VideosPlayer from "@/components/videos-player";
import DataRecharts from "@/components/data-recharts";
import PlaybackBar from "@/components/playback-bar";
import { TimeProvider, useTime } from "@/context/time-context";
import Sidebar from "@/components/side-nav";
import Loading from "@/components/loading-component";

export default function EpisodeViewer({
  data,
  error,
}: {
  data?: any;
  error?: string;
}) {
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-red-400">
        <div className="max-w-xl p-8 rounded bg-slate-900 border border-red-500 shadow-lg">
          <h2 className="text-2xl font-bold mb-4">Something went wrong</h2>
          <p className="text-lg font-mono whitespace-pre-wrap mb-4">{error}</p>
        </div>
      </div>
    );
  }
  return (
    <TimeProvider duration={data.duration}>
      <EpisodeViewerInner data={data} />
    </TimeProvider>
  );
}

function EpisodeViewerInner({ data }: { data: any }) {
  const {
    datasetInfo,
    episodeId,
    videosInfo,
    chartData,
    columns,
    episodes,
    episodeLabels,
    tasks,
    ignoredColumns,
  } = data;

  const episodeLabelPath =
    episodeLabels[episodeId]?.split(": ").slice(1).join(": ") || "";

  const [videosReady, setVideosReady] = useState(!videosInfo.length);
  const [chartsReady, setChartsReady] = useState(false);
  const isLoading = !videosReady || !chartsReady;

  const router = useRouter();
  const searchParams = useSearchParams();

  // State
  // Use context for time sync
  const { currentTime, setCurrentTime, setIsPlaying, isPlaying } = useTime();

  // Pagination state
  const pageSize = 100;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(episodes.length / pageSize);
  const paginatedEpisodes = episodes.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  useEffect(() => {
    const label = episodeLabelPath ? `: ${episodeLabelPath}` : "";
    document.title = `${datasetInfo.repoId} | episode ${episodeId}${label}`;
  }, [datasetInfo.repoId, episodeId, episodeLabelPath]);

  // Initialize based on URL time parameter
  useEffect(() => {
    const timeParam = searchParams.get("t");
    if (timeParam) {
      const timeValue = parseFloat(timeParam);
      if (!isNaN(timeValue)) {
        setCurrentTime(timeValue);
      }
    }
  }, []);

  // sync with parent window hf.co/spaces
  useEffect(() => {
    postParentMessageWithParams((params: URLSearchParams) => {
      params.set("path", window.location.pathname + window.location.search);
    });
  }, []);

  // Initialize based on URL time parameter
  useEffect(() => {
    // Initialize page based on current episode
    const episodeIndex = episodes.indexOf(episodeId);
    if (episodeIndex !== -1) {
      setCurrentPage(Math.floor(episodeIndex / pageSize) + 1);
    }

    // Add keyboard event listener
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [episodes, episodeId, pageSize, searchParams]);

  // Only update URL ?t= param when the integer second changes
  const lastUrlSecondRef = useRef<number>(-1);
  useEffect(() => {
    if (isPlaying) return;
    const currentSec = Math.floor(currentTime);
    if (currentTime > 0 && lastUrlSecondRef.current !== currentSec) {
      lastUrlSecondRef.current = currentSec;
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set("t", currentSec.toString());
      // Replace state instead of pushing to avoid navigation stack bloat
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}?${newParams.toString()}`,
      );
      postParentMessageWithParams((params: URLSearchParams) => {
        params.set("path", window.location.pathname + window.location.search);
      });
    }
  }, [isPlaying, currentTime, searchParams]);

  // Handle keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    const { key } = e;

    if (key === " ") {
      e.preventDefault();
      setIsPlaying((prev: boolean) => !prev);
    } else if (key === "ArrowDown" || key === "ArrowUp") {
      e.preventDefault();
      const nextEpisodeId = key === "ArrowDown" ? episodeId + 1 : episodeId - 1;
      const lowestEpisodeId = episodes[0];
      const highestEpisodeId = episodes[episodes.length - 1];

      if (
        nextEpisodeId >= lowestEpisodeId &&
        nextEpisodeId <= highestEpisodeId
      ) {
        router.push(`./episode_${nextEpisodeId}`);
      }
    }
  };

  // Pagination functions
  const nextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage((prev) => prev + 1);
    }
  };

  const prevPage = () => {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1);
    }
  };

  return (
    <div className="flex h-screen max-h-screen bg-slate-950 text-gray-200">
      {/* Sidebar */}
      <Sidebar
        datasetInfo={datasetInfo}
        paginatedEpisodes={paginatedEpisodes}
        episodeId={episodeId}
        episodeLabels={episodeLabels}
        totalPages={totalPages}
        currentPage={currentPage}
        prevPage={prevPage}
        nextPage={nextPage}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Videos column */}
        <div
          className={`flex w-[50%] flex-col gap-4 p-4 relative ${isLoading ? "overflow-hidden" : "overflow-y-auto"}`}
        >
          {isLoading && <Loading />}

          <div className="flex items-center justify-start my-4">
            <a
              href="https://github.com/huggingface/lerobot"
              target="_blank"
              className="block"
            >
              <img
                src="https://github.com/huggingface/lerobot/raw/main/media/lerobot-logo-thumbnail.png"
                alt="LeRobot Logo"
                className="w-32"
              />
            </a>

            <div>
              <a
                href={`https://huggingface.co/datasets/${datasetInfo.repoId}`}
                target="_blank"
              >
                <p className="text-lg font-semibold">{datasetInfo.repoId}</p>
              </a>

              <p className="font-mono text-lg font-semibold">
                episode {episodeId}
                {episodeLabelPath && `: ${episodeLabelPath}`}
              </p>
            </div>
          </div>

          {tasks?.length > 0 && (
            <p className="text-lg mb-2">
              tasks: <span className="font-mono">{tasks.join(", ")}</span>
            </p>
          )}

          {videosInfo.length && (
            <VideosPlayer
              videosInfo={videosInfo}
              onVideosReady={() => setVideosReady(true)}
            />
          )}

          <PlaybackBar />
        </div>

        {/* Charts column */}
        <div className="flex w-[50%] flex-col p-4 items-center justify-center">
          <div className="w-full max-w-full">
            <DataRecharts
              data={chartData}
              columns={columns}
              onChartsReady={() => setChartsReady(true)}
            />

            {ignoredColumns.length > 0 && (
              <p className="mt-2 text-orange-700">
                Columns{" "}
                <span className="font-mono">{ignoredColumns.join(", ")}</span>{" "}
                are NOT shown since the visualizer currently does not support 2D
                or 3D data.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
