import { Button, Tooltip } from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { formatBytes } from "../../image-compress-utils";
import type { CompressSummary as Summary } from "../../image-compress-types";
import "./index.scss";

interface CompressSummaryProps {
  summary: Summary;
  /** 还在排队 / 处理中的条目数，用于说明「为什么下载不全」 */
  pendingCount: number;
  processing: boolean;
  onRerun: () => void;
  onDownloadAll: () => void;
  onClear: () => void;
}

export default function CompressSummary({
  summary,
  pendingCount,
  processing,
  onRerun,
  onDownloadAll,
  onClear,
}: CompressSummaryProps) {
  const empty = summary.totalCount === 0;

  return (
    <div className="imgc-summary">
      <div className="imgc-summary__stats">
        <span className="imgc-summary__item">
          已完成
          <b>
            {summary.doneCount}/{summary.totalCount}
          </b>
        </span>
        <span className="imgc-summary__item">
          原始
          <b>{formatBytes(summary.origSize)}</b>
        </span>
        <span className="imgc-summary__item">
          输出
          <b>{formatBytes(summary.outSize)}</b>
        </span>
        <span className="imgc-summary__item imgc-summary__item--accent">
          省下
          <b>
            {formatBytes(summary.savedBytes)}
            {summary.origSize > 0 ? `（${summary.savedPercent}%）` : ""}
          </b>
        </span>
      </div>

      <div className="imgc-summary__actions">
        <Tooltip title="按当前参数重新压缩全部图片">
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={processing}
            disabled={empty}
            onClick={onRerun}
          >
            重新压缩
          </Button>
        </Tooltip>
        <Tooltip
          title={
            pendingCount > 0
              ? `还有 ${pendingCount} 张在处理，打包只包含已完成的结果`
              : "把已完成的结果打包成 zip"
          }
        >
          <Button
            size="small"
            type="primary"
            icon={<DownloadOutlined />}
            disabled={summary.doneCount === 0}
            onClick={onDownloadAll}
          >
            全部下载
          </Button>
        </Tooltip>
        <Tooltip title="清空列表">
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={empty}
            onClick={onClear}
          >
            清空
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
