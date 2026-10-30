import "./index.scss";

interface SvgIconProps {
  /** `import xxx from "…svg?raw"` 拿到的 SVG 字符串（iconfont 格式，fill=currentColor） */
  svg: string;
  className?: string;
}

/**
 * 内联 SVG 图标（1.41.0）。
 *
 * 设计侧给的 custom 图标（行囊 / 小说设定 / 量纲 / 分类）是 iconfont 导出的
 * 整文件 SVG，`fill="currentColor"` —— 想让它跟着文字色走就必须**内联进 DOM**，
 * `<img src>` 会把颜色钉死在文件里。项目没装 vite-plugin-svgr，走 Vite 原生的
 * `?raw` 导入 + 这里的一次性 innerHTML 注入。
 *
 * 根节点上的 `width="32" height="32"` 由 CSS 覆盖成 `1em`，尺寸交给使用处的
 * font-size 控制（与 @ant-design/icons 同一套约定）。
 */
export default function SvgIcon({ svg, className }: SvgIconProps) {
  return (
    <span
      className={`svgicon${className ? ` ${className}` : ""}`}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
