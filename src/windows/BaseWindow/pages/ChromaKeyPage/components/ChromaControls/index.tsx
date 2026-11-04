import { useState } from "react";
import { Button, ColorPicker, Slider, Tag, Tooltip, Upload } from "antd";
import {
  DownloadOutlined,
  ReloadOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  formatRgb,
  hexToRgb,
  rgbToHex,
  type RgbColor,
} from "../../chroma-key-utils";
import type { ChromaImageInfo } from "../../hooks/useChromaKey";
import "./index.scss";

interface ChromaControlsProps {
  keyColor: RgbColor;
  tolerance: number;
  feather: number;
  removed: number;
  image: ChromaImageInfo | null;
  onKeyColor: (color: RgbColor) => void;
  onTolerance: (value: number) => void;
  onFeather: (value: number) => void;
  onSelectFile: (file: File) => void;
  onReset: () => void;
  onExport: () => Promise<boolean>;
}

export default function ChromaControls({
  keyColor,
  tolerance,
  feather,
  removed,
  image,
  onKeyColor,
  onTolerance,
  onFeather,
  onSelectFile,
  onReset,
  onExport,
}: ChromaControlsProps) {
  const [exporting, setExporting] = useState(false);

  const handleExport = () => {
    setExporting(true);
    void onExport()
      .catch(() => false)
      .finally(() => setExporting(false));
  };

  return (
    <aside className="ck-controls">
      <Upload
        accept="image/*"
        showUploadList={false}
        className="ck-controls__pick"
        beforeUpload={(file) => {
          onSelectFile(file);
          // 本地处理，不进 antd 上传队列
          return false;
        }}
      >
        <Button icon={<UploadOutlined />} block>
          选择图片
        </Button>
      </Upload>

      <div className="ck-controls__meta">
        {image ? (
          <>
            <Tooltip title={image.name}>
              <span className="ck-controls__name">{image.name}</span>
            </Tooltip>
            <span className="ck-controls__size">
              {image.width}×{image.height}
            </span>
          </>
        ) : (
          <span className="ck-controls__size">还没有图片</span>
        )}
      </div>

      <div className="ck-controls__group">
        <span className="ck-controls__label">
          色键颜色
          <Tooltip title="直接点击左侧图片上的背景色即可取色；也可以在这里手动选">
            <span className="ck-controls__help">?</span>
          </Tooltip>
        </span>
        <div className="ck-controls__color">
          <ColorPicker
            value={rgbToHex(keyColor)}
            disabledAlpha
            onChange={(color) => {
              const parsed = hexToRgb(color.toHexString());
              if (parsed) onKeyColor(parsed);
            }}
          />
          <Tooltip title={formatRgb(keyColor)}>
            <code className="ck-controls__hex">{rgbToHex(keyColor)}</code>
          </Tooltip>
        </div>
      </div>
      <div className="ck-controls__group">
        <span className="ck-controls__label">
          相似颜色阈值
          <b className="ck-controls__value">{tolerance}%</b>
        </span>
        <Slider
          min={0}
          max={100}
          value={tolerance}
          tooltip={{ formatter: (value) => `${value}%` }}
          onChange={onTolerance}
        />
        <span className="ck-controls__tip">
          越大去掉的颜色越多，也越容易误伤主体；背景越杂需要调得越大
        </span>
      </div>

      <div className="ck-controls__group">
        <span className="ck-controls__label">
          边缘软边
          <b className="ck-controls__value">{feather}%</b>
        </span>
        <Slider
          min={0}
          max={100}
          value={feather}
          tooltip={{ formatter: (value) => `${value}%` }}
          onChange={onFeather}
        />
        <span className="ck-controls__tip">
          0 = 硬切边缘（最快）；调大可让半透明发丝过渡更自然
        </span>
      </div>

      <div className="ck-controls__stats">
        <Tag color={removed > 0 ? "success" : undefined}>
          已抠除 {Math.round(removed * 100)}%
        </Tag>
        <span className="ck-controls__tip">按像素统计，含软边过渡区域不重复计入</span>
      </div>

      <div className="ck-controls__actions">
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          block
          loading={exporting}
          disabled={!image}
          onClick={handleExport}
        >
          导出 PNG
        </Button>
        <Button icon={<ReloadOutlined />} block onClick={onReset} disabled={!image}>
          恢复默认
        </Button>
      </div>
    </aside>
  );
}
