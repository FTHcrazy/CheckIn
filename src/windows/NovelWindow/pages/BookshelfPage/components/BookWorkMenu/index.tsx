import { useEffect } from "react";
import { AutoComplete, Button, Input, Modal } from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  PictureOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { GENRE_MAX_LENGTH, GENRE_OPTIONS } from "@/shared/novel/genres";
import type { ShelfWorkActions } from "../../hooks/useShelfWorkActions";
import "./index.scss";

/** 菜单兜底尺寸：只用来把菜单夹回视口，真实高度仍由 CSS max-height + 滚动兜住 */
const MENU_WIDTH = 224;
const MENU_HEIGHT = 248;

interface BookWorkMenuProps {
  /** 整包接 hook 返回值，页面不必逐项透传（AGENTS §6.4：菜单细节不进 Page） */
  actions: ShelfWorkActions;
}

/**
 * 书卡右键菜单（2.56.0）：重命名 / 修改题材类型 / 导入图书封面 /
 * 导出当前作品 / 删除当前作品。
 *
 * 用「透明捕获层 + 定点浮层」而不是 antd Dropdown 的 contextMenu 触发：
 * 书卡本身是 antd Button（组件库卡片），Dropdown 会给它克隆一个 ref 与
 * className，函数组件接不住；而且菜单要按**光标**落位并夹回视口，自建浮层
 * 更直接。菜单项仍是组件库 Button（§6.1.2），外观只动 `--ant-button-*`。
 *
 * 三个需要输入的动作（重命名 / 题材 / 删除确认）用 Modal，菜单先让位；
 * 两个直接动作（封面 / 导出）点完立刻收起菜单，再弹原生文件对话框。
 */
export default function BookWorkMenu({ actions }: BookWorkMenuProps) {
  const {
    target,
    modalKind,
    activeWork,
    nameDraft,
    genreDraft,
    nameError,
    busy,
    menuVisible,
    setNameDraft,
    setGenreDraft,
    closeMenu,
    openRename,
    openGenre,
    openDelete,
    confirmName,
    confirmGenre,
    confirmDelete,
    pickCover,
    exportWork,
  } = actions;

  // Esc / 窗口尺寸变化都收起：菜单是按打开那一瞬的视口坐标夹取的，
  // 尺寸一变就可能飘到屏幕外。右键点空白处也由捕获层直接收起。
  useEffect(() => {
    if (!target) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeMenu);
    };
  }, [target, closeMenu]);

  const left = target
    ? Math.max(8, Math.min(target.x, window.innerWidth - MENU_WIDTH - 8))
    : 0;
  const top = target
    ? Math.max(8, Math.min(target.y, window.innerHeight - MENU_HEIGHT - 8))
    : 0;

  return (
    <>
      {target && (
        <div
          className="bs-workmenu__mask"
          aria-hidden="true"
          onClick={closeMenu}
          onContextMenu={(event) => {
            event.preventDefault();
            closeMenu();
          }}
        />
      )}

      {menuVisible && activeWork && (
        <div
          className="bs-workmenu"
          style={{ left, top }}
          role="menu"
          aria-label={`《${activeWork.name}》作品操作`}
          onContextMenu={(event) => event.preventDefault()}
        >
          <p className="bs-workmenu__title" title={activeWork.name}>
            《{activeWork.name}》
          </p>
          <div className="bs-workmenu__items">
            <Button
              role="menuitem"
              className="bs-workmenu__item"
              onClick={openRename}
              disabled={busy}
            >
              <EditOutlined aria-hidden />
              重命名
            </Button>
            <Button
              role="menuitem"
              className="bs-workmenu__item"
              onClick={openGenre}
              disabled={busy}
            >
              <TagsOutlined aria-hidden />
              修改题材类型
            </Button>
            <Button
              role="menuitem"
              className="bs-workmenu__item"
              onClick={() => void pickCover()}
              disabled={busy}
            >
              <PictureOutlined aria-hidden />
              导入图书封面
            </Button>
            <Button
              role="menuitem"
              className="bs-workmenu__item"
              onClick={() => void exportWork()}
              disabled={busy}
            >
              <ExportOutlined aria-hidden />
              导出当前作品
            </Button>
          </div>
          <div className="bs-workmenu__divider" />
          <Button
            role="menuitem"
            className="bs-workmenu__item is-danger"
            onClick={openDelete}
            disabled={busy}
          >
            <DeleteOutlined aria-hidden />
            删除当前作品
          </Button>
        </div>
      )}

      <Modal
        open={modalKind === "rename"}
        title="重命名作品"
        okText="保存"
        cancelText="取消"
        width={380}
        confirmLoading={busy}
        onOk={() => void confirmName()}
        onCancel={closeMenu}
        destroyOnHidden
      >
        <Input
          value={nameDraft}
          autoFocus
          maxLength={50}
          placeholder="作品名称"
          aria-label="作品名称"
          status={nameError ? "error" : undefined}
          onChange={(event) => setNameDraft(event.target.value)}
          onPressEnter={() => void confirmName()}
        />
        {nameError && <p className="bs-workmenu__form-error">{nameError}</p>}
      </Modal>

      <Modal
        open={modalKind === "genre"}
        title="修改题材类型"
        okText="保存"
        cancelText="取消"
        width={380}
        confirmLoading={busy}
        onOk={() => void confirmGenre()}
        onCancel={closeMenu}
        destroyOnHidden
      >
        <AutoComplete
          value={genreDraft}
          options={[...GENRE_OPTIONS]}
          placeholder="选一个题材，或直接填写"
          aria-label="作品题材"
          onChange={(value: string) => setGenreDraft(value.slice(0, GENRE_MAX_LENGTH))}
          filterOption={(input, option) =>
            String(option?.value ?? "").includes(input.trim())
          }
          autoFocus
        />
        <p className="bs-workmenu__form-hint">
          用字风格会参考题材；留空保存即清除题材。
        </p>
      </Modal>

      <Modal
        open={modalKind === "delete"}
        title="删除当前作品"
        okText="移入回收站"
        cancelText="取消"
        width={420}
        okButtonProps={{ danger: true }}
        confirmLoading={busy}
        onOk={() => void confirmDelete()}
        onCancel={closeMenu}
        destroyOnHidden
      >
        <p className="bs-workmenu__delete-name">《{activeWork?.name ?? ""}》</p>
        <p>
          将把这部作品连同卷章、要素、灵感与历史快照一起移入回收站，书架上不再显示。
        </p>
        <p className="bs-workmenu__form-hint">
          可在书架顶栏「回收站」里 30 天内原样恢复；超过保留期才会彻底删除。
        </p>
      </Modal>
    </>
  );
}
