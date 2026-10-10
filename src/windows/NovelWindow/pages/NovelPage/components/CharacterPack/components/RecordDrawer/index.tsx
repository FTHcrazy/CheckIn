import { useMemo, useState } from "react";
import { Button, Modal } from "antd";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { formatRelativeTime } from "../../pack-utils";
import { diffPackDoc, parsePackDiffDoc } from "../../pack-diff";
import type { PackRecord } from "../../types";
import "./index.scss";

interface RecordDrawerProps {
  api: PackPanelApi;
}

/**
 * 盘点记录（REQ-029 / REQ-044）
 *
 * 两个分区，分的是**两件不同的事**：
 * - 「与本章初对比」是只读的答案 —— 作者点开它想知道「这一章里角色变了什么」；
 * - 「回退点」是有后果的动作 —— 载入会覆盖当前草稿。
 * 分成两段而不是合成一张表，是因为前者想反复看，后者不该被顺手点到。
 */
export default function RecordDrawer({ api }: RecordDrawerProps) {
  const [confirming, setConfirming] = useState<PackRecord | null>(null);

  const baseline = api.chapterBaseline;

  const diff = useMemo(() => {
    // 只在抽屉真的开着时算：两次完整汇总管线不贵，但没必要在每次敲字时都跑
    if (!api.recordDrawerOpen || !api.doc || !baseline) return null;
    const past = parsePackDiffDoc(baseline.payload);
    if (!past) return null;
    /**
     * 当前文档要补上「境界关联行」这一格：文档本身不持有 `novel_links`
     * （境界的唯一事实源在那边），而差异的**两边必须同构** ——
     * 不补的话 `realmLink` 恒为 undefined，境界组会永远整组静默跳过。
     */
    const now = { ...api.doc, realmLink: api.meta.realmLink };
    return diffPackDoc(past, now, api.rungs);
  }, [api.recordDrawerOpen, api.doc, api.meta.realmLink, api.rungs, baseline]);

  const restore = (record: PackRecord) => {
    const ok = api.restoreFromRecord(record);
    if (ok) {
      api.showToast("已载入该回退点，保存后生效", "info");
    } else {
      api.showToast("该记录内容无法解析", "error");
    }
    setConfirming(null);
    api.setRecordDrawerOpen(false);
  };

  return (
    <Modal
      open={api.recordDrawerOpen}
      title="盘点记录"
      centered
      width={520}
      onCancel={() => api.setRecordDrawerOpen(false)}
      footer={
        <div className="cpk-guard__footer">
          <Button onClick={() => api.setRecordDrawerOpen(false)}>关闭</Button>
        </div>
      }
    >
      {/* ── 与本章初对比（REQ-029）：只读 ── */}
      <section className="cpk-diff">
        <header className="cpk-diff__head">
          <span className="cpk-diff__title">与本章初对比</span>
          {baseline ? (
            <span className="cpk-diff__meta">
              起点：{baseline.reason || "自动存档"} · {formatRelativeTime(baseline.takenAt)}
              {diff && diff.total > 0 ? ` · ${diff.total} 处变动` : ""}
            </span>
          ) : null}
        </header>

        {!baseline ? (
          <p className="cpk-diff__empty">
            本章还没有盘点起点。在本章点一次「保存」，这里就会列出此后发生的所有变动。
          </p>
        ) : !diff ? (
          <p className="cpk-diff__empty">这条起点的内容读不出来（更早版本的记录），无法对比。</p>
        ) : diff.total === 0 ? (
          <p className="cpk-diff__empty">与本章初相比没有变化。</p>
        ) : (
          <div className="cpk-diff__groups">
            {diff.buckets.map((bucket) => (
              <div key={bucket.group} className="cpk-diff__group">
                <span className="cpk-diff__glabel">{bucket.label}</span>
                <ul className="cpk-diff__rows">
                  {bucket.rows.map((row, index) => (
                    <li
                      key={`${bucket.group}-${row.label}-${index}`}
                      className={`cpk-diff__row is-${row.kind}`}
                    >
                      {row.kind === "change" ? null : (
                        <span className="cpk-diff__sign">{row.kind === "add" ? "＋" : "−"}</span>
                      )}
                      <span className="cpk-diff__label">{row.label}</span>
                      {row.kind === "change" && row.before ? (
                        <>
                          <span className="cpk-diff__from">{row.before}</span>
                          <span className="cpk-diff__arrow">→</span>
                        </>
                      ) : null}
                      {/* 删除时「值」在 before 上；改「位置」为空的变更（如量纲换算）
                          只剩 after 一句话，不补箭头 */}
                      <span className="cpk-diff__to">
                        {row.kind === "remove" ? row.before : row.after}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 回退点（REQ-044）：有后果 ── */}
      <section className="cpk-diff cpk-diff--last">
        <header className="cpk-diff__head">
          <span className="cpk-diff__title">回退点</span>
        </header>
        <p className="cpk-guard__sub">
          每次保存前都会自动留一个回退点，只保留最近 20 条。载入某个回退点后需要再点一次「保存」才会写回正式数据。
        </p>

        {api.meta.records.length === 0 ? (
          <p className="cpk-empty">还没有回退点。第一次保存之后就会出现。</p>
        ) : (
          <ul className="cpk-rec">
            {api.meta.records.map((record, index) => (
              <li key={record.id} className="cpk-rec__row">
                <span className="cpk-rec__main">
                  <span className="cpk-rec__reason">
                    {record.reason || "自动存档"}
                    {record.id === baseline?.id ? <em className="cpk-rec__mark">本章初</em> : null}
                    {index === 0 ? <em className="cpk-rec__latest">最新</em> : null}
                  </span>
                  <span className="cpk-rec__time">{formatRelativeTime(record.takenAt)}</span>
                </span>
                <Button size="small" onClick={() => setConfirming(record)}>
                  载入
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={confirming !== null}
        title="载入这个回退点？"
        centered
        width={340}
        okText="载入"
        cancelText="取消"
        onOk={() => confirming && restore(confirming)}
        onCancel={() => setConfirming(null)}
      >
        <p className="cpk-guard__text">
          当前未保存的改动会被这个回退点覆盖（草稿也会被替换）。
        </p>
        <p className="cpk-guard__sub">如果不确定，先取消，回面板点一次「保存」把现状落成新的回退点。</p>
      </Modal>
    </Modal>
  );
}
