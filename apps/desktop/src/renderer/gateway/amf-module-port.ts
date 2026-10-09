import { isAmfModuleSnapshotV01, isAmfModuleChangeResultV01, type AmfModuleApiV01, type AmfModuleSnapshotV01 } from "@vua/contracts";
export const absentAmf: AmfModuleSnapshotV01 = { schemaVersion: "0.1", moduleId: "amf", installed: false, state: "absent" };
export function createAmfModulePort(api?: AmfModuleApiV01): AmfModuleApiV01 {
  const read = (value: unknown): AmfModuleSnapshotV01 => {
    if (!isAmfModuleSnapshotV01(value)) throw new Error("Invalid AMF module snapshot");
    return value;
  };
  return {
    snapshot: async () => api ? read(await api.snapshot()) : absentAmf,
    setEnabled: async enabled => {
      if (!api) return { outcome: "failed", snapshot: absentAmf };
      const result = await api.setEnabled(enabled);
      if (!isAmfModuleChangeResultV01(result)) throw new Error("Invalid AMF lifecycle result");
      return { outcome: result.outcome, snapshot: read(result.snapshot) };
    },
    subscribe: listener => api?.subscribe(snapshot => { if (isAmfModuleSnapshotV01(snapshot)) listener(snapshot); }) ?? (() => {}),
  };
}
