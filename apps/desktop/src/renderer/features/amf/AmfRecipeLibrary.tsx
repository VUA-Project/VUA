import { AmfRecipeImportDialog } from "./AmfRecipeImportDialog.tsx";
import { useEffect, useState } from "react";
import { Icon } from "@vua/design-system";
import { useGateway, type AmfRecipeSummary } from "../../gateway/index.ts";
import { Card } from "../../components/primitives/Card.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { strings } from "../../i18n/index.ts";
import "./amf-production.css";

/** Saved production declarations, distinct from unfinished selection drafts. */
export function AmfRecipeLibrary({ onOpen, disabled = false, refreshKey = 0 }: {
  onOpen: (recipeId: string) => void; disabled?: boolean; refreshKey?: number;
}) {
  const port = useGateway().amfProduction;
  const [recipes, setRecipes] = useState<readonly AmfRecipeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!port) return;
    setLoading(true);
    void port.listRecipes().then(value => { if (alive) { setRecipes(value); setError(null); } })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : strings.amfProduction.taskFailed); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [port, refreshKey, retry]);
  if (!port) return null;
  return <><Card><div className="vua-n3__toolbar"><h2>{strings.amfProduction.recipes}</h2><Button disabled={disabled} onClick={() => setImportOpen(true)}>{strings.amfProduction.importRecipe}</Button></div><p className="vua-caption vua-text-secondary">{strings.amfProduction.recipesHint}</p>
    {error !== null ? <div role="alert"><p>{error}</p><Button onClick={() => setRetry(value => value + 1)}>{strings.amfProduction.retry}</Button></div> : loading ? <p role="status" className="vua-caption vua-text-secondary">{strings.amfProduction.loading}</p> : recipes.length === 0 ? <p className="vua-caption vua-text-secondary">{strings.amfProduction.recipesEmpty}</p> :
      <div className="vua-n3__recipes">{recipes.map(recipe => <button type="button" className="vua-n3__recipe" disabled={disabled} key={recipe.recipeId} onClick={() => onOpen(recipe.recipeId)}>
        <Icon name="file" size={20}/><span><strong>{recipe.title}</strong><small>{strings.amfProduction.recipeOpen}</small></span><Icon name="arrow-right" size={16}/>
      </button>)}</div>}
  </Card>{importOpen && <AmfRecipeImportDialog onClose={() => setImportOpen(false)} onImported={() => setRetry(value => value + 1)} onOpen={onOpen}/>}</>;
}
