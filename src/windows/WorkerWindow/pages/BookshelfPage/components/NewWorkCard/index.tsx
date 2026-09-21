import { PlusOutlined } from "@ant-design/icons";
import "./index.scss";

interface NewWorkCardProps {
  onCreateClick: () => void;
}

/** 新建作品虚线卡（R32）：书架网格的收尾位，点击弹出命名弹框 */
export default function NewWorkCard({ onCreateClick }: NewWorkCardProps) {
  return (
    <button type="button" className="bs-newcard" onClick={onCreateClick}>
      <span className="bs-newcard__plus" aria-hidden>
        <PlusOutlined />
      </span>
      <span className="bs-newcard__title">新建作品</span>
      <span className="bs-newcard__hint">从一条灵感或大纲开始</span>
    </button>
  );
}
