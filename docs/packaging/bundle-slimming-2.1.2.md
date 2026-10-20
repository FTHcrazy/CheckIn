# 2.1.2 打包体积治理：资源依赖层的边际在哪

> 目标：2.1.0 升级 Electron 44 后安装包从 85.26 → 99.78 MiB，问「资源依赖体积还能不能优化」。
> 结论：**应用侧（asar）在安装包里只占 1.4 MiB（压缩后），已不是瓶颈**；本轮把 asar 再砍一半
> （14.34 → 6.82 MiB）只换来安装包 **−0.96 MiB**。剩余体积 80% 在 Chromium 本体，
> 下一个量级的收益必须动 `resources.pak`（Chromium 内置音效 4.8 MiB 等），而它需要重建 pak
> 且**无法在本仓沙箱里验证运行**（禁启动 GUI），故只列方案不默认启用。
>
> 所有数字均为本机实跑值（Electron 44.9.0 / electron-builder 26.17.0 / Windows x64）。

---

## 1. 先算清「安装包里到底装了什么」

安装包 99.78 MiB，但 `win-unpacked` 有 283 MiB —— 说明大头是**可压缩的代码**。
用 LZMA2（`-mx=9 -md=64m`，与 NSIS 实际使用的算法同族）逐文件测压缩后体积，
才能知道「删掉 X 能省多少**安装包**」：

| 文件 | 原始 | 压缩后 | 压缩率 | 占安装包 |
|---|---:|---:|---:|---:|
| `CheckIn.exe` | 235.75 MiB | **65.30 MiB** | 3.6:1 | **65.4%** |
| `resources.pak` | 11.86 MiB | **11.75 MiB** | **1.01:1** | **11.8%** |
| `icudtl.dat` | 10.37 MiB | 3.21 MiB | 3.2:1 | 3.2% |
| `resources/app.asar` | 13.67 MiB | **1.74 MiB** | **7.9:1** | 1.7% |
| `chrome_200_percent.pak` | 1.21 MiB | 1.16 MiB | 1.04:1 | 1.2% |
| `ffmpeg.dll` | 2.97 MiB | 0.90 MiB | 3.3:1 | 0.9% |
| `better-sqlite3/…/win32-x64.node` | 1.90 MiB | 0.81 MiB | 2.3:1 | 0.8% |
| `chrome_100_percent.pak` | 0.69 MiB | 0.66 MiB | 1.04:1 | 0.7% |
| `dxil.dll` | 1.44 MiB | 0.45 MiB | 3.2:1 | 0.5% |

三条可直接读出的事实：

1. **asar 的压缩率是 7.9:1**（JS 文本）—— 所以「asar 里省 8 MiB」在安装包里只值 **~1 MiB**。
   继续抠 `node_modules` 的边际收益已经很低。
2. **`.pak` 基本不可压缩**（1.01~1.04:1，内部已是 gzip/brotli 或二进制资源）—— 删 1 MiB
   pak 就是省 1 MiB 安装包，是所有项里「杠杆最高」的。
3. `CheckIn.exe` 独占 65%，它是 Chromium 本体（Electron 44 把 ANGLE 静态链进去了），
   除非不用 Electron，否则动不了。

---

## 2. 本次改动：运行期依赖的「重复构建产物」

`node_modules` 里有大量**同一份代码的多种构建产物**，Node `require` 只会走
`package.json` 的 `exports.require` / `main` 指向的那一个，其余全是死重：

| 包 | 删掉的 | 保留（`require` 真正落地的入口） |
|---|---|---|
| `docx` | `dist/index.iife.js`、`dist/index.mjs`、`dist/index.umd.cjs`、包内 `node_modules/`（自带一份 `@types/node`） | `dist/index.cjs`（`exports["."].require`） |
| `mammoth` | `mammoth.browser.js`、`mammoth.browser.min.js` | `lib/index.js`（`main`） |
| `jszip` | `dist/**`（浏览器 UMD 副本） | `lib/index.js`（`main`） |
| `pako` | `dist/**` | `lib/**`（`index.js` 直接 require） |
| `bluebird` | `js/browser/**` | `js/release/**`（`main`） |
| `xml-js` | `dist/**` | `lib/index.js`（`main`） |
| `underscore` | `modules/**`、`cjs/**`、`underscore-esm*.js`、`*-min.js`、`underscore.js` | `underscore-node.cjs` → `underscore-node-f.cjs`（`exports["."].require.node`），外加 `underscore-umd.js` 作 `main` 兜底 |
| `node-addon-api` | 整包（纯 C++ 头文件） | —— 运行期只 require `better-sqlite3/prebuilds/*.node` |

另外补了 `!**/node_modules/@types/**`：顶层 `!node_modules/@types/**` 匹配不到
`docx/node_modules/@types/**` 这种嵌套路径。

### 结果（实测）

| 指标 | 2.1.1 | 2.1.2 | 变化 |
|---|---:|---:|---:|
| `resources/app.asar` 磁盘字节 | 14,338,215 B（13.67 MiB） | **6,817,719 B（6.50 MiB）** | −7,520,496 B（**−52.5%**） |
| asar 内文件数 | 992 | **630** | −362 |
| 其中 `node_modules` 逻辑体积 | 11.81 MiB | **4.73 MiB** | −7.08 MiB |
| `win-unpacked` 合计 | 283 MiB | **276 MiB** | −7 MiB |
| 安装包 `CheckIn Setup *.exe` | 104,625,314 B（99.78 MiB） | **103,621,066 B（98.82 MiB）** | −1,004,248 B（**−0.96 MiB**） |

> 注意 −7.52 MiB 的 asar 只兑现了 −0.96 MiB 的安装包，正是第 1 节那条压缩率结论的实证。

---

## 3. 验证方式（沙箱内没有 GUI，只有这条路）

打包后把 `app.asar` **解包到临时目录**，用 `createRequire` 按**包名**解析（与运行期一致，
走 `exports` 而不是绝对路径 require），然后跑真实 API 闭环：

1. `docx` 生成 `.docx`（`Packer.toBuffer`）；
2. 用 `mammoth.extractRawText` 把上一步的文件解析回文本（同时吃掉 `jszip` → `pako`、
   `underscore`、`xml-js`、`bluebird` 整条链）；
3. `jszip` 独立往返回环；
4. `better-sqlite3` 建表 + 插入 + 查询真实 SQL。

四项全过才认为裁剪安全（本机实跑：`=== ALL VERIFY PASSED ===`）。
`electron/packaging-guard.test.ts` 同步新增 11 条断言，把「删哪些、绝不能删哪些」钉死 ——
包括「任何运行期依赖不得被整包排除」这条反向守卫。

> ⚠️ 验证脚本必须用 `createRequire(临时目录/probe.js)` 按包名 require。
> 若写成 `require('<临时目录>/node_modules/docx')`（绝对路径），Node 会**跳过 `exports`
> 改读 `main`**，而 `docx` 的 `main` 恰好是已删掉的 `index.umd.cjs` —— 会得到
> 「裁错了」的假阳性。

---

## 4. 剩余可动项（按性价比排序）

| 项 | 安装包收益 | 代价 / 风险 | 本次是否做 |
|---|---:|---|---|
| `resources.pak` 裁 Chromium 内置音效 | **≈ −4.8 MiB** | pak id `14500`–`14505` 是 6 个 FLAC（ChromeVox 屏幕阅读器音效），桌面应用不用；但**要重建 pak（重排 offset 表）**，且沙箱内**无法启动应用验证** → 需要用户实机冒烟（重点看启动、白屏、F12） | 否，方案待定 |
| 删 `chrome_200_percent.pak` | −1.16 MiB | 2x DPI 图片资源；删后 200% 缩放下图标/位图由 100% 版本放大，**会糊但不崩** | 否 |
| 用无专有编解码器的 `ffmpeg.dll` 替换 | −0.5 MiB | 项目无音视频播放能力时安全；一旦将来要放 H.264/MP4 就会静默失效 | 否 |
| 删 `dxil.dll` | −0.45 MiB | `dxcompiler.dll` 早已删除 → DXC 路径整体不可用，`dxil.dll` 已是死重；但 GPU 路径无法在沙箱验证，白屏代价高 | 否（`after-pack.js` 注释里保留了回滚理由） |
| 只留 `zh-CN` locale | −0.55 MiB | 英文系统下 Chromium 内置字符串（右键菜单等）会退化 | 否 |
| `resources/default_app.asar` + `elevate.exe` | −0.1 MiB | 无自动更新时可删，但收益过小 | 否 |
| 改用 BCJ2 压缩 | **−5 MiB** | ⚠️ 不可用：electron-builder 的 NSIS 内置解压器只认单流 BCJ，`installTimeDecodable` 会强制 `-mf=BCJ`；要吃到 BCJ2 必须换安装器架构（自解压 7z + 外部解压器） | 否 |

`resources.pak` 的结构（version 5 头：`u32 version + u8 encoding + u8[3] + u16 count +
u16 alias`，条目 `u16 id + u32 offset`）与那 6 个 FLAC 的 id 已记录在此，便于后续重建：

```text
resources=3161  aliases=300  encoding=UTF8
id 14501  2,845,615 B fLaC     id 14500    316,154 B fLaC
id 14502  1,082,944 B fLaC     id 14505    266,449 B fLaC
id 14504    197,707 B fLaC     id 14503    114,500 B fLaC
```

---

## 5. 与 2.0.0 那轮的关系

2.0.0 解决的是「**把不该进 asar 的东西挡在门外**」（渲染层依赖 110 MiB → 0，架构性问题）；
本轮解决的是「**进了 asar 的依赖里重复的那几份构建产物**」（工程性细节）。
本轮收益（−0.96 MiB）远小于上轮（−16 MiB），这是正常的：**体积治理的边际递减在第二轮之后
会非常陡**，因为剩下的 65% 是 Chromium 本体，11.8% 是不可压缩的 pak。
