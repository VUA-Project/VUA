import { isWebsiteTestUrl, WEBSITE_TEST_LIMIT } from "@vua/contracts";
export interface TestWebsite { readonly name: string; readonly url: string }
export const DEFAULT_TEST_WEBSITES: readonly TestWebsite[] = [
  { name: "VRChat", url: "https://vrchat.com/" },
  { name: "Steam", url: "https://store.steampowered.com/" },
  { name: "GitHub", url: "https://github.com/" },
];
/** Store destinations only; measured results expire when the page is closed. */
export function parseTestWebsites(raw: string | null): readonly TestWebsite[] {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!Array.isArray(value) || value.length > WEBSITE_TEST_LIMIT) return DEFAULT_TEST_WEBSITES;
    if (!value.every(row => row && typeof row.name === "string" && row.name.trim().length > 0
      && row.name.length <= 40 && isWebsiteTestUrl(row.url))) return DEFAULT_TEST_WEBSITES;
    if (new Set(value.map(row => row.url)).size !== value.length) return DEFAULT_TEST_WEBSITES;
    return value;
  } catch { return DEFAULT_TEST_WEBSITES; }
}
export function normalizeWebsiteUrl(input: string): string | null {
  try {
    const trimmed = input.trim();
    const value = new URL(trimmed.includes(":") ? trimmed : `https://${trimmed}`).href;
    return isWebsiteTestUrl(value) ? value : null;
  } catch { return null; }
}
