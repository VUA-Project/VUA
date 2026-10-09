const en = {
  title: "Modules", choose: "Choose how to create your Avatar", amf: "{amf}",
  description: "Import assets, save outfits as Recipes, and assemble and check Avatars with Unity.",
  hint: "Enable a module when you need it. Play and device setup work on their own.",
  enable: "Enable {amf}", disable: "Disable {amf}", retry: "Retry startup", open: "Open asset library",
  retained: "Disabling keeps your assets, Recipes and projects. Finish or cancel active tasks first.",
  absent: "Not enabled", starting: "Starting…", ready: "Enabled", failed: "{amf} could not start. Play is still available.", stopping: "Stopping…",
  busy: "{amf} is busy. Finish or cancel its tasks, then try again.", changeFailed: "The change failed. Your data has been kept.",
  wait: "Please wait…", manage: "Manage modules", loading: "Opening {amf}…", developing: "In development",
};
type Copy = { [Key in keyof typeof en]: string };
export const moduleCopy: Record<"en" | "zh-CN" | "ja" | "ko", Copy> = {
  en,
  "zh-CN": {
    title: "功能模块", choose: "想用哪种方式改模？", amf: "{amf}",
    description: "导入和整理素材，用配方保存搭配，再通过 Unity 装配和检查 Avatar。",
    hint: "需要时再启用模块。游玩和设备准备可以单独使用。",
    enable: "启用 {amf}", disable: "停用 {amf}", retry: "重试启动", open: "打开素材库",
    retained: "停用会保留素材、配方和项目。正在进行的任务需要先完成或取消。",
    absent: "尚未启用", starting: "正在启动…", ready: "已启用", failed: "{amf} 启动失败，游玩仍可使用。", stopping: "正在停止…",
    busy: "{amf} 还有任务在进行。完成或取消后，再试一次。", changeFailed: "这次操作没有完成，已有数据已保留。",
    wait: "请稍候…", manage: "管理功能模块", loading: "正在打开 {amf}…", developing: "开发中",
  },
  ja: {
    title: "機能モジュール", choose: "どの方法で Avatar を編集しますか？", amf: "{amf}",
    description: "素材を整理し、コーディネートを Recipe に保存。Unity で Avatar を組み立ててチェックします。",
    hint: "必要なときに有効にできます。プレイとデバイスの準備は単独で使えます。",
    enable: "{amf} を有効にする", disable: "{amf} を無効にする", retry: "起動を再試行", open: "素材ライブラリを開く",
    retained: "無効にしても素材、Recipe、プロジェクトは残ります。実行中のタスクを完了またはキャンセルしてください。",
    absent: "未有効", starting: "起動中…", ready: "有効", failed: "{amf} を起動できませんでした。プレイは利用できます。", stopping: "停止中…",
    busy: "{amf} のタスクが実行中です。完了またはキャンセルしてから再試行してください。", changeFailed: "変更できませんでした。データは保持されています。",
    wait: "お待ちください…", manage: "モジュールを管理", loading: "{amf} を開いています…", developing: "開発中",
  },
  ko: {
    title: "기능 모듈", choose: "어떤 방식으로 Avatar를 편집할까요?", amf: "{amf}",
    description: "에셋을 정리하고 코디를 Recipe로 저장한 다음 Unity에서 Avatar를 조립하고 검사합니다.",
    hint: "필요할 때 모듈을 켜세요. 플레이와 기기 준비는 따로 사용할 수 있습니다.",
    enable: "{amf} 켜기", disable: "{amf} 끄기", retry: "시작 다시 시도", open: "에셋 라이브러리 열기",
    retained: "꺼도 에셋, Recipe와 프로젝트는 유지됩니다. 진행 중인 작업을 먼저 완료하거나 취소하세요.",
    absent: "꺼짐", starting: "시작 중…", ready: "켜짐", failed: "{amf}를 시작하지 못했습니다. 플레이는 계속 사용할 수 있습니다.", stopping: "중지 중…",
    busy: "{amf} 작업이 진행 중입니다. 완료하거나 취소한 뒤 다시 시도하세요.", changeFailed: "변경하지 못했습니다. 기존 데이터는 유지됩니다.",
    wait: "잠시 기다려 주세요…", manage: "모듈 관리", loading: "{amf} 여는 중…", developing: "개발 중",
  },
};
