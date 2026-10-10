import { Icon, type IconName } from "@vua/design-system";
import { strings } from "../i18n/index.ts";
import { vrBrandGlyphs, type VrBrand } from "./vr-brand-glyphs.ts";
/** Native button semantics are shared by mouse and head-mounted desktop pointing. */
export function RouteTile({ title, icon = "arrow-right", kind, brand, description, disabled, developing, selected, expanded, controls, onClick, id }: {
  title: string; icon?: IconName; kind?: "screen" | "headset" | "unity" | undefined; brand?: VrBrand | undefined;
  description?: string | undefined; disabled?: boolean; developing?: boolean; selected?: boolean; expanded?: boolean; controls?: string; onClick?: () => void; id?: string;
}) {
  return <button type="button" className="vua-route-tile" disabled={disabled} aria-pressed={expanded === undefined ? selected : undefined} aria-expanded={expanded} aria-controls={controls} data-selected={selected} onClick={onClick} data-nav-id={id}>
    {disabled || developing ? <span className="vua-route-tile__tag">{strings.journey.developing}</span> : null}
    <RouteGlyph kind={kind} brand={brand} icon={icon} />
    <strong>{title}</strong>
    {description ? <span className="vua-route-tile__description">{description}</span> : null}
  </button>;
}

export function RouteGlyph({ kind, brand, icon = "arrow-right" }: { kind?: "screen" | "headset" | "unity" | undefined; brand?: VrBrand | undefined; icon?: IconName | undefined }) {
  return <span className="vua-route-tile__icon" data-brand={brand} aria-hidden="true">{brand ? <svg viewBox={vrBrandGlyphs[brand].viewBox} fill="currentColor">
      {vrBrandGlyphs[brand].paths.map((path, index) => <path key={index} d={path} />)}
    </svg> : kind ? <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {kind === "screen" ? <><rect x="5" y="8" width="38" height="25" rx="3" /><path d="M24 33v7M15 40h18" /></> : kind === "headset" ? <><rect x="5" y="14" width="38" height="23" rx="7" /><path d="M12 14V9h24v5M20 26h8M5 23H2m41 0h3" /></> : <path d="m8 31 5-17 20-7 7 23-17 12Zm5-17 10 10 10-17M8 31l15-7 17 6M23 24v18" />}
    </svg> : <Icon name={icon} size={24} />}</span>;
}
