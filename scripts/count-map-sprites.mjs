#!/usr/bin/env node
/**
 * 统计地图素材池构成（地形 / 地貌带）。
 *
 * 存在理由：`docs/review/map-vs-reference-render-analysis.md` §9.5 记过一次事故 ——
 * 「雪原池只有 2 张」是凭印象写进文档的，实测是 7 张。素材数量这种**一条命令就能数出来**
 * 的事实，必须由脚本给数，不要靠回忆。
 *
 * 用法：
 *   node scripts/count-map-sprites.mjs
 *   node scripts/count-map-sprites.mjs --json     # 机器可读
 *
 * 数据来源：`sprites.ts` 里每条 `SpriteDef` 的 `terrains` 与 `zones` 字段。
 * 一个素材可属于多个地形 / 多个地貌带，因此各列之和 > 素材总数是正常的。
 *
 * 退出码：0 正常；1 解析不到任何素材（`SpriteDef` 结构变了，先改这里再谈别的）。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPRITES = resolve(ROOT, "src/windows/MapWindow/pages/MapEditorPage/sprites.ts");

/** 从一段 `{ id: "...", ... }` 里取出数组字段的字面量元素 */
function literalArray(block, field) {
  const m = new RegExp(`${field}\\s*:\\s*\\[([^\\]]*)\\]`).exec(block);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function count(sprites, field) {
  const out = new Map();
  for (const s of sprites) {
    const list = s[field] ?? [];
    for (const key of list) out.set(key, (out.get(key) ?? 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function main() {
  let source;
  try {
    source = readFileSync(SPRITES, "utf8");
  } catch {
    console.error(`读不到素材表：${SPRITES}`);
    process.exit(1);
  }

  // 以 `{ id: "` 切块：一条 SpriteDef 一行（或跨行），切到下一个 id 为止。
  // 同一文件里还有 `{ id: "mountain", label: ... }` 这类分类表条目，没有 `terrains`，
  // 用"必须带 terrains"把它筛掉 —— 否则总数会虚高（实测 57 vs 真实 52）。
  const chunks = source.split(/\{\s*id:\s*"/).slice(1);
  const sprites = chunks
    .filter((chunk) => /terrains\s*:/.test(chunk))
    .map((chunk) => ({
      id: chunk.slice(0, chunk.indexOf('"')),
      terrains: literalArray(chunk, "terrains") ?? [],
      zones: literalArray(chunk, "zones") ?? [],
    }));

  if (sprites.length === 0) {
    console.error("解析到 0 条素材 —— `SpriteDef` 的结构可能变了，先修本脚本的切块规则。");
    process.exit(1);
  }

  const byTerrain = count(sprites, "terrains");
  const byZone = count(sprites, "zones");
  const noZone = sprites.filter((s) => s.zones.length === 0).map((s) => s.id);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ total: sprites.length, byTerrain, byZone, noZone }, null, 2));
    return;
  }

  console.log(`素材总数：${sprites.length}`);
  console.log("\n按地形（terrains）：");
  for (const [k, v] of byTerrain) console.log(`  ${k.padEnd(12)} ${String(v).padStart(3)}`);
  console.log("\n按地貌带（zones，可多标签，故合计 > 总数）：");
  for (const [k, v] of byZone) console.log(`  ${k.padEnd(12)} ${String(v).padStart(3)}`);
  if (noZone.length > 0) {
    console.log(`\n未标地貌带：${noZone.join(", ")}`);
  }
  console.log(
    "\n提示：单档可用素材 < 10 时同屏重复率会肉眼可见（§7 L-7）。" +
      "扩池验收见 §9.2 的 `P1-5`。",
  );
}

main();
