/**
 * 快捷键集中注册表（1.47.0）
 *
 * 为什么放在 `src/shared/`：NovelWindow 与 SettingsWindow 都要读它，而窗口
 * 之间禁止互相 import（AGENTS 窗口边界规则）。这里只有纯数据与类型，不碰
 * DOM、不碰 IPC，两个窗口各自按需消费。
 *
 * 约定：
 * - 键位用 `Mod+Shift+B` 这种**平台中立**写法：`Mod` = Windows/Linux 的 Ctrl、
 *   macOS 的 Cmd。存进配置的永远是这一份，展示时才按平台转成 Ctrl / ⌘。
 * - `editable: false` 用于协议键（Esc 按优先级关浮层），用户改掉会让浮层关不掉。
 * - `globalEligible` 只给「唤起窗口」这类动作：把 Ctrl+S 注册成系统级快捷键
 *   会劫持所有应用，属于设计事故，不开放。
 */
export type ShortcutGroup = "writing" | "navigation" | "panel" | "window";

export interface ShortcutDef {
  /** 稳定 id：配置文件与广播都以它为准，改文案不改 id */
  id: string;
  label: string;
  /** 一句话说明「按下会发生什么」，列表里作为副标题 */
  description: string;
  group: ShortcutGroup;
  /** 默认键位（平台中立写法） */
  defaultKeys: string;
  /** 是否允许用户修改 */
  editable: boolean;
  /** 是否允许设为「应用级」（应用在后台 / 无焦点时也生效） */
  globalEligible?: boolean;
}

export const SHORTCUT_GROUPS: Record<ShortcutGroup, string> = {
  writing: "写作",
  navigation: "导航与视图",
  panel: "面板",
  window: "窗口",
};

export const SHORTCUTS: readonly ShortcutDef[] = [
  {
    id: "save",
    label: "保存当前章",
    description: "立即落盘，不等自动保存的防抖",
    group: "writing",
    defaultKeys: "Mod+S",
    editable: true,
  },
  {
    id: "newChapter",
    label: "新建章节",
    description: "在当前卷末尾追加一章并进入编辑",
    group: "writing",
    defaultKeys: "Mod+Enter",
    editable: true,
  },
  {
    id: "jump",
    label: "章节快速跳转",
    description: "打开跳章面板，输入章节号直达",
    group: "navigation",
    defaultKeys: "Mod+P",
    editable: true,
  },
  {
    id: "toggleFocus",
    label: "专注模式",
    description: "隐藏左右两栏，只留正文",
    group: "navigation",
    defaultKeys: "F11",
    editable: true,
  },
  {
    id: "escape",
    label: "关闭最上层浮层",
    description: "按优先级依次关闭设定中心 / 排版 / 快照 / 专注模式",
    group: "navigation",
    defaultKeys: "Escape",
    editable: false,
  },
  {
    id: "togglePack",
    label: "打开行囊",
    description: "唤出行囊独立窗口（角色卡 / 物品 / 关系）",
    group: "panel",
    defaultKeys: "Mod+Shift+B",
    editable: true,
  },
  {
    id: "openSettings",
    label: "打开设定中心",
    description: "境界 / 功法 / 稀有度等序列的管理入口",
    group: "panel",
    defaultKeys: "Mod+Shift+S",
    editable: true,
  },
  {
    id: "help",
    label: "帮助中心",
    description: "打开快捷键与使用说明",
    group: "panel",
    defaultKeys: "F1",
    editable: true,
  },
  {
    id: "showNovelWindow",
    label: "唤出小说窗口",
    description: "应用在后台时也生效；窗口已打开则聚焦",
    group: "window",
    defaultKeys: "Alt+W",
    editable: true,
    globalEligible: true,
  },
];

/** 按 id 取定义（含组内顺序） */
export function getShortcutDef(id: string): ShortcutDef | undefined {
  return SHORTCUTS.find((item) => item.id === id);
}

export const SHORTCUT_IDS: readonly string[] = SHORTCUTS.map((item) => item.id);

/** 默认绑定表（全量，便于存配置与比对「是否已改动」） */
export const DEFAULT_BINDINGS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(SHORTCUTS.map((item) => [item.id, item.defaultKeys])),
);

/** 默认开启的应用级快捷键 */
export const DEFAULT_GLOBALS: readonly string[] = Object.freeze(
  SHORTCUTS.filter((item) => item.globalEligible).map((item) => item.id),
);

/** 持久化载荷（存 userDb 的 config 表，键 novel_shortcuts） */
export interface ShortcutConfig {
  bindings: Record<string, string>;
  /** 已启用「应用级」的 id 列表 */
  globals: string[];
}

export const DEFAULT_SHORTCUT_CONFIG: ShortcutConfig = {
  bindings: { ...DEFAULT_BINDINGS },
  globals: [...DEFAULT_GLOBALS],
};

/** 补齐缺失键（旧配置 / 新增快捷键 id 时不至于读出 undefined） */
export function normalizeConfig(raw: unknown): ShortcutConfig {
  const source = (raw ?? {}) as Partial<ShortcutConfig>;
  const bindings: Record<string, string> = { ...DEFAULT_BINDINGS };
  if (source.bindings && typeof source.bindings === "object") {
    for (const item of SHORTCUTS) {
      const value = (source.bindings as Record<string, unknown>)[item.id];
      if (typeof value === "string" && value.trim()) {
        bindings[item.id] = value.trim();
      }
    }
  }
  const globals = Array.isArray(source.globals)
    ? source.globals.filter(
        (id): id is string =>
          typeof id === "string" &&
          SHORTCUTS.some((item) => item.id === id && item.globalEligible),
      )
    : [...DEFAULT_GLOBALS];
  return { bindings, globals };
}
