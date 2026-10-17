import { parseSync } from "vite";
/** Enforce real dependency calls, including commented/escaped calls, without
 * mistaking a code-generation string for an executable module dependency. */
export function assertBundledRuntime(source, entry) {
  const syntax = parseSync(`${entry}.cjs`, source);
  if (syntax.errors.length) throw new Error(`${entry}: bundle syntax could not be checked`);
  const inspect = node => {
    if (!node || typeof node !== "object" || typeof node.type !== "string") return;
    const callee = node.callee;
    const requireCall = callee?.type === "Identifier" && ["require", "__require"].includes(callee.name)
      || callee?.type === "MemberExpression" && (callee.property?.name === "require" || callee.property?.value === "require");
    if (node.type === "CallExpression" && requireCall) {
      const argument = node.arguments[0];
      if (node.arguments.length !== 1 || argument?.type !== "Literal" || typeof argument.value !== "string") throw new Error(`${entry}: unresolved dynamic runtime dependency`);
      const dependency = argument.value;
      if (dependency !== "electron" && (entry === "preload" || !dependency.startsWith("node:"))) throw new Error(`${entry}: unexpected unbundled runtime dependency ${dependency}`);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(inspect);
      else inspect(value);
    }
  };
  inspect(syntax.program);
}
