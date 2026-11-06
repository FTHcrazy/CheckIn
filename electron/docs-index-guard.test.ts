/**
 * 文档索引与元信息守卫（2026-11-06，R-MAP-DOC 批次收口配套）
 *
 * 【为什么需要它】本轮把 `docs/` 的事实一致性系统性修了一遍，修出来的每一类错都不是
 * 「笔误」，而是**没有任何机制阻止下一个人再写一遍**：
 *   - 版本号三处互不一致：总览文首 2.32.0、`docs/README.md` 2.30.0、`package.json` 2.36.0；
 *   - 能力计数自相矛盾：§0 写「12 已闭环 + 2 部分」，§1 表实际 13 ✅ + 1 ◐；
 *   - 索引里查不到的文档（`ai-implementation-review-2.10.0.md` 存在但 README 无行）；
 *   - 四篇 `nested-submap-*` 缺「输入 / 基线」两行，读者无法判断它是否过期。
 *
 * 【钉什么】只钉「机器可判定、判错必然意味着文档坏了」的四件事：
 *   ① **索引双向**：`docs/` 下每篇文档都在 `docs/README.md` 索引里；索引里每条相对链接
 *      都真实存在。索引是唯一导航入口（§5.3.4-2），单向都不行。
 *   ② **头部三行**：非 `archive/` 文档必须有 `> 状态` / `> 输入` / `> 基线`（§5.3.2-3）。
 *   ③ **体裁词表**：非 `archive/` 文档不得以 `-prd.md` 结尾 —— §5.3.2-1 的九词表里
 *      没有 `prd`，它是历史遗留词，不要继续扩散。
 *   ④ **引用无悬空**：全仓 `docs/...md` 引用不得出现**新增**悬空（§5.3.4-1）。
 *   ⑤ **形态描述与实物一致**：`AGENTS.md` §5.3.5 目录树里的「合计 N 篇 md」必须等于实物篇数。
 *      这条是 2026-11-06 加的：该节原来只列 3 篇（实际 47 篇），而「当前落地形态」一旦失真，
 *      比任何单篇文档的笔误都更容易误导人——它是规范的自我例证。
 *
 * 【明确不钉什么】—— 这三条是刻意放弃的，不是遗漏：
 *   - **不钉用例数真值**（如「750 用例」）：它只能实跑 vitest 得出，写死在测试里就是
 *     第二事实源，每加一条用例都要改测试，且改的时候没人核对真实性。
 *   - **不钉「文档基线 == package.json version」**：`基线` 的语义是「本篇订立时对应的
 *     代码版本」（历史事实），不是「跟随最新版本」。强制相等会让每次发版都要改十几篇
 *     历史文档，改完反而丢掉订立时的事实。唯一入口 `map-window-overview.md` 的基线
 *     跟随工作区，那条靠 review 保证。
 *   - **不钉 `archive/`**：归档只读（§5.3.3）。旧文件名、旧头部、旧路径都是历史证据。
 *
 * 【白名单纪律】下面三张白名单**只许删、不许加**。想加一条之前先回答：这是「历史欠债」
 * 还是「我刚写错了」？后者必须改文档，不是加白名单。
 *
 * 【判据不能自己命中自己】本批踩过三次这个坑（`grep "10 个能力域"` 命中判据描述本身、
 * `2.30.0` 是 B4-2 的真实发布版本号、死链基线里的路径被写进测试文件）。所以本文件
 * 在扫描引用时**排除自身**，基线用 `Set` 而非在正文里逐行罗列注释。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DOCS_DIR = path.resolve(ROOT, "docs");
const README_REL = "docs/README.md";
const SELF_REL = "electron/docs-index-guard.test.ts";

/** 文档头部三行的键名（§5.3.2-3） */
const HEAD_KEYS = ["状态", "输入", "基线"] as const;
/** 头部三行只在前若干行内认（正文里出现同名前缀不算） */
const HEAD_SCAN_LINES = 15;

/** §5.3.2-1 的体裁词表（九词，固定） */
const GENRE_VOCAB = [
  "scope",
  "preresearch",
  "acceptance",
  "analysis",
  "architecture-decision",
  "delta",
  "batch-plan",
  "review",
  "spec",
] as const;

/**
 * 白名单 ②：非 archive 但缺头部三行的**历史欠债**（2026-11-06 实测 7 篇）。
 *
 * 为什么不一并补：它们全在 novel / AI 域，不属本轮地图批次的边界；补头部需要逐篇
 * 核实「输入是哪篇、订立时基线是多少」，凭猜填进去比缺着更糟。
 * 补完任意一篇 → 必须从此表删除（否则本测试会在「该删未删」上失效）。
 */
const HEAD_MISSING_ALLOWED = new Set<string>([
  "docs/prd/prd-ai-roadmap/ai-future-directions-prd.md",
  "docs/prd/prd-ai-roadmap/ai-roadmap-architecture-review.md",
  "docs/prd/prd-ai-roadmap/ai-roadmap-batch-plan.md",
  "docs/review/ai-implementation-review-2.10.0.md",
  "docs/review/map-vs-reference-render-analysis.md", // 只缺「基线」
  "docs/review/novel-design-review.md",
  "docs/review/novel-product-review.md",
]);

/**
 * 白名单 ③：非 archive 但以 `-prd.md` 结尾的**历史遗留名**（2026-11-06 实测 2 篇）。
 *
 * `map-b4-layers-polyline-prd.md` 改名要动全仓引用，收益远小于风险，随它下次归档消失；
 * `ai-future-directions-prd.md` 同理。**新增文档不许再进这张表。**
 */
const PRD_SUFFIX_ALLOWED = new Set<string>([
  "docs/prd/prd-ai-roadmap/ai-future-directions-prd.md",
  "docs/prd/prd-map-render/map-b4-layers-polyline-prd.md",
]);

/**
 * 白名单 ④：2026-11-06 基线的悬空引用集合。
 *
 * 这些**不是漏修**，而是 `docs/README.md` 历史表里对已删除文档的**有意引用**
 * （「已彻底删除（勿再引用）」表本身就是引用它们来说明为什么删）、以及归档前旧路径的
 * 记录。§5.3.4-1 的判定条款明确：`CHANGELOG.md` / `changeLogHistory/` 的历史路径故意
 * 不改，`docs/archive/**` 正文保留旧路径。
 *
 * 断言形态是「实际悬空 ⊆ 本集合」，所以这份基线**只会越来越宽松地过期**：将来有人
 * 真把某篇补回来，不需要动它；但任何人新制造一条悬空路径，本测试立刻红。
 */
const DANGLING_BASELINE = new Set<string>([
  "docs/design-global-setting-window-redesign.md",
  "docs/design/global-setting-center-design.md",
  "docs/novel-audit-report.md",
  "docs/novel-design-review.md",
  "docs/novel-editor-prd.md",
  "docs/novel-map-architecture-research.md",
  "docs/novel-map-art-brief.md",
  "docs/novel-map-prd.md",
  "docs/novel-map-quality-roadmap.md",
  "docs/novel-map-style-spec.md",
  "docs/novel-onboarding-prd.md",
  "docs/novel-pack-window-review-2026-10-12.md",
  "docs/novel-product-review.md",
  "docs/novel-ui-requirements.md",
  "docs/novel-window-review.md",
  "docs/pack-dashboard-prd.md",
  "docs/prd-global-setting-window-redesign.md",
  "docs/prd/global-setting-center-prd.md",
  "docs/prd/prd-map-render/architecture.md",
  "docs/prd/prd-map-render/prd-map-render-alignment.md",
]);

/** 引用源扫描面：与 §5.3.4-1 的 grep 一致（`docs/**`、`src/**` 注释、根文档、`*.yaml`） */
const SCAN_ROOTS = ["docs", "src", "electron", "scripts"];
const SCAN_ROOT_FILES = ["AGENTS.md", "README.md"];
const SCAN_EXTS = new Set([".md", ".ts", ".tsx", ".yaml", ".yml"]);
/** 与 grep 的 `--exclude-dir` 对齐（按目录名，任意层级匹配） */
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-electron",
  "release",
  "changeLogHistory",
  "archive",
  ".workbuddy",
  "coverage",
]);

function toRel(absPath: string): string {
  return path.relative(ROOT, absPath).split(path.sep).join("/");
}

function read(relPath: string): string {
  return readFileSync(path.resolve(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}

function walkDocs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDocs(full, acc);
    else if (entry.name.endsWith(".md")) acc.push(toRel(full));
  }
  return acc;
}

function walkForRefs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walkForRefs(full, acc);
      continue;
    }
    if (SCAN_EXTS.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

/** `docs/` 下全部 md（含 README.md 自身，调用方按需排除） */
const ALL_DOCS = walkDocs(DOCS_DIR).sort();

/**
 * README 里的相对链接 → 仓库相对路径。
 *
 * 只认 `.md` 且非 http(s)、非纯锚点。README 的链接一律相对 `docs/` 书写
 * （`spec/x.md`、`review/x.md`、`prd/...`），所以以 docs 为基准解析。
 */
function readmeLinkTargets(): string[] {
  const text = read(README_REL);
  const pattern = /\]\((?!https?:|#)([^)\s]+?\.md)(?:#[^)]*)?\)/g;
  const targets: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const raw = match[1];
    if (!raw) continue;
    targets.push(path.posix.normalize(path.posix.join("docs", raw)));
  }
  return [...new Set(targets)].sort();
}

/** 文档头部的三行（只在前 HEAD_SCAN_LINES 行内认，避免正文里的同名引用块误判） */
function missingHeadKeys(relPath: string): string[] {
  const head = read(relPath).split("\n").slice(0, HEAD_SCAN_LINES);
  return HEAD_KEYS.filter((key) => !head.some((line) => line.startsWith(`> ${key}`)));
}

/** 非归档目录的文档（归档只读，不参与 ② ③ 两条断言） */
function isArchived(relPath: string): boolean {
  return relPath.startsWith("docs/archive/");
}

/**
 * 从一条文本里抽出 `docs/...` 形式的 `.md` 引用。
 *
 * 【为什么路径段必须以字母数字/下划线/连字符开头】文档里描述这条规则时天然会写
 * 「`docs/...md` 引用」这种占位写法，宽松的 `docs/[A-Za-z0-9._/-]*\.md` 会把**占位符
 * 本身**当成一条悬空路径 —— 本批第四次踩「判据自己命中自己」。要求首段以 `[A-Za-z0-9_-]`
 * 开头，`...md` 就不匹配了。
 *
 * 结尾限定 `.md`，避免把 `docs/spec/map-db-spec.md:23` 这类「文件:行号」的行号吃进路径。
 */
const DOC_REF = /docs\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.md/g;

function danglingRefs(): string[] {
  const sources: string[] = [];
  for (const rel of SCAN_ROOT_FILES) {
    const abs = path.resolve(ROOT, rel);
    if (existsSync(abs)) sources.push(abs);
  }
  for (const root of SCAN_ROOTS) {
    const abs = path.resolve(ROOT, root);
    if (existsSync(abs)) walkForRefs(abs, sources);
  }

  const missing = new Set<string>();
  for (const abs of sources) {
    const rel = toRel(abs);
    if (rel === SELF_REL) continue; // 判据不能自己命中自己
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(DOC_REF)) {
      const target = match[0];
      if (!existsSync(path.resolve(ROOT, target))) missing.add(target);
    }
  }
  return [...missing].sort();
}

describe("docs 索引与元信息", () => {
  it("① 索引双向：docs 下每篇文档都在 README 索引里", () => {
    const indexed = new Set(readmeLinkTargets());
    const unindexed = ALL_DOCS.filter((rel) => rel !== README_REL && !indexed.has(rel));

    // 失败时给出可直接照抄的补行清单，而不是让人自己 grep
    expect(unindexed, `以下文档存在但 README 查不到索引行：\n${unindexed.join("\n")}`).toEqual([]);
  });

  it("① 索引双向：README 每条链接都指向真实文件", () => {
    const ghosts = readmeLinkTargets().filter((rel) => !existsSync(path.resolve(ROOT, rel)));

    expect(ghosts, `README 指向不存在的文件：\n${ghosts.join("\n")}`).toEqual([]);
  });

  it("② 非归档文档必须有头部三行（状态 / 输入 / 基线）", () => {
    const offenders = ALL_DOCS.filter((rel) => rel !== README_REL && !isArchived(rel))
      .map((rel) => ({ rel, missing: missingHeadKeys(rel) }))
      .filter((item) => item.missing.length > 0 && !HEAD_MISSING_ALLOWED.has(item.rel));

    const detail = offenders.map((item) => `${item.rel} 缺：${item.missing.join(" / ")}`);
    expect(detail, `以下文档缺头部三行（§5.3.2-3 强制项）：\n${detail.join("\n")}`).toEqual([]);
  });

  it("② 白名单只许删不许加：已补齐的条目必须从白名单移除", () => {
    // 反过来校验白名单没有「已经补好了却还挂着」的僵尸条目——否则白名单会慢慢变成垃圾桶，
    // 将来真出现缺失时容易被顺手加进去。
    const stillMissing = [...HEAD_MISSING_ALLOWED].filter(
      (rel) => existsSync(path.resolve(ROOT, rel)) && missingHeadKeys(rel).length > 0,
    );
    const zombie = [...HEAD_MISSING_ALLOWED].filter((rel) => !stillMissing.includes(rel));

    expect(zombie, `以下条目已补齐（或文件已删），请从 HEAD_MISSING_ALLOWED 删除：\n${zombie.join("\n")}`).toEqual(
      [],
    );
  });

  it("③ 非归档文档不得以 -prd.md 结尾（prd 不在体裁词表里）", () => {
    const offenders = ALL_DOCS.filter(
      (rel) =>
        !isArchived(rel) &&
        rel.endsWith("-prd.md") &&
        !PRD_SUFFIX_ALLOWED.has(rel),
    );

    expect(
      offenders,
      `§5.3.2-1 的体裁词表只有：${GENRE_VOCAB.join(" / ")}。以下新文档用了已废弃的 -prd 后缀：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("③ 白名单只许删不许加：已归档或已改名的条目必须移除", () => {
    const zombie = [...PRD_SUFFIX_ALLOWED].filter(
      (rel) => !existsSync(path.resolve(ROOT, rel)) || !rel.endsWith("-prd.md"),
    );

    expect(zombie, `以下条目已不存在或已改名，请从 PRD_SUFFIX_ALLOWED 删除：\n${zombie.join("\n")}`).toEqual([]);
  });

  it("④ 全仓 docs 引用不得新增悬空", () => {
    const actual = danglingRefs();
    const fresh = actual.filter((rel) => !DANGLING_BASELINE.has(rel));

    // 只报「新增」的那几条：历史 20 条是 README 历史表的有意引用，不该每次都刷满输出
    expect(fresh, `以下引用指向不存在的文档（§5.3.4-1 禁悬空）：\n${fresh.join("\n")}`).toEqual([]);
  });

  it("⑤ AGENTS §5.3.5 声明的文档总数与实物一致", () => {
    // 「当前落地形态」是规范的自我例证：它写 3 篇而实际 47 篇时，读者会以为规范没落地。
    // 把这句话绑到实物上，新增/删除文档时会被迫同步，成本只有改一个数字。
    const match = /合计 (\d+) 篇 md/.exec(read("AGENTS.md"));
    if (!match) {
      throw new Error("AGENTS.md §5.3.5 目录树必须保留「合计 N 篇 md」这句（本守卫依赖它定位数字）");
    }

    expect(
      Number(match[1]),
      `AGENTS.md §5.3.5 声明 ${match[1]} 篇，docs/ 下实为 ${ALL_DOCS.length} 篇`,
    ).toBe(ALL_DOCS.length);
  });
});
