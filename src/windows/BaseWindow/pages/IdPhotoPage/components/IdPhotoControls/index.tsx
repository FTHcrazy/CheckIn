import { useState } from "react";
import {
  Button,
  ColorPicker,
  InputNumber,
  Segmented,
  Slider,
  Tag,
  Tooltip,
  Upload,
} from "antd";
import {
  DownloadOutlined,
  FileImageOutlined,
  ReloadOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type { IdPhotoOptions, MatteStats, PhotoImageInfo } from "../../id-photo-types";
import {
  BACKDROP_PRESETS,
  DEFAULT_OPTIONS,
  PHOTO_SIZE_PRESETS,
} from "../../id-photo-types";
import { clampDimension, normalizeHex } from "../../id-photo-utils";
import "./index.scss";

interface IdPhotoControlsProps {
  options: IdPhotoOptions;
  image: PhotoImageInfo | null;
  stats: MatteStats | null;
  /** 边界主色是否够纯（不够纯时自动抠图不可靠，需要提示） */
  backdropReliable: boolean;
  onPatch: (patch: Partial<IdPhotoOptions>) => void;
  onSelectFile: (file: File) => void;
  onReset: () => void;
  onExport: () => Promise<boolean>;
  onExportTransparent: () => Promise<boolean>;
}

const RENDER_OPTIONS = [
  { label: "纯色", value: "solid" },
  { label: "上下渐变", value: "gradient-y" },
  { label: "中心渐变", value: "gradient-radial" },
];

const FIT_OPTIONS = [
  { label: "适应", value: "contain" },
  { label: "裁切", value: "cover" },
];

/** 构图快捷键：等价于把锚点直接拖到两端或中间 */
const OFFSET_SHORTCUTS = [
  { label: "靠上", offsetY: -1 },
  { label: "居中", offsetY: 0 },
  { label: "靠下", offsetY: 1 },
];

/** 尺寸输入框：失焦或回车时才夹到合法区间，输入过程中不打断用户 */
function DimensionInput({
  value,
  label,
  onChange,
  onCommit,
}: {
  value: number;
  label: string;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className="idp-controls__dimension">
      <span className="idp-controls__dimension-label">{label}</span>
      <InputNumber
        size="small"
        min={1}
        max={4000}
        step={1}
        value={value}
        onChange={(next) => {
          if (typeof next === "number" && Number.isFinite(next)) {
            onChange(Math.round(next));
          }
        }}
        onBlur={onCommit}
        onPressEnter={onCommit}
      />
    </label>
  );
}

export default function IdPhotoControls({
  options,
  image,
  stats,
  backdropReliable,
  onPatch,
  onSelectFile,
  onReset,
  onExport,
  onExportTransparent,
}: IdPhotoControlsProps) {
  const [exporting, setExporting] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);

  const activePreset = PHOTO_SIZE_PRESETS.find(
    (preset) => preset.width === options.width && preset.height === options.height,
  );
  const activeBackdrop = normalizeHex(options.backdrop);
  const dpiWarning = options.dpi < 300;

  const runExport = (task: () => Promise<boolean>, setBusy: (busy: boolean) => void) => {
    setBusy(true);
    void task()
      .catch(() => false)
      .finally(() => setBusy(false));
  };

  return (
    <aside className="idp-controls">
      {/* 滚动区与底部导出区分离：控制栏内容比可视区高，sticky 压不住最后一段 */}
      <div className="idp-controls__scroll">
        <Upload
          accept="image/*"
          showUploadList={false}
          className="idp-controls__pick"
          beforeUpload={(file) => {
            onSelectFile(file);
            // 本地处理，不进 antd 上传队列
            return false;
          }}
        >
          <Button icon={<UploadOutlined />} block>
            选择照片
          </Button>
        </Upload>

      <div className="idp-controls__meta">
        {image ? (
          <>
            <Tooltip title={image.name}>
              <span className="idp-controls__name">{image.name}</span>
            </Tooltip>
            <span className="idp-controls__size">
              {image.width}×{image.height} px
            </span>
          </>
        ) : (
          <span className="idp-controls__size">还没有照片</span>
        )}
      </div>

      <div className="idp-controls__group">
        <span className="idp-controls__label">
          成品尺寸
          <Tooltip title="像素尺寸按 300 DPI 换算；打印店的毫米尺寸就是这些档位">
            <span className="idp-controls__help">?</span>
          </Tooltip>
          <span className="idp-controls__value">
            {options.width}×{options.height}
          </span>
        </span>
        <div className="idp-controls__presets">
          {PHOTO_SIZE_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              className={`idp-controls__preset${
                activePreset?.key === preset.key ? " is-active" : ""
              }`}
              onClick={() =>
                onPatch({ width: preset.width, height: preset.height })
              }
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="idp-controls__dimensions">
          <DimensionInput
            label="宽"
            value={options.width}
            onChange={(value) => onPatch({ width: value })}
            onCommit={() =>
              onPatch({ width: clampDimension(options.width, DEFAULT_OPTIONS.width) })
            }
          />
          <DimensionInput
            label="高"
            value={options.height}
            onChange={(value) => onPatch({ height: value })}
            onCommit={() =>
              onPatch({
                height: clampDimension(options.height, DEFAULT_OPTIONS.height),
              })
            }
          />
        </div>
        <Button
          className="idp-controls__link"
          size="small"
          type="link"
          disabled={!image}
          onClick={() => {
            if (!image) return;
            onPatch({
              width: clampDimension(image.width, DEFAULT_OPTIONS.width),
              height: clampDimension(image.height, DEFAULT_OPTIONS.height),
            });
          }}
        >
          用原图尺寸（{image ? `${image.width}×${image.height}` : "—"}）
        </Button>
      </div>

      <div className="idp-controls__group">
        <span className="idp-controls__label">
          构图
          <Tooltip title="「裁切」会放大人像铺满画框，超出部分被裁掉。按住左侧成品图直接拖动，可以自己决定留下哪一段">
            <span className="idp-controls__help">?</span>
          </Tooltip>
          <Button
            className="idp-controls__reset-offset"
            type="link"
            size="small"
            disabled={!image || (options.offsetX === 0 && options.offsetY === 0)}
            onClick={() => onPatch({ offsetX: 0, offsetY: 0 })}
          >
            复位
          </Button>
        </span>
        <Segmented
          size="small"
          block
          value={options.fit}
          options={FIT_OPTIONS}
          onChange={(value) => onPatch({ fit: value as IdPhotoOptions["fit"] })}
        />
        <div className="idp-controls__presets idp-controls__presets--triple">
          {OFFSET_SHORTCUTS.map((item) => (
            <Button
              key={item.label}
              className={`idp-controls__preset${
                Math.abs(options.offsetY - item.offsetY) < 0.02 ? " is-active" : ""
              }`}
              onClick={() =>
                onPatch({
                  // 快捷键只管上下：横向偏移保留用户的拖动结果
                  offsetY: item.offsetY,
                })
              }
            >
              {item.label}
            </Button>
          ))}
        </div>
        <span className="idp-controls__tip">
          也可以直接在左侧成品图上拖动；换照片后位置会重新居中
        </span>
      </div>

      <div className="idp-controls__group">
        <span className="idp-controls__label">底色</span>
        <div className="idp-controls__swatches">
          {BACKDROP_PRESETS.map((preset) => (
            <Tooltip key={preset.key} title={preset.label}>
              <Button
                className={`idp-controls__swatch${
                  activeBackdrop === normalizeHex(preset.color) ? " is-active" : ""
                }`}
                style={{ background: preset.color }}
                aria-label={preset.label}
                onClick={() => onPatch({ backdrop: preset.color })}
              />
            </Tooltip>
          ))}
          <ColorPicker
            value={options.backdrop}
            disabledAlpha
            onChange={(color) => onPatch({ backdrop: color.toHexString() })}
          />
          <code className="idp-controls__hex">{activeBackdrop}</code>
        </div>
        <Segmented
          size="small"
          block
          value={options.render}
          options={RENDER_OPTIONS}
          onChange={(value) =>
            onPatch({ render: value as IdPhotoOptions["render"] })
          }
        />
      </div>

      <div className="idp-controls__group">
        <span className="idp-controls__label">
          背景容差
          <Tooltip title="从画面四边向内漫水：只抠与边缘连通、且接近边界主色的区域，人像内部的同色部分不会被吃掉">
            <span className="idp-controls__help">?</span>
          </Tooltip>
          <b className="idp-controls__value">{options.tolerance}%</b>
        </span>
        <Slider
          min={0}
          max={40}
          value={options.tolerance}
          tooltip={{ formatter: (value) => `${value}%` }}
          onChange={(value) => onPatch({ tolerance: value })}
        />
        <span className="idp-controls__tip">
          背景有渐变或噪点时调大；调太大边缘会啃进头发
        </span>
      </div>

      <div className="idp-controls__group">
        <span className="idp-controls__label">
          边缘羽化
          <b className="idp-controls__value">{options.feather}px</b>
        </span>
        <Slider
          min={0}
          max={8}
          value={options.feather}
          tooltip={{ formatter: (value) => `${value}px` }}
          onChange={(value) => onPatch({ feather: value })}
        />
        <span className="idp-controls__tip">
          0 = 硬切边缘；1-3px 能消掉换底后的一圈锯齿
        </span>
      </div>

      <div className="idp-controls__group">
        <span className="idp-controls__label">
          去色边
          <Tooltip title="边缘像素是「人像 over 原底色」的混合，按透明度反解出纯前景色，去掉残留的旧底色色环">
            <span className="idp-controls__help">?</span>
          </Tooltip>
          <b className="idp-controls__value">
            {Math.round(options.decontaminate * 100)}%
          </b>
        </span>
        <Slider
          min={0}
          max={100}
          value={Math.round(options.decontaminate * 100)}
          tooltip={{ formatter: (value) => `${value}%` }}
          onChange={(value) => onPatch({ decontaminate: value / 100 })}
        />
        <span className="idp-controls__tip">
          蓝底换白底时最明显；羽化为 0 时不起作用
        </span>
      </div>

      <div className="idp-controls__group">
        <span className="idp-controls__label">
          输出 DPI
          <Tooltip title="写进 JPG 的 JFIF 头，打印店按它换算实际尺寸；证件照通常是 300">
            <span className="idp-controls__help">?</span>
          </Tooltip>
        </span>
        <Segmented
          size="small"
          block
          value={options.dpi}
          options={[72, 150, 300, 600]}
          onChange={(value) => onPatch({ dpi: Number(value) })}
        />
        <span className="idp-controls__tip">
          {dpiWarning
            ? "低于 300 DPI 冲印会偏小，只适合屏幕看"
            : "300 DPI 是证件照冲印的通用值"}
        </span>
      </div>

      <div className="idp-controls__group">
        <span className="idp-controls__label">
          JPG 质量
          <b className="idp-controls__value">
            {Math.round(options.quality * 100)}%
          </b>
        </span>
        <Slider
          min={50}
          max={100}
          value={Math.round(options.quality * 100)}
          tooltip={{ formatter: (value) => `${value}%` }}
          onChange={(value) => onPatch({ quality: value / 100 })}
        />
      </div>

      {stats ? (
        <div className="idp-controls__stats">
          <div className="idp-controls__tags">
            <Tag color={stats.removedRatio > 0 ? "success" : undefined}>
              已抠除 {Math.round(stats.removedRatio * 100)}%
            </Tag>
            {backdropReliable ? null : (
              <Tooltip title="边界颜色太杂，自动抠图可能不干净。建议换一张纯色背景的原图，再手动调容差">
                <Tag color="warning">背景不纯</Tag>
              </Tooltip>
            )}
          </div>
          <span className="idp-controls__tip">
            原背景色 {stats.borderColor}
            {stats.feathered > 0 ? ` · 过渡 ${stats.feathered} px` : ""}
          </span>
        </div>
      ) : null}
      </div>

      <div className="idp-controls__actions">
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          block
          loading={exporting}
          disabled={!image}
          onClick={() => runExport(onExport, setExporting)}
        >
          导出证件照 JPG
        </Button>
        <Button
          icon={<FileImageOutlined />}
          block
          loading={exportingPng}
          disabled={!image}
          onClick={() => runExport(onExportTransparent, setExportingPng)}
        >
          导出透明底 PNG
        </Button>
        <Button icon={<ReloadOutlined />} block onClick={onReset} disabled={!image}>
          恢复默认
        </Button>
      </div>
    </aside>
  );
}
