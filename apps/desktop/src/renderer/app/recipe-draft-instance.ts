import { createGatewayClient, createRecipeDraftPort } from "../gateway/index.ts";
export const recipeDrafts = createRecipeDraftPort(createGatewayClient(typeof window === "undefined" ? undefined : window.vua));
