import { useMemo, useState } from "react";
import { Popover } from "antd";
import { useTheme } from "@/shared/theme";
import type { ThemeMeta } from "@/shared/theme";
import "./index.scss";

interface ThemeSwitcherProps {
  /** icon：圆形图标按钮（侧边栏用）；button：带文字的按钮（设置区用） */
  variant?: "icon" | "button";
  /** 气泡弹出方位，默认 bottomRight */
  placement?: "bottomRight" | "bottom" | "topRight" | "top" | "right" | "left";
}

/** 当前主题色板（用于图标按钮内的主色圆点） */
function SwatchGlyph({ meta }: { meta: ThemeMeta }) {
  return (
    <span className="theme-switcher__glyph" aria-hidden="true">
      <span style={{ background: meta.swatch }} />
    </span>
  );
}

/**
 * 主题切换器：切换后写入 localStorage 并广播，所有窗口同步换肤。
 *
 * 用法：`<ThemeSwitcher />`（首页侧边栏底部）或 `<ThemeSwitcher variant="button" />`（设置区）。
 *
 * 注意：全局只保留侧边栏这一个入口，标题栏（WindowHeader）不再放切换器。
 */
export default function ThemeSwitcher({
  variant = "icon",
  placement = "bottomRight",
}: ThemeSwitcherProps) {
  const { theme, themes, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const activeMeta = useMemo(
    () => themes.find((item) => item.id === theme) ?? themes[0],
    [themes, theme],
  );

  const panel = (
    <div className="theme-switcher__panel">
      <div className="theme-switcher__panel-title">主题色</div>
      <div className="theme-switcher__list">
        {themes.map((item) => {
          const active = item.id === theme;
          return (
            <button
              key={item.id}
              type="button"
              className={
                active
                  ? "theme-switcher__item is-active"
                  : "theme-switcher__item"
              }
              aria-pressed={active}
              onClick={() => {
                setTheme(item.id);
                setOpen(false);
              }}
            >
              <span
                className="theme-switcher__swatch"
                style={{ background: item.swatch }}
              >
                {active && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    aria-hidden="true"
                  >
                    <path
                      d="M2.5 7.5l3 3 6-6"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span className="theme-switcher__text">
                <span className="theme-switcher__label">{item.label}</span>
                <span className="theme-switcher__hint">{item.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement={placement}
      trigger="click"
      arrow={false}
      align={{ offset: [20, -20] }}
      overlayClassName="theme-switcher__popover"
      content={panel}
    >
      {variant === "icon" ? (
        <button
          type="button"
          className="theme-switcher__trigger"
          aria-label={`切换主题（当前：${activeMeta.label}）`}
          title={`切换主题（当前：${activeMeta.label}）`}
        >
          <SwatchGlyph meta={activeMeta} />
        </button>
      ) : (
        <button
          type="button"
          className="theme-switcher__trigger theme-switcher__trigger--button"
        >
          <SwatchGlyph meta={activeMeta} />
          <span className="theme-switcher__trigger-text">
            {activeMeta.label}
          </span>
          <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
            <path
              d="M1 1l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </Popover>
  );
}
