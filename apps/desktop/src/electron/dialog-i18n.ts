/** Local shell copy. IPC accepts a locale identifier, never caller-provided dialog text. */
export const dialogCopy = {
  en: { unityPackage: "Choose material folder", localVpm: "Select a local VPM package folder", warehouse: "Import asset folders", editorExecutable: "Select the Unity editor executable", editorDirectory: "Select the Unity editor folder" },
  "zh-CN": { unityPackage: "选择素材文件夹", localVpm: "选择本地 VPM 包文件夹", warehouse: "导入素材文件夹", editorExecutable: "选择 Unity 编辑器程序", editorDirectory: "选择 Unity 编辑器文件夹" },
  ja: { unityPackage: "素材フォルダを選択", localVpm: "ローカル VPM パッケージのフォルダーを選択", warehouse: "素材フォルダーをインポート", editorExecutable: "Unity エディターの実行ファイルを選択", editorDirectory: "Unity エディターのフォルダーを選択" },
  ko: { unityPackage: "자재 폴더 선택", localVpm: "로컬 VPM 패키지 폴더 선택", warehouse: "에셋 폴더 가져오기", editorExecutable: "Unity 에디터 실행 파일 선택", editorDirectory: "Unity 에디터 폴더 선택" },
} as const;

/** Startup has no renderer-selected locale yet; use the operating-system language. */
export function startupFailureCopy(locale: string): string {
  const language = locale.toLowerCase();
  if (language.startsWith("zh")) return "VUA 未能启动。请重新解压完整的程序压缩包后重试。";
  if (language.startsWith("ja")) return "VUA を起動できませんでした。アプリの ZIP をすべて展開し直して、もう一度お試しください。";
  if (language.startsWith("ko")) return "VUA를 시작하지 못했습니다. 앱 ZIP 파일 전체를 다시 압축 해제한 후 재시도하세요.";
  return "VUA could not start. Extract the complete application ZIP again and retry.";
}

export function dialogStrings(locale: unknown): typeof dialogCopy[keyof typeof dialogCopy] {
  return typeof locale === "string" && Object.hasOwn(dialogCopy, locale)
    ? dialogCopy[locale as keyof typeof dialogCopy]
    : dialogCopy.en;
}
