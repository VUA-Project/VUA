/** Native OS preferences are authoritative; Chromium is the browser-preview fallback. */
export function systemLanguages(): readonly string[] {
  const native = typeof window !== "undefined" ? window.vua?.startup?.systemLanguages : undefined;
  if (native !== undefined) return native;
  if (typeof navigator === "undefined") return [];
  return navigator.languages ?? (navigator.language ? [navigator.language] : []);
}
