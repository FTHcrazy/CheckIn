import { useState } from "react";
import { Button, Modal } from "antd";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { formatRelativeTime } from "../../pack-utils";
import type { PackRecord } from "../../types";
import "./index.scss";
import "./index.scss";

interface RecordDrawerProps {
  api: PackPanelApi;
}

/**
 * 盘点记录 / 回退点（G-1）
 *
 * 保存前系统会先对「改动前」的状态落一条记录，所以这里的每一条都是
 * 一个可以回去的版本点 —— 这是「误操作会丢历史数据」这个担忧的正面回答。
 */
export default function RecordDrawer({ api }: RecordDrawerProps) {
  const [confirming, setConfirming] = useState<PackRecord | null>(null);

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
      width={460}
      onCancel={() => api.setRecordDrawerOpen(false)}
      footer={
        <div className="cpk-guard__footer">
          <Button onClick={() => api.setRecordDrawerOpen(false)}>关闭</Button>
        </div>
      }
    >
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
