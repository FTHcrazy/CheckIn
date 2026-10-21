/**
 * 画布节点 = 紧凑要素卡（类型 + 名称）+ 两个连线手柄
 *
 * 用户口径（delta v2.2）：图上**只画「类型 + 名称」**，点击后在右侧展开完整资料卡。
 * 刻意不在卡面渲染「一句话 / 境界 / 关联数」：200 个节点同屏时那三行会把 DOM
 * 体积翻倍，而它们在点击后的详情卡里一次看全。
 *
 * S3 起卡片左右各挂一个 handle（右=出边、左=入边）。手柄**默认隐藏**，
 * 悬停卡片或正在连线时才浮现（见 index.scss）：200 张卡同屏时若手柄常驻，
 * 画布会变成一屏小圆点，主次全乱。
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

function EntityNodeInner({ data, selected, isConnectable }: NodeProps<EntityFlowNode>) {
  const { node, color, colorWeak, typeLabel, plan } = data;
  return (
    <div
      className={`rel-node rel-node--${plan.level}${selected ? " is-selected" : ""}`}
      style={{ ["--rel-node-color" as string]: color }}
      title={node.name}
    >
      {/* 入边（左）/ 出边（右）：无向展示、有向入参（数据层 from→to 有方向） */}
      <Handle
        type="target"
        position={Position.Left}
        className="rel-node__handle rel-node__handle--in"
        isConnectable={isConnectable}
      />
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
      <Handle
        type="source"
        position={Position.Right}
        className="rel-node__handle rel-node__handle--out"
        isConnectable={isConnectable}
      />
    </div>
  );
}

export default memo(EntityNodeInner);
