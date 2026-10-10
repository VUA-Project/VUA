const en = {
  assets: "Browse assets", wiki: "Official VRChat Wiki", shortcuts: "Website shortcuts",
  loading: "Loading website…", failed: "This website could not be loaded. Try again or choose another website.",
  unavailable: "The built-in browser is unavailable. Please reopen VUA.",
  retry: "Try again", reopen: "Open BOOTH",
};
type Copy = { [K in keyof typeof en]: string };
export const browserCopy: Record<"en" | "zh-CN" | "ja" | "ko", Copy> = {
  en,
  "zh-CN": {
    assets: "素材浏览", wiki: "VRChat 官方 Wiki", shortcuts: "网站快捷方式",
    loading: "正在加载网页…", failed: "这个网站没能打开。可以重试，或换一个网站。",
    unavailable: "内嵌浏览器暂时不可用，请重新打开 VUA。",
    retry: "重试", reopen: "打开 BOOTH",
  },
  ja: {
    assets: "素材を探す", wiki: "VRChat 公式 Wiki", shortcuts: "サイトのショートカット",
    loading: "サイトを読み込み中…", failed: "サイトを読み込めませんでした。再試行するか、別のサイトを選んでください。",
    unavailable: "内蔵ブラウザーを利用できません。VUA を開き直してください。",
    retry: "再試行", reopen: "BOOTH を開く",
  },
  ko: {
    assets: "에셋 둘러보기", wiki: "VRChat 공식 Wiki", shortcuts: "웹사이트 바로가기",
    loading: "웹사이트 불러오는 중…", failed: "웹사이트를 열지 못했습니다. 다시 시도하거나 다른 웹사이트를 선택하세요.",
    unavailable: "내장 브라우저를 사용할 수 없습니다. VUA를 다시 열어 주세요.",
    retry: "다시 시도", reopen: "BOOTH 열기",
  },
};
