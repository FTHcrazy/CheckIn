import { Badge, Segmented } from "antd";
import type { ReactNode } from "react";
import "./index.scss";

/**
 * 右栏分段切换（AGENTS §6.1.2：分段切换一律用组件库 `Segmented`）。
 *
 * 收敛前右栏有四处「手搓分段条」：大纲的「章节 / 伏笔」与伏笔三态、
 * 检索的「全书 / 本章 / 要素名」、敏感词的「检测结果 / 词库」「关闭 / 自动 / 手动」
 * 「本章 / 全书」，以及右栏五 Tab 那条带滑块指示器的 tab 条。它们各自维护
 * `.is-on` 类名、滑块定位（其中 Tab 条还要 ResizeObserver 重新量宽度）——
 * 四份实现四份漂移点，键盘语义（radio）也一直缺着。
 *
 * 现在统一由本组件承载：滑块动画 / radio 语义 / 键盘左右键都由组件库给，
 * 外观差异只在 `index.scss` 里用 `--ant-segmented-*` 变量表达，仍是原来那套
 * 「轨道底 + 浮起白滑块」。
 *
 * ⚠️ 视觉等价的关键在两个尺寸变量：Segmented 的滑块高度 =
 * `--ant-control-height` − 2 × `--ant-segmented-track-padding`。
 * 想把滑块做成 25px，就得给 31px 的 control-height，而不是直接写 25
 * —— 组件库不接受「直接指定滑块高度」。
 */
export interface NvSegmentedOption<T extends string> {
  value: T;
  /** 文案；右栏五 Tab 传的是「图标 + 文字」两行结构 */
  label: ReactNode;
  /** 行尾计数（章节数 / 伏笔数 / 命中数）。0 也照常显示，与旧实现一致 */
  count?: number;
  disabled?: boolean;
  /** 原生 title：禁用项用它解释「为什么点不了」 */
  title?: string;
}

interface NvSegmentedProps<T extends string> {
  value: T;
  options: readonly NvSegmentedOption<T>[];
  onChange: (value: T) => void;
  /** 可访问名。分段控件渲染成 radiogroup，没有可读名等于对读屏隐形 */
  ariaLabel: string;
  /** 是否整行等分（默认）。false = 收成内容宽，用于附属控件 */
  block?: boolean;
  /** switch = 单行文字（默认）；tabs = 右栏五 Tab（图标在上、文字在下） */
  variant?: "switch" | "tabs";
  /** 挂到根上的业务类名（外边距等交给调用方，样式就近） */
  className?: string;
}

export default function NvSegmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  block = true,
  variant = "switch",
  className,
}: NvSegmentedProps<T>) {
  const classes = ["nv-seg"];
  if (!block) classes.push("nv-seg--inline");
  if (variant === "tabs") classes.push("nv-seg--tabs");
  if (className) classes.push(className);

  return (
    <Segmented<T>
      className={classes.join(" ")}
      block={block}
      value={value}
      onChange={onChange}
      aria-label={ariaLabel}
      options={options.map((option) => ({
        value: option.value,
        disabled: option.disabled,
        title: option.title,
        label: (
          <span className="nv-seg__label">
            {option.label}
            {/* 计数用组件库 Badge（§6.1.2）：改前是自绘的 `<span>`，圆角 / 内衬 /
                最小宽度都得自己算，字号一改就与轨道高度不齐 */}
            {typeof option.count === "number" ? (
              <Badge
                className="nv-seg__badge"
                count={option.count}
                showZero
                size="small"
                overflowCount={99}
              />
            ) : null}
          </span>
        ),
      }))}
    />
  );
}
