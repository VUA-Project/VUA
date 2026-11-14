import { currentLocale } from "./current-table.ts";
const en = { read: "Read linked terms",
  reading: "Reading terms…", done: "Finished reading terms and updated filter results.", stopped: "Some terms couldn't be parsed. Open an item's details to see why or retry.", failed: "Couldn't start reading terms. Please try again." };
const tables: Record<string, typeof en> = {
  en,
  "zh-CN": { read: "读取已关联的条款", reading: "正在读取条款…", done: "条款读取完成，用途筛选结果已更新。", stopped: "部分商品的条款未能自动读取，可点进商品详情查看原因并重试。", failed: "未能开始读取条款，请重试。" },
  "zh-TW": { read: "讀取已連結的條款", reading: "正在讀取條款…", done: "條款讀取完成，已更新用途篩選結果。", stopped: "部分條款無法自動讀取，可開啟商品詳情查看原因並重新讀取。", failed: "無法開始讀取條款，請重試。" },
  ja: { read: "紐付け済みの規約を読み取る", reading: "規約を読み取り中…", done: "読み取りが完了し、用途フィルターの判定を更新しました。", stopped: "一部の規約を読み取れませんでした。商品の詳細画面で理由を確認して再試行できます。", failed: "規約の読み取りを開始できませんでした。再試行してください。" },
  ko: { read: "연결된 약관 일괄 읽기", reading: "약관 읽는 중…", done: "약관 읽기를 마치고 용도 필터 결과를 갱신했어요.", stopped: "일부 약관을 읽지 못했어요. 상품 상세 화면에서 이유를 확인하고 다시 시도할 수 있어요.", failed: "약관 읽기를 시작하지 못했어요. 다시 시도해 주세요." },
};
export const libraryTermsCopy = tables[currentLocale] ?? en;
export const libraryTermsTables = tables;
