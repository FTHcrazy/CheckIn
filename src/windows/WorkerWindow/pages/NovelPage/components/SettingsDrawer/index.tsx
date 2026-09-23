import { Input, Segmented, Slider, Switch } from "antd";
import {
  CHAPTER_SUFFIX_OPTIONS,
  SETTINGS_RANGE,
  VOLUME_SUFFIX_OPTIONS,
} from "../../novel-config";
import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import { formatNumberedLabel, formatThousands } from "../../novel-utils";
import type {
  EditorSettings,
  EntityType,
  LabelNumberStyle,
  WordCountMode,
} from "./../../types";
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
  const { metaOf, filterOrder } = useEntityTypeMeta();

  return (
    <>
      {/* 点外部关闭：打开时铺满 stage 的透明捕获层（z-index 低于抽屉本体） */}
      {open && (
        <div
          className="nv-setting__mask"
          aria-hidden="true"
          onClick={onClose}
        />
      )}
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
          <h6 className="nv-setting__label">序号数字</h6>
          <Segmented<LabelNumberStyle>
            size="small"
            value={settings.numberStyle}
            options={[
              { value: "arabic", label: "阿拉伯（第1章）" },
              { value: "chinese", label: "中文（第一章）" },
            ]}
            onChange={(value) => onUpdate("numberStyle", value)}
          />
        </section>

        <section className="nv-setting__block">
          <h6 className="nv-setting__label">章节后缀</h6>
          <div className="nv-setting__chips">
            {CHAPTER_SUFFIX_OPTIONS.map((suffix) => (
              <button
                key={suffix}
                type="button"
                className={`nv-setting__chip${
                  settings.chapterSuffix === suffix ? " is-on" : ""
                }`}
                onClick={() => onUpdate("chapterSuffix", suffix)}
              >
                {formatNumberedLabel(settings.numberStyle, suffix, 1)}
              </button>
            ))}
          </div>
          <Input
            className="nv-setting__suffix-input"
            variant="borderless"
            value={settings.chapterSuffix}
            maxLength={4}
            aria-label="自定义章节后缀"
            placeholder="自定义后缀，如：话"
            onChange={(event) =>
              onUpdate("chapterSuffix", event.target.value.trim() || "章")
            }
          />
        </section>

        <section className="nv-setting__block">
          <h6 className="nv-setting__label">卷名后缀</h6>
          <div className="nv-setting__chips">
            {VOLUME_SUFFIX_OPTIONS.map((suffix) => (
              <button
                key={suffix}
                type="button"
                className={`nv-setting__chip${
                  settings.volumeSuffix === suffix ? " is-on" : ""
                }`}
                onClick={() => onUpdate("volumeSuffix", suffix)}
              >
                {formatNumberedLabel(settings.numberStyle, suffix, 1)}
              </button>
            ))}
          </div>
          <Input
            className="nv-setting__suffix-input"
            variant="borderless"
            value={settings.volumeSuffix}
            maxLength={4}
            aria-label="自定义卷名后缀"
            placeholder="自定义后缀，如：册"
            onChange={(event) =>
              onUpdate("volumeSuffix", event.target.value.trim() || "卷")
            }
          />
        </section>

        <section className="nv-setting__row">
          <label>防误触排序</label>
          <Switch
            checked={settings.confirmReorder}
            onChange={(checked) => onUpdate("confirmReorder", checked)}
          />
        </section>
        <p className="nv-setting__hint">
          开启后，拖拽调整章节或卷的顺序时先弹窗确认序号变化，确认后才生效。
        </p>

        <section className="nv-setting__block">
          <h6 className="nv-setting__label">正文高亮类型</h6>
          <div className="nv-setting__chips">
            {filterOrder.map((type) => {
              const meta = metaOf(type);
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
    </>
  );
}
