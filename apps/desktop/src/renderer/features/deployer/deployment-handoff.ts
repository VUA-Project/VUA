/** Present the next manual step from an authoritative task after page return.
 * This supplies navigation only; an opened page never establishes readiness. */
const destinations = {
  steam: ["https://store.steampowered.com/about/"],
  vrchat: ["https://store.steampowered.com/app/438100/"],
  steamvr: ["https://store.steampowered.com/app/250820/"],
  pico_runtime: ["https://www.picoxr.com/software/pico-connect", "https://www.picoxr.com/cn/software/pico-link", "https://www.picoxr.com/global/software/pico-link"],
  unity_hub: ["https://unity.com/download"],
  unity_cli: ["https://docs.unity.com/en-us/unity-cli/use-unity-cli"],
  unity_editor: ["https://unity.com/releases/editor/whats-new/2022.3.22f1"],
  android_modules: ["https://docs.unity.com/en-us/hub/add-modules"],
} as const;

export interface DeploymentManualHandoff {
  readonly component: keyof typeof destinations;
  readonly officialUrl: string;
}

export function readDeploymentManualHandoff(result: unknown): DeploymentManualHandoff | null {
  if (typeof result !== "object" || result === null || !("outcome" in result) || result.outcome !== "manual_required"
    || !("nextStep" in result)) return null;
  const step = result.nextStep;
  if (typeof step !== "object" || step === null || !("action" in step) || step.action !== "manual_install"
    || !("component" in step) || typeof step.component !== "string" || !Object.hasOwn(destinations, step.component)
    || !("officialUrl" in step) || typeof step.officialUrl !== "string") return null;
  const component = step.component as keyof typeof destinations;
  if (!(destinations[component] as readonly string[]).includes(step.officialUrl)) return null;
  return { component, officialUrl: step.officialUrl };
}
