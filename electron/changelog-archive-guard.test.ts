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
    const oldestKept = MAIN_VERSIONS.reduce((min, item) =>
      compareMinor(item, min) < 0 ? item : min,
    );
    const newestArchived = ARCHIVES.flatMap((archive) => archive.versions).reduce((max, item) =>
      compareMinor(item, max) > 0 ? item : max,
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
