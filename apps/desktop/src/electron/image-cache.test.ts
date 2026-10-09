import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  root: "", handler: null as null | ((request: { url: string }) => Promise<Response>),
  resize: vi.fn(), fetch: vi.fn(), decode: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => mocks.root },
  nativeImage: { createFromBuffer: mocks.decode },
  net: { fetch: mocks.fetch },
  protocol: { handle: (_scheme: string, handler: typeof mocks.handler) => { mocks.handler = handler; }, registerSchemesAsPrivileged: vi.fn() },
}));
import { importLocalThumbnail, registerImageCacheProtocol } from "./image-cache.js";
afterEach(async () => {
  if (mocks.root) await rm(mocks.root, { recursive: true, force: true });
  mocks.root = ""; vi.clearAllMocks();
});
describe("Kernel local thumbnail cache", () => {
  it("copies a bounded thumbnail, survives repeated reads and rejects arbitrary local paths", async () => {
    mocks.root = await mkdtemp(path.join(os.tmpdir(), "vua-thumbnail-test-"));
    const source = path.join(mocks.root, "original.png");
    await writeFile(source, "synthetic original");
    const image = { isEmpty: () => false, getSize: () => ({ width: 1024, height: 512 }), resize: mocks.resize, toPNG: () => Buffer.from("synthetic resized png") };
    mocks.resize.mockReturnValue(image); mocks.decode.mockReturnValue(image);
    const ref = await importLocalThumbnail(source);
    expect(ref).toMatch(/^vua-img:\/\/local\/[a-f0-9]{64}$/);
    expect(mocks.resize).toHaveBeenCalledWith({ width: 512, height: 256 });
    await registerImageCacheProtocol();
    expect(await (await mocks.handler!({ url: ref })).text()).toBe("synthetic resized png");
    expect(await (await mocks.handler!({ url: ref })).text()).toBe("synthetic resized png");
    expect(await readFile(source, "utf8")).toBe("synthetic original");
    for (const url of ["vua-img://local/../../private.png", ref + "?file=private", "vua-img://local/" + "b".repeat(64)]) {
      expect((await mocks.handler!({ url })).status).toBeGreaterThanOrEqual(400);
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects undecodable content without returning an image reference", async () => {
    mocks.root = await mkdtemp(path.join(os.tmpdir(), "vua-thumbnail-test-"));
    const source = path.join(mocks.root, "invalid.png"); await writeFile(source, "not an image");
    mocks.decode.mockReturnValue({ isEmpty: () => true });
    await expect(importLocalThumbnail(source)).rejects.toThrow("thumbnail_invalid");
  });
});
