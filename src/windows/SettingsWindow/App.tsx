import { useEffect, useMemo, useState } from "react";
import { SettingOutlined } from "@ant-design/icons";
import WindowHeader from "@/shared/components/WindowHeader";
import { useAiAvailability } from "@/shared/ai/hooks/useAiAvailability";
import SettingsNav from "./components/SettingsNav";
import {
  AI_FALLBACK_PAGE_ID,
  KNOWN_PAGE_IDS,
  buildNavGroups,
  buildPages,
} from "./settings-pages";

/**
 * SettingsWindow —— 全局设置窗口（全版本开放入口）。
 *
 * 骨架（1.48.0 改版）：**左分类导航 + 右内容页**，不再是「一列分区从头滚到尾」。
 * 窗口固定 900×680（见 `electron/main.ts` 的 `createSettingsWindow`），
 * 因此布局的职责划分是：导航定宽永不滚走、页面标题固定、只有页面内容各自滚动。
 *
 * 页面清单（导航项 + 内容区）的唯一事实源是 `./settings-pages.tsx`：
 * 它是纯数据 + 纯函数，不只因为有守卫要直接调 `buildPages()`，也因为清单现在
 * 要随 AI 总开关在运行期变化，不能留在组件文件里做模块级常量。
 *
 * 为什么页面**全部挂载、只隐藏非当前页**（而非按需挂载）：
 * AI 配置页有草稿态（改了一半的地址 / 模型 / Key，点「保存」才落库）。
 * 若切页即卸载，用户「切去看看主题色再回来」就会静默丢掉刚填的内容。
 * 隐藏用 `display: none`（见 index.scss 的 `.settings-page.is-hidden`），
 * 既保留状态，又不让隐藏页参与布局与无障碍树。
 *
 * ⚠️ 上面这条有且只有一处例外（REQ-063）：AI 总开关关闭后，「AI 记录」与
 * 「用量与效果」两页从清单里消失、随之卸载。它们是没有草稿态的只读视图
 * （`ai_log` / `ai_event` 的展示），关掉 AI 后既不会有新记录、也不该再展示用量；
 * **AI 配置页不在此列**，它永远保留（开关就在那页上，收掉它用户就再也开不回来），
 * 因此绝不能被开关卸载。
 *
 * AI 分区的 edition 门控（R-AI-01）：只有 **full / novel 版** 才展示 —— 与主进程
 * `ai.db` 的 edition 开关（`EDITION !== "lite"`）对齐，lite 版既无 ai.db 存储、
 * 也无 novel 侧的 AI 入口，展示空分区会让用户「看得见但用不了」。
 */
export default function SettingsWindowApp() {
  /**
   * AI 是否该整块隐去（REQ-063）。
   *
   * 用 `useAiAvailability` 而不是自己读一次配置：它已经带了两件本窗口需要的
   * 能力 —— ①「关掉 / 没有通道 → hidden、开着没配全 → 不 hidden」的统一口径
   * （与作品窗口的六个 AI 入口同源，避免两边判断分叉）；②订阅主进程保存成功
   * 后广播的 `ai-config-changed`，于是**不管开关是在本窗口改的（本窗口也是
   * 订阅方）还是在别的窗口改的**，导航都会立刻跟上。
   */
  const { hidden: aiHidden } = useAiAvailability();

  const pages = useMemo(() => buildPages(aiHidden), [aiHidden]);
  const navGroups = useMemo(() => buildNavGroups(pages), [pages]);

  const [activeId, setActiveId] = useState<string>(() => pages[0]?.id ?? "appearance");

  /**
   * AI 记录 / 用量被收起时，正好停在那两页的用户会落进「空白内容区」。
   *
   * 回退目标是「AI 配置」页而不是第一页：用户上一个动作是关开关，他最可能
   * 还要接着配（或者想开回去），退到外观页等于把他踢出上下文。
   * 用 effect 而不是渲染期 setState：渲染期改状态会多回灌一次渲染，且
   * 「当前页不存在」的那一帧仍会渲染出空白内容区。
   */
  useEffect(() => {
    if (pages.some((page) => page.id === activeId)) return;
    const fallback =
      pages.find((page) => page.id === AI_FALLBACK_PAGE_ID) ?? pages[0];
    if (fallback) setActiveId(fallback.id);
  }, [pages, activeId]);

  const active = pages.find((page) => page.id === activeId) ?? pages[0];

  /**
   * 跨窗口跳页：其它窗口发 `settings-section-jump`（起名面板的「去设置」用它）。
   *
   * 只接受本版本真实存在的 id —— lite 版没有 AI 页，一条指向 `ai` 的消息
   * 落下来会变成一个空白内容区，所以无效 id 一律忽略（保持当前页）。
   * 校验用 `KNOWN_PAGE_IDS`（静态全集）而不是当前可见清单：跳页消息可能早于
   * 配置读回，这时「AI 记录」只是暂时不可见、不是不存在；真不可见时由上面的
   * 兜底 effect 把 activeId 拉回 AI 配置页，不会留空白。
   * preload 的 `windowAPI.on` 会在挂载时补投一次待投递消息，因此窗口刚被拉起
   * 也不会丢掉这条跳转。
   */
  useEffect(() => {
    const api = window.electronAPI?.windowAPI;
    if (!api) return;
    const handler = (...args: unknown[]) => {
      const payload = args[0] as { section?: unknown } | undefined;
      const section = typeof payload?.section === "string" ? payload.section : "";
      if (!section) return;
      if (!KNOWN_PAGE_IDS.has(section)) return;
      setActiveId(section);
    };
    api.on("settings-section-jump", handler);
    return () => api.off("settings-section-jump", handler);
  }, []);

  return (
    <div className="window-shell">
      <WindowHeader title="设置" icon={<SettingOutlined />} maximizable={false} />
      <div className="window-shell__body">
        <div className="settings-layout">
          <SettingsNav groups={navGroups} activeId={active.id} onSelect={setActiveId} />

          <div className="settings-content">
            <div className="settings-page__head">
              <h1 className="settings-page__title">{active.title}</h1>
              <p className="settings-page__desc">{active.description}</p>
            </div>

            {/* 只渲染清单里的页：AI 记录 / 用量随开关卸载（只读视图，可丢）；
                其余页仍常驻，非当前页只 display:none（AI 配置页有草稿态） */}
            {pages.map((page) => (
              <div
                key={page.id}
                className={`settings-page${page.id === active.id ? "" : " is-hidden"}`}
                role="region"
                aria-label={page.title}
              >
                {/* 内容栈：卡片与底部操作条都摊在这一层，操作条靠 margin-top:auto
                    贴底，切页时位置恒定（详见 index.scss 的 .settings-page__stack） */}
                <div className="settings-page__stack">{page.render()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
