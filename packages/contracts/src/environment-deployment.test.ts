import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isApplicationRequestV01 } from "./application-contract.js";
import { isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import { DEPLOYMENT_SCHEMA, UNITY_HUB_INSTALL_LINK, isDeploymentIntent, isDeploymentParams, isDeploymentPlanResult, isDeploymentAccepted, isDeploymentCommandId, readDeploymentProgress } from "./environment-deployment.js";

const vectors = JSON.parse(readFileSync(new URL("../../../schemas/environment-deployment/v0.1/intent-vectors.json", import.meta.url), "utf8")) as { name: string; valid: boolean; intent: unknown }[];
const intent = { purposes: ["pc_avatar"], editorRoot: "C:\\VUA Test\\Editors" };
const digest = "a".repeat(64);
describe("deployment v0.1 closed boundary", () => {
  it("keeps real bytes separate from steps and rejects malformed progress", () => {
    const facts = { operation: "environment.executeDeployment", component: "unity_editor", action: "install_editor", phase: "downloading", source: "nounitycn", completedBytes: 1024, totalBytes: 2048 };
    expect(readDeploymentProgress(facts)).toMatchObject({ phase: "downloading", source: "nounitycn", completedBytes: 1024, totalBytes: 2048 });
    expect(readDeploymentProgress({ ...facts, totalBytes: undefined })?.totalBytes).toBeUndefined();
    for (const change of [{ phase: "imaginary" }, { source: "other" }, { completedBytes: -1 }, { completedBytes: 2049 }, { completedBytes: NaN }, { totalBytes: 0 }, { cause: "raw credential or vendor log" }, { phase: "source_failed" }]) {
      expect(readDeploymentProgress({ ...facts, ...change })).toBeNull();
    }
    expect(readDeploymentProgress({ ...facts, phase: "source_failed", cause: "vua.deployment.editor_regional_redirect" })?.cause).toBe("vua.deployment.editor_regional_redirect");
    expect(readDeploymentProgress({ ...facts, editorVersion: "2022.3.22f1c1" })?.editorVersion).toBe("2022.3.22f1c1");
    expect(readDeploymentProgress({ ...facts, editorVersion: "2022.3.22f1c2" })).toBeNull();
    const failed = { ...facts, phase: "installation_failed", source: undefined, cause: "vua.deployment.install_failed", editorVersion: "2022.3.22f1c1" };
    expect(readDeploymentProgress(failed)?.phase).toBe("installation_failed");
    expect(readDeploymentProgress({ ...failed, editorVersion: undefined })).toBeNull();
  });
  it("requires official-first downloads in every region and rejects mirror-first plans", () => {
    const officialUrl = "https://unity.com/releases/editor/whats-new/2022.3.22f1";
    const cli = { component: "unity_cli", action: "retain", reason: "verified", location: null, version: null, officialUrl: null };
    const editor = { ...cli, component: "unity_editor", action: "manual_install", reason: "missing", officialUrl };
    const downloadPolicy = { region: "china_mainland", mirrorsEnabled: true, sources: ["official", "nounitycn"], hubFallbackUrl: UNITY_HUB_INSTALL_LINK };
    const plan = { schemaVersion: DEPLOYMENT_SCHEMA, intent, steps: [cli, editor], digest, prerequisitesReady: false, installer: null, downloadPolicy };
    const valid = (value: unknown) => isDeploymentPlanResult({ deploymentPlan: value });
    const officialSteps = [cli, { ...editor, officialUrl: "https://unity.com/releases/editor/whats-new/2022.3.22f1" }];
    expect(valid(plan)).toBe(true);
    for (const region of ["other", "unknown"]) {
      expect(valid({ ...plan, steps: officialSteps, downloadPolicy: { ...downloadPolicy, region, sources: ["official", "nounitycn"] } })).toBe(true);
    }
    const officialOnly = { ...plan, intent: { ...intent, useMirrors: false }, downloadPolicy: { ...downloadPolicy, mirrorsEnabled: false, sources: ["official"] } };
    expect(valid({ ...officialOnly, steps: officialSteps })).toBe(true);
    expect(valid({ ...officialOnly, steps: [cli, { ...editor, officialUrl: "https://www.nounitycn.top/download?v=unityhub%3A%2F%2F2022.3.22f1%2F887be4894c44" }] })).toBe(false);
    for (const changed of [
      { ...downloadPolicy, sources: ["nounitycn", "official"] },
      { ...downloadPolicy, region: "invalid" },
      { ...downloadPolicy, sources: ["nounitycn", "official", "other"] },
      { ...downloadPolicy, hubFallbackUrl: "unityhub://other-version/other-changeset" },
    ]) expect(valid({ ...plan, downloadPolicy: changed })).toBe(false);
    expect(valid({ ...plan, intent: { ...intent, useMirrors: false } })).toBe(false);
    expect(valid({ ...plan, downloadPolicy: { ...downloadPolicy, editorEditions: ["global", "china"] } })).toBe(true);
    for (const editorEditions of [["china", "global"], ["global"], ["global", "china", "other"]]) {
      expect(valid({ ...plan, downloadPolicy: { ...downloadPolicy, editorEditions } })).toBe(false);
    }
    expect(valid({ ...plan, steps: [cli, { ...editor, officialUrl: officialUrl.replace("2022.3.22f1", "other") }] })).toBe(false);
  });
  it("requires the right installer authority for acquisition and installation", () => {
    const installer = { kind: "unity_cli_bootstrap", location: "C:\\VUA\\unity.exe", version: "1.0.0-beta.11", fileSha256: digest, editorRoot: intent.editorRoot };
    const cli = { component: "unity_cli", action: "install_unity_cli", reason: "missing", location: installer.location, version: installer.version, officialUrl: "https://docs.unity.com/en-us/unity-cli/use-unity-cli" };
    const editor = { ...cli, component: "unity_editor", action: "manual_install" };
    const plan = { schemaVersion: DEPLOYMENT_SCHEMA, intent, steps: [cli, editor], digest, prerequisitesReady: false, installer };
    expect(isDeploymentPlanResult({ deploymentPlan: plan })).toBe(true);
    for (const identity of [null, { ...installer, kind: "unity_cli" }, { ...installer, editorRoot: "D:\\Editors" }, { ...installer, fileSha256: "invalid" }]) {
      expect(isDeploymentPlanResult({ deploymentPlan: { ...plan, installer: identity } })).toBe(false);
    }
    expect(isDeploymentPlanResult({ deploymentPlan: { ...plan, steps: [cli, { ...editor, action: "install_editor" }] } })).toBe(false);
    expect(isDeploymentPlanResult({ deploymentPlan: { ...plan, installer: { ...installer, kind: "unity_cli" }, steps: [{ ...cli, action: "retain", reason: "verified" }, { ...editor, action: "install_editor" }] } })).toBe(true);
  });
  it("does not mistake an accepted receipt for an installer result or accept malformed identity", () => {
    const receipt = { schemaVersion: DEPLOYMENT_SCHEMA, operation: "environment.executeDeployment", taskId: "task-1", correlationId: "corr-1" };
    expect(isDeploymentAccepted(receipt)).toBe(true);
    expect(isDeploymentAccepted({ ...receipt, taskId: null })).toBe(false);
    expect(isDeploymentAccepted({ ...receipt, installed: true })).toBe(false);
    expect(isDeploymentCommandId("用户-1")).toBe(true);
    expect(isDeploymentCommandId("a".repeat(129))).toBe(false);
    expect(isDeploymentCommandId("界".repeat(43))).toBe(false);
    expect(isDeploymentCommandId("cmd\u0085")).toBe(false);
  });
  for (const vector of vectors) it(vector.name, () => expect(isDeploymentIntent(vector.intent)).toBe(vector.valid));
  it("accepts query/command on both envelopes and keeps command identity outside app params", () => {
    for (const execute of [false, true]) {
      const method = execute ? "environment.executeDeployment" : "environment.planDeployment";
      const params = execute ? { intent, confirmedDigest: digest } : { intent };
      const app = { contractVersion: "0.1", requestId: "r", correlationId: "corr", kind: execute ? "command" : "query", method, params, ...(execute ? { commandId: "cmd" } : {}) };
      expect(isApplicationRequestV01(app)).toBe(true);
      expect(isDesktopGatewayRequestV1({ schemaVersion: 1, requestId: "r", method, params: { ...params, ...(execute ? { commandId: "cmd" } : {}) } })).toBe(true);
      expect(isApplicationRequestV01({ ...app, params: { ...params, executable: "cmd.exe" } })).toBe(false);
    }
  });
  it("requires exact confirmation and rejects fields outside this capability", () => {
    expect(isDeploymentParams({ intent, confirmedDigest: digest }, true)).toBe(true);
    for (const invalid of [{ intent }, { intent, confirmedDigest: digest.toUpperCase() }, { intent, confirmedDigest: digest, force: true }, { intent, confirmedDigest: "x" }]) {
      expect(isDeploymentParams(invalid, true)).toBe(false);
    }
    expect(isDeploymentIntent({ ...intent, editorRoot: `C:\\${"界".repeat(80)}` })).toBe(false);
  });
  it("rejects arbitrary URLs, duplicate components and false-ready results", () => {
    const step = { component: "unity_hub", action: "retain", reason: "verified", location: null, version: null, officialUrl: "https://unity.com/download" };
    const editor = { ...step, component: "unity_editor", action: "manual_install", reason: "missing" };
    const plan = { schemaVersion: DEPLOYMENT_SCHEMA, intent, steps: [step, editor], digest, prerequisitesReady: false, installer: null };
    expect(isDeploymentPlanResult({ deploymentPlan: plan })).toBe(true);
    expect(isDeploymentPlanResult({ deploymentPlan: { ...plan, prerequisitesReady: true } })).toBe(false);
    expect(isDeploymentPlanResult({ deploymentPlan: { ...plan, steps: [step, step] } })).toBe(false);
    expect(isDeploymentPlanResult({ deploymentPlan: { ...plan, steps: [step, { ...editor, officialUrl: "https://example.com/installer" }] } })).toBe(false);
  });
});
