import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isApplicationRequestV01 } from "./application-contract.js";
import { DESKTOP_GATEWAY_METHOD_KINDS, isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import {
  boothFreeAssetsBrowseUrl,
  FREE_ASSET_COOLDOWN_MS_V01,
  FREE_ASSET_DEFAULT_CATEGORY_IDS_V01,
  FREE_ASSET_MAX_ENABLED_KEYWORDS_V01,
  FREE_ASSET_MAX_STORED_KEYWORDS_V01,
  isFreeAssetKeywordV01,
  isFreeAssetsDesktopStatusV01,
  isFreeAssetsParamsV01,
  isFreeAssetsStateV01,
} from "./booth-free-assets-v01.js";

const vector = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../schemas/booth-free-assets/v0.1/examples/${name}.json`, import.meta.url),
      "utf8",
    ),
  );

describe("BOOTH free-assets v0.1 contract consumers", () => {
  for (const name of [
    "state.request",
    "update-preferences.request",
    "ingest-search-page.request",
    "invalid-source-url.request",
    "invalid-empty-prefs.request",
  ]) {
    it(name, () => {
      const request = vector(name);
      const valid = !name.startsWith("invalid");
      expect(isFreeAssetsParamsV01(request.method, request.params)).toBe(valid);
      expect(isApplicationRequestV01(request)).toBe(valid);

      const gatewayEnvelope = {
        schemaVersion: 1,
        requestId: request.requestId,
        method: request.method,
        params: request.params,
      };
      if (request.method === "freeAssets.ingestSearchPage") {
        // HTML ingestion is Main-owned transport, never an arbitrary renderer command.
        expect(isDesktopGatewayRequestV1(gatewayEnvelope)).toBe(false);
      } else {
        expect(isDesktopGatewayRequestV1(gatewayEnvelope)).toBe(valid);
      }
    });
  }

  it("maps gateway method kinds and closed response shapes", () => {
    expect(DESKTOP_GATEWAY_METHOD_KINDS["freeAssets.state"]).toBe("query");
    expect(DESKTOP_GATEWAY_METHOD_KINDS["freeAssets.updatePreferences"]).toBe("command");
    expect(FREE_ASSET_DEFAULT_CATEGORY_IDS_V01).toEqual(["209", "230", "231", "217", "214"]);
    expect(FREE_ASSET_MAX_STORED_KEYWORDS_V01).toBe(20);
    expect(FREE_ASSET_MAX_ENABLED_KEYWORDS_V01).toBe(5);
    expect(FREE_ASSET_COOLDOWN_MS_V01).toBe(300_000);

    const validState = vector("state.response");
    expect(isFreeAssetsStateV01(validState)).toBe(true);
    expect(isFreeAssetsStateV01(vector("invalid-foreign-thumbnail.response"))).toBe(false);
    expect(
      isFreeAssetsStateV01({
        ...validState,
        items: [{ ...validState.items[0], thumbnailUrl: "https://booth.pximg.net/c/300x300/a.jpg#leak" }],
      }),
    ).toBe(false);
    expect(
      isFreeAssetsStateV01({
        ...validState,
        items: [validState.items[0], validState.items[0]],
      }),
    ).toBe(false);
  });

  it("enforces keyword bounds, max 5 enabled keywords, browse URL matching, and desktop status shape", () => {
    expect(isFreeAssetKeywordV01("試作素体")).toBe(true);
    expect(isFreeAssetKeywordV01(" leading")).toBe(false);
    expect(isFreeAssetKeywordV01("")).toBe(false);
    expect(isFreeAssetKeywordV01("a".repeat(80))).toBe(true);
    expect(isFreeAssetKeywordV01("a".repeat(81))).toBe(false);
    expect(isFreeAssetKeywordV01("x\u0007y")).toBe(false);

    const sixEnabled = Array.from({ length: 6 }, (_, idx) => ({
      keyword: `Base${idx + 1}`,
      enabled: true,
    }));
    expect(
      isFreeAssetsParamsV01("freeAssets.updatePreferences", {
        schemaVersion: "0.1",
        watchedKeywords: sixEnabled,
      }),
    ).toBe(false);

    const ingest = vector("ingest-search-page.request").params;
    expect(boothFreeAssetsBrowseUrl("試作素体")).toBe(
      "https://booth.pm/ja/browse/3D%E3%83%A2%E3%83%87%E3%83%AB?q=%E8%A9%A6%E4%BD%9C%E7%B4%A0%E4%BD%93&max_price=0&sort=new&in_stock=true",
    );
    expect(isFreeAssetsParamsV01("freeAssets.ingestSearchPage", { ...ingest, keyword: "Other" })).toBe(false);
    expect(
      isFreeAssetsParamsV01("freeAssets.ingestSearchPage", {
        ...ingest,
        html: "猫".repeat(1_666_667),
      }),
    ).toBe(false);

    expect(
      isFreeAssetsDesktopStatusV01({
        schemaVersion: "0.1",
        running: true,
        currentKeyword: "SyntheticBaseA",
        completedKeywords: 1,
        totalKeywords: 3,
        cooldownUntilMs: null,
        lastError: null,
      }),
    ).toBe(true);
    expect(
      isFreeAssetsDesktopStatusV01({
        schemaVersion: "0.1",
        running: false,
        currentKeyword: null,
        completedKeywords: 0,
        totalKeywords: 0,
        cooldownUntilMs: null,
        lastError: "unknown_error",
      }),
    ).toBe(false);
  });
});
