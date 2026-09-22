import { PlusOutlined } from "@ant-design/icons";
import "./index.scss";

interface LedgerFabProps {
  onClick: () => void;
}

/** ＋ 记一笔（右下角常驻主操作） */
export default function LedgerFab({ onClick }: LedgerFabProps) {
  return (
    <button type="button" className="ld-fab" onClick={onClick} aria-label="记一笔">
      <PlusOutlined />
      记一笔
    </button>
  );
}
