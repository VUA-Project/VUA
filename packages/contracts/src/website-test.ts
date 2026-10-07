/** User-triggered website header tests. Separate from the legacy regional report. */
export interface WebsiteObservation {
  readonly url: string;
  readonly status: "reachable" | "http_error" | "redirected" | "timeout" | "connection_failed" | "probe_error";
  readonly elapsedMs: number;
  readonly httpStatus: number | null;
}
export interface WebsiteTestParams { readonly urls: readonly string[] }
export interface WebsiteTestResult { readonly websiteTests: readonly WebsiteObservation[] }
export const WEBSITE_TEST_LIMIT = 12;

/** Only credential-free HTTPS destinations; no commands, browser sessions or headers. */
export function isWebsiteTestUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password
      && !url.hash && (!url.port || url.port === "443");
  } catch { return false; }
}
export function isWebsiteTestParams(value: unknown): value is WebsiteTestParams {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || !("urls" in value)) return false;
  const urls = value.urls;
  return Array.isArray(urls) && urls.length > 0 && urls.length <= WEBSITE_TEST_LIMIT
    && urls.every(isWebsiteTestUrl) && new Set(urls).size === urls.length;
}
export function isWebsiteTestResult(value: unknown): value is WebsiteTestResult {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || !("websiteTests" in value)) return false;
  const rows = value.websiteTests;
  return Array.isArray(rows) && rows.length > 0 && rows.length <= WEBSITE_TEST_LIMIT && rows.every(row => {
    if (!row || typeof row !== "object" || Object.keys(row).length !== 4 || !isWebsiteTestUrl(row.url)
      || !Number.isSafeInteger(row.elapsedMs) || row.elapsedMs < 0) return false;
    if (row.status === "reachable") return Number.isInteger(row.httpStatus) && row.httpStatus >= 200 && row.httpStatus < 300;
    if (row.status === "redirected") return Number.isInteger(row.httpStatus) && row.httpStatus >= 300 && row.httpStatus < 400;
    if (row.status === "http_error") return Number.isInteger(row.httpStatus) && row.httpStatus >= 400 && row.httpStatus < 600;
    return ["timeout", "connection_failed", "probe_error"].includes(row.status) && row.httpStatus === null;
  });
}
