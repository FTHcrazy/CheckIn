import { Button } from "antd";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ColumnWidthOutlined,
  EditOutlined,
  EyeOutlined,
  ExpandOutlined,
  ImportOutlined,
  RetweetOutlined,
  SoundOutlined,
} from "@ant-design/icons";
import { MARK_TYPE_OPTIONS } from "../../novel-config";
import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import { truncate } from "../../novel-utils";
import { TRANSFORM_KIND_LABELS, type TransformKind } from "@/shared/ai/context";
import type { EntityType } from "../../types";
import { placeContextMenu, type Placement } from "./placement";
import "./index.scss";

/** 变换类型 → 图标（润色独立，五种变换各配一个，菜单一眼可辨） */
const TRANSFORM_ICONS: Record<TransformKind, ReactNode> = {
  expand: <ExpandOutlined />,
  condense: <ColumnWidthOutlined />,
  rewrite: <RetweetOutlined />,
  tone: <SoundOutlined />,
  pov: <EyeOutlined />,
};

/** 菜单里五种变换的展示顺序（润色单列在最前，其余按 PRD 顺序） */
const TRANSFORM_KINDS: TransformKind[] = ["expand", "condense", "rewrite", "tone", "pov"];

interface EntityContextMenuProps {
  /** 相对 .nv-page__stage 的鼠标坐标（落位由本组件按实测尺寸自行夹取） */
  x: number;
  y: number;
  /** 选中的正文文本 */
  text: string;
  /** 把选中文本记入行囊物品栏（REQ-027）；面板没开也生效 */
  onAddToPack: () => void;
  /** 新建资料卡（类型由菜单项决定） */
  onMark: (type: EntityType) => void;
  /** AI 润色选中文本（R-AI-03）：打开润色预览，确认后替换 */
  onPolish: () => void;
  /** AI 文本变换选中文本（R-AI-06）：扩写 / 精简 / 改写 / 换语气 / 转视角 */
  onTransform: (kind: TransformKind) => void;
  /**
   * AI 入口是否**存在**（REQ-063）。false 时「文本变换」整块（标签 + 润色 +
   * 五个变换）不渲染，菜单只剩「记入行囊」「新建资料卡」。
   *
   * 与 `aiAvailable` 的分工：`aiVisible` 管「这个功能该不该出现」（总开关关了 /
   * 本版本没有 AI 通道）；`aiAvailable` 管「出现了但这次用不了」（开关开着却没
   * 配全模型 / Key），那种情况要留一行可点的禁用项和原因，用户才知道去补配置。
   */
  aiVisible?: boolean;
  /** AI 是否可用（M8 门控）；false 时润色/变换菜单项禁用并说明原因 */
  aiAvailable?: boolean;
  /** AI 不可用的一句话说明（挂菜单项 title） */
  aiUnavailableText?: string;
  onClose: () => void;
}

/**
 * 选区右键菜单（O3 / R20 ③）
 *
 * 选中正文 → 右键：AI 文本变换 / 记入行囊 / 新建资料卡（四类型直建）。
 * 菜单相对 stage 绝对定位，透明捕获层负责点外部关闭。
 *
 * **「绑定到现有资料卡」已下线（REQ-062）**：它做的事只是把选中文字追加成
 * 某张卡的别名，与「新建资料卡」的收益高度重叠，却按资料卡数量线性增长——
 * 设定库有 N 张卡就多 N 行，占了菜单一半以上篇幅，把真正高频的变换挤到要
 * 滚动才看得全。需要补别名时在要素详情里手动加更可控。
 *
 * 落位（REQ-056）：菜单项随 AI 变换 / 行囊 / 资料卡不断长高，早期按
 * 「约 190×320」估算夹取早已不够——靠近正文底部右键时下半截被
 * `overflow: hidden` 的 stage 切掉，底部功能点不到。现在改为渲染后**实测**
 * 自身高度（`scrollHeight`，含未展开的滚动内容），再交给 `placeContextMenu`
 * 决定最终坐标：下方放不下就翻到光标上方，整体超过 stage 高度才启用
 * `max-height` + 内部滚动。
 */
export default function EntityContextMenu({
  x,
  y,
  text,
  onAddToPack,
  onMark,
  onPolish,
  onTransform,
  aiVisible = true,
  aiAvailable = true,
  aiUnavailableText = "",
  onClose,
}: EntityContextMenuProps) {
  const { metaOf } = useEntityTypeMeta();
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  // 首帧先按鼠标坐标落位，再由 layout effect 量完改写成 final 坐标：
  // layout effect 在浏览器绘制前执行，改状态触发的重渲染同步完成，不会闪一下。
  // `aiVisible` 必须在依赖里：AI 块整块消失会让菜单矮掉一大截（甚至不必翻到
  // 光标上方了），菜单开着时开关被另一个窗口改掉，落位要跟着重算。
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const stageEl = el.closest<HTMLElement>(".nv-page__stage");
    // 定位基准是 stage 的 padding box（绝对定位的包含块），与 left/top 同坐标系
    const stage = stageEl
      ? { width: stageEl.clientWidth, height: stageEl.clientHeight }
      : { width: window.innerWidth, height: window.innerHeight };
    setPlacement(
      placeContextMenu({
        x,
        y,
        // 高度必须用 scrollHeight：即使上一轮已经套了 max-height，这里拿到的
        // 仍是内容自然高度，不会出现「量到被压缩后的高度 → 越算越矮」的回路
        menu: { width: el.offsetWidth, height: el.scrollHeight },
        stage,
      }),
    );
  }, [x, y, aiVisible]);

  return (
    <>
      {/* 点外部关闭：铺满 stage 的透明捕获层（z-index 低于菜单本体） */}
      <div className="nv-ctxmenu__mask" aria-hidden="true" onClick={onClose} />
      <div
        ref={menuRef}
        className="nv-ctxmenu"
        style={{
          left: placement?.left ?? x,
          top: placement?.top ?? y,
          maxHeight: placement?.maxHeight,
        }}
        role="menu"
      >
        <p className="nv-ctxmenu__selection" title={text}>
          {truncate(text, 16)}
        </p>

        {/* AI 文本变换（R-AI-03 + R-AI-06）排在最前：划词最高频意图是改文字，
            润色单列，五种变换分列，一次点击进入预览。
            REQ-063：`aiVisible=false`（AI 总开关关掉 / 本版本没有 AI 通道）时
            整块连标签一起不渲染 —— 留一排灰按钮等于告诉用户「这里本来有 AI」，
            而他要的是「这里没有 AI」。 */}
        {aiVisible ? (
          <>
            <p className="nv-ctxmenu__label">文本变换</p>
            <div className="nv-ctxmenu__types">
              <Button
                role="menuitem"
                className="nv-ctxmenu__item"
                onClick={onPolish}
                disabled={!aiAvailable}
                title={
                  aiAvailable ? "对选中文字做润色，先预览再替换" : aiUnavailableText
                }
              >
                <EditOutlined className="nv-ctxmenu__go" />
                润色这段文字
              </Button>
              {TRANSFORM_KINDS.map((kind) => (
                <Button
                  key={kind}
                  role="menuitem"
                  className="nv-ctxmenu__item"
                  onClick={() => onTransform(kind)}
                  disabled={!aiAvailable}
                  title={
                    aiAvailable
                      ? `对选中文字做「${TRANSFORM_KIND_LABELS[kind]}」，先预览再替换`
                      : aiUnavailableText
                  }
                >
                  <span className="nv-ctxmenu__go">{TRANSFORM_ICONS[kind]}</span>
                  {TRANSFORM_KIND_LABELS[kind]}
                </Button>
              ))}
            </div>
          </>
        ) : null}

        {/* 快捷记账（REQ-027）：一次点击就完成，没有二级选择，
            与下面「先选类型再新建」的层级结构明显不同 */}
        <p className="nv-ctxmenu__label">记入行囊</p>
        <div className="nv-ctxmenu__types">
          <Button
            role="menuitem"
            className="nv-ctxmenu__item"
            onClick={onAddToPack}
            title="把这件东西记进物品栏，来源章节自动填当前章"
          >
            <ImportOutlined className="nv-ctxmenu__go" />
            记入背包
          </Button>
        </div>

        <p className="nv-ctxmenu__label">新建资料卡</p>
        <div className="nv-ctxmenu__types">
          {MARK_TYPE_OPTIONS.map((type) => {
            const meta = metaOf(type);
            return (
              <Button
                key={type}
                role="menuitem"
                className="nv-ctxmenu__item"
                style={{ color: meta.color }}
                onClick={() => onMark(type)}
              >
                <span
                  className="nv-ctxmenu__dot"
                  style={{ background: meta.color }}
                />
                {meta.label}
              </Button>
            );
          })}
        </div>
      </div>
    </>
  );
}
