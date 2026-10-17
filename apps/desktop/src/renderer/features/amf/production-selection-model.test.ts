import { describe, expect, it } from "vitest";
import type { AmfProductionRun, AmfPrefab } from "../../gateway/index.ts";
import { initialProductionSelection, updateOutfitSelection } from "./production-selection-model.ts";

const prefab = (sourceId:string,path:string,isAvatar=false):AmfPrefab => ({sourceId,path,name:path,isAvatar,hasSkinnedMesh:true,hasMergeArmature:false,hasMissingScripts:false,humanoidBones:[]});
const run = (prefabs:readonly AmfPrefab[]):AmfProductionRun => ({schemaVersion:"0.1",runId:"n3-test",phase:"ready",taskId:"task",editor:{path:"Unity.exe",version:"2022.3.22f1"},projectRoot:"C:/Work",
  choices:[],sources:[{sourceId:"avatar",role:"auto",itemName:"Avatar",name:"avatar.unitypackage",sha256:"a"},{sourceId:"outfit",role:"auto",itemName:"Coat",name:"outfit.unitypackage",sha256:"b"}],
  prefabs,steps:[],selection:null,error:null,recovery:null,result:null,snapshotId:null});
describe("Unity-observed material preselection", () => {
  it("skips unnecessary questions only for unique observed candidates", () => {
    const selected = initialProductionSelection(run([prefab("avatar","Assets/Avatar.prefab",true),prefab("outfit","Assets/Coat.prefab")]));
    expect(selected.avatarPrefab).toBe("Assets/Avatar.prefab"); expect(selected.outfits[0]?.prefabPath).toBe("Assets/Coat.prefab");
  });
  it("keeps ambiguity explicit for multiple Avatars and outfit variants", () => {
    const selected = initialProductionSelection(run([prefab("avatar","Assets/A.prefab",true),prefab("avatar","Assets/B.prefab",true),prefab("outfit","Assets/Coat-A.prefab"),prefab("outfit","Assets/Coat-B.prefab")]));
    expect(selected.avatarPrefab).toBe(""); expect(selected.outfits).toEqual([]);
  });
  it("never automatically attaches a static prop or a prefab with missing scripts", () => {
    const selected = initialProductionSelection(run([prefab("avatar","Assets/A.prefab",true),{...prefab("outfit","Assets/Prop.prefab"),hasSkinnedMesh:false}]));
    expect(selected.outfits).toEqual([]);
    expect(initialProductionSelection(run([{...prefab("avatar","Assets/A.prefab",true),hasMissingScripts:true}])).avatarPrefab).toBe("");
  });
  it("keeps a reopened confirmed selection rather than deriving a new one", () => {
    const retained = {avatarPrefab:"Assets/A.prefab",outfits:[]};
    expect(initialProductionSelection({...run([]),selection:retained})).toBe(retained);
  });
  it("continues from current Unity settings instead of replaying an older reviewed selection", () => {
    const previous = initialProductionSelection(run([prefab("avatar","Assets/A.prefab",true),prefab("outfit","Assets/Coat.prefab")]));
    const observed = {...previous,outfits:previous.outfits.map(o=>({...o,toggleName:"Edited in Unity",active:false}))};
    const reopened = {...run([]),selection:previous,result:{facts:{sdkDescriptorRecognized:true,missingReferences:0,avatarName:"Avatar",instances:[],observedSelection:observed}}};
    expect(initialProductionSelection(reopened)).toBe(observed);
  });
  it("removes only the explicitly deselected outfit", () => {
    const initial = initialProductionSelection(run([prefab("avatar","Assets/A.prefab",true),prefab("outfit","Assets/Coat.prefab")]));
    expect(updateOutfitSelection(initial,"outfit",null)).toEqual({avatarPrefab:initial.avatarPrefab,outfits:[]});
  });
});
