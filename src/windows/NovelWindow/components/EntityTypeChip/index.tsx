/**
 * 要素类型 chip（O-17：颜色语义冗余）
 *
 * 统一「单字前缀 + 名称」的渲染口径，前缀来自 `EntityTypeMeta.glyph`
 * （单一事实源），作为**真实文本节点**输出——读屏可读、灰度可辨。
 * 颜色只作为左边框色带（辅助线索），正文一律走 `--app-*` 主题变量。
 *
 * 形态严格按 §6.1.2：纯展示用 antd `Tag`；可点筛选用 antd `Button` +
 * `aria-pressed`（一个按钮承载，不嵌按钮）。
 */
import type { CSSProperties, ReactNode } from "react";
import { Button, Tag } from "antd";
import type { EntityTypeMeta } from "@/shared/novel/entity-type-meta";
import "./index.scss";

export interface EntityTypeChipProps {
  /** 由 `useEntityTypeMeta().metaOf(type)` 提供，禁止调用方硬编码前缀 */
  meta: EntityTypeMeta;
  /** 前缀后的内容：类型名 / 实体名 / 计数 */
  children?: ReactNode;
  /**
   * 传了即为「可点筛选」形态：antd Button + aria-pressed；
   * 不传则为纯展示 Tag。
   */
  onClick?: () => void;
  /** 可点筛选时的选中态 */
  pressed?: boolean;
  className?: string;
  title?: string;
}

export default function EntityTypeChip({
  meta,
  children,
  onClick,
  pressed = false,
  className = "",
  title,
}: EntityTypeChipProps) {
  const content = (
    <>
      <span className="nv-type-chip__glyph">{meta.glyph}</span>
      <span className="nv-type-chip__sep" aria-hidden>
        ·
      </span>
      <span className="nv-type-chip__label">{children ?? meta.label}</span>
    </>
  );
  // 颜色只落在左边框色带上：正文走主题变量，去色后仍靠前缀字辨识。
  // 同时以自定义属性把类型色交给外层：右栏筛选 chip 的选中态要用同一个色相上色
  // （浅底 + 同色描边），否则得让调用方再写一遍内联样式、两份颜色必然漂移。
  const bandStyle = {
    borderLeftColor: meta.color,
    "--nv-chip-color": meta.color,
  } as CSSProperties;

  if (onClick) {
    return (
      <Button
        className={`nv-type-chip nv-type-chip--action${pressed ? " is-on" : ""} ${className}`.trim()}
        style={bandStyle}
        aria-pressed={pressed}
        title={title}
        onClick={onClick}
      >
        {content}
      </Button>
    );
  }

  return (
    <Tag
      className={`nv-type-chip nv-type-chip--static ${className}`.trim()}
      style={bandStyle}
      title={title}
    >
      {content}
    </Tag>
  );
}
