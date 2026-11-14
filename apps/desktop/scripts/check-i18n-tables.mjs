/**
 * i18n 多表一致性校验(C-I18N):
 * 源语言 en 与已交付语言表之间的运行期对齐检查——
 * - 键集合:TS 的 Strings 宽化类型已在编译期强制,这里复核运行期产物;
 * - 插值参数:每条字符串的 {placeholder} 集合必须与源表完全一致;
 * - 数组条目(guide pages 的 sections 等):长度与元素 id 集合对齐。
 * 任一不对齐即非零退出。
 */
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { strings as en } from "../src/renderer/i18n/strings.en.ts";
import { localeRegistry } from "../src/renderer/i18n/locales.ts";

const localeModules = {
  "zh-CN": () => import("../src/renderer/i18n/strings.zh-CN.ts"),
  "zh-TW": () => import("../src/renderer/i18n/strings.zh-TW.ts"),
  ja: () => import("../src/renderer/i18n/strings.ja.ts"),
  ko: () => import("../src/renderer/i18n/strings.ko.ts"),
};

const placeholderPattern = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

function placeholdersOf(value) {
  return [...value.matchAll(placeholderPattern)].map((match) => match[1]).sort();
}

let violations = 0;

function report(path, message) {
  violations += 1;
  console.error(`${path}: ${message}`);
}

/** 递归比对:对象逐键、数组逐索引、字符串比占位符集合 */
function compareTables(source, target, path) {
  if (typeof source === "string") {
    if (typeof target !== "string") {
      report(path, `目标不是字符串(${typeof target})`);
      return;
    }
    const sourceParams = placeholdersOf(source);
    const targetParams = placeholdersOf(target);
    if (sourceParams.join(",") !== targetParams.join(",")) {
      report(path, `插值参数不对齐:源 {${sourceParams}} / 目标 {${targetParams}}`);
    }
    return;
  }
  if (Array.isArray(source)) {
    if (!Array.isArray(target)) {
      report(path, "目标不是数组");
      return;
    }
    if (source.length !== target.length) {
      report(path, `数组长度不对齐:源 ${source.length} / 目标 ${target.length}`);
      return;
    }
    source.forEach((item, index) => {
      const key = typeof item === "object" && item !== null && "id" in item ? `[id=${item.id}]` : `[${index}]`;
      compareTables(item, target[index], `${path}${key}`);
    });
    return;
  }
  if (source !== null && typeof source === "object") {
    if (target === null || typeof target !== "object" || Array.isArray(target)) {
      report(path, "目标不是对象");
      return;
    }
    for (const key of Object.keys(source)) {
      if (!(key in target)) {
        report(`${path}.${key}`, "目标缺键");
        continue;
      }
      compareTables(source[key], target[key], `${path}.${key}`);
    }
    for (const key of Object.keys(target)) {
      if (!(key in source)) report(`${path}.${key}`, "目标多键");
    }
  }
}

const availableTargets = localeRegistry.filter(
  (entry) => entry.available && entry.id !== "en",
);

for (const entry of availableTargets) {
  const loader = localeModules[entry.id];
  if (!loader) {
    report(entry.id, "注册表标记 available 但脚本未登记语言表模块");
    continue;
  }
  const { strings } = await loader();
  compareTables(en, strings, entry.id);
}

const i18nDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/renderer/i18n");
const targetIds = availableTargets.map((entry) => entry.id);
let sidecarCount = 0;

for (const fileName of readdirSync(i18nDir).sort()) {
  if (!fileName.endsWith(".ts") || fileName.endsWith(".test.ts") || fileName.startsWith("strings.")) {
    continue;
  }
  const mod = await import(pathToFileURL(resolve(i18nDir, fileName)).href);
  for (const [exportName, value] of Object.entries(mod)) {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !Object.hasOwn(value, "en") ||
      !targetIds.some((id) => Object.hasOwn(value, id))
    ) {
      continue;
    }
    sidecarCount += 1;
    for (const id of targetIds) {
      if (!Object.hasOwn(value, id)) {
        report(`${fileName}#${exportName}[${id}]`, "缺失交付语言分支");
        continue;
      }
      compareTables(value.en, value[id], `${fileName}#${exportName}[${id}]`);
    }
  }
}

if (violations > 0) {
  console.error(`\ncheck-i18n-tables: ${violations} 处多表不一致`);
  process.exit(1);
}
console.log(
  `check-i18n-tables: OK — ${availableTargets.length} 个交付语言表与 ${sidecarCount} 个分表全部对齐`,
);
