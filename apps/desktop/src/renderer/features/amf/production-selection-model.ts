import type { AmfAssemblySelection, AmfOutfitSelection } from "@vua/contracts";
import type { AmfProductionRun } from "../../gateway/index.ts";

/** Auto-select only unique Unity-observed candidates. Never infer compatibility from a name. */
export function initialProductionSelection(run: AmfProductionRun): AmfAssemblySelection {
  const observed = run.result?.facts?.observedSelection;
  if (observed) return observed;
  if (run.selection !== null) return run.selection;
  const avatars = run.prefabs.filter(p => p.isAvatar && !p.hasMissingScripts && run.sources.some(s => s.sourceId === p.sourceId && (s.role === "avatar" || s.role === "auto")));
  const avatarPaths = [...new Set(avatars.map(p => p.path))];
  const outfits: AmfOutfitSelection[] = [];
  for (const source of run.sources) {
    if (source.role === "dependency" || source.role === "avatar") continue;
    const candidates = run.prefabs.filter(p => p.sourceId === source.sourceId && !p.isAvatar && !p.hasMissingScripts);
    if (candidates.length !== 1 || (!candidates[0]?.hasSkinnedMesh && !candidates[0]?.hasMergeArmature)) continue;
    const candidate = candidates[0];
    outfits.push({ sourceId: source.sourceId, prefabPath: candidate.path, mode: "merge_armature", bone: "", toggleName: source.itemName.slice(0, 80), active: true });
  }
  return { avatarPrefab: avatarPaths.length === 1 ? avatarPaths[0] ?? "" : "", outfits };
}

export function updateOutfitSelection(selection: AmfAssemblySelection, sourceId: string, update: Partial<AmfOutfitSelection> | null): AmfAssemblySelection {
  const previous = selection.outfits.find(o => o.sourceId === sourceId);
  const others = selection.outfits.filter(o => o.sourceId !== sourceId);
  if (update === null) return { ...selection, outfits: others };
  const next: AmfOutfitSelection = { sourceId, prefabPath: "", mode: "merge_armature", bone: "", toggleName: "", active: true, ...previous, ...update };
  return { ...selection, outfits: [...others, next].sort((a,b) => a.sourceId.localeCompare(b.sourceId)) };
}
