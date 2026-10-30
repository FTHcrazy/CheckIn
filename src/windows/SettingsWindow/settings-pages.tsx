/**
 * 设置窗口的页面清单（唯一事实源）：导航项与内容区都由这里派生。
 *
 * 为什么单列一个文件（2.12.0）：
 * 1. 清单要随「AI 总开关」在运行期变化（REQ-063），必须是**函数**而不是模块级
 *    常量，且不能落在组件文件里 —— 组件文件额外导出非组件值会破坏 Fast Refresh
 *    （ESLint `react-refresh/only-export-components` 也是这么判的）；
 * 2. `settings-ai-nav-guard.test.ts` 直接调 `buildPages()` 断言「关掉 AI 后还剩
 *    哪些页」，比起对着 App.tsx 做源码 grep，纯函数才挡得住「清了导航却还在渲染」
 *    这类半改。
 *
 * 本文件只有数据与纯函数，没有 React 状态；`render` 里挂的是各分区的组件。
 */
import type { ReactNode } from "react";
import {
  BgColorsOutlined,
  BugOutlined,
  ControlOutlined,
  HistoryOutlined,
  IdcardOutlined,
  RobotOutlined,
  SafetyOutlined,
} from "@ant-design/icons";
import { IS_LITE_EDITION, IS_NOVEL_EDITION } from "@/shared/edition";
import type { SettingsNavGroup } from "./components/SettingsNav";
import AppearanceSection from "./components/AppearanceSection";
import ProfileSection from "./components/ProfileSection";
import AccountSection from "./components/AccountSection";
import ShortcutSection from "./components/ShortcutSection";
import DiagnosticSection from "./components/DiagnosticSection";
import AISection from "./components/AISection";
import AILogSection from "./components/AILogSection";
import UsagePanel from "./components/UsagePanel";

/**
 * 快捷键页的门控（1.47.0）：只有 **dev 构建** 或 **novel 版** 才展示。
 *
 * full / lite 正式版里小说窗口是主窗的一个子窗口，快捷键属专家配置，不该在
 * 通用设置里占主位；主进程侧的应用级快捷键注册用同一套判定
 * （`electron/handlers/shortcut-handlers.ts` 的 `SHORTCUTS_ENABLED`）。
 */
const SHOW_SHORTCUTS = import.meta.env.DEV || IS_NOVEL_EDITION;

/** AI 分区：仅 full/novel 版（与 ai.db 的 `EDITION !== "lite"` 开关对齐） */
const SHOW_AI = !IS_LITE_EDITION;

/** 导航分组顺序：通用 → 账户 → 高级（3 / 2 / 1，避免出现只有一个条目的孤组） */
const GROUP_ORDER = ["通用", "账户", "高级"] as const;
type GroupTitle = (typeof GROUP_ORDER)[number];

export interface SettingsPageDef {
  id: string;
  /** 左栏导航文案 */
  label: string;
  /** 内容区标题（比导航文案更完整，可带单位/范围等补充） */
  title: string;
  /** 内容区标题下的一句话说明：这一页在管什么，为什么需要它 */
  description: string;
  icon: ReactNode;
  group: GroupTitle;
  render: () => ReactNode;
}

const APPEARANCE_PAGE: SettingsPageDef = {
  id: "appearance",
  label: "外观",
  title: "外观",
  description: "主题色切换，所有窗口实时同步。",
  icon: <BgColorsOutlined />,
  group: "通用",
  render: () => <AppearanceSection />,
};

/**
 * AI 配置页（lite 版整组缺席，与 ai.db 的 edition 开关对齐）。
 *
 * ⚠️ 这一页**永远不因 AI 总开关关闭而消失**（REQ-063）：开关就在这页上，
 * 收掉它等于把「开回去」的唯一入口也一起收了 —— 用户关掉 AI 之后再也开不回来。
 * 关闭后保留的还有下方的模型服务 / 连接方式 / 接口地址卡片（先配好再开是正常顺序）。
 */
const AI_CONFIG_PAGE: SettingsPageDef = {
  id: "ai",
  label: "AI 配置",
  title: "AI 配置",
  description: "写作辅助调用的模型服务。密钥仅保存在本机，请求直连所选服务商。",
  icon: <RobotOutlined />,
  group: "通用",
  render: () => <AISection />,
};

/**
 * AI 记录 / 用量两页只在 AI **开着**时才存在（REQ-063）。
 *
 * 与 AI 配置页的区别是「读的东西」：这两页是纯只读视图（`ai_log` / `ai_event`
 * 的展示），关掉 AI 之后既不会再有新记录，也不该再向用户呈现「你的 AI 用了多少」。
 * 因此它们可以随开关**卸载**：没有草稿态、没有可丢的填写内容。
 * AI 配置页不行 —— 它有草稿态，卸载会静默丢掉改了一半的地址 / 模型 / Key
 * （见 App.tsx 文件头的「所有页全挂载」说明）。
 */
const AI_LOG_PAGE: SettingsPageDef = {
  // 记录与配置拆成两页：配置是「设一次」的动作，记录是「反复回看」的动作，
  // 混在一页会让长列表把保存按钮淹掉（见 AILogSection 的注释）
  id: "ai-log",
  label: "AI 记录",
  title: "AI 调用记录",
  description: "每次起名 / 润色的提示词与输出回看，用来对比调优。记录只存本机。",
  icon: <HistoryOutlined />,
  group: "通用",
  render: () => <AILogSection />,
};

const AI_USAGE_PAGE: SettingsPageDef = {
  // 用量看板（M1b）：与「记录」再拆一页——记录看单次、看板看趋势，
  // 聚合指标与诊断导出是「偶尔看一眼 + 有问题才导」的动作，不混进调用列表
  id: "ai-usage",
  label: "用量与效果",
  title: "用量与效果",
  description: "AI 帮你处理了多少次、采纳了多少，以及一键导出诊断包回传。",
  icon: <RobotOutlined />,
  group: "通用",
  render: () => <UsagePanel />,
};

/**
 * 快捷键页（门控见 `SHOW_SHORTCUTS`）。
 *
 * 保持「条件数组」形态（而不是像 AI 三页那样拆成单页常量）：快捷键页的
 * 存在与否只由 edition 决定，永久不变；`shortcut-guard.test.ts` 也钉着
 * 「`SHOW_SHORTCUTS` 门控 + 全文件只有一处渲染快捷键分区」这条形态。
 * AI 那三页拆开，是因为它们**现在有两种门控**（配置页看 edition，
 * 记录/用量还看总开关），一个数组再也表达不了。
 */
const SHORTCUT_PAGES: SettingsPageDef[] = SHOW_SHORTCUTS
  ? [
      {
        id: "shortcuts",
        label: "快捷键",
        title: "快捷键",
        description: "点击键位后按下新组合即可修改，改动即时生效。",
        icon: <ControlOutlined />,
        group: "通用",
        render: () => <ShortcutSection />,
      },
    ]
  : [];

const PROFILE_PAGE: SettingsPageDef = {
  id: "profile",
  label: "个人资料",
  title: "个人资料",
  description: "登录邮箱决定本机数据目录，用于隔离不同账户。",
  icon: <IdcardOutlined />,
  group: "账户",
  render: () => <ProfileSection />,
};

const ACCOUNT_PAGE: SettingsPageDef = {
  id: "account",
  label: "账号",
  title: "账号",
  description: "当前登录状态与账号操作。",
  icon: <SafetyOutlined />,
  group: "账户",
  render: () => <AccountSection />,
};

const DIAGNOSTIC_PAGE: SettingsPageDef = {
  id: "diagnostic",
  label: "诊断",
  title: "诊断",
  description: "本地日志（含 IPC 通信与 AI 调用记录），排查问题时用来留证据。",
  icon: <BugOutlined />,
  group: "高级",
  render: () => <DiagnosticSection />,
};

/**
 * 页面清单（顺序 = 导航顺序）。
 *
 * ⚠️ 必须是函数而不是模块级常量（REQ-063）：AI 记录 / 用量两页是否存在取决于
 * AI 总开关，而总开关是运行期状态。写成模块级常量就只能靠可变变量（模块级
 * `let` 会在窗口存活期间被反复改写，谁最后渲染谁说了算，排查时完全看不出当前值
 * 从哪来），也与 React 的「渲染是输入的纯函数」相悖。
 */
export function buildPages(aiHidden: boolean): SettingsPageDef[] {
  return [
    APPEARANCE_PAGE,
    // AI 配置页只受 edition 门控，不受总开关影响（开关本身在这一页上）
    ...(SHOW_AI ? [AI_CONFIG_PAGE] : []),
    // 记录与用量只受**总开关**影响：关了就没有「AI 用得怎么样」可看
    ...(SHOW_AI && !aiHidden ? [AI_LOG_PAGE, AI_USAGE_PAGE] : []),
    // 快捷键页的门控在它自己的定义处（条件数组），这里原样展开
    ...SHORTCUT_PAGES,
    PROFILE_PAGE,
    ACCOUNT_PAGE,
    DIAGNOSTIC_PAGE,
  ];
}

/** 按 GROUP_ORDER 收拢导航分组（空组自动消失，lite 版不会留下「通用」空壳） */
export function buildNavGroups(pages: SettingsPageDef[]): SettingsNavGroup[] {
  return GROUP_ORDER.map((title) => ({
    title,
    items: pages
      .filter((page) => page.group === title)
      .map((page) => ({ id: page.id, label: page.label, icon: page.icon })),
  })).filter((group) => group.items.length > 0);
}

/**
 * 本版本可能出现的全部页面 id（**不含**总开关的影响）。
 *
 * 只用于「跨窗口跳页」的合法性校验：跳页消息可能在配置读回来之前就到，
 * 若拿当前可见清单去校验，一条「去 AI 用量页」的跳转会因「那一刻还不知道
 * AI 开着」而被静默丢弃。真正不可见的页由 App 里的兜底 effect 收口。
 */
export const KNOWN_PAGE_IDS: ReadonlySet<string> = new Set(
  buildPages(false).map((page) => page.id),
);

/** AI 总开关关闭时，导航回退到哪一页（AI 配置页，lite 版没有则回第一页） */
export const AI_FALLBACK_PAGE_ID = "ai";
