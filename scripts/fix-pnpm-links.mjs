#!/usr/bin/env node
/**
 * fix-pnpm-links.mjs —— pnpm 顶层链接自愈脚本
 *
 * 【背景】
 * Windows 下同一个 node_modules 被不同大版本的 pnpm（9 → 10 → 11）轮流安装时，
 * 布局版本（node_modules/.modules.yaml 的 layoutVersion）会变化。pnpm 11 遇到旧
 * 布局的顶层链接时，会判定其「由其他包管理器安装」并把它 rename 到
 * node_modules/.ignored/<pkg>；而 Windows 上 rename junction 只搬走了空壳，
 * 顶层于是只剩一个空目录。
 *
 * 更糟的是：.modules.yaml 里仍记录着这些包「已安装」，因此后续 pnpm install
 * （包括 --force）一律输出 "Already up to date" 不再修复，环境永久半残，
 * 表现为 Cannot find module 'electron' / 'vitest' / 'eslint' 等莫名其妙的报错。
 *
 * 【本脚本做什么】
 * 1. 用 .pnpm 虚拟存储里的真实包目录建立「包名 -> 真实路径」索引
 * 2. 扫描顶层 node_modules 与各包私有 node_modules，找出空目录 / 断链
 * 3. 用 junction 重新指向索引中的真实目录（Windows 需 junction，非 symlink）
 * 4. 清理 .ignored 空壳
 *
 * 【局限】
 * 只能「重新接上已经有实体」的包。若 .pnpm 里压根没有该包（例如被 pnpm 跳过
 * 下载），脚本会明确报 missing 并提示跑 pnpm install —— 它不做下载，也不
 * 掩盖问题。
 *
 * 【hoisted 布局下的行为】
 * 项目已切换到 node-linker=hoisted（见 pnpm-workspace.yaml），不存在 .pnpm
 * 虚拟存储与 junction，本脚本针对的那类故障在结构上不会发生。此时脚本只做
 * 一次轻量体检（关键包能否读到 package.json、electron 二进制是否在位）后
 * 正常退出，不做任何改写——避免修补正常布局反而把环境改坏。
 *
 * 用法：
 *   node scripts/fix-pnpm-links.mjs          # 检查并修复
 *   node scripts/fix-pnpm-links.mjs --check  # 只检查不修复，有问题时退出码 1
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NM = path.join(ROOT, "node_modules");
const PNPM_DIR = path.join(NM, ".pnpm");
const IGNORED_DIR = path.join(NM, ".ignored");

const CHECK_ONLY = process.argv.includes("--check");
/**
 * --warn-only：只提示不阻断。供 postinstall 使用——安装流程不该因为
 * 依赖体检的告警而失败（误报会直接卡住 pnpm install）。
 * 需要严格退出码的场景（CI）请用 --check。
 */
const WARN_ONLY = process.argv.includes("--warn-only");

function isRealDirWithManifest(dir) {
  try {
    return fs.existsSync(path.join(dir, "package.json"));
  } catch {
    return false;
  }
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * 从 pnpm-lock.yaml 读取项目直接依赖的实际解析版本。
 *
 * 这一步是必需的：同一个包名在 .pnpm 里可能有多个版本（例如 typescript 5.4.3
 * 与 6.0.3 同时存在）。修复空目录时若随便挑一个，会把顶层指向错误版本——
 * 表现为 tsc 突然报 Unknown compiler option 之类的怪错。
 */
function readLockfileVersions() {
  const map = new Map();
  const lockPath = path.join(ROOT, "pnpm-lock.yaml");
  if (!fs.existsSync(lockPath)) return map;
  let lines;
  try {
    lines = fs.readFileSync(lockPath, "utf8").split("\n");
  } catch {
    return map;
  }
  let inRootImporter = false;
  let inDeps = false;
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^importers:\s*$/.test(line)) {
      inRootImporter = true;
      continue;
    }
    if (/^    (dependencies|devDependencies):\s*$/.test(line)) {
      inDeps = inRootImporter;
      continue;
    }
    if (/^ {0,3}\S/.test(line) && !/^    (dependencies|devDependencies):/.test(line)) {
      inDeps = false;
    }
    if (/^\S/.test(line)) inRootImporter = false;
    if (!inDeps) continue;
    const pkg = line.match(/^      ([^\s:]+):\s*$/);
    if (pkg) {
      current = pkg[1].replace(/^'|'$/g, "");
      continue;
    }
    const ver = line.match(/^        version:\s*(.+)$/);
    if (ver && current) {
      map.set(current, ver[1].trim().replace(/[(,].*$/, ""));
      current = null;
    }
  }
  return map;
}

const lockVersions = readLockfileVersions();

/**
 * hoisted 布局（node-linker=hoisted）下的快速通道。
 *
 * 该布局没有 .pnpm 虚拟存储，也就没有 junction —— 本脚本要修的那类「链接断裂 /
 * 空目录」故障在结构上不会发生。此时继续跑后面的索引与改写逻辑不仅无益，
 * 反而可能把正常的扁平目录改坏，因此这里只做轻量体检后直接结束。
 */
function runHoistedHealthCheck() {
  const critical = [
    "typescript",
    "vite",
    "vitest",
    "eslint",
    "react",
    "electron",
  ];
  const bad = [];
  for (const name of critical) {
    if (!isRealDirWithManifest(path.join(NM, name))) {
      bad.push(`node_modules/${name} 缺失或不完整`);
    }
  }
  // electron 的运行时二进制由 postinstall 下载，缺失时 dev 起不来但 import 不报错
  if (isRealDirWithManifest(path.join(NM, "electron"))) {
    const exe = path.join(NM, "electron", "dist", "electron.exe");
    const txt = path.join(NM, "electron", "path.txt");
    if (!fs.existsSync(exe) || !fs.existsSync(txt)) {
      bad.push("node_modules/electron 缺少 dist/electron.exe 或 path.txt（需 pnpm rebuild electron）");
    }
  }

  if (bad.length === 0) {
    console.log("[fix-pnpm-links] hoisted 布局，关键依赖完好，无需修复。");
    process.exit(0);
  }

  console.error("[fix-pnpm-links] hoisted 布局体检发现问题：");
  for (const line of bad) console.error(`  - ${line}`);
  console.error("\n请执行：rm -rf node_modules && pnpm install && pnpm electron:rebuild");
  process.exit(WARN_ONLY ? 0 : 1);
}

if (!fs.existsSync(NM)) {
  console.error("[fix-pnpm-links] node_modules 不存在，请先执行 pnpm install。");
  process.exit(WARN_ONLY ? 0 : 1);
}
if (!fs.existsSync(PNPM_DIR)) {
  runHoistedHealthCheck();
}

/**
 * 候选打分，越小越优先：
 *   -2  版本与 lockfile 中项目声明的一致（最关键）
 *   -1  主变体（目录名不含 `_`，通常带 postinstall 产物）
 *    0  其它（peer 变体等）
 */
function candidateScore(entryName, pkgName) {
  const version = versionOf(entryName);
  const declared = lockVersions.get(pkgName);
  if (declared && version === declared) return -2;
  if (!entryName.includes("_")) return -1;
  return 0;
}

/** 从 .pnpm 目录名（如 `electron@42.4.1_supports-color@10.2.2`）取出版本号 */
function versionOf(entryName) {
  const base = entryName.split("_")[0];
  const at = base.lastIndexOf("@");
  return at > 0 ? base.slice(at + 1) : "";
}

/**
 * 返回可安全用于修复的目标实体；不满足条件时返回 null（只报告、不动手）。
 *
 * 三个条件必须同时成立：
 *   ① 该包在 pnpm-lock.yaml 中被项目声明（只管直接依赖，不猜传递依赖）
 *   ② 待修位置确实是**空目录**（非空说明可能是我们看不懂的正常布局）
 *   ③ 能找到**版本与声明完全一致**的实体
 *
 * 放宽任何一条都会出事：曾经因为在正常环境里对 1398 个位置动手，
 * 把 @rc-component/util 等包指到错误版本，导致 lint 与 build 直接崩掉。
 */
function safeTargetFor(key, dir) {
  // 只修「项目在 lockfile 中直接声明的依赖」。
  // 传递依赖**一律不碰**：同一个包在依赖树里可能同时存在多个合法版本
  // （如 brace-expansion v1/v2/v4），脚本无法判断某个位置该用哪个，
  // 指错版本会直接让工具链崩掉（实测：brace_expansion_1.expand is not a function）。
  const declared = lockVersions.get(key);
  if (!declared) return null;

  let items = [];
  try {
    items = fs.readdirSync(dir);
  } catch {
    return null;
  }
  // 只修空目录：非空说明可能是我们看不懂的正常布局。
  if (items.length > 0) return null;

  const list = candidates.get(key);
  if (!list || list.length === 0) return null;
  const exact = list.find((c) => versionOf(c.entry) === declared);
  return exact ? exact.dir : null;
}

/**
 * 第 1 步：建立索引。
 * 只收录「真实目录 + 带 package.json」的位置，同名取主变体。
 */
const candidates = new Map();

function addCandidate(key, dir, entry) {
  const list = candidates.get(key);
  if (list) list.push({ dir, entry });
  else candidates.set(key, [{ dir, entry }]);
}

if (fs.existsSync(PNPM_DIR)) {
  for (const entry of safeReaddir(PNPM_DIR)) {
    if (entry === "node_modules" || entry === "lock.yaml") continue;
    const base = path.join(PNPM_DIR, entry, "node_modules");
    if (!fs.existsSync(base)) continue;
    for (const name of safeReaddir(base)) {
      if (name.startsWith(".")) continue;
      const full = path.join(base, name);
      if (isSymlink(full)) continue;
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;

      if (isRealDirWithManifest(full)) {
        addCandidate(name, full, entry);
        continue;
      }
      // scope 包（@xx/yy）：再往下一层找
      if (name.startsWith("@")) {
        for (const sub of safeReaddir(full)) {
          if (sub === "node_modules") continue;
          const subFull = path.join(full, sub);
          if (isRealDirWithManifest(subFull)) {
            addCandidate(`${name}/${sub}`, subFull, entry);
          }
        }
      }
    }
  }
}

const index = new Map();
for (const [key, list] of candidates) {
  list.sort(
    (a, b) => candidateScore(a.entry, key) - candidateScore(b.entry, key),
  );
  index.set(key, list[0].dir);
}

const broken = [];
/** 缺失项存绝对路径，便于清理空壳后重新判定是否真的缺失 */
const missing = [];
/** 修复失败等带说明的消息 */
const failures = [];
/** 顶层指向 peer 变体的告警（只提示，不改） */
const peerVariantWarnings = [];
const fixed = [];

/**
 * 判定某个 node_modules 条目是否「坏了」。
 *
 * @param isTopLevel 是否顶层 node_modules。仅在顶层纠正 peer 变体——
 *   .pnpm 内部各包指向 peer 变体是 pnpm 的正常设计，不能动。
 */
function inspectEntry(parentDir, name, label, isTopLevel = false) {
  const full = path.join(parentDir, name);
  let st;
  try {
    st = fs.statSync(full);
  } catch {
    return; // 不存在，交给 pnpm
  }
  if (!st.isDirectory()) return;

  if (isSymlink(full)) {
    // 已经是链接：**一律不擅自重定向。**
    // 顶层指向哪个变体由 pnpm 决定，脚本无法可靠推断（同名可能有多版本，
    // 也曾出现过把顶层 typescript 指向 5.4.3 而非项目声明的 6.0.3 的事故）。
    // 只在顶层指向 peer 变体时告警——这类变体可能缺少 postinstall 产物。
    if (!isTopLevel) return;
    let target;
    try {
      target = fs.readlinkSync(full);
    } catch {
      return;
    }
    const m = target.match(/[\\/]\.pnpm[\\/]([^\\/]+)[\\/]node_modules[\\/]/);
    if (m && m[1].includes("_")) {
      peerVariantWarnings.push(`${name} -> ${m[1]}`);
    }
    return;
  }

  if (name.startsWith("@")) {
    for (const sub of safeReaddir(full)) {
      if (sub === "node_modules") continue;
      const subFull = path.join(full, sub);
      if (isSymlink(subFull)) continue;
      try {
        if (!fs.statSync(subFull).isDirectory()) continue;
      } catch {
        continue;
      }
      if (isRealDirWithManifest(subFull)) continue; // 正常实体目录
      const key = `${name}/${sub}`;
      const target = safeTargetFor(key, subFull);
      if (!target) {
        missing.push(subFull);
        continue;
      }
      broken.push({ full: subFull, target });
    }
    return;
  }

  if (isRealDirWithManifest(full)) return; // 正常实体目录

  const target = safeTargetFor(name, full);
  if (!target) {
    missing.push(full);
    return;
  }
  broken.push({ full, target });
}

// 第 2 步：扫顶层 node_modules
if (fs.existsSync(NM)) {
  for (const name of safeReaddir(NM)) {
    if (name.startsWith(".")) continue;
    inspectEntry(NM, name, "node_modules", true);
  }
}

// 第 3 步：扫 .pnpm 内各包的私有 node_modules（传递依赖也在此处链接）
if (fs.existsSync(PNPM_DIR)) {
  for (const entry of safeReaddir(PNPM_DIR)) {
    if (entry === "node_modules" || entry === "lock.yaml") continue;
    const base = path.join(PNPM_DIR, entry, "node_modules");
    if (!fs.existsSync(base)) continue;
    for (const name of safeReaddir(base)) {
      if (name.startsWith(".")) continue;
      inspectEntry(base, name, `.pnpm/${entry}`);
    }
  }
}

// 第 4 步：修复
if (!CHECK_ONLY) {
  for (const { full, target, reason } of broken) {
    try {
      fs.rmSync(full, { recursive: true, force: true });
      fs.symlinkSync(target, full, "junction");
      fixed.push(
        reason ? `${path.relative(ROOT, full)} (${reason})` : path.relative(ROOT, full),
      );
    } catch (err) {
      failures.push(`${path.relative(ROOT, full)} (修复失败: ${err.message})`);
    }
  }

  // 清理 .ignored 空壳：pnpm 搬迁中断留下的产物，有两种形态
  //   顶层：node_modules/.ignored/<pkg>
  //   包内：.pnpm/<entry>/node_modules/<scope>/.ignored_<pkg>
  // 只删空壳；非空的保留，避免误删真实内容。
  let removedShells = 0;

  const cleanShells = (dir, depth) => {
    if (depth > 3) return;
    for (const name of safeReaddir(dir)) {
      if (name === "node_modules") continue;
      const p = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (!st.isDirectory() || isSymlink(p)) continue;
      if (name.startsWith(".ignored")) {
        if (safeReaddir(p).length === 0) {
          try {
            fs.rmdirSync(p);
            removedShells += 1;
          } catch {
            /* 被占用，下次再清理 */
          }
        }
        continue;
      }
      cleanShells(p, depth + 1);
    }
  };

  if (fs.existsSync(IGNORED_DIR)) cleanShells(IGNORED_DIR, 0);
  if (fs.existsSync(PNPM_DIR)) {
    for (const entry of safeReaddir(PNPM_DIR)) {
      if (entry === "node_modules" || entry === "lock.yaml") continue;
      const base = path.join(PNPM_DIR, entry, "node_modules");
      if (fs.existsSync(base)) cleanShells(base, 0);
    }
  }

  if (removedShells > 0) {
    console.log(`已清理 .ignored 空壳：${removedShells} 个`);
  }

  // 空壳清掉后重新判定：已经不存在的不再算「缺失」
  const stillMissing = missing.filter((p) => fs.existsSync(p));
  missing.length = 0;
  missing.push(...stillMissing);

  // .ignored 目录本身已空则一并移除，避免留下误导性的空目录
  if (fs.existsSync(IGNORED_DIR) && safeReaddir(IGNORED_DIR).length === 0) {
    try {
      fs.rmdirSync(IGNORED_DIR);
    } catch {
      /* 被占用，忽略 */
    }
  }
}

// 第 5 步：关键包完整性校验。
// 链接「接上了」不等于「能用」——electron 这类带 postinstall 二进制的包，
// 即使链接指向正确，也可能缺 dist。这种情况脚本修不了，必须如实报出来。
const integrity = [];
if (!CHECK_ONLY && broken.length > 0) {
  const electronDir = path.join(NM, "electron");
  if (fs.existsSync(electronDir)) {
    const hasPathTxt = fs.existsSync(path.join(electronDir, "path.txt"));
    const hasBinary = fs.existsSync(path.join(electronDir, "dist", "electron.exe"));
    if (!hasPathTxt || !hasBinary) {
      integrity.push(
        "electron 二进制不完整（path.txt / dist/electron.exe 缺失），pnpm dev 会启动失败。\n" +
          "  链接层已尽力修复，但 postinstall 产物必须由 pnpm 生成：请跑 pnpm install\n" +
          "  （若仍 Already up to date，先删 node_modules/.modules.yaml 再跑）。",
      );
    }
  }
}

// 第 6 步：报告
if (broken.length === 0 && missing.length === 0) {
  console.log("[fix-pnpm-links] 依赖链接完好，无需修复。");
  process.exit(0);
}

if (CHECK_ONLY) {
  console.error(
    `[fix-pnpm-links] 检测到 ${broken.length} 个损坏链接、${missing.length} 个缺失包。`,
  );
} else {
  console.log(`[fix-pnpm-links] 已修复 ${fixed.length} 个链接。`);
}

if (missing.length > 0) {
  console.error(
    `\n以下位置仍是坏链接，且 .pnpm 里找不到可用实体，脚本无法修复：\n  ${missing
      .slice(0, 20)
      .map((p) => path.relative(ROOT, p))
      .join("\n  ")}`,
  );
  console.error(
    "\n这说明 node_modules 已处于 pnpm 自行搬迁中断的半损坏状态，",
    "补丁式修复不再可靠。请按 AGENTS.md §8.7 彻底重建：\n" +
      "  1. 删除 node_modules（依赖目录，可由 lockfile 完整恢复）\n" +
      "  2. pnpm install\n" +
      "  3. pnpm electron:rebuild",
  );
}

if (failures.length > 0) {
  console.error(`\n[修复失败]\n  ${failures.slice(0, 20).join("\n  ")}`);
}

if (peerVariantWarnings.length > 0) {
  console.warn(
    `\n[提示] ${peerVariantWarnings.length} 个顶层包指向 peer 变体（这是 pnpm 的正常选择，脚本不会改）：\n  ${peerVariantWarnings
      .slice(0, 10)
      .join("\n  ")}\n` +
      "  仅当这些包缺少二进制产物时才需要处理，例如 pnpm rebuild electron。",
  );
}

if (integrity.length > 0) {
  console.error(`\n[完整性告警]\n  ${integrity.join("\n  ")}`);
}

const failed =
  missing.length > 0 ||
  failures.length > 0 ||
  integrity.length > 0 ||
  (CHECK_ONLY && broken.length > 0);
process.exit(WARN_ONLY || !failed ? 0 : 1);
