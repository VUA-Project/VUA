import { describe,expect,it } from "vitest";
import { editorEnvironment } from "./amf-editor-handoff.js";
describe("SDK handoff environment",()=>{
  it("retains OS paths and excludes inherited application credentials",()=>{
    const env=editorEnvironment({PATH:"system",LOCALAPPDATA:"profile",BOOTH_TOKEN:"private",GITHUB_TOKEN:"private",GH_TOKEN:"private",OPENAI_API_KEY:"private",CUSTOM_SECRET:"private",SESSION_COOKIE:"private"});
    expect(env).toEqual({PATH:"system",LOCALAPPDATA:"profile"});
  });
});
