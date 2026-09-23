/**
 * 地图窗图标组件（对齐设计稿 Map Window.html 的 <symbol id="ic-*"> 集合）
 * 单一来源：路径数据内联，避免外部素材依赖。
 */
import type { CSSProperties } from "react";

const PATHS: Record<string, string> = {
  select: "M5 3l14 8-6 1.5L10 19z",
  hand: "M8 12V6.5a1.5 1.5 0 013 0V12m0-1.5V5a1.5 1.5 0 013 0v6.5m0-.5V7.5a1.5 1.5 0 013 0V14c0 3.5-2.5 6-6 6s-5.5-2-5.5-5V10a1.5 1.5 0 013 0v2",
  brush: "M15 4l5 5-8 8H7l-3 3v-6z",
  stamp: "M4 20h16M6 20v-3l1-6 4-3h2l4 3 1 6v3",
  pin: "M12 22s7-7.5 7-12.5A7 7 0 005 9.5C5 14.5 12 22 12 22z",
  "pin-fill": "M12 22s7-7.5 7-12.5A7 7 0 005 9.5C5 14.5 12 22 12 22z",
  frame: "M3.5 5.5h17v13H3.5z",
  tag: "M4 4h9l7 7-9 9-7-7z",
  link: "M13 7l1.5-1.5a4 4 0 015.7 5.7L18.5 13M11 17l-1.5 1.5a4 4 0 01-5.7-5.7L5.5 11",
  undo: "M4 9h10a5 5 0 010 10H9M4 9l4-4M4 9l4 4",
  redo: "M20 9H10a5 5 0 000 10h5M20 9l-4-4M20 9l-4 4",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  chevron: "M7 10l5 5 5-5",
  "chevron-up": "M7 14l5-5 5 5",
  "plus-sm": "M12 6v12M6 12h12",
  refresh: "M20 12a8 8 0 11-2.3-5.6M20 4v4h-4",
  download: "M12 4v11m0 0l-4-4m4 4l4-4M5 19h14",
  gear: "M12 3v2m0 14v2M4.2 7.5l1.7 1M18.1 15.5l1.7 1M4.2 16.5l1.7-1M18.1 8.5l1.7-1M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z",
  map: "M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5zM9 4v13m6-10.5v13",
  book: "M4 5.5A1.5 1.5 0 015.5 4H10a3 3 0 013 3v13a2.5 2.5 0 00-2.5-2.5H5.5A1.5 1.5 0 014 16zM20 5.5A1.5 1.5 0 0018.5 4H15a3 3 0 00-3 3",
  warning: "M12 7.5v6M12 16.6a1.1 1.1 0 100 .01z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  lock: "M5 10.5h14v9.5H5zM8.5 10.5V8a3.5 3.5 0 017 0v2.5",
  target: "M12 2v3m0 14v3M2 12h3m14 0h3M12 4a8 8 0 100 16 8 8 0 000-16z",
  ruler: "M2.5 8h19v8H2.5zM7 8v3m4-3v3m4-3v3m4-3v3",
  rotate: "M12 6V3M9.5 5.5 12 3l2.5 2.5M19 12a7 7 0 11-3.6-6.1",
  eye: "M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM12 9.4a2.6 2.6 0 100 5.2 2.6 2.6 0 000-5.2z",
  "arrow-right": "M4 12h15m0 0l-5-5m5 5l-5 5",
  layer: "M12 4l8 5-8 5-8-5zM4 14l8 5 8-5",
  group: "M3.5 3.5h7v7H3.5zM13.5 13.5h7v7h-7zM11 7h3.5a2 2 0 012 2V13",
  magnet: "M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z",
  "layer-up": "M12 4l8 5-8 5-8-5zM4 14l8 5 8-5",
};

export interface MapIconProps {
  name: keyof typeof PATHS | string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  filled?: boolean;
  style?: CSSProperties;
  className?: string;
}

/** 地图窗图标：默认描边；filled 时填充（pin-fill / 选中态用） */
export default function MapIcon({
  name,
  size = 16,
  color = "currentColor",
  strokeWidth = 1.6,
  filled = false,
  style,
  className,
}: MapIconProps) {
  const d = PATHS[name] ?? PATHS.select;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={d}
        fill={filled ? color : "none"}
        stroke={filled ? "none" : color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {filled && (
        <circle cx="12" cy="9.5" r="2.4" fill="#fff" opacity="0.92" />
      )}
    </svg>
  );
}
