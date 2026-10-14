import { useEffect, useState } from "react";
import { Tour } from "antd";
import {
  GUIDE_TOTAL_STEPS,
  TOUR_STEPS,
  type GuideView,
} from "@/shared/novel/guide-copy";
import { useGuideStore } from "../../store/useGuideStore";
import { resolveStepTarget } from "./target";
import "./index.scss";

/**
 * 漫游式引导（L1 · antd Tour）
 *
 * 为什么按视图拆成两个实例：书架页与编辑器页在 App 层是两个用 display 切换的
 * 兄弟容器（`App.tsx` 的 `.novel-view.is-hidden`），**display:none 里的元素
 * 拿不到有效 rect**，单个 Tour 无法跨容器高亮。所以第 1 步由书架页实例播，
 * 第 2-5 步由编辑器页实例播，靠 store 里的 playingStep 串联。
 *
 * 目标可见性由这里探测而不是父组件传入：PRD FR-01 R1 要求「目标不存在或
 * 不可见时跳过该步」。探测比 getClientRects 更严（见 target.ts）：布局盒、
 * 视口交集、透明/隐藏祖先三道关口——侧栏折叠是 width:0 + opacity:0，盒子
 * 还在但整条链不可见，只查盒子会把卡片定位到看不见的地方。
 */

export interface NovelGuideTourProps {
  /** 本实例所属视图 */
  view: GuideView;
  /**
   * 本视图当前是否可见（App 层 display 切换）。
   * 不可见时收摊并暂停：藏在 display:none 里的目标量不到有效坐标，
   * 而 store 的 start() 会在视图重新可见时把播放步改拍回来续播。
   */
  visible: boolean;
}

/** 目标探测预算：取不到目标时重试这么久才暂停（首帧布局未定会短暂取不到） */
const GUIDE_PROBE_BUDGET_MS = 600;

export default function NovelGuideTour({ view, visible }: NovelGuideTourProps) {
  const playingStep = useGuideStore((state) => state.playingStep);
  const pause = useGuideStore((state) => state.pause);
  const goNext = useGuideStore((state) => state.goNext);
  const complete = useGuideStore((state) => state.complete);
  const skip = useGuideStore((state) => state.skip);
  const viewStep = useGuideStore((state) => state.viewStep);
  /** 探测到的目标元素；null 表示还没探测到（此时不渲染，避免闪一帧居中卡片） */
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);

  const step =
    playingStep === null
      ? undefined
      : TOUR_STEPS.find((item) => item.step === playingStep);
  const belongsToThisView = step?.view === view;

  // 目标探测：视图被切走时收摊并暂停（store 的 start() 负责后续改拍续播）。
  // 取不到目标不立刻暂停——首帧布局未定 / Virtuoso 刚挂载时会短暂取不到，
  // 重试到预算尽头才 pause()；暂停同样不是终态（视图切换即续）。
  useEffect(() => {
    if (!step || !belongsToThisView) return;
    if (!visible) {
      setTargetElement(null);
      pause();
      return;
    }
    let raf = 0;
    const startedAt = Date.now();
    const probe = (): void => {
      const element = resolveStepTarget(step);
      if (element) {
        setTargetElement(element);
        return;
      }
      if (Date.now() - startedAt < GUIDE_PROBE_BUDGET_MS) {
        raf = requestAnimationFrame(probe);
      } else {
        pause();
      }
    };
    raf = requestAnimationFrame(probe);
    return () => cancelAnimationFrame(raf);
  }, [step, belongsToThisView, visible, pause]);

  // 换步先清空旧目标：否则会用上一步的元素渲染新步骤的卡片
  useEffect(() => {
    setTargetElement(null);
  }, [playingStep]);

  // 展示即记入 stepsViewed（埋点 viewedSteps 与续播位置的依据）
  useEffect(() => {
    if (!step || !belongsToThisView) return;
    viewStep(step.step);
  }, [step, belongsToThisView, viewStep]);

  if (!step || !belongsToThisView || !targetElement) return null;

  const isLast = step.step >= GUIDE_TOTAL_STEPS;

  /**
   * 强制引导（2026-10-14 用户反馈）：第 1-4 步不渲染关闭叉、不响应 Esc，
   * 唯一出口是卡片上的「下一步」——零基础作者见叉就点，设定中心与行囊
   * 会被整段跳过。第 4 步行囊讲完即「强制引导结束」；第 5 步（右键建卡）
   * 恢复为普通可关闭步骤，给个叉随时能撤。
   */
  const forced = !isLast;

  return (
    <Tour
      className="novel-guide"
      classNames={{ footer: "novel-guide__footer" }}
      open
      type="primary"
      mask
      closable={!forced}
      keyboard={!forced}
      current={0}
      /**
       * ⚠️ onClose 只能在可关闭的步骤上接 skip。
       *
       * 单步实例下 antd 的「下一步 / 完成」恒走 finish 路由
       * （`current === total - 1` → `0 === 0` 恒真）：rc-tour 的 onFinish
       * 先调 `handleClose()`，其中就会触发我们传的 onClose。若在强制步上
       * 也接 skip，每点一次「下一步」都会先把 playingStep 清空，
       * 随后 goNext 读到 null 直接空转——表现为「点下一步，下一步的
       * 卡片再也不出现」，且引导状态被误写成 skipped。强制步上没有
       * 关闭叉、Esc 也被禁，onClose 根本不该有入口。
       */
      onClose={forced ? undefined : skip}
      steps={[
        {
          target: () => targetElement,
          placement: step.placement,
          title: (
            <span className="novel-guide__head">
              <span className="novel-guide__step">
                第 {step.step} 步 / 共 {GUIDE_TOTAL_STEPS} 步
              </span>
              <span className="novel-guide__name">{step.title}</span>
            </span>
          ),
          description: step.description,
          nextButtonProps: isLast
            ? { children: "完成", onClick: complete }
            : { children: "下一步", onClick: goNext },
        },
      ]}
      // 单步实例：进度按全局 5 步显示，而不是 antd 的「1 / 1」
      indicatorsRender={() => (
        <span className="novel-guide__indicator">
          {step.step} / {GUIDE_TOTAL_STEPS}
        </span>
      )}
    />
  );
}
