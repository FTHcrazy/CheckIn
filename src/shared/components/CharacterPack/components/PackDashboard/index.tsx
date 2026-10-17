import { Button, Switch, Tooltip } from "antd";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { attrSegments, formatAttrValue, statText } from "../../pack-utils";
import {
  dashboardActiveStatuses,
  dashboardAttrLimit,
  dashboardSummaryModules,
  moduleSummary,
} from "../../pack-layout";
import { NATURE_META, type PackModuleKey } from "../../types";
import "./index.scss";

interface PackDashboardProps {
  api: PackPanelApi;
  tier: "wide" | "mid" | "narrow";
  /** C 区「展开全部」开关（由宿主持有，跨看板与 L1 保持同一份状态） */
  attrsExpanded: boolean;
  onToggleAttrs: () => void;
  /**
   * 点摘要行 / 境界卡「调整」：**导航**到该模块。
   *
   * 宿主负责「确保展开 + 滚动定位」；看板不自己翻转折叠 —— 从看板远程收起一个
   * 视口外的模块，画面同样没有反馈，等于「点了没反应」换个方向再犯一次。
   */
  onExpandModule: (key: PackModuleKey) => void;
  /** 当前已展开（非收起）的模块集合，供摘要行的箭头与「已展开」高亮只读展示 */
  expandedKeys: ReadonlySet<PackModuleKey>;
}

/**
 * 行囊 L0 看板（UI-01）
 *
 * 首屏从「十模块编辑器平铺」转为「一屏看懂主角当前状态」的只读看板：
 * - B 境界卡（大读数 + 与实体面板的对照条，点「调整」跳到 L1 直选）
 * - C 核心属性总览（base → final + 增量段，点行开来源明细）
 * - D 生效状态（仅 active，含开关）
 * - E 关键设定摘要行（一行一模块，点击即展开并**滚动到**该模块）
 *
 * 看板只做「看」，编辑能力全部留在 L1（E 区一行即入口）—— 两者职责分开，
 * 但入口一条不缺，满足「能力零删减」。
 *
 * ⚠️ 这里**没有**身份卡。曾经有过一版 A 区「主角身份卡」（首字头像 + 名字 +
 * 境界 chip + 绑定态 + 改动角标），但它与头部 `.cpk-head` 横向概览带**逐项重复**
 * （名字 / 境界 / 绑定态 / 改动计数四样全都一样），两行叠在一起纯属噪音。
 * 头部是设计稿 §8.6.1 钦定的概览带且还多带保存三态与工具，故重复的一方删看板这边；
 * 它唯一独有的「角色首字头像」上移到头部头像位（见 PackHeader）。
 *
 * 看板卡铺 `--app-surface` + `--app-shadow-card`（见 index.scss）：
 * 与 L1 模块壳同档（都比窗口底 `--app-bg` 高一档），靠投影与「只读概览」的角色
 * 与可编辑模块区分。**不要**再用 `--app-surface-elevated`（浮层专用，纯白）——
 * 那会让同一窗口里出现两种卡片重量。
 *
 * ⚠️ 宽档（≥900）四区合成**一条横贯量尺的概览带**（UI-08）：外面只有一个框，
 * 四段之间用发丝线分栏，与下方「只画栏头」的分区工作区形成两级层次。以前是
 * 2×2 四张独立卡，与下面的模块卡同为描边圆角卡片，一屏八张同等重量的卡 ——
 * 视线没有主次，真机反馈的「上半和下半割裂」正是这么来的。
 */
export default function PackDashboard({
  api,
  tier,
  attrsExpanded,
  onToggleAttrs,
  onExpandModule,
  expandedKeys,
}: PackDashboardProps) {
  const doc = api.doc;
  if (!doc) return null;

  // ── C 核心属性总览 ──
  const orderedRows = api.attrView
    .map((attr) => ({ attr, row: api.summary.byAttr.get(attr.id) }))
    .filter((entry) => Boolean(entry.row));
  const limit = dashboardAttrLimit(tier);
  const visibleRows = attrsExpanded ? orderedRows : orderedRows.slice(0, limit);
  const hiddenCount = orderedRows.length - visibleRows.length;

  // ── D 生效状态 ──
  const activeStatuses = dashboardActiveStatuses(api.statusModifiers);

  // ── E 关键设定摘要行 ──
  const summaryModules = dashboardSummaryModules(api.enabledModules);

  /* ── B 境界卡 ──（完整直选能力在 L1 的 RealmModule，UI-02；这里给一条
      只读大读数 + 「调整」入口，避免「看板看不到境界」） */
  const realmCard = (
    <section className="cpk-board__card cpk-board__realm" aria-label="境界">
      <div className="cpk-board__rowhead">
        <span className="cpk-board__rowtitle">境界</span>
        {api.rungs.length > 0 ? (
          /*
            恒为「调整」，**不再出现「收起」**：这张卡本身没有任何可收起的内容，
            旧版按展开态切成的「收起」切的是下方 L1 的境界模块 —— 视口外的东西，
            点完卡面毫无变化，观感是「这颗按钮没用」（实测报障）。
            收起交给 L1 模块壳自己的折叠按钮。
          */
          <Button
            size="small"
            className="cpk-board__entry"
            onClick={() => onExpandModule("realm")}
            title="展开并跳到境界编辑器，直选阶与小层"
          >
            调整
          </Button>
        ) : null}
      </div>
      <div className="cpk-board__realmbig">{api.realmText}</div>
      <div className="cpk-board__mirror">
        <span className="cpk-board__mirrorlabel">实体面板显示</span>
        <span
          className={`cpk-board__mirrorvalue${
            api.panelRealmText !== api.realmText ? " is-diverge" : ""
          }`}
        >
          {api.panelRealmText}
        </span>
        <span className="cpk-board__same">
          {api.panelRealmText === api.realmText ? "同源" : "已分叉"}
        </span>
      </div>
    </section>
  );

  /* ── C 核心属性总览 ── */
  const attrsCard = (
    <section className="cpk-board__card cpk-board__attrs" aria-label="核心属性">
      <div className="cpk-board__rowhead">
        <span className="cpk-board__rowtitle">核心属性</span>
        {orderedRows.length > limit ? (
          <Button
            size="small"
            className="cpk-board__entry"
            onClick={onToggleAttrs}
            title={attrsExpanded ? "只显示前几条" : "显示全部属性"}
          >
            {attrsExpanded ? "收起" : `展开全部（${orderedRows.length}）`}
          </Button>
        ) : null}
      </div>
      {visibleRows.length === 0 ? (
        <p className="cpk-empty">
          {tier === "wide"
            ? "还没有属性，去下方「人物属性」加一条"
            : "还没有属性。到下方「人物属性」套一个模板，或直接加一条。"}
        </p>
      ) : (
        <ul className="cpk-board__attrlist">
          {visibleRows.map(({ attr, row }) => {
            if (!row) return null;
            const parts = attrSegments(row, attr.decimals ?? 0);
            return (
              <li key={attr.id}>
                <Button
                  className="cpk-board__attrrow"
                  onClick={() => api.setDetailAttrId(attr.id)}
                  title="查看这项属性的来源明细"
                >
                  <span className="cpk-board__attrname">{attr.name}</span>
                  <span className="cpk-board__attrcalc">
                    <span className="cpk-board__num">
                      {formatAttrValue(row.base, attr.decimals)}
                    </span>
                    <span className="cpk-board__arrow">→</span>
                    <span className="cpk-board__num is-final">
                      {formatAttrValue(row.final, attr.decimals)}
                      {attr.unit ? <em className="cpk-board__unit">{attr.unit}</em> : null}
                    </span>
                  </span>
                  <span className="cpk-board__seg">
                    {parts.length === 0 ? (
                      <span className="cpk-board__none">无加成</span>
                    ) : (
                      parts.map((part, index) => (
                        <em key={index} className={`cpk-seg is-${part.tone}`}>
                          {part.text}
                        </em>
                      ))
                    )}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {!attrsExpanded && hiddenCount > 0 ? (
        <p className="cpk-board__more">还有 {hiddenCount} 项，点「展开全部」查看</p>
      ) : null}
    </section>
  );

  /* ── D 生效状态 ── */
  const statusCard = (
    <section className="cpk-board__card cpk-board__status" aria-label="生效状态">
      <div className="cpk-board__rowhead">
        <span className="cpk-board__rowtitle">生效状态</span>
        <span className="cpk-board__count">{activeStatuses.length} 项</span>
      </div>
      {activeStatuses.length === 0 ? (
        <p className="cpk-empty">
          {tier === "wide"
            ? "当前没有生效中的状态"
            : "当前没有生效中的状态。中毒、增益这类效果在下方「状态效果」里配置。"}
        </p>
      ) : (
        <ul className="cpk-board__statuslist">
          {activeStatuses.map((mod) => {
            const attr = api.attrView.find((candidate) => candidate.id === mod.targetAttrId);
            return (
              <li key={mod.id} className={`cpk-board__statusrow is-${mod.nature}`}>
                <Switch
                  size="small"
                  className="cpk-sw2"
                  checked={mod.active}
                  onChange={() => api.toggleModifierActive(mod.id)}
                  title="关闭后不再计入总属性"
                />
                <span className="cpk-board__statusname">{mod.name || "未命名状态"}</span>
                <span className={`cpk-bdg is-${mod.nature}`} title={NATURE_META[mod.nature].hint}>
                  {NATURE_META[mod.nature].badge}
                </span>
                <span className="cpk-board__statusval">
                  {attr ? statText(mod, api.attrView) : "未选择属性"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  /* ── E 关键设定摘要行 ── */
  const modulesCard = (
    <section className="cpk-board__card cpk-board__modules" aria-label="关键设定">
      <div className="cpk-board__rowhead">
        <span className="cpk-board__rowtitle">关键设定</span>
        <Tooltip title="增减启用模块、调整顺序">
          <Button
            size="small"
            className="cpk-board__entry"
            onClick={() => api.setModuleManagerOpen(true)}
          >
            模块管理
          </Button>
        </Tooltip>
      </div>
      <ul className="cpk-board__modlist">
        {summaryModules.map((module) => {
          const expanded = expandedKeys.has(module.key);
          return (
            <li key={module.key}>
              <Button
                className={`cpk-board__modrow${expanded ? " is-open" : ""}`}
                onClick={() => onExpandModule(module.key)}
                title={
                  expanded ? "该模块已在下方展开 · 点这里跳过去" : "展开该模块并跳过去"
                }
                aria-expanded={expanded}
              >
                <span className="cpk-board__modlabel">{moduleLabel(module.key)}</span>
                <span className="cpk-board__modsum">{moduleSummary(module.key, doc)}</span>
                <span className="cpk-board__modarrow" aria-hidden>
                  {expanded ? <DownOutlined /> : <RightOutlined />}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );

  /*
    宽档：两列包装只在中窄档承担「分堆」；宽档由样式表 `display: contents`
    把它们退场，四张卡直接成为概览带的四段（见 index.scss）。
    中窄档两列退回单列纵向流 —— DOM 顺序即视觉顺序，所以仍按 B → C → D → E 排，
    不能把「右列」整体挪到后面（那样中窄档的顺序会变成 B、C、D、E 之外的乱序）。
  */
  return (
    <div className={`cpk-board cpk-board--${tier}`} aria-label="主角信息看板">
      <div className="cpk-board__col">
        {realmCard}
        {attrsCard}
      </div>
      <div className="cpk-board__col">
        {statusCard}
        {modulesCard}
      </div>
    </div>
  );
}
