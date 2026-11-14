// Synthetic VN3 terms for the library drawer preview; the values and wording are made up for layout review.
import type { ProductTermsV01, TermItem, TermsPresetId, TermsUseDecision } from "@vua/contracts";
import type { TermsPort } from "../../src/renderer/gateway/index.ts";

const item = (letter: string, key: string, value: TermItem["value"], condition: TermItem["condition"] = null): TermItem =>
  ({ item: letter, termKey: `vn3.${letter}.${key}`, value, condition, rawText: "", summaryRawText: null });
const items: TermItem[] = [
  item("A", "personal_use", "permitted"), item("B", "corporate_use", "contact_licensor"), item("C", "social_platform_upload", "permitted"),
  item("D", "gaming_platform_upload", "permitted"), item("E", "third_party_use", "prohibited"), item("F", "sexual_expression", "permitted", "content_rating_required"),
  item("G", "violence", "permitted"), item("H", "political_religious_use", "prohibited"), item("I", "adjustment", "permitted"),
  item("J", "modification", "permitted"), item("K", "modify_other_data", "permitted"), item("L", "outsource_modification", "permitted"),
  item("M", "redistribution", "prohibited"), item("N", "modified_distribution", "prohibited", "private_use_exception"),
  item("O", "video_streaming", "permitted", "commercial_and_non_profit"), item("P", "publication", "permitted", "non_profit_only"),
  item("Q", "merchandise", "contact_licensor"), item("R", "software_integration", "contact_licensor"), item("S", "mesh_weight_derivative", "permitted"),
  item("T", "independent_derivative", "permitted"), item("U", "fan_works", "permitted"), item("V", "credit", "permitted", "credit_preferred"),
  item("W", "rights_assignment", "prohibited"), item("X", "special_note", "unknown"),
];
const note = { productId: "booth:1", sourceId: "drive-1", language: "en" as const,
  text: "Sample special note for the preview.\nAsk the creator before using this model in paid events with more than 100 visitors." };
const source = (status: "parsed" | "link_only"): ProductTermsV01["sources"][number] => status === "parsed"
  ? { sourceId: "drive-1", sourceKind: "drive", sourceUrl: "https://drive.google.com/file/d/sample/view", googleFileId: "sample", status, fetchedAt: "2026-10-19T03:40:00Z", problem: null,
    document: { sha256: "a".repeat(64), parserVersion: "vn3-parser/1", status, generatorVersion: "1.11", vn3Version: "1.10", language: "en", contentTitle: "Sample Avatar",
      licensor: "Sample Studio", creditNotation: null, hashtags: [], agreementVersion: null, specialNote: note.text, warnings: [], items } }
  : { sourceId: "link-1", sourceKind: "link", sourceUrl: "https://example.com/sample-avatar/terms", googleFileId: null, status, fetchedAt: null, problem: null, document: null };
function product(view: string): ProductTermsV01 {
  const base = { schemaVersion: "0.1" as const, productId: "booth:1", captureProblem: null, warnings: [], effectiveLanguage: null, effectiveItems: [] as TermItem[], hasSpecialNote: false, specialNotes: [] as typeof note[] };
  if (view === "terms-unread") return { ...base, state: "not_observed", observedAt: null, sources: [] };
  if (view === "terms-link") return { ...base, state: "link_only", observedAt: "2026-10-19T03:40:00Z", sources: [source("link_only")] };
  return { ...base, state: "parsed", observedAt: "2026-10-19T03:40:00Z", sources: [source("parsed")], effectiveLanguage: "en", effectiveItems: items, hasSpecialNote: true, specialNotes: [note] };
}
const decision = (value: TermsUseDecision["decision"], conditions: TermsUseDecision["conditions"] = []): TermsUseDecision =>
  ({ decision: value, blockingItems: [], conditions, advisories: [], hasSpecialNote: true, specialNotes: [note] });
const uses: Record<TermsPresetId, TermsUseDecision> = {
  vrchat_personal: decision("conforms"), vtuber_individual: decision("conforms", [{ productId: "booth:1", item: "O", condition: "commercial_and_non_profit" }]),
  vtuber_corporate: decision("contact_licensor"), game_development: decision("contact_licensor"), outfit_for_sale: decision("conforms"),
  merchandise_publication: decision("contact_licensor"), adult_content: decision("conforms", [{ productId: "booth:1", item: "F", condition: "content_rating_required" }]),
};
export function termsPreviewPort(view: string): TermsPort {
  return {
    product: async () => product(view),
    checkUse: async (presetId, productIds) => {
      // A second product whose terms were never read: it never passes.
      const products = productIds.map(productId => productId === "booth:1" ? { productId, sourceState: "parsed" as const, ...uses[presetId] }
        : { productId, sourceState: "not_observed" as const, ...decision("unknown"), hasSpecialNote: false, specialNotes: [],
          blockingItems: [{ productId, item: null, termKey: null, reason: "not_observed" }] });
      const rank = { conforms: 0, contact_licensor: 1, unknown: 2, nonconforming: 3 } as const;
      const worst = products.reduce((a, b) => rank[b.decision] > rank[a.decision] ? b : a);
      return { schemaVersion: "0.1", presetId, products, matchingProductIds: products.filter(p => p.decision === "conforms").map(p => p.productId),
        combination: { decision: worst.decision, blockingItems: products.flatMap(p => p.blockingItems), conditions: products.flatMap(p => p.conditions),
          advisories: products.flatMap(p => p.advisories), hasSpecialNote: products.some(p => p.hasSpecialNote), specialNotes: products.flatMap(p => p.specialNotes) } };
    },
    refreshProduct: async () => ({ taskId: "task-terms" }),
  };
}
