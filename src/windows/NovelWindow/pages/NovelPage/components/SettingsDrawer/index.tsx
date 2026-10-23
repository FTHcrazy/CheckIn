import { useEffect, useRef } from "react";
import { Button, Input, Segmented, Slider, Switch } from "antd";
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
import FontPicker from "./FontPicker";
import type { usePaperFonts } from "../../hooks/usePaperFonts";
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
  /** 正文字体状态（由 NovelPage 持有，经这里转交 FontPicker） */
  paperFonts?: ReturnType<typeof usePaperFonts>;
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
  paperFonts,
}: SettingsDrawerProps) {
  const { metaOf, filterOrder } = useEntityTypeMeta();
  const rootRef = useRef<HTMLElement>(null);

  /**
   * 「点抽屉外部关闭」——文档级 `mousedown` 分流（REQ-050 修法 ③）。
   *
   * 原实现是一层 `position:absolute; inset:0` 的**透明捕获层**（`.nv-setting__mask`）：
   * 用「遮挡换关闭」，与 antd Modal / Tour 的 mask 是同一类模式，是 REQ-050
   * 「第一击被关闭路径消耗」的回归来源；且它几何上只铺满 stage，够不到顶栏。
   *
   * 改法：落点在抽屉本体内 → 不处理；否则调 `onClose()` 关闭抽屉，但**绝不
   * `preventDefault` / `stopPropagation`** —— 让同一次点击继续正常派发给被点元素
   * （顶栏按钮 / 正文 / 支撑面板），于是「关抽屉」与「触发被点元素」在同一次点击
   * 里同时发生，不再需要第二击。
   *
   * 例外：触发本抽屉的那颗按钮（顶栏「排版与偏好」）打了
   * `data-drawer-keep-open="settings"`，它自带 toggle 语义 —— 若这里也关一次，
   * 就会「先关、再被 toggle 打开」，表现为点了没反应。语义上它是开关本身，不算「外部」。
   */
  useEffect(() => {
    if (!open) return undefined;
    const handleMouseDown = (event: MouseEvent): void => {
      const node = rootRef.current;
      if (!node) return;
      const target = event.target;
      if (target instanceof Node && node.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest('[data-drawer-keep-open="settings"]')
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, onClose]);

  return (
    <aside ref={rootRef} className={`nv-setting${open ? " is-open" : ""}`}>
      <header className="nv-setting__head">
        <b>排版与偏好</b>
        <Button aria-label="关闭" onClick={onClose}>
          ✕
        </Button>
      </header>

      <div className="nv-setting__body">
        <section className="nv-setting__block">
          <h6 className="nv-setting__label">排版</h6>

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

          <section className="nv-setting__row is-toggle">
            <label>首行缩进</label>
            <Switch
              size="small"
              checked={settings.indent}
              onChange={(checked) => onUpdate("indent", checked)}
            />
          </section>
        </section>

        <section className="nv-setting__block">
          <h6 className="nv-setting__label">阅读</h6>

          <section className="nv-setting__row is-toggle">
            <div className="nv-setting__text">
              <label>护眼纸质感</label>
              <p className="nv-setting__hint">换纸面色并叠纸纹，文字更柔和。</p>
            </div>
            <Switch
              size="small"
              checked={settings.paperTexture}
              onChange={(checked) => onUpdate("paperTexture", checked)}
            />
          </section>

          <section className="nv-setting__row is-toggle">
            <div className="nv-setting__text">
              <label>阅读模式</label>
              <p className="nv-setting__hint">
                只读并隐藏光标；章节首尾继续同向滚动即翻章，一次滚动只翻一章。
              </p>
            </div>
            <Switch
              size="small"
              checked={settings.readMode}
              onChange={(checked) => onUpdate("readMode", checked)}
            />
          </section>
        </section>

        <section className="nv-setting__block">
          <h6 className="nv-setting__label">正文字体</h6>
          <FontPicker fonts={paperFonts} />
        </section>

        <section className="nv-setting__block">
          <h6 className="nv-setting__label">写作目标</h6>

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

          <section className="nv-setting__row is-control">
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
        </section>

        <section className="nv-setting__block">
          <h6 className="nv-setting__label">章节与卷命名</h6>

          <div className="nv-setting__field">
            <label className="nv-setting__sub">序号数字</label>
            <Segmented<LabelNumberStyle>
              size="small"
              block
              value={settings.numberStyle}
              options={[
                { value: "arabic", label: "阿拉伯（第1章）" },
                { value: "chinese", label: "中文（第一章）" },
              ]}
              onChange={(value) => onUpdate("numberStyle", value)}
            />
          </div>

          <div className="nv-setting__field">
            <label className="nv-setting__sub">章节后缀</label>
            <div className="nv-setting__chips is-even">
              {CHAPTER_SUFFIX_OPTIONS.map((suffix) => (
                <Button
                  key={suffix}
                  className={`nv-setting__chip${
                    settings.chapterSuffix === suffix ? " is-on" : ""
                  }`}
                  onClick={() => onUpdate("chapterSuffix", suffix)}
                >
                  {formatNumberedLabel(settings.numberStyle, suffix, 1)}
                </Button>
              ))}
            </div>
            <section className="nv-setting__row is-control">
              <label>自定义</label>
              <Input
                className="nv-setting__suffix-input"
                variant="borderless"
                value={settings.chapterSuffix}
                maxLength={4}
                aria-label="自定义章节后缀"
                placeholder="如：话"
                onChange={(event) =>
                  onUpdate("chapterSuffix", event.target.value.trim() || "章")
                }
              />
            </section>
          </div>

          <div className="nv-setting__field">
            <label className="nv-setting__sub">卷名后缀</label>
            <div className="nv-setting__chips is-even">
              {VOLUME_SUFFIX_OPTIONS.map((suffix) => (
                <Button
                  key={suffix}
                  className={`nv-setting__chip${
                    settings.volumeSuffix === suffix ? " is-on" : ""
                  }`}
                  onClick={() => onUpdate("volumeSuffix", suffix)}
                >
                  {formatNumberedLabel(settings.numberStyle, suffix, 1)}
                </Button>
              ))}
            </div>
            <section className="nv-setting__row is-control">
              <label>自定义</label>
              <Input
                className="nv-setting__suffix-input"
                variant="borderless"
                value={settings.volumeSuffix}
                maxLength={4}
                aria-label="自定义卷名后缀"
                placeholder="如：册"
                onChange={(event) =>
                  onUpdate("volumeSuffix", event.target.value.trim() || "卷")
                }
              />
            </section>
          </div>

          <section className="nv-setting__row is-toggle">
            <div className="nv-setting__text">
              <label>防误触排序</label>
              <p className="nv-setting__hint">
                拖拽调整章节或卷的顺序时，先弹窗确认序号变化再生效。
              </p>
            </div>
            <Switch
              size="small"
              checked={settings.confirmReorder}
              onChange={(checked) => onUpdate("confirmReorder", checked)}
            />
          </section>
        </section>

        <section className="nv-setting__block">
          <h6 className="nv-setting__label">正文高亮类型</h6>
          <div className="nv-setting__chips is-auto">
            {filterOrder.map((type) => {
              const meta = metaOf(type);
              const on = settings.annotationTypes.includes(type);
              return (
                <Button
                  key={type}
                  className={`nv-setting__chip${on ? " is-on" : ""}`}
                  style={on ? undefined : { color: meta.color }}
                  onClick={() => onToggleAnnotationType(type)}
                >
                  {meta.label}
                </Button>
              );
            })}
          </div>
          <p className="nv-setting__hint">
            纸面底色跟随主窗口主题；标注层全部关闭即整体降级。
          </p>
        </section>
      </div>
    </aside>
  );
}
