/**
 * 池子里的单行要素（S2 / S4）
 *
 * 单独成组件而不是内联在 `EntityPool` 的 map 里：行内需要「点选 / 拖出 / 上图或移出」
 * 三种意图，键盘导航的回调要一路透传；内联写法会让池子组件同时承担列表渲染与
 * 行级交互，且 `onKeyDown` 里读容器的 ref 会被 React 编译器的 ref 规则判为
 * 「渲染期读 ref」。
 *
 * 行本身仍是 antd `Button`（键盘可达 / focus 环 / 禁用语义），外观在
 * `index.scss` 里用清零点 mixin 重绘。
 */
import { Button, Tooltip } from "antd";
import { MinusCircleOutlined, PlusCircleOutlined } from "@ant-design/icons";
import type { KeyboardEvent } from "react";
import type { RelationGraphNode } from "@/shared/novel/relation-graph";
import { REL_NODE_DND_TYPE } from "../../dnd";
import "./index.scss";

export interface PoolRowProps {
  node: RelationGraphNode;
  /** 类型显示名，用于 title（「角色 · 林晚」） */
  typeLabel: string;
  selected: boolean;
  onSelect: (nodeId: string) => void;
  onAdd: (nodeId: string) => void;
  onRemove: (nodeId: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, node: RelationGraphNode) => void;
}

export default function PoolRow({
  node,
  typeLabel,
  selected,
  onSelect,
  onAdd,
  onRemove,
  onKeyDown,
}: PoolRowProps) {
  return (
    <li className="rel-pool__row">
      <Button
        type="text"
        block
        draggable
        className={`rel-pool__item${selected ? " is-selected" : ""}${
          node.linked ? "" : " is-off"
        }`}
        // 方向键导航只认这一个锚点（行尾按钮保持原生行为，不进循环）
        data-pool-row={node.id}
        onClick={() => onSelect(node.id)}
        onKeyDown={(event) => onKeyDown(event, node)}
        onDragStart={(event) => {
          event.dataTransfer.setData(REL_NODE_DND_TYPE, node.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        title={`${typeLabel} · ${node.name}`}
      >
        <span className="rel-pool__name">{node.name}</span>
        {node.linked ? (
          <span className="rel-pool__state is-on">图上</span>
        ) : node.relationCount > 0 ? (
          <span className="rel-pool__state is-related">有关联</span>
        ) : (
          <span className="rel-pool__state">未上图</span>
        )}
      </Button>

      {node.linked ? (
        <Tooltip title="从画布移出（关系不会删）">
          <Button
            type="text"
            size="small"
            className="rel-pool__act"
            aria-label={`把「${node.name}」从画布移出`}
            icon={<MinusCircleOutlined />}
            onClick={() => onRemove(node.id)}
          />
        </Tooltip>
      ) : (
        <Tooltip title="放到画布上">
          <Button
            type="text"
            size="small"
            className="rel-pool__act"
            aria-label={`把「${node.name}」放到画布上`}
            icon={<PlusCircleOutlined />}
            onClick={() => onAdd(node.id)}
          />
        </Tooltip>
      )}
    </li>
  );
}
