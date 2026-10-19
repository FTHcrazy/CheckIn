/**
 * 快捷键配置的模块级 store（1.47.0）
 *
 * 为什么不是 React context：`useNovelShortcuts` 在编辑器里、`SettingsWindow`
 * 在另一个窗口 —— 跨窗口同步只能走 IPC 广播，模块级单例是唯一能同时被两者
 * 订阅、又不把 Provider 塞进每个窗口入口的形态。
 *
 * 数据流向：
 *   主进程（单一事实源，存 userDb config）
 *     → 窗口启动 `loadShortcutConfig()`
 *     → 设置窗口改键 `persistShortcutConfig()` → 主进程写库 + 重注册全局键
 *     → 广播 `shortcut-changed` → 所有窗口 `setShortcutConfig()`
 *
 * ⚠️ 默认值先在内存里生效（`DEFAULT_SHORTCUT_CONFIG`），IPC 回来前快捷键就能用，
 * 不会出现「打开窗口后头几百毫秒所有快捷键失灵」。
 */
import {
  DEFAULT_SHORTCUT_CONFIG,
  normalizeConfig,
  type ShortcutConfig,
} from "./registry";

/** 广播事件名：任意窗口改键后通知其他窗口 */
export const SHORTCUT_CHANGED_EVENT = "shortcut-changed";

let config: ShortcutConfig = {
  bindings: { ...DEFAULT_SHORTCUT_CONFIG.bindings },
  globals: [...DEFAULT_SHORTCUT_CONFIG.globals],
};

const listeners = new Set<() => void>();
let bootstrapped = false;

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // 单个订阅者出错不该影响其他窗口 / 其他 hook
    }
  }
}

export function getShortcutConfig(): ShortcutConfig {
  return config;
}

export function subscribeShortcutConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 覆盖内存中的配置（加载 / 广播 / 保存后都会走这里） */
export function setShortcutConfig(next: unknown): ShortcutConfig {
  config = normalizeConfig(next);
  emit();
  return config;
}

/** 从主进程读一次（失败静默：保留默认值） */
export async function loadShortcutConfig(): Promise<ShortcutConfig> {
  const api = window.electronAPI?.shortcut;
  if (!api) return config;
  try {
    const loaded = await api.get();
    return setShortcutConfig(loaded);
  } catch {
    return config;
  }
}

export interface SaveShortcutResult {
  config: ShortcutConfig;
  /** 注册失败（被系统或其他应用占用）的应用级快捷键 id */
  globalFailures: string[];
}

/**
 * 保存到主进程（写库 + 重新注册应用级快捷键），成功后本地立即生效。
 *
 * 即使保存失败也**不动**内存里的值：宁可这次改了没存上，也不要界面回弹
 * 让用户以为按键丢了。
 */
export async function persistShortcutConfig(
  next: ShortcutConfig,
): Promise<SaveShortcutResult> {
  const normalized = normalizeConfig(next);
  setShortcutConfig(normalized);
  const api = window.electronAPI?.shortcut;
  if (!api) return { config: normalized, globalFailures: [] };
  try {
    const result = await api.set(normalized);
    return {
      config: setShortcutConfig(result.config ?? normalized),
      globalFailures: result.globalFailures ?? [],
    };
  } catch {
    return { config: normalized, globalFailures: [] };
  }
}

/** 恢复默认（写回全量默认绑定 + 默认全局开关） */
export async function resetShortcutConfig(): Promise<SaveShortcutResult> {
  return persistShortcutConfig({
    bindings: { ...DEFAULT_SHORTCUT_CONFIG.bindings },
    globals: [...DEFAULT_SHORTCUT_CONFIG.globals],
  });
}

/**
 * 窗口入口调用一次：拉取配置 + 订阅跨窗口变更。
 *
 * 只应在需要快捷键的窗口调用（NovelWindow / SettingsWindow）——
 * 其他窗口既不用快捷键，也不该为一条广播多挂一个监听。
 */
export function bootstrapShortcutSync(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  void loadShortcutConfig();
  const api = window.electronAPI?.windowAPI;
  api?.on?.(SHORTCUT_CHANGED_EVENT, (payload) => {
    setShortcutConfig(payload);
  });
}

/** 测试用：把模块状态复位（模块级单例会在用例之间残留） */
export function resetShortcutStoreForTest(): void {
  config = {
    bindings: { ...DEFAULT_SHORTCUT_CONFIG.bindings },
    globals: [...DEFAULT_SHORTCUT_CONFIG.globals],
  };
  listeners.clear();
  bootstrapped = false;
}
