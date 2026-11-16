#!/usr/bin/env node
/**
 * collect-makeamap-assets.mjs —— 易制地图（makeamap.cn）公开前端产物收集器
 *
 * ── 用途 ──
 * 把 makeamap 地图编辑器**公开发布到浏览器**的前端产物（HTML / AMD 模块 / 素材清单）
 * 抓取到本地，并整理成可读的清单（manifest.json + report.md），用于
 * 「理解其素材组织与排布机制」的技术研究。
 *
 * 它**不**做：登录、抓取私有地图数据、绕过任何鉴权或付费限制、逆向加密逻辑。
 * 只下载匿名可访问的静态资源；素材图片默认不下载（需显式 --images）。
 *
 * ── 合规提示（执行前请确认）──
 *   1. 仅用于学习研究 / 互操作性开发，不要把他人的美术素材复制进自己的产品；
 *   2. 目标站点的贴图、图标属于受著作权保护的美术作品，抓取仅作本地观察样本；
 *   3. 请保持低并发与合理间隔（脚本已内置），不要对目标站点造成压力；
 *   4. 目标站点的结构随时可能变化，脚本失败时先看报错里的步骤名，不要盲目重试。
 *
 * ── 用法 ──
 *   node scripts/collect-makeamap-assets.mjs --help
 *   node scripts/collect-makeamap-assets.mjs                       # 只抓代码与清单
 *   node scripts/collect-makeamap-assets.mjs --out ./.mam-dump
 *   node scripts/collect-makeamap-assets.mjs --images --max-images 20
 *   node scripts/collect-makeamap-assets.mjs --styles 0 --images   # 只抓「魔幻」风格包
 *   node scripts/collect-makeamap-assets.mjs --dry-run             # 走完全流程但不落盘图片
 *
 * ── 产物 ──
 *   <out>/raw/map.html              入口页（含脚本清单）
 *   <out>/raw/js_map.js             引导脚本（含 js_version）
 *   <out>/raw/all_model_base.js     AMD 主包（渲染引擎 + 素材清单）
 *   <out>/raw/decoded.js            主包把 \uXXXX 还原成中文后的副本（便于 grep）
 *   <out>/manifest.json             三套风格 × 各类素材的 URL 清单 + 统计
 *   <out>/report.md                 人读摘要（各风格各类素材数量、取色/参数摘录）
 *   <out>/images/<style>/<category>/*.png   仅在 --images 时产出
 *
 * ── 为什么需要 Referer ──
 * static.makeamap.cn 的 CDN 配了 Referer ACL（直连返回 403 "denied by Referer ACL"），
 * 浏览器里能正常加载是因为带了站点 Referer。脚本因此统一带 UA + Referer，
 * 这不是绕过鉴权，只是补齐 CDN 的正常防盗链要求。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/* ─────────────── 常量 ─────────────── */

const DEFAULT_MAP_ID = "16cef6db-7d77-4fe5-a561-fd7122753473";
const ORIGIN = "https://www.makeamap.cn";
const STATIC_ORIGIN = "https://static.makeamap.cn";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** 三套风格包的锚点：引擎按 MapStyleEnum 分支给素材池赋值，顺序固定 */
const STYLE_ANCHORS = [
  { id: 0, key: "mohuan", label: "魔幻", anchor: "MapStyleEnum.MOHUAN?(I.src=" },
  { id: 1, key: "xianxia", label: "仙侠", anchor: "MapStyleEnum.XIANXIA?(I.src=" },
  { id: 2, key: "yangpizhi", label: "羊皮纸", anchor: "MapStyleEnum.YANGPIZHI&&(I.src=" },
];

/** 素材分类：key 与引擎里 `I.<key>` 一致 */
const ASSET_KEYS = [
  "mountains",
  "mountains_grass",
  "mountains_desert",
  "mountains_poles",
  "citys",
  "forest1",
  "forest2",
  "forest3",
];

const CATEGORY_LABEL = {
  mountains: "山体·主池",
  mountains_grass: "山体·丘陵带",
  mountains_desert: "山体·沙漠带",
  mountains_poles: "山体·雪原带",
  citys: "聚落·城郭",
  forest1: "植被·高纬/高地",
  forest2: "植被·中纬/腹地",
  forest3: "植被·干旱带",
  base: "地表纹理（可平铺）",
  poles_src: "地表纹理·极地",
  grass_src: "地表纹理·草地",
  desert_src: "地表纹理·沙漠",
  shawdow_layer_src: "阴影层纹理",
};

/* ─────────────── CLI ─────────────── */

function parseArgs(argv) {
  const opts = {
    out: resolve(process.cwd(), ".makeamap-dump"),
    mapId: DEFAULT_MAP_ID,
    images: false,
    maxImages: 40,
    styles: [0, 1, 2],
    concurrency: 4,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--images") opts.images = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--out") opts.out = resolve(process.cwd(), argv[++i] ?? opts.out);
    else if (a === "--map-id") opts.mapId = argv[++i] ?? opts.mapId;
    else if (a === "--max-images") opts.maxImages = Number(argv[++i] ?? 40) || 40;
    else if (a === "--concurrency") opts.concurrency = Math.max(1, Number(argv[++i] ?? 4) || 4);
    else if (a === "--styles") {
      const raw = String(argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const ids = raw.map(Number).filter((n) => n === 0 || n === 1 || n === 2);
      if (ids.length) opts.styles = [...new Set(ids)].sort();
    } else {
      throw new Error(`未知参数：${a}（用 --help 查看用法）`);
    }
  }
  return opts;
}

function printHelp() {
  process.stdout.write(
    [
      "",
      "collect-makeamap-assets.mjs —— 收集易制地图(map.html)公开前端产物",
      "",
      "用法：",
      "  node scripts/collect-makeamap-assets.mjs [选项]",
      "",
      "选项：",
      "  --out <dir>         输出目录（默认 ./.makeamap-dump）",
      "  --map-id <id>       用哪张地图的页面地址取 Referer（默认参考样例，不影响抓取内容）",
      "  --styles <0,1,2>    只处理指定风格包：0=魔幻 1=仙侠 2=羊皮纸（默认全部）",
      "  --images            额外下载素材 PNG 样本（默认只抓清单）",
      "  --max-images <n>    图片下载上限（默认 40，按风格轮转取样）",
      "  --concurrency <n>   图片并发数（默认 4，建议不超过 6）",
      "  --dry-run           走完抓取与解析，但不写图片、不做额外请求",
      "  -h, --help          显示本帮助",
      "",
      "产出：",
      "  <out>/raw/*.js          主包与解码副本（解码副本便于 grep 中文）",
      "  <out>/manifest.json     风格 × 素材分类的 URL 清单与统计",
      "  <out>/report.md         人读摘要",
      "  <out>/images/...        素材样本（仅 --images）",
      "",
      "合规：仅抓匿名可访问的静态资源，不登录、不抓私有地图、不绕过任何鉴权。",
      "      抓到的美术素材仅作本地观察，不要复制进自己的产品。",
      "",
    ].join("\n"),
  );
}

/* ─────────────── 网络 ─────────────── */

const REFERER_FOR = (mapId) => `${ORIGIN}/map.html?id=${mapId}`;

async function fetchText(url, referer, label) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: referer, Accept: "*/*" },
  });
  if (!res.ok) {
    throw new Error(`${label} 抓取失败：HTTP ${res.status}（${url}）`);
  }
  return await res.text();
}

async function fetchBuffer(url, referer, label) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: referer, Accept: "*/*" },
  });
  if (!res.ok) throw new Error(`${label} 下载失败：HTTP ${res.status}（${url}）`);
  return Buffer.from(await res.arrayBuffer());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────── 解析 ─────────────── */

/** 主包把中文全写成 \uXXXX，还原一份便于人读与 grep */
function decodeUnicodeEscapes(src) {
  return src.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** 从 js/map.js 里取 js_version（AMD 模块的 urlArgs，形如 v\x3d1.122） */
function pickJsVersion(bootstrap) {
  const m = /js_version\s*=\s*"v\\x3d([\d.]+)"/.exec(bootstrap) ?? /js_version\s*=\s*"([^"]+)"/.exec(bootstrap);
  if (!m) return null;
  return m[1].replace(/^v\\x3d/, "").replace(/^v=/, "");
}

/** 切出三套风格包（各自从 I.src= 起，到下一套或 forest3 结束） */
function splitStyleBlocks(decoded) {
  const marks = STYLE_ANCHORS.map((s) => ({ ...s, at: decoded.indexOf(s.anchor) })).filter(
    (s) => s.at >= 0,
  );
  if (!marks.length) return [];
  const endAt = decoded.indexOf("I.forest3=[", marks[marks.length - 1].at);
  return marks.map((s, i) => {
    const from = s.at;
    const next = marks[i + 1]?.at;
    const to = next ?? (endAt > from ? decoded.indexOf(");", endAt) : from + 40000);
    return { ...s, text: decoded.slice(from, to > from ? to + 2 : from + 40000) };
  });
}

/**
 * 从一个风格块里抠素材。
 * 引擎里两种写法：
 *   I.mountains="s/fpool/points/a.png/get s/fpool/points/b.png/get".split(" ")
 *   I.mountains_grass=["s/fpool/points/a.png/get","..."]
 */
function extractAssets(blockText) {
  const out = {};
  const push = (key, list) => {
    if (!list.length) return;
    out[key] = [...new Set([...(out[key] ?? []), ...list])];
  };

  for (const key of ASSET_KEYS) {
    const spaced = new RegExp(`I\\.${key}\\s*=\\s*"([^"]*)"\\s*\\.split\\(`, "g");
    let m;
    while ((m = spaced.exec(blockText))) {
      push(key, m[1].split(/\s+/).filter((s) => s.includes(".png")));
    }
    const arrayed = new RegExp(`I\\.${key}\\s*=\\s*\\[([^\\]]*)\\]`, "g");
    while ((m = arrayed.exec(blockText))) {
      push(
        key,
        [...m[1].matchAll(/"?([^",\s]+\.png[^",\s]*)"/g)].map((x) => x[1]),
      );
    }
  }

  for (const key of ["src", "poles_src", "grass_src", "desert_src", "shawdow_layer_src"]) {
    const m = new RegExp(`I\\.${key}\\s*=\\s*"([^"]*\\.png[^"]*)"`).exec(blockText);
    if (m) out[key] = [m[1]];
  }
  return out;
}

/** 从主包里捞一批「可读参数」：把关键常量原文截出来当证据 */
function extractParamEvidence(decoded) {
  const grab = (needle, before = 60, after = 200) => {
    const i = decoded.indexOf(needle);
    return i < 0 ? null : decoded.slice(Math.max(0, i - before), i + after).replace(/\s+/g, " ");
  };
  return {
    地形侵蚀参数: grab("erodeGeoJSON:function", 0, 620),
    陆地绘制样式: grab("paint_shadow={shadow:", 0, 460),
    区块样式: grab("border_size:3,border_color", 60, 260),
    网格布点: grab("if(0<m.length&&0==m[r][t])", 240, 900),
    掩码判定: grab("51<=c[4*(p*d+C)+3]", 120, 200),
    竖层排序: grab("p.height*p.scale>p[d+1].y", 160, 240),
    图层栈: grab("CreatreBaseLineLayer:function", 0, 760),
  };
}

/* ─────────────── 主流程 ─────────────── */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const referer = REFERER_FOR(opts.mapId);
  const rawDir = join(opts.out, "raw");
  await mkdir(rawDir, { recursive: true });

  const step = (s) => process.stdout.write(`· ${s}\n`);

  // 1. 入口页
  step("抓取入口页 map.html");
  const pageUrl = `${ORIGIN}/map.html?id=${opts.mapId}`;
  const page = await fetchText(pageUrl, referer, "map.html");
  await writeFile(join(rawDir, "map.html"), page, "utf8");

  // 2. 引导脚本（决定 AMD baseUrl 与 ?v= 版本号）
  step("抓取引导脚本 js/map.js");
  const bootstrap = await fetchText(`${ORIGIN}/js/map.js`, referer, "js/map.js");
  await writeFile(join(rawDir, "js_map.js"), bootstrap, "utf8");
  const version = pickJsVersion(bootstrap);
  step(`识别到模块版本：${version ?? "未知（回退到无版本号请求）"}`);

  // 3. 主包
  const bundleUrl = `${STATIC_ORIGIN}/js/map/all_model_base.js${version ? `?v=${version}` : ""}`;
  step(`抓取主包 all_model_base.js${version ? `?v=${version}` : ""}（约 1.8MB，稍等）`);
  const bundle = await fetchText(bundleUrl, referer, "all_model_base.js");
  await writeFile(join(rawDir, "all_model_base.js"), bundle, "utf8");

  // 4. 解码副本
  step("还原 \\uXXXX 转义，生成 decoded.js（便于 grep 中文）");
  const decoded = decodeUnicodeEscapes(bundle);
  await writeFile(join(rawDir, "decoded.js"), decoded, "utf8");

  // 5. 切风格包 + 抽素材清单
  step("切分三套风格包并抽取素材清单");
  const blocks = splitStyleBlocks(decoded);
  if (!blocks.length) {
    throw new Error(
      "没有找到风格包锚点：目标站点可能已改版（MapStyleEnum.MOHUAN?(I.src= 等标记消失）",
    );
  }

  const styles = blocks
    .filter((b) => opts.styles.includes(b.id))
    .map((b) => {
      const assets = extractAssets(b.text);
      const categories = {};
      let total = 0;
      for (const [key, urls] of Object.entries(assets)) {
        const isTexture = ["src", "poles_src", "grass_src", "desert_src", "shawdow_layer_src"].includes(key);
        const normKey = key === "src" ? "base" : key;
        categories[normKey] = {
          label: CATEGORY_LABEL[normKey] ?? normKey,
          kind: isTexture ? "texture" : "sprite",
          count: urls.length,
          urls: urls.map((u) => (u.startsWith("http") ? u : ORIGIN + (u.startsWith("/") ? u : "/" + u))),
        };
        if (!isTexture) total += urls.length;
      }
      return { id: b.id, key: b.key, label: b.label, spriteTotal: total, categories };
    });

  const manifest = {
    fetchedAt: new Date().toISOString(),
    source: pageUrl,
    moduleVersion: version,
    note: "仅公开静态资源清单；素材版权归原站点所有，勿用于再分发。",
    styles,
    totals: {
      styles: styles.length,
      sprites: styles.reduce((n, s) => n + s.spriteTotal, 0),
      textures: styles.reduce(
        (n, s) =>
          n + Object.values(s.categories).filter((c) => c.kind === "texture").length,
        0,
      ),
    },
    params: extractParamEvidence(decoded),
  };
  await writeFile(join(opts.out, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  // 6. 可选：素材样本图
  if (opts.images && !opts.dryRun) {
    const picked = [];
    // 按分类轮转取样，保证每个分类都有代表性样本
    const perStyle = Math.max(1, Math.ceil(opts.maxImages / Math.max(1, styles.length)));
    for (const s of styles) {
      const cats = Object.entries(s.categories).filter(([, c]) => c.kind === "sprite");
      let taken = 0;
      for (let round = 0; taken < perStyle; round++) {
        let progressed = false;
        for (const [key, c] of cats) {
          if (taken >= perStyle) break;
          const url = c.urls[round];
          if (!url) continue;
          picked.push({ style: s.key, category: key, url });
          taken++;
          progressed = true;
        }
        if (!progressed) break;
      }
    }
    step(`下载素材样本 ${picked.length} 张（并发 ${opts.concurrency}）`);
    let done = 0;
    const queue = [...picked];
    const worker = async () => {
      for (;;) {
        const job = queue.shift();
        if (!job) return;
        const name =
          (new URL(job.url).pathname.split("/").filter(Boolean).slice(-2)[0] ?? `sample_${done}`)
            .replace(/\.(png|webp|jpe?g)$/i, "")
            .replace(/[^\w.-]/g, "_");
        const dir = join(opts.out, "images", job.style, job.category);
        try {
          await mkdir(dir, { recursive: true });
          const buf = await fetchBuffer(job.url, referer, `素材 ${name}`);
          await writeFile(join(dir, `${name}.png`), buf);
        } catch (err) {
          process.stderr.write(`  ! 跳过：${job.url}（${err.message}）\n`);
        }
        done++;
        if (done % 5 === 0 || done === picked.length) step(`  已下载 ${done}/${picked.length}`);
        await sleep(180);
      }
    };
    await Promise.all(Array.from({ length: Math.min(opts.concurrency, 8) }, worker));
  } else if (opts.images && opts.dryRun) {
    step("--dry-run：跳过图片下载");
  }

  // 7. 人读摘要
  const lines = [
    "# 易制地图 · 前端素材清单摘要",
    "",
    `> 抓取时间：${manifest.fetchedAt}`,
    `> 模块版本：${manifest.moduleVersion ?? "未知"}`,
    `> 来源页面：${pageUrl}`,
    "> 说明：仅列出公开静态资源的**组织方式**；素材版权归原站点，勿再分发。",
    "",
    "## 各风格素材数量",
    "",
    "| 风格 | " + ASSET_KEYS.map((k) => CATEGORY_LABEL[k] ?? k).join(" | ") + " | 小计 |",
    "|------|" + ASSET_KEYS.map(() => "---").join("|") + "|---|",
  ];
  for (const s of styles) {
    const cells = ASSET_KEYS.map((k) => s.categories[k]?.count ?? 0);
    lines.push(`| ${s.label} | ${cells.join(" | ")} | ${s.spriteTotal} |`);
  }
  lines.push("", "## 地表纹理（可平铺）", "");
  for (const s of styles) {
    const tex = Object.entries(s.categories).filter(([, c]) => c.kind === "texture");
    lines.push(`- **${s.label}**：` + tex.map(([k]) => CATEGORY_LABEL[k] ?? k).join("、"));
  }
  lines.push("", "## 关键参数原文（证据摘录）", "");
  for (const [k, v] of Object.entries(manifest.params)) {
    lines.push(`### ${k}`, "", v ? "```js\n" + v + "\n```" : "_未找到（站点可能已改版）_", "");
  }
  await writeFile(join(opts.out, "report.md"), lines.join("\n"), "utf8");

  process.stdout.write(
    [
      "",
      "── 完成 ──",
      `清单：${join(opts.out, "manifest.json")}`,
      `摘要：${join(opts.out, "report.md")}`,
      `解码副本：${join(rawDir, "decoded.js")}`,
      "",
      `素材总量：${manifest.totals.sprites} 张精灵图 / ${styles.length} 套风格`,
      "下一步：grep decoded.js 里的 CreateLand / erodeGeoJSON / EdgeSoftnessCanvas 看绘制细节。",
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  process.stderr.write(`\n[失败] ${err.message}\n`);
  if (err.stack) process.stderr.write(err.stack.split("\n").slice(1, 4).join("\n") + "\n");
  process.exitCode = 1;
});
