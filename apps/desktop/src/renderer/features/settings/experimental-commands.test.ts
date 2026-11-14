import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { strings } from "../../i18n/index.ts";
import { EacExperimentalSection } from "./experimental-commands.tsx";

const { gateway } = vi.hoisted(() => ({
  gateway: {
    environment: {
      eac: {
        getExperimentalTermination: vi.fn(() => Promise.resolve({ enabled: false })),
        setExperimentalTermination: vi.fn((enabled: boolean) => Promise.resolve({ enabled })),
      },
    },
  },
}));

vi.mock("../../gateway/index.ts", () => ({
  useGateway: () => gateway,
  useAcquireView: () => ({ kind: "empty" }),
}));

describe("EacExperimentalSection", () => {
  it("renders the experimental EAC residual termination toggle off by default", () => {
    const html = renderToStaticMarkup(createElement(EacExperimentalSection));
    expect(html).toContain('data-nav-id="experimental-eac-section"');
    expect(html).toContain(strings.eac.experimental.title);
    expect(html).toContain('aria-checked="false"');
  });
});
