import { guideSearchAliases } from "../../i18n/guide-search-aliases.ts";
import { ENCYCLOPEDIA_TOPIC_IDS, guidePage, type GuideTopicId } from "./guide-content.ts";
import { GUIDE_TARGETS, type GuideTarget } from "./guide-target.ts";

export type GuideArticleKind = "concept" | "procedure" | "reference" | "troubleshooting";
export type GuideReviewStatus = "legacy" | "source-checked";
export interface GuideSourceRef {
  readonly url: string;
  readonly publisher: string;
  readonly kind: "official" | "community" | "project";
  readonly checkedAt?: string;
}
export interface GuideArticle {
  readonly id: string;
  readonly target: GuideTarget;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly kind: GuideArticleKind;
  readonly aliases: readonly string[];
  readonly sourceRefs: readonly GuideSourceRef[];
  readonly reviewStatus: GuideReviewStatus;
  readonly reviewedAt?: string;
}
export type GuideTaskId = "new-player" | "wear-outfit" | "avatar-visibility" | "outfit-problem" | "build-test" | "terminology";
export interface GuideTask {
  readonly id: GuideTaskId;
  readonly target?: GuideTarget;
}
export interface GuideSearchFilter {
  readonly query?: string;
  readonly topic?: GuideTopicId | "all";
  readonly kind?: GuideArticleKind | "all";
}

const firstAvatar: GuideSourceRef = { url: "https://creators.vrchat.com/avatars/creating-your-first-avatar/", publisher: "VRChat Creator documentation", kind: "official", checkedAt: "2026-10-27" };
const performance: GuideSourceRef = { url: "https://creators.vrchat.com/avatars/avatar-performance-ranking-system/", publisher: "VRChat Creator documentation", kind: "official", checkedAt: "2026-10-27" };
const safety: GuideSourceRef = { url: "https://docs.vrchat.com/docs/vrchat-safety-and-trust-system", publisher: "VRChat documentation", kind: "official", checkedAt: "2026-10-27" };
const modularAvatar: GuideSourceRef = { url: "https://modular-avatar.nadena.dev/docs/intro", publisher: "Modular Avatar documentation", kind: "community", checkedAt: "2026-10-27" };
const checked = { reviewStatus: "source-checked", reviewedAt: "2026-10-27" } as const;

const eacHelp: GuideSourceRef = { url: "https://help.vrchat.com/hc/en-us/articles/8135250400915", publisher: "VRChat Help Center", kind: "official", checkedAt: "2026-11-14" };
const eacSecurityBlog: GuideSourceRef = { url: "https://hello.vrchat.com/blog/vrchat-security-update", publisher: "VRChat Blog", kind: "official", checkedAt: "2026-11-14" };
const eacCannyUnload: GuideSourceRef = { url: "https://feedback.vrchat.com/bug-reports/p/eac-failing-to-unload-preventing-starting-vrchat-again", publisher: "VRChat Canny", kind: "official", checkedAt: "2026-11-14" };
const eacCannyKeepRunning: GuideSourceRef = { url: "https://feedback.vrchat.com/bug-reports/p/vrchat-keeps-running-even-after-exiting", publisher: "VRChat Canny", kind: "official", checkedAt: "2026-11-14" };
const eacCanny1275: GuideSourceRef = { url: "https://feedback.vrchat.com/bug-reports/p/vrchat-cannot-start-after-installing-patch-kb5026372-on-windows-11", publisher: "VRChat Canny", kind: "official", checkedAt: "2026-11-14" };
const eacCannySdk1519: GuideSourceRef = { url: "https://feedback.vrchat.com/sdk-bug-reports/p/1519-only-one-instance-of-vrchat-at-a-time-eac-error-when-trying-to-build-and-te", publisher: "VRChat Canny", kind: "official", checkedAt: "2026-11-14" };
const eacSteam30004: GuideSourceRef = { url: "https://steamcommunity.com/app/438100/discussions/5/3473990693213987601/", publisher: "Steam Community", kind: "community", checkedAt: "2026-11-14" };
const eacAskConflict: GuideSourceRef = { url: "https://ask.vrchat.com/t/cannot-run-other-programs-while-vrchat-is-running/23326", publisher: "VRChat Ask Forum", kind: "community", checkedAt: "2026-11-14" };
const eacChecked = { reviewStatus: "source-checked", reviewedAt: "2026-11-14" } as const;

const ARTICLE_META: Record<string, Partial<Pick<GuideArticle, "kind" | "aliases" | "sourceRefs" | "reviewStatus" | "reviewedAt">>> = {
  "guide-start/what-is-vrchat": {
    kind: "concept",
    sourceRefs: [{ url: "https://hello.vrchat.com/", publisher: "VRChat", kind: "official", checkedAt: "2026-10-30" }],
    reviewStatus: "source-checked", reviewedAt: "2026-10-30",
  },
  "guide-start/eac-30005-occupied": { kind: "troubleshooting", sourceRefs: [eacHelp, eacCannyUnload, eacCannyKeepRunning], ...eacChecked },
  "guide-start/eac-not-installed": { kind: "troubleshooting", sourceRefs: [eacHelp, eacSecurityBlog], ...eacChecked },
  "guide-start/eac-1275-driver-blocked": { kind: "troubleshooting", sourceRefs: [eacCanny1275, eacHelp], ...eacChecked },
  "guide-start/eac-untrusted-system-file": { kind: "troubleshooting", sourceRefs: [eacHelp, eacSteam30004, eacAskConflict], ...eacChecked },
  "guide-start/eac-connection-lost": { kind: "troubleshooting", sourceRefs: [eacHelp, eacSecurityBlog], ...eacChecked },
  "guide-start/eac-sdk-multi-instance": { kind: "troubleshooting", sourceRefs: [eacCannySdk1519, eacSecurityBlog], ...eacChecked },
  "guide-creator/upload-eligibility": { kind: "procedure", sourceRefs: [firstAvatar], ...checked },
  "guide-creator/trust-rank": { kind: "concept", sourceRefs: [safety], ...checked },
  "guide-creator/improve-trust": { kind: "procedure", sourceRefs: [safety], ...checked },
  "guide-safety/trust": { kind: "concept", sourceRefs: [safety], ...checked },
  "guide-safety/personal-space": { kind: "procedure", sourceRefs: [safety], ...checked },
  "guide-safety/open-urls": { kind: "procedure", sourceRefs: [safety], ...checked },
  "guide-avatars/change-avatar": { kind: "procedure", sourceRefs: [firstAvatar], ...checked },
  "guide-avatars/visibility": { kind: "troubleshooting", sourceRefs: [firstAvatar, performance, safety], ...checked },
  "guide-avatars/performance": { kind: "concept", sourceRefs: [performance, safety], ...checked },
  "guide-avatars/outfit-assembly": { kind: "concept", sourceRefs: [firstAvatar, modularAvatar], ...checked },
  "guide-avatars/outfit-diagnostics": { kind: "troubleshooting", sourceRefs: [modularAvatar], ...checked },
  "guide-avatars/pink-materials": { kind: "troubleshooting", sourceRefs: [firstAvatar], ...checked },
  "guide-avatars/build-test": { kind: "procedure", sourceRefs: [firstAvatar], ...checked },
  "guide-avatars/platforms": { kind: "reference", sourceRefs: [firstAvatar, performance], ...checked },
};

export function buildGuideCatalog(): GuideArticle[] {
  return ENCYCLOPEDIA_TOPIC_IDS.flatMap(topic => guidePage(topic).sections.map(section => {
    const id = `${topic}/${section.id}`;
    const meta = ARTICLE_META[id];
    return {
      id,
      target: { topic, section: section.id },
      title: section.title,
      summary: section.paragraphs[0] ?? "",
      body: section.paragraphs.join(" "),
      kind: meta?.kind ?? "reference",
      aliases: guideSearchAliases[id] ?? [],
      sourceRefs: meta?.sourceRefs ?? [],
      reviewStatus: meta?.reviewStatus ?? "legacy",
      ...(meta?.reviewedAt === undefined ? {} : { reviewedAt: meta.reviewedAt }),
    };
  }));
}

export const GUIDE_ARTICLES: readonly GuideArticle[] = buildGuideCatalog();

export function guideArticleForTarget(target: GuideTarget): GuideArticle | undefined {
  return GUIDE_ARTICLES.find(article => article.target.topic === target.topic && article.target.section === target.section);
}

export const GUIDE_TASKS: readonly GuideTask[] = [
  { id: "new-player", target: GUIDE_TARGETS.vrchatFirstLaunch },
  { id: "wear-outfit", target: GUIDE_TARGETS.outfitAssembly },
  { id: "avatar-visibility", target: GUIDE_TARGETS.avatarVisibility },
  { id: "outfit-problem", target: GUIDE_TARGETS.outfitDiagnostics },
  { id: "build-test", target: GUIDE_TARGETS.buildTest },
  { id: "terminology" },
];

export function normalizeGuideSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function searchScore(article: GuideArticle, query: string): number {
  const title = normalizeGuideSearch(article.title);
  const aliases = normalizeGuideSearch(article.aliases.join(" "));
  const topic = normalizeGuideSearch(guidePage(article.target.topic).title);
  const body = normalizeGuideSearch(article.body);
  const tokens = query.split(" ");
  if (!tokens.every(token => `${title} ${aliases} ${topic} ${body}`.includes(token))) return -1;
  let score = title === query ? 100 : title.startsWith(query) ? 60 : title.includes(query) ? 40 : 0;
  if (aliases.includes(query)) score += 24;
  if (topic.includes(query)) score += 12;
  if (body.includes(query)) score += 8;
  return score;
}

export function searchGuideArticles(filter: GuideSearchFilter, articles: readonly GuideArticle[] = GUIDE_ARTICLES): GuideArticle[] {
  const query = normalizeGuideSearch(filter.query ?? "");
  return articles
    .filter(article => (filter.topic === undefined || filter.topic === "all" || article.target.topic === filter.topic)
      && (filter.kind === undefined || filter.kind === "all" || article.kind === filter.kind))
    .map(article => ({ article, score: query === "" ? 0 : searchScore(article, query) }))
    .filter(entry => query === "" || entry.score >= 0)
    .sort((left, right) => query === "" ? 0 : right.score - left.score || left.article.id.localeCompare(right.article.id))
    .map(entry => entry.article);
}
