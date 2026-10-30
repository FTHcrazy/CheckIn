/**
 * 池子 → 画布的拖拽负载类型（唯一事实源）
 *
 * 单独成文件而不是放在 `EntityPool/index.tsx`：行组件 `PoolRow` 也要用它，
 * 从 `index` 取会形成「池子 → 行 → 池子」的循环 import（常量在行组件里虽只
 * 在事件回调中读取、暂时不会踩 TDZ，但这种依赖方向本身就不该存在）。
 */
export const REL_NODE_DND_TYPE = "application/x-rel-graph-node";
