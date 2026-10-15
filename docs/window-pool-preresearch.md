# 功能窗口「窗口池」预缓存方案 · 预研报告

| 项    | 内容                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------- |
| 日期   | 2026-10-15                                                                                              |
| 分析范围 | PackWindow（行囊）/ SettingsWindow（设置）的打开速度；full 版 NovelWindow 子窗为延伸候选（novel 版为主窗，常驻，不适用）                   |
| 性质   | 预研分析，**无代码落地**；所有运行时数字凡未标注「实测」均为经验估算，需按 §7.3 埋点计划校准                                                     |
| 结论先行 | 分阶段落地：**P0** 先补 `app://` 缓存头 + 打开耗时埋点（低成本、高确定性、零状态风险）；**P1** 依据实测数据决定是否落地「空白窗口池 ×1」；「关窗即隐藏」作为备选方案。详见 §7 |

---

## 1. 背景与现状

### 1.1 涉及窗口与当前创建链路

窗口入口清单（`electron/edition.ts`，唯一事实源）：`base / login / novel / pack / settings`。  
本报告关注 `pack` 与 `settings`：两者均为**即关即销 + 单实例唤起**。

当前打开链路（`electron/main.ts`，代码事实）：

```
渲染层入口（NovelWindow 顶栏 / 主窗标题栏）
  │ ipcMain.on("pack-window-open", {workId, chapterId, nonce})
  │ ipcMain.on("settings-window-open")
  ▼
createPackWindow() / createSettingsWindow()
  ├─ windowManager.get(name) 命中 → 补发上下文 / 恢复 / show() / focus()（单实例）
  └─ 未命中 → new BrowserWindow({
        show: false, frame: false, transparent: true,
        backgroundColor: "#00000000", hasShadow: false, roundedCorners: false,
        webPreferences: { preload, contextIsolation: true, nodeIntegration: false },
     })
     ├─ windowManager.register(name, win)
     ├─ attachCloseGuard(win)            ← 仅 pack
     └─ loadRendererEntry(win, entry)    ← app://./src/windows/Xxx/index.html
  ▼
webContents "did-finish-load"
  ├─ pack: sendTo("pack", "pack-window-context", 上下文)  ← 补发兜底
  └─ win.show(); win.focus();
```

补充事实：

- 全部窗口资产经自定义协议 `app://` 提供，`protocol.handle` 已异步化（注释明确：同步读盘会把冷启动加载阶段堵在主进程上）。
- `webPreferences` 统一为「preload + contextIsolation + 无 nodeIntegration」—— 渲染层**不含 Node 运行时**，这是后续内存估算的有利前提。
- 即关即销是**明确的设计决策**（`main.ts` 注释原文：「重新打开即全新实例 —— 对编辑器反而是优点：无状态腐化，数据安全完全由持久化层兜底」；行囊草稿在主进程表里，跨窗口一致、崩溃不丢）。任何窗口复用方案都不能无声推翻这一条。
- `windowManager.register()` 自带同名自动关闭语义；`close-guard.ts` 的 `armed` 以 `webContents.id` 为键，`hasArmedCloseGuard()` 遍历 `BrowserWindow.getAllWindows()`。

### 1.2 冷打开成本构成（产物体积，实测自 `dist/assets`）

| 入口                | JS 合计     | CSS 合计   | 总计           | 其中 antd 单 chunk |
| ----------------- | --------- | -------- | ------------ | --------------- |
| PackWindow        | ≈1.535 MB | ≈69.5 KB | **≈1.60 MB** | 1.366 MB（占 85%） |
| SettingsWindow    | ≈1.390 MB | ≈14 KB   | **≈1.41 MB** | 1.366 MB（占 97%） |
| NovelWindow（延伸参考） | ≈2.02 MB  | ≈157 KB  | ≈2.12 MB     | 1.366 MB（占 65%） |

两个关键观察：

1. **antd 单 chunk（1.37 MB）被三个窗口共用**，且 antd v6 走 cssinjs —— 产物 CSS 只有 2.9 KB，样式是在 JS 执行期运行时注入的。也就是说「解析 + 执行 antd」同时承担了脚本成本与样式生成成本，是冷打开的最大单一成本项。
2. 入口自身体积很小（pack 152.9 KB / settings 3.9 KB），**为「按入口拆分预热」提供了天然粒度**。

### 1.3 已有优化基础（避免重复造轮子）

- 1.32.0 / 1.32.1 性能重构解决的是**窗口内**卡顿（虚拟化、算法线性化、分批让出主线程），不涉及打开速度。
- `app://` 协议处理器异步化已落地（§1.1）。
- 路由懒加载、主题首帧同步落盘（`initThemeFromStorage`）等均已存在。

---

## 2. 窗口池方案设计要点（针对提案的分析）

### 2.1 核心不变式（设计红线，先于实现）

1. **池窗口只加载 bootstrap 空白页**（目标 < 10 KB，禁 import React / antd / 任何业务模块）；目标入口的内容在**激活时**才动态装载。
2. 池内常驻空白窗**至多 1 个**（多显示器场景可临时放宽为「每活跃显示器 1 个」，LRU）。
3. 池窗口**不注册**进 `windowManager` 业务名、**不武装** close-guard、不持有任何上下文；仅在被激活的那一刻以业务名注册（天然保留单实例语义）。
4. 补充（replenish）与回收（evict）全部发生在主进程、异步、带埋点。

### 2.2 模块划分

| 模块                                   | 职责                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `electron/window-pool.ts`（新增）        | 池管理单例：`acquire() / release() / replenish() / evictAll()` + 空闲定时器 + 系统事件订阅（内存压力 / 休眠 / 显示器变化 / 退出登录）            |
| `pool-blank.html` + 极简 bootstrap（新增） | 只做一件事：监听 `pool:activate {entry, payload}` → 动态 import 入口 mount 函数 → 挂载 → 回 `pool:ready`                        |
| 各窗口 `main.tsx` 改造                    | 抽出 `mountXxxApp(container, payload)` 导出；`initThemeFromStorage()` 顺序保持不变（暗色首帧不白闪）。现状各入口 main.tsx 均 < 25 行，改造面很小 |

### 2.3 打开流程：窗口复用 + 内容填充

```
用户点击入口
  │ ipcMain.on("pack-window-open" / "settings-window-open")
  ▼
pool.acquire(entry, payload)
  ├─ 有池窗：立即 spawn 替补空白窗（后台，不等 show）
  │   └─ win.webContents.send("pool:activate", { entry, payload })
  │        ▼ 渲染层（同一进程、同一 document）
  │        const { mountPackApp } = await import("../PackWindow/mount")
  │        mountPackApp(root, payload)        ← React + antd + 业务模块此时才装载
  │        （业务数据 IPC 与 mount 并行发起）
  │        ▼
  │        send("pool:ready")
  │   └─ main: windowManager.register(entry, win); show(); focus()
  │         ↑ show 时机建议由 did-finish-load 改为 ready-to-show（首帧就绪才显示）
  └─ 无池窗：走 §1.1 现状冷创建（兜底路径完全不变）
```

关闭 / 释放路径（本方案的关键正确性点）：

```
win.close()（close-guard 同现状）
  ▼
release(win)：重新 loadURL(app://pool-blank.html)   ← 重置 document
  ├─ 模块缓存 / 单例 / store / 定时器 / 监听器 / close-guard armed 状态全部随导航清空
  └─ 窗口回到「空白」态，留在池中待命
```

**为什么必须 reset document 而不是 `root.unmount()`**：动态 `import()` 有模块缓存，同一 document 内 mount → unmount → 再 import 会命中缓存，业务单例与 store 状态残留 —— 那就等于把「状态污染」从窗口级降级到了模块级，与即关即销的设计哲学冲突。重新导航到 bootstrap 页后，JS context 全新，模块缓存清空；保留的只是**进程、preload、协议处理器与（若加了缓存头）V8 代码缓存**的 warmth。重置发生在隐藏期，用户不可见。

与现有机制的衔接点：

| 现有机制                            | 衔接方式                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pack-window-context` / `nonce` | 改由 `pool:activate` 负载携带；装载完成后仍保留一次补发兜底（对齐现状「切书广播若在加载完成前发出会错过」的处理）                                          |
| `novel-work-changed` 广播         | 不变（池窗激活后已注册业务名，广播可达）                                                                                       |
| `close-guard`                   | `attachCloseGuard` 激活时挂；`release` 走导航重置，需显式清理 `approved` 集合（`closed` 事件在重置路径上不触发，`close-guard.ts` 需一个小配合点） |
| `auth-logout`                   | 现状已 destroy settings 窗、pack 走 close；池窗必须一并 `evictAll()`，防跨账号残留                                             |
| 主题                              | bootstrap 激活时重跑 `initThemeFromStorage()`，与现状 main.tsx 顺序一致                                                 |

### 2.4 补充与回收时机

补充（replenish）：

- **播种**：主窗 `did-finish-load` 且空闲数秒后创建第一个空白池窗；会话内从未打开过目标窗口类型的**不预种**（懒门控，见 §5.1）。
- **替补**：`acquire` 成功后立即 spawn 替补（与激活的装载并行，多核下互不阻塞）；替补就绪前若用户再次打开 → 落冷创建兜底（可接受，用埋点量化频率）。

回收（evict）：

| 触发                                                     | 动作              |
| ------------------------------------------------------ | --------------- |
| 池窗创建后 M 分钟未被 acquire（建议 M = 10，可配）                     | destroy         |
| `process.getSystemMemoryInfo().free` 低于阈值              | 收缩到 0           |
| `powerMonitor` suspend                                 | 全部回收（唤醒后按需重建）   |
| `screen` `display-removed` / `display-metrics-changed` | 回收不在当前显示器集合上的池窗 |
| `auth-logout` / `before-quit`                          | `evictAll()`    |

---

## 3. 内存占用分析与最小化

### 3.1 单窗口内存构成（估算，需实测校准）

前提：Electron 42 / Chromium 138 系 / Windows 11 / `nodeIntegration: false` + contextIsolation。

| 组成                            | 空白 bootstrap 窗 | 装载后业务窗（pack / settings） |
| ----------------------------- | -------------- | ----------------------- |
| Chromium renderer 基线          | ~35–60 MB      | ~35–60 MB               |
| preload + 隔离 context          | ~5–15 MB       | ~5–15 MB                |
| React + antd 1.37 MB 执行后 JS 堆 | ~0             | ~60–110 MB              |
| 业务状态 / 缓存 / cssinjs 样式表       | ~0             | ~10–40 MB               |
| **private working set 合计**    | **~45–75 MB**  | **~120–200 MB**         |

实测方法（P0 埋点的一部分）：主进程 `app.getAppMetrics()` 取 per-process `workingSet / peakWorkingSet / privateBytes`，在「池窗创建后 / 激活后 / 释放后」三个时点打快照，与任务管理器互校。

### 3.2 缓存策略对比

| 策略                           | 常驻内存                      | 冷开可省                            | 状态污染风险                                   | 实现成本 |
| ---------------------------- | ------------------------- | ------------------------------- | ---------------------------------------- | ---- |
| **A. 现状（即关即销）**              | 0                         | —                               | 无（设计既定）                                  | —    |
| **B. 空白池 ×1（提案）**            | +45–75 MB                 | 进程层 + 资源层（见 §4.1），估 ~150–400 ms | **无**（bootstrap-only + reset-on-release） | 中    |
| **C. 空白池 ×N（按窗口类型各一）**       | +45–75 MB × N             | 同 B                             | 无                                        | 中    |
| **D. 关窗即隐藏（hide-not-close）** | +120–200 MB / 窗           | 几乎全部（连 mount 都省）                | 中–高（需 reset 协议；与「无状态腐化」哲学冲突）             | 低    |
| **E. 缓存头 + 共享 chunk 预热（互补）** | +10–30 MB（网络缓存 / V8 代码缓存） | 执行层大头（antd 解析）                  | 无                                        | 低    |

### 3.3 最小化设计决策清单

1. **bootstrap 页体积极限**：这是 B/C 与 D 的内存分水岭（45–75 MB vs 120–200 MB），必须用源码守卫钉住（§5.2）。
2. **池上限 1**；多屏按需临时 +1（LRU），绝不超过「活跃显示器数」。
3. **懒门控**：只为「本会话打开过」的窗口类型预种；打开间隔中位数 > 5 分钟的类型停止预种（自适应）。
4. **隐藏期零合成**：`show: false` 的窗口不参与 DWM 合成，透明圆角窗的额外合成成本只发生在可见期（现状已如此）—— 池窗的 GPU 代价近似为 0，内存几乎全是 renderer RSS。
5. **补充操作后置到激活后的空闲期**，避免与打开争 CPU（spawn 进程本身 I/O 重、CPU 轻，实测后也可放宽为立即 spawn）。

---

## 4. 打开速度提升分析

### 4.1 耗时模型（分层估算）

| 层      | 成本项                                               | 估算耗时             | 空白池可省        |
| ------ | ------------------------------------------------- | ---------------- | ------------ |
| 进程层    | BrowserWindow 创建 + renderer 进程 spawn + preload 注入 | ~100–310 ms      | ✅ 全部         |
| 资源层    | app:// HTML + 1.4–1.6 MB 资产读盘（异步、热盘）              | ~30–120 ms       | ⚠️ 部分（缓存命中时） |
| 执行层    | antd 1.37 MB + 入口解析/执行 + cssinjs 运行时样式注入          | ~200–600 ms      | ❌ 不省（除非叠加 E） |
| 框架层    | React mount + 首帧布局                                | ~50–200 ms       | ❌ 不省         |
| 数据层    | 上下文下发 + 业务数据 IPC 装载（SQLite 读）                     | ~20–150 ms       | ❌ 不省         |
| **合计** |                                                   | **~400–1400 ms** |              |

**对提案的直接回答**：字面意义上的「缓存一个空白窗口」只能吃掉进程层（+部分资源层），约 150–400 ms；**执行层（antd 解析）不因空白池而减少** —— 这正是本报告最重要的发现之一，也决定了必须搭配 §4.2 的互补措施，否则投入产出比不高。

### 4.2 关键互补发现：`app://` 响应没有 `Cache-Control`

`protocol.handle` 返回的 `Response` 只设了 `Content-Type`。Chromium 的网络服务（跨渲染进程共享）对无新鲜度头的响应不做稳定缓存 → **每次冷开都重新读盘 + 重新解析**，且 V8 代码缓存无从命中。

资产文件名带内容哈希（`pack-CKL2LKHy.js` 等）→ 可安全加：

```
Cache-Control: public, max-age=31536000, immutable
```

收益两层：① 二次起命中网络缓存，省读盘；② **V8 代码缓存随缓存资源跨渲染进程复用**，antd 解析成本大幅缩减。改动量是一行响应头，零状态风险。**建议先做它，再用数据判断池是否还有必要。**

### 4.3 池化的净收益判断准则

- 埋点显示「进程层 + 资源层」占比 ≥ 40% → 方案 B 有明确价值；
- 执行层占绝对大头 → 优先 E（缓存头），并评估按入口再拆 chunk（antd 已是一整个共享 chunk，cssinjs 运行时注入使「按需加载组件」收益有限，重点应放在缓存与代码缓存）；
- 方案 D（隐藏复用）在两种占比下都是最快，但用常驻内存和状态风险换。

### 4.4 感知层面（顺带项）

- `show` 时机 `did-finish-load` → `ready-to-show`：首帧就绪才显示，消除白窗等待与白闪；
- 激活期间窗口保持隐藏，占位帧背景与圆角窗口外壳一致（现状 `backgroundColor: #00000000` + CSS 圆角），避免透明窗露出桌面。

---

## 5. 权衡取舍与潜在问题

### 5.1 内存常驻成本与门控

常驻 45–75 MB 换 ~150–400 ms。对「每十分钟开一次行囊」的用户是赚的；对「从不打开行囊」的用户是纯浪费。门控三件套：**懒预种 + 空闲回收 + 频率自适应**（§2.4、§3.3）。另外注意：full 版同时开 base + novel + pack + settings 四个全量窗在今天就是允许的，应用的「内存包络」本就按多全量窗设计 —— 池的增量（一个空白窗）相对这个包络是小的。

### 5.2 窗口状态污染（最大风险，也是设计红线）

- 字面「空白窗口」本身安全；风险全部来自演进中有人「优化」成「预加载业务包进池窗」。缓解：**源码守卫测试**（项目已有先例：`edition.test.ts` / `novel-ui-kit.test.ts` / `novel-db-split.test.ts` 均为源码断言式）—— 断言池 bootstrap 页不含业务 import、池大小 ≤ 1、replenish/evict 钩子存在、`release` 必须走导航重置。
- 「激活 = 动态 import」路线必须配 `release` 时的 document 重置（§2.3），否则模块缓存即状态残留。
- `close-guard`：`armed` 以 `webContents.id` 为键，导航重置后渲染层按 dirty 重新武装，语义自然复位；但 `approved` 集合不会随 `closed` 清理（重置路径不触发 `closed`），需在 `release` 中显式移除，否则「本轮已放行」可能跨激活残留。

### 5.3 多显示器 / DPI

- 池窗创建时落在「最近一次 invoke 来源窗口」所在显示器（IPC handler 里可用 `BrowserWindow.fromWebContents(event.sender)` 定位）。`acquire` 时若目标显示器不同 → **隐藏期 `setBounds` 居中后再 `show`**：跨 DPI 重栅格化发生在首帧之前，用户不可见，代价通常 < 100 ms。
- 若实测跨 DPI 移动代价高：按 `display.id` 维护小 LRU（每活跃屏 ≤ 1 个池窗），监听 `display-metrics-changed` / `display-removed` 回收。
- 透明圆角窗跨 DPI：圆角与阴影由 CSS 绘制，不受 DPI 影响；DWM 按新 scale factor 重新合成，无直角残留风险（`roundedCorners: false` 的处理已对）。

### 5.4 崩溃 / 僵尸 / 超时兜底

- 池窗 `render-process-gone` → 弃池并重建；连续崩溃 N 次熔断停止预种（`close-guard.ts` 已有 `render-process-gone` 处理可参照）。
- `pool:activate` 后 T 秒内未收 `pool:ready` → 销毁池窗、走冷创建兜底。**绝不把用户留在「已发出打开指令但没有窗口」的状态。**
- `before-quit` 的 `standDownCloseGuards()` 与 `evictAll()` 顺序要对齐（先缴械再回收）。

### 5.5 dev 模式差异

dev 下 `loadRendererEntry` 指向 vite dev server，痛点从「资产读盘」变成「模块图按需 transform（novel 入口数百个请求）」。池窗在 dev 下的预热语义不同（预 transform 才是大头），且易与 HMR 纠缠。**建议 dev 不启用池**（或仅预取 HTML），只对生产构建生效。

### 5.6 其它

- **焦点**：`show() + focus()` 与现状一致；池窗隐藏期不抢焦点、不进任务栏。
- **休眠唤醒**：`powerMonitor` suspend 回收（§2.4），避免唤醒后多个僵尸渲染进程。
- **lite 版**：不打包 novel / pack 域，池天然无对象；settings 仍可复用同一套池设施。

---

## 6. 替代方案对比

| 方案        | 打开速度 | 常驻内存 | 状态污染风险 | 多屏/DPI 风险 | 实现成本 | 与「即关即销」哲学的兼容 |
| --------- | ---- | ---- | ------ | --------- | ---- | ------------ |
| A. 现状即关即销 | 基线   | 0    | 无      | 无         | —    | 完全保持         |


| B. 空白池 ×1（提案） | 中（省进程层） | +45–75 MB | 无（红线+守卫） | 低（隐藏期移屏） | 中 | 保持（reset-on-release） |  
| C. 空白池 ×N | 同 B | +45–75 MB × N | 无 | 低 | 中 | 保持 |  
| D. 关窗即隐藏 | 最高（省 mount） | +120–200 MB/窗 | 中–高（需 reset 协议） | 低 | 低 | **冲突**（窗口级状态开始有意义） |  
| E. 缓存头 + 代码缓存 | 中高（省执行层） | +10–30 MB | 无 | 无 | **最低** | 完全保持 |  
| F. 同窗内嵌（模态/抽屉） | 最高（无窗口成本） | 0 | 无 | 无 | 中（改 UX） | 不适用（消灭了窗口） |  
| G. 产物瘦身（再拆 chunk） | 中 | 0 | 无 | 无 | 中 | 完全保持 |

组合建议：**E 是所有人的地基**；B/C 与 D 是互斥的两条路线（要内存安全选 B，要极致速度且接受状态管理负担选 D）；F/G 与窗口方案正交。

---

## 7. 建议结论与落地路线

### 7.1 分阶段建议

**P0（无架构风险，先行，1–2 天）**

1. `app://` 协议响应加 `Cache-Control: public, max-age=31536000, immutable`（资产内容哈希，安全）；
2. 打开耗时埋点：主进程 `create t0 → did-finish-load / ready-to-show`；渲染层 `mount 完成` mark；`app.getAppMetrics()` 内存三时点快照。**没有这组数据，一切方案对比都是猜**；
3. `show` 时机改 `ready-to-show`（顺带消除白闪）。

**P1（依据 P0 数据决策）**

- 若「进程层 + 资源层」≥ 40% 且 pack/settings 打开间隔中位数 < 2 分钟 → 落地 **B（空白池 ×1）**，硬性设计约束：bootstrap-only（源码守卫）、reset-on-release、懒门控 + 空闲/内存压力/休眠/显示器回收、`pool:ready` 超时冷创建兜底、dev 不启用、`auth-logout` 全回收。
- 若执行层占绝对大头 → 维持 A，把精力投入 E 的深化（代码缓存命中率验证）与 G。

**P2（延伸）**

- full 版 NovelWindow 子窗同构接入池（它的 2.12 MB 产物最大，但它是「重编辑器」，激活后的数据装载也更重，收益结构需单独实测）；
- D 方案仅在「编辑器/行囊需要跨打开保持视图状态」成为明确需求时再评估，且必须配套 reset 协议 —— 它与 AGENTS.md 记载的「无状态腐化」设计哲学直接冲突，需先修订设计决策再实现。

### 7.2 验收指标（落地 B 时）

| 指标                           | 目标                      |
| ---------------------------- | ----------------------- |
| pack / settings 冷开 P50 / P90 | 以 P0 埋点为基线，P50 降幅 ≥ 25% |
| 池命中率                         | ≥ 80%（打开间隔中位数内）         |
| 空闲内存增量                       | ≤ 80 MB（单池窗）            |
| 池相关崩溃 / 僵尸进程                 | 0                       |
| 跨 DPI 打开                     | 无肉眼可见模糊帧（隐藏期移屏生效）       |
| `pool:ready` 超时兜底            | 100% 落到冷创建，无「无窗口」态      |

### 7.3 待实测清单（P0 埋点产出）

1. 五层耗时分布（进程 / 资源 / 执行 / 框架 / 数据），分 pack、settings、novel；
2. 单窗 RSS：空白 bootstrap 窗 vs 装载后业务窗（校准 §3.1 估算）；
3. antd 1.37 MB 解析 + 执行耗时（执行层定标）；
4. 加缓存头后的二次起：读盘命中率、V8 代码缓存命中对解析耗时的影响；
5. pack / settings 打开间隔分布（决定懒门控参数与池必要性）。

---

## 附录 A 关键代码位置索引

| 事实                                           | 位置                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 窗口入口清单 / 版本分叉                                | `electron/edition.ts`                                                                                  |
| 窗口创建（pack / settings / novel / base / login） | `electron/main.ts`（`createPackWindow` ≈ L425、`createSettingsWindow` ≈ L355、`createNovelWindow` ≈ L266） |
| 统一 webPreferences                            | `electron/main.ts` `createWebPreferences` ≈ L169                                                       |
| `app://` 协议处理器（无缓存头）                         | `electron/main.ts` ≈ L664                                                                              |
| 打开 IPC 入口                                    | `electron/main.ts` ≈ L693–730                                                                          |
| 圆角透明窗公共配置                                    | `electron/main.ts` `ROUNDED_WINDOW_OPTIONS` ≈ L160                                                     |
| 窗口管理池（同名互斥 / 广播）                             | `electron/windowManager.ts`                                                                            |
| 关闭守卫（armed 以 webContents.id 为键）              | `electron/close-guard.ts`                                                                              |
| 行囊窗口上下文 / nonce                              | `electron/main.ts` `packWindowContext` ≈ L412                                                          |
| 退出登录清窗                                       | `electron/main.ts` ≈ L735                                                                              |
| 产物体积数据                                       | `dist/assets/*`（pack ≈1.60 MB / settings ≈1.41 MB / novel ≈2.12 MB，antd 共享 1.366 MB）                   |
| 源码守卫测试先例                                     | `electron/edition.test.ts`、`novel-ui-kit.test.ts`、`novel-db-split.test.ts`                             |

## 附录 B 术语

- **冷打开**：从用户点击入口到窗口可见且可交互的完整路径（现状：每次都是冷打开）。
- **空白池窗**：只加载 bootstrap 页、未装载任何业务模块的待命 BrowserWindow。
- **reset-on-release**：释放池窗时以导航回 bootstrap 页的方式重置 JS context，而非仅卸载 React 根。
