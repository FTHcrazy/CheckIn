/**
 * 新手引导文案常量（唯一事实源）
 *
 * 为什么放在 shared/novel 而不是各页面内：Tour（书架页 + 编辑器页）、弱提示
 * （编辑器 / 设定中心 / 行囊窗口）、帮助中心（NovelWindow + PackWindow 两个窗口）
 * 三处都消费同一份文案。散在各自组件里，改一句要同步三处，必然漂移——
 * PRD 附录 B 把「文案常量单文件」列为阻塞依赖，就是这个原因。
 *
 * 本文件不含 React、不含副作用，纯数据，两个窗口与两个页面可共用。
 * 文案原文取自 `docs/novel-onboarding-prd.md` §7.2 / §7.3，改文案必须两处同步。
 */

/** Tour 步骤目标锚点：挂在真实 DOM 上的 `data-tour-target` 值 */
export const TOUR_TARGETS = {
  /** 书架顶栏「新建作品」 */
  shelfNewWork: "shelf-new-work",
  /** 左栏底部「新章节」 */
  treeNewChapter: "tree-new-chapter",
  /** 左栏底部「新卷」 */
  treeNewVolume: "tree-new-volume",
  /** 顶栏设定中心 */
  topbarSetting: "topbar-setting",
  /** 顶栏行囊 */
  topbarPack: "topbar-pack",
  /** 编辑器正文滚动区（有正文时的目标） */
  editorBody: "editor-body",
  /** 编辑器空态「写下第一章」 */
  editorFirstChapter: "editor-first-chapter",
  /** 状态条「标注」开关 */
  statusAnnotation: "status-annotation",
  /** 设定中心「模板库」按钮（弱提示 T-02 锚点） */
  settingLibrary: "setting-library",
  /** 行囊头部「模块管理」（弱提示 T-04 锚点） */
  packModules: "pack-modules",
} as const;

export type TourTargetKey = keyof typeof TOUR_TARGETS;

/** 视图归属：书架页与编辑器页是 display 切换的两个兄弟容器，Tour 必须按视图拆分 */
export type GuideView = "shelf" | "editor";

/** Tour 步骤文案（PRD §7.2 原文，不得改写） */
export interface TourStepCopy {
  /** 步骤序号 1-5，即 guideState 里的 currentStep */
  step: number;
  /** 所属视图：决定这一步由哪个 Tour 实例播放 */
  view: GuideView;
  /** 主锚点 */
  target: string;
  /** 主锚点不可见时的备选锚点，按顺序探测 */
  fallbacks: string[];
  title: string;
  description: string;
  /** 卡片相对目标的方位，缺省由 antd 自动判断 */
  placement:
    | "bottom"
    | "bottomLeft"
    | "bottomRight"
    | "top"
    | "topLeft"
    | "topRight"
    | "left"
    | "right";
}

/**
 * 总步数。强制引导（无关闭叉 / 无 Esc）只覆盖第 1-4 步——
 * 第 4 步行囊讲解完即「强制引导结束」（2026-10-14 用户反馈）；
 * 第 5 步「选中文字，右键有惊喜」保留为普通可关闭步骤：
 * 它讲的是一个要先选中文字的交互，硬按着头看效果差，
 * 作者看过前四步已具备基本认知，这一步给个叉随时能撤。
 */
export const GUIDE_TOTAL_STEPS = 5;

/** 步骤 → 视图（store 的 start 靠它判断「当前播放步属不属于调用方视图」） */
export function viewOfStep(step: number): GuideView | null {
  return TOUR_STEPS.find((item) => item.step === step)?.view ?? null;
}

export const TOUR_STEPS: readonly TourStepCopy[] = [
  {
    step: 1,
    view: "shelf",
    target: TOUR_TARGETS.shelfNewWork,
    fallbacks: [],
    title: "新建你的第一本书",
    description: "点这里给书起个名字，起好就能开写。书名随时能改，第一本不用纠结。",
    placement: "bottomRight",
  },
  {
    step: 2,
    view: "editor",
    target: TOUR_TARGETS.treeNewChapter,
    fallbacks: [TOUR_TARGETS.treeNewVolume],
    title: "建一卷、一章，开始写",
    description:
      "点一下就建好，默认叫「未命名」，双击名字就能改。不用先想好结构，随时能拖动调整顺序。",
    placement: "right",
  },
  {
    step: 3,
    view: "editor",
    target: TOUR_TARGETS.topbarSetting,
    fallbacks: [],
    title: "先把全书的总设定立起来",
    description:
      "境界、等级、品阶这类全书通用的体系都在这里。第一次可以从「模板库」一键套用（如「修仙 · 经典九层」），灌完随便改。",
    placement: "bottomLeft",
  },
  {
    step: 4,
    view: "editor",
    target: TOUR_TARGETS.topbarPack,
    fallbacks: [],
    title: "行囊：主角的状态面板",
    description:
      "境界、属性、装备、物品、技能都在这里记。写正文时随时 Ctrl+Shift+B 呼出；关窗前有未保存改动会先问你一次。",
    placement: "bottomLeft",
  },
  {
    step: 5,
    view: "editor",
    target: TOUR_TARGETS.editorBody,
    fallbacks: [TOUR_TARGETS.editorFirstChapter, TOUR_TARGETS.statusAnnotation],
    title: "选中文字，右键有惊喜",
    description:
      "选中一段文字再右键：记进行囊、一键建成角色 / 地点 / 势力 / 物品资料卡，或绑定到已有卡片。注意：没选中文字时右键是系统菜单。",
    placement: "bottom",
  },
] as const;

/** 弱提示点位编号（PRD §7.3） */
export type TooltipId =
  | "T-02"
  | "T-03"
  | "T-04"
  | "T-05"
  | "T-06"
  | "T-07";

export interface TooltipCopy {
  id: TooltipId;
  /** 挂载目标的 data-tour-target 值；为空表示由调用方自行决定锚点 */
  target: string;
  title: string;
  description: string;
  placement:
    | "top"
    | "bottom"
    | "left"
    | "right"
    | "bottomLeft"
    | "bottomRight"
    | "topLeft"
    | "topRight";
}

export const TOOLTIP_STEPS: readonly TooltipCopy[] = [
  {
    id: "T-02",
    target: TOUR_TARGETS.settingLibrary,
    title: "第一次用？",
    description: "模板库里有现成的体系，一键套用",
    placement: "bottom",
  },
  {
    id: "T-03",
    // 没有静态 target：锚点是运行时算出来的选区坐标（见 SelectionGuide）
    target: "",
    title: "选中了，右键试试",
    description:
      "右键可以把选中的名字建成资料卡（角色 / 地点 / 势力 / 物品），或记进行囊",
    placement: "bottomLeft",
  },
  {
    id: "T-04",
    target: TOUR_TARGETS.packModules,
    title: "模块不止这三个",
    description: "默认只开了 3 块，其他模块在这里按需开启",
    placement: "bottom",
  },
  {
    id: "T-05",
    target: "",
    title: "给这章留个梗概",
    description: "给这章写一句话梗概，后面好回忆",
    placement: "bottom",
  },
  {
    id: "T-06",
    target: "",
    title: "高亮词能点",
    description: "点高亮词可打开资料卡；底部状态条可关闭标注",
    placement: "top",
  },
  {
    id: "T-07",
    target: "",
    title: "排序确认",
    description: "这个确认是防误触排序的，可在「排版与偏好」里关掉",
    placement: "top",
  },
] as const;

/**
 * T-03 触发的最小选区长度（字符数）。
 * 单个字符多半是拖动时的误选，为它弹提示属于打扰；人名 / 地名至少两个字。
 */
export const GUIDE_MIN_SELECTION_LENGTH = 2;

/** 空态引导卡 CTA（PRD §7.3 E-01~E-04，本期只补 E-02） */
export const EMPTY_CTA_COPY = {
  /** E-02 设定中心空态 */
  settingEmpty: "套用内置预设",
} as const;

/** 帮助中心文案 */
export const HELP_COPY = {
  title: "帮助中心",
  replay: "重看新手引导",
  replayDone: "新手引导已完成",
  replayHint: "共 5 步，每步点「下一步」就行，看完后这个红点会消失",
  searchPlaceholder: "搜索功能、按钮或问题（如「右键」「设定」「行囊」）",
  searchEmpty: "没找到相关内容，换个关键词试试",
  badgeTip: "帮助中心（F1）",
  closeTip: "关闭帮助中心",
} as const;
