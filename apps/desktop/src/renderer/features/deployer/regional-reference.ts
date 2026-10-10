import type { WebsiteObservation } from "@vua/contracts";

/** Public regional service origins, not VRChat/Photon room endpoints.
 * Region locations and API origins checked against Oracle's docs on 2026-10-11.
 * The native adapter pins these origins and does not follow their redirects. */
export const REGIONAL_REFERENCES = [
  { id: "usw", url: "https://objectstorage.us-sanjose-1.oraclecloud.com/" },
  { id: "use", url: "https://objectstorage.us-ashburn-1.oraclecloud.com/" },
  { id: "jp", url: "https://objectstorage.ap-tokyo-1.oraclecloud.com/" },
  { id: "eu", url: "https://objectstorage.eu-amsterdam-1.oraclecloud.com/" },
] as const;
export type RegionalReference = typeof REGIONAL_REFERENCES[number];

/** An anonymous HEAD to the service root normally returns 404 with no body.
 * That is a timed response, not a successful API call. Redirects, rate limits
 * and transport failures never become a regional latency number. */
export function referenceElapsed(reference: RegionalReference, observation?: WebsiteObservation): number | null {
  if (!observation || observation.url !== reference.url) return null;
  return observation.status === "reachable" || (observation.status === "http_error" && observation.httpStatus === 404)
    ? observation.elapsedMs : null;
}
