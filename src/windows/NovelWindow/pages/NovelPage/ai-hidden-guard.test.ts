/**
 * REQ-063 守卫：AI 总开关关闭后，作品窗口里的 AI 功能点**一个都不剩**。
 *
 * 用户原话是「收束所有 AI 的功能点，当该开关关闭后，所有的 AI 功能都不展示
 * （按钮，提示等都不展示）」。落成代码是两件事，缺一即回到老行为：
 * 1. 判据是 `aiAvailability.hidden`（总开关关 / 没有 AI 通道），**不是**
 *    `available` —— 后者在「开关开着只是没配全」时也是 false，那时入口必须留着
 *    （禁用 + 说明），否则用户不知道该去补配置；
 * 2. 入口是**不渲染**，不是「禁用 / display:none / 变灰」。灰按钮仍然是一句
 *    「这里本来有 AI」的提示，正是本次要收掉的东西。
 *
 * 为什么钉源码而不是渲染：这些入口散在页面层与六个子组件里，逐一挂真页面
 * 渲染要拖进 CodeMirror / 虚拟化列表 / dnd-kit；而这里要防的回归是「哪天有人
 * 把 `{aiVisible ? … : null}` 改回 `disabled`」，源码断言最直接。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string): string =>
  readFileSync(path.resolve(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");

/** 注释里常引用被删掉的老写法，反向断言前先剥掉（否则必然假红） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const NOVEL_PAGE = stripComments(read("src/windows/NovelWindow/pages/NovelPage/NovelPage.tsx"));
const USE_NOVEL_PAGE = stripComments(
  read("src/windows/NovelWindow/pages/NovelPage/hooks/useNovelPage.ts"),
);
const CTX_MENU = stripComments(
  read("src/windows/NovelWindow/pages/NovelPage/components/EntityContextMenu/index.tsx"),
);
const CHAPTER_TREE = stripComments(
  read("src/windows/NovelWindow/pages/NovelPage/components/ChapterTree/index.tsx"),
);
const CHAPTER_ITEM = stripComments(
  read("src/windows/NovelWindow/pages/NovelPage/components/ChapterTreeItem/index.tsx"),
);
const NAME_PANEL = stripComments(
  read("src/windows/NovelWindow/pages/NovelPage/components/NameGeneratorPanel/index.tsx"),
);
const NAME_PANEL_SCSS = read(
  "src/windows/NovelWindow/pages/NovelPage/components/NameGeneratorPanel/index.scss",
);
const WORK_MENU = stripComments(
  read("src/windows/NovelWindow/pages/NovelPage/components/WorkManageMenu/index.tsx"),
);
const TOP_BAR = stripComments(
  read("src/windows/NovelWindow/pages/NovelPage/components/NovelTopBar/index.tsx"),
);

describe("调用口径：hidden 由 hook 推导，页面层只消费", () => {
  it("页面层从 aiAvailability 派生一个 aiVisible 再往下传（不在各处写 reason 判断）", () => {
    expect(NOVEL_PAGE).toContain("const aiVisible = !aiAvailability.hidden;");
  });

  it("续写悬浮按钮受 hidden 门控（不是 available）", () => {
    // 三种「没有前文」的情形并列：AI 关掉 / 阅读模式 / 还没有章节
    expect(NOVEL_PAGE).toMatch(/\{!aiAvailability\.hidden &&/);
    expect(NOVEL_PAGE).toContain("<ContinueFab");
    // 反向：不能用 available 决定「出不出现」——它挡不住「开着但没配全」
    expect(NOVEL_PAGE).not.toMatch(/\{aiAvailability\.available &&[\s\S]{0,80}<ContinueFab/);
  });

  it("摘要入口的『AI 不可用』toast 保留（入口已不可达，属纵深防御）", () => {
    expect(USE_NOVEL_PAGE).toContain("aiAvailability.reasonText");
    expect(USE_NOVEL_PAGE).toContain("AI 功能当前不可用");
  });
});

describe("右键菜单：文本变换整块不渲染（REQ-063）", () => {
  it("「文本变换」标签 + 润色 + 五个变换全在 `aiVisible` 条件里", () => {
    // 整块由 {aiVisible ? (<>…</>) : null} 包住：标签、润色、变换都在同一分支内
    expect(CTX_MENU).toMatch(
      /\{aiVisible \? \(\s*<>[\s\S]*?文本变换[\s\S]*?润色这段文字[\s\S]*?TRANSFORM_KINDS\.map[\s\S]*?<\/>\s*\) : null\}/,
    );
  });

  it("仍然保留给「开着但没配全」的禁用语义（aiAvailable 没被 aiVisible 取代）", () => {
    expect(CTX_MENU).toContain("aiAvailable");
    expect(CTX_MENU).toMatch(/disabled=\{!aiAvailable\}/);
  });

  it("反向断言：不是只改 disabled，也不是用 CSS 藏起来", () => {
    // 只把按钮禁用 = 用户仍然看见「润色这段文字」，等于没有收束
    expect(CTX_MENU).not.toContain("disabled={!aiVisible}");
    expect(CTX_MENU).not.toContain("display: aiVisible");
    expect(CTX_MENU).not.toContain('visibility: "hidden"');
    // 菜单里剩下的两块必须还在（AI 关掉后菜单不能变成空壳）
    expect(CTX_MENU).toContain("记入行囊");
    expect(CTX_MENU).toContain("新建资料卡");
  });

  it("菜单落位依赖里带上 aiVisible：整块消失后菜单矮一截，坐标要重算", () => {
    expect(CTX_MENU).toMatch(/\}, \[x, y, aiVisible\]\);/);
  });
});

describe("章节树行内闪电（AI 摘要）受 showSummary 控制", () => {
  it("行组件按 showSummary 决定渲染，默认 true 不改变既有行为", () => {
    expect(CHAPTER_ITEM).toContain("showSummary = true");
    expect(CHAPTER_ITEM).toMatch(/\{showSummary \? \(/);
    // 反向：不是给按钮加 disabled
    expect(CHAPTER_ITEM).not.toContain("disabled={!showSummary}");
  });

  it("列表容器透传同名 prop", () => {
    expect(CHAPTER_TREE).toContain("showSummary?: boolean;");
    expect(CHAPTER_TREE).toContain("showSummary = true");
    expect(CHAPTER_TREE).toContain("showSummary={showSummary}");
    expect(NOVEL_PAGE).toContain("showSummary={aiVisible}");
  });
});

describe("起名面板：AI 起名按钮不渲染，本地引擎照常", () => {
  it("AI 起名按钮与描述输入框受 aiVisible 控制", () => {
    expect(NAME_PANEL).toContain("aiVisible = true");
    // 按钮：{aiVisible ? (<Button …>AI 起名</Button>) : null}
    expect(NAME_PANEL).toMatch(/\{aiVisible \? \(\s*<Button[\s\S]*?AI 起名/);
    // 描述框只服务 AI 起名，一并收掉（留着就是「填了也不生效」）
    expect(NAME_PANEL).toMatch(/\{aiVisible \? \(\s*<Input\.TextArea/);
  });

  it("降级提示（含「去设置」）也一起收：它本身就是 AI 的提示", () => {
    expect(NAME_PANEL).toMatch(/\{aiVisible && fallbackNote \? \(/);
  });

  it("「换一批（本地）」必须还在，且不受 aiVisible 影响", () => {
    expect(NAME_PANEL).toContain("换一批（本地）");
    // 本地按钮那一颗 `<Button …>…</Button>` 里不许出现 AI 的条件
    const start = NAME_PANEL.indexOf('<Button className="nv-name__regen"');
    expect(start, "本地起名按钮不见了").toBeGreaterThan(-1);
    const end = NAME_PANEL.indexOf("</Button>", start);
    const regenBlock = NAME_PANEL.slice(start, end + "</Button>".length);
    expect(regenBlock).toContain("handleNextBatch");
    // 反向：换一批不能继承 AI 的可用性（否则「AI 关了连本地名字都起不出来」）
    expect(regenBlock).not.toContain("aiVisible");
    expect(regenBlock).not.toContain("aiAvailable");
    expect(NAME_PANEL).toContain("handleNextBatch");
    // 样式仍在（按钮造型没有被顺手删掉）
    expect(NAME_PANEL_SCSS).toContain("&__regen");
  });

  it("面板把 aiVisible 从 SupportPanel 透传下来", () => {
    const SUPPORT = stripComments(
      read("src/windows/NovelWindow/pages/NovelPage/components/SupportPanel/index.tsx"),
    );
    expect(SUPPORT).toContain("aiVisible?: boolean;");
    expect(SUPPORT).toContain("aiVisible={aiVisible}");
    expect(NOVEL_PAGE).toContain("aiVisible={aiVisible}");
  });
});

describe("作品管理菜单：题材提示不再提 AI（提示也要收）", () => {
  it("两处 hint 都按 aiVisible 切换成中性说法", () => {
    expect(WORK_MENU).toContain("aiVisible = true");
    // 建书弹框
    expect(WORK_MENU).toMatch(/aiVisible\s*\?\s*"题材用于 AI 起名与润色的风格参考，跳过不影响写作"/);
    expect(WORK_MENU).toContain('"题材用于统一用字风格，跳过不影响写作"');
    // 题材弹框
    expect(WORK_MENU).toMatch(/aiVisible\s*\?\s*"AI 起名与润色会参考题材调整用字风格；留空保存即清除题材"/);
    expect(WORK_MENU).toContain('"用字风格会参考题材；留空保存即清除题材"');
  });

  it("顶栏把口径透传给菜单（顶栏自己没有 AI 按钮）", () => {
    expect(TOP_BAR).toContain("aiVisible?: boolean;");
    expect(TOP_BAR).toContain("aiVisible={aiVisible}");
    expect(NOVEL_PAGE).toContain("aiVisible={aiVisible}");
  });
});

describe("书架「新建作品」的题材提示（同一类提示，同样要收）", () => {
  const SHELF = stripComments(
    read("src/windows/NovelWindow/pages/BookshelfPage/BookshelfPage.tsx"),
  );

  it("用与编辑器同源的 hidden 口径，换成不提 AI 的说法", () => {
    expect(SHELF).toContain("useAiAvailability()");
    expect(SHELF).toMatch(/aiHidden\s*\?\s*"题材只作统一用字风格的参考/);
    // 正向：开着 AI 时的原话仍在（不能顺手把功能说明删了）
    expect(SHELF).toContain("题材只作 AI 起名、润色的风格参考");
  });
});
