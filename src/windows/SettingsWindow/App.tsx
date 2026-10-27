import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  BgColorsOutlined,
  BugOutlined,
  ControlOutlined,
  HistoryOutlined,
  IdcardOutlined,
  RobotOutlined,
  SafetyOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import WindowHeader from "@/shared/components/WindowHeader";
import { IS_LITE_EDITION, IS_NOVEL_EDITION } from "@/shared/edition";
import SettingsNav, { type SettingsNavGroup } from "./components/SettingsNav";
import AppearanceSection from "./components/AppearanceSection";
import ProfileSection from "./components/ProfileSection";
import AccountSection from "./components/AccountSection";
import ShortcutSection from "./components/ShortcutSection";
import DiagnosticSection from "./components/DiagnosticSection";
import AISection from "./components/AISection";
import AILogSection from "./components/AILogSection";

/**
 * SettingsWindow —— 全局设置窗口（全版本开放入口）。
 *
 * 骨架（1.48.0 改版）：**左分类导航 + 右内容页**，不再是「一列分区从头滚到尾」。
 * 窗口固定 900×680（见 `electron/main.ts` 的 `createSettingsWindow`），
 * 因此布局的职责划分是：导航定宽永不滚走、页面标题固定、只有页面内容各自滚动。
 *
 * 为什么页面**全部挂载、只隐藏非当前页**（而非按需挂载）：
 * AI 配置页有草稿态（改了一半的地址 / 模型 / Key，点「保存」才落库）。
 * 若切页即卸载，用户「切去看看主题色再回来」就会静默丢掉刚填的内容。
 * 隐藏用 `display: none`（见 index.scss 的 `.settings-page.is-hidden`），
 * 既保留状态，又不让隐藏页参与布局与无障碍树。
 *
 * 各页职责：
 * - components/AppearanceSection  外观（主题色）
 * - components/AISection          AI 配置（**仅 full/novel 版**，见下方门控）
 * - components/AILogSection       AI 调用记录（同上；只读，用来调 prompt）
 * - components/ProfileSection     个人资料（邮箱编辑，原 BaseWindow UserPage 迁移）
 * - components/AccountSection     账号（邮箱展示 / 退出登录）
 * - components/ShortcutSection    快捷键（**仅开发版与小说版**，见下方门控）
 * - components/DiagnosticSection  诊断（本地日志级别 / 打开日志目录）
 * - hooks/useProfileForm          表单逻辑
 * - hooks/useAccountSession       会话展示与退出动作
 * - hooks/useAiConfig             AI 配置的读 / 存 / 测
 *
 * AI 分区的门控规则（R-AI-01）：只有 **full / novel 版** 才展示 —— 与主进程
 * `ai.db` 的 edition 开关（`EDITION !== "lite"`）对齐，lite 版既无 ai.db 存储、
 * 也无 novel 侧的 AI 入口，展示空分区会让用户「看得见但用不了」。
 *
 * 快捷键分区的门控规则（1.47.0，需求明确）：只有 **dev 构建** 或 **novel 版**
 * 才展示。full / lite 正式版里小说窗口是主窗的一个子窗口，快捷键属专家配置，
 * 不该在通用设置里占主位；主进程侧的应用级快捷键注册用同一套判定
 * （`electron/handlers/shortcut-handlers.ts` 的 `SHORTCUTS_ENABLED`）。
 */
const SHOW_SHORTCUTS = import.meta.env.DEV || IS_NOVEL_EDITION;
/** AI 分区：仅 full/novel 版（与 ai.db 的 `EDITION !== "lite"` 开关对齐） */
const SHOW_AI = !IS_LITE_EDITION;

/** 导航分组顺序：通用 → 账户 → 高级（3 / 2 / 1，避免出现只有一个条目的孤组） */
const GROUP_ORDER = ["通用", "账户", "高级"] as const;
type GroupTitle = (typeof GROUP_ORDER)[number];

interface SettingsPageDef {
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

/** AI 页（lite 版整组缺席，与 ai.db 的 edition 开关对齐） */
const AI_PAGES: SettingsPageDef[] = SHOW_AI
  ? [
      {
        id: "ai",
        label: "AI 配置",
        title: "AI 配置",
        description: "写作辅助调用的模型服务。密钥仅保存在本机，请求直连所选服务商。",
        icon: <RobotOutlined />,
        group: "通用",
        render: () => <AISection />,
      },
      {
        // 记录与配置拆成两页：配置是「设一次」的动作，记录是「反复回看」的动作，
        // 混在一页会让长列表把保存按钮淹掉（见 AILogSection 的注释）
        id: "ai-log",
        label: "AI 记录",
        title: "AI 调用记录",
        description: "每次起名 / 润色的提示词与输出回看，用来对比调优。记录只存本机。",
        icon: <HistoryOutlined />,
        group: "通用",
        render: () => <AILogSection />,
      },
    ]
  : [];

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

/** 页面清单（顺序 = 导航顺序；条件页按 edition 门控插入） */
const PAGES: SettingsPageDef[] = [
  APPEARANCE_PAGE,
  ...AI_PAGES,
  ...SHORTCUT_PAGES,
  PROFILE_PAGE,
  ACCOUNT_PAGE,
  DIAGNOSTIC_PAGE,
];

/** 按 GROUP_ORDER 收拢导航分组（空组自动消失，lite 版不会留下「通用」空壳） */
const NAV_GROUPS: SettingsNavGroup[] = GROUP_ORDER.map((title) => ({
  title,
  items: PAGES.filter((page) => page.group === title).map((page) => ({
    id: page.id,
    label: page.label,
    icon: page.icon,
  })),
})).filter((group) => group.items.length > 0);

export default function SettingsWindowApp() {
  const [activeId, setActiveId] = useState(PAGES[0].id);
  const active = PAGES.find((page) => page.id === activeId) ?? PAGES[0];

  /**
   * 跨窗口跳页：其它窗口发 `settings-section-jump`（起名面板的「去设置」用它）。
   *
   * 只接受 `PAGES` 里真实存在的 id —— lite 版没有 AI 页，一条指向 `ai` 的消息
   * 落下来会变成一个空白内容区，所以无效 id 一律忽略（保持当前页）。
   * preload 的 `windowAPI.on` 会在挂载时补投一次待投递消息，因此窗口刚被拉起
   * 也不会丢掉这条跳转。
   */
  useEffect(() => {
    const api = window.electronAPI?.windowAPI;
    if (!api) return;
    const handler = (...args: unknown[]) => {
      const payload = args[0] as { section?: unknown } | undefined;
      const section = typeof payload?.section === "string" ? payload.section : "";
      if (!section) return;
      if (!PAGES.some((page) => page.id === section)) return;
      setActiveId(section);
    };
    api.on("settings-section-jump", handler);
    return () => api.off("settings-section-jump", handler);
  }, []);

  return (
    <div className="window-shell">
      <WindowHeader title="设置" icon={<SettingOutlined />} maximizable={false} />
      <div className="window-shell__body">
        <div className="settings-layout">
          <SettingsNav groups={NAV_GROUPS} activeId={active.id} onSelect={setActiveId} />

          <div className="settings-content">
            <div className="settings-page__head">
              <h1 className="settings-page__title">{active.title}</h1>
              <p className="settings-page__desc">{active.description}</p>
            </div>

            {PAGES.map((page) => (
              <div
                key={page.id}
                className={`settings-page${page.id === active.id ? "" : " is-hidden"}`}
                role="region"
                aria-label={page.title}
              >
                {/* 内容栈：卡片与底部操作条都摊在这一层，操作条靠 margin-top:auto
                    贴底，切页时位置恒定（详见 index.scss 的 .settings-page__stack） */}
                <div className="settings-page__stack">{page.render()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
