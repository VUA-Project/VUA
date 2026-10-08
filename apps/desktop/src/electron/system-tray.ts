import { Menu, nativeImage, nativeTheme, Tray } from "electron";
import type { DesktopShellCommandV1 } from "@vua/contracts";
import { trayIcons } from "./tray-icons.js";

const copy = {
  en: { updates: "Check for updates", bigscreen: "Big screen mode", exit: "Exit" },
  "zh-CN": { updates: "检查更新", bigscreen: "大屏幕模式", exit: "退出" },
  ja: { updates: "更新を確認", bigscreen: "ビッグスクリーンモード", exit: "終了" },
  ko: { updates: "업데이트 확인", bigscreen: "큰 화면 모드", exit: "종료" },
} as const;

export function vuaTrayImage(dark: boolean) {
  const result = nativeImage.createEmpty();
  for (const representation of trayIcons[dark ? "dark" : "light"]) {
    result.addRepresentation({ scaleFactor: representation.scaleFactor, buffer: Buffer.from(representation.png, "base64") });
  }
  return result;
}

/** Tray lives with the process; all focus changes require an explicit user gesture. */
export function createVuaTray(actions: {
  locale: string;
  showMain: () => void;
  command: (command: DesktopShellCommandV1) => void;
  quit: () => void;
}) {
  // Windows can use a dark taskbar with light applications (or the reverse).
  const image = () => vuaTrayImage(process.platform === "win32"
    ? nativeTheme.shouldUseDarkColorsForSystemIntegratedUI : nativeTheme.shouldUseDarkColors);
  const tray = new Tray(image());
  tray.setToolTip("VUA");
  tray.on("double-click", actions.showMain);
  const updateTheme = () => { if (!tray.isDestroyed()) tray.setImage(image()); };
  nativeTheme.on("updated", updateTheme);
  const setLocale = (locale: unknown) => {
    const language = typeof locale === "string" ? locale.toLowerCase() : "";
    const text = language.startsWith("zh") ? copy["zh-CN"] : language.startsWith("ja") ? copy.ja : language.startsWith("ko") ? copy.ko : copy.en;
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: text.updates, click: () => actions.command("check-updates") },
      { label: text.bigscreen, click: () => actions.command("bigscreen") },
      { label: text.exit, click: actions.quit },
    ]));
  };
  setLocale(actions.locale);
  return {
    setLocale,
    dispose: () => {
      nativeTheme.removeListener("updated", updateTheme);
      if (!tray.isDestroyed()) tray.destroy();
    },
  };
}
