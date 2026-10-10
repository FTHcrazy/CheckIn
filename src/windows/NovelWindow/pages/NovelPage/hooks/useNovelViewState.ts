import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LAYOUT, PANEL_WIDTH, TOAST_DURATION_MS } from "../novel-config";
import { clampPanelWidth, parseJsonOrNull } from "../novel-utils";
import { fetchPanelWidth, savePanelWidth } from "../services/novel-service";
import { requestClosePackPanel, requestPackPeek } from "../components/CharacterPack/pack-config";
import type { EntityType } from "../types";

export type PanelTab = "outline" | "entity" | "note" | "search" | "tools";
export type EntityFilter = EntityType | "all";
export type ToastTone = "success" | "info" | "warning";

export interface ToastPayload {
  id: number;
  text: string;
  tone: ToastTone;
}

/**
 * 小说编辑器视图状态 Hook
 *
 * 负责：三栏折叠、专注 / 打字机模式、右栏 Tab 与筛选、浮层与抽屉开关、
 * 轻提示队列。全部是展示层状态，不触达数据，也不保存。
 */
export function useNovelViewState() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [typewriter, setTypewriter] = useState(false);
  // 全局标注层开关（PRD §2 风险对策：提供一键关闭标注层）。
  // 当前为会话级视图态，未并入 R5 settings 持久化——保持最小落地；
  // 后续若需跨会话记忆，并入 EditorSettings.annotationOn 即可。
  const [annotationOn, setAnnotationOn] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>("entity");
  const [entityFilter, setEntityFilter] = useState<EntityFilter>("all");
  const [detailEntityId, setDetailEntityId] = useState<string | null>(null);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 等级体系管理弹框（R25） */
  const [levelManagerOpen, setLevelManagerOpen] = useState(false);
  /** 自定义类型管理弹框（R23） */
  const [typeManagerOpen, setTypeManagerOpen] = useState(false);
  /**
   * 行囊面板（CharacterPack）：入口独立于侧边栏，默认「右侧让位」占位而非覆盖。
   * 面板内部状态（形态 / 宽度 / 模块折叠…）由它自己经 config 持久化，这里只持开关。
   */
  const [packOpen, setPackOpen] = useState(false);
  const [toast, setToast] = useState<ToastPayload | null>(null);

  /**
   * 右栏宽度（支撑面板改版）：基准 340，可拖拽 280–460。
   *
   * 属于视图状态而非排版设置，所以不并进 EditorSettings——持久化另走
   * config 的 `novel_panel_width` 键，与其他 view 状态一样由本 Hook 自持。
   * 拖拽过程只改内存，停手 300ms 后才落库（避免一次拖拽打出几十次 IPC）。
   */
  const [rightWidth, setRightWidthState] = useState<number>(LAYOUT.rightRailWidth);
  const widthLoadedRef = useRef(false);

  // 小屏自适应用的镜像 / 记忆 ref：effect 里读到最新值，又不把状态塞进依赖
  const leftOpenRef = useRef(leftOpen);
  const rightOpenRef = useRef(rightOpen);
  const rightWidthRef = useRef(rightWidth);
  const autoCollapsedRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    leftOpenRef.current = leftOpen;
  }, [leftOpen]);

  useEffect(() => {
    rightOpenRef.current = rightOpen;
  }, [rightOpen]);

  useEffect(() => {
    rightWidthRef.current = rightWidth;
  }, [rightWidth]);

  // 宽度恢复：loadedRef 门禁保证首帧的基准值不会先盖掉用户上次拖出来的宽度
  useEffect(() => {
    let cancelled = false;
    void fetchPanelWidth()
      .then((raw) => {
        if (cancelled) return;
        setRightWidthState(clampPanelWidth(parseJsonOrNull(raw)));
      })
      .catch(() => {
        // IPC 失败：保持基准宽度，拖拽链路照常可用
      })
      .finally(() => {
        if (!cancelled) widthLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!widthLoadedRef.current) return undefined;
    const timer = window.setTimeout(() => {
      void savePanelWidth(rightWidth);
    }, PANEL_WIDTH.debounceMs);
    return () => window.clearTimeout(timer);
  }, [rightWidth]);

  // 卸载兜底：拖完立刻关窗 / 切回书架时，300ms 防抖还没到点就被 clearTimeout
  // 取消了，最后一次拖动的宽度会丢（位置记忆有 beforeunload 兜底，宽度没有）
  useEffect(
    () => () => {
      if (!widthLoadedRef.current) return;
      void savePanelWidth(rightWidthRef.current);
    },
    [],
  );

  // 轻提示：2.4s 自动消失，pointer-events:none 由组件保证不阻塞输入（设计方案 §06）
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((text: string, tone: ToastTone = "success") => {
    setToast({ id: Date.now(), text, tone });
  }, []);

  const closeToast = useCallback(() => setToast(null), []);

  const toggleLeft = useCallback(() => {
    // 用户手动开合即接管：此后窗口变化不再还原左栏状态
    autoCollapsedRef.current = false;
    setLeftOpen((open) => !open);
  }, []);
  const toggleRight = useCallback(() => setRightOpen((open) => !open), []);
  const toggleTypewriter = useCallback(() => setTypewriter((on) => !on), []);
  /** 拖拽右栏边界：只更新内存宽度（夹取到 280–460），落库由上面 effect 防抖接管 */
  const setRightWidth = useCallback((next: number) => {
    setRightWidthState(clampPanelWidth(next));
  }, []);

  const toggleAnnotation = useCallback(() => setAnnotationOn((on) => !on), []);

  /**
   * 小屏自适应：三栏放不下时自动收起左栏给码字区让位。
   *
   * 判据是「窗口宽 - 当前占用的栏宽 < 正文最小可用宽度」，而不是写死一个
   * 窗口宽度阈值——右栏是用户按需打开的，它一开可用宽度立刻少一个面板宽
   * （拖宽到 460 时更挤），这时才收起左栏才是对的。左栏收起由本 effect 负责，右栏永不自动收
   * （用户刚点开的面板立刻消失会被当成 bug）。
   * 手动开合过左栏（toggleLeft）之后本机制即失效，交给用户自己决定。
   */
  useEffect(() => {
    const sync = (): void => {
      const railBudget =
        LAYOUT.leftRailWidth + (rightOpenRef.current ? rightWidthRef.current : 0);
      const tight = window.innerWidth - railBudget < LAYOUT.minStageWidth;

      if (tight) {
        if (!leftOpenRef.current) return;
        autoCollapsedRef.current = true;
        setLeftOpen(false);
        // 首次同步（挂载）不提示：窗口本来就小不是「刚发生的变化」
        if (mountedRef.current) showToast("窗口较窄，已收起章节树", "info");
        return;
      }
      // 宽回来只还原「被自动收起」的那次，不覆盖用户手动收起
      if (!autoCollapsedRef.current) return;
      autoCollapsedRef.current = false;
      setLeftOpen(true);
    };

    // 先同步再置位：挂载那一次不算「窗口变窄」，不提示
    sync();
    mountedRef.current = true;
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
    // ⚠️ 依赖必须是空：拖右栏时 rightWidth 每帧都变，写在依赖里就是「每帧
    // 解绑再重绑一次 resize 监听」（拖一次几十次 add/removeEventListener）。
    // 宽度与开关都从 ref 读，ref 在下面的同步 effect 里已更新
  }, []);

  // 专注模式 hides 顶栏 / 状态条 / 左右栏；Esc 只退出专注，不关窗（PRD §2 零打断）
  const toggleFocus = useCallback(() => {
    setFocusMode((on) => !on);
  }, []);

  const exitFocus = useCallback(() => setFocusMode(false), []);

  const openEntityDetail = useCallback((entityId: string) => {
    setDetailEntityId(entityId);
    setRightOpen(true);
  }, []);

  const closeEntityDetail = useCallback(() => setDetailEntityId(null), []);

  const openSnapshot = useCallback(() => setSnapshotOpen(true), []);
  const closeSnapshot = useCallback(() => setSnapshotOpen(false), []);
  /** 顶栏历史按钮即开关：再点一次收起快照抽屉 */
  const toggleSnapshot = useCallback(
    () => setSnapshotOpen((open) => !open),
    [],
  );
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  /** 顶栏齿轮即开关：再点一次关闭（抽屉无遮罩时这是主要关闭途径之一） */
  const toggleSettings = useCallback(
    () => setSettingsOpen((open) => !open),
    [],
  );
  const openJump = useCallback(() => setJumpOpen(true), []);
  const closeJump = useCallback(() => setJumpOpen(false), []);

  const openLevelManager = useCallback(() => setLevelManagerOpen(true), []);
  const closeLevelManager = useCallback(() => setLevelManagerOpen(false), []);
  const openTypeManager = useCallback(() => setTypeManagerOpen(true), []);
  const closeTypeManager = useCallback(() => setTypeManagerOpen(false), []);

  const openPack = useCallback(() => setPackOpen(true), []);
  /** 仅供无面板时的兜底；正常关闭一律走 `requestClosePackPanel()` 桥 */
  const closePack = useCallback(() => setPackOpen(false), []);
  /**
   * 顶栏图标与 Ctrl+Shift+B 都是开关。收起时必须过面板的受保护路径 ——
   * 直接 `setPackOpen(false)` 会跳过未保存拦截与草稿 flush，改动静默丢失。
   *
   * `peek = true`（顶栏按钮 Alt+点击）走「速览」：面板仍开着，只是切成半透明浮层、
   * 3 秒无操作自动收起。**它不写布局记忆**，所以这里只翻开关 + 请求面板换形态。
   */
  const togglePack = useCallback(
    (peek?: boolean) => {
      if (peek && !packOpen) {
        // 面板还没挂载 → 桥那头没人接，请求会被记成待办，面板一出现就生效。
        // 所以这里只需要先把面板开出来，**不用自己重试**。
        setPackOpen(true);
        requestPackPeek();
        return;
      }
      if (peek) {
        requestPackPeek();
        return;
      }
      if (packOpen) {
        if (!requestClosePackPanel()) setPackOpen(false);
        return;
      }
      setPackOpen(true);
    },
    [packOpen],
  );

  const selectPanelTab = useCallback((tab: PanelTab) => {
    setPanelTab(tab);
    setRightOpen(true);
  }, []);

  /** 打字机模式下额外让左右栏让位，避免视觉噪音 */
  const effectiveLeftOpen = useMemo(
    () => leftOpen && !focusMode,
    [leftOpen, focusMode],
  );
  const effectiveRightOpen = useMemo(
    () => rightOpen && !focusMode,
    [rightOpen, focusMode],
  );
  /** 行囊与左右栏同一口径：专注模式下一起让位（内容与草稿都不受影响） */
  const effectivePackOpen = useMemo(() => packOpen && !focusMode, [packOpen, focusMode]);

  return {
    leftOpen: effectiveLeftOpen,
    rightOpen: effectiveRightOpen,
    packOpen: effectivePackOpen,
    rightWidth,
    focusMode,
    typewriter,
    annotationOn,
    panelTab,
    entityFilter,
    detailEntityId,
    jumpOpen,
    snapshotOpen,
    settingsOpen,
    levelManagerOpen,
    typeManagerOpen,
    toast,
    toggleLeft,
    toggleRight,
    setRightWidth,
    toggleFocus,
    exitFocus,
    toggleTypewriter,
    toggleAnnotation,
    selectPanelTab,
    setEntityFilter,
    openEntityDetail,
    closeEntityDetail,
    openJump,
    closeJump,
    openLevelManager,
    closeLevelManager,
    openTypeManager,
    closeTypeManager,
    openPack,
    closePack,
    togglePack,
    openSnapshot,
    closeSnapshot,
    toggleSnapshot,
    openSettings,
    closeSettings,
    toggleSettings,
    showToast,
    closeToast,
  };
}
