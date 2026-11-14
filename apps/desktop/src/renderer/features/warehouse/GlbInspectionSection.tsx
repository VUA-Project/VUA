import { useEffect, useState } from "react";
import type { GlbInspectionResultV01 } from "@vua/contracts";
import { Icon } from "@vua/design-system";
import { Badge } from "../../components/primitives/Badge.tsx";
import { useGateway } from "../../gateway/index.ts";
import { format, strings } from "../../i18n/index.ts";

const copy = strings.glbInspection;

function formatMeters(value: number): string {
  return value.toFixed(2);
}

export function GlbInspectionSection({
  target,
  revision = 0,
}: {
  readonly target: { readonly productId: string } | { readonly entryId: string };
  readonly revision?: number;
}) {
  const port = useGateway().libraryBrowser;
  const [result, setResult] = useState<GlbInspectionResultV01 | null>(null);
  const key = "productId" in target ? `p:${target.productId}` : `e:${target.entryId}`;

  useEffect(() => {
    setResult(null);
    if (!port?.inspectGlb) return;
    let active = true;
    void port.inspectGlb(target).then(
      (next) => {
        if (active) setResult(next);
      },
      () => {
        if (active) setResult(null);
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- target is keyed by stable productId/entryId
  }, [port, key, revision]);

  if (!port?.inspectGlb || result === null || result.items.length === 0) {
    return null;
  }

  type InspectedItem = GlbInspectionResultV01["items"][number];
  const visibleItems = result.items.slice(0, 2);
  const overflowItems = result.items.slice(2);

  const renderItem = (item: InspectedItem) => (
    <li key={`${item.copyId}:${item.sourceKind}:${item.fileName}`} className="vua-glb-inspection__item">
      <div className="vua-glb-inspection__row">
        <span className="vua-glb-inspection__name" title={item.fileName}>
          <Icon name="file" size={16} />
          <span>{item.fileName}</span>
        </span>
        <span className="vua-glb-inspection__badges">
          {item.sourceKind === "zip_member" && item.containerFileName ? (
            <Badge tone="neutral">
              {format(copy.zipMemberBadge, { archive: item.containerFileName })}
            </Badge>
          ) : null}
          <Badge tone={item.format === "vrm_1_0" ? "success" : item.format === "invalid_glb" ? "warning" : "neutral"}>
            {copy.formats[item.format]}
          </Badge>
        </span>
      </div>
      {item.format !== "invalid_glb" ? (
        <div className="vua-glb-inspection__meta">
          {item.vrm?.modelName ? (
            <span>
              {format(copy.vrmMetaLine, {
                title: item.vrm.modelName,
                spec: item.vrm.specVersion ?? (item.format === "vrm_0_x" ? "0.x" : "1.0"),
              })}
            </span>
          ) : null}
          {item.boundsMeters ? (
            <span>
              {format(copy.dimensions, {
                x: formatMeters(item.boundsMeters.size[0]),
                y: formatMeters(item.boundsMeters.size[1]),
                z: formatMeters(item.boundsMeters.size[2]),
              })}
            </span>
          ) : null}
          {item.contentSummary ? (
            <span>
              {format(copy.geometryLine, {
                tris: item.contentSummary.triangleEstimate.toLocaleString(),
                meshes: item.contentSummary.meshCount,
              })}
            </span>
          ) : null}
          {item.materialSummary && item.materialSummary.mtoonMaterialCount > 0 ? (
            <span>
              {format(copy.mtoonLine, {
                mtoon: item.materialSummary.mtoonMaterialCount,
                total: item.materialSummary.materialCount,
              })}
            </span>
          ) : null}
          {item.textureSummary && item.textureSummary.externalUriTextureCount > 0 ? (
            <span>
              {format(copy.externalTextureWarning, {
                count: item.textureSummary.externalUriTextureCount,
              })}
            </span>
          ) : null}
          {item.secondaryMotion
          && (item.secondaryMotion.springBoneJointCount > 0 || item.secondaryMotion.expressionCount > 0) ? (
            <span>
              {format(copy.secondaryMotionLine, {
                springs: item.secondaryMotion.springBoneJointCount,
                expressions: item.secondaryMotion.expressionCount,
              })}
            </span>
          ) : null}
          {item.vrm ? (
            <span>{format(copy.bonesLine, { bones: item.vrm.boneCount })}</span>
          ) : null}
          {item.vrm?.hasFullBodyBones ? (
            <span>{copy.fullBodyBones}</span>
          ) : null}
          {item.vrm?.hasToeBones ? (
            <span>{copy.toeBones}</span>
          ) : null}
          {item.vrm?.headBoneHeightMeters !== null && item.vrm?.headBoneHeightMeters !== undefined ? (
            <span>
              {format(copy.headHeightLine, {
                height: formatMeters(item.vrm.headBoneHeightMeters),
              })}
            </span>
          ) : null}
          {item.format === "vrm_1_0" || item.format === "vrm_0_x" ? (
            <span className="vua-glb-inspection__hint">{copy.vrmConverterNote}</span>
          ) : null}
        </div>
      ) : null}
    </li>
  );

  return (
    <section className="vua-warehouse-detail__section vua-glb-inspection" aria-label={copy.title}>
      <div className="vua-warehouse-detail__section-head">
        <h3>{copy.title}</h3>
      </div>
      <p className="vua-caption vua-text-secondary">{copy.subtitle}</p>
      <ul className="vua-glb-inspection__list">
        {visibleItems.map(renderItem)}
      </ul>
      {overflowItems.length > 0 ? (
        <details className="vua-glb-inspection__more">
          <summary>{format(copy.moreFilesSummary, { count: overflowItems.length })}</summary>
          <ul className="vua-glb-inspection__list">
            {overflowItems.map(renderItem)}
          </ul>
        </details>
      ) : null}
      {result.truncated ? <p className="vua-caption vua-text-secondary">{copy.truncatedNote}</p> : null}
    </section>
  );
}
