import { isAmfSharedRecipe } from "@vua/contracts";
/** Native I/O accepts the closed declaration, never caller-supplied file paths or arbitrary blobs. */
export function recipeTransferText(document: unknown): { fileText: string; shareCode: string } {
  if (!isAmfSharedRecipe(document)) throw new Error("amf_recipe_share_invalid");
  const compact = JSON.stringify(document);
  const fileText = JSON.stringify(document, null, 2);
  if (Buffer.byteLength(fileText, "utf8") > 262144) throw new Error("amf_recipe_share_too_large");
  return { fileText, shareCode: "vuar0.4." + Buffer.from(compact, "utf8").toString("base64url") };
}
