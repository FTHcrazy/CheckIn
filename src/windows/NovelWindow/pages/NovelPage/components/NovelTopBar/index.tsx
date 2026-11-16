import { Button, Dropdown, Select, Tooltip } from "antd";
import type { MenuProps } from "antd";
import type { MouseEvent as ReactMouseEvent, ReactNode, Ref } from "react";
import { useState } from "react";
import {
  ArrowLeftOutlined,
  ControlOutlined,
  LayoutOutlined,
  LoadingOutlined,
  MenuOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import SvgIcon from "@/shared/components/SvgIcon";
import { formatShortcut, useShortcutBindings } from "@/shared/shortcuts";
import bookSettingSvg from "@/assets/novel/book-setting.svg?raw";
import historySvg from "@/assets/novel/history.svg?raw";
import packSvg from "@/assets/novel/pack.svg?raw";
import readModeSvg from "@/assets/novel/read-mode.svg?raw";
import { SAVE_STATE_TEXT } from "../../novel-config";
import { formatClock, formatThousands, type WorkMeta } from "../../novel-utils";
import { useSaveState, editorActions } from "../../store/useNovelEditorStore";
import WorkManageMenu, { type WorkManageMenuHandle } from "../WorkManageMenu";
import type { NovelWork } from "../../types";
import "./index.scss";

interface NovelTopBarProps {
  works: NovelWork[];
  activeWorkId: string;
  /** 作品管理菜单的命令式句柄（空书架空态里「新建作品」复用它） */
  menuRef?: Ref<WorkManageMenuHandle>;
  /** 作品聚合信息（R29）：章节数 / 字数，随下拉选项展示 */
  workMeta: Map<string, WorkMeta>;
  volumeName: string;
  chapterName: string;
  leftOpen: boolean;
  rightOpen: boolean;
  settingsOpen: boolean;
  /** 历史快照抽屉开合状态：菜单项呈勾选态 */
  snapshotOpen: boolean;
  /** 设定中心（本书设定）开合状态：菜单项呈勾选态 */
  settingCenterOpen: boolean;
  /**
   * 阅读模式是否开启（O-05）。
   *
   * 状态本身住在 `EditorSettings`（store）：它是排版偏好的一个字段，抽屉里也
   * 有同一个开关。顶栏这颗只是「可见入口」——两处必须读同一个源，否则会出现
   * 「顶栏显示开了、正文还能改」这种自相矛盾。
   */
  readMode: boolean;
  onSelectWork: (workId: string) => void;
  onCreateWork: (name: string, genre?: string) => boolean;
  onRenameWork: (name: string) => boolean;
  /** 设置当前作品题材（2.7.1，空串 = 清空） */
  onSetWorkGenre: (genre: string) => boolean;
  /**
   * AI 入口是否**存在**（REQ-063）。顶栏本身没有 AI 按钮（续写已搬到正文区
   * 悬浮按钮），这里只是把口径透传给作品管理菜单 —— 它里面有两句「题材用于
   * AI 起名与润色」的提示，总开关关掉后要换成不提 AI 的说法。
   */
  aiVisible?: boolean;
  onDeleteWork: () => void;
  onResetTemplate: () => void;
  onExportBook: () => void;
  onExportVolume: () => void;
  onExportChapter: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleSettings: () => void;
  /** 历史快照按钮即开关：开 → 关 → 开 循环切换 */
  onToggleHistory: () => void;
  /** 行囊：唤起独立行囊窗口（单实例，重复点击仅聚焦），Ctrl+Shift+B 同效 */
  onOpenPack: () => void;
  /**
   * 行囊窗口正在打开（点过按钮、窗口尚未真正可见）。
   *
   * 独立窗口首次创建要等整个 SPA 装载（dev 下 1–3s），期间屏幕上没有任何变化。
   * 没有这个态，作者只会看到「点了没反应」然后补点一次 —— 而第二次往往正好
   * 撞在装载完成前后，于是被记成「要点两次才弹出行囊窗口」（REQ-054）。
   *
   * **刻意不用 `Button` 的 `loading` 属性**：antd 的 loading 会把 onClick 一起吞掉，
   * 而「再点一次」恰恰是窗口落到后面时的唯一退路（主进程已开分支会 `raiseWindow`）。
   * 这里只换内容（图标 → 转圈），把点击留着。
   */
  packOpening?: boolean;
  /**
   * 设定中心（本书设定）：按钮即开关 —— 再点一次收起（REQ-050 修法 ③）。
   * 与「快照」「排版」一致的 toggle 语义，避免「第二次点击看起来没反应」。
   */
  onToggleSettingCenter: () => void;
  /** 阅读模式开关（O-05）：F12 同效 */
  onToggleReadMode: () => void;
  /** 返回书架（书架主页接入后传入）；未传则不渲染返回按钮 */
  onBackToShelf?: () => void;
  /**
   * 「点击已真正落到顶栏上」时的通知：由页面注入，用一次状态更新收掉页内浮层
   * （设定中心 / 类型管理的 Modal 遮罩）。REQ-053 见 `useNovelViewState` 的注释。
   *
   * 为什么挂在 **click 捕获阶段**而不是 mousedown：mousedown 就把浮层关掉的话，
   * 遮罩会立刻回到「正在退场但仍铺满视口」的状态（antd 离场动画期间 wrap 还在），
   * 紧接着的 mouseup / click 又被它吃掉 —— 等于白改一层。click 已经派发到按钮，
   * 这时候收浮层才不会反过来抢走同一次点击。
   */
  onDismissOverlays?: () => void;
}

/**
 * 编辑器顶栏（设计方案 §05：44px · 作品切换 / 面包屑 / 保存状态 / 面板开关 / 设置）
 *
 * 保存状态只占一格，不加 spinner 遮罩——这是「零打断」原则在顶栏上的体现。
 *
 * 保存态由本组件直接订阅 store：打字时它每键都在变，若由页面根持有再透传，
 * 每敲一个字都要把整棵树推一遍。
 *
 * **入口收敛（O-02 / O-01，v2.57）**：原来六颗无文字图标同权平铺，其中两颗是
 * 布局开关、四颗是入口，扫读时分不出主次。现在按语义分三组：
 *
 * ```
 * 章节栏 · 支撑面板 ┃ 阅读模式 · 排版与偏好 ┃ ⋯
 * ```
 *
 * 行囊 / 历史快照 / 设定中心三个低频入口进「⋯」，并补上文字说明 —— 图标本身
 * （书本 / 时钟 / 图层）无法自解释，同一排里并列只会变成「点开才知道」。
 */
export default function NovelTopBar({
  works,
  activeWorkId,
  menuRef,
  workMeta,
  volumeName,
  chapterName,
  leftOpen,
  rightOpen,
  settingsOpen,
  snapshotOpen,
  settingCenterOpen,
  readMode,
  onSelectWork,
  onCreateWork,
  onRenameWork,
  onSetWorkGenre,
  onDeleteWork,
  onResetTemplate,
  onExportBook,
  onExportVolume,
  onExportChapter,
  onToggleLeft,
  onToggleRight,
  onToggleSettings,
  onToggleSettingCenter,
  onToggleHistory,
  onToggleReadMode,
  onOpenPack,
  onBackToShelf,
  onDismissOverlays,
  packOpening = false,
  aiVisible = true,
}: NovelTopBarProps) {
  const { saveState, lastSavedAt } = useSaveState();
  const bindings = useShortcutBindings();
  const [moreOpen, setMoreOpen] = useState(false);
  /** 失败态的重试进行中：只用来挡住连点，不接管 saveState（那是 store 的事） */
  const [retrying, setRetrying] = useState(false);

  /**
   * 保存失败 → 点击即重试（O-08）。
   *
   * 走 `flushSave()`（返回 Promise<boolean>）而不是再存一次当前章：它就是
   * 自动保存那条链路的入口，重试成功会把 saveState 一起推回 saved，
   * 顶栏不用自己猜结果。
   */
  const handleRetrySave = async (): Promise<void> => {
    if (retrying) return;
    setRetrying(true);
    try {
      await editorActions.flushSave();
    } finally {
      setRetrying(false);
    }
  };
  const activeWork = works.find((work) => work.id === activeWorkId) ?? null;
  const activeMeta = activeWorkId ? workMeta.get(activeWorkId) : undefined;
  const hasActiveChapter = (activeMeta?.chapters ?? 0) > 0 && Boolean(chapterName);

  /** 菜单右侧的键位提示跟着用户改过的绑定走（不是写死文案） */
  const keysOf = (id: string): string => formatShortcut(bindings[id] ?? "");

  /**
   * 顶栏任意一颗按钮被点到 → 先收掉页内浮层（REQ-053）。
   *
   * 用捕获阶段而不是逐颗包一层 onClick：顶栏里有下拉、菜单、四类开关与窗口级入口，
   * 逐颗包会把「离开浮层」这件横切的事复制十几遍，漏一颗就是下次的口子。
   * 例外只有一处：「设定中心」自己就是那颗浮层的开关（`data-page-overlay-keep-open`），
   * 若这里也关一次，就会「先关、再被 toggle 打开」，表现为点了没反应。
   *
   * O-02 之后「设定中心」搬进了溢出菜单（菜单渲染在 body 上的浮层里，不经过这条
   * 捕获链），所以那颗菜单项自己带 `data-page-overlay-keep-open` 也不为过 ——
   * 保留标记是为了让「它是开关本体」这件事在 DOM 上仍然可查。
   */
  const handleClickCapture = (
    event: ReactMouseEvent<HTMLDivElement>,
  ): void => {
    if (!onDismissOverlays) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("[data-page-overlay-keep-open]")
    ) {
      return;
    }
    onDismissOverlays();
  };

  /**
   * 菜单图标统一盒。
   *
   * antd 给 `.ant-dropdown-menu-item-icon` 的默认字号是 `fontSizeSM`（12px），
   * 而这三行是「标题 + 说明」两级文字摞起来的（约 30px 高），12px 图标贴在左侧
   * 只剩一个小点。18px 让图标高度接近两行文字块的视觉重心 —— 菜单项是两级结构，
   * 需要一个比顶栏 16px 图标更重的锚点，否则三行扫下来仍然只有字。
   */
  const menuIcon = (node: ReactNode): ReactNode => (
    <span className="nv-topbar__menu-ico">{node}</span>
  );

  /**
   * 低频入口菜单（「本书内容」）。
   *
   * 分组标题 `本书内容` 是 O-01 的落点：三处「设置」类入口按「本书内容 / 本书外观 /
   * 应用设置」分工，「排版与偏好」留在顶栏（本书外观），其余三个进这组。
   */
  const moreItems: MenuProps["items"] = [
    {
      type: "group",
      label: "本书内容",
      children: [
        {
          key: "setting",
          icon: menuIcon(<SvgIcon svg={bookSettingSvg} />),
          label: (
            <span
              className="nv-topbar__more-item"
              data-tour-target="topbar-setting"
              data-page-overlay-keep-open="settingCenter"
            >
              <b>设定中心</b>
              <span>
                {settingCenterOpen ? "已展开 · 世界观 / 境界 / 分类" : "世界观 · 境界阶梯 · 分类"}
              </span>
            </span>
          ),
          extra: keysOf("openSettings"),
        },
        {
          key: "snapshot",
          /* 三行必须都有图标：此前这一项 `icon: null`，标题比上下两行左移 9px+16px，
             扫下来像漏了一格（对齐交互稿里「三行图标 + 两行键位」的形态） */
          icon: menuIcon(<SvgIcon svg={historySvg} />),
          label: (
            <span className="nv-topbar__more-item">
              <b>历史快照</b>
              <span>{snapshotOpen ? "已展开 · 每章可回滚" : "每章多版 · 可回滚"}</span>
            </span>
          ),
        },
        {
          key: "pack",
          icon: menuIcon(
            packOpening ? <LoadingOutlined spin /> : <SvgIcon svg={packSvg} />,
          ),
          label: (
            <span className="nv-topbar__more-item" data-tour-target="topbar-pack">
              <b>行囊</b>
              <span>{packOpening ? "正在打开…" : "主角状态盘点"}</span>
            </span>
          ),
          extra: keysOf("togglePack"),
        },
      ],
    },
  ];

  const handleMoreClick: MenuProps["onClick"] = ({ key }) => {
    setMoreOpen(false);
    if (key === "setting") onToggleSettingCenter();
    else if (key === "snapshot") onToggleHistory();
    else if (key === "pack") onOpenPack();
  };

  return (
    <div className="nv-topbar" onClickCapture={handleClickCapture}>
      {onBackToShelf && (
        <Tooltip title="返回书架">
          <Button
            className="nv-topbar__back"
            onClick={onBackToShelf}
            aria-label="返回书架"
          >
            <ArrowLeftOutlined />
            <span>书架</span>
          </Button>
        </Tooltip>
      )}

      <Select
        className="nv-topbar__work"
        value={activeWorkId}
        options={works.map((work) => ({ value: work.id, label: work.name }))}
        onChange={onSelectWork}
        variant="borderless"
        size="small"
        popupMatchSelectWidth={220}
        optionRender={(option) => {
          const meta = workMeta.get(String(option.value));
          return (
            <div className="nv-topbar__work-option">
              <span className="nv-topbar__work-name">{option.label}</span>
              {meta && (
                <span className="nv-topbar__work-meta">
                  {meta.chapters} 章 · {formatThousands(meta.words)} 字
                </span>
              )}
            </div>
          );
        }}
      />

      <WorkManageMenu
        ref={menuRef}
        activeWorkName={activeWork?.name ?? ""}
        activeGenre={activeWork?.genre}
        activeMeta={activeMeta}
        hasActiveChapter={hasActiveChapter}
        onCreate={onCreateWork}
        onRename={onRenameWork}
        onSetGenre={onSetWorkGenre}
        onDelete={onDeleteWork}
        onResetTemplate={onResetTemplate}
        onExportBook={onExportBook}
        onExportVolume={onExportVolume}
        onExportChapter={onExportChapter}
        aiVisible={aiVisible}
      />

      {/* 语义分组：左侧是「哪部作品」的切换与管理，右侧是「读到哪」的位置 */}
      <span className="nv-topbar__divider" aria-hidden />

      <div className="nv-topbar__crumb">
        <span className="nv-topbar__crumb-volume">{volumeName}</span>
        <span className="nv-topbar__crumb-sep">/</span>
        <span className="nv-topbar__crumb-chapter">{chapterName}</span>
      </div>

      {saveState === "failed" ? (
        /* 保存失败（O-08）：整格变成按钮，点一下立刻重试。
           此前只是一行变红的文字 —— 用户看见「保存失败」却无处可点，只能
           反复 Ctrl+S 猜是不是生效了。原因走 Tooltip：主进程目前不区分
           磁盘满 / 无权限（没有错误码透传），所以只能说清「查什么」，
           不能说死是哪一种。 */
        <Tooltip title="写入没有成功。请检查磁盘剩余空间与数据目录权限，点此重试。">
          <Button
            className="nv-topbar__save nv-topbar__save--failed"
            onClick={() => void handleRetrySave()}
            loading={retrying}
            aria-label="保存失败，点击重试"
          >
            {!retrying && <span className="nv-topbar__save-dot" />}
            <span>{retrying ? "正在重试…" : "保存失败 · 点击重试"}</span>
          </Button>
        </Tooltip>
      ) : (
        <div className={`nv-topbar__save nv-topbar__save--${saveState}`}>
          <span className="nv-topbar__save-dot" />
          <span>
            {saveState === "saved" && lastSavedAt
              ? `${SAVE_STATE_TEXT.saved} · ${formatClock(lastSavedAt)}`
              : SAVE_STATE_TEXT[saveState]}
          </span>
        </div>
      )}
      <div className="nv-topbar__actions">
        {/* 组 1：本页布局开关（每章都要用） */}
        <Tooltip title={leftOpen ? "收起章节栏" : "展开章节栏"}>
          <Button
            className={`nv-topbar__icon${leftOpen ? " is-on" : ""}`}
            onClick={onToggleLeft}
            aria-label="章节栏"
            aria-pressed={leftOpen}
          >
            <MenuOutlined />
          </Button>
        </Tooltip>
        <Tooltip title={rightOpen ? "收起支撑面板" : "展开支撑面板"}>
          <Button
            className={`nv-topbar__icon${rightOpen ? " is-on" : ""}`}
            onClick={onToggleRight}
            aria-label="支撑面板"
            aria-pressed={rightOpen}
          >
            <LayoutOutlined />
          </Button>
        </Tooltip>
        <span className="nv-topbar__divider" aria-hidden />
        {/* 组 2：读与写的外观。阅读模式原本埋在排版抽屉第二块里 —— 能力完整，
            却没有任何人找得到（O-05，全表唯一 P0）。它和「专注模式」是同一层
            级的视图切换，所以给一颗常驻按钮，开态补出「读」字标签。
            不在开态时也保留 30px 见方，避免一开一关把整排图标顶来顶去。 */}
        <Tooltip title={`阅读模式 · ${keysOf("toggleReadMode")}`}>
          <Button
            className={`nv-topbar__icon nv-topbar__icon--read${readMode ? " is-on" : ""}`}
            onClick={onToggleReadMode}
            aria-label="阅读模式"
            aria-pressed={readMode}
          >
            <SvgIcon svg={readModeSvg} />
            {readMode && <span className="nv-topbar__icon-label">读</span>}
          </Button>
        </Tooltip>
        {/* 与标题栏的「设置」（全局：外观/账号）区分：这里只管排版与码字偏好，
            图标用滑杆而不是齿轮，避免同屏两颗齿轮各开各的设置。
            `data-drawer-keep-open` 是给 SettingsDrawer 的「点外部关闭」看的：
            这颗按钮是它的开关，落在它上面的 mousedown 不算「点了抽屉外部」——
            否则会「先被文档级监听关掉、再被 toggle 打开」，表现为点了没反应。 */}
        <Tooltip title="排版与偏好 · 本书外观">
          <Button
            className={`nv-topbar__icon${settingsOpen ? " is-on" : ""}`}
            onClick={onToggleSettings}
            aria-label="排版与偏好"
            aria-pressed={settingsOpen}
            data-drawer-keep-open="settings"
          >
            <ControlOutlined />
          </Button>
        </Tooltip>
        <span className="nv-topbar__divider" aria-hidden />
        {/* 组 3：低频入口（行囊 / 历史快照 / 设定中心）收进「⋯」。 */}
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          open={moreOpen}
          onOpenChange={setMoreOpen}
          menu={{ items: moreItems, onClick: handleMoreClick }}
        >
          <Button
            className={`nv-topbar__icon nv-topbar__icon--more${moreOpen ? " is-on" : ""}`}
            aria-label="更多入口"
            aria-expanded={moreOpen}
            title="更多"
            data-tour-target="topbar-more"
          >
            <MoreOutlined />
          </Button>
        </Dropdown>
      </div>
    </div>
  );
}
