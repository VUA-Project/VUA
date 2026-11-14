export const TOOL_CATALOG_SCHEMA_V01 = "vua.tool-catalog/v0.1" as const;

export const TOOL_GOAL_IDS_V01 = [
  "tracking",
  "translation",
  "utilities",
  "social",
  "capture",
] as const;
export type ToolGoalIdV01 = (typeof TOOL_GOAL_IDS_V01)[number];

export const TOOL_PRICE_TIERS_V01 = ["free", "paid_steam"] as const;
export type ToolPriceTierV01 = (typeof TOOL_PRICE_TIERS_V01)[number];

export const TOOL_DELIVERY_KINDS_V01 = [
  "steam",
  "official_installer",
  "planned_steam",
] as const;
export type ToolDeliveryKindV01 = (typeof TOOL_DELIVERY_KINDS_V01)[number];

export interface ToolCatalogEntryV01 {
  readonly id:
    | "vrcft"
    | "space"
    | "slimevr"
    | "vrcs"
    | "translator"
    | "vrct"
    | "advanced"
    | "toolkit"
    | "oyasumi"
    | "xsoverlay"
    | "desktopplus"
    | "fpsvr"
    | "vrcx"
    | "liv";
  readonly title: string;
  readonly goal: ToolGoalIdV01;
  readonly free: boolean;
  readonly priceTier: ToolPriceTierV01;
  readonly delivery: ToolDeliveryKindV01;
  readonly license: string;
  readonly officialUrl: string;
  readonly mcpStatusTool: "vua_tool_status" | "vua_installer_tool_status" | null;
}

export const TOOL_CATALOG_V01: readonly ToolCatalogEntryV01[] = [
  {
    id: "vrcft",
    title: "VRCFaceTracking",
    goal: "tracking",
    free: true,
    priceTier: "free",
    delivery: "steam",
    license: "Apache-2.0",
    officialUrl: "https://store.steampowered.com/app/3329480/",
    mcpStatusTool: "vua_tool_status",
  },
  {
    id: "space",
    title: "OpenVR Space Calibrator",
    goal: "tracking",
    free: true,
    priceTier: "free",
    delivery: "steam",
    license: "MIT",
    officialUrl: "https://store.steampowered.com/app/3368750/",
    mcpStatusTool: "vua_tool_status",
  },
  {
    id: "slimevr",
    title: "SlimeVR Server",
    goal: "tracking",
    free: true,
    priceTier: "free",
    delivery: "official_installer",
    license: "MIT OR Apache-2.0",
    officialUrl: "https://github.com/SlimeVR/SlimeVR-Server",
    mcpStatusTool: "vua_installer_tool_status",
  },
  {
    id: "vrcs",
    title: "VRCS",
    goal: "translation",
    free: true,
    priceTier: "free",
    delivery: "official_installer",
    license: "AGPL-3.0",
    officialUrl: "https://github.com/Dreaminko/VRCS",
    mcpStatusTool: "vua_installer_tool_status",
  },
  {
    id: "translator",
    title: "OVR Overlay Translator",
    goal: "translation",
    free: false,
    priceTier: "paid_steam",
    delivery: "steam",
    license: "Proprietary (Steam)",
    officialUrl: "https://store.steampowered.com/app/4304620/",
    mcpStatusTool: "vua_tool_status",
  },
  {
    id: "vrct",
    title: "VRCT",
    goal: "translation",
    free: true,
    priceTier: "free",
    delivery: "official_installer",
    license: "MIT",
    officialUrl: "https://github.com/misyaguziya/VRCT",
    mcpStatusTool: "vua_installer_tool_status",
  },
  {
    id: "advanced",
    title: "OVR Advanced Settings",
    goal: "utilities",
    free: false,
    priceTier: "paid_steam",
    delivery: "steam",
    license: "GPL-3.0 (Paid Steam)",
    officialUrl: "https://store.steampowered.com/app/1009850/",
    mcpStatusTool: "vua_tool_status",
  },
  {
    id: "toolkit",
    title: "OVR Toolkit",
    goal: "utilities",
    free: false,
    priceTier: "paid_steam",
    delivery: "steam",
    license: "Proprietary (Steam)",
    officialUrl: "https://store.steampowered.com/app/1068820/",
    mcpStatusTool: "vua_tool_status",
  },
  {
    id: "oyasumi",
    title: "OyasumiVR",
    goal: "utilities",
    free: true,
    priceTier: "free",
    delivery: "steam",
    license: "MIT",
    officialUrl: "https://store.steampowered.com/app/2538150/",
    mcpStatusTool: "vua_tool_status",
  },
  {
    id: "xsoverlay",
    title: "XSOverlay",
    goal: "utilities",
    free: false,
    priceTier: "paid_steam",
    delivery: "planned_steam",
    license: "Proprietary (Steam)",
    officialUrl: "https://store.steampowered.com/app/1173510/",
    mcpStatusTool: null,
  },
  {
    id: "desktopplus",
    title: "Desktop+",
    goal: "utilities",
    free: true,
    priceTier: "free",
    delivery: "steam",
    license: "GPL-3.0",
    officialUrl: "https://store.steampowered.com/app/1494460/",
    mcpStatusTool: "vua_tool_status",
  },
  {
    id: "fpsvr",
    title: "fpsVR",
    goal: "utilities",
    free: false,
    priceTier: "paid_steam",
    delivery: "steam",
    license: "Proprietary (Steam)",
    officialUrl: "https://store.steampowered.com/app/908520/",
    mcpStatusTool: "vua_tool_status",
  },
  {
    id: "vrcx",
    title: "VRCX",
    goal: "social",
    free: true,
    priceTier: "free",
    delivery: "official_installer",
    license: "MIT",
    officialUrl: "https://github.com/vrcx-team/VRCX",
    mcpStatusTool: "vua_installer_tool_status",
  },
  {
    id: "liv",
    title: "LIV",
    goal: "capture",
    free: true,
    priceTier: "free",
    delivery: "planned_steam",
    license: "Proprietary (Free Steam base)",
    officialUrl: "https://store.steampowered.com/app/755540/",
    mcpStatusTool: null,
  },
] as const;

export const TOOL_CATALOG_BY_ID_V01: Readonly<Record<ToolCatalogEntryV01["id"], ToolCatalogEntryV01>> =
  Object.fromEntries(TOOL_CATALOG_V01.map(entry => [entry.id, entry])) as Readonly<
    Record<ToolCatalogEntryV01["id"], ToolCatalogEntryV01>
  >;

export function filterToolCatalogV01(options?: {
  readonly goal?: ToolGoalIdV01 | "all";
  readonly freeOnly?: boolean;
}): readonly ToolCatalogEntryV01[] {
  const goal = options?.goal ?? "all";
  const freeOnly = options?.freeOnly === true;
  return TOOL_CATALOG_V01.filter(
    entry => (goal === "all" || entry.goal === goal) && (!freeOnly || entry.free),
  );
}
