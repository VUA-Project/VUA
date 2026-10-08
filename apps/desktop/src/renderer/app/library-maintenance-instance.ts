import { createGatewayClient, createLibraryMaintenancePort } from "../gateway/index.ts";
export const libraryMaintenance = createLibraryMaintenancePort(createGatewayClient(typeof window === "undefined" ? undefined : window.vua));
