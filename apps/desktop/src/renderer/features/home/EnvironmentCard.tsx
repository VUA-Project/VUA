import type { ReactNode } from "react";
import type { IconName } from "@vua/design-system";
import { strings, format } from "../../i18n/index.ts";
import { RouteGlyph } from "../../components/RouteTile.tsx";
import type { VrBrand } from "../../components/vr-brand-glyphs.ts";
export type EnvironmentAction = "prepare" | "start" | "stop" | "busy" | "attention" | "unknown";
export function ActionGlyph({ action, spinning = false }: { action: EnvironmentAction; spinning?: boolean }) {
  return <svg className={spinning ? "vua-environment-card__spin" : undefined} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {spinning ? <path d="M27 16a11 11 0 1 1-8-10.6" /> : action === "start" ? <path d="m12 7 14 9-14 9Z" fill="currentColor" stroke="none" /> : action === "stop" ? <path d="m9 9 14 14M23 9 9 23" /> : action === "prepare" ? <path d="M16 6v20M6 16h20" /> : action === "attention" || action === "unknown" ? <><path d="m16 4 13 23H3Z" /><path d="M16 12v7M16 23v.1" /></> : <path d="M27 16a11 11 0 1 1-8-10.6" />}
  </svg>;
}
/** Two sibling buttons; neither half is nested inside the other control. */
export function EnvironmentCard({ title, titleContent, kind, brand, icon, id, action, status, selected, onDetails, onAction, disabled, spinning, warning, developing, children }: {
  title: string; titleContent?: ReactNode; kind?: "screen" | "unity" | undefined; brand?: VrBrand | undefined; icon?: IconName; id: string; action: EnvironmentAction; status: string;
  selected?: boolean; onDetails?: () => void; onAction?: () => void; disabled?: boolean; spinning?: boolean; warning?: boolean; developing?: boolean; children?: ReactNode;
}) {
  const copy = strings.environmentCards;
  const label = action === "prepare" ? copy.prepare : action === "start" ? copy.start : action === "stop" ? copy.stop : copy.details;
  return <article className="vua-environment-card" data-card={id} data-action={action} data-selected={selected}>
    {developing ? <span className="vua-route-tile__tag">{strings.journey.developing}</span> : null}
    <button type="button" className="vua-environment-card__details" data-nav-id={id} disabled={!onDetails} aria-label={format(copy.details, { name: title })} aria-expanded={!!selected} aria-controls={`${id}-details`} onClick={onDetails}>
      <RouteGlyph kind={kind} brand={brand} icon={icon} /><strong>{titleContent ?? title}</strong>{children}
    </button>
    <button type="button" className="vua-environment-card__action" data-nav-id={`${id}-action`} disabled={disabled || developing} aria-label={format(label, { name: title })} aria-busy={spinning} onClick={onAction}>
      {developing ? <span aria-hidden="true">—</span> : <><ActionGlyph action={action} spinning={!!spinning} />{warning && action === "stop" ? <span className="vua-environment-card__warning"><ActionGlyph action="attention" /></span> : null}<span role="status">{status}</span></>}
    </button>
  </article>;
}
