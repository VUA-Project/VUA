/** The one directory: the sidebar, the search and the theme address bar all read these names.
 * Play comes first; Avatar work follows its order, from materials to the finished Avatar, then
 * what supports it. A page has one name everywhere. */
import type { IconName } from "@vua/design-system";
import type { AppSectionId, PageId } from "../../app/nav-model.ts";
import { currentLocale, strings } from "../../i18n/index.ts";
import { structureCopy } from "../../i18n/structure-copy.ts";

export interface DirectoryItem {
  readonly id: PageId;
  readonly title: string;
  readonly icon: IconName;
  /** Further pages this entry stays selected on. */
  readonly pages?: readonly PageId[];
}

const journey = strings.journey;
const factory = strings.factory;
const unitySetup = structureCopy[currentLocale].unitySetup;

export const directory: Readonly<Record<"env" | "production", readonly DirectoryItem[]>> = {
  env: [
    { id: "env-play", title: journey.launchPage, icon: "anim" },
    { id: "tools-discover", title: journey.tools, icon: "tools" },
  ],
  production: [
    { id: "warehouse", title: factory.rooms.materials.name, icon: "folder" },
    { id: "asset-browser", title: factory.tabs.browse, icon: "search" },
    { id: "workshop", title: factory.rooms.workshop.name, icon: "avatar" },
    { id: "release", title: strings.nav.pages.release, icon: "anim" },
    { id: "recipe", title: factory.tabs.recipes, icon: "edit" },
    { id: "packages", title: factory.tabs.packages, icon: "modules" },
    { id: "env-create", title: unitySetup, icon: "flask" },
  ],
};

export const directoryGroupLabel = (group: keyof typeof directory): string =>
  group === "env" ? journey.play : journey.avatar;

/** The name a page goes by in links from outside the directory. */
export function directoryPageTitle(page: PageId): string {
  const item = [...directory.env, ...directory.production].find(entry => entry.id === page);
  if (item) return item.title;
  return page === "settings-accounts" ? strings.nav.pages.settingsAccounts : page === "home" ? journey.home : page;
}

/** Unity setup works without AMF, so its owner stays the environment even though it reads as Avatar work. */
export function presentedModule(page: PageId, owner: AppSectionId): AppSectionId {
  return page === "env-create" ? "production" : owner;
}

export const directoryItemSelected = (item: DirectoryItem, page: PageId): boolean =>
  item.id === page || (item.pages?.includes(page) ?? false);
