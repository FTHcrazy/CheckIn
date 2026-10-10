/**
 * 行囊第二批修复的守卫（P1-4 / P1-5 / P1-8）+ REQ-043 关闭链路守卫
 *
 * ⚠️ 全部走源码断言：`pack-config.ts` / `pack-utils.ts` 可以正常 import，
 * 但 `usePackPanel` 依赖 React 与 IPC、`electron/close-guard.ts` 依赖 electron
 * 模块（node 下 `require('electron')` 只会拿到可执行文件路径），这三条链路的
 * 约定更适合钉在源码上，防止某次重构把 key 的取值改回 ownerId、或把「先问再退」
 * 写回「先关库再问」却无人察觉。
 * 路径用 `process.cwd()` 拼 —— vitest 下 `import.meta.url` 不是 file: scheme。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string =>
  readFileSync(resolve(process.cwd(), rel), "utf8");

const PACK_DIR = "src/shared/components/CharacterPack";

const CONFIG = read(`${PACK_DIR}/pack-config.ts`);
const UTILS = read(`${PACK_DIR}/pack-utils.ts`);
const PANEL = read(`${PACK_DIR}/hooks/usePackPanel.ts`);
const DATA = read(`${PACK_DIR}/hooks/usePackData.ts`);
const HOST = read(`${PACK_DIR}/index.tsx`);
const PAGE = read(
  "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelPage.ts",
);

describe("P1-4 状态载体键（守卫）", () => {
  it("载体集合的入参取效果自己的 id，不是 ownerId", () => {
    const fn = UTILS.slice(UTILS.indexOf("export function buildActiveCarriersFrom"));
    expect(fn.slice(0, 500)).toContain("id: mod.id");
    expect(fn.slice(0, 500)).not.toContain("id: mod.ownerId");
  });

  it("闸门 1 的判定键只有 carrierKeyOf 一个产出点（两侧各写一遍必然分叉）", () => {
    const body = UTILS.slice(
      UTILS.indexOf("export function computeSummary"),
      UTILS.indexOf("export function castOwnerIds"),
    );
    expect(body).toContain("input.activeCarriers.has(carrierKeyOf(mod))");
    // 反面：直接拿 ownerId 拼键会让状态效果被整条丢弃（且不报错）
    expect(body).not.toContain("carrierKey(mod.ownerType, mod.ownerId)");
    expect(UTILS).toContain('carrierKey("status", mod.id)');
  });

  it("面板与预览共用同一份载体组装（否则预览与真实值会长期不一致）", () => {
    expect(PANEL).toContain("buildActiveCarriersFrom({");
    expect(PANEL).not.toContain("buildActiveCarriers(");
  });

  it("新增状态效果时 ownerId 仍写角色 id（多态表约定，不能跟着改）", () => {
    expect(PANEL).toContain('ownerType: "status"');
    expect(PANEL).toContain("ownerId: state.character.id");
  });
});

describe("P1-5 熟练度缩放只作用于技能宿主（守卫）", () => {
  it("computeSummary 里以 ownerType === 'skill' 收窄", () => {
    expect(UTILS).toContain('mod.scaleByProficiency && mod.ownerType === "skill"');
  });

  it("效果编辑器不再给非技能宿主这个开关", () => {
    const editor = read(`${PACK_DIR}/components/EffectEditor/index.tsx`);
    expect(editor).toContain('current.ownerType === "skill"');
  });

  it("列表上的「按熟练度缩放」标签同样收窄，不给失效条目挂标签", () => {
    const list = read(`${PACK_DIR}/components/ModifierList/index.tsx`);
    expect(list).toContain('mod.scaleByProficiency && mod.ownerType === "skill"');
  });
});

describe("P1-8 行囊关闭链路（守卫）", () => {
  it("存在受保护关闭桥，且由面板挂载时注册", () => {
    expect(CONFIG).toContain("export function registerPackCloser");
    expect(CONFIG).toContain("export function requestClosePackPanel");
    expect(PANEL).toContain("registerPackCloser(");
  });

  it("Esc 关闭走面板自己的受保护路径（行囊已独立成窗口，宿主不再代持开关）", () => {
    expect(PANEL).toContain("registerPackCloser(() => requestCloseRef.current())");
    // 面板 Esc：闸门弹窗自己吃掉 Esc，等价「取消」
    expect(HOST).toContain("if (current.guardOpen)");
    // 行囊窗口的关闭按钮最终也走 requestClose
    expect(HOST).toContain("void current.requestClose()");
  });

  it("保存失败不放行 —— 闸门检查保存返回值后再决定", () => {
    const body = PANEL.slice(PANEL.indexOf("const guardSaveAndProceed")).slice(0, 400);
    expect(body).toContain("const ok = await data.save");
    expect(body).toContain("if (!ok)");
    expect(body).toContain("return;");
  });

  it("卸载与切作品都有 flushDraft 兜底", () => {
    expect(DATA).toContain("void flushDraft();");
    // deps 里带 workId，让 cleanup 在换书那一帧先跑一次
    const effect = DATA.slice(DATA.indexOf("卸载前 / 切作品前兜底 flush"));
    expect(effect.slice(0, 320)).toContain("[workId, flushDraft]");
  });
});

describe("REQ-043 切章 / 切作品 / 退出应用拦截（守卫）", () => {
  const GUARD = read("electron/close-guard.ts");
  const MAIN = read("electron/main.ts");
  const PRELOAD = read("electron/preload.ts");
  const DTS = read("src/shared/types/electron.d.ts");
  const CHANNEL = read(`${PACK_DIR}/services/pack-close-guard.ts`);
  const HOST = read(`${PACK_DIR}/index.tsx`);
  const MODAL = read(`${PACK_DIR}/components/CloseGuardModal/index.tsx`);

  it("闸门是异步裁决（返回布尔），不是只报「接没接手」", () => {
    expect(CONFIG).toContain("export function registerPackGuard");
    expect(CONFIG).toContain("export async function guardPackBeforeAction");
    // 没有面板时要直接放行，否则页面层每次切章都白等一次 Promise
    expect(CONFIG.slice(CONFIG.indexOf("export async function guardPackBeforeAction"))).toContain(
      "if (!guard) return true;",
    );
    expect(PANEL).toContain("registerPackGuard((reason) => requestGuardRef.current(reason))");
    expect(PANEL).toContain("registerPackGuard(null)");
  });

  it("切章 / 切作品不再过闸门：草稿在主进程表，跨窗口一份，切换不丢编辑", () => {
    // 行囊拆独立窗口后，草稿落 `novel_pack_drafts`（主进程），切书重挂时会
    // 兜底 flush —— 页面层不需要再拦截切章 / 切作品
    expect(PAGE).not.toContain("guardPackBeforeAction");
    expect(CONFIG).toContain("export async function guardPackBeforeAction");
  });

  it("已有弹窗在问时本次动作直接取消 —— 不能让新问题顶掉旧 Promise", () => {
    const body = PANEL.slice(PANEL.indexOf("const requestGuard"));
    expect(body.slice(0, 400)).toContain("if (guardResolveRef.current) return false;");
  });

  it("只在有未保存改动时武装主进程守卫（常态退出零往返）", () => {
    expect(PANEL).toContain("setCloseGuardEnabled(open && data.dirty > 0)");
    expect(CHANNEL).toContain("setCloseGuard(");
    expect(PRELOAD).toContain("'window-close-guard'");
    expect(PRELOAD).toContain("'window-close-response'");
    expect(DTS).toContain("setCloseGuard: (enabled: boolean) => void");
    expect(DTS).toContain("respondClose: (allow: boolean) => void");
  });

  it("主进程的关闭询问复用同一个弹窗，答复即放行与否", () => {
    expect(CHANNEL).toContain("onCloseRequest");
    expect(PANEL).toContain("onCloseRequest((reason) =>");
    expect(PANEL).toContain("respondCloseRequest(allow)");
    // 吞掉未知原因，别把主进程的裸字符串透进 UI
    expect(CHANNEL).toContain('"退出应用"');
    expect(CHANNEL).toContain('"关闭窗口"');
  });

  it("弹窗三选一的落点是「保存并继续」，不是「保存并关闭」", () => {
    expect(MODAL).toContain("onSaveAndProceed");
    expect(MODAL).toContain("onDiscardAndProceed");
    expect(MODAL).toContain("保存并继续");
    expect(MODAL).toContain("{reason}前有");
    expect(HOST).toContain("api.guardSaveAndProceed()");
    expect(HOST).toContain("api.guardCancel");
    // Esc 要吃掉闸门弹窗（等价取消），否则会冒泡去再请求一次关闭
    expect(HOST).toContain("if (current.guardOpen)");
  });

  it("主窗「隐藏到托盘」不拦，只有真退出才拦（子窗即关即销，正常拦）", () => {
    expect(MAIN).toContain("attachCloseGuard(novelWin, () => isQuitting);");
    expect(MAIN).toContain("attachCloseGuard(novelWin);");
  });

  it("退出询问发生在清理之前 —— 先 preventDefault 问完再 closeDb", () => {
    const body = MAIN.slice(MAIN.indexOf('app.on("before-quit"'));
    const askAt = body.indexOf("hasArmedCloseGuard()");
    // 注释里也提到了 closeDb()，要的是真正的调用 → 取最后一次出现
    const dbAt = body.lastIndexOf("closeDb()");
    expect(askAt).toBeGreaterThan(-1);
    expect(dbAt).toBeGreaterThan(-1);
    expect(askAt).toBeLessThan(dbAt);
    expect(body).toContain("event.preventDefault()");
    // 询问期间不能置 isQuitting：置了主窗的 close 就不再进托盘，直接销毁
    const guardBranch = body.slice(0, body.indexOf("return;"));
    expect(guardBranch).not.toContain("isQuitting = true");
  });

  it("渲染层崩了 / 已放行过的窗口不再拦（否则应用永远退不出去）", () => {
    expect(GUARD).toContain("render-process-gone");
    expect(GUARD).toContain("approved.has(id)");
    expect(MAIN).toContain("registerCloseGuardHandlers();");
  });

  it("询问隐藏窗口前先 show —— 否则弹窗发给看不见的窗口，看着像没反应", () => {
    expect(GUARD).toContain("if (!win.isVisible()) win.show();");
  });

  it("取消退出的那一轮要把已放行的窗口恢复成未放行", () => {
    expect(GUARD).toContain("approved.delete(askedId)");
  });

  it("询问期间窗口被藏起来 = 本轮询问作废（否则退出会一直是空操作）", () => {
    expect(GUARD).toContain('win.on("hide"');
  });
});

// ─────────────────────────────────────────────────────────────
// 境界「阶内进位」（曾经点不动）
// ─────────────────────────────────────────────────────────────

describe("境界阶内进位（守卫）", () => {
  const REALM_UI = read(`${PACK_DIR}/components/RealmModule/index.tsx`);
  const REALM = read(`${PACK_DIR}/pack-realm.ts`);

  it("「阶内进位」必须传 carry: true —— 漏了会走 clamp 分支，位置原样返回", () => {
    const at = REALM_UI.indexOf("阶内进位");
    expect(at).toBeGreaterThan(-1);
    // 取按钮本体（onClick 在同一条 JSX 里，往前取一段足够覆盖）
    const button = REALM_UI.slice(Math.max(0, at - 400), at);
    expect(button).toContain("carry: true");
    expect(button).toContain("delta: 1");
  });

  it("进位 / 夹取只在 setRealm 里算一次，plan 回带 position 供文案使用", () => {
    // 写入口不得自己再算一遍位置（两份规则漂移 = 假变更）
    const body = PANEL.slice(PANEL.indexOf("const writeRealm = useCallback"));
    expect(body.slice(0, 900)).not.toContain("carryRealm(");
    expect(body.slice(0, 900)).not.toContain("clampRealm(");
    expect(body).toContain("plan.position");
    // setRealm 必须回带 position
    expect(REALM).toContain("position: next");
  });
});

// ─────────────────────────────────────────────────────────────
// 未保存计数 = 净变化（不是逐次按键累加）
// ─────────────────────────────────────────────────────────────

describe("未保存计数口径（守卫）", () => {
  const DIRTY = read(`${PACK_DIR}/pack-dirty.ts`);

  it("计数由 countNetChanges 派生，不得回退成自增计数器", () => {
    // 唯一写入口是 recomputeDirty
    expect(DATA).toContain("countNetChanges(savedRef.current, next)");
    expect(DATA).toContain("import { countNetChanges } from \"../pack-dirty\"");
    // 反面：不许再有 setDirty((count) => count + N) 这种累加
    expect(DATA).not.toMatch(/setDirty\(\(count\)\s*=>/);
    // 也不许 updateXxx 之类的编辑点自己调 setDirty
    expect(PANEL).not.toMatch(/setDirty\(/);
  });

  it("updatedAt 不参与比较（它是打点，不是内容）", () => {
    expect(DIRTY).toContain("delete copy.updatedAt");
    expect(DIRTY).not.toContain("updatedAt:");
  });

  it("主角绑定（即时落库的那一格）不进计数", () => {
    const body = DIRTY.slice(DIRTY.indexOf("function realmSignature"));
    expect(body).not.toContain("entityId");
    expect(body).toContain("realmLink");
  });

  it("增删发生时不再重复计一次「移动」", () => {
    // 顺序比较必须有「成员完全一致」的前置判断，否则删 2 行会算成 3 处
    expect(DIRTY).toContain("sameMembers");
    expect(DIRTY).toContain("before.size === after.size");
  });
});

// ─────────────────────────────────────────────────────────────
// REQ-027 快速记账（正文选区 → 记入背包）
// ─────────────────────────────────────────────────────────────

const SERVICE = read(`${PACK_DIR}/services/pack-service.ts`);
const HANDLERS = read("electron/handlers/novel-pack-handlers.ts");
// ⚠️ novel 域的表自 1.33.0 起全部住在 novel.db（electron/novel-db.ts），
// checkin.db（electron/db.ts）里已经没有 novel_* 的表了 —— 断言要跟着搬家
const DB = read("electron/novel-db.ts");
const CTXMENU = read(
  "src/windows/NovelWindow/pages/NovelPage/components/EntityContextMenu/index.tsx",
);

describe("REQ-027 快速记账（守卫）", () => {
  it("记账走「面板优先、没面板落主进程」两条路，且面板那条不 await", () => {
    const body = SERVICE.slice(SERVICE.indexOf("export async function quickAddPackItem"));
    expect(body).toContain("runPackQuickAdd(request)");
    // handled 为真 = 面板接手（它只改内存文档）；否则才走 IPC
    expect(body).toContain("if (local.handled) return local.ok;");
    expect(body).toContain("novel.pack.quickAdd(");
  });

  it("面板只在 open 时注册记账桥，卸载时必须摘掉（否则面板关了还往内存里写）", () => {
    const at = PANEL.lastIndexOf("registerPackQuickAdd(");
    // 注册点前后各取一段：`if (!open)` 在它**之前**，摘除在它之后
    const around = PANEL.slice(Math.max(0, at - 200), at + 300);
    expect(around).toContain("if (!open) return undefined;");
    expect(around).toContain("registerPackQuickAdd(null)");
  });

  it("ⓘ 主进程有草稿时并入草稿，没有才直插正式表", () => {
    // 草稿优先于正式行：只插正式表会被草稿整个盖掉 —— 刚记的物品凭空消失
    const body = HANDLERS.slice(
      HANDLERS.indexOf('"novel-pack-quick-add"'),
      HANDLERS.indexOf('"novel-pack-save"'),
    );
    expect(body).toContain("novel_pack_drafts WHERE character_id = ?");
    expect(body).toContain("UPDATE novel_pack_drafts");
    // 直插正式表只能出现在 else 分支里
    const insertAt = body.indexOf("INSERT INTO novel_pack_items");
    const elseAt = body.indexOf("} else {");
    expect(insertAt).toBeGreaterThan(elseAt);
  });

  it("记账带上来源章节（价值有一半在「这东西是哪一章捡的」）", () => {
    const body = HANDLERS.slice(
      HANDLERS.indexOf('"novel-pack-quick-add"'),
      HANDLERS.indexOf('"novel-pack-save"'),
    );
    expect(body).toContain("sourceChapterId: chapterId || \"\"");
    expect(body).toContain("item.sourceChapterId || null");
  });

  it("右键菜单把「记入背包」放在最前，且它是一次点击完成的独立动作", () => {
    // 只看 JSX 本体：组件顶部的注释里也写着「新建资料卡」，从头 indexOf 会被注释骗到
    const jsx = CTXMENU.slice(CTXMENU.indexOf("return ("));
    const packAt = jsx.indexOf("记入背包");
    const markAt = jsx.indexOf("新建资料卡");
    expect(packAt).toBeGreaterThan(-1);
    expect(markAt).toBeGreaterThan(-1);
    expect(packAt).toBeLessThan(markAt);
    expect(CTXMENU).toContain("onAddToPack");
  });
});

// ─────────────────────────────────────────────────────────────
// REQ-028 本章变动高亮
// ─────────────────────────────────────────────────────────────

describe("REQ-028 本章变动角标（守卫）", () => {
  it("属性 / 技能声明 updated_at，且默认 0（旧数据不能凭空亮角标）", () => {
    // 分段取「这一张表的建表块」：全文件 toContain 会命中别的表，断言形同虚设
    const block = (table: string): string => {
      const start = DB.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
      expect(start, `novel.db 缺少建表语句 ${table}`).toBeGreaterThan(-1);
      const end = DB.indexOf("\n    );", start);
      return DB.slice(start, end === -1 ? DB.length : end);
    };
    expect(block("novel_pack_attributes")).toContain(
      "updated_at INTEGER NOT NULL DEFAULT 0",
    );
    expect(block("novel_pack_skills")).toContain(
      "updated_at INTEGER NOT NULL DEFAULT 0",
    );
  });

  it("保存时把两个 updatedAt 写进正式表（否则跨会话的角标永远不亮）", () => {
    expect(HANDLERS).toContain("a.updatedAt || 0");
    expect(HANDLERS).toContain("s.updatedAt || 0");
  });

  it("改动时打点：新增与编辑都要写 updatedAt（只写新增会让「改了」永远不亮）", () => {
    expect(PANEL).toContain("? { ...attr, ...patch, updatedAt: Date.now() } : attr");
    expect(PANEL).toContain("? { ...skill, ...patch, updatedAt: Date.now() } : skill");
  });

  it("效果词条的改动会记到宿主上（改了装备的加成，物品那行也该亮）", () => {
    expect(PANEL).toContain("touchCarrier(");
    // 删除时必须先取宿主再过滤：条目一删就查不到了
    const body = PANEL.slice(PANEL.indexOf("const removeModifier = useCallback"));
    expect(body.slice(0, 400).indexOf("carrierOfModifier(current, id)")).toBeLessThan(
      body.slice(0, 400).indexOf("filter((mod) => mod.id !== id)"),
    );
  });

  it("已读底线走界面偏好（即改即存）—— 不属于这本书的设定数据", () => {
    expect(CONFIG).not.toContain("changedReadAt");
    expect(PANEL).toContain("patchPrefs({ changedReadAt: Date.now() })");
    // 判据（§8.6.2）：改了这个值，别人的这本书会变吗？不会 → 不进草稿
    expect(DATA).not.toContain("changedReadAt");
  });

  it("三个模块都渲染角标，且判定统一走 api（组件自己算会各存一份时间窗）", () => {
    for (const module of ["InventoryModule", "AttributesModule", "SkillsModule"]) {
      const source = read(`${PACK_DIR}/components/${module}/index.tsx`);
      expect(source, `${module} 没有角标`).toContain("<PackChangedDot");
      expect(source, `${module} 自己算了时间窗`).toContain("api.isRecentlyChanged(");
    }
  });
});

describe("退出链路的时序（守卫）", () => {
  const MAIN = read("electron/main.ts");
  const GUARD = read("electron/close-guard.ts");
  const DB = read("electron/db.ts");
  const PACK_HANDLERS = read("electron/handlers/novel-pack-handlers.ts");

  it("托盘「退出」不得提前置 isQuitting —— 置了 before-quit 的询问分支就被整体跳过", () => {
    const tray = MAIN.slice(MAIN.indexOf('label: "退出"'));
    expect(tray.slice(0, 300)).not.toContain("isQuitting = true");
  });

  it("before-quit 清理阶段必须先给守卫缴械（否则窗口还会弹「未保存」，保存必然失败）", () => {
    const quit = MAIN.slice(MAIN.indexOf('app.on("before-quit"'));
    expect(quit).toContain("standDownCloseGuards()");
    // 缴械必须发生在清理动作之前（unregisterAll 之后才算开清理）
    expect(quit.indexOf("standDownCloseGuards()")).toBeLessThan(
      quit.indexOf("globalShortcut.unregisterAll()"),
    );
  });

  it("closeDb() 必须在 will-quit，不得留在 before-quit（窗口销毁期间还可能有最后一次保存）", () => {
    const quit = MAIN.slice(
      MAIN.indexOf('app.on("before-quit"'),
      MAIN.indexOf('app.on("will-quit"'),
    );
    expect(quit).not.toContain("closeDb()");
    expect(MAIN).toContain('app.on("will-quit"');
    const will = MAIN.slice(MAIN.indexOf('app.on("will-quit"'));
    expect(will.slice(0, 300)).toContain("closeDb()");
  });

  it("缴械后的守卫不得再拦 close（preventDefault 前先看 inert）", () => {
    const handler = GUARD.slice(GUARD.indexOf('win.on("close"'));
    expect(handler.slice(0, 300)).toContain("inert");
    expect(GUARD).toContain("export function standDownCloseGuards");
  });

  it("closeDb 幂等：什么都没关时不广播 onClosed（监听者不该重复收到关闭事件）", () => {
    expect(DB).toContain("if (hadUserDb || hadAuthDb) emitLifecycle('onClosed')");
  });

  it("novel-pack-save / novel-config 在库未就绪时优雅拒绝，不抛穿给渲染层", () => {
    expect(PACK_HANDLERS).toContain("if (!isNovelDbReady())");
    const save = PACK_HANDLERS.slice(PACK_HANDLERS.indexOf('"novel-pack-save"'));
    expect(save.slice(0, 600)).toContain("isNovelDbReady()");
    expect(read("electron/handlers/novel-handlers.ts")).toContain("if (!requireReady())");
  });
});
