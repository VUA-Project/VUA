import { isAmfSharedRecipe, type AmfSharedRecipe } from "./amf-recipe-v05.js";

export const SHARE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const SHARE_MAX_BYTES = 65536;
export interface ShareImageOptions {
  readonly runId: string;
  readonly format: "png" | "gif";
  readonly frameIndex: number;
  readonly document?: AmfSharedRecipe;
  readonly recipeId?: string;
  readonly publicConfirmed?: boolean;
}
export interface ShareImageSaved { readonly saved: boolean; readonly code: string | null; readonly url: string | null }
export interface PublishedRecipeLink { readonly code: string; readonly url: string; readonly recipeId: string; readonly publishedAt: string }
export interface ReceivedRecipeLink { readonly document: AmfSharedRecipe; readonly text: string; readonly code: string | null; readonly preview: string | null }
export type PendingRecipeShare = { readonly input: string } | { readonly received: ReceivedRecipeLink } | { readonly error: string };
export interface DesktopRecipeSharingV01 {
  exportImage(options: ShareImageOptions): Promise<ShareImageSaved>;
  readInput(text: string): Promise<ReceivedRecipeLink>;
  readImage(files: readonly File[]): Promise<ReceivedRecipeLink>;
  list(recipeId?: string): Promise<readonly PublishedRecipeLink[]>;
  withdraw(code: string): Promise<void>;
  hasPending(): Promise<boolean>;
  takePending(): Promise<PendingRecipeShare | null>;
  subscribe(listener: () => void): () => void;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9-]{1,100}$/u.test(value);
export function normalizeShareCode(value: string): string | null {
  if (!/^[A-Za-z0-9]{12}$/u.test(value)) return null;
  const upper = value.toUpperCase();
  return [...upper].every(char => SHARE_CODE_ALPHABET.includes(char)) ? upper : null;
}
export function shareCodeFromLink(text: string, origin: string): string | null {
  try {
    const url = new URL(text);
    if (url.username || url.password || url.search || url.hash) return null;
    const protocol = /^vua:\/\/share\/[A-Za-z0-9]{12}$/iu.test(text) && url.protocol === "vua:" && url.hostname.toLowerCase() === "share" && !url.port;
    if (!protocol && (url.protocol !== "https:" || url.origin !== new URL(origin).origin)) return null;
    const match = (protocol ? /^\/([^/]+)$/u : /^\/r\/([^/]+)$/iu).exec(url.pathname);
    return match ? normalizeShareCode(match[1]!) : null;
  } catch { return null; }
}

export function isShareImageOptions(value: unknown): value is ShareImageOptions {
  if (!record(value) || Object.keys(value).some(key => !["runId","format","frameIndex","document","recipeId","publicConfirmed"].includes(key))
    || !id(value.runId) || (typeof value.format !== "string" || !["png","gif"].includes(value.format)) || !Number.isInteger(value.frameIndex)
    || (value.frameIndex as number) < 0 || (value.frameIndex as number) > 59) return false;
  if (value.document === undefined) return value.recipeId === undefined && (value.publicConfirmed === undefined || value.publicConfirmed === false);
  return isAmfSharedRecipe(value.document) && id(value.recipeId) && value.publicConfirmed === true;
}
export function isShareImageSaved(value: unknown): value is ShareImageSaved {
  if (!record(value) || Object.keys(value).length !== 3 || typeof value.saved !== "boolean") return false;
  if (value.code === null) return value.url === null;
  return value.saved && typeof value.code === "string" && normalizeShareCode(value.code) === value.code && typeof value.url === "string" && /^https:\/\//u.test(value.url) && value.url.endsWith(`/r/${value.code}`);
}
export function isReceivedRecipeLink(value: unknown): value is ReceivedRecipeLink {
  return record(value) && Object.keys(value).length === 4 && isAmfSharedRecipe(value.document)
    && typeof value.text === "string" && value.text.length <= 349557
    && (value.code === null || (typeof value.code === "string" && normalizeShareCode(value.code) === value.code))
    && (value.preview === null || (typeof value.preview === "string" && value.preview.length <= 2 * 1024 * 1024 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(value.preview)));
}
export function isPublishedRecipeLink(value: unknown): value is PublishedRecipeLink {
  try { return record(value) && Object.keys(value).length === 4 && typeof value.code === "string" && normalizeShareCode(value.code) === value.code
    && typeof value.url === "string" && shareCodeFromLink(value.url, new URL(value.url).origin) === value.code
    && id(value.recipeId) && typeof value.publishedAt === "string" && Number.isFinite(Date.parse(value.publishedAt)); } catch { return false; }
}

/** RFC 8785: emit sorted names directly, retaining ECMAScript number/string serialization. */
export function canonicalShareJson(value: unknown, depth = 1): string {
  if (depth > 32) throw new Error("share_invalid");
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value === "string") {
    if (/[\uD800-\uDFFF]/u.test(value)) throw new Error("share_invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalShareJson(item, depth + 1)).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${canonicalShareJson(key, depth + 1)}:${canonicalShareJson(value[key], depth + 1)}`).join(",")}}`;
  throw new Error("share_invalid");
}

/** JSON.parse supplies syntax validation; this walk also rejects duplicate object names. */
export function parseShareJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/gu) ?? [];
  let index = 0;
  const walk = (depth: number): void => {
    if (depth > 32) throw new Error("share_invalid");
    const token = tokens[index++];
    if (token === "{") {
      const names = new Set<string>();
      while (tokens[index] !== "}") {
        const name = JSON.parse(tokens[index++]!) as string;
        if (names.has(name)) throw new Error("share_invalid");
        names.add(name); index++; walk(depth + 1);
        if (tokens[index] !== ",") break;
        index++;
      }
      index++;
    } else if (token === "[") {
      while (tokens[index] !== "]") { walk(depth + 1); if (tokens[index] !== ",") break; index++; }
      index++;
    }
  };
  walk(1); canonicalShareJson(value);
  return value;
}
