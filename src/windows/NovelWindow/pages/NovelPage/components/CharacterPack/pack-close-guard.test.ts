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

const PACK_DIR = "src/windows/NovelWindow/pages/NovelPage/components/CharacterPack";

const CONFIG = read(`${PACK_DIR}/pack-config.ts`);
const UTILS = read(`${PACK_DIR}/pack-utils.ts`);
const PANEL = read(`${PACK_DIR}/hooks/usePackPanel.ts`);
const DATA = read(`${PACK_DIR}/hooks/usePackData.ts`);
const VIEW_STATE = read(
  "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelViewState.ts",
);
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

  it("Esc 优先级链与顶栏开关都走桥，不再直接 setPackOpen(false)", () => {
    expect(PAGE).toContain("requestClosePackPanel()");
    expect(VIEW_STATE).toContain("requestClosePackPanel()");
    // handleEscape 里不能留着裸的 view.closePack()
    const escapeBody = PAGE.slice(
      PAGE.indexOf("const handleEscape"),
      PAGE.indexOf("useNovelShortcuts("),
    );
    expect(escapeBody).toContain("requestClosePackPanel()");
    expect(escapeBody).not.toMatch(/^\s*view\.closePack\(\);$/m);
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

  it("切章与切作品都先过闸门", () => {
    expect(PAGE).toContain('guardPackBeforeAction("切换章节")');
    expect(PAGE).toContain('guardPackBeforeAction("切换作品")');
    expect(PAGE).toContain("handleSelectWork,");
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
// REQ-027 快速记账（正文选区 → 记入背包）
// ─────────────────────────────────────────────────────────────

const SERVICE = read(`${PACK_DIR}/services/pack-service.ts`);
const HANDLERS = read("electron/handlers/novel-pack-handlers.ts");
const DB = read("electron/db.ts");
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
  it("属性 / 技能补列 updated_at，且默认 0（旧数据不能凭空亮角标）", () => {
    expect(DB).toContain(
      "ALTER TABLE novel_pack_attributes ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
    );
    expect(DB).toContain(
      "ALTER TABLE novel_pack_skills ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
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
