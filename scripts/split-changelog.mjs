// 一次性拆分脚本：把 CHANGELOG.md 里较早的版本按「次版本」拆到 changeLogHistory/
// 用法：node scripts/split-changelog.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const mainPath = path.join(root, "CHANGELOG.md");
const archiveDir = path.join(root, "changeLogHistory");

/** 主文件行数上限：超过就继续把更老的次版本往前归档 */
const MAX_LINES = 800;

const source = readFileSync(mainPath, "utf8").replace(/\r\n/g, "\n");
const lines = source.split("\n");

/** 版本标题行：`## [1.46.1]` 或 `## [1.46.1] - 2026-10-19` */
const HEADING = /^## \[(\d+)\.(\d+)\.(\d+)\]/;

const heads = [];
lines.forEach((line, index) => {
  const m = HEADING.exec(line);
  if (m) {
    heads.push({
      index,
      version: `${m[1]}.${m[2]}.${m[3]}`,
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
    });
  }
});

if (heads.length === 0) throw new Error("CHANGELOG.md 里没有找到版本标题");

/** 版本块：从自己的标题行到下一个标题行之前 */
const blocks = heads.map((head, i) => ({
  ...head,
  text: lines
    .slice(head.index, i + 1 < heads.length ? heads[i + 1].index : lines.length)
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\s+$/, ""),
}));

/** 按次版本分组（次版本倒序，组内版本也倒序） */
const groups = new Map();
for (const block of blocks) {
  if (!groups.has(block.minor)) groups.set(block.minor, []);
  groups.get(block.minor).push(block);
}
const groupsDesc = [...groups.entries()].sort((a, b) => b[0] - a[0]);

/**
 * 保留策略：最近 2 个次版本为上限，但**以行数为准**——
 * 单个次版本动辄五六百行，只看「留两个次版本」仍会留下近千行主文件。
 * 因此从最新往里装，装到再加一个次版本就超过 MAX_LINES 为止
 * （最新那个无论多长都保留，否则主文件会空）。
 */
const HEADER_LINES = 6;
let keptMinorList = [];
let keptLineCount = HEADER_LINES;
for (const [minor, group] of groupsDesc) {
  const cost = group.reduce((sum, block) => sum + block.text.split("\n").length + 2, 0);
  if (keptMinorList.length > 0 && keptLineCount + cost > MAX_LINES) break;
  keptMinorList.push(minor);
  keptLineCount += cost;
}

const kept = new Set(keptMinorList);

const keptBlocks = blocks.filter((b) => kept.has(b.minor));
const archived = blocks.filter((b) => !kept.has(b.minor));

// 无需分流：主文件仍在 800 行以内、所有版本都在保留窗口内。
// 此时必须直接退出 —— 后续逻辑用 archived[0] 计算归档指针，空归档会抛 TypeError。
if (archived.length === 0) {
  console.log(
    `[split-changelog] 无需分流：${lines.length} 行（上限 ${MAX_LINES}），` +
      `${blocks.length} 个版本全部保留在主文件。`,
  );
  process.exit(0);
}

mkdirSync(archiveDir, { recursive: true });

// 按次版本分组写文件（同一文件的版本仍保持倒序）
const byMinor = new Map();
for (const block of archived) {
  if (!byMinor.has(block.minor)) byMinor.set(block.minor, []);
  byMinor.get(block.minor).push(block);
}

const written = [];
for (const [minor, group] of byMinor) {
  const name = `CHANGELOG-${group[0].major}.${minor}.md`;
  const file = path.join(archiveDir, name);
  const header = [
    `# Changelog · ${group[0].major}.${minor}.x`,
    "",
    "> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。",
    "> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。",
    "",
  ].join("\n");
  const body = group.map((b) => b.text).join("\n\n");
  writeFileSync(file, `${header}\n${body}\n`, "utf8");
  written.push({
    name,
    from: group[group.length - 1].version,
    to: group[0].version,
    count: group.length,
  });
}

const oldestKept = keptBlocks[keptBlocks.length - 1].version;
const newestArchived = archived[0].version;

const newMain = [
  "# Changelog",
  "",
  `> 历史归档：${oldestKept} 之前的版本已按次版本拆到 \`changeLogHistory/\``,
  `> （当前归档到 ${newestArchived}，索引见 \`changeLogHistory/README.md\`）。`,
  "> 主文件只保留最近若干个次版本，超过 800 行时按 AGENTS.md §8.6 继续分流。",
  "",
  ...keptBlocks.map((b) => b.text),
  "",
].join("\n");

writeFileSync(mainPath, newMain, "utf8");

console.log(
  JSON.stringify(
    {
      kept: keptBlocks.map((b) => b.version),
      archived: written.sort((a, b) => (a.name < b.name ? 1 : -1)),
      mainLines: newMain.split("\n").length,
    },
    null,
    2,
  ),
);
