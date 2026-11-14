import { currentLocale } from "./current-table.ts";
import type { LocaleId } from "./locales.ts";

const themeNames = {
  grid: "Grid",
  aero: "Frutiger Aero",
  tenshi: "Tenshi Kaiwai",
  jirai: "Jirai Kei",
} as const;

const en = {
  workshop: { viewing: "Viewing: {step}", executing: "Running: {step}", idle: "Idle", materials: "{count} materials",
    unknownAvatar: "Avatar pending scan", details: "Materials & build details", lineId: "Build ID" },
  settings: { family: "Theme style", ...themeNames, fixedAppearanceHint: "This theme uses a fixed color mode. Switch to Grid to choose light or dark mode." },
  repositories: { source: "Source", count: "Packages", actions: "Actions", use: "Use", uncached: "Not cached" },
  home: { continue: "Pick up where you left off", environment: "System status", utilities: "App & help" },
};
const copy: Partial<Record<LocaleId, typeof en>> = {
  en,
  "zh-CN": {
    workshop: { viewing: "正在查看：{step}", executing: "正在执行：{step}", idle: "当前空闲", materials: "{count} 个素材",
      unknownAvatar: "待识别素体", details: "素材名称与制作详情", lineId: "制作编号" },
    settings: { family: "主题风格", ...themeNames, fixedAppearanceHint: "该主题采用固定配色，切换到 Grid 后可自选浅色或深色外观。" },
    repositories: { source: "来源", count: "包数量", actions: "操作", use: "启用", uncached: "未缓存" },
    home: { continue: "继续手头进度", environment: "本机环境状态", utilities: "应用与帮助" },
  },
  "zh-TW": {
    workshop: { viewing: "正在查看：{step}", executing: "正在執行：{step}", idle: "目前閒置", materials: "{count} 個素材",
      unknownAvatar: "待辨識素體", details: "素材名稱與製作詳情", lineId: "製作編號" },
    settings: { family: "主題風格", ...themeNames, fixedAppearanceHint: "此主題採用固定外觀配色；切換回 Grid 即可自由選擇淺色或深色模式。" },
    repositories: { source: "來源", count: "套件數量", actions: "操作", use: "啟用", uncached: "尚未快取" },
    home: { continue: "接續目前進度", environment: "本機環境狀態", utilities: "應用程式與說明" },
  },
  ja: {
    workshop: { viewing: "表示中：{step}", executing: "実行中：{step}", idle: "待機中", materials: "素材 {count} 件",
      unknownAvatar: "アバター確認待ち", details: "使用素材とライン詳細", lineId: "ライン ID" },
    settings: { family: "テーマスタイル", ...themeNames, fixedAppearanceHint: "このテーマは配色が固定されています。ライト／ダークを切り替えるには Grid を選んでください。" },
    repositories: { source: "取得元", count: "パッケージ数", actions: "操作", use: "使う", uncached: "未取得" },
    home: { continue: "前回の続きから再開", environment: "現在の環境ステータス", utilities: "アプリとヘルプ" },
  },
  ko: {
    workshop: { viewing: "보는 단계: {step}", executing: "실행 중: {step}", idle: "대기 중", materials: "소재 {count}개",
      unknownAvatar: "아바타 확인 대기", details: "소재 목록 및 작업 상세", lineId: "작업 ID" },
    settings: { family: "테마 스타일", ...themeNames, fixedAppearanceHint: "이 프리셋은 전용 색감으로 고정돼요. 라이트·다크 모드를 바꾸려면 Grid 테마를 선택해 주세요." },
    repositories: { source: "출처", count: "패키지 수", actions: "작업", use: "사용", uncached: "캐시 없음" },
    home: { continue: "하던 작업 이어하기", environment: "내 PC 환경 상태", utilities: "앱 및 도움말" },
  },
};

export const presentationCopy = copy[currentLocale] ?? en;
export const presentationTables = copy;
