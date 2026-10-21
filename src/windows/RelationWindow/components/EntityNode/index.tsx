/**
 * 画布节点 = 紧凑要素卡（类型 + 名称）+ 四个方向的连线手柄
 *
 * 用户口径（delta v2.2）：图上**只画「类型 + 名称」**，点击后在右侧展开完整资料卡。
 * 刻意不在卡面渲染「一句话 / 境界 / 关联数」：200 个节点同屏时那三行会把 DOM
 * 体积翻倍，而它们在点击后的详情卡里一次看全。
 *
 * S3 起卡片四边各挂一个 `source` 手柄（上 / 右 / 下 / 左）。手柄**默认隐藏**，
 * 悬停卡片或正在连线时才浮现（见 index.scss）：200 张卡同屏时若手柄常驻，
 * 画布会变成一屏小圆点，主次全乱。
 *
 * 为什么四个手柄都是 `source`（而不是左 target + 右 source）：
 * 画布用 `ConnectionMode.Loose`，松散模式下「从哪个手柄起拖」就是 source、
 * 「松在哪个手柄上」就是 target —— 四边都能起、四边都能落，方向语义由起/落点
 * 决定，`onConnect` 拿到的是干净的 `source/target`，链路无需改动。
 * （若留一个 target 手柄，用户从它起拖时方向会被 React Flow 反置，语义就乱了。）
 *
 * 为什么卡面不是组件库 `Button`（AGENTS §6.1.2 的例外）：这张卡是**画布图形**，
 * 交互（点选、拖拽、键盘可达、焦点环）全部由 React Flow 的 node wrapper 提供，
 * 卡面本身不承载任何点击语义 —— 套一层 `Button` 只会得到两个叠在一起的
 * 焦点目标与拖拽阈值冲突。真正属于「控件」的按钮（工具栏 / 池子行 / 详情卡）
 * 一律用组件库组件。
 */
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { RelationGraphNode } from "@/shared/novel/relation-graph";
import { nodeLabelOf, type DensityPlan } from "../../utils/graph-density";
import "./index.scss";

export type EntityNodeData = {
  node: RelationGraphNode;
  /** 类型主色（内置 = CSS 变量，自建 = hex） */
  color: string;
  /** 类型弱色（chip 底） */
  colorWeak: string;
  /** 类型名（角色 / 地点 / 自建类型名） */
  typeLabel: string;
  /** 当前密度档（S4）：只影响「画多少信息」，不影响节点集合 */
  plan: DensityPlan;
};

export type EntityFlowNode = Node<EntityNodeData, "entity">;

/** 四个方向的手柄 id：`onConnect` 的 sourceHandle/targetHandle 会带上它 */
const HANDLES = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
] as const;

function EntityNodeInner({ data, selected, isConnectable }: NodeProps<EntityFlowNode>) {
  const { node, color, colorWeak, typeLabel, plan } = data;
  return (
    <div
      className={`rel-node rel-node--${plan.level}${selected ? " is-selected" : ""}`}
      style={{ ["--rel-node-color" as string]: color }}
      title={node.name}
    >
      {HANDLES.map(({ id, position }) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={position}
          className={`rel-node__handle rel-node__handle--${id}`}
          isConnectable={isConnectable}
        />
      ))}
      {plan.showTypeChip && (
        <span className="rel-node__type" style={{ background: colorWeak, color }}>
          {typeLabel}
        </span>
      )}
      {/* 极简档（>200）：常驻不画字，但**文本仍在 DOM**，悬停/选中由 CSS 放出全名
          —— 用 JS 条件卸载会让「悬停看名字」变成一帧的重渲染，200+ 节点下很贵 */}
      {plan.showName ? (
        <span className="rel-node__name">{nodeLabelOf(node.name, plan)}</span>
      ) : (
        <span className="rel-node__name rel-node__name--on-hover">{node.name}</span>
      )}
    </div>
  );
}

export default memo(EntityNodeInner);
