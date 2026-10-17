import { useEffect, useState } from "react";
import type { AmfRecipeApplyChoice } from "@vua/contracts";
import { useGateway, type AmfRecipeSummary, type AmfRecipeApplyPlan, type AmfProductionAccepted } from "../../gateway/index.ts";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { strings, format } from "../../i18n/index.ts";

const copy = strings.amfProduction;
export function AmfRecipeApplyDialog({ runId, onClose, onApplied, onReinspect }: {
  runId: string; onClose: () => void; onApplied: (accepted: AmfProductionAccepted) => void; onReinspect: () => void;
}) {
  const port = useGateway().amfProduction;
  const [recipes, setRecipes] = useState<readonly AmfRecipeSummary[] | null>(null);
  const [plan, setPlan] = useState<AmfRecipeApplyPlan | null>(null);
  const [choice, setChoice] = useState<AmfRecipeApplyChoice>("new_avatar");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void port?.listRecipes().then(value => { if (alive) setRecipes(value); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : copy.taskFailed); });
    return () => { alive = false; };
  }, [port]);
  const compare = async (recipeId: string, avatarId?: string) => {
    if (!port || busy) return;
    setBusy(true); setError(null);
    try { setPlan(await port.recipeApplyPlan(runId, recipeId, avatarId)); setChoice("new_avatar"); }
    catch (e) { setError(e instanceof Error ? e.message : copy.taskFailed); }
    finally { setBusy(false); }
  };
  const display = (value: string | boolean) => typeof value === "boolean" ? (value ? copy.applyOn : copy.applyOff)
    : value === "merge_armature" ? copy.merge : value === "attach_to_bone" ? copy.attach : value || "—";
  return <ContentDialog open title={copy.applyRecipe} closeLabel={strings.common.dialogClose} onClose={() => { if (!busy) onClose(); }}>
    <div className="vua-recipe-transfer">
      {error && <div role="alert"><p>{error}</p><Button disabled={busy} onClick={onReinspect}>{copy.reinspect}</Button></div>}
      {!plan ? <>
        <p>{copy.applyChoose}</p>
        {recipes === null ? <p role="status">{copy.loading}</p> : recipes.length === 0 ? <p>{copy.recipesEmpty}</p> :
          <div className="vua-n3__recipes">{recipes.map(recipe => <button type="button" className="vua-n3__recipe" key={recipe.recipeId} disabled={busy} onClick={() => { void compare(recipe.recipeId); }}><span><strong>{recipe.title}</strong><small>{copy.applyCompare}</small></span></button>)}</div>}
        <Button variant="subtle" disabled={busy} onClick={onClose}>{copy.applyCancel}</Button>
      </> : <>
        {plan.targets.length > 1 && <label className="vua-field"><span>{copy.applyTarget}</span><select value={plan.avatarGlobalObjectId} disabled={busy} onChange={event => { void compare(plan.recipeId, event.target.value); }}>
          {plan.targets.map((target,index) => <option key={target.globalObjectId} value={target.globalObjectId} disabled={!target.verified}>{index + 1}. {target.name}{target.verified ? "" : ` · ${copy.applyTargetUnavailable}`}</option>)}
        </select></label>}
        <h3>{format(copy.applyHeading, { recipe: plan.title, avatar: plan.avatarName })}</h3>
        <p>{format(copy.applyPreserved, { count: plan.retainedOutfits })}</p>
        {plan.overlayBlocker && <p role="alert" className="vua-n3__notice">{plan.overlayBlocker}</p>}
        {plan.conflicts.length === 0 ? <p>{copy.applyNoConflict}</p> : <div className="vua-recipe-apply__table"><table>
          <thead><tr><th>{copy.materials}</th><th>{copy.applyField}</th><th>{copy.applyCurrent}</th><th>{copy.applyIncoming}</th></tr></thead>
          <tbody>{plan.conflicts.map(conflict => <tr key={conflict.sourceId + conflict.field}><td>{conflict.packageName}</td><td>{copy.applyFields[conflict.field]}</td><td>{display(conflict.current)}</td><td>{display(conflict.incoming)}</td></tr>)}</tbody>
        </table></div>}
        <fieldset className="vua-recipe-apply__choices"><legend>{copy.applyChoice}</legend>
          {(["new_avatar", "recipe_wins", "avatar_wins"] as const).map(value => <label key={value} data-selected={choice === value || undefined}>
            <input type="radio" name="recipe-apply-choice" value={value} checked={choice === value} disabled={busy || (value !== "new_avatar" && plan.overlayBlocker !== null)} onChange={() => setChoice(value)}/>
            <span><strong>{copy.applyChoices[value]}</strong><small>{copy.applyChoiceHints[value]}</small></span>
          </label>)}
        </fieldset>
        <p className="vua-caption vua-text-secondary">{copy.restoreReversible}</p>
        <div className="vua-n3__actions vua-recipe-transfer__footer">
          <Button variant="subtle" disabled={busy} onClick={onClose}>{copy.applyCancel}</Button>
          <Button variant="primary" disabled={busy} onClick={() => {
            if (!port || busy) return;
            setBusy(true); setError(null);
            void port.applyRecipe(plan, choice).then(onApplied).catch(e => setError(e instanceof Error ? e.message : copy.taskFailed)).finally(() => setBusy(false));
          }}>{copy.applyConfirm}</Button>
        </div>
      </>}
    </div>
  </ContentDialog>;
}
