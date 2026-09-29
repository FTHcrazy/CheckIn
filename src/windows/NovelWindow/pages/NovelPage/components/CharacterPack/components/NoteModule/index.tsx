import PackModuleShell from "../PackModuleShell";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";

interface NoteModuleProps {
  api: PackPanelApi;
}

/**
 * 备注速记（REQ-031）
 *
 * 不参与任何计算，纯作者自用。刻意放在最后一个默认模块 ——
 * 它是「盘不完的先记下来」的兜底，不是盘点的核心。
 */
export default function NoteModule({ api }: NoteModuleProps) {
  const doc = api.doc;
  if (!doc) return null;
  const key = "note" as const;

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
    >
      <textarea
        className="cpk-note__area"
        rows={3}
        value={doc.character.note}
        placeholder="随手记：本章主角身上还带着什么、下一步打算处理什么……"
        onChange={(event) => api.setCharacterNote(event.target.value)}
      />
    </PackModuleShell>
  );
}
