import { useCallback, useEffect, useState } from "react";
import { App, Button, Modal } from "antd";
import {
  CloudDownloadOutlined,
  ExportOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import type { NovelBackupManifestDTO } from "@/shared/types/electron";
import {
  exportNovelBackup,
  pickNovelBackup,
  restoreNovelBackup,
} from "../../../NovelPage/services/novel-service";
import { formatThousands } from "../../bookshelf-utils";
import "./index.scss";

interface DataSafetyModalProps {
  open: boolean;
  onClose: () => void;
  /** 整库被替换后通知外部（书架重载；随后窗口会自行 reload） */
  onDataChanged: () => void;
}

/** 一次性恢复预览（选包成功后展示，确认后才覆盖整库） */
interface PendingRestore {
  filePath: string;
  manifest: NovelBackupManifestDTO;
  bytes?: number;
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * 数据安全面板（P0 数据安全三件套的落地入口，2.5.0 起只留备份 / 恢复）。
 *
 * 两件事同属「本机数据会不会丢」「换机怎么办」这一个心智，收在同一个弹窗里：
 *   ① 一键全量备份 —— 打包整库 zip，换机 / 重装前点一下
 *   ② 从备份恢复 —— 选包 → 看清规模 → 确认覆盖（主进程先自动留底）
 *
 * ③ 回收站已经**拆成独立页面** `pages/RecycleBinPage`：逐条判断「捞回还是销毁」
 * 需要类型 / 归属 / 规模 / 剩余天数 / 两个动作的横向空间，560px 的弹窗塞不下。
 *
 * 入口在书架顶栏（`ShelfTopBar` 的「数据安全」）。
 */
export default function DataSafetyModal({
  open,
  onClose,
  onDataChanged,
}: DataSafetyModalProps) {
  const { message } = App.useApp();
  const [backingUp, setBackingUp] = useState(false);
  const [picking, setPicking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pending, setPending] = useState<PendingRestore | null>(null);

  useEffect(() => {
    if (open) return;
    // 关闭即丢弃「待确认的恢复」——下次打开必须重新选包，避免误点确认
    setPending(null);
  }, [open]);

  const handleBackup = useCallback(async (): Promise<void> => {
    setBackingUp(true);
    try {
      const result = await exportNovelBackup();
      if (result.canceled) return;
      const { counts } = result;
      message.success(
        `备份完成 · ${counts.works} 部作品 / ${counts.chapters} 章 · ${formatBytes(result.bytes)}`,
      );
    } catch (error) {
      message.error(
        `备份失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBackingUp(false);
    }
  }, [message]);

  const handlePick = useCallback(async (): Promise<void> => {
    setPicking(true);
    try {
      const result = await pickNovelBackup();
      if (result.canceled || !result.filePath || !result.manifest) return;
      setPending({
        filePath: result.filePath,
        manifest: result.manifest,
        bytes: result.bytes,
      });
    } catch (error) {
      message.error(
        `读取备份包失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setPicking(false);
    }
  }, [message]);

  const handleRestore = useCallback(async (): Promise<void> => {
    if (!pending) return;
    setRestoring(true);
    try {
      const result = await restoreNovelBackup(pending.filePath);
      const { counts } = result;
      message.success(
        `恢复完成 · ${counts.works} 部作品 / ${counts.chapters} 章，正在重新载入…`,
        2.2,
      );
      setPending(null);
      onDataChanged();
      // 整库被替换：编辑器里可能还压着旧章节的内存副本，直接重载窗口
      // 比「局部刷新 + 等用户再切一章」可靠得多
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      message.error(
        `恢复失败：${error instanceof Error ? error.message : String(error)}`,
      );
      setRestoring(false);
    }
  }, [pending, message, onDataChanged]);

  const restoreCounts = pending?.manifest.counts;

  return (
    <Modal
      open={open}
      title="数据安全"
      width={560}
      footer={null}
      onCancel={onClose}
      destroyOnHidden
      className="bs-safety-modal"
    >
      <div className="bs-safety">
        {/* ── ① 一键全量备份 ── */}
        <section className="bs-safety__section">
          <h3 className="bs-safety__title">全量备份</h3>
          <p className="bs-safety__hint">
            把整库（作品、章节正文、要素、设定、行囊、关系图）打包成一个 zip
            文件。换机、重装或大改之前先备份一份最稳妥。
          </p>
          <div className="bs-safety__actions">
            <Button
              type="primary"
              size="small"
              icon={<ExportOutlined />}
              loading={backingUp}
              onClick={() => void handleBackup()}
            >
              立即备份
            </Button>
          </div>
        </section>

        {/* ── ② 从备份恢复 ── */}
        <section className="bs-safety__section">
          <h3 className="bs-safety__title">从备份恢复</h3>
          <p className="bs-safety__hint">
            恢复会用备份包<strong>覆盖当前全部小说数据</strong>。覆盖前会自动在库文件旁留一份
            novel.db.before-restore-* 底档，选错包还能捞回来。
          </p>

          {pending && restoreCounts ? (
            <div className="bs-safety__preview">
              <div className="bs-safety__preview-head">
                <InboxOutlined />
                <span>这个包里是</span>
              </div>
              <div className="bs-safety__preview-grid">
                <span>导出时间</span>
                <b>{formatDate(pending.manifest.exportedAt)}</b>
                <span>作品</span>
                <b>{restoreCounts.works} 部</b>
                <span>卷 / 章</span>
                <b>
                  {restoreCounts.volumes} 卷 · {restoreCounts.chapters} 章
                </b>
                <span>字数</span>
                <b>{formatThousands(restoreCounts.words)} 字</b>
                <span>包大小</span>
                <b>{formatBytes(pending.bytes)}</b>
              </div>
              <div className="bs-safety__actions">
                <Button
                  danger
                  size="small"
                  icon={<CloudDownloadOutlined />}
                  loading={restoring}
                  onClick={() => void handleRestore()}
                >
                  确认覆盖恢复
                </Button>
                <Button
                  size="small"
                  aria-label="取消恢复"
                  onClick={() => setPending(null)}
                  disabled={restoring}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <div className="bs-safety__actions">
              <Button
                size="small"
                icon={<CloudDownloadOutlined />}
                loading={picking}
                onClick={() => void handlePick()}
              >
                选择备份包…
              </Button>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
