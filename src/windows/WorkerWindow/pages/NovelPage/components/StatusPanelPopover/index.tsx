import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CloseOutlined,
  DownOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { Dropdown, InputNumber, Segmented, Select, Switch, Tooltip } from "antd";
import type { StatusSavePhase } from "../../hooks/useStatusSheet";
import type { StatusSheetController } from "../../hooks/useStatusSheet";
import { computeTotals } from "../../status-totals";
import type {
  StatusBonusMode,
  StatusEntry,
  StatusTotalRow,
} from "../../types";
import StatusFab from "../StatusFab";
import "./index.scss";

const MODE_LABEL: Record<StatusBonusMode, string> = {
  permanent: "永久",
  while_active: "激活时",
};

/** 本浮层内 antd 弹层 portal 的统一类名：点外关闭时豁免 */
const PORTAL_CLASS = "nv-status-portal";

type AttrOption = { label: string; value: string };

function formatClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

interface StatusPanelPopoverProps {
  open: boolean;
  sheet: StatusSheetController;
  /** 再点一次 FAB 收起 */
  onToggle: () => void;
  onClose: () => void;
}

/**
 * R2 属性面板浮层：贴身无遮罩，锚定 FAB 上方弹出，正文全程可见可编辑。
 * 分组由模板驱动（M1 为 mock 数据），点外 / Esc / 再点 FAB 收起，收起前 flush。
 */
export default function StatusPanelPopover({
  open,
  sheet,
  onToggle,
  onClose,
}: StatusPanelPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeGroupId, setActiveGroupId] = useState("");
  const [sumOpen, setSumOpen] = useState(false);

  const groups = sheet.content.groups;
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0];

  // 分组集合变化（新增）时兜底回落到有效分组
  useEffect(() => {
    if (activeGroup && activeGroup.id !== activeGroupId) {
      setActiveGroupId(activeGroup.id);
    }
  }, [activeGroup, activeGroupId]);

  const handleClose = useCallback(() => {
    sheet.flushNow();
    onClose();
  }, [sheet, onClose]);

  // 点外关闭 + Esc 关闭；本浮层的 antd 弹层 portal（下拉菜单）不算「外部」
  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (rootRef.current?.contains(target)) return;
      if (target.closest(`.${PORTAL_CLASS}`)) return;
      handleClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, handleClose]);

  const totals = useMemo(() => computeTotals(sheet.content), [sheet.content]);

  // 加成目标候选：全部分组中的数值条目（面板即属性登记处）
  const attrOptions = useMemo<AttrOption[]>(
    () =>
      groups.flatMap((group) =>
        group.entries
          .filter((entry) => entry.kind === "number")
          .map((entry) => ({ label: entry.name, value: entry.id })),
      ),
    [groups],
  );

  return (
    <div className="nv-status-anchor" ref={rootRef}>
      <div
        className={`nv-status-pop${open ? " is-open" : ""}`}
        role="dialog"
        aria-label="主角属性面板"
      >
        <div className="nv-status-pop__head">
          <div className="avatar">主</div>
          <div className="who">
            <span className="name">主角</span>
            <span className="mock-chip">mock 数据 · 未落库</span>
          </div>
          <span className="spacer" />
          <SaveState phase={sheet.phase} savedAt={sheet.savedAt} />
          <button
            type="button"
            className="icon-btn"
            title="关闭 (Esc)"
            onClick={handleClose}
          >
            <CloseOutlined />
          </button>
        </div>

        <div className="nv-status-pop__seg">
          <Segmented
            block
            size="small"
            value={activeGroup?.id ?? ""}
            onChange={(value) => setActiveGroupId(String(value))}
            options={groups.map((group) => ({
              label: `${group.name} ${group.entries.length}`,
              value: group.id,
            }))}
          />
          <Dropdown
            trigger={["click"]}
            classNames={{ root: PORTAL_CLASS }}
            menu={{
              items: [
                { key: "add-group", icon: <PlusOutlined />, label: "添加分组" },
                { key: "edit", icon: <EditOutlined />, label: "编辑分组与条目", disabled: true },
                { key: "template", icon: <SwapOutlined />, label: "套用预设模板", disabled: true },
              ],
              onClick: ({ key }) => {
                if (key === "add-group") sheet.addGroup();
              },
            }}
          >
            <button type="button" className="more-btn" title="管理分组与条目">
              <MoreOutlined />
            </button>
          </Dropdown>
        </div>

        <SummaryBar
          rows={totals}
          open={sumOpen}
          onToggle={() => setSumOpen((v) => !v)}
        />

        <div className="nv-status-pop__body">
          {activeGroup ? (
            <>
              {activeGroup.entries.length === 0 && (
                <div className="empty-hint">分组为空 · 用下方按钮添加条目</div>
              )}
              {activeGroup.entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  sheet={sheet}
                  attrOptions={attrOptions}
                />
              ))}
              <button
                type="button"
                className="add-row"
                onClick={() => sheet.addEntry(activeGroup.id)}
              >
                ＋ 添加条目
              </button>
            </>
          ) : (
            <div className="empty-hint">还没有分组 · 点右上「⋯」添加分组</div>
          )}
        </div>

        <div className="nv-status-pop__foot">
          <span>自动保存（本地模拟）</span>
          <span>·</span>
          <span>「↩ 上次」可回退</span>
          <span className="spacer" />
          <span className="k">Esc</span>
          <span className="time">
            {sheet.savedAt ? formatClock(sheet.savedAt) : "—"}
          </span>
        </div>
      </div>

      <StatusFab open={open} onToggle={onToggle} />
    </div>
  );
}

function SaveState({
  phase,
  savedAt,
}: {
  phase: StatusSavePhase;
  savedAt: Date | null;
}) {
  const cls =
    phase === "saved" ? "is-saved" : phase === "saving" ? "is-saving" : "";
  const text =
    phase === "saved"
      ? `已保存${savedAt ? ` ${formatClock(savedAt)}` : ""}`
      : phase === "saving"
        ? "保存中…"
        : "修改中…";
  return (
    <span className={`save-state ${cls}`}>
      <span className="dot">●</span>
      {text}
    </span>
  );
}

function SummaryBar({
  rows,
  open,
  onToggle,
}: {
  rows: StatusTotalRow[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`nv-status-sum${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="nv-status-sum__head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="cap">
          <span className="dot" />
          状态汇总
        </span>
        <span className="chips">
          {rows.length === 0 && (
            <span className="sum-chip is-plain">
              尚无属性加成 · 在条目上「＋ 加成」
            </span>
          )}
          {rows.map((row) => (
            <span
              key={row.attrId}
              className={`sum-chip${row.bonus === 0 ? " is-plain" : ""}`}
            >
              {row.attrName} {row.total}
              {row.bonus !== 0 ? ` (${row.bonus > 0 ? "+" : ""}${row.bonus})` : ""}
            </span>
          ))}
        </span>
        <DownOutlined className="caret" />
      </button>
      {open && (
        <div className="nv-status-sum__detail">
          {rows.map((row) => (
            <div key={row.attrId} className="sum-row">
              <div className="r1">
                <span className="nm">{row.attrName}</span>
                <span className="calc">
                  基础 {row.base} → 总 {row.total}
                </span>
                <span className={`delta${row.bonus === 0 ? " is-zero" : ""}`}>
                  {row.bonus !== 0 ? `${row.bonus > 0 ? "+" : ""}${row.bonus}` : "±0"}
                </span>
              </div>
              <div className="srcs">
                {row.sources.map((src, index) => (
                  <span
                    key={`${src.entryId}-${index}`}
                    className={`src${src.on ? "" : " is-off"}`}
                  >
                    <span className={`amt${src.amount < 0 ? " is-neg" : ""}`}>
                      {src.amount > 0 ? "+" : ""}
                      {src.amount}
                    </span>
                    {src.entryName} · {MODE_LABEL[src.mode]}
                    {src.on ? "" : " · 未生效"}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface EntryRowProps {
  entry: StatusEntry;
  sheet: StatusSheetController;
  attrOptions: AttrOption[];
}

function EntryRow({ entry, sheet, attrOptions }: EntryRowProps) {
  const bonuses = entry.bonuses ?? [];
  const showToggle = bonuses.some((b) => b.mode === "while_active");
  const active = entry.active === true;
  const update = (
    patch: Partial<Pick<StatusEntry, "name" | "value" | "max" | "note" | "active">>,
  ) => sheet.updateEntry(entry.id, patch);

  const toggle = showToggle ? (
    <Tooltip
      title={active ? "加成生效中（点击停用）" : "未激活 · 激活时加成不计入汇总"}
    >
      <Switch size="small" checked={active} onChange={(v) => update({ active: v })} />
    </Tooltip>
  ) : null;

  const del = (
    <button
      type="button"
      className="del"
      title="删除条目"
      onClick={() => sheet.removeEntry(entry.id)}
    >
      <CloseOutlined />
    </button>
  );

  const prevChip =
    entry.kind === "number" && entry.prevValue ? (
      <button
        type="button"
        className="prev-chip"
        title="回退到上一次保存的值（可再次点击切回）"
        onClick={() => sheet.rollback(entry.id)}
      >
        ↩ 上次 <b>{entry.prevValue}</b>
      </button>
    ) : null;

  if (entry.kind === "text") {
    return (
      <div className="nv-status-row">
        <div className="line1">
          <input
            className="cell cell--name"
            value={entry.name}
            onChange={(e) => update({ name: e.target.value })}
          />
          {toggle}
          {del}
        </div>
        <div className="line2">
          <input
            className="cell cell--text"
            value={entry.value}
            placeholder="描述…"
            onChange={(e) => update({ value: e.target.value })}
          />
        </div>
        <BonusLine entry={entry} sheet={sheet} attrOptions={attrOptions} />
      </div>
    );
  }

  if (entry.kind === "choice") {
    return (
      <div className="nv-status-row">
        <div className="line1">
          <input
            className="cell cell--name"
            value={entry.name}
            onChange={(e) => update({ name: e.target.value })}
          />
          {del}
        </div>
        <div className="line2 opts">
          {(entry.options ?? []).map((opt) => (
            <button
              key={opt}
              type="button"
              className={`opt${entry.value === opt ? " is-on" : ""}`}
              onClick={() => update({ value: opt })}
            >
              {opt}
            </button>
          ))}
          {(entry.options ?? []).length === 0 && (
            <span className="empty-hint">尚无选项 · 选项编辑随管理入口提供</span>
          )}
        </div>
        <BonusLine entry={entry} sheet={sheet} attrOptions={attrOptions} />
      </div>
    );
  }

  // number：步进器 + 可选上限进度条（统一行组件按 max 决定是否渲染进度条）
  const current = Number.parseInt(entry.value, 10) || 0;
  const maxNum = Number.parseInt(entry.max ?? "", 10);
  const hasMax = Number.isFinite(maxNum) && maxNum > 0;
  const bump = (dir: number) => update({ value: String(Math.max(0, current + dir * 10)) });

  return (
    <div className="nv-status-row">
      <div className="line1">
        <input
          className="cell cell--name"
          value={entry.name}
          onChange={(e) => update({ name: e.target.value })}
        />
        {toggle}
        <div className="stepper">
          <button type="button" aria-label="减少" onClick={() => bump(-1)}>
            −
          </button>
          <span className="val">{entry.value}</span>
          <button type="button" aria-label="增加" onClick={() => bump(1)}>
            ＋
          </button>
        </div>
        {del}
      </div>
      <div className="line2">
        {prevChip}
        <span className="mini">上限</span>
        <input
          className="cell cell--max"
          value={entry.max ?? ""}
          placeholder="—"
          onChange={(e) => update({ max: e.target.value })}
        />
        <input
          className="cell cell--note"
          value={entry.note}
          placeholder="备注…"
          onChange={(e) => update({ note: e.target.value })}
        />
      </div>
      {hasMax && (
        <div className="line3">
          <div className="bar">
            <i
              style={{
                width: `${Math.min(100, Math.round((current / maxNum) * 100))}%`,
              }}
            />
          </div>
          <span className="nums">
            {current} / {maxNum}
          </span>
        </div>
      )}
      <BonusLine entry={entry} sheet={sheet} attrOptions={attrOptions} />
    </div>
  );
}

function BonusLine({ entry, sheet, attrOptions }: EntryRowProps) {
  const [adding, setAdding] = useState(false);
  const [attrId, setAttrId] = useState(attrOptions[0]?.value ?? "");
  const [amount, setAmount] = useState(5);
  const [mode, setMode] = useState<StatusBonusMode>("while_active");
  const bonuses = entry.bonuses ?? [];

  const submit = () => {
    if (!attrId) return;
    sheet.addBonus(entry.id, { attrId, amount, mode });
    setAdding(false);
  };

  return (
    <div className="nv-status-bonus-line">
      {bonuses.map((bonus, index) => (
        <span
          key={`${bonus.attrId}-${bonus.mode}-${index}`}
          className={`chip${bonus.amount < 0 ? " is-neg" : ""}`}
        >
          {attrOptions.find((o) => o.value === bonus.attrId)?.label ?? "未知属性"}
          <b>
            {bonus.amount > 0 ? "+" : ""}
            {bonus.amount}
          </b>
          <span className="mode">· {MODE_LABEL[bonus.mode]}</span>
          <button
            type="button"
            className="x"
            title="移除加成"
            onClick={() => sheet.removeBonus(entry.id, index)}
          >
            <CloseOutlined />
          </button>
        </span>
      ))}
      {adding ? (
        <span className="bonus-form">
          <Select
            size="small"
            style={{ width: 96 }}
            value={attrId || undefined}
            placeholder="属性"
            options={attrOptions}
            onChange={(value) => setAttrId(value)}
            classNames={{ popup: { root: PORTAL_CLASS } }}
          />
          <InputNumber
            size="small"
            style={{ width: 68 }}
            value={amount}
            onChange={(value) => setAmount(typeof value === "number" ? value : 0)}
          />
          <Segmented
            size="small"
            value={mode}
            onChange={(value) => setMode(value as StatusBonusMode)}
            options={[
              { label: "永久", value: "permanent" },
              { label: "激活时", value: "while_active" },
            ]}
          />
          <button type="button" className="ok" disabled={!attrId} onClick={submit}>
            确定
          </button>
          <button type="button" className="cancel" onClick={() => setAdding(false)}>
            取消
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="ghost-add"
          disabled={attrOptions.length === 0}
          onClick={() => setAdding(true)}
        >
          <PlusOutlined /> 加成
        </button>
      )}
    </div>
  );
}
