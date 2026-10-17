/** Optional AMF frontend entry. Loaded only after the module is ready. */
import type { PageId } from "../../app/nav-model.ts";
import { WarehousePage } from "../warehouse/WarehousePage.tsx";
import { ControlRecipesPage } from "./ControlRecipesPage.tsx";
import { AmfProductionPage } from "./AmfProductionPage.tsx";
import { InspectionPage } from "../inspection/InspectionPage.tsx";
import { ReleaseAlbumPage } from "./release/ReleaseAlbumPage.tsx";
import { ControlPackagesPage } from "./ControlPackagesPage.tsx";
import { AssetBrowserPage } from "./AssetBrowserPage.tsx";
import { FactoryMap } from "./FactoryMap.tsx";
import { AmfRoom } from "./AmfRoom.tsx";
export default function AmfPages({ page, navigate, prepareEnv }: {
  page: PageId; creatorReady: boolean; navigate: (page: PageId) => void; prepareEnv: () => void;
}) {
  if (page === "avatar-hub") return <FactoryMap navigate={navigate} />;
  return <AmfRoom page={page} navigate={navigate}><RoomPage page={page} navigate={navigate} prepareEnv={prepareEnv} /></AmfRoom>;
}

function RoomPage({ page, navigate, prepareEnv }: { page: PageId; navigate: (page: PageId) => void; prepareEnv: () => void }) {
  switch (page) {
    case "asset-browser": return <AssetBrowserPage />;
    case "warehouse": return <WarehousePage onNavigate={navigate} />;
    case "recipe": return <ControlRecipesPage onNavigate={navigate} />;
    case "workshop": return <AmfProductionPage onPrepareEnv={prepareEnv} onNavigate={navigate} />;
    case "inspection": return <InspectionPage />;
    case "release": return <ReleaseAlbumPage onNavigate={navigate} />;
    case "packages": return <ControlPackagesPage onNavigate={navigate} />;
    default: return null;
  }
}
