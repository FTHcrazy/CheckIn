import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 新手引导体系 · 源码守卫
 *
 * 与 `work-numbering-guard.test.ts` 同思路：引导链路横跨书架页、编辑器页、
 * 行囊窗口三个容器，且 Tour 靠 `data-tour-target` 定位真实按钮。
 * **任何一次按钮重构都可能让 Tour 高亮错位而不报错**（RK-03，中风险），
 * 所以这里用源码断言把锚点与挂载点钉住。
 *
 * 反向断言（"源码不许含 X"）一律先 stripComments：注释里常引用被删掉的原文案。
 */

const root = process.cwd();
const read = (...segments: string[]): string =>
  readFileSync(join(root, ...segments), "utf8").replace(/\\/g, "/");

/** 去掉块注释与行注释（保留字符串内容，够用于断言） */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * 锚点 → 该锚点必须出现在哪个源文件。
 * 改动任一按钮时，如果忘了把 data-tour-target 一起搬走，这里会红。
 */
const ANCHOR_OWNERS: Array<[anchor: string, file: string]> = [
  ["shelf-new-work", "src/windows/NovelWindow/pages/BookshelfPage/components/ShelfTopBar/index.tsx"],
  ["tree-new-chapter", "src/windows/NovelWindow/pages/NovelPage/components/ChapterTree/index.tsx"],
  ["tree-new-volume", "src/windows/NovelWindow/pages/NovelPage/components/ChapterTree/index.tsx"],
  ["topbar-setting", "src/windows/NovelWindow/pages/NovelPage/components/NovelTopBar/index.tsx"],
  ["topbar-pack", "src/windows/NovelWindow/pages/NovelPage/components/NovelTopBar/index.tsx"],
  ["editor-body", "src/windows/NovelWindow/pages/NovelPage/components/EditorPane/index.tsx"],
  ["editor-first-chapter", "src/windows/NovelWindow/pages/NovelPage/components/EditorPane/index.tsx"],
  ["status-annotation", "src/windows/NovelWindow/pages/NovelPage/components/StatusBar/index.tsx"],
  // UI-10 拆分：目录内 anchor 挂在实际渲染它的子组件上（不是父组合器）。
  // T03 起整棵树在 src/shared（供全局窗口复用），路径随组件迁入。
  ["setting-library", "src/shared/components/SettingCenter/components/SettingPanelHead/index.tsx"],
  ["pack-modules", "src/shared/components/CharacterPack/components/PackHeader/index.tsx"],
  // T04（1.4x）：第 6 步「跨书共享设定」锚点挂在书架顶栏的「全局设定中心」按钮上
  ["shelf-global-setting", "src/windows/NovelWindow/pages/BookshelfPage/components/ShelfTopBar/index.tsx"],
];

describe("引导锚点（RK-03：目标漂移）", () => {
  const copy = read("src/shared/novel/guide-copy.ts");

  it("锚点集中在 guide-copy.ts 的 TOUR_TARGETS 里，不散落字面量", () => {
    expect(copy).toContain("export const TOUR_TARGETS");
    for (const [anchor] of ANCHOR_OWNERS) {
      expect(copy).toContain(anchor);
    }
  });

  it.each(ANCHOR_OWNERS)("锚点 %s 挂在 %s 上", (anchor, file) => {
    expect(read(file)).toContain(`data-tour-target="${anchor}"`);
  });

  it("Tour 目标探测走 getClientRects（display:none 的祖先也要判为不可见）", () => {
    const target = read("src/windows/NovelWindow/components/NovelGuideTour/target.ts");
    expect(target).toContain("getClientRects()");
    expect(target).toContain("resolveStepTarget");
  });
});

describe("Tour 挂载与编排", () => {
  it("第 1、6 步由书架页实例播、第 2-5 步由编辑器页实例播（两页是 display 切换的兄弟容器）", () => {
    const shelf = read("src/windows/NovelWindow/pages/BookshelfPage/BookshelfPage.tsx");
    const editor = read("src/windows/NovelWindow/pages/NovelPage/NovelPage.tsx");
    expect(shelf).toContain('<NovelGuideTour view="shelf" visible={visible} />');
    // editor 侧多一个 onGoToView（P2-1：第 5→6 步跨视图回书架时切视图），
    // 故断言挂载前缀 + 新回调，而不是写死整行自闭合
    expect(editor).toContain('<NovelGuideTour view="editor" visible={visible}');
    expect(editor).toContain("onGoToView={onGoToView}");
  });

  it("Tour 步骤按视图分组：第 1、6 步属 shelf，第 2-5 步属 editor", () => {
    const copy = stripComments(read("src/shared/novel/guide-copy.ts"));
    expect(copy).toContain('view: "shelf"');
    expect(copy).toContain('view: "editor"');
    expect(copy).toContain("GUIDE_TOTAL_STEPS = 6");
  });

  it("编辑器内的顺序是 2 卷章 → 3 设定 → 4 行囊 → 5 右键，第 6 步回书架讲跨书共享，共 6 步", () => {
    const copy = stripComments(read("src/shared/novel/guide-copy.ts"));
    const stepMarks = copy.match(/step: \d/g) ?? [];
    expect(stepMarks).toHaveLength(6);
    expect(copy).not.toContain("step: 7");
    // 顺序即文档承诺的顺序：右键收尾（编辑器段），第 6 步（跨书共享）在最后
    expect(copy.indexOf("建一卷、一章，开始写")).toBeLessThan(
      copy.indexOf("先把全书的总设定立起来"),
    );
    expect(copy.indexOf("先把全书的总设定立起来")).toBeLessThan(
      copy.indexOf("行囊：主角的状态面板"),
    );
    expect(copy.indexOf("行囊：主角的状态面板")).toBeLessThan(
      copy.indexOf("选中文字，右键有惊喜"),
    );
    expect(copy.indexOf("选中文字，右键有惊喜")).toBeLessThan(
      copy.indexOf("一套设定，多本书共用"),
    );
    const rightClickBlock = copy.slice(copy.indexOf("选中文字，右键有惊喜") - 300);
    expect(rightClickBlock).toContain("step: 5");
    const globalBlock = copy.slice(copy.indexOf("一套设定，多本书共用") - 300);
    expect(globalBlock).toContain("step: 6");
    expect(globalBlock).toContain("shelfGlobalSetting");
  });

  it("目标不可见时暂停而不是写死 state（等视图到位后续播）", () => {
    const tour = read("src/windows/NovelWindow/components/NovelGuideTour/index.tsx");
    expect(tour).toContain("pause()");
  });

  it("探测不到目标时重试到预算尽头才暂停（首帧布局未定不能一挫就放）", () => {
    const tour = read("src/windows/NovelWindow/components/NovelGuideTour/index.tsx");
    expect(tour).toContain("GUIDE_PROBE_BUDGET_MS = 600");
    expect(tour).toContain("requestAnimationFrame(probe)");
  });

  it("可见性三道关口：布局盒 / 视口交集 / 透明祖先（折叠侧栏曾误判可见）", () => {
    const target = read("src/windows/NovelWindow/components/NovelGuideTour/target.ts");
    expect(target).toContain("getClientRects()");
    expect(target).toContain("window.innerWidth");
    expect(target).toContain('style.opacity === "0"');
  });

  it("视图不可见时实例收摊；store 的 start() 按视图改拍续播（互等死锁的修复）", () => {
    const tour = read("src/windows/NovelWindow/components/NovelGuideTour/index.tsx");
    expect(tour).toContain("if (!visible) {");
    const store = read("src/windows/NovelWindow/store/useGuideStore.ts");
    expect(store).toContain("viewOfStep(playingStep) === viewOfStep(step)");
  });

  it("强制引导只覆盖第 1-4 步：无关闭叉、不响应 Esc，第 5、6 步恢复可关闭", () => {
    const tour = read("src/windows/NovelWindow/components/NovelGuideTour/index.tsx");
    expect(tour).toContain("closable={!forced}");
    expect(tour).toContain("keyboard={!forced}");
    // 强制边界按 FORCED_MAX_STEP（=4）派生，而不是「是否最后一步」：
    // 1.4x 新增第 6 步后，`!isLast` 会把第 5 步误升为强制步
    expect(tour).toContain("const forced = step.step <= FORCED_MAX_STEP");
    const copy = read("src/shared/novel/guide-copy.ts");
    expect(copy).toContain("FORCED_MAX_STEP = 4");
  });

  it("guideState=done 的老用户不因步数 5→6 被强制重放（判据是 state，不是步数）", () => {
    // 自动播放只认 state：done / skipped 永不自动弹，与步数增减无关
    const state = stripComments(read("src/shared/novel/guide-state.ts"));
    expect(state).toContain('record.state === "not_started"');
    // store 的 start() 同样先挡非 not_started / in_progress
    const store = stripComments(
      read("src/windows/NovelWindow/store/useGuideStore.ts"),
    );
    expect(store).toContain(
      'record.state !== "not_started" && record.state !== "in_progress"',
    );
    // 步数常量本身已是 6（升级后 done 记录原样保留，不触发重播分支）
    const copy = stripComments(read("src/shared/novel/guide-copy.ts"));
    expect(copy).toContain("GUIDE_TOTAL_STEPS = 6");
  });

  it("单步实例的 finish 路由坑：onClose 不许在强制步上接 skip", () => {
    // antd 单步 Tour 的「下一步」恒走 finish 路由（current===total-1 恒真），
    // rc-tour 的 onFinish 先调 handleClose → 触发 onClose。若强制步也接
    // skip，每点一次下一步就先把 playingStep 清掉，goNext 随后读到 null
    // 空转——「点下一步，下一张卡片再也不出现」就是这么来的（1.44.0 修复）。
    const tour = stripComments(
      read("src/windows/NovelWindow/components/NovelGuideTour/index.tsx"),
    );
    expect(tour).not.toContain("onClose={skip}");
    expect(tour).toContain("onClose={forced ? undefined : skip}");
  });
});

describe("空态提示移除（T-01，2026-10-14 用户反馈：去掉编辑器空态的气泡）", () => {
  it("编辑器空态不再挂 GuideTooltip，文案常量里也没有 T-01", () => {
    const editor = stripComments(
      read("src/windows/NovelWindow/pages/NovelPage/components/EditorPane/index.tsx"),
    );
    expect(editor).not.toContain("GuideTooltip");
    const copy = stripComments(read("src/shared/novel/guide-copy.ts"));
    expect(copy).not.toContain('id: "T-01"');
  });
});

describe("打字保护（FR-06）", () => {
  it("编辑器键入时上报 noteTyping", () => {
    const editor = read("src/windows/NovelWindow/pages/NovelPage/components/EditorPane/index.tsx");
    expect(editor).toContain("noteTyping(Date.now())");
  });

  it("播放中开始打字 → 引导让位并延后", () => {
    const store = read("src/windows/NovelWindow/store/useGuideStore.ts");
    expect(store).toContain("yieldToTyping");
    expect(store).toContain("TYPING_GUARD_MS = 3000");
  });

  it("启动引导前先判打字保护窗口", () => {
    const store = read("src/windows/NovelWindow/store/useGuideStore.ts");
    expect(store).toContain("lastTypingAt < TYPING_GUARD_MS");
  });
});

describe("帮助中心（L3 常驻入口）", () => {
  it("F1 在窗口层注册（覆盖书架页与编辑器页）", () => {
    const app = read("src/windows/NovelWindow/App.tsx");
    expect(app).toContain('event.key !== "F1"');
    expect(app).toContain("openHelp()");
  });

  it("小说窗口与行囊窗口都常驻帮助入口", () => {
    const app = read("src/windows/NovelWindow/App.tsx");
    const pack = read("src/shared/components/CharacterPack/index.tsx");
    expect(app).toContain("<HelpCenter");
    expect(pack).toContain("<HelpCenter");
  });

  it("行囊窗口没有 Tour，所以不传 onReplayGuide（不给够不着的按钮）", () => {
    // 必须 stripComments：源码注释里提到了这个 prop 名
    const pack = stripComments(read("src/shared/components/CharacterPack/index.tsx"));
    expect(pack).not.toContain("onReplayGuide");
  });

  it("帮助入口挂未读红点（B-01）", () => {
    const app = read("src/windows/NovelWindow/App.tsx");
    expect(app).toContain("selectHelpBadgeVisible");
    expect(app).toContain("<Badge dot");
  });
});

describe("持久化", () => {
  it("引导状态走 novel_config，不新增数据表（PRD §4）", () => {
    const state = read("src/shared/novel/guide-state.ts");
    expect(state).toContain("configGet(GUIDE_STORAGE_KEY)");
    expect(state).toContain("configSet(GUIDE_STORAGE_KEY");
    expect(state).not.toContain("CREATE TABLE");
  });

  it("config 键登记在 STORAGE_KEYS，不写字面量", () => {
    const constants = read("src/shared/novel/constants.ts");
    expect(constants).toContain('guideState: "novel_guide_state_v1"');
  });

  it("本模块的纯逻辑不含 React，两个窗口可共用", () => {
    const state = read("src/shared/novel/guide-state.ts");
    const copy = read("src/shared/novel/guide-copy.ts");
    const doc = read("src/shared/novel/guide-doc.ts");
    expect(state).not.toMatch(/from "react"/);
    expect(copy).not.toMatch(/from "react"/);
    expect(doc).not.toMatch(/from "react"/);
  });
});

describe("弱提示 T-03：选中文字 → 右键建资料卡", () => {
  const editor = () =>
    read("src/windows/NovelWindow/pages/NovelPage/components/EditorPane/index.tsx");

  it("编辑器挂了选区气泡，且锚点来自选区坐标（不是静态 target）", () => {
    const source = editor();
    expect(source).toContain("<SelectionGuide");
    expect(source).toContain("coordsAtPos");
  });

  it("只消费一次 T-03，且 Tour 正在播时不抢（避免两个气泡打架）", () => {
    const source = editor();
    expect(source).toContain('consumeTooltip("T-03"');
    expect(source).toContain("store.playingStep !== null");
  });

  it("单字符选区与输入法组合期都不弹（多半是拖动误选 / 候选替换范围）", () => {
    const source = editor();
    expect(source).toContain("GUIDE_MIN_SELECTION_LENGTH");
    expect(source).toContain("composingRef.current");
  });

  it("选区坐标会失效：打字与滚动都要撤掉气泡", () => {
    const source = editor();
    // 同一个「有则清空」的 updater 只写一份（clearGuideAnchor），两处调用：
    // docChanged 分支与滚动回调，都用它，避免散落两份同形代码
    const clears = source.match(/setGuideAnchor\(\(prev\) => \(prev \? null : prev\)\)/g);
    expect(clears).toHaveLength(1);
    expect(source).toContain("clearGuideAnchor()");
    // 打字分支在初始化 effect 内（effect deps 为 []，只能用 setState 本身）
    expect(source).toContain("onScrollChange(event.currentTarget.scrollTop)");
  });

  it("气泡文案讲清了右键能建什么（角色 / 地点 / 势力 / 物品）", () => {
    const copy = read("src/shared/novel/guide-copy.ts");
    expect(copy).toContain("右键可以把选中的名字建成资料卡");
  });
});

describe("新建作品校验（L-03：空名点「创建并开写」曾静默无反应）", () => {
  const shelf = () => read("src/windows/NovelWindow/pages/BookshelfPage/BookshelfPage.tsx");

  it("弹窗打开时 Tour 让位（PRD §11：引导不与弹窗抢焦点，卡片会盖住书名输入框）", () => {
    const source = stripComments(shelf());
    expect(source).toContain("useGuideStore.getState().pause()");
    // 只有「取消」才续播；创建成功走静默 closeCreate，由视图切换的 effect 接到第 2 步
    expect(source).toContain("onCancel={cancelCreate}");
    expect(source.indexOf("getState().start(1)")).toBeGreaterThan(
      source.indexOf("const cancelCreate"),
    );
    // OK 回调里不能续播，否则 playingStep=1 会在切到编辑器后卡死（start 遇非空即退）
    const okBody = source.slice(
      source.indexOf("const handleCreateOk"),
      source.indexOf("}, [createName"),
    );
    expect(okBody).not.toContain("start(1)");
  });

  it("提交前先校验，不通过时报错并聚焦输入框（绝不静默返回）", () => {
    const source = shelf();
    expect(source).toContain("validateWorkName(createName)");
    expect(source).toContain("setCreateError(error)");
    expect(source).toContain("createInputRef.current?.focus()");
  });

  it("输入框进 error 态并把提示渲染出来", () => {
    const source = shelf();
    expect(source).toContain('status={createError ? "error" : undefined}');
    expect(source).toContain("bs-page__create-error");
  });

  it("一敲字就撤掉报错（作者已经在处理，红框不该挂着不走）", () => {
    const source = shelf();
    expect(source).toContain('setCreateError("")');
  });

  it("校验是纯函数，错误文案唯一事实源在 bookshelf-utils", () => {
    const utils = read("src/windows/NovelWindow/pages/BookshelfPage/bookshelf-utils.ts");
    expect(utils).toContain("export function validateWorkName");
    expect(utils).toContain("EMPTY_WORK_NAME_HINT");
    // 提示语是给人看的话：说清楚差什么，而不是抛字段名
    expect(utils).toContain("先给书起个名字");
  });
});

describe("过期文案修正（FR-05）", () => {
  it("设定中心左栏提示已改成实际存在的入口路径", () => {
    // UI-10 拆分：左栏（含提示）搬到了 CategoryList 子组件
    const setting = stripComments(
      read("src/shared/components/SettingCenter/components/CategoryList/index.tsx"),
    );
    // 旧文案承诺的「右键」与「⋯」在分类行上都不存在
    expect(setting).not.toContain("右键或「⋯」可重命名");
    expect(setting).toContain("重命名与删除在右侧卡片的「编辑 / 删除」按钮");
  });

  it("设定中心空态给了 CTA（空态必须给下一步动作，不只描述困境）", () => {
    // UI-10 拆分：空态 CTA 仍在父组件，打开模板库的动作搬进了状态 Hook
    const setting = read("src/shared/components/SettingCenter/index.tsx");
    const hook = read("src/shared/components/SettingCenter/hooks/useSettingCenter.ts");
    expect(setting).toContain("EMPTY_CTA_COPY.settingEmpty");
    expect(hook).toContain("setLibraryOpen(true)");
  });
});

/**
 * UI-06：L2 弱提示第二批点位。
 *
 * 这三处的共同难点是**宿主会反复挂载** —— 大纲章行在虚拟列表里滚进滚出、
 * 悬浮卡随指针进出、排序弹窗可多次打开。`GuideTooltip` 默认走异步落盘判定，
 * 每次挂载都要读一次 `novel_config`（白花 IPC），且两个宿主同时起跳会各弹
 * 一个气泡。所以统一改走窗口 store 的同步入口 `consumeGuideTooltip`。
 *
 * 守卫钉两件事：① 三处都挂上了 `id` + `consume`（缺 `consume` 会永不消失，
 * 缺 `id` 拿不到文案）；② 消费都收敛到那一个入口，不许各自拼 store 调用。
 */
describe("弱提示点位（UI-06：T-05 / T-06 / T-07）", () => {
  const HOSTS: Array<[id: string, file: string]> = [
    ["T-05", "src/windows/NovelWindow/pages/NovelPage/components/OutlinePanel/index.tsx"],
    ["T-06", "src/windows/NovelWindow/pages/NovelPage/components/HoverEntityCard/index.tsx"],
    ["T-07", "src/windows/NovelWindow/pages/NovelPage/components/ReorderConfirmModal/index.tsx"],
  ];

  it.each(HOSTS)("%s 同时给出 id 与消费回调（缺一个就会永不消失或反复弹）", (id, file) => {
    const source = stripComments(read(file));
    expect(source).toContain(
      `<GuideTooltip id="${id}" consume={() => consumeGuideTooltip("${id}")}>`,
    );
  });

  it("消费收敛到唯一入口 consumeGuideTooltip，宿主不许自己拼 getState()", () => {
    for (const [, file] of HOSTS) {
      const source = stripComments(read(file));
      // 相对路径按实际目录深度（components/<X>/index.tsx → NovelWindow/store）
      expect(source).toContain('from "../../../../store/useGuideStore"');
      expect(source).not.toContain("useGuideStore.getState()");
    }
  });

  it("入口先让位给正在播的 Tour，且让位时不记账（Tour 结束后同点位还能弹）", () => {
    const store = stripComments(read("src/windows/NovelWindow/store/useGuideStore.ts"));
    const body = store.slice(store.indexOf("export function consumeGuideTooltip"));
    expect(body).toContain("store.playingStep !== null");
    expect(body).toContain("store.consumeTooltip(id, Date.now())");
    // 让位分支必须在记账之前 return，否则气泡被 Tour 挤掉却留下「已看过」
    expect(body.indexOf("return false")).toBeLessThan(body.indexOf("return store.consumeTooltip"));
  });

  it("T-05 只挂一条章行（多行同挂会冒出多个气泡同时起跳）", () => {
    const outline = stripComments(read(HOSTS[0][1]));
    // 全文件只有一个挂载点
    expect(outline.match(/<GuideTooltip\b/g) ?? []).toHaveLength(1);
    // 锚点由行列表派生出「第一个空梗概章行」的唯一 key，再和行 key 比对
    expect(outline).toContain("const t05AnchorKey = useMemo");
    expect(outline).toContain('item.kind === "chapter" && !item.chapter.note');
    expect(outline).toContain("row.key === t05AnchorKey");
    // 默认不挂：只有被指认的那一行才进 T-05 分支
    expect(outline).toContain("anchorT05 = false");
  });

  it("T-07 的图标本身就是常驻说明入口（气泡只弹一次，图标一直看得见）", () => {
    const modal = stripComments(read(HOSTS[2][1]));
    expect(modal).toContain("nv-reorder__title-hint");
    expect(modal).toContain('aria-label="排序确认说明"');
    // 图标必须在 title 里，而不是 Modal 的 extra / footer —— 说明和标题是同一件事
    expect(modal).toContain('<span className="nv-reorder__title">');
  });

  it("文案同源：三条 TOOLTIP_STEPS 仍在 guide-copy.ts（标语不许只活在组件里）", () => {
    const copy = read("src/shared/novel/guide-copy.ts");
    for (const id of ["T-05", "T-06", "T-07"]) {
      expect(copy).toContain(`id: "${id}"`);
    }
    // 文案是给人看的话，不是字段名
    expect(copy).toContain("给这章留个梗概");
    expect(copy).toContain("高亮词能点");
  });
});
