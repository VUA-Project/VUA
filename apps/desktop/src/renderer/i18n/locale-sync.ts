import { storageKeys } from "../app/storage-keys.ts";
import { resolveInitialLocale, type LocaleId } from "./locales.ts";
import { systemLanguages } from "./system-languages.ts";

export function localeChangeRequiresReload(key: string | null, stored: string | null, current: LocaleId, system: readonly string[]): boolean {
  return (key === storageKeys.locale || key === null) && resolveInitialLocale(stored, system) !== current;
}

/** All local surfaces choose their table once; reload only when another window changes that choice. */
export function installLocaleSync(current: LocaleId): () => void {
  const listener = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage) return;
    if (localeChangeRequiresReload(event.key, event.newValue, current, systemLanguages())) window.location.reload();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
