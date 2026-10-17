import type { AiActionRequestV01 } from "@vua/contracts";
import { currentLocale, format, strings } from "../../i18n/index.ts";
import { Card } from "../../components/primitives/Card.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import "./ai-requests.css";

const copy = strings.aiTools;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const requestTitle = (request: AiActionRequestV01) => copy.tools[request.tool as keyof typeof copy.tools] ?? request.title;
function outcome(request: AiActionRequestV01): string {
  const keys: Record<string, keyof typeof copy.outcomes> = { vua_request_installation: "installation", vua_request_play: "play", vua_request_tool: "tool", vua_request_amf_prepare: "prepare", vua_request_amf_assemble: "assemble", vua_request_amf_reinspect: "reinspect", vua_request_amf_open: "open", vua_request_amf_upload: "upload", vua_request_cancel_task: "cancel" };
  return copy.outcomes[keys[request.tool] ?? "cancel"];
}
/** File or folder name without directories or extension: "Meiyun_v2.1.0/Meiyun.unitypackage" → "Meiyun". */
const baseName = (value: unknown) => String(value ?? "").split(/[\\/]/).pop()!.replace(/\.(unitypackage|zip|prefab)$/i, "");
const roleLabel = (role: unknown) => copy.roles[role as keyof typeof copy.roles] ?? copy.roles.material;
/** One material line: its role, the package name, and the download it came from when that name differs. */
function Material({ role, name, item }: { role: unknown; name: unknown; item: unknown }) {
  const own = baseName(name), from = baseName(item);
  return <li><strong>{roleLabel(role)}</strong>{" · "}{own}
    {from && from !== own ? <span className="vua-caption vua-text-secondary"> · {format(copy.fromItem, { item: from })}</span> : null}</li>;
}
/** Facts displayed for consent, not executable text supplied by the Agent. The player sees what the
 * action touches in everyday words; paths and raw parameters stay under the technical details. */
function Review({ request }: { request: AiActionRequestV01 }) {
  const params = record(request.details.parameters) ? request.details.parameters : {};
  const reviewed = record(request.details.reviewed) ? request.details.reviewed : {};
  const plan = record(reviewed.deploymentPlan) ? reviewed.deploymentPlan : null;
  const steps = plan && Array.isArray(plan.steps) ? plan.steps.filter(record) : [];
  const sources = Array.isArray(params.sources) ? params.sources.filter(record) : [];
  const knownSources = Array.isArray(reviewed.sources) ? reviewed.sources.filter(record) : [];
  const inputs = Array.isArray(reviewed.inputs) ? reviewed.inputs.filter(record) : [];
  const selection = record(params.selection) ? params.selection : null;
  const outfits = selection && Array.isArray(selection.outfits) ? selection.outfits.filter(record) : [];
  const materials = sources.length > 0
    ? sources.map(source => ({ source, fact: knownSources.find(s => s.sourceId === source.sourceId) }))
    : params.runId ? knownSources.map(fact => ({ source: fact, fact })) : [];
  return <div className="vua-ai-review">
    {steps.length > 0 ? <><h4>{copy.software}</h4><ul>{steps.map((step, i) => <li key={i}>
      <strong>{strings.deployment.components[step.component as keyof typeof strings.deployment.components] ?? String(step.component)}</strong>
      {" · "}{strings.deployment.actions[step.action as keyof typeof strings.deployment.actions] ?? String(step.action)}
      {step.version ? ` (${String(step.version)})` : ""}
    </li>)}</ul></> : null}
    {params.route ? <p>{strings.deployment.purposes[params.route as keyof typeof strings.deployment.purposes] ?? String(params.route)}</p> : null}
    {params.action ? <p>{copy.actions[params.action as keyof typeof copy.actions] ?? String(params.action)}</p> : null}
    {materials.length > 0 ? <><h4>{copy.materials}</h4><ul>{materials.map(({ source, fact }, i) => fact
      ? <Material key={i} role={fact.role ?? source.role} name={fact.name} item={fact.itemName} />
      : <Material key={i} role={source.role} name={source.sourceId} item={null} />)}</ul></> : null}
    {inputs.length > 0 ? <><h4>{copy.materials}</h4><ul>{inputs.map((input, i) => <li key={i}>{baseName(input.name)}</li>)}</ul></> : null}
    {selection ? <><h4>{copy.combination}</h4><ul>
      <li><strong>{copy.roles.avatar}</strong>{" · "}{baseName(selection.avatarPrefab)}</li>
      {outfits.map((outfit, i) => <li key={i}><strong>{copy.roles.outfit}</strong>{" · "}{baseName(outfit.prefabPath)}
        <span className="vua-caption vua-text-secondary">
          {" · "}{outfit.mode === "attach_to_bone" ? `${strings.amfProduction.attach} (${String(outfit.bone)})` : strings.amfProduction.merge}
          {outfit.toggleName ? ` · ${strings.amfProduction.switchName}: ${String(outfit.toggleName)}` : ""}
        </span></li>)}
    </ul></> : null}
  </div>;
}
/** Paths, download routing and raw parameters, for the AI or for troubleshooting. */
function TechnicalDetails({ request }: { request: AiActionRequestV01 }) {
  const params = record(request.details.parameters) ? request.details.parameters : {};
  const reviewed = record(request.details.reviewed) ? request.details.reviewed : {};
  const plan = record(reviewed.deploymentPlan) ? reviewed.deploymentPlan : null;
  const locations = plan && Array.isArray(plan.steps) ? plan.steps.filter(record).filter(step => step.location) : [];
  return <details className="vua-ai-review"><summary>{copy.technical}</summary>
    {locations.map((step, i) => <p key={i}>{strings.deployment.components[step.component as keyof typeof strings.deployment.components] ?? String(step.component)}: <code>{String(step.location)}</code></p>)}
    {plan && record(plan.downloadPolicy) ? <p className="vua-caption">
      {strings.deployment.downloadRegion}: {strings.deployment.downloadRegions[plan.downloadPolicy.region as keyof typeof strings.deployment.downloadRegions]}
      <br />{strings.deployment.downloadOrder}: {Array.isArray(plan.downloadPolicy.sources) ? plan.downloadPolicy.sources.map(source => strings.deployment.downloadSources[source as keyof typeof strings.deployment.downloadSources]).join(" → ") : ""}
      {plan.downloadPolicy.editorEditions ? <><br />{strings.deployment.editorEditionOrder}</> : null}
    </p> : null}
    {params.editorPath ? <p>{strings.amfProduction.editor}: <code>{String(params.editorPath)}</code></p> : null}
    {reviewed.projectRoot ? <p>{copy.project}: <code>{String(reviewed.projectRoot)}</code></p> : null}
    <pre>{JSON.stringify(params, null, 2)}</pre>
  </details>;
}
export const requestClock = (iso: string) => new Date(iso).toLocaleTimeString(currentLocale, { hour: "2-digit", minute: "2-digit" });

/** One AI request. On its own page the player decides here; elsewhere the card links to that page. */
export function AiRequestCard({ request, busy, revealed = false, onResolve, onOpen }: {
  request: AiActionRequestV01;
  busy: boolean;
  /** The player arrived from a notification for this request. */
  revealed?: boolean;
  onResolve?: (decision: "approve" | "reject") => void;
  onOpen?: () => void;
}) {
  // Why a request was withdrawn or could not start, e.g. the project changed after the AI asked.
  const reason = request.error ? (copy.reasons as Record<string, string>)[request.error] : undefined;
  return <Card data-ai-request={request.id} data-revealed={revealed ? "" : undefined}>
    <header className="vua-ai-request__header"><h3>{requestTitle(request)}</h3><span role="status">{copy.states[request.state]}</span></header>
    <p>{outcome(request)}</p>
    <Review request={request} />
    {request.state === "pending" ? <>
      <p className="vua-caption vua-text-secondary">{format(copy.askedAt, { time: requestClock(request.createdAt) })}</p>
      <div className="vua-ai-request__controls">
        {onResolve ? <>
          <Button variant="primary" disabled={busy} onClick={() => onResolve("approve")}>{copy.approve}</Button>
          <Button variant="subtle" disabled={busy} onClick={() => onResolve("reject")}>{copy.reject}</Button>
        </> : onOpen ? <Button variant="primary" onClick={onOpen}>{copy.goConfirm}</Button> : null}
      </div></> : null}
    {request.state === "accepted" ? <p role="status">{copy.dispatchedHint}</p> : null}
    {request.state === "withdrawn" ? <p>{reason ?? copy.reasons.withdrawn_by_ai}</p> : null}
    {request.state === "failed" ? <p role="alert">{reason ?? copy.requestFailed} <code>{request.error}</code></p> : null}
    <TechnicalDetails request={request} />
  </Card>;
}
