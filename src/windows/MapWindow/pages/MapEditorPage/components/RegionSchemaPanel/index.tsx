import { Button, Divider, Input, InputNumber, Slider, Tooltip } from "antd";
import { ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import {
  DEFAULT_REGION_SCHEMA,
  REGION_LEVEL_COUNT_LIMITS,
  REGION_TOTAL_LIMIT,
  type RegionLevelDef,
} from "../../regions";
import "./index.scss";

/**
 * 层级配置面板（R-REG-01）—— 工具栏「区块层级」Popover 的内容。
 *
 * 【职责边界】本组件**不读 store、不写文档**：它只把用户的编辑折算成"下一份完整
 * schema"交给 `onChange`，由页面转 `useMapEditor.setRegionSchema`（走快照合并键）。
 * 好处是：
 *   · 面板可以在不接 store 的情况下单测（纯 props）；
 *   · "减少层数要二次确认删区块"这类需要 `modal` 的判断留在页面（弹窗只有一个出处）。
 *
 * 【受控来源】`schema` 是 `regionSchemaOf(doc)` 的结果（读时回落），所以
 * 老文档未配置过时面板显示的就是默认的「大陆/洲/国家/郡」，而不是空表。
 *
 * 【名称为什么用 `defaultValue` + key】PRD §4.1 规定"名称失焦提交"：敲字过程中不该
 * 每次击键都改文档（那会把"一次改名"拆成十几个 doc 版本，虽然快照被合并键压成一步，
 * 但每次击键都要重渲染整页）。`key` 里带上文档里的当前值 ⇒ 值真变了（提交 / 撤销 /
 * 重置）才重挂载。
 */
interface RegionSchemaPanelProps {
  /** 当前有效层级定义（长度即层数） */
  schema: readonly RegionLevelDef[];
  /** 任一字段变化 → 下一份完整 schema（页面负责转 store） */
  onChange: (next: RegionLevelDef[]) => void;
  /** 一次"连续调参"结束（失焦 / 重置）：页面据此断掉快照合并键 */
  onEditEnd: () => void;
  /** 「应用并生成区块」：改完 + 生成，一次动作一次快照 */
  onApplyAndGenerate: () => void;
}

/** 深拷贝一份（面板只产出新对象，绝不改写入参） */
function cloneSchema(schema: readonly RegionLevelDef[]): RegionLevelDef[] {
  return schema.map((def) => ({ name: def.name, count: def.count }));
}

/**
 * 增删层数后的下一份 schema。
 *
 * · 减少：直接截断（被删层级的区块由页面在确认后一并删除）；
 * · 增加：补一行，名称回落 `L{n}`、数量 = 上一级 × 4（PRD §4.1）。
 */
function resizeSchema(
  schema: readonly RegionLevelDef[],
  nextLength: number,
): RegionLevelDef[] {
  const out = cloneSchema(schema.slice(0, Math.max(1, nextLength)));
  while (out.length < nextLength) {
    const prev = out[out.length - 1] ?? DEFAULT_REGION_SCHEMA[out.length];
    out.push({
      name: `L${out.length + 1}`,
      count: Math.max(1, Math.round((prev?.count ?? 1) * 4)),
    });
  }
  return out;
}

export default function RegionSchemaPanel({
  schema,
  onChange,
  onEditEnd,
  onApplyAndGenerate,
}: RegionSchemaPanelProps) {
  /** 合计数量：超上限时标红并禁用「应用并生成区块」 */
  const total = schema.reduce((sum, def) => sum + def.count, 0);
  const overLimit = total > REGION_TOTAL_LIMIT;

  /** 改某一级的名称（失焦 / 回车提交；空串允许，读时回落 `L{n}`） */
  const commitName = (level: number, raw: string) => {
    const name = raw.trim();
    if (name === (schema[level]?.name ?? "")) return;
    onChange(schema.map((def, i) => (i === level ? { ...def, name } : { ...def })));
    // 一次"改名"到此结束：下次编辑应独立成步（架构 §2.4.1 的断键点）
    onEditEnd();
  };

  /** 改某一级的数量（`InputNumber` 即时提交；非法值忽略） */
  const commitCount = (level: number, value: number | null) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const count = Math.max(1, Math.round(value));
    if (count === schema[level]?.count) return;
    onChange(schema.map((def, i) => (i === level ? { ...def, count } : { ...def })));
  };

  return (
    <div className="region-schema-panel">
      <div className="region-schema-panel__row region-schema-panel__row--head">
        <span className="region-schema-panel__label">层数</span>
        <div className="region-schema-panel__depth">
          <Slider
            className="region-schema-panel__slider"
            min={REGION_LEVEL_COUNT_LIMITS.min}
            max={REGION_LEVEL_COUNT_LIMITS.max}
            step={1}
            value={schema.length}
            onChange={(value) => onChange(resizeSchema(schema, value))}
            // 松开滑块才算一次动作结束：拖动过程中的中间值都并进同一步快照
            onChangeComplete={() => onEditEnd()}
          />
          <InputNumber
            className="region-schema-panel__depth-input"
            size="small"
            aria-label="层数"
            min={REGION_LEVEL_COUNT_LIMITS.min}
            max={REGION_LEVEL_COUNT_LIMITS.max}
            step={1}
            value={schema.length}
            onChange={(value) => {
              if (typeof value !== "number" || !Number.isFinite(value)) return;
              const next = Math.max(
                REGION_LEVEL_COUNT_LIMITS.min,
                Math.min(REGION_LEVEL_COUNT_LIMITS.max, Math.round(value)),
              );
              if (next === schema.length) return;
              onChange(resizeSchema(schema, next));
            }}
            onBlur={() => onEditEnd()}
          />
        </div>
      </div>

      <div
        className={
          overLimit
            ? "region-schema-panel__total region-schema-panel__total--over"
            : "region-schema-panel__total"
        }
        aria-label="层级数量合计"
      >
        合计 {total} / 上限 {REGION_TOTAL_LIMIT}
      </div>

      <div className="region-schema-panel__levels">
        {schema.map((def, level) => (
          <div className="region-schema-panel__row" key={`level-${level}`}>
            <span className="region-schema-panel__level-tag">L{level + 1}</span>
            <Input
              className="region-schema-panel__name"
              size="small"
              aria-label={`第 ${level + 1} 级名称`}
              // 值变了（提交 / 撤销 / 重置）才重挂载；见组件头注释
              key={`name-${level}-${def.name}`}
              defaultValue={def.name}
              placeholder={`L${level + 1}`}
              onBlur={(e) => commitName(level, e.target.value)}
              onKeyDown={(e) => {
                // IME 组字中的回车属于输入法（选候选词），不是提交
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitName(level, (e.target as HTMLInputElement).value);
                }
              }}
            />
            <InputNumber
              className="region-schema-panel__count"
              size="small"
              aria-label={`第 ${level + 1} 级数量`}
              min={1}
              step={1}
              value={def.count}
              onChange={(value) => commitCount(level, value)}
            />
          </div>
        ))}
      </div>

      <div className="region-schema-panel__hint">
        修改层级不会重排已生成的区块，只影响下次生成。
      </div>

      <Divider style={{ margin: "8px 0" }} />

      <div className="region-schema-panel__actions">
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => {
            onChange(cloneSchema(DEFAULT_REGION_SCHEMA));
            onEditEnd();
          }}
        >
          重置为默认
        </Button>
        <Tooltip
          title={
            overLimit
              ? `合计 ${total} 超过上限 ${REGION_TOTAL_LIMIT}，请先调小某几级的数量`
              : "按当前层级定义重新生成区块（现有自动区块会被替换，可撤销）"
          }
        >
          <Button
            size="small"
            type="primary"
            icon={<ThunderboltOutlined />}
            disabled={overLimit}
            onClick={onApplyAndGenerate}
          >
            应用并生成区块
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
