/** A material's own page: its pictures stay in view beside what it is, what can be done with it, its terms and its files. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@vua/design-system";
import { libraryBrowser } from "../../app/library-browser-instance.ts";
import { openExternalUrl } from "../../app/open-external.ts";
import { useDebugMode } from "../../app/debug-mode.ts";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { useSwapFade } from "../../components/primitives/motion.ts";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import type { CatalogProductDetail, LibraryCardFacts, LibraryFileInventory } from "../../gateway/index.ts";
import { format, formatDateTime, strings } from "../../i18n/index.ts";
import { libraryViewCopy } from "../../i18n/library-view-copy.ts";
import { boothCategoryLabel } from "../../i18n/booth-category-copy.ts";
import { shownVariant } from "./library-view-model.ts";
import { priceLabel, readableDescription, sizeLabel, videoLink } from "./library-text.ts";
import { ProductTerms } from "./ProductTerms.tsx";
import { GlbInspectionSection } from "./GlbInspectionSection.tsx";
import { DetailAlbum } from "./WarehouseAlbum.tsx";

const copy = strings.warehouse;
const view = libraryViewCopy.detail;

/** The title row: the way back, and the neighbouring cards of the current page. */
export function LibraryDetailBar({ title, index, total, onBack, onPrevious, onNext }: {
  title: string; index: number; total: number; onBack: () => void; onPrevious: (() => void) | null; onNext: (() => void) | null;
}) {
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { back.current?.focus({ preventScroll: true }); }, []);
  return <header className="vua-page__hero vua-warehouse-detail__bar">
    <h1 className="vua-title"><button ref={back} type="button" className="vua-warehouse-detail__back" data-nav-id="warehouse-detail-back" aria-label={view.back} title={view.back} onClick={onBack}><Icon name="arrow-left" size={20} />{title}</button></h1>
    {total > 1 && index >= 0 ? <div className="vua-warehouse-detail__pager">
      <span className="vua-caption vua-text-secondary" aria-live="polite">{format(view.position, { index: index + 1, total })}</span>
      <Button variant="subtle" aria-label={view.previous} title={view.previous} data-nav-id="warehouse-detail-previous" disabled={onPrevious === null} onClick={() => onPrevious?.()}><Icon name="arrow-left" size={16} /></Button>
      <Button variant="subtle" aria-label={view.next} title={view.next} data-nav-id="warehouse-detail-next" disabled={onNext === null} onClick={() => onNext?.()}><Icon name="arrow-right" size={16} /></Button>
    </div> : null}
  </header>;
}

export function LibraryDetailLayout({ itemKey, media, title, meta, badges, actions, facts, children }: {
  itemKey: string; media: ReactNode; title: string; meta?: ReactNode; badges?: ReactNode; actions?: ReactNode; facts?: readonly (readonly [string, ReactNode])[]; children?: ReactNode;
}) {
  const main = useRef<HTMLDivElement>(null);
  useSwapFade(itemKey, main);
  // Each card starts at its own top.
  useEffect(() => { main.current?.closest(".vua-warehouse-detail")?.scrollTo({ top: 0 }); }, [itemKey]);
  const shown = facts?.filter(([, value]) => value !== null && value !== undefined && value !== "") ?? [];
  return <div className="vua-warehouse-detail" aria-label={copy.detail.panelAria} role="region" data-nav-id="warehouse-detail">
    <div className="vua-warehouse-detail__media">{media}</div>
    <div ref={main} className="vua-warehouse-detail__main">
      <div className="vua-warehouse-detail__head">
        <h2 className="vua-warehouse-detail__title">{title}</h2>
        {meta ? <p className="vua-warehouse-detail__meta">{meta}</p> : null}
        {badges ? <div className="vua-warehouse-detail__badges">{badges}</div> : null}
      </div>
      {actions ? <div className="vua-warehouse-detail__actions">{actions}</div> : null}
      {shown.length > 0 ? <dl className="vua-warehouse-detail__facts">{shown.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl> : null}
      {children}
    </div>
  </div>;
}

export function LibraryDetailLoading({ title }: { title: string }) {
  return <LibraryDetailLayout itemKey="loading" title={title} media={<Skeleton width="100%" height="auto" className="vua-warehouse-card__skeleton-media" />}>
    <Skeleton width="50%" height={14} />
    <Skeleton width="100%" height={60} />
  </LibraryDetailLayout>;
}

/** Facts every kind of card can state. */
export function sharedFacts(facts: LibraryCardFacts | undefined): readonly (readonly [string, ReactNode])[] {
  const sources = [...(facts?.sources ?? []).map(source => view.sources[source]), ...((facts?.localEntries?.length ?? 0) > 0 ? [view.sources.imported] : [])];
  const size = facts?.sizeBytes ?? 0;
  return [
    [view.source, [...new Set(sources)].join(" · ")],
    [view.category, facts?.sourceCategory ? boothCategoryLabel(facts.sourceCategory) : null],
    [view.purchased, facts?.purchasedAt ? formatDateTime(facts.purchasedAt) : null],
    [view.size, size > 0 ? sizeLabel(size) : null],
  ];
}

function ProductFiles({ productId, revision, onManage }: { productId: string; revision: number; onManage: () => void }) {
  const [files, setFiles] = useState<LibraryFileInventory | "loading" | "failed">("loading");
  useEffect(() => {
    let active = true;
    void libraryBrowser.productFiles(productId).then(value => { if (active) setFiles(value); }, () => { if (active) setFiles("failed"); });
    return () => { active = false; };
  }, [productId, revision]);
  const state = (file: LibraryFileInventory["items"][number]) => {
    const presence = file.copies.find(item => item.copyId === file.managedCopyId)?.presence ?? file.copies[0]?.presence;
    return presence ?? "cloud";
  };
  return <section className="vua-warehouse-detail__section">
    <div className="vua-warehouse-detail__section-head">
      <h3>{view.files}</h3>
      <Button variant="subtle" data-nav-id="warehouse-manage-files" onClick={onManage}>{view.manage}</Button>
    </div>
    {files === "loading" ? <Skeleton width="100%" height={32} />
      : files === "failed" || files.items.length === 0 ? <p className="vua-caption vua-text-secondary">{view.filesEmpty}</p>
      : <ul className="vua-warehouse-detail__files">{files.items.map(file => <li key={file.downloadableId} data-state={state(file)}>
        <Icon name="file" size={16} /><span title={file.fileName}>{file.fileName}</span><small>{view.fileStates[state(file)]}</small>
      </li>)}</ul>}
  </section>;
}

const LONG_DESCRIPTION = 480;
function Description({ text: recorded }: { text: string }) {
  const [all, setAll] = useState(false);
  const text = readableDescription(recorded);
  const long = text.length > LONG_DESCRIPTION;
  const [copied, setCopied] = useState(false);
  const copyText = () => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }, () => {}); };
  return <section className="vua-warehouse-detail__section">
    <div className="vua-warehouse-detail__section-head">
      <h3>{copy.detail.descriptionTitle}</h3>
      <Button variant="subtle" data-nav-id="warehouse-copy-description" onClick={copyText}>{copied ? view.copied : view.copyDescription}</Button>
    </div>
    <p className="vua-warehouse-detail__description" data-clamped={long && !all ? true : undefined}>{text}</p>
    {long ? <div><Button variant="subtle" className="vua-warehouse-detail__more" onClick={() => setAll(value => !value)}>{all ? view.showLess : view.showAll}</Button></div> : null}
  </section>;
}

export function ProductDetail({ product, facts, title, badges, actions, filesRevision, onManageFiles, onTermsUpdated, onEnriched }: {
  product: CatalogProductDetail; facts: LibraryCardFacts | undefined; title: string; badges: ReactNode; actions: ReactNode; filesRevision: number;
  onManageFiles: () => void; onTermsUpdated: () => void; onEnriched?: () => void;
}) {
  const debugMode = useDebugMode();
  const [openVideoFailed, setOpenVideoFailed] = useState(false);
  // One request per opened product. Reuse its promise across effect re-runs, while discarding
  // results after this page closes or switches products.
  const enrichmentRequest = useRef<Promise<boolean> | null>(null);
  const onEnrichedRef = useRef(onEnriched);
  onEnrichedRef.current = onEnriched;
  useEffect(() => {
    const unenriched = product.sourceCategory === null || product.description === null && product.variations.length === 0;
    if (!unenriched) return;
    const face = window.vua?.catalogSync;
    if (face === undefined || !("fetchProduct" in face)) return;
    enrichmentRequest.current ??= face.fetchProduct(product.productId).then(result => result.ok).catch(() => false);
    let active = true;
    void enrichmentRequest.current.then(ok => { if (active && ok) onEnrichedRef.current?.(); });
    return () => { active = false; };
  }, [product.productId, product.sourceCategory, product.description, product.variations.length]);
  const images = product.media.imageUrls.length > 0 ? product.media.imageUrls : product.imageUrl !== null ? [product.imageUrl] : [];
  const shop = product.attribution?.shopName ?? null;
  const creator = product.attribution?.creatorName ?? null;
  const price = priceLabel({ price: product.price, priceHigh: product.price?.high });
  const metaLine = [shop, creator !== shop ? creator : null, shownVariant(product.title, product.variantName), price].filter((part): part is string => part !== null && part !== "").join(" · ");
  const published = product.sourcePublishedAt ?? facts?.publishedAt ?? null;
  const factRows: readonly (readonly [string, ReactNode])[] = [
    ...sharedFacts(facts).map(([name, value]) => name === view.category ? [name, value ?? (product.sourceCategory ? boothCategoryLabel(product.sourceCategory) : null)] as const : [name, value] as const),
    [view.published, published ? formatDateTime(published) : null],
    [view.variants, product.variations.length > 1 ? String(product.variations.length) : null],
  ];
  return <LibraryDetailLayout itemKey={product.productId} title={title} media={<DetailAlbum key={product.productId} imageUrls={images} title={title} />} meta={metaLine} actions={actions} facts={factRows}
    badges={<>
      {product.availability !== "available" && product.availability !== "unknown" ? <Badge tone="neutral">{copy.availability[product.availability]}</Badge> : null}
      {product.adult ? <Badge tone="neutral">{copy.detail.adultBadge}</Badge> : null}
      {badges}
    </>}>
    {product.availability === "deleted" ? <p className="vua-caption vua-text-secondary">{copy.detail.tombstoneNote}</p> : null}
    {product.ageRestriction !== null ? <p className="vua-caption vua-text-secondary">{format(copy.detail.ageRestrictionNote, { value: product.ageRestriction })}</p> : null}

    <ProductTerms productId={product.productId} title={title} onUpdated={onTermsUpdated} />
    <GlbInspectionSection target={{ productId: product.productId }} revision={filesRevision} />
    <ProductFiles productId={product.productId} revision={filesRevision} onManage={onManageFiles} />

    {product.subproducts.length > 1 ? <section className="vua-warehouse-detail__section">
      <h3>{copy.detail.subproductsTitle}</h3>
      <ul className="vua-warehouse-detail__subproducts">{product.subproducts.map((subproduct, index) => <li key={subproduct.variationId ?? index}>
        {/* An unnamed variation takes the product's title; a BOOTH ID is internal. */}
        <span>{subproduct.name ?? product.title ?? copy.detail.subproductUnnamed}</span>
        <span className="vua-caption vua-text-secondary">{priceLabel(subproduct)}</span>
        {product.variantName !== null && subproduct.name !== null && subproduct.name === product.variantName ? <Badge tone="success">{copy.detail.variantPurchasedBadge}</Badge> : null}
        {subproduct.availability !== "available" && subproduct.availability !== "unknown" ? <Badge tone="neutral">{copy.availability[subproduct.availability]}</Badge> : null}
      </li>)}</ul>
    </section> : null}

    {product.media.videoUrls.length > 0 ? <section className="vua-warehouse-detail__section">
      <h3>{copy.detail.videosTitle}</h3>
      <ul className="vua-warehouse-detail__videos">{product.media.videoUrls.map(url => {
        const video = videoLink(url);
        return <li key={url}>
          <button type="button" className="vua-terms__link" title={video.href} onClick={() => { setOpenVideoFailed(false); void openExternalUrl(video.href).then(ok => { if (!ok) setOpenVideoFailed(true); }); }}>{format(view.watchOn, { site: video.site })}</button>
        </li>;
      })}</ul>
      {openVideoFailed ? <p className="vua-caption vua-text-secondary">{copy.detail.openVideoFailed}</p> : null}
    </section> : null}

    {product.entities.length > 0 ? <section className="vua-warehouse-detail__section">
      <h3>{copy.detail.entitiesTitle}</h3>
      <ul className="vua-warehouse-detail__entities">{product.entities.map(entity => <li key={entity.entityId}>
        <span>{entity.canonicalName ?? entity.entityId}</span>
        {entity.relations.length > 0 ? <span className="vua-warehouse-detail__relations">{entity.relations.map(relation => <Badge key={`${relation.kind}:${relation.objectEntityId}`} tone="neutral" title={relation.objectEntityId}>
          {relation.objectName !== null ? `${copy.relationKind[relation.kind]}: ${relation.objectName}` : copy.relationKind[relation.kind]}
        </Badge>)}</span> : null}
      </li>)}</ul>
    </section> : null}

    {product.terms.length > 0 ? <section className="vua-warehouse-detail__section">
      <h3>{copy.detail.termsTitle}</h3>
      <div className="vua-warehouse-detail__badges">{product.terms.map(term => <Badge key={term.termKey} tone="neutral">{term.label ?? term.termKey}</Badge>)}</div>
    </section> : null}

    {product.description !== null ? <Description text={product.description} /> : null}

    {debugMode ? <section className="vua-warehouse-detail__section">
      <h3>{copy.detail.debugTitle}</h3>
      <pre className="vua-warehouse-detail__debug">{JSON.stringify(product, null, 2)}</pre>
    </section> : null}
  </LibraryDetailLayout>;
}
