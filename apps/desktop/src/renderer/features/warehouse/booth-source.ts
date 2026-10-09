/** Convert user input into a product identity; the existing reader owns its URL. */
export function boothSourceId(input: string): string | null {
  const raw = input.trim();
  if (/^[0-9]+$/.test(raw)) return `booth:${raw}`;
  if (/^booth:[0-9]+$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || !(url.hostname === 'booth.pm' || url.hostname.endsWith('.booth.pm'))) return null;
    const match = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?items\/([0-9]+)\/?$/i.exec(url.pathname);
    return match?.[1] ? `booth:${match[1]}` : null;
  } catch { return null; }
}
