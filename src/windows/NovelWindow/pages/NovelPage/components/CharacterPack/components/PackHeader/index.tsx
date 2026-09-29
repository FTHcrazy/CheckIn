import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  ClockCircleOutlined,
  CloseOutlined,
  SettingOutlined,
  SlidersOutlined,
} from "@ant-design/icons";
import { formatRelativeTime } from "../../pack-utils";
import "./index.scss";

interface PackHeaderProps {
  characterName: string;
  realmText: string;
  realmHint: string;
  dirty: number;
  saving: boolean;
  saveFailed: boolean;
  savedAt: number;
  /** ≥5 处改动时做一次轻微呼吸提示（不循环，G-3） */
  breathe: boolean;
  onRename: (name: string) => void;
  onSave: () => void;
  onRevertAll: () => void;
  onOpenModules: () => void;
  onOpenUnitManager: () => void;
  onOpenRecords: () => void;
  onClose: () => void;
}

/**
 * 行囊头部：角色 + 境界 chip + 保存条三态（§8.6.1）
 *
 * 「已保存 · n 分钟前」的时间基准来自最近一条盘点记录的生成时间
 * （保存时会先对改动前状态生成记录，故它正好等于上次保存时刻）。
 */
export default function PackHeader({
  characterName,
  realmText,
  realmHint,
  dirty,
  saving,
  saveFailed,
  savedAt,
  breathe,
  onRename,
  onSave,
  onRevertAll,
  onOpenModules,
  onOpenUnitManager,
  onOpenRecords,
  onClose,
}: PackHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(characterName);
  const [now, setNow] = useState(() => Date.now());

  // 「n 分钟前」需要随时间推进刷新，否则会长期停在首次渲染的值
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!editing) setDraft(characterName);
  }, [characterName, editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== characterName) onRename(trimmed);
    setEditing(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") commit();
    if (event.key === "Escape") {
      setDraft(characterName);
      setEditing(false);
    }
  };

  const tone = saveFailed ? "failed" : saving ? "busy" : dirty > 0 ? "dirty" : "idle";

  return (
    <header className="cpk-head">
      <div className="cpk-head__top">
        <div className="cpk-head__who">
          <span className="cpk-head__avatar" aria-hidden>
            🧑
          </span>
          {editing ? (
            <input
              className="cpk-head__name-input"
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={onKeyDown}
              aria-label="角色名"
            />
          ) : (
            <button
              type="button"
              className="cpk-head__name"
              onClick={() => setEditing(true)}
              title="点击改名"
            >
              {characterName || "主角"}
            </button>
          )}
          <span className="cpk-head__realm" title={realmHint || "与实体面板同一份数据"}>
            {realmText}
          </span>
        </div>
        <div className="cpk-head__ops">
          <button
            type="button"
            className="cpk-iconbtn"
            onClick={onOpenRecords}
            title="盘点记录 / 与本章初对比"
          >
            <ClockCircleOutlined />
          </button>
          <button
            type="button"
            className="cpk-iconbtn"
            onClick={onOpenUnitManager}
            title="量纲设置（货币 / 熟练度）"
          >
            <SlidersOutlined />
          </button>
          <button
            type="button"
            className="cpk-iconbtn"
            onClick={onOpenModules}
            title="模块管理"
          >
            <SettingOutlined />
          </button>
          <button type="button" className="cpk-iconbtn" onClick={onClose} title="关闭（Esc）">
            <CloseOutlined />
          </button>
        </div>
      </div>

      <div className={`cpk-savebar is-${tone}${breathe ? " is-breathe" : ""}`}>
        <span className="cpk-savebar__state">
          {tone === "idle" &&
            (savedAt > 0 ? `已保存 · ${formatRelativeTime(savedAt, now)}` : "已保存")}
          {tone === "dirty" && `${dirty} 处改动未保存`}
          {tone === "busy" && "保存中…"}
          {tone === "failed" && "保存失败 · 草稿已保留"}
        </span>
        <span className="cpk-savebar__actions">
          {tone === "dirty" && (
            <button type="button" className="cpk-btn ghost" onClick={onRevertAll}>
              撤销全部
            </button>
          )}
          <button
            type="button"
            className="cpk-btn primary"
            onClick={onSave}
            disabled={saving || dirty === 0}
            title={dirty === 0 ? "没有未保存的改动" : "先落回退点，再写入正式表"}
          >
            {tone === "failed" ? "重试" : dirty > 0 ? `保存 (${dirty})` : "保存"}
          </button>
        </span>
      </div>
    </header>
  );
}
