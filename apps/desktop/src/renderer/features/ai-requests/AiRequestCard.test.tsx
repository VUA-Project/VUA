import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AiActionRequestV01 } from "@vua/contracts";
import { format, strings } from "../../i18n/index.ts";
import { AiRequestCard } from "./AiRequestCard.tsx";

function buildRequest(
  tool: string,
  parameters: Record<string, unknown>,
  reviewed: Record<string, unknown> | null = null,
): AiActionRequestV01 {
  return {
    id: `${tool}-req`,
    tool,
    title: tool,
    explanation: "",
    expectedResult: "",
    createdAt: "2026-11-14T10:00:00.000Z",
    state: "pending",
    details: { parameters, reviewed },
  };
}

function splitReviewAndTechnical(markup: string): { visible: string; technical: string } {
  const detailsIdx = markup.indexOf("<details");
  expect(detailsIdx).toBeGreaterThan(0);
  return {
    visible: markup.slice(0, detailsIdx),
    technical: markup.slice(detailsIdx),
  };
}

describe("AiRequestCard Review concrete facts for MCP write tools", () => {
  it("renders target cache limits for vua_request_update_client_config", () => {
    const html = renderToStaticMarkup(
      <AiRequestCard
        request={buildRequest("vua_request_update_client_config", {
          cacheSizeGb: 60,
          cacheExpiryDelayDays: 45,
        })}
        busy={false}
      />,
    );
    const { visible } = splitReviewAndTechnical(html);
    expect(visible).toContain(strings.aiTools.clientConfigHeading);
    expect(visible).toContain(format(strings.aiTools.cacheSizeTarget, { gb: 60 }));
    expect(visible).toContain(format(strings.aiTools.cacheExpiryTarget, { days: 45 }));
  });

  it("renders cached OSC file count for vua_request_clear_osc_cache", () => {
    const html = renderToStaticMarkup(
      <AiRequestCard
        request={buildRequest(
          "vua_request_clear_osc_cache",
          {},
          { localDiagnostics: { osc: { avatarConfigCount: 14 } } },
        )}
        busy={false}
      />,
    );
    const { visible } = splitReviewAndTechnical(html);
    expect(visible).toContain(format(strings.aiTools.oscFilesToDelete, { count: 14 }));
  });

  it("renders source folder basename, group names and file counts for vua_request_library_import_groups while keeping full path in technical details", () => {
    const rootPath = "D:\\CreatorDownloads\\AutumnCollection";
    const html = renderToStaticMarkup(
      <AiRequestCard
        request={buildRequest(
          "vua_request_library_import_groups",
          {
            groups: [
              {
                name: "SampleCoat",
                root: rootPath,
                files: [{ path: "SampleCoat.unitypackage", bytes: 1024, modifiedMs: 100 }],
              },
              {
                name: "SampleBoots",
                root: rootPath,
                files: [
                  { path: "SampleBoots.unitypackage", bytes: 2048, modifiedMs: 100 },
                  { path: "Readme.txt", bytes: 128, modifiedMs: 100 },
                ],
              },
            ],
          },
          {
            groupCount: 2,
            fileCount: 3,
            groupNames: ["SampleCoat", "SampleBoots"],
          },
        )}
        busy={false}
      />,
    );
    const { visible, technical } = splitReviewAndTechnical(html);
    expect(visible).toContain("AutumnCollection");
    expect(visible).not.toContain("D:\\CreatorDownloads\\AutumnCollection");
    expect(visible).toContain(format(strings.aiTools.importSummaryCounts, { groups: 2, files: 3 }));
    expect(visible).toContain("SampleCoat");
    expect(visible).toContain("SampleBoots");
    expect(technical).toContain("<code>D:\\CreatorDownloads\\AutumnCollection</code>");
  });

  it("renders target outfit name for vua_request_amf_outfit_remove", () => {
    const html = renderToStaticMarkup(
      <AiRequestCard
        request={buildRequest(
          "vua_request_amf_outfit_remove",
          { runId: "run-1", sourceId: "src-coat" },
          {
            outfitSource: {
              sourceId: "src-coat",
              role: "outfit",
              name: "WinterJacket.unitypackage",
              itemName: "WinterJacketSet",
            },
          },
        )}
        busy={false}
      />,
    );
    const { visible } = splitReviewAndTechnical(html);
    expect(visible).toContain(strings.aiTools.outfitToRemove);
    expect(visible).toContain("WinterJacket");
    expect(visible).toContain(format(strings.aiTools.fromItem, { item: "WinterJacketSet" }));
  });

  it("renders platform, target rank and texture count for vua_request_amf_texture_apply", () => {
    const html = renderToStaticMarkup(
      <AiRequestCard
        request={buildRequest("vua_request_amf_texture_apply", {
          runId: "run-1",
          platform: "android",
          targetRank: "good",
          textures: ["Assets/Tex/Coat_Main.png", "Assets/Tex/Coat_Normal.png", "Assets/Tex/Boots_Main.png"],
        })}
        busy={false}
      />,
    );
    const { visible } = splitReviewAndTechnical(html);
    expect(visible).toContain(strings.aiTools.texturePlanHeading);
    expect(visible).toContain(
      format(strings.aiTools.texturePlanSummary, {
        platform: strings.aiTools.texturePlatforms.android,
        rank: strings.aiTools.textureRanks.good,
        count: 3,
      }),
    );
  });

  it("renders material count for vua_request_amf_lighting_apply", () => {
    const html = renderToStaticMarkup(
      <AiRequestCard
        request={buildRequest("vua_request_amf_lighting_apply", {
          runId: "run-1",
          materials: ["Assets/Mat/Coat.mat", "Assets/Mat/Skirt.mat"],
        })}
        busy={false}
      />,
    );
    const { visible } = splitReviewAndTechnical(html);
    expect(visible).toContain(strings.aiTools.lightingPlanHeading);
    expect(visible).toContain(format(strings.aiTools.lightingPlanSummary, { count: 2 }));
  });
});
