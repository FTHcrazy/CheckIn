/**
 * CHANGELOG 分流守卫（2.2.0）
 *
 * 钉住 2.2.0 分流时的一次真实事故：`scripts/split-changelog.mjs` 的分组键只用了数字
 * `minor`，于是 `1.46` 排在 `2.0` 前面 —— 1.46 被当成「最新次版本」留在主文件，
 * 2.0.0 反而被归档，主文件指针写成「归档到 2.0.0」却只保留 1.46.1 之后，自相矛盾且
 * 全程没有任何报错。规则见 AGENTS.md §8.6：按 **`major.minor`** 分组、主文件只留最新次版本。
 *
 * 这里不看脚本实现（改写法不算违约），只钉住产物必须满足的三条不变量：
 * ① 主文件里最旧的次版本**严格新于**每个归档文件的次版本；
 * ② 主文件顶部指针的两端（归档边界 / 最新归档版本）与真实文件一致；
 * ③ 归档文件里的版本全部属于文件名声明的 `major.minor`，索引表也登记了该文件。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ARCHIVE_DIR = path.resolve(ROOT, "changeLogHistory");

function read(relative: string): string {
  return readFileSync(path.resolve(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

interface Version {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

const HEADING = /^## \[(\d+)\.(\d+)\.(\d+)\]/;

function versions(text: string): Version[] {
  return text
    .split("\n")
    .map((line) => HEADING.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      raw: `${match[1]}.${match[2]}.${match[3]}`,
    }));
}

/** 次版本序：先比 major 再比 minor；补丁号不影响归属 */
function compareMinor(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor;
}

/**
 * 版本序：major → minor → patch 三段都比。
 *
 * 【为什么必须有它】指针测试要找"主文件里**最旧的那个版本**"，而 `compareMinor`
 * 在补丁号上判平 —— `reduce` 遇到并列时保留**先出现的**（即同一 minor 里最高补丁），
 * 于是主文件里最旧的次版本若有多个补丁（实测 2.9.2 / 2.9.1 / 2.9.0），指针会被
 * 要求写成「2.9.2 之前」，而归档边界实际是 **2.9.0**（2.9.0 与 2.9.1 都还在主文件里）。
 * 那不是"更严格的断言"，而是断言了错的东西：`scripts/split-changelog.mjs` 写的是
 * `keptBlocks[last].version`，即 2.9.0，本来就是对的口径。
 * 这条 bug 只有在「最旧次版本含多个补丁」时才暴露 —— 2.17.2 这一批正好踩到。
 */
function compareVersion(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

const MAIN = read("CHANGELOG.md");
const MAIN_VERSIONS = versions(MAIN);

const ARCHIVES = readdirSync(ARCHIVE_DIR)
  .map((name) => /^CHANGELOG-(\d+)\.(\d+)\.md$/.exec(name))
  .filter((match): match is RegExpExecArray => match !== null)
  .map((match) => ({
    name: match[0],
    major: Number(match[1]),
    minor: Number(match[2]),
    versions: versions(read(path.join("changeLogHistory", match[0]))),
  }));

describe("CHANGELOG 分流产物（守卫）", () => {
  it("主文件有版本、归档有文件，且每份归档都能解析出版本", () => {
    expect(MAIN_VERSIONS.length).toBeGreaterThan(0);
    expect(ARCHIVES.length).toBeGreaterThan(10);
    for (const archive of ARCHIVES) {
      expect(archive.versions.length, `${archive.name} 里没有版本标题`).toBeGreaterThan(0);
    }
  });

  it("主文件保留的次版本严格新于每一个归档文件的次版本", () => {
    const oldestKept = MAIN_VERSIONS.reduce((min, item) =>
      compareMinor(item, min) < 0 ? item : min,
    );
    for (const archive of ARCHIVES) {
      const newer = oldestKept.major > archive.major || (oldestKept.major === archive.major && oldestKept.minor > archive.minor);
      expect(
        newer,
        `主文件里还留着 ${oldestKept.raw}，而 ${archive.name} 是更新的次版本 ` +
          `${archive.major}.${archive.minor}.x —— 分组键要按 major.minor，不能只比 minor`,
      ).toBe(true);
    }
  });

  it("主文件顶部的归档指针与真实边界一致", () => {
    // 指针的"归档边界"是主文件里**最旧的那个版本**（含补丁号），见 compareVersion
    const oldestKept = MAIN_VERSIONS.reduce((min, item) =>
      compareVersion(item, min) < 0 ? item : min,
    );
    const newestArchived = ARCHIVES.flatMap((archive) => archive.versions).reduce((max, item) =>
      compareVersion(item, max) > 0 ? item : max,
    );
    expect(MAIN).toContain(`历史归档：${oldestKept.raw} 之前的版本`);
    expect(MAIN).toContain(`当前归档到 ${newestArchived.raw}`);
  });

  it("归档文件只装自己那一段次版本，且已登记到索引", () => {
    const index = read("changeLogHistory/README.md");
    for (const archive of ARCHIVES) {
      for (const version of archive.versions) {
        expect(
          `${version.major}.${version.minor}`,
          `${archive.name} 里混进了 ${version.raw}`,
        ).toBe(`${archive.major}.${archive.minor}`);
      }
      expect(index, `索引里缺 ${archive.name}`).toContain(`\`${archive.name}\``);
    }
  });

  it("索引表登记的归档文件都真实存在（不留断链）", () => {
    const index = read("changeLogHistory/README.md");
    const listed = [...index.matchAll(/`(CHANGELOG-[\d.\-a-z]+\.md)`/g)].map((match) => match[1]);
    expect(listed.length).toBeGreaterThan(10);
    for (const name of new Set(listed)) {
      expect(existsSync(path.join(ARCHIVE_DIR, name)), `索引指向了不存在的 ${name}`).toBe(true);
    }
  });
});

/**
 * 体积上限（AGENTS.md §8.6「触发条件：超过 **800 行** 必须分流」）。
 *
 * 【为什么单列一组】上面那组只校验**产物关系**（边界 / 指针 / 索引 / 混装），
 * 不校验**体积**。这两件事是独立的：只要没人主动跑 `scripts/split-changelog.mjs`，
 * 边界依然自洽 —— 主文件从 2.9 一路长到 2308 行，上面 5 条测试全程是绿的。
 * 实测代价：一份 2308 行的 CHANGELOG 读完就吃掉半个上下文窗口，而绝大多数会话
 * 只想查一条旧记录。也就是说「规则写了」和「规则被检查」之间缺的就是这一组。
 *
 * 这里的 4 条都是**会真的失败**的断言，不是文档性描述：
 * ① 主文件 ≤ 800 行（超了就强制跑分流脚本）；
 * ② 每份归档文件也 ≤ 800 行 —— 否则「整本主文件搬进一个归档文件」也算"分流"，
 *    本质只是换了个文件名；
 * ③ 上限只有一个出处：脚本常量 / 主文件指针 / 本测试常量三者一致，
 *    改数字必须三处同改（只改一处会在下次分流时静默改写指针文案）；
 * ④ 分流幂等：同一个版本不能既在主文件又在归档里（脚本重跑、手工搬运都会踩）。
 */
describe("CHANGELOG 体积上限（守卫）", () => {
  /** 与 `scripts/split-changelog.mjs` 的 `MAX_LINES` 必须相同，见第 ③ 条 */
  const MAX_LINES = 800;

  /**
   * 按 `wc -l` 的口径数行：末尾那个换行符不算一行。
   * 脚本里用的是 `split("\n").length`（末尾空串也计入，恒多 1），所以阈值留在这
   * 两种口径都不会误伤 —— 800 是上限而不是目标值。
   */
  function lineCount(text: string): number {
    const body = text.endsWith("\n") ? text.slice(0, -1) : text;
    return body.split("\n").length;
  }

  it(`主文件不超过 ${MAX_LINES} 行`, () => {
    const lines = lineCount(MAIN);
    expect(
      lines,
      `CHANGELOG.md 已经 ${lines} 行（上限 ${MAX_LINES}）：先跑 \`node scripts/split-changelog.mjs\` ` +
        `分流，再补 changeLogHistory/README.md 的索引。不要把它留到下一次改动`,
    ).toBeLessThanOrEqual(MAX_LINES);
  });

  it(`每份归档文件不超过 ${MAX_LINES} 行（整本搬进一个文件不算分流）`, () => {
    for (const archive of ARCHIVES) {
      const lines = lineCount(read(path.join("changeLogHistory", archive.name)));
      expect(
        lines,
        `${archive.name} 有 ${lines} 行，超过 ${MAX_LINES}：归档要按次版本切，不能一次性平移`,
      ).toBeLessThanOrEqual(MAX_LINES);
    }
  });

  it("上限只有一处出处：脚本常量 / 主文件指针 / 本测试常量一致", () => {
    const script = read("scripts/split-changelog.mjs");
    const declared = /const MAX_LINES = (\d+);/.exec(script);
    expect(declared, "scripts/split-changelog.mjs 里找不到 `const MAX_LINES = <数字>;`").not.toBeNull();
    expect(
      Number(declared?.[1]),
      "脚本的 MAX_LINES 与本守卫的常量不一致：改上限要同时改 AGENTS.md §8.6、脚本、本测试",
    ).toBe(MAX_LINES);
    // 主文件顶部指针由脚本生成，文案里硬编码了这个数字；改常量却忘了改文案，
    // 下次分流会静默把一个错的上限写进主文件
    expect(MAIN, "主文件顶部指针没有写明行数上限").toContain(`超过 ${MAX_LINES} 行`);
  });

  it("分流幂等：同一个版本不会同时出现在主文件与归档里", () => {
    const owner = new Map<string, string>();
    const duplicates: string[] = [];
    const claim = (raw: string, where: string) => {
      const previous = owner.get(raw);
      if (previous) duplicates.push(`${raw}：${previous} 与 ${where}`);
      else owner.set(raw, where);
    };
    for (const version of MAIN_VERSIONS) claim(version.raw, "CHANGELOG.md");
    for (const archive of ARCHIVES) {
      for (const version of archive.versions) claim(version.raw, archive.name);
    }
    expect(duplicates, `同一个版本被登记了两次：\n${duplicates.join("\n")}`).toEqual([]);
  });

  it("归档目录里没有按补丁号单独成文件的违规命名", () => {
    // §8.6 第 2 条：补丁号不单独成文件，跟着次版本走。
    // `CHANGELOG-1.0-to-1.30.md` 是规则建立前的一次性合并归档（§8.6 第 8 条），白名单。
    const allowed = new Set(["CHANGELOG-1.0-to-1.30.md", "README.md"]);
    const unexpected = readdirSync(ARCHIVE_DIR).filter(
      (name) => name.endsWith(".md") && !allowed.has(name) && !/^CHANGELOG-\d+\.\d+\.md$/.test(name),
    );
    expect(unexpected, `归档文件名必须是 CHANGELOG-<major>.<minor>.md：${unexpected.join("、")}`).toEqual([]);
  });
});
