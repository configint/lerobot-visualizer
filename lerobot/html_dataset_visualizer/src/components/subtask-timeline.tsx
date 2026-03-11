"use client";

import { useState } from "react";
import { useTime } from "../context/time-context";
import { SubtaskSegment } from "@/types/subtask";

type SubtaskTimelineProps = {
  segments: SubtaskSegment[];
  duration: number;
};

function getSegmentColor(index: number, total: number): string {
  const hue = (index * 360) / Math.max(total, 1);
  return `hsl(${hue}, 60%, 35%)`;
}

function getSegmentActiveColor(index: number, total: number): string {
  const hue = (index * 360) / Math.max(total, 1);
  return `hsl(${hue}, 70%, 50%)`;
}

export default function SubtaskTimeline({
  segments,
  duration,
}: SubtaskTimelineProps) {
  const { currentTime, setCurrentTime } = useTime();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(false);

  if (!segments.length || duration <= 0) return null;

  const uniqueCount = new Set(segments.map((s) => s.subtaskIndex)).size;

  const activeSegmentIdx = segments.findIndex(
    (s) => currentTime >= s.startTime && currentTime < s.endTime,
  );
  const effectiveActiveIdx =
    activeSegmentIdx === -1 ? segments.length - 1 : activeSegmentIdx;

  return (
    <div className="w-full">
      {/* Compact bar with index numbers */}
      <div className="flex w-full rounded overflow-hidden border border-slate-700">
        {segments.map((segment, idx) => {
          const widthPct =
            ((segment.endTime - segment.startTime) / duration) * 100;
          const isActive = idx === effectiveActiveIdx;
          const isHovered = idx === hoveredIndex;

          return (
            <div
              key={`${segment.subtaskIndex}-${idx}`}
              className="relative cursor-pointer transition-all duration-150"
              style={{
                width: `${widthPct}%`,
                minWidth: "12px",
                backgroundColor: isActive
                  ? getSegmentActiveColor(segment.subtaskIndex, uniqueCount)
                  : getSegmentColor(segment.subtaskIndex, uniqueCount),
                opacity: isActive || isHovered ? 1 : 0.7,
                borderRight:
                  idx < segments.length - 1
                    ? "1px solid rgb(51 65 85)"
                    : "none",
              }}
              onClick={() => setCurrentTime(segment.startTime)}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <div
                className={`py-1 text-xs text-center select-none ${isActive ? "text-white font-bold" : "text-slate-300"}`}
              >
                {idx}
              </div>

              {/* Tooltip on hover */}
              {isHovered && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-slate-800 border border-slate-600 rounded shadow-lg text-xs text-slate-100 whitespace-nowrap z-50 pointer-events-none">
                  <p className="font-semibold">{segment.text}</p>
                  <p className="text-slate-400">
                    {segment.startTime.toFixed(1)}s &ndash;{" "}
                    {segment.endTime.toFixed(1)}s
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Active subtask text + toggle button */}
      <div className="flex items-start gap-2 mt-1.5">
        <button
          onClick={() => setListOpen((prev) => !prev)}
          className="text-xs text-slate-400 hover:text-slate-200 border border-slate-600 rounded px-1.5 py-0.5 shrink-0"
        >
          {listOpen ? "\u25B2" : "\u25BC"} {segments.length}
        </button>
        <p className="text-sm text-slate-200">
          <span className="text-slate-200">subtask:</span>{" "}
          <span className="text-orange-400 font-semibold">
            #{effectiveActiveIdx}
          </span>{" "}
          {segments[effectiveActiveIdx]?.text}
        </p>
      </div>

      {/* Collapsible subtask list */}
      {listOpen && (
        <ul className="mt-1 text-sm max-h-40 overflow-y-auto">
          {segments.map((segment, idx) => {
            const isActive = idx === effectiveActiveIdx;
            return (
              <li
                key={`${segment.subtaskIndex}-${idx}`}
                className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-slate-800 ${isActive ? "bg-slate-800" : ""}`}
                onClick={() => setCurrentTime(segment.startTime)}
              >
                <span
                  className={`text-xs min-w-[20px] ${isActive ? "text-orange-400 font-bold" : "text-slate-500"}`}
                >
                  {isActive && "\u25B6 "}
                  {idx}.
                </span>
                <span
                  className={`flex-1 truncate ${isActive ? "text-orange-300 font-semibold" : "text-slate-300"}`}
                >
                  {segment.text}
                </span>
                <span className="text-xs text-slate-500 shrink-0">
                  {segment.startTime.toFixed(1)}s
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
