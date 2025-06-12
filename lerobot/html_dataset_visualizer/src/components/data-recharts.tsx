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

const SERIES_NAME_DELIMITER = " | ";

type ColumnGroup = {
  key: string;
  value: string[];
};

type DataGraphProps = {
  data: Array<Record<string, number>>;
  columns: ColumnGroup[];
  datasetId: string;
  onChartsReady?: () => void;
};

import React, { useMemo } from "react";

export const DataRecharts = React.memo(
  ({ data, columns, datasetId, onChartsReady }: DataGraphProps) => {
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
          columns={columns}
          datasetId={datasetId}
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
    columns,
    datasetId,
    hoveredTime,
    setHoveredTime,
  }: {
    data: Array<Record<string, number>>;
    columns: ColumnGroup[];
    datasetId: string;
    hoveredTime: number | null;
    setHoveredTime: (t: number | null) => void;
  }) => {
    const { currentTime, setCurrentTime } = useTime();
  const chartData = useMemo(() => data, [data]);
  const [dataKeys, setDataKeys] = useState<string[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
  const storageKey = `visibleKeys:${datasetId}`;

  const toggleAll = () => {
    setVisibleKeys((prev) =>
      prev.length === dataKeys.length ? [] : [...dataKeys],
    );
  };

    useEffect(() => {
      if (!data || data.length === 0) return;
      const keys = Object.keys(data[0]).filter((k) => k !== "timestamp");
      setDataKeys(keys);
      const saved =
        typeof window !== "undefined"
          ? localStorage.getItem(storageKey)
          : null;
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as string[];
          setVisibleKeys(parsed.filter((k) => keys.includes(k)));
        } catch {
          setVisibleKeys([]);
        }
      } else {
        setVisibleKeys([]);
      }
    }, [data, storageKey]);

    useEffect(() => {
      if (typeof window === "undefined") return;
      localStorage.setItem(storageKey, JSON.stringify(visibleKeys));
    }, [visibleKeys, storageKey]);

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
      const closestIndex = findClosestDataIndex(
        hoveredTime != null ? hoveredTime : currentTime,
      );
      const currentData = chartData[closestIndex] || {};

      const handleCheckboxChange = (key: string) => {
        setVisibleKeys((prev) =>
          prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
        );
      };

      const handleColumnToggle = (col: ColumnGroup) => {
        const allVisible = col.value.every((k) => visibleKeys.includes(k));
        setVisibleKeys((prev) => {
          if (allVisible) {
            return prev.filter((k) => !col.value.includes(k));
          }
          return Array.from(new Set([...prev, ...col.value]));
        });
      };

      const maxIndices = Math.max(...columns.map((c) => c.value.length));
      return (
        <div className="overflow-x-auto mx-4">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="text-left pr-4">field</th>
                {Array.from({ length: maxIndices }).map((_, i) => (
                  <th key={i} className="px-2 text-center">{i}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {columns.map((col) => {
                const allChecked = col.value.every((k) => visibleKeys.includes(k));
                return (
                  <tr key={col.key} className="align-top">
                    <td className="pr-4 whitespace-nowrap w-48">
                      <label className="flex gap-2 select-none">
                        <input
                          type="checkbox"
                          className="size-3.5"
                          checked={allChecked}
                          onChange={() => handleColumnToggle(col)}
                        />
                        <span>{col.key}</span>
                      </label>
                    </td>
                    {Array.from({ length: maxIndices }).map((_, idx) => {
                      const key = col.value[idx];
                      if (!key)
                        return <td key={idx} className="px-2" />;
                      const isChecked = visibleKeys.includes(key);
                      return (
                        <td key={idx} className="px-2 text-center">
                          <input
                            type="checkbox"
                            className="size-3.5"
                            checked={isChecked}
                            onChange={() => handleCheckboxChange(key)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    };
    return (
      <div>
        <div className="h-96" onMouseLeave={handleMouseLeave}>
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
        <div className="mt-4">
          <CustomLegend />
        </div>
        <div className="flex justify-end mt-2">
          <button
            className="text-xs border border-slate-500 rounded px-2 py-1"
            onClick={toggleAll}
          >
            {visibleKeys.length === dataKeys.length ? "Hide All Fields" : "Show All Fields"}
          </button>
        </div>
      </div>
    );
  },
); // End React.memo

SingleDataGraph.displayName = "SingleDataGraph";
DataRecharts.displayName = "DataGraph";
export default DataRecharts;
