"use client";

import { useEffect, useState } from "react";
import { useTime } from "../context/time-context";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

type DataGraphProps = {
  data: Array<Record<string, number>>;
  onChartsReady?: () => void;
};

import React, { useMemo } from "react";

export const DataRecharts = React.memo(
  ({ data, onChartsReady }: DataGraphProps) => {
    // Shared hoveredTime for all graphs
    const [hoveredTime, setHoveredTime] = useState<number | null>(null);

    if (!Array.isArray(data) || data.length === 0) return null;

    useEffect(() => {
      if (typeof onChartsReady === "function") {
        onChartsReady();
      }
    }, [onChartsReady]);

    return (
      <div className="flex flex-col gap-4 overflow-y-auto pr-4">
        <SingleDataGraph
          data={data}
          hoveredTime={hoveredTime}
          setHoveredTime={setHoveredTime}
        />
      </div>
    );
  },
);

// SingleDataGraph renders one chart for a group
const SingleDataGraph = React.memo(
  ({
    data,
    hoveredTime,
    setHoveredTime,
  }: {
    data: Array<Record<string, number>>;
    hoveredTime: number | null;
    setHoveredTime: (t: number | null) => void;
  }) => {
    const { currentTime, setCurrentTime } = useTime();
  const chartData = useMemo(() => data, [data]);
  const [dataKeys, setDataKeys] = useState<string[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const [showLegend, setShowLegend] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("showLegend") === "true";
  });

    useEffect(() => {
      if (!data || data.length === 0) return;
      const keys = Object.keys(data[0]).filter((k) => k !== "timestamp");
      setDataKeys(keys);
      const saved =
        typeof window !== "undefined"
          ? localStorage.getItem("visibleKeys")
          : null;
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as string[];
          setVisibleKeys(parsed.filter((k) => keys.includes(k)));
        } catch {
          setVisibleKeys(keys);
        }
      } else {
        setVisibleKeys(keys);
      }
    }, [data]);

    useEffect(() => {
      if (typeof window === "undefined") return;
      localStorage.setItem("visibleKeys", JSON.stringify(visibleKeys));
    }, [visibleKeys]);

    // Find the closest data point to the current time for highlighting
    const findClosestDataIndex = (time: number) => {
      if (!chartData.length) return 0;
      // Find the index of the first data point whose timestamp is >= time (ceiling)
      const idx = chartData.findIndex((point) => point.timestamp >= time);
      if (idx !== -1) return idx;
      // If all timestamps are less than time, return the last index
      return chartData.length - 1;
    };

    // Handle mouseLeave - restore to video's current time
    const handleMouseLeave = () => {
      setHoveredTime(null);
    };

    // Handle click on chart - this SHOULD change the video time
    const handleClick = (data: any) => {
      if (data && data.activePayload && data.activePayload.length) {
        const timeValue = data.activePayload[0].payload.timestamp;
        setCurrentTime(timeValue);
      }
    };

    // Custom legend to show current value next to each series
    const CustomLegend = () => {
      // Find the closest data point to the hovered or current time
      const closestIndex = findClosestDataIndex(
        hoveredTime != null ? hoveredTime : currentTime,
      );
      const currentData = chartData[closestIndex] || {};

      const handleCheckboxChange = (key: string) => {
        setVisibleKeys((prev) =>
          prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
        );
      };

      return (
        <div className="grid grid-cols-[repeat(auto-fit,250px)] gap-4 mx-8">
          {dataKeys.map((key, idx) => {
            const color = `hsl(${idx * (360 / dataKeys.length)}, 100%, 50%)`;
            const isChecked = visibleKeys.includes(key);
            return (
              <label
                key={key}
                className="flex gap-2 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleCheckboxChange(key)}
                  className="size-3.5 mt-1"
                  style={{ accentColor: color }}
                />
                <span
                  className={`text-sm break-all w-40 ${isChecked ? "text-white" : "text-gray-400"}`}
                >
                  {key}:
                </span>
                <span
                  className={`text-sm font-mono ml-auto ${isChecked ? "text-orange-300" : "text-gray-500"}`}
                >
                  {typeof currentData[key] === "number"
                    ? currentData[key].toFixed(2)
                    : "--"}
                </span>
              </label>
            );
          })}
        </div>
      );
    };

    return (
      <div className="flex flex-col w-full">
        <div className="flex justify-end mb-2">
          <button
            className="text-xs border border-slate-500 rounded px-2 py-1"
            onClick={() =>
              setShowLegend((prev) => {
                const next = !prev;
                if (typeof window !== "undefined") {
                  localStorage.setItem("showLegend", next.toString());
                }
                return next;
              })
            }
          >
            {showLegend ? "Hide Fields" : "Show Fields"}
          </button>
        </div>
        <div className="h-80" onMouseLeave={handleMouseLeave}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              syncId="episode-sync"
              margin={{ top: 24, right: 16, left: 0, bottom: 16 }}
              onClick={handleClick}
              onMouseMove={(state: any) => {
                setHoveredTime(
                  state?.activePayload?.[0]?.payload?.timestamp ??
                    state?.activeLabel ??
                    null,
                );
              }}
              onMouseLeave={handleMouseLeave}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#444" />
              <XAxis
                dataKey="timestamp"
                label={{
                  value: "time",
                  position: "insideBottomLeft",
                  fill: "#cbd5e1",
                }}
                domain={[
                  chartData.at(0)?.timestamp ?? 0,
                  chartData.at(-1)?.timestamp ?? 0,
                ]}
                ticks={useMemo(
                  () =>
                    Array.from(
                      new Set(chartData.map((d) => Math.ceil(d.timestamp))),
                    ),
                  [chartData],
                )}
                stroke="#cbd5e1"
                minTickGap={20} // Increased for fewer ticks
                allowDataOverflow={true}
              />
              <YAxis
                domain={["auto", "auto"]}
                stroke="#cbd5e1"
                interval={0}
                allowDataOverflow={true}
              />

              <Tooltip
                content={() => null}
                active={true}
                isAnimationActive={false}
                defaultIndex={
                  !hoveredTime ? findClosestDataIndex(currentTime) : undefined
                }
              />

              {/* Render lines for visible dataKeys only */}
              {dataKeys.map(
                (key, index) =>
                  visibleKeys.includes(key) && (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={key}
                      stroke={`hsl(${index * (360 / dataKeys.length)}, 100%, 50%)`}
                      dot={false}
                      activeDot={false}
                      strokeWidth={1.5}
                      isAnimationActive={false}
                    />
                  ),
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {showLegend && (
          <div className="mt-4">
            <CustomLegend />
          </div>
        )}
      </div>
    );
  },
); // End React.memo

SingleDataGraph.displayName = "SingleDataGraph";
DataRecharts.displayName = "DataGraph";
export default DataRecharts;
