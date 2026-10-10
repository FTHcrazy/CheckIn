import { Button } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { ShelfViewMode } from "../ShelfToolbar";
import "./index.scss";

interface NewWorkCardProps {
  onCreateClick: () => void;
  /** 列表视图下渲染成细长虚线条，与书卡的行高对齐 */
  view?: ShelfViewMode;
}

/** 新建作品虚线卡（R32）：书架网格的收尾位，点击弹出命名弹框 */
export default function NewWorkCard({ onCreateClick, view = "grid" }: NewWorkCardProps) {
  return (
    <Button
      className={`bs-newcard${view === "list" ? " bs-newcard--list" : ""}`}
      onClick={onCreateClick}
    >
      <span className="bs-newcard__plus" aria-hidden>
        <PlusOutlined />
      </span>
      <span className="bs-newcard__title">新建作品</span>
      {view === "grid" && (
        <span className="bs-newcard__hint">从一条灵感或大纲开始</span>
      )}
    </Button>
  );
}
