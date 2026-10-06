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
  | "edit"
  | "clock"
  | "minimize"
  | "maximize"
  | "pin"
  | "chevron-down"
  | "cloud"
  | "folder"
  | "avatar"
  | "outfit"
  | "anim"
  | "shader"
  | "refresh"
  | "dash"
  | "home"
  | "bell"
  | "gauge"
  | "add";

const paths: Record<IconName, string> = {
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
      strokeWidth={name === "warning" ? 1.6 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
