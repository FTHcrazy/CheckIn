import { Empty } from "antd";
import CompressRow from "../CompressRow";
import type { CompressItem } from "../../image-compress-types";
import "./index.scss";

interface CompressListProps {
  items: CompressItem[];
  onRemove: (id: number) => void;
  onCompare: (id: number) => void;
}

/**
 * 结果列表。
 *
 * 不做虚拟化：参考工具同样是一次性渲染（量级是几十到几百张），
 * 而虚拟化会牺牲「拖进来立刻看到全部缩略图」的直观感。
 */
export default function CompressList({
  items,
  onRemove,
  onCompare,
}: CompressListProps) {
  return (
    <div className="imgc-list">
      {items.length === 0 ? (
        <Empty
          className="imgc-list__empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有图片，先选几张试试"
        />
      ) : (
        <div className="imgc-list__scroll">
          {items.map((item) => (
            <CompressRow
              key={item.id}
              item={item}
              onRemove={onRemove}
              onCompare={onCompare}
            />
          ))}
        </div>
      )}
    </div>
  );
}
