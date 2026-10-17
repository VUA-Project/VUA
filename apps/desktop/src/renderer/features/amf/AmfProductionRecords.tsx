import { useEffect, useState } from "react";
import { useGateway, type AmfProductionList } from "../../gateway/index.ts";
import { strings } from "../../i18n/index.ts";
import { Card } from "../../components/primitives/Card.tsx";
import { Button } from "../../components/primitives/Button.tsx";

/** Actual retained N3 runs; no synthetic fallback and no completed label for in-flight work. */
export function AmfProductionRecords({ open, onHasRuns }: { open: () => void; onHasRuns?: (hasRuns: boolean) => void }) {
  const port=useGateway().amfProduction;
  const [list,setList]=useState<AmfProductionList|null>(null);
  useEffect(()=>{let alive=true;void port?.list().then(value=>{if(alive)setList(value);}).catch(()=>{});return()=>{alive=false;};},[port]);
  useEffect(()=>{onHasRuns?.((list?.runs.length ?? 0)>0);},[list,onHasRuns]);
  if(!list || list.runs.length===0)return null;
  return <Card><h2>{strings.amfProduction.history}</h2><div className="vua-page__stack">{list.runs.map(run=><Button variant="subtle" key={run.runId} onClick={()=>{
    try{localStorage.setItem("vua-amf-production-run-v01",run.runId);}catch{/* View state only. */}open();
  }}>{run.sourceNames.join(" · ") || run.runId} · {strings.amfProduction.phase[run.phase]}</Button>)}</div></Card>;
}
