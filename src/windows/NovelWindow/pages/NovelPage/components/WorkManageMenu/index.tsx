import { useEffect, useState } from "react";
import { Dropdown, Input, Modal } from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { formatThousands, type WorkMeta } from "../../novel-utils";
import "./index.scss";

export type WorkModalKind = "create" | "rename" | "delete" | "reset-template" | null;

interface WorkManageMenuProps {
  /** 当前作品名（重命名 / 删除确认里展示） */
  activeWorkName: string;
  /** 当前作品聚合信息：删除确认的级联提示用 */
  activeMeta: WorkMeta | undefined;
  /** 是否存在章节：导出当前卷 / 当前章的可用性 */
  hasActiveChapter: boolean;
  /** 新建作品：返回 false 表示校验失败，弹框不关闭 */
  onCreate: (name: string) => boolean;
  /** 重命名当前作品：返回 false 表示校验失败，弹框不关闭 */
  onRename: (name: string) => boolean;
  /** 删除当前作品（确认后调用） */
  onDelete: () => void;
  /** 一键重置为模板书籍（调试，确认后调用） */
  onResetTemplate: () => void;
  /** 导出整本 TXT（R13） */
  onExportBook: () => void;
  /** 导出当前章所在卷 TXT（R13） */
  onExportVolume: () => void;
  /** 导出当前章 TXT（R13） */
  onExportChapter: () => void;
}

/**
 * 作品管理入口（R29）：顶栏下拉内嵌「新建 / 重命名 / 删除 / 导出」。
 *
 * 作品切换仍由旁边的 Select 承担，这里只放管理动作；
 * 删除必须走确认弹框并明示级联范围（卷章 / 要素 / 灵感伏笔 / 快照）。
 */
export default function WorkManageMenu({
  activeWorkName,
  activeMeta,
  hasActiveChapter,
  onCreate,
  onRename,
  onDelete,
  onResetTemplate,
  onExportBook,
  onExportVolume,
  onExportChapter,
}: WorkManageMenuProps) {
  const [modalKind, setModalKind] = useState<WorkModalKind>(null);
  const [nameDraft, setNameDraft] = useState("");

  const openCreate = (): void => {
    setNameDraft("");
    setModalKind("create");
  };
  const openRename = (): void => {
    setNameDraft(activeWorkName);
    setModalKind("rename");
  };

  const confirmName = (): void => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    const ok = modalKind === "create" ? onCreate(trimmed) : onRename(trimmed);
    if (ok) setModalKind(null);
  };

  // 弹框关闭后立刻失焦归还焦点，避免残留焦点打断码字输入
  useEffect(() => {
    if (modalKind === null) setNameDraft("");
  }, [modalKind]);

  const deleting = modalKind === "delete";
  const resetting = modalKind === "reset-template";

  return (
    <>
      <Dropdown
        trigger={["click"]}
        menu={{
          items: [
            { key: "create", icon: <PlusOutlined />, label: "新建作品" },
            {
              key: "rename",
              icon: <EditOutlined />,
              label: "重命名当前作品",
              disabled: !activeWorkName,
            },
            { type: "divider" as const },
            {
              key: "export-book",
              icon: <FileTextOutlined />,
              label: "导出整本 TXT",
              disabled: !activeWorkName || !activeMeta || activeMeta.chapters === 0,
            },
            {
              key: "export-volume",
              icon: <FileAddOutlined />,
              label: "导出当前卷 TXT",
              disabled: !hasActiveChapter,
            },
            {
              key: "export-chapter",
              icon: <ExportOutlined />,
              label: "导出当前章 TXT",
              disabled: !hasActiveChapter,
            },
            { type: "divider" as const },
            {
              key: "delete",
              icon: <DeleteOutlined />,
              label: "删除当前作品",
              danger: true,
              disabled: !activeWorkName,
            },
            { type: "divider" as const },
            {
              key: "reset-template",
              icon: <ReloadOutlined />,
              label: "重置为模板书籍（调试）",
            },
          ],
          onClick: ({ key }) => {
            if (key === "create") openCreate();
            else if (key === "rename") openRename();
            else if (key === "export-book") onExportBook();
            else if (key === "export-volume") onExportVolume();
            else if (key === "export-chapter") onExportChapter();
            else if (key === "delete") setModalKind("delete");
            else if (key === "reset-template") setModalKind("reset-template");
          },
        }}
      >
        <button
          type="button"
          className="nv-topbar__icon"
          aria-label="作品管理"
          title="作品管理"
        >
          <FolderOpenOutlined />
        </button>
      </Dropdown>

      <Modal
        open={modalKind === "create" || modalKind === "rename"}
        title={modalKind === "create" ? "新建作品" : "重命名作品"}
        okText="确定"
        cancelText="取消"
        width={380}
        onOk={confirmName}
        onCancel={() => setModalKind(null)}
        destroyOnHidden
      >
        <Input
          value={nameDraft}
          autoFocus
          maxLength={50}
          placeholder="作品名称"
          aria-label="作品名称"
          onChange={(event) => setNameDraft(event.target.value)}
          onPressEnter={confirmName}
        />
      </Modal>

      <Modal
        open={deleting}
        title="删除作品"
        okText="删除"
        cancelText="取消"
        width={420}
        okButtonProps={{ danger: true }}
        onOk={() => {
          onDelete();
          setModalKind(null);
        }}
        onCancel={() => setModalKind(null)}
      >
        <p className="nv-work-menu__delete-name">「{activeWorkName}」</p>
        <p>
          将删除该作品的{" "}
          <strong>
            {activeMeta ? `${activeMeta.volumes} 卷 / ${activeMeta.chapters} 章（约 ${formatThousands(activeMeta.words)} 字）` : "全部卷章"}
          </strong>
          ，以及全部要素卡、灵感、伏笔与历史快照。
        </p>
        <p className="nv-work-menu__delete-warn">此操作不可恢复，请确认。</p>
      </Modal>

      <Modal
        open={resetting}
        title="重置为模板书籍"
        okText="重置"
        cancelText="取消"
        width={420}
        okButtonProps={{ danger: true }}
        onOk={() => {
          onResetTemplate();
          setModalKind(null);
        }}
        onCancel={() => setModalKind(null)}
      >
        <p>
          将<strong>清空全部作品</strong>（卷章 / 要素 / 灵感伏笔 / 历史快照），
          并重新播种模板书籍「山海拾遗」：3 卷 15 章长文本与全套要素数据，
          用于测试编辑器各项功能。
        </p>
        <p className="nv-work-menu__delete-warn">所有未保存内容将丢失，此操作不可恢复。</p>
      </Modal>
    </>
  );
}
