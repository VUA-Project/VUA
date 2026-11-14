import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isApplicationRequestV01 } from "./application-contract.js";
import { isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import {
  isManagerAppLaunchResultV02,
  isOpenManagerAppParamsV02,
} from "./manager-apps.js";

const vectors = JSON.parse(
  readFileSync(new URL("../../../schemas/manager-apps/v0.2/vectors.json", import.meta.url), "utf8"),
) as {
  validRequests: Record<string, unknown>[];
  invalidRequests: Record<string, unknown>[];
  validResults: Record<string, unknown>[];
  invalidResults: Record<string, unknown>[];
};

describe("manager-apps v0.2 contract guards", () => {
  it("pins environment.openManagerApp application requests to v0.2 vectors", () => {
    for (const req of vectors.validRequests) {
      expect(isApplicationRequestV01(req)).toBe(true);
      expect(isOpenManagerAppParamsV02(req.params)).toBe(true);
    }
    for (const req of vectors.invalidRequests) {
      expect(isApplicationRequestV01(req)).toBe(false);
    }
  });

  it("pins managerAppLaunch results to v0.2 vectors", () => {
    for (const res of vectors.validResults) {
      expect(isManagerAppLaunchResultV02(res)).toBe(true);
    }
    for (const res of vectors.invalidResults) {
      expect(isManagerAppLaunchResultV02(res)).toBe(false);
    }
  });

  it("validates DesktopGatewayRequestV1 for environment.openManagerApp", () => {
    expect(
      isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "gw-1",
        method: "environment.openManagerApp",
        params: { managerId: "alcom", commandId: "cmd-alcom-1" },
      }),
    ).toBe(true);
    expect(
      isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "gw-2",
        method: "environment.openManagerApp",
        params: { managerId: "alcom", commandId: "cmd-alcom-2", path: "C:/ALCOM.exe" },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "gw-3",
        method: "environment.openManagerApp",
        params: { managerId: "unknown", commandId: "cmd-alcom-3" },
      }),
    ).toBe(false);
  });
});
