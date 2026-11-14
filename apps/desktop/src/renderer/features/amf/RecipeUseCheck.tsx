import { readRecipeTerms } from "./recipe-terms-actions.ts";
import { useEffect,useMemo,useState } from "react";
import { TERMS_PRESET_IDS,type AmfSharedRecipe,type TermsPresetId,type TermsUseCheckV01,type TermsBlockingItem } from "@vua/contracts";
import { useGateway } from "../../gateway/index.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { strings,termsEverywhereCopy as copy } from "../../i18n/index.ts";
import { recipeProducts,useStatus } from "./recipe-contents-model.ts";
const terms=strings.useTerms;
function blocker(value:TermsBlockingItem) {const reason=terms.line.reasons[value.reason as keyof typeof terms.line.reasons]??terms.decisions.unknown;return value.item?`${value.item} · ${terms.names[value.item as keyof typeof terms.names]}: ${reason}`:reason;}
export function RecipeUseCheck({document,onUpdated}:{document:AmfSharedRecipe;onUpdated?:()=>void}) {
  const gateway=useGateway(),port=gateway.terms;
  const materials=useMemo(()=>recipeProducts(document.recipe,document.sources),[document]);
  const ids=useMemo(()=>[...new Set(materials.flatMap(v=>v.productId?[v.productId]:[]))],[materials]);
  const [preset,setPreset]=useState<TermsPresetId>("vrchat_personal"),[check,setCheck]=useState<TermsUseCheckV01|null>(null),[nonce,setNonce]=useState(0);
  const [error,setError]=useState<string|null>(null),[reading,setReading]=useState<Readonly<Record<string,string>>>({});
  useEffect(()=>{let alive=true;setCheck(null);if(!port||!ids.length)return;
    void port.checkUse(preset,ids).then(value=>{if(alive)setCheck(value);}).catch(()=>{if(alive)setError(copy.failed);});return()=>{alive=false;};
  },[port,preset,ids,nonce]);
  useEffect(()=>{if(!Object.keys(reading).length)return;let alive=true;
    const poll=()=>{void gateway.task.snapshot().then(view=>{if(!alive)return;const ended=Object.entries(reading).filter(([,taskId])=>view.tasks.some(task=>task.id===taskId&&["completed","completedWithWarnings","failed","cancelled"].includes(task.status)) || taskId!=="starting"&&!view.tasks.some(task=>task.id===taskId));
      if(!ended.length)return;setReading(current=>Object.fromEntries(Object.entries(current).filter(([id])=>!ended.some(([done])=>done===id))));
      if(ended.some(([,id])=>!view.tasks.some(task=>task.id===id)||view.tasks.some(task=>task.id===id&&["failed","cancelled"].includes(task.status))))setError(copy.stopped);setNonce(value=>value+1);
    }).catch(()=>{if(alive)setError(copy.failed);});};const timer=setInterval(poll,1500);poll();return()=>{alive=false;clearInterval(timer);};
  },[gateway.task,reading]);
  return <section className="vua-recipe-use"><h3>{copy.check}</h3><label className="vua-n3__field">{copy.use}<select value={preset} onChange={e=>{setPreset(e.target.value as TermsPresetId);setError(null);}}>{TERMS_PRESET_IDS.map(id=><option key={id} value={id}>{terms.presets[id]}</option>)}</select></label>
    {!port?<p>{copy.unavailable}</p>:!ids.length?<p>{copy.noProducts}</p>:check?<>
      <p><strong>{copy.combined}: {copy[useStatus(check.combination)]}</strong></p>
      <ul>{check.products.map(product=><li key={product.productId}>
        <strong>{materials.filter(m=>m.productId===product.productId).map(m=>m.packageName).join(" · ")} · BOOTH {product.productId.slice(6)}</strong>
        <span>{copy[product.sourceState==="no_vn3"?"no_terms":useStatus(product)]}</span>
        {product.blockingItems.map((item,index)=><small key={`b-${index}`}>{blocker(item)}</small>)}
        {product.conditions.map((item,index)=><small key={`c-${index}`}>{item.item} · {terms.conditions[item.condition]}</small>)}
        {product.advisories.map((item,index)=><small key={`a-${index}`}>{terms.line.advisories[item.reason as keyof typeof terms.line.advisories]??blocker(item)}</small>)}
        {product.hasSpecialNote&&<details><summary>{copy.special}</summary>{product.specialNotes.map((note,index)=><p key={index}>{note.text}</p>)}</details>}
        {product.sourceState!=="parsed"&&<Button disabled={reading[product.productId]!==undefined} onClick={()=>{
          if(!port)return;setError(null);setReading(current=>({...current,[product.productId]:"starting"}));void readRecipeTerms(product.productId,product.productId,(id,title)=>port.refreshProduct(id,title)).then(value=>{setReading(current=>({...current,[product.productId]:value.taskId}));onUpdated?.();}).catch(()=>{setError(copy.failed);setReading(current=>Object.fromEntries(Object.entries(current).filter(([id])=>id!==product.productId)));});
        }}>{reading[product.productId]?copy.reading:copy.read}</Button>}
      </li>)}</ul>
    </>:<p role="status">{strings.amfProduction.loading}</p>}
    {error&&<p role="alert">{error}</p>}<Button disabled={!port} onClick={()=>{setError(null);setNonce(value=>value+1);}}>{copy.retry}</Button><p className="vua-caption">{copy.informational}</p>
  </section>;
}
