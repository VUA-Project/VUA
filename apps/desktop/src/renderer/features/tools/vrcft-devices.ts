/** Supported choices, not detected hardware. Checked against upstream guides 2026-10-10.
 * Modules and device software are installed by the user in their own upstream apps. */
const docs = "https://docs.vrcft.io/docs/hardware/";
export interface TrackingMethod { id: string; name: string; module: string; guide: string; package?: boolean }
export interface TrackingDevice { id: string; name: string; group: "headsets" | "addons" | "desktop"; tracking: "eyes" | "face" | "both"; note?: "accessory" | "pico" | "pimax" | "iphone"; hardwareGuide?: string; methods: readonly TrackingMethod[] }
const method = (id: string, name: string, module: string, guide: string, packageInstall = false): TrackingMethod => ({ id, name, module, guide: docs + guide, package: packageInstall });
const quest = [
  method("steamlink", "Steam Link", "SteamLink VRCFT Module", "vr/meta/quest-pro/steamlink"),
  method("vd", "Virtual Desktop", "Virtual Desktop", "vr/meta/quest-pro/virtual-desktop"),
  method("alvr", "ALVR", "ALVR Module", "vr/meta/quest-pro/alvr"),
  method("alxr", "ALXR", "ALXR Remote", "vr/meta/quest-pro/alxr"),
];
export const TRACKING_DEVICES: readonly TrackingDevice[] = [
  { id: "pico4-pro", name: "PICO 4 Pro / Enterprise", group: "headsets", tracking: "both", note: "pico", methods: [method("pico-connect", "PICO Connect", "Pico4SAFTExtTrackingModule", "vr/pico/pico4pe")] },
  { id: "quest-pro", name: "Meta Quest Pro", group: "headsets", tracking: "both", methods: quest },
  { id: "galaxy-xr", name: "Samsung Galaxy XR", group: "headsets", tracking: "both", hardwareGuide: docs + "vr/samsung/galaxy-xr", methods: [quest[1]!, quest[3]!] },
  { id: "vive-pro-eye", name: "VIVE Pro Eye", group: "headsets", tracking: "eyes", methods: [method("sranipal", "SRanipal", "SRanipalTrackingModule", "vr/vive/vpe")] },
  ...["VIVE Focus 3", "VIVE XR Elite", "VIVE Focus Vision"].map((name, index): TrackingDevice => ({ id: ["vive-focus3", "vive-xr-elite", "vive-focus-vision"][index]!, name, group: "headsets", tracking: "both", note: "accessory", methods: [method("vive-streaming", "VIVE Streaming", "ViveStreamingFaceTrackingModule", "vr/vive/focus3_xre")] })),
  { id: "varjo", name: "Varjo Aero / VR-3 / XR-3", group: "headsets", tracking: "eyes", methods: [method("varjo-base", "Varjo Base", "VRCFTVarjoModule", "vr/varjo")] },
  { id: "pimax-crystal", name: "Pimax Crystal / Super", group: "headsets", tracking: "eyes", note: "pimax", methods: [method("tobii", "PimaxPlay + BrokenEye", "VRCFT-Tobii-Advanced", "vr/pimax/pimax-crystal", true)] },
  { id: "psvr2", name: "PlayStation VR2", group: "headsets", tracking: "eyes", methods: [method("psvr2-toolkit", "PSVR2 Toolkit", "PSVR2 Toolkit VRCFT module", "vr/sony/psvr2")] },
  { id: "babble", name: "Project Babble", group: "addons", tracking: "face", methods: [method("babble", "Project Babble", "VRCFT-Babble", "addons/babble")] },
  { id: "eyetrackvr", name: "EyeTrackVR", group: "addons", tracking: "eyes", methods: [{ id: "etvr", name: "EyeTrackVR", module: "ETVR", guide: "https://docs.eyetrackvr.dev/software_guide/VRCFT_tracking_module" }] },
  { id: "vive-face", name: "VIVE Facial Tracker", group: "addons", tracking: "face", methods: [method("sranipal", "SRanipal", "SRanipalTrackingModule", "addons/vive/face-tracker")] },
  { id: "droolon", name: "Pimax Droolon Pi 1", group: "addons", tracking: "eyes", methods: [method("pitool", "PiTool + ASeeVR", "VRCFTPimaxModule", "addons/pimax/droolon-pi-1")] },
  { id: "iphone", name: "iPhone / iPad", group: "desktop", tracking: "both", note: "iphone", methods: [method("ifacialmocap", "iFacialMocap / FaceMotion3D", "iFacialMocap", "desktop/iphone/ifacialmocap-iphone"), method("livelink", "Live Link Face", "Live Link", "desktop/iphone/livelink")] },
  { id: "android", name: "Android · MeowFace", group: "desktop", tracking: "both", methods: [method("meowface", "MeowFace", "MeowFaceTrackingModule", "desktop/android/meowface")] },
  { id: "webcam", name: "Webcam / Camera · Project Babble", group: "desktop", tracking: "face", methods: [method("babble", "Project Babble", "VRCFT-Babble", "addons/babble")] },
];
export const TRACKING_STEPS = ["hardware", "module", "osc", "test"] as const;
export type TrackingStep = typeof TRACKING_STEPS[number];
export interface TrackingSetup { schemaVersion: 1; device: string; method: string; completed: TrackingStep[] }
export function trackingChoice(device: string, connection: string) {
  const hardware = TRACKING_DEVICES.find(d => d.id === device);
  const path = hardware?.methods.find(m => m.id === connection);
  return hardware && path ? { hardware, path } : null;
}
export function readTrackingSetup(text: string | null): TrackingSetup | null {
  try { const value = JSON.parse(text ?? "null") as TrackingSetup;
    return value?.schemaVersion === 1 && trackingChoice(value.device, value.method) && Array.isArray(value.completed)
      && value.completed.every(step => TRACKING_STEPS.includes(step)) && new Set(value.completed).size === value.completed.length
      ? { schemaVersion: 1, device: value.device, method: value.method, completed: value.completed } : null;
  } catch { return null; }
}
