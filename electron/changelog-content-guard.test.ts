/**
 * CHANGELOG 条目形态守卫（AGENTS.md §8.6「CHANGELOG 条目规范」）。
 *
 * 只校验主文件 CHANGELOG.md 的**版本块**：`changeLogHistory/` 是只读归档，分流时逐字
 * 搬运，不受本节约束；第一个版本标题之前是主文件指针区，由 changelog-archive-guard
 * 负责，这里跳过。
 *
 * 与 changelog-archive-guard.test.ts 的分工：那份管体积 / 边界 / 指针 / 索引，
 * 这份管「写了什么、怎么写」。两条一起才拦得住「规则写了没人查」。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relative: string): string {
  return readFileSync(path.resolve(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

const MAIN = read("CHANGELOG.md");
const AGENTS = read("AGENTS.md");
const LINES = MAIN.split("\n");

const VERSION_HEADING = /^## \[(\d+)\.(\d+)\.(\d+)\] - (\d{4}-\d{2}-\d{2})$/;
const SECTIONS = ["### 新增", "### 修改", "### 删除"];
const SECTION_SET = new Set(SECTIONS);
const MAX_ENTRY_CHARS = 80;

/**
 * 过程性文本的强特征词。功能描述里不会用到；命中即说明写的是「为什么 / 怎么查 /
 * 查到什么」，而不是「做了什么」。改动词表必须同步 AGENTS.md §8.6。
 */
const BANNED_WORDS = [
  "用户三问", "用户四问", "用户裁决", "用户指认", "用户截图", "用户反馈", "用户指令",
  "取证", "实测", "根因", "踩坑", "为什么", "证据", "截图", "decoded.js",
  "待用户", "下一批", "仍需对齐", "全绿", "用例数", "测试条数",
  "tsc", "eslint", "vitest", "ALGN-", "R-MAP-", "同 seed", "教训", "待办",
];

/** 论证句开头：条目必须以功能描述起手 */
const ARGUMENT_PREFIX = /^(因为|所以|但|而是|不是|其实|另外|此外|注意|其中|也就是说|⚠️)/;

interface Block {
  heading: string;
  line: number;
  body: string[];
}

function versionBlocks(): Block[] {
  const heads: number[] = [];
  LINES.forEach((line, index) => {
    if (/^## /.test(line)) heads.push(index);
  });
  return heads.map((start, index) => ({
    heading: LINES[start],
    line: start + 1,
    body: LINES.slice(start + 1, index + 1 < heads.length ? heads[index + 1] : LINES.length),
  }));
}

const BLOCKS = versionBlocks();

function label(block: Block, offset: number): string {
  return `${block.heading} 第 ${block.line + offset} 行`;
}

/** 收集后一次性断言，失败信息里能一次看全所有违规点 */
function expectNone(violations: string[], hint: string): void {
  expect(violations, `${hint}：\n${violations.join("\n")}`).toEqual([]);
}

describe("CHANGELOG 版本块结构（守卫）", () => {
  it("每个版本标题都是 `## [X.Y.Z] - YYYY-MM-DD`", () => {
    expect(BLOCKS.length, "主文件里找不到版本块").toBeGreaterThan(0);
    const bad = BLOCKS.filter((block) => !VERSION_HEADING.test(block.heading))
      .map((block) => `第 ${block.line} 行：${block.heading}`);
    expectNone(bad, "版本标题格式不合规");
  });

  it("版本按倒序排列", () => {
    const keys = BLOCKS.map((block) => {
      const match = VERSION_HEADING.exec(block.heading);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
    });
    const bad: string[] = [];
    for (let i = 1; i < keys.length; i += 1) {
      const prev = keys[i - 1];
      const curr = keys[i];
      const descending = prev[0] > curr[0]
        || (prev[0] === curr[0] && prev[1] > curr[1])
        || (prev[0] === curr[0] && prev[1] === curr[1] && prev[2] > curr[2]);
      if (!descending) bad.push(`${BLOCKS[i - 1].heading} 之后紧跟 ${BLOCKS[i].heading}`);
    }
    expectNone(bad, "版本没有从新到旧排列");
  });

  it("每个版本块的章节只允许 `### 新增` / `### 修改` / `### 删除`", () => {
    const bad: string[] = [];
    for (const block of BLOCKS) {
      const sections = block.body
        .map((line, offset) => ({ line, offset }))
        .filter(({ line }) => /^### /.test(line));
      if (sections.length === 0) bad.push(`${label(block, 0)}：一个章节都没有`);
      for (const section of sections) {
        if (!SECTION_SET.has(section.line)) {
          bad.push(`${label(block, section.offset + 1)}：不允许的章节 ${section.line}`);
        }
      }
    }
    expectNone(bad, "章节白名单被突破");
  });

  it("每个章节至少有一条记录", () => {
    const bad: string[] = [];
    for (const block of BLOCKS) {
      block.body.forEach((line, offset) => {
        if (!/^### /.test(line)) return;
        const next = block.body.slice(offset + 1).find((candidate) => candidate.trim() !== "");
        if (next === undefined || !/^- /.test(next)) {
          bad.push(`${label(block, offset + 1)}：${line} 下面没有条目`);
        }
      });
    }
    expectNone(bad, "存在空章节");
  });
});

describe("CHANGELOG 条目形态（守卫）", () => {
  it("版本块内不出现引用块 / 表格 / 代码块（用户对话与实测对照的载体）", () => {
    const bad: string[] = [];
    for (const block of BLOCKS) {
      block.body.forEach((line, offset) => {
        if (/^\s*>/.test(line) || /^\s*\|/.test(line) || /^\s*```/.test(line)) {
          bad.push(`${label(block, offset + 1)}：${line.trim()}`);
        }
      });
    }
    expectNone(bad, "版本块里混入了过程性内容");
  });

  it("每条记录都是单行、无缩进子项、无续行", () => {
    const bad: string[] = [];
    for (const block of BLOCKS) {
      block.body.forEach((line, offset) => {
        const trimmed = line.trim();
        if (trimmed === "" || /^### /.test(line)) return;
        if (/^\s+- /.test(line)) bad.push(`${label(block, offset + 1)}：嵌套子项 ${trimmed}`);
        else if (!/^- /.test(line)) bad.push(`${label(block, offset + 1)}：非条目行 ${trimmed}`);
      });
    }
    expectNone(bad, "记录必须是单行 `- ` 条目");
  });

  it(`每条记录不超过 ${MAX_ENTRY_CHARS} 字`, () => {
    const bad: string[] = [];
    for (const block of BLOCKS) {
      block.body.forEach((line, offset) => {
        if (!/^- /.test(line)) return;
        const text = line.slice(2).trim();
        if (text.length === 0) bad.push(`${label(block, offset + 1)}：空条目`);
        if (text.length > MAX_ENTRY_CHARS) {
          bad.push(`${label(block, offset + 1)}：${text.length} 字 → ${text}`);
        }
      });
    }
    expectNone(bad, "条目过长（写成了论证段落）");
  });

  it("条目不含过程性词表与论证句开头", () => {
    const bad: string[] = [];
    for (const block of BLOCKS) {
      block.body.forEach((line, offset) => {
        if (!/^- /.test(line)) return;
        const text = line.slice(2).trim();
        const hit = BANNED_WORDS.find((word) => text.includes(word));
        if (hit) bad.push(`${label(block, offset + 1)}：命中「${hit}」→ ${text}`);
        if (ARGUMENT_PREFIX.test(text)) bad.push(`${label(block, offset + 1)}：论证句开头 → ${text}`);
      });
    }
    expectNone(bad, "条目写成了过程记录");
  });

  it("规范与守卫同源：AGENTS.md §8.6 写明三类章节、字数上限与本守卫", () => {
    for (const section of SECTIONS) {
      expect(AGENTS, `AGENTS.md §8.6 缺少 ${section}`).toContain(section);
    }
    expect(AGENTS).toContain(`${MAX_ENTRY_CHARS} 字`);
    expect(AGENTS).toContain("electron/changelog-content-guard.test.ts");
  });
});
