/**
 * 一键成图弹层（B3 / R-MAP-21）。
 *
 * 纯展示 + 参数收集：预设 / 丰度 / 档位 / 两个开关，加一段结果摘要与
 * 五档重掷按钮。全部写操作转给 `onGenerate`（useMapEditor.generateFullMap），
 * 组件不碰 store —— 与 MapLibraryModal 同一条边界。
 *
 * 【为什么不用 Drawer】生成是"弹出来试一下"的低频动作，试完就回画布；
 * 抽屉会把画布挤变形，弹窗盖在上面更贴"试吃"心智。
 */
import { useState } from "react";
import { Button, Modal, Select, Switch, Tooltip } from "antd";
import { PictureOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  MAP_PRESETS,
} from "../../domain/mapPresets";
import {
  RICHNESS_LABELS,
  type GeneratorGear,
  type GeneratorMode,
  type GeneratorParams,
  type GeneratorRichness,
} from "../../domain/generator";
import "./index.scss";

export interface MapGeneratorModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * 生成 / 重掷（gear 由按钮决定）。返回值是结果摘要文案
   * （useMapEditor.generateFullMap 的返回），弹层据此更新摘要区。
   */
  onGenerate: (params: GeneratorParams, gear: GeneratorGear) => string;
  /** 最近一次生成的摘要（null = 还没生成过） */
  summary: string | null;
  /** 是否已有生成器产物（局部重掷按钮的可用性） */
  hasGenerated: boolean;
  /** 上一次生成的参数（局部重掷沿用它们，弹层内改参数不影响已生成的图） */
  lastParams: GeneratorParams | null;
}

const RICHNESS_OPTIONS = (Object.keys(RICHNESS_LABELS) as GeneratorRichness[]).map((key) => ({
  value: key,
  label: RICHNESS_LABELS[key],
}));

export default function MapGeneratorModal({
  open,
  onClose,
  onGenerate,
  summary,
  hasGenerated,
  lastParams,
}: MapGeneratorModalProps) {
  const [presetId, setPresetId] = useState(MAP_PRESETS[0]?.id ?? "");
  const [richness, setRichness] = useState<GeneratorRichness>("standard");
  // 默认档 = 成图（用户拍板）：一键出去的就是"有山有水有城有名"的图
  const [mode, setMode] = useState<GeneratorMode>("full");
  const [withRegions, setWithRegions] = useState(false);
  const [withLabels, setWithLabels] = useState(true);

  const currentParams = (): GeneratorParams => ({
    presetId,
    richness,
    mode,
    withRegions,
    withLabels,
  });

  /** 局部重掷按钮是否可用：有产物 + 该档位在上一次生成里是打开的 */
  const gearEnabled = (gear: Exclude<GeneratorGear, "all">): boolean => {
    if (!hasGenerated || !lastParams) return false;
    if (lastParams.mode === "skeleton") return gear === "land" || gear === "regions";
    if (gear === "names") return lastParams.withLabels;
    return true;
  };

  return (
    <Modal
      title="一键成图"
      open={open}
      onCancel={onClose}
      width={460}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
        <Button
          key="generate"
          type="primary"
          icon={<PictureOutlined />}
          onClick={() => onGenerate(currentParams(), "all")}
        >
          生成一张
        </Button>,
      ]}
    >
      <div className="map-generator">
        <div className="map-generator__row">
          <span className="map-generator__label">热门地图</span>
          <Select
            className="map-generator__control"
            size="small"
            value={presetId}
            options={MAP_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
            onChange={setPresetId}
          />
        </div>
        <div className="map-generator__row">
          <span className="map-generator__label">丰度</span>
          <Select
            className="map-generator__control"
            size="small"
            value={richness}
            options={RICHNESS_OPTIONS}
            onChange={setRichness}
          />
          <span className="map-generator__label map-generator__label--gap">档位</span>
          <Select
            className="map-generator__control map-generator__control--narrow"
            size="small"
            value={mode}
            options={[
              { value: "full", label: "成图" },
              { value: "skeleton", label: "骨架" },
            ]}
            onChange={setMode}
          />
        </div>
        <div className="map-generator__row">
          <span className="map-generator__label">含地名</span>
          <Switch
            size="small"
            aria-label="含地名"
            checked={withLabels}
            disabled={mode === "skeleton"}
            onChange={setWithLabels}
          />
          <span className="map-generator__label map-generator__label--gap">划分区块</span>
          <Switch
            size="small"
            aria-label="划分区块"
            checked={withRegions}
            onChange={setWithRegions}
          />
        </div>

        {/*
          结果摘要 + 五档重掷（review §5.3）：生成完不把用户扔回工具栏，
          就地给「换一张」与局部重掷 —— 不满意哪块换哪块。
        */}
        <div className="map-generator__result">
          <div className="map-generator__summary">
            {summary ?? "选好配方点「生成一张」——同一次生成的结果可用 seed 复现。"}
          </div>
          <div className="map-generator__gears">
            <Tooltip title="同参数换一版全新的（新 seed）">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                disabled={!hasGenerated}
                onClick={() => onGenerate(currentParams(), "all")}
              >
                换一张
              </Button>
            </Tooltip>
            <Button
              size="small"
              disabled={!gearEnabled("land")}
              onClick={() => onGenerate(lastParams!, "land")}
            >
              只换陆地
            </Button>
            <Button
              size="small"
              disabled={!gearEnabled("sprites")}
              onClick={() => onGenerate(lastParams!, "sprites")}
            >
              只换素材
            </Button>
            <Button
              size="small"
              disabled={!gearEnabled("names")}
              onClick={() => onGenerate(lastParams!, "names")}
            >
              只换地名
            </Button>
            <Button
              size="small"
              disabled={!gearEnabled("regions")}
              onClick={() => onGenerate(lastParams!, "regions")}
            >
              只换分区
            </Button>
          </div>
          <div className="map-generator__hint">
            生成会替换画布内容（可撤销）；素材 / 地名也可以生成后在画布上继续手调。
          </div>
        </div>
      </div>
    </Modal>
  );
}
