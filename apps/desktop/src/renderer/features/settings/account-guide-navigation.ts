const UNITY_GUIDE_REQUEST = "vua-unity-license-guide-request";
/** A view hint only. Never grants account, installation or project authority. */
export function requestUnityLicenseGuide(): void { try { sessionStorage.setItem(UNITY_GUIDE_REQUEST, "unity"); } catch { /* The Unity card remains available. */ } }
export function consumeUnityLicenseGuide(): "unity" | null {
  try { const requested = sessionStorage.getItem(UNITY_GUIDE_REQUEST) === "unity"; sessionStorage.removeItem(UNITY_GUIDE_REQUEST); return requested ? "unity" : null; } catch { return null; }
}
