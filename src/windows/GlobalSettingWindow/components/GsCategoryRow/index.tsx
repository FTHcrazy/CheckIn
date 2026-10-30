/**
 * 全局设定中心 · 左栏分类行
 *
 * 一行：拖拽把手 + 色点 + 名称（双击就地改名）+ 等级数 + 引用徽标 + 右键菜单。
 *
 * 三条硬约束：
 * - **自带造型 ⇒ 用 `Button` 承载 + 清零点 mixin**（§6.1.2 第 3 条），且清零与
 *   `--ant-button-*` 变量写在**同一个** `.gs-cat-row.ant-btn` 选择器里；
 * - **不在 `<button>` 里嵌 `<button>`**（§6.1.2 第 4 条）：右键菜单用 `Dropdown`
 *   包在行按钮**外面**（`trigger={["contextMenu"]}`），行内没有第二个按钮；
 * - **不在 `<button>` 里嵌 `<input>`**：改名态换成一个 `div` 行壳承载输入框。
 *
 * sortable id 一律用 shared 的 `catId()`（**禁止**自拼 `cat:${id}`）——
 * `handleDragEnd` 按前缀分流，自拼会让跨栏搬移失效。
 */

import { HolderOutlined } from "@ant-design/icons";
import { Button, Dropdown, Input, Tooltip, type InputRef } from "antd";
import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SettingCategory } from "@/shared/novel/setting-types";
import { formatReferenceCountLabel } from "@/shared/novel/setting-reference";
import { catId } from "@/shared/components/SettingCenter/setting-center-shared";
import "./index.scss";

export interface GsCategoryRowProps {
  category: SettingCategory;
  /** 是否是当前选中的分类 */
  isOn: boolean;
  /** 是否允许拖拽（自定义顺序 + 无搜索 + 无筛选） */
  canDrag: boolean;
  /** 是否是本次拖拽的源 */
  isDragSource: boolean;
  /** 是否处于就地改名态 */
  renaming: boolean;
  onSelect: () => void;
  onBeginRename: () => void;
  /** 提交改名（空 / 纯空白由 view 层判定为取消） */
  onCommitRename: (value: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
  /** 设为境界体系 / 转为普通分类（按 kind 互斥，文案由菜单项决定） */
  onToggleKind: () => void;
}

/**
 * 就地改名的输入框（IME 三件套）
 *
 * 照抄 `TodoPage/components/EditableText`：**非受控** `Input`（不传 `value`）
 * + `composingRef` + `skipBlurRef`：
 * - 非受控 ⇒ React 永不回写 DOM，中文拼写过程不会被打断；
 * - `skipBlurRef` ⇒ `Esc` 先于 `blur` 生效（否则浏览器先触发 blur，Esc 被吃掉）；
 * - `onPressEnter` 里判 `isComposing` ⇒ 选词的回车不会误提交。
 *
 * 进入编辑时**原值全选**（PRD R5①），改完回车即存。
 */
function GsRenameInput({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<InputRef>(null);
  const composingRef = useRef(false);
  const skipBlurRef = useRef(false);

  const getDomValue = useCallback(
    (): string => inputRef.current?.input?.value ?? "",
    [],
  );

  useEffect(() => {
    const nativeInput = inputRef.current?.input;
    if (!nativeInput) return;
    // 原值已由非受控 defaultValue 灌入，这里只负责聚焦 + 全选（PRD R5①）
    nativeInput.focus();
    nativeInput.select();
  }, []);

  return (
    <Input
      ref={inputRef}
      className="gs-cat-row__input"
      size="small"
      // 【关键】不传 value ⇒ 非受控 ⇒ IME 安全；defaultValue 只是初始占位
      defaultValue={initialValue}
      aria-label="分类名"
      spellCheck={false}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
      }}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Escape") {
          // ⚠️ 必须停冒泡：否则文档级快捷键的 Esc 级联会再处理一次（双重退出）
          event.stopPropagation();
          skipBlurRef.current = true;
          onCancel();
        }
      }}
      onPressEnter={(event: KeyboardEvent<HTMLInputElement>) => {
        // 拼写中的 Enter（选词 / 上屏）不提交
        if (composingRef.current || event.nativeEvent.isComposing) return;
        skipBlurRef.current = true;
        onCommit(getDomValue());
      }}
      onBlur={() => {
        if (skipBlurRef.current) {
          skipBlurRef.current = false;
          return;
        }
        if (composingRef.current) return;
        const value = getDomValue();
        // 失焦：非空提交、空则取消（与新建输入框的宽松口径一致）
        if (value.trim()) onCommit(value);
        else onCancel();
      }}
    />
  );
}

export default function GsCategoryRow({
  category,
  isOn,
  canDrag,
  isDragSource,
  renaming,
  onSelect,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onToggleKind,
}: GsCategoryRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: catId(category.id), disabled: !canDrag });

  /**
   * 摘掉 dnd-kit 自带的 `role="button"` / `tabIndex`。
   *
   * 本行的交互元素是内部那枚真的 antd `Button`（点选 / 双击改名都挂在它上面），
   * 外层容器再挂一个 button role 会让辅助技术读到「按钮里还有按钮」，右键菜单
   * 也触发在这一层。只保留 aria-* 描述与拖动所需属性。
   * （shared `CategoryList` 不需要这一步：它行内没有真按钮。）
   */
  const rowAttributes = { ...attributes, role: undefined, tabIndex: undefined };

  const refCount = category.refCount ?? 0;
  const isRealm = category.kind === "realm";

  /** 右键菜单展开即选中该分类（R6②：菜单操作的对象必须先明确） */
  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (open) onSelect();
    },
    [onSelect],
  );

  const menu = {
    items: [
      { key: "rename", label: "重命名" },
      {
        key: "kind",
        label: isRealm ? "转为普通分类" : "设为境界体系",
      },
      { type: "divider" as const },
      { key: "delete", label: "删除", danger: true },
    ],
    onClick: ({ key }: { key: string }): void => {
      if (key === "rename") {
        onBeginRename();
        return;
      }
      if (key === "kind") {
        onToggleKind();
        return;
      }
      if (key === "delete") onDelete();
    },
  };

  return (
    <div
      ref={setNodeRef}
      {...rowAttributes}
      className={`gs-cat-slot${isDragSource || isDragging ? " is-drag" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {renaming ? (
        // 改名态：换 div 承载，避免 <input> 嵌进 <button>
        <div className="gs-cat-row is-editing">
          <span className="gs-cat-row__dot" style={{ background: category.color }} aria-hidden />
          <GsRenameInput
            initialValue={category.name}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
          />
        </div>
      ) : (
        <Dropdown
          trigger={["contextMenu"]}
          menu={menu}
          onOpenChange={handleOpenChange}
          // 弹层挂 body：用 classNames 挂类命中（antd 6 里 overlayClassName 已废弃；
          // Dropdown 的弹层类是 root，不是 popup）
          classNames={{ root: "gs-cat-row__menu" }}
        >
          <Button
            className={`gs-cat-row${isOn ? " is-on" : ""}`}
            aria-current={isOn ? "true" : undefined}
            onClick={onSelect}
            onDoubleClick={(event: MouseEvent<HTMLElement>) => {
              event.preventDefault();
              onBeginRename();
            }}
          >
            {canDrag ? (
              <Tooltip title="拖动调整顺序">
                <span className="gs-cat-row__grip" aria-hidden {...listeners}>
                  <HolderOutlined />
                </span>
              </Tooltip>
            ) : (
              <Tooltip title="切到「自定义顺序」且清空搜索 / 筛选后可拖拽">
                <span className="gs-cat-row__grip is-locked" aria-hidden>
                  <HolderOutlined />
                </span>
              </Tooltip>
            )}
            <span
              className="gs-cat-row__dot"
              style={{ background: category.color }}
              aria-hidden
            />
            {/* 两行式行体：名称独占一行，等级数与引用数并到第二行。
                单行式在 240px 栏宽下会把名称挤成「修仙·练…」，
                而这两个计数本来就不是扫读的第一目标。 */}
            <span className="gs-cat-row__body">
              <span className="gs-cat-row__name" title={category.note || category.name}>
                {category.name}
              </span>
              <span className="gs-cat-row__meta">
                <span className="gs-cat-row__count">{category.levels.length} 级</span>
                <span className="gs-cat-row__sep" aria-hidden>
                  ·
                </span>
                <span
                  className={`gs-cat-row__ref${refCount > 0 ? " is-on" : ""}`}
                  title="有多少部书正在引用这个分类"
                >
                  {formatReferenceCountLabel(refCount)}
                </span>
              </span>
            </span>
          </Button>
        </Dropdown>
      )}
    </div>
  );
}
