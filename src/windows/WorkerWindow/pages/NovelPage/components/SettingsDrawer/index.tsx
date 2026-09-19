import { Segmented, Slider, Switch } from "antd";
import { SETTINGS_RANGE } from "../../novel-config";
import { ENTITY_FILTER_ORDER, ENTITY_TYPE_META } from "../../novel-config";
import { formatThousands } from "../../novel-utils";
import type { EditorSettings, EntityType, WordCountMode } from "./../../types";
import "./index.scss";

interface SettingsDrawerProps {
  open: boolean;
  settings: EditorSettings;
  onUpdate: <K extends keyof EditorSettings>(
    key: K,
    value: EditorSettings[K],
  ) => void;
  onToggleAnnotationType: (type: EntityType) => void;
  onClose: () => void;
}

/**
 * 设置抽屉（D2 / R4 · R5）
 *
 * 覆盖字号 / 行距 / 段间距 / 首行缩进 / 今日目标 / 字数口径 / 标注类型开关。
 * 阅读底色不在这里提供——跟随主窗口主题才能保证「所有窗口同一套主题色」，
 * 主题切换入口按 AGENTS.md 6.1.1 统一放在主界面侧边栏底部。
 */
export default function SettingsDrawer({
  open,
  settings,
  onUpdate,
  onToggleAnnotationType,
  onClose,
}: SettingsDrawerProps) {
  return (
    <aside className={`nv-setting${open ? " is-open" : ""}`}>
      <header className="nv-setting__head">
        <b>设置</b>
        <button type="button" aria-label="关闭" onClick={onClose}>
          ✕
        </button>
      </header>

      <div className="nv-setting__body">
        <section className="nv-setting__row">
          <label>字号</label>
          <Slider
            min={SETTINGS_RANGE.fontSize.min}
            max={SETTINGS_RANGE.fontSize.max}
            step={SETTINGS_RANGE.fontSize.step}
            value={settings.fontSize}
            onChange={(value) => onUpdate("fontSize", value)}
          />
          <span className="nv-setting__value">{settings.fontSize}px</span>
        </section>

        <section className="nv-setting__row">
          <label>行距</label>
          <Slider
            min={SETTINGS_RANGE.lineHeight.min}
            max={SETTINGS_RANGE.lineHeight.max}
            step={SETTINGS_RANGE.lineHeight.step}
            value={settings.lineHeight}
            onChange={(value) => onUpdate("lineHeight", value)}
          />
          <span className="nv-setting__value">
            {settings.lineHeight.toFixed(1)}
          </span>
        </section>

        <section className="nv-setting__row">
          <label>段间距</label>
          <Slider
            min={SETTINGS_RANGE.paragraphSpacing.min}
            max={SETTINGS_RANGE.paragraphSpacing.max}
            step={SETTINGS_RANGE.paragraphSpacing.step}
            value={settings.paragraphSpacing}
            onChange={(value) => onUpdate("paragraphSpacing", value)}
          />
          <span className="nv-setting__value">
            {settings.paragraphSpacing.toFixed(1)}em
          </span>
        </section>

        <section className="nv-setting__row">
          <label>首行缩进</label>
          <Switch
            checked={settings.indent}
            onChange={(checked) => onUpdate("indent", checked)}
          />
        </section>

        <section className="nv-setting__row">
          <label>今日目标</label>
          <Slider
            min={SETTINGS_RANGE.dailyGoal.min}
            max={SETTINGS_RANGE.dailyGoal.max}
            step={SETTINGS_RANGE.dailyGoal.step}
            value={settings.dailyGoal}
            onChange={(value) => onUpdate("dailyGoal", value)}
          />
          <span className="nv-setting__value">
            {formatThousands(settings.dailyGoal)}
          </span>
        </section>

        <section className="nv-setting__row">
          <label>字数口径</label>
          <Segmented<WordCountMode>
            size="small"
            value={settings.wordCountMode}
            options={[
              { value: "withPunctuation", label: "含标点" },
              { value: "hanOnly", label: "纯汉字" },
            ]}
            onChange={(value) => onUpdate("wordCountMode", value)}
          />
        </section>

        <section className="nv-setting__block">
          <h6 className="nv-setting__label">正文高亮类型</h6>
          <div className="nv-setting__chips">
            {ENTITY_FILTER_ORDER.map((type) => {
              const meta = ENTITY_TYPE_META[type];
              const on = settings.annotationTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  className={`nv-setting__chip${on ? " is-on" : ""}`}
                  style={on ? undefined : { color: meta.color }}
                  onClick={() => onToggleAnnotationType(type)}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
          <p className="nv-setting__hint">
            阅读底色跟随主窗口主题；标注层全部关闭即整体降级。
          </p>
        </section>
      </div>
    </aside>
  );
}
