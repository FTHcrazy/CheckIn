import { Button, Spin, Tag, Tooltip } from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { formatBytes, outputNameOf, savedPercent } from "../../image-compress-utils";
import { downloadItem } from "../../image-export";
import type { CompressItem } from "../../image-compress-types";
import "./index.scss";

interface CompressRowProps {
  item: CompressItem;
  onRemove: (id: number) => void;
  onCompare: (id: number) => void;
}

/** 体积变化标签：压小了报绿、原样保留报灰、目标体积没达到报橙 */
function SizeBadge({ item }: { item: CompressItem }) {
  if (item.status === "working" || item.status === "pending") {
    return <Spin size="small" />;
  }
  if (item.status === "error") {
    return (
      <Tooltip title={item.error}>
        <Tag color="error">失败</Tag>
      </Tooltip>
    );
  }
  if (item.passthrough) return <Tag>原样保留</Tag>;
  if (item.oversize) return <Tag color="warning">仍超标</Tag>;
  const percent = savedPercent(item.origSize, item.outSize);
  // 换格式后体积反而变大是合法的（例如 PNG 转 JPEG 但原图本就是小 JPEG），
  // 这时不能显示成「-(-5)%」
  if (percent < 0) return <Tag color="warning">+{Math.abs(percent)}%</Tag>;
  if (percent === 0) return <Tag>0%</Tag>;
  return <Tag color="success">-{percent}%</Tag>;
}

export default function CompressRow({ item, onRemove, onCompare }: CompressRowProps) {
  const done = item.status === "done";
  const dimension =
    item.origWidth > 0 ? `${item.origWidth}×${item.origHeight}` : "读取中";

  return (
    <div className="imgc-row">
      <img className="imgc-row__thumb" src={item.previewUrl} alt="" />

      <div className="imgc-row__main">
        <Tooltip title={item.name}>
          <span className="imgc-row__name">{item.name}</span>
        </Tooltip>
        <span className="imgc-row__meta">
          {dimension}
          {done ? ` · ${item.outType.replace("image/", "").toUpperCase()}` : ""}
          {done && item.applied ? ` · ${item.applied}` : ""}
        </span>
      </div>

      <div className="imgc-row__sizes">
        <span className="imgc-row__size">{formatBytes(item.origSize)}</span>
        <span className="imgc-row__arrow">→</span>
        <span className="imgc-row__size imgc-row__size--out">
          {done ? formatBytes(item.outSize) : "—"}
        </span>
      </div>

      <div className="imgc-row__badge">
        <SizeBadge item={item} />
      </div>

      <div className="imgc-row__actions">
        <Tooltip title={done ? "对比原图与结果" : "压缩完成后可对比"}>
          <Button
            type="text"
            size="small"
            icon={<SwapOutlined />}
            disabled={!done}
            onClick={() => onCompare(item.id)}
          />
        </Tooltip>
        <Tooltip title={done ? `下载 ${outputNameOf(item)}` : "压缩完成后可下载"}>
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            disabled={!done}
            onClick={() => downloadItem(item, outputNameOf(item))}
          />
        </Tooltip>
        <Tooltip title="移除">
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => onRemove(item.id)}
          />
        </Tooltip>
      </div>
    </div>
  );
}
