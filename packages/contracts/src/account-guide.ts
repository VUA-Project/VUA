/** Official account-guide handoffs v1. Only public starting pages cross this port. */
export const ACCOUNT_GUIDE_URLS = {
  steam: "https://store.steampowered.com/join/",
  vrchat: "https://vrchat.com/home/register",
  unity: "https://login.unity.com/en/sign-up",
  booth: "https://accounts.booth.pm/users/sign_in",
  linking: "https://help.vrchat.com/hc/en-us/articles/360062659053-I-want-to-turn-my-platform-account-through-Steam-Meta-Pico-or-Viveport-into-a-VRChat-account",
} as const;
export type AccountGuideIdV1 = keyof typeof ACCOUNT_GUIDE_URLS;

/** Main accepts a closed guide ID, never a renderer-supplied URL or credential. */
export function accountGuideDestination(value: unknown): string | null {
  return typeof value === "string" && Object.hasOwn(ACCOUNT_GUIDE_URLS, value)
    ? ACCOUNT_GUIDE_URLS[value as AccountGuideIdV1] : null;
}
