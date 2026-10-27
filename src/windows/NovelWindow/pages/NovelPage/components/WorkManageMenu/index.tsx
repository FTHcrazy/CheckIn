import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { AutoComplete, Button, Dropdown, Input, Modal } from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { formatThousands, type WorkMeta } from "../../novel-utils";
import { GENRE_MAX_LENGTH, GENRE_OPTIONS } from "@/shared/novel/genres";
import "./index.scss";

export type WorkModalKind =
  | "create"
  | "rename"
  | "genre"
  | "delete"
  | "reset-template"
  | null;

/** 命令式 API：空书架引导处点「新建作品」要复用这里的创建弹框 */
export interface WorkManageMenuHandle {
  /** 直接打开「新建作品」弹框 */
  openCreate: () => void;
}

interface WorkManageMenuProps {
  /** 当前作品名（重命名 / 删除确认里展示） */
  activeWorkName: string;
  /** 当前作品题材（2.7.1）：可空 = 未设置 */
  activeGenre?: string;
  /** 当前作品聚合信息：删除确认的级联提示用 */
  activeMeta: WorkMeta | undefined;
  /** 是否存在章节：导出当前卷 / 当前章的可用性 */
  hasActiveChapter: boolean;
  /** 新建作品：返回 false 表示校验失败，弹框不关闭；genre 可空 */
  onCreate: (name: string, genre?: string) => boolean;
  /** 重命名当前作品：返回 false 表示校验失败，弹框不关闭 */
  onRename: (name: string) => boolean;
  /** 设置当前作品题材（空串 = 清空）：AI 起名 / 润色的风格锚点 */
  onSetGenre: (genre: string) => boolean;
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
export default forwardRef<WorkManageMenuHandle, WorkManageMenuProps>(
  function WorkManageMenu(
    {
      activeWorkName,
      activeGenre,
      activeMeta,
      hasActiveChapter,
      onCreate,
      onRename,
      onSetGenre,
      onDelete,
      onResetTemplate,
      onExportBook,
      onExportVolume,
      onExportChapter,
    }: WorkManageMenuProps,
    ref,
  ) {
  const [modalKind, setModalKind] = useState<WorkModalKind>(null);
  const [nameDraft, setNameDraft] = useState("");
  /** 题材草稿：新建时为空（可跳过），编辑时带入当前作品题材 */
  const [genreDraft, setGenreDraft] = useState("");

  const openCreate = (): void => {
    setNameDraft("");
    setGenreDraft("");
    setModalKind("create");
  };

  // 空书架引导处（EditorPane 空态）点「新建作品」直接开这个弹框
  useImperativeHandle(ref, () => ({ openCreate }), []);
  const openRename = (): void => {
    setNameDraft(activeWorkName);
    setModalKind("rename");
  };

  const openGenre = (): void => {
    setGenreDraft(activeGenre ?? "");
    setModalKind("genre");
  };

  const confirmName = (): void => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    const ok =
      modalKind === "create" ? onCreate(trimmed, genreDraft) : onRename(trimmed);
    if (ok) setModalKind(null);
  };

  /** 题材弹框：允许提交空串（= 清空题材），因为「不想标了」也是正常诉求 */
  const confirmGenre = (): void => {
    const ok = onSetGenre(genreDraft);
    if (ok) setModalKind(null);
  };

  // 弹框关闭后立刻失焦归还焦点，避免残留焦点打断码字输入
  useEffect(() => {
    if (modalKind === null) {
      setNameDraft("");
      setGenreDraft("");
    }
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
            {
              // 题材：AI 起名 / 润色的风格锚点。建书时可跳过，所以必须能事后补
              key: "genre",
              icon: <TagsOutlined />,
              label: activeGenre ? `题材：${activeGenre}` : "设置题材",
              disabled: !activeWorkName,
            },
            { type: "divider" as const },
            {
              // 三个导出维度收进一个子菜单：菜单只扫两屏长度，
              // 「导出」作为一个意图整体出现，比三条平级项更好扫
              key: "export",
              icon: <ExportOutlined />,
              label: "导出 TXT",
              disabled: !activeWorkName,
              children: [
                {
                  key: "export-book",
                  icon: <FileTextOutlined />,
                  label: "整本",
                  disabled: !activeMeta || activeMeta.chapters === 0,
                },
                {
                  key: "export-volume",
                  icon: <FileAddOutlined />,
                  label: "当前卷",
                  disabled: !hasActiveChapter,
                },
                {
                  key: "export-chapter",
                  icon: <FileTextOutlined />,
                  label: "当前章",
                  disabled: !hasActiveChapter,
                },
              ],
            },
            { type: "divider" as const },
            {
              key: "delete",
              icon: <DeleteOutlined />,
              label: "删除当前作品",
              danger: true,
              disabled: !activeWorkName,
            },
            /* 调试项（清空全部作品并重新播种模板）不进正式构建的菜单：
               与用户动作并列是噪音，且属高危操作 */
            ...(import.meta.env.DEV
              ? [
                  { type: "divider" as const },
                  {
                    key: "reset-template",
                    icon: <ReloadOutlined />,
                    label: "重置为模板书籍（调试）",
                  },
                ]
              : []),
          ],
          onClick: ({ key }) => {
            if (key === "create") openCreate();
            else if (key === "rename") openRename();
            else if (key === "genre") openGenre();
            else if (key === "export-book") onExportBook();
            else if (key === "export-volume") onExportVolume();
            else if (key === "export-chapter") onExportChapter();
            else if (key === "delete") setModalKind("delete");
            else if (key === "reset-template") setModalKind("reset-template");
          },
        }}
      >
        <Button
          className="nv-topbar__icon"
          aria-label="作品管理"
          title="作品管理"
        >
          <FolderOpenOutlined />
        </Button>
      </Dropdown>

      <Modal
        open={modalKind === "create" || modalKind === "rename"}
        title={modalKind === "create" ? "新建作品" : "重命名作品"}
        okText={modalKind === "create" ? "创建并开写" : "确定"}
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
        {/* 编辑器的「新建作品」是码字途中的顺手动作，不给它上两步流程：
            题材在这里只是一个可留空的输入框，空着就是「未设置」 */}
        {modalKind === "create" ? (
          <>
            <AutoComplete
              className="nv-work-menu__genre"
              value={genreDraft}
              options={[...GENRE_OPTIONS]}
              placeholder="题材（可不填，之后也能补）"
              aria-label="作品题材"
              onChange={(value: string) => setGenreDraft(value.slice(0, GENRE_MAX_LENGTH))}
              filterOption={(input, option) =>
                String(option?.value ?? "").includes(input.trim())
              }
            />
            <p className="nv-work-menu__genre-hint">
              题材用于 AI 起名与润色的风格参考，跳过不影响写作
            </p>
          </>
        ) : null}
      </Modal>

      <Modal
        open={modalKind === "genre"}
        title="作品题材"
        okText="保存"
        cancelText="取消"
        width={380}
        onOk={confirmGenre}
        onCancel={() => setModalKind(null)}
        destroyOnHidden
      >
        <AutoComplete
          className="nv-work-menu__genre"
          value={genreDraft}
          options={[...GENRE_OPTIONS]}
          placeholder="选一个题材，或直接填写"
          aria-label="作品题材"
          onChange={(value: string) => setGenreDraft(value.slice(0, GENRE_MAX_LENGTH))}
          filterOption={(input, option) => String(option?.value ?? "").includes(input.trim())}
          autoFocus
        />
        <p className="nv-work-menu__genre-hint">
          AI 起名与润色会参考题材调整用字风格；留空保存即清除题材
        </p>
      </Modal>

      <Modal
        open={deleting}
        title="删除作品"
        okText="移入回收站"
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
          将把该作品（
          <strong>
            {activeMeta ? `${activeMeta.volumes} 卷 / ${activeMeta.chapters} 章（约 ${formatThousands(activeMeta.words)} 字）` : "全部卷章"}
          </strong>
          ）连同全部要素卡、灵感、伏笔与历史快照一起移入回收站。
        </p>
        <p className="nv-work-menu__delete-hint">
          可在书架顶栏「回收站」里 30 天内原样恢复；超过保留期才会彻底删除。
        </p>
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
  },
);
