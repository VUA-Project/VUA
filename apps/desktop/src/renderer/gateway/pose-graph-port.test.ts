import { describe, expect, it } from "vitest";
import type { DesktopGatewayRequestV1, GlbInspectionResultV01, PoseGraphResultV01, TermsUseCheckV01 } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { createLivePoseGraphPort } from "./pose-graph-port.ts";
import { createLiveLibraryBrowserPort } from "./library-browser-port.ts";
import { createTermsPort } from "./terms-port.ts";

describe("pose-graph, glb-inspection and terms gateway ports", () => {
  it("observes pose graph snapshot via environment.observePoseGraph", async () => {
    const calls: DesktopGatewayRequestV1[] = [];
    const payload: PoseGraphResultV01 = {
      poseGraph: {
        schemaVersion: "vua.pose-graph/v0.1",
        capturedAt: "2026-11-14T00:00:00Z",
        openxr: { presence: "found", runtimeName: "SteamVR OpenXR" },
        steamvrDrivers: ["space_calibrator", "slimevr"],
        blockedSteamvrDrivers: [],
        fbtDriverConflictRisk: "none",
        lastHeadsetHint: "Quest 3",
        poseSources: [
          { sourceId: "headset_6dof", state: "ready", detailCode: null },
          { sourceId: "slimevr", state: "active", detailCode: "process_running" },
          { sourceId: "pico_motion", state: "not_detected", detailCode: null },
          { sourceId: "lighthouse", state: "installed", detailCode: null },
          { sourceId: "space_calibrator", state: "ready", detailCode: "driver_registered" },
          { sourceId: "mocopi", state: "not_detected", detailCode: null },
          { sourceId: "haritorax", state: "not_detected", detailCode: null },
          { sourceId: "rebocap", state: "not_detected", detailCode: null },
          { sourceId: "eye_face_osc", state: "not_detected", detailCode: null },
        ],
      },
    };
    const client: GatewayClient = {
      async invoke(request) {
        calls.push(request);
        return { ok: true, value: payload };
      },
      subscribe: () => () => {},
    };
    const port = createLivePoseGraphPort(client);
    const snapshot = await port.observe();
    expect(calls[0]).toMatchObject({
      method: "environment.observePoseGraph",
      params: { schemaVersion: "0.1" },
    });
    expect(snapshot.openxr.runtimeName).toBe("SteamVR OpenXR");
    expect(snapshot.poseSources.find((s) => s.sourceId === "slimevr")?.state).toBe("active");
  });

  it("inspects GLB/VRM artifacts via library.inspectGlb", async () => {
    const calls: DesktopGatewayRequestV1[] = [];
    const payload: GlbInspectionResultV01 = {
      schemaVersion: "vua.glb-inspection/v0.1",
      truncated: false,
      items: [
        {
          copyId: "cpy-1",
          fileName: "Props/accessory.glb",
          sourceKind: "zip_member",
          containerFileName: "accessory_bundle.zip",
          sizeBytes: 2048,
          format: "glb_2_0",
          extensionsUsed: [],
          contentSummary: {
            meshCount: 1,
            primitiveCount: 1,
            triangleEstimate: 1200,
            skinCount: 0,
            nodeCount: 1,
            animationCount: 0,
          },
          materialSummary: {
            materialCount: 1,
            unlitMaterialCount: 0,
            mtoonMaterialCount: 0,
          },
          textureSummary: {
            textureCount: 0,
            embeddedImageCount: 0,
            externalUriTextureCount: 0,
          },
          secondaryMotion: {
            springBoneJointCount: 0,
            nodeConstraintCount: 0,
            expressionCount: 0,
          },
          vrm: null,
          boundsMeters: { size: [0.35, 0.40, 0.42], min: [-0.175, 0, -0.21], max: [0.175, 0.4, 0.21] },
        },
      ],
    };
    const client: GatewayClient = {
      async invoke(request) {
        calls.push(request);
        return { ok: true, value: payload };
      },
      subscribe: () => () => {},
    };
    const port = createLiveLibraryBrowserPort(client);
    const result = await port.inspectGlb!({ productId: "booth:12345" });
    expect(calls[0]).toMatchObject({
      method: "library.inspectGlb",
      params: { schemaVersion: "0.1", productId: "booth:12345" },
    });
    expect(result.items[0]?.format).toBe("glb_2_0");
    expect(result.items[0]?.sourceKind).toBe("zip_member");
  });

  it("checks VN3 presets via terms.checkUse v0.1", async () => {
    const calls: DesktopGatewayRequestV1[] = [];
    const payload: TermsUseCheckV01 = {
      schemaVersion: "0.1",
      presetId: "vrchat_personal",
      matchingProductIds: [],
      combination: {
        decision: "contact_licensor",
        blockingItems: [{ productId: "booth:12345", item: "X", termKey: null, reason: "special_note_unknown" }],
        conditions: [],
        advisories: [],
        hasSpecialNote: true,
        specialNotes: [{ productId: "booth:12345", sourceId: "src-1", language: "ja", text: "利用規約をご確認ください" }],
      },
      products: [
        {
          productId: "booth:12345",
          sourceState: "parsed",
          decision: "contact_licensor",
          blockingItems: [{ productId: "booth:12345", item: "X", termKey: null, reason: "special_note_unknown" }],
          conditions: [],
          advisories: [],
          hasSpecialNote: true,
          specialNotes: [{ productId: "booth:12345", sourceId: "src-1", language: "ja", text: "利用規約をご確認ください" }],
        },
      ],
    };
    const client: GatewayClient = {
      async invoke(request) {
        calls.push(request);
        return { ok: true, value: payload };
      },
      subscribe: () => () => {},
    };
    const port = createTermsPort(client);
    const check = await port.checkUse("vrchat_personal", ["booth:12345"]);
    expect(calls[0]).toMatchObject({
      method: "terms.checkUse",
      params: { schemaVersion: "0.1", presetId: "vrchat_personal", productIds: ["booth:12345"] },
    });
    expect(check.combination.hasSpecialNote).toBe(true);
  });
});
