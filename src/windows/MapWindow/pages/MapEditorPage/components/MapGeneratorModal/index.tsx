/**
 * 一键成图弹层（B3 / R-MAP-21）。
 *
 * 纯展示 + 参数收集：预设 / 丰度 / 档位 / 大陆形状 / 大陆底色 / 要素大小 /
 * 生成内容 / 山体 / 河流 / 两个开关，加一段结果摘要与五档重掷按钮。全部写操作
 * 转给 `onGenerate`（`useMapEditor.generateFullMap`），组件不碰 store ——
 * 与 MapLibraryModal 同一条边界。
 *
 * 【面板结构对齐逆向目标（架空大陆自动生成器）】影响渲染结果的控制已按参考
 * 面板的语义与措辞落位：
 *   · 大陆形状：正常 / 多陆地 / 多海洋 / 南北 / 东西 / 星月 / 狭长 / 盘古 /
 *     饼干 / 三大洲 / 类地球 / 零散（land.ts 的布局参数）
 *   · 大陆底色：羊皮纸 / 暖沙 / 黄褐 / 灰绿 / 青灰 / 粉灰（烘焙期的陆地填充色）
 *   · 要素大小：正常 / 较小 / 最小（全局素材倍率）
 *   · 生成内容：草地 / 森林 / 沙漠 / 浅海 / 两极冰雪 / 城镇 / 遗迹（按地形组勾选）
 *   · 山体、河流：正常 / 多 / 少 / 无（分族密度）
 * 预设（热门地图）与丰度档是本项目原有的两个维度，参考面板没有对应项，保留。
 *
 * 【为什么不用 Drawer】生成是"弹出来试一下"的低频动作，试完就回画布；
 * 抽屉会把画布挤变形，弹窗盖在上面更贴"试吃"心智。
 */
import { useState } from "react";
import { Button, Checkbox, Modal, Select, Switch, Tooltip } from "antd";
import { PictureOutlined, ReloadOutlined } from "@ant-design/icons";
import { MAP_PRESETS } from "../../domain/mapPresets";
import {
  LAND_BASE_COLORS,
  LAND_SHAPES,
  type LandShapeId,
} from "../../land";
import {
  CONTENT_KEYS,
  CONTENT_LABELS,
  DENSITY_LABELS,
  ELEMENT_SIZE_LABELS,
  RICHNESS_LABELS,
  defaultContents,
  type ContentKey,
  type DensityLevel,
  type GeneratorContents,
  type GeneratorElementSize,
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

const DENSITY_OPTIONS = (Object.keys(DENSITY_LABELS) as DensityLevel[]).map((key) => ({
  value: key,
  label: DENSITY_LABELS[key],
}));

const SIZE_OPTIONS = (Object.keys(ELEMENT_SIZE_LABELS) as GeneratorElementSize[]).map((key) => ({
  value: key,
  label: ELEMENT_SIZE_LABELS[key],
}));

const CONTENT_OPTIONS = CONTENT_KEYS.map((key) => ({
  value: key,
  label: CONTENT_LABELS[key],
}));

const SHAPE_OPTIONS = LAND_SHAPES.map((s) => ({ value: s.id, label: s.label }));

/** 底色选项：色点 + 名称（Select 的 label 是 ReactNode，直接渲染小圆点） */
const COLOR_OPTIONS = LAND_BASE_COLORS.map((c) => ({
  value: c.id,
  label: (
    <span className="map-generator__color-option">
      <span
        aria-hidden
        className="map-generator__color-dot"
        style={{ backgroundColor: `#${c.color.toString(16).padStart(6, "0")}` }}
      />
      {c.label}
    </span>
  ),
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
  // 以下三组对齐逆向目标的面板默认值：内容全勾、山体/河流正常、要素大小正常
  const [contents, setContents] = useState<GeneratorContents>(defaultContents);
  const [mountainDensity, setMountainDensity] = useState<DensityLevel>("normal");
  const [riverDensity, setRiverDensity] = useState<DensityLevel>("normal");
  const [elementSize, setElementSize] = useState<GeneratorElementSize>("normal");
  // 大陆形状 / 底色（2.41.0 对齐参考面板）：缺省 = 现状行为
  const [shapeId, setShapeId] = useState<LandShapeId>("normal");
  const [landColorId, setLandColorId] = useState<string>("parchment");

  const currentParams = (): GeneratorParams => ({
    presetId,
    richness,
    mode,
    contents,
    mountainDensity,
    riverDensity,
    elementSize,
    shapeId,
    landColorId,
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
      width={520}
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

        {/*
          分族密度（逆向目标的「山体」「河流」）：只改该族的配方份额，
          份额腾出来的部分归一化分给别的族 —— 图不会因此变稀。
        */}
        <div className="map-generator__row">
          <span className="map-generator__label">山体</span>
          <Select
            className="map-generator__control"
            size="small"
            aria-label="山体"
            value={mountainDensity}
            options={DENSITY_OPTIONS}
            onChange={setMountainDensity}
          />
          <span className="map-generator__label map-generator__label--gap">河流</span>
          <Select
            className="map-generator__control map-generator__control--narrow"
            size="small"
            aria-label="河流"
            value={riverDensity}
            options={DENSITY_OPTIONS}
            onChange={setRiverDensity}
          />
        </div>

        <div className="map-generator__row">
          <span className="map-generator__label">大陆形状</span>
          <Select
            className="map-generator__control"
            size="small"
            aria-label="大陆形状"
            value={shapeId}
            options={SHAPE_OPTIONS}
            onChange={setShapeId}
          />
          <span className="map-generator__label map-generator__label--gap">大陆底色</span>
          <Select
            className="map-generator__control map-generator__control--narrow"
            size="small"
            aria-label="大陆底色"
            value={landColorId}
            options={COLOR_OPTIONS}
            onChange={setLandColorId}
          />
        </div>

        <div className="map-generator__row">
          <span className="map-generator__label">要素大小</span>
          <Select
            className="map-generator__control"
            size="small"
            aria-label="要素大小"
            value={elementSize}
            options={SIZE_OPTIONS}
            onChange={setElementSize}
          />
        </div>

        {/*
          生成内容（按地形组勾选）。默认全勾 = 与 2.39.0 叠加一致；
          全不勾时生成器只出陆地（与"骨架"同一条出口），不会崩。
        */}
        <div className="map-generator__row map-generator__row--wrap">
          <span className="map-generator__label">生成内容</span>
          <Checkbox.Group
            className="map-generator__contents"
            value={CONTENT_KEYS.filter((key) => contents[key])}
            options={CONTENT_OPTIONS}
            onChange={(values) => {
              const picked = new Set(values as ContentKey[]);
              setContents(
                CONTENT_KEYS.reduce(
                  (acc, key) => ({ ...acc, [key]: picked.has(key) }),
                  {} as GeneratorContents,
                ),
              );
            }}
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
