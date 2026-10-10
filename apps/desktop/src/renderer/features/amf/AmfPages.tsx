/** Optional AMF frontend entry. Loaded only after the module is ready. */
import type { PageId } from "../../app/nav-model.ts";
import { WarehousePage } from "../warehouse/WarehousePage.tsx";
import { RecipePage } from "../recipe/RecipePage.tsx";
import { WorkshopPage } from "../workshop/WorkshopPage.tsx";
import { InspectionPage } from "../inspection/InspectionPage.tsx";
import { ReleasePage } from "../release/ReleasePage.tsx";
import { PackagesPage } from "../packages/PackagesPage.tsx";
import { AssetBrowserPage } from "./AssetBrowserPage.tsx";
export default function AmfPages({ page, creatorReady, navigate, prepareEnv }: {
  page: PageId; creatorReady: boolean; navigate: (page: PageId) => void; prepareEnv: () => void;
}) {
  switch (page) {
    case "asset-browser": return <AssetBrowserPage />;
    case "warehouse": return <WarehousePage onNavigate={navigate} />;
    case "recipe": return <RecipePage />;
    case "workshop": return <WorkshopPage envReady={creatorReady} onPrepareEnv={prepareEnv} onNavigate={navigate} />;
    case "inspection": return <InspectionPage />;
    case "release": return <ReleasePage onNavigate={navigate} />;
    case "packages": return <PackagesPage />;
    default: return null;
  }
}
