import type { CSSProperties } from "react";

/**
 * 图标基线为 Fluent System Icons 风格:圆角端点、约 1.5px 视觉描边(§3.4)。
 * 当前仅内联切片所需的最小集合,后续按 design-system/icons 规范扩充。
 */
export type IconName =
  | "check"
  | "warning"
  | "close"
  | "error-circle"
  | "question"
  | "arrow-right"
  | "flask"
  | "arrow-left"
  | "arrow-up"
  | "download"
  | "edit"
  | "clock"
  | "minimize"
  | "maximize"
  | "pin"
  | "chevron-down"
  | "cloud"
  | "computer"
  | "pause"
  | "folder"
  | "file"
  | "avatar"
  | "outfit"
  | "anim"
  | "shader"
  | "refresh"
  | "dash"
  | "home"
  | "bell"
  | "gauge"
  | "add"
  | "hand"
  | "square-check"
  | "shield"
  | "tools"
  | "modules"
  | "settings"
  | "info"
  | "list"
  | "signal"
  | "caret-down"
  | "search"
  | "more"
  | "copy"
  | "mic";

const paths: Record<IconName, string> = {
  tools: "M14 4a5 5 0 0 0-6 6L3 15a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-3-3 3-3ZM5 17l1-1",
  modules: "M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z",
  settings: "M10 3h4l.6 2.4 2 .9L19 5l2 3.5-1.8 1.8v2.3L21 15l-2 3.5-2.4-.8-2 .9L14 21h-4l-.6-2.4-2-.9-2.4.8L3 15l1.8-2.4v-2.3L3 8.5 5 5l2.4 1.3 2-.9ZM15.5 12a3.5 3.5 0 1 0-7 0 3.5 3.5 0 0 0 7 0Z",
  file: "M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6",
  download: "M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4",
  check: "M5 12.5l4.5 4.5L19 7.5",
  warning: "M12 4 L21 20 H3 Z M12 10v4 M12 17v.5",
  close: "M6 6l12 12M18 6L6 18",
  "error-circle": "M12 3a9 9 0 100 18 9 9 0 000-18 Z M12 7.5v5.5 M12 16.2v.5",
  question: "M9.5 9a2.5 2.5 0 1 1 3.4 2.34c-.83.3-.9 1-.9 1.66M12 17v.5",
  "arrow-right": "M4 12h15M13 6l6 6-6 6",
  "arrow-left": "M20 12H5M11 6l-6 6 6 6",
  // 应用内文件夹选择器(2026-09-25):上一级 = 上箭头,路径编辑 = 铅笔
  "arrow-up": "M12 20V5M6 11l6-6 6 6",
  edit: "M4 20h4.5L19.7 8.8a2.1 2.1 0 0 0-3-3L5.5 17v3ZM13.8 6.2l3 3",
  flask: "M10 3h4M10 3v5l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3.5L14 8V3",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7.5V12l3.5 2",
  minimize: "M5 12h14",
  maximize: "M6 6h12v12H6z",
  pin: "M15.5 3.5l5 5-2.5 1L13.5 14l-1 4-3-3-5 5-1-1 5-5-3-3 4-1 4.5-4.5 1-2.5z",
  "chevron-down": "M6 9.5l6 6 6-6",
  cloud: "M7 18.5a4.5 4.5 0 1 1 .42-8.98 5.5 5.5 0 0 1 10.66 1.6A3.75 3.75 0 0 1 17.5 18.5Z",
  computer: "M3 4h18v13H3ZM12 17v4M8 21h8",
  pause: "M8 5v14M16 5v14",
  folder: "M3.5 7a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z",
  // S-X-3 径向图谱角色图标(Fluent 风格描边)
  avatar: "M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM4.75 20c.6-3.8 3.7-6 7.25-6s6.65 2.2 7.25 6",
  outfit: "M10 3.8a2 2 0 1 1 2 2v1.7M12 7.5l8.3 9.2a1.4 1.4 0 0 1-1 2.3H4.7a1.4 1.4 0 0 1-1-2.3L12 7.5Z",
  anim: "M8 5.1v13.8c0 .8.9 1.3 1.6.9l11-6.9a1.04 1.04 0 0 0 0-1.8l-11-6.9c-.7-.4-1.6.1-1.6.9Z",
  shader: "M12 3.5 13.9 9.1l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9L12 3.5Z",
  // 内嵌浏览导航条(Fluent 风格描边):刷新 = 顺时针环形箭头,回首页 = 屋形
  refresh: "M20 12a8 8 0 1 1-2.34-5.66M20 4.5v4h-4",
  // 中性横杠:可选/不适用状态(部署器替代组未安装成员)
  dash: "M5 12h14",
  home: "M4 11l8-7 8 7M6.5 9.5V20h11V9.5",
  // 通知铃铛(顶栏通知中心入口):钟体 + 底部舌锤
  bell: "M12 3.5a5 5 0 0 0-5 5v2.7c0 .53-.16 1.04-.46 1.47L5 15.2A1.25 1.25 0 0 0 6.04 17h11.92A1.25 1.25 0 0 0 19 15.2l-1.54-2.53a2.3 2.3 0 0 1-.46-1.47V8.5a5 5 0 0 0-5-5Z M10 18.6a2.1 2.1 0 0 0 4 0",
  // 仪表盘(顶栏占用查看器入口):半圆表盘 + 指针 + 轴心
  gauge: "M3.5 17.5a9 9 0 1 1 17 0 M12 13.5l3.6-4.8 M12 16.8v.5",
  // 标准加号(部署页网站测试的「添加网站」入口)
  add: "M12 5v14M5 12h14",
  // Permission modes (AMF workshop): an open hand asks first, a checked box runs routine steps, a shield runs everything
  hand: "M8.5 12V5.75a1.25 1.25 0 0 1 2.5 0V11M11 11V4.25a1.25 1.25 0 0 1 2.5 0V11M13.5 11V5.25a1.25 1.25 0 0 1 2.5 0v6.25M16 11.5V7.75a1.25 1.25 0 0 1 2.5 0V15a6 6 0 0 1-6 6h-1a5.5 5.5 0 0 1-4.6-2.5L4.3 14.3a1.3 1.3 0 0 1 2-1.7L8.5 15v-3",
  "square-check": "M6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4ZM8.5 12.2l2.5 2.5 4.8-5",
  shield: "M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v6M12 7.5v.5",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  signal: "M5 20v-3M10 20v-7M15 20V9M20 20V4",
  "caret-down": "M6 9h12l-6 7Z",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM20 20l-4.8-4.8",
  more: "M5.5 12h.01M12 12h.01M18.5 12h.01",
  copy: "M9 3h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM5 8H4a1 1 0 0 0-1 1v10a2 2 0 0 0 2 2h9a1 1 0 0 0 1-1v-1",
  mic: "M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3ZM6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.5M9 20.5h6",
};

export interface IconProps {
  name: IconName;
  /** 16 / 20 / 24(§3.4) */
  size?: 16 | 20 | 24;
  style?: CSSProperties;
}

export function Icon({ name, size = 20, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "warning" ? 1.6 : name === "more" ? 2.6 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
