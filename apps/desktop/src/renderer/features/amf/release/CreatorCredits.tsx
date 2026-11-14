/** Slice 37: Creator credits for a finished Avatar's materials, derived strictly from observed BDL / Warehouse provenance without fabricating shop names. */
import { useEffect, useMemo, useState } from "react";
import { isTermsProductId } from "@vua/contracts";
import { catalogBrowser } from "../../../app/catalog-browser-instance.ts";
import { openExternalUrl } from "../../../app/open-external.ts";
import { toast } from "../../../components/primitives/toast-store.ts";
import type { AmfProductionRun, AmfProductionSource } from "../../../gateway/index.ts";
import { strings } from "../../../i18n/index.ts";
import { boothProductUrl } from "../../warehouse/booth-source.ts";

const copy = strings.releaseRoom.credits;

export interface CreatorProductFact {
  readonly title: string | null;
  readonly shopName: string | null;
}

export interface CreatorCreditItem {
  readonly key: string;
  readonly role: "avatar" | "outfit";
  readonly title: string;
  readonly shopName: string | null;
  readonly productId: string | null;
  readonly boothUrl: string | null;
}

/** Builds deduplicated creator credit items for the base Avatar and outfits; dependencies (shaders/frameworks) are excluded. */
export function buildCreatorCreditItems(
  run: AmfProductionRun,
  sources: readonly AmfProductionSource[],
  facts: ReadonlyMap<string, CreatorProductFact>,
): readonly CreatorCreditItem[] {
  const items: CreatorCreditItem[] = [];
  const seenProducts = new Set<string>();
  const seenLocal = new Set<string>();
  for (const used of run.sources) {
    if (used.role === "dependency") continue;
    const role: "avatar" | "outfit" = used.role === "avatar" ? "avatar" : "outfit";
    const linkedIds = (sources.find(source => source.sourceId === used.sourceId)?.productIds ?? []).filter(isTermsProductId);
    if (linkedIds.length === 0) {
      if (seenLocal.has(used.sourceId)) continue;
      seenLocal.add(used.sourceId);
      items.push({
        key: `local:${used.sourceId}`,
        role,
        title: used.itemName,
        shopName: null,
        productId: null,
        boothUrl: null,
      });
      continue;
    }
    for (const productId of linkedIds) {
      if (seenProducts.has(productId)) continue;
      seenProducts.add(productId);
      const observed = facts.get(productId);
      const rawTitle = observed?.title?.trim() ?? "";
      const rawShop = observed?.shopName?.trim() ?? "";
      items.push({
        key: productId,
        role,
        title: rawTitle !== "" ? rawTitle : used.itemName,
        shopName: rawShop !== "" ? rawShop : null,
        productId,
        boothUrl: boothProductUrl(productId),
      });
    }
  }
  return items;
}

/** Formats clean plain-text attribution lines without fabricating unverified shop names or URLs. */
export function formatCreatorCreditsText(
  items: readonly CreatorCreditItem[],
  labels: { readonly avatarRole: string; readonly outfitRole: string },
): string {
  return items.map(item => {
    const prefix = item.role === "avatar" ? labels.avatarRole : labels.outfitRole;
    const byShop = item.shopName !== null ? ` — ${item.shopName}` : "";
    const urlPart = item.boothUrl !== null ? ` (${item.boothUrl})` : "";
    return `${prefix}: ${item.title}${byShop}${urlPart}`;
  }).join("\n");
}

export function CreatorCredits({ run, sources }: { run: AmfProductionRun; sources: readonly AmfProductionSource[] }) {
  const productIds = useMemo(() => {
    const ids = new Set<string>();
    for (const used of run.sources) {
      if (used.role === "dependency") continue;
      for (const id of sources.find(source => source.sourceId === used.sourceId)?.productIds ?? []) {
        if (isTermsProductId(id)) ids.add(id);
      }
    }
    return [...ids];
  }, [run, sources]);
  const key = productIds.join("|");
  const [facts, setFacts] = useState<ReadonlyMap<string, CreatorProductFact>>(() => new Map());

  useEffect(() => {
    if (key === "") return;
    let alive = true;
    const queue = key.split("|");
    const worker = async () => {
      while (alive && queue.length > 0) {
        const id = queue.shift()!;
        try {
          const detail = await catalogBrowser.detail(id);
          if (alive && detail.kind === "detail") {
            setFacts(current => new Map(current).set(id, {
              title: detail.product.title,
              shopName: detail.product.attribution?.shopName ?? detail.product.attribution?.creatorName ?? null,
            }));
          }
        } catch {
          /* Keep observed material name when catalog detail is unavailable. */
        }
      }
    };
    void Promise.all([worker(), worker()]);
    return () => { alive = false; };
  }, [key]);

  const items = useMemo(() => buildCreatorCreditItems(run, sources, facts), [run, sources, facts]);
  if (items.length === 0) return null;

  const copyCredits = () => {
    const text = formatCreatorCreditsText(items, copy);
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      toast(copy.copied, "success");
    }, () => {});
  };

  return (
    <section className="vua-album__block vua-creator-credits">
      <div className="vua-creator-credits__header">
        <h3>{copy.title}</h3>
        <button type="button" className="vua-album__bake" onClick={copyCredits}>{copy.copy}</button>
      </div>
      <ul className="vua-creator-credits__list">
        {items.map(item => (
          <li key={item.key}>
            <div className="vua-creator-credits__main">
              <span className="vua-creator-credits__role">{item.role === "avatar" ? copy.avatarRole : copy.outfitRole}</span>
              <strong>{item.title}</strong>
            </div>
            <div className="vua-creator-credits__meta">
              <small>
                {item.productId === null
                  ? copy.unlinked
                  : item.shopName !== null
                    ? item.shopName
                    : copy.shopUnknown}
              </small>
              {item.boothUrl !== null && (
                <button type="button" className="vua-release-upload__link" onClick={() => openExternalUrl(item.boothUrl!)}>
                  {copy.openBooth} ↗
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
