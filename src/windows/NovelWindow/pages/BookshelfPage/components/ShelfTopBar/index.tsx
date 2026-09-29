import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Input } from "antd";
import "./index.scss";

interface ShelfTopBarProps {
  workCount: number;
  /** 紧凑字数文案（64.6 万），由页面用 formatWordsCompact 派生 */
  totalWordsText: string;
  keyword: string;
  onKeywordChange: (value: string) => void;
  onCreateClick: () => void;
}

/**
 * 书架顶栏（R32）：书架标题 + 规模胶囊 + 搜索 + 新建作品。
 * 搜索词同时驱动书卡与灵感库过滤（一处输入，两处生效）。
 */
export default function ShelfTopBar({
  workCount,
  totalWordsText,
  keyword,
  onKeywordChange,
  onCreateClick,
}: ShelfTopBarProps) {
  return (
    <div className="bs-topbar">
      <div className="bs-topbar__lead">
        <h1 className="bs-topbar__title">书架</h1>
        <span className="bs-topbar__capsule">
          {workCount} 部作品 · {totalWordsText}字
        </span>
      </div>
      <div className="bs-topbar__actions">
        <Input
          className="bs-topbar__search"
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          placeholder="搜索作品或灵感"
          variant="filled"
          allowClear
          prefix={<SearchOutlined />}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreateClick}>
          新建作品
        </Button>
      </div>
    </div>
  );
}
