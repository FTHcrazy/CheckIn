import { useState } from "react";
import { Modal, Slider } from "antd";
import { formatBytes } from "../../image-compress-utils";
import type { CompressItem } from "../../image-compress-types";
import "./index.scss";

interface CompressCompareModalProps {
  open: boolean;
  item: CompressItem | null;
  onClose: () => void;
}

/**
 * 对比弹窗：拖动分割线擦除前后两张图。
 *
 * 两张图叠加显示（后图用 `clip-path: inset` 裁切）而不是并排，
 * 因为压缩最容易看出来的问题是色带与噪点，只有同位置叠着才能一眼分辨。
 */
export default function CompressCompareModal({
  open,
  item,
  onClose,
}: CompressCompareModalProps) {
  const [split, setSplit] = useState(50);

  return (
    <Modal
      title={item ? `对比：${item.name}` : "对比"}
      open={open && item !== null}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnHidden
    >
      {item ? (
        <div className="imgc-compare">
          <div className="imgc-compare__stage">
            <img
              className="imgc-compare__base"
              src={item.previewUrl}
              alt="压缩前"
            />
            <img
              className="imgc-compare__over"
              src={item.resultUrl}
              alt="压缩后"
              style={{ clipPath: `inset(0 0 0 ${split}%)` }}
            />
            <span className="imgc-compare__divider" style={{ left: `${split}%` }} />
          </div>

          <div className="imgc-compare__labels">
            <span>
              压缩前 <b>{formatBytes(item.origSize)}</b>
            </span>
            <span>
              压缩后 <b>{formatBytes(item.outSize)}</b>
            </span>
          </div>

          <Slider
            value={split}
            onChange={setSplit}
            tooltip={{ formatter: (value) => `左侧原图 ${100 - (value ?? 0)}%` }}
          />
          <p className="imgc-compare__hint">
            拖动滑块：分割线左侧是原图，右侧是压缩结果
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
