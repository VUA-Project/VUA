/** Shared Steam-connection copy for the five non-VRCFT N2 tools; {tool} takes the card title. */
const en = {
  install: "Install in Steam", openApp: "Open {tool}", running: "Running", closeApp: "Close",
  unknown: "Couldn't check {tool}. Try again.", checking: "Checking {tool}…",
  waitInstall: "Waiting for Steam", waitClose: "Closing…", waitOpen: "Opening…",
  recheck: "Check again",
  steamMissing: "Steam is needed to install and open this version of {tool}.", prepareSteam: "Prepare Steam",
  presence: { installed: "Steam installation found", missing: "{tool} isn't installed in Steam", incomplete: "Steam hasn't finished installing {tool}", unknown: "Couldn't read the Steam installation" },
  issues: { steam_missing: "Prepare Steam first.", not_installed: "Finish installing {tool} in Steam, then check again.", handoff_failed: "Couldn't open Steam. Open it yourself, then try again.", start_timeout: "{tool} hasn't appeared yet. Check Steam and try opening it again.", close_failed: "Couldn't request a normal close. Exit {tool} from its own window or tray.", close_timeout: "{tool} is still running. Exit from its own window or tray; your other software will stay open." },
  cancelWait: "Stop waiting", cancelHint: "This stops VUA's wait. Downloads and startup in Steam continue.", existing: "This {tool} instance was already open. Close it from its own window or tray.",
};
type Copy<T> = { [K in keyof T]: T[K] extends string ? string : Copy<T[K]> };
export const toolConnectionCopy: Record<"en" | "zh-CN" | "ja" | "ko", Copy<typeof en>> = {
  en,
  "zh-CN": {
    install: "在 Steam 安装", openApp: "打开 {tool}", running: "运行中", closeApp: "关闭",
    unknown: "暂时无法检查 {tool}，可以重试。", checking: "正在检查 {tool}…",
    waitInstall: "等待 Steam 安装", waitClose: "正在关闭…", waitOpen: "正在打开…",
    recheck: "重新检查",
    steamMissing: "这个版本的 {tool} 需要通过 Steam 安装和打开。", prepareSteam: "准备 Steam",
    presence: { installed: "已找到 Steam 中的安装", missing: "Steam 中还没有安装 {tool}", incomplete: "Steam 还没有完成 {tool} 的安装", unknown: "暂时无法读取 Steam 中的安装" },
    issues: { steam_missing: "先准备好 Steam。", not_installed: "在 Steam 完成 {tool} 的安装后，再检查一次。", handoff_failed: "没有打开 Steam。可以手动打开后再试。", start_timeout: "还没有看到 {tool} 启动，请查看 Steam 后再试一次。", close_failed: "没能请求正常关闭，请从 {tool} 自己的窗口或托盘退出。", close_timeout: "{tool} 仍在运行，请从它自己的窗口或托盘退出。其它软件会保留。" },
    cancelWait: "停止等待", cancelHint: "只停止 VUA 的等待，Steam 中的下载和启动会继续。", existing: "这个 {tool} 实例原本就在运行，请从它自己的窗口或托盘关闭。",
  },
  ja: {
    install: "Steam でインストール", openApp: "{tool} を開く", running: "実行中", closeApp: "閉じる",
    unknown: "{tool} を確認できませんでした。再試行できます。", checking: "{tool} を確認中…",
    waitInstall: "Steam のインストール待ち", waitClose: "終了中…", waitOpen: "起動中…",
    recheck: "もう一度確認",
    steamMissing: "この {tool} は Steam からインストール・起動します。", prepareSteam: "Steam を準備",
    presence: { installed: "Steam のインストールを確認", missing: "Steam に {tool} が未インストール", incomplete: "Steam での {tool} インストールが未完了", unknown: "Steam のインストールを読み取れません" },
    issues: { steam_missing: "先に Steam を準備してください。", not_installed: "Steam で {tool} のインストールを終えてから、もう一度確認してください。", handoff_failed: "Steam を開けませんでした。手動で開いて再試行してください。", start_timeout: "{tool} の起動を確認できません。Steam を確認し、もう一度起動してください。", close_failed: "通常の終了を要求できませんでした。{tool} のウィンドウかトレイから終了してください。", close_timeout: "{tool} はまだ実行中です。自身のウィンドウかトレイから終了してください。他のソフトは維持されます。" },
    cancelWait: "待機をやめる", cancelHint: "VUA の待機のみを停止します。Steam のダウンロードや起動は続きます。", existing: "この {tool} は元から実行中でした。自身のウィンドウかトレイから終了してください。",
  },
  ko: {
    install: "Steam에서 설치", openApp: "{tool} 열기", running: "실행 중", closeApp: "닫기",
    unknown: "{tool}를 확인하지 못했습니다. 다시 시도할 수 있어요.", checking: "{tool} 확인 중…",
    waitInstall: "Steam 설치 대기 중", waitClose: "종료 중…", waitOpen: "시작 중…",
    recheck: "다시 확인",
    steamMissing: "이 {tool} 버전은 Steam에서 설치하고 실행합니다.", prepareSteam: "Steam 준비",
    presence: { installed: "Steam 설치 확인됨", missing: "Steam에 {tool}가 설치되지 않았어요", incomplete: "Steam의 {tool} 설치가 끝나지 않았어요", unknown: "Steam 설치 정보를 읽지 못했어요" },
    issues: { steam_missing: "먼저 Steam을 준비해 주세요.", not_installed: "Steam에서 {tool} 설치를 마친 뒤 다시 확인해 주세요.", handoff_failed: "Steam을 열지 못했어요. 직접 열고 다시 시도해 주세요.", start_timeout: "{tool} 실행을 아직 확인하지 못했어요. Steam을 확인하고 다시 열어 주세요.", close_failed: "일반 종료를 요청하지 못했어요. {tool} 창이나 트레이에서 종료해 주세요.", close_timeout: "{tool}가 아직 실행 중이에요. 자체 창이나 트레이에서 종료해 주세요. 다른 소프트웨어는 유지됩니다." },
    cancelWait: "대기 중단", cancelHint: "VUA의 대기만 중단합니다. Steam의 다운로드와 실행은 계속됩니다.", existing: "이 {tool}는 원래 실행 중이었어요. 자체 창이나 트레이에서 종료해 주세요.",
  },
};
