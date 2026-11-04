import type { ReactNode } from "react";
import { ColorPicker, InputNumber, Select, Slider, Tooltip } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { PNG_MAX_COLORS, PNG_MIN_COLORS } from "../../image-compress-utils";
import type { CompressOptions, OutputFormat } from "../../image-compress-types";
import "./index.scss";

const FORMAT_OPTIONS: Array<{ value: OutputFormat; label: string }> = [
  { value: "auto", label: "保持原格式" },
  { value: "image/png", label: "PNG（无损 / 量化）" },
  { value: "image/jpeg", label: "JPEG（有损）" },
  { value: "image/webp", label: "WebP（有损，体积最小）" },
];

/** 色数档位：0 = 真彩色（只重新 deflate，不改像素） */
const COLOR_OPTIONS = [
  { value: 0, label: "真彩色（无损）" },
  ...[256, 128, 64, 32, 16, 8, 4, 2]
    .filter((value) => value >= PNG_MIN_COLORS && value <= PNG_MAX_COLORS)
    .map((value) => ({ value, label: `${value} 色` })),
];

interface CompressSettingsProps {
  options: CompressOptions;
  onChange: (patch: Partial<CompressOptions>) => void;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="imgc-settings__field">
      <span className="imgc-settings__label">
        {label}
        {hint ? (
          <Tooltip title={hint}>
            <QuestionCircleOutlined className="imgc-settings__help" />
          </Tooltip>
        ) : null}
      </span>
      {children}
    </label>
  );
}

/**
 * 压缩参数面板。
 *
 * 参数直接作用于所有已加入的图片，改动即重跑（store 内部串行排队），
 * 所以这里不放「应用」按钮——多一个按钮就多一次「我改了但没生效」的困惑。
 */
export default function CompressSettings({
  options,
  onChange,
}: CompressSettingsProps) {
  const pngOnly = options.format === "image/png";

  return (
    <div className="imgc-settings">
      <Field label="输出格式" hint="GIF / BMP 等无法保持原格式的图片会自动转成 JPEG">
        <Select
          value={options.format}
          options={FORMAT_OPTIONS}
          onChange={(format) => onChange({ format })}
        />
      </Field>

      <Field
        label="目标体积"
        hint="填了就会二分搜索能压进该体积的最优参数：PNG 降色数、JPEG / WebP 先降质量再缩尺寸。0 = 不限制"
      >
        <InputNumber
          min={0}
          max={51200}
          step={10}
          value={options.targetKb}
          addonAfter="KB"
          style={{ width: "100%" }}
          onChange={(value) => onChange({ targetKb: typeof value === "number" ? value : 0 })}
        />
      </Field>

      <Field
        label="质量"
        hint="仅 JPEG / WebP 生效。PNG 是无损格式，没有质量档，靠下面的色数控制体积"
      >
        <div className="imgc-settings__slider">
          <Slider
            min={10}
            max={100}
            value={options.quality}
            disabled={pngOnly}
            tooltip={{ formatter: (value) => `${value}%` }}
            onChange={(quality) => onChange({ quality })}
          />
          <span className="imgc-settings__value">{options.quality}%</span>
        </div>
      </Field>

      <Field
        label="PNG 色数"
        hint={`调色板量化：${PNG_MAX_COLORS} 色基本无损，色数越低体积越小但会出现色带。真彩色只重新压缩数据流`}
      >
        <Select
          value={options.colors}
          options={COLOR_OPTIONS}
          onChange={(colors) => onChange({ colors })}
        />
      </Field>

      <Field label="最大宽度" hint="等比缩放，只缩不放；0 = 不限制">
        <InputNumber
          min={0}
          max={20000}
          step={100}
          value={options.maxWidth}
          addonAfter="px"
          style={{ width: "100%" }}
          onChange={(value) => onChange({ maxWidth: typeof value === "number" ? value : 0 })}
        />
      </Field>

      <Field label="最大高度" hint="等比缩放，只缩不放；0 = 不限制">
        <InputNumber
          min={0}
          max={20000}
          step={100}
          value={options.maxHeight}
          addonAfter="px"
          style={{ width: "100%" }}
          onChange={(value) => onChange({ maxHeight: typeof value === "number" ? value : 0 })}
        />
      </Field>

      <Field label="JPEG 底色" hint="JPEG 没有透明通道，透明像素会被填成这个颜色">
        <span className="imgc-settings__color">
          <ColorPicker
            value={options.background}
            disabledAlpha
            onChange={(color) => onChange({ background: color.toHexString() })}
          />
          <code className="imgc-settings__hex">{options.background}</code>
        </span>
      </Field>
    </div>
  );
}
