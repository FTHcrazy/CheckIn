/**
 * 全局设定中心 · 等级批量工具条（R10）
 *
 * 勾选等级行后出现：「已选 N 项」+「删除所选」+「清空选择」。
 *
 * Q-C3：批量删除**要**二次确认（破坏性且无撤销），文案
 * 「删除所选 N 个等级？删除后阶梯会自动重新编号。」
 * 确认框走 `Modal.useModal()` 的**实例方法**并自持 `contextHolder` —— 静态方法
 * 会脱离 ConfigProvider，拿不到 `cssVar` 主题变量，暗色主题下会掉色。
 *
 * ⚠️ 删除必须**串行**执行，且全部结束后**只 `reload()` 一次**（不是每条一重载）——
 * 串行是因为主进程按 rank 重排，两条并发会互相覆盖；只重载一次是因为每删一条
 * 都整表重载会把 N 次 IPC 变成 2N 次。
 */

import { DeleteOutlined } from "@ant-design/icons";
import { Button, Modal } from "antd";
import "./index.scss";

export interface GsLevelBatchBarProps {
  count: number;
  onDeleteSelected: () => void;
  onClear: () => void;
}

export default function GsLevelBatchBar({
  count,
  onDeleteSelected,
  onClear,
}: GsLevelBatchBarProps) {
  const [modal, contextHolder] = Modal.useModal();

  const confirmDelete = (): void => {
    modal.confirm({
      title: `删除所选 ${count} 个等级？`,
      content: "删除后阶梯会自动重新编号。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => onDeleteSelected(),
    });
  };

  return (
    <div className="gs-batch">
      {contextHolder}
      <span className="gs-batch__count">已选 {count} 项</span>
      <span className="gs-batch__spacer" />
      <Button size="small" onClick={onClear}>
        清空选择
      </Button>
      <Button size="small" danger onClick={confirmDelete}>
        <DeleteOutlined />
        删除所选
      </Button>
    </div>
  );
}
