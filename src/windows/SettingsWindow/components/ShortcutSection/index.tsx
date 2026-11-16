import { useCallback, useMemo, useState } from "react";
import { App, Button, Switch, Tag } from "antd";
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  getShortcutDef,
  persistShortcutConfig,
  resetShortcutConfig,
  useShortcutConfig,
  type ShortcutConfig,
  type ShortcutDef,
  type ShortcutGroup,
} from "@/shared/shortcuts";
import ShortcutRecorder from "../ShortcutRecorder";
import SettingsActionBar from "../SettingsActionBar";
import "./index.scss";

/** 分组展示顺序：写作 → 导航 → 面板 → 窗口 */
const GROUP_ORDER: readonly ShortcutGroup[] = [
  "writing",
  "navigation",
  "panel",
  "window",
];

/**
 * 快捷键分区（1.47.0）
 *
 * 只在 **开发版与小说版** 展示（由 SettingsWindow/App.tsx 门控）—— full/lite
 * 正式版里小说窗口是子窗口，快捷键属于专家配置，不该占设置页的主位。
 *
 * 交互原则：**改完即生效**，没有「保存」按钮。与项目其他设置一致
 * （主题、面板宽度都是即时生效），也避免出现「改了没点保存，回头全丢」。
 *
 * 页面底部仍保留与其它页同位置的常驻条，但左侧写的是「立即生效」而不是
 * 状态点 —— 内容不同、位置相同，切页时手不用重新找地方（见 SettingsActionBar）。
 */
export default function ShortcutSection() {
  const { message } = App.useApp();
  const config = useShortcutConfig();
  /** 正在保存的 id：避免连点时用旧配置覆盖新配置 */
  const [pendingId, setPendingId] = useState<string | null>(null);

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        title: SHORTCUT_GROUPS[group],
        items: SHORTCUTS.filter((item) => item.group === group),
      })).filter((entry) => entry.items.length > 0),
    [],
  );

  /** 保存并统一处理「应用级注册失败」 */
  const save = useCallback(
    async (next: ShortcutConfig, id: string | null) => {
      setPendingId(id);
      const result = await persistShortcutConfig(next);
      setPendingId(null);
      if (result.globalFailures.length > 0) {
        const names = result.globalFailures
          .map((failedId) => getShortcutDef(failedId)?.label ?? failedId)
          .join("、");
        message.warning(`${names} 无法注册为应用外快捷键：组合键可能已被系统或其他应用占用`);
      }
    },
    [message],
  );

  const handleCommit = useCallback(
    (def: ShortcutDef, keys: string) => {
      const conflict = SHORTCUTS.find(
        (item) => item.id !== def.id && config.bindings[item.id] === keys,
      );
      if (conflict) {
        message.warning(`「${keys}」已被「${conflict.label}」占用，请换一个组合`);
        return;
      }
      void save(
        { bindings: { ...config.bindings, [def.id]: keys }, globals: config.globals },
        def.id,
      );
    },
    [config, message, save],
  );

  const handleToggleGlobal = useCallback(
    (def: ShortcutDef, enabled: boolean) => {
      const globals = enabled
        ? Array.from(new Set([...config.globals, def.id]))
        : config.globals.filter((id) => id !== def.id);
      void save({ bindings: config.bindings, globals }, def.id);
    },
    [config, save],
  );

  const handleReset = useCallback(() => {
    void (async () => {
      const result = await resetShortcutConfig();
      message.success("已恢复默认快捷键");
      if (result.globalFailures.length > 0) {
        message.warning("部分应用外快捷键未能注册：组合键可能已被占用");
      }
    })();
  }, [message]);

  return (
    <>
      <section className="settings-section">
        <div className="settings-section__body">
          <p className="settings-shortcut__lead">
            按 <kbd>Esc</kbd> 取消录制、<kbd>Backspace</kbd> 回退默认。勾了「应用外生效」的
            键位在窗口失去焦点时仍可用，但它可能被系统或其他应用占用。
          </p>

          {grouped.map((entry) => (
            <div className="settings-shortcut__group" key={entry.group}>
              <h3 className="settings-shortcut__group-title">{entry.title}</h3>
              {entry.items.map((def) => (
                <div className="settings-item settings-shortcut__row" key={def.id}>
                  <div className="settings-item__text">
                    <span className="settings-item__label">
                      {def.label}
                      {def.globalEligible ? <Tag className="settings-shortcut__tag">可全局</Tag> : null}
                    </span>
                    <span className="settings-item__hint">{def.description}</span>
                  </div>
                  <div className="settings-shortcut__controls">
                    {def.globalEligible ? (
                      <label className="settings-shortcut__global">
                        <Switch
                          size="small"
                          checked={config.globals.includes(def.id)}
                          onChange={(checked) => handleToggleGlobal(def, checked)}
                        />
                        <span>应用外生效</span>
                      </label>
                    ) : null}
                    <ShortcutRecorder
                      value={config.bindings[def.id] ?? def.defaultKeys}
                      defaultValue={def.defaultKeys}
                      disabled={!def.editable || pendingId === def.id}
                      onCommit={(keys) => handleCommit(def, keys)}
                    />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* 这一页没有「保存」：底条左侧直说立即生效，右侧只留可重置的工具动作 */}
      <SettingsActionBar state="hint" hint="修改后立即生效，无需保存">
        <Button className="settings-btn" onClick={handleReset}>
          恢复默认
        </Button>
      </SettingsActionBar>
    </>
  );
}
