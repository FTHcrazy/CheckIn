import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NameGeneratorPanel, { type NamingActions } from "./index";
import type { AiGenerateData, AiResult } from "@/shared/ai/ai-types";

/**
 * 端到端回归：**真实 AI 原文** → 真实 `aiGenerateStructured` → 面板。
 *
 * 只替换 IPC 边界（`window.electronAPI.ai.generate`），解析链路与生产完全一致。
 * 取材自 2026-10-27 `ai_log#9` 的真实坏输出：模型第 5 条把 `}` 写成 `]`，
 * 旧实现把整行当成一条记录，面板第一张卡是 `[{"name"`。
 */
const REAL_BAD_RAW =
  '[{"name":"江长青","meaning":"寓意寿命长青，直接呼应书名《我在修仙界万古长青》的核心主题，道心坚固。"},' +
  '{"name":"叶万古","meaning":"气吞万古，寓意角色拥有跨越纪元的宏大格局与悠久寿元。"},' +
  '{"name":"慕不朽","meaning":"追求不朽大道，渴望在修仙界打破生死轮回，获得永恒的生命。"},' +
  '{"name":"顾长生","meaning":"修仙界的终极追求，寓意角色只顾向大道进军，求得一世长存。"},' +
  '{"name":"凌千劫","meaning":"凌驾于千般劫难之上，象征角色历经岁月沧桑而存活的无上手段。"],' +
  '{"name":"沈延寿","meaning":"岁月绵延，寿元无尽，体现角色在漫长修仙岁月中沉淀出的生机。"},' +
  '{"name":"陆青松","meaning":"如青松般万古长青，挺拔不屈，象征角色生命力顽强且道基稳固。"},' +
  '{"name":"林岁寒","meaning":"经历岁寒之劫而不凋，寓意角色在残酷修仙界中历经磨难而长存。"},' +
  '{"name":"楚无涯","meaning":"寿元无涯，没有尽头，暗合书名中万古长青的永恒意境。"},' +
  '{"name":"苏朝云","meaning":"朝云暮雨，岁月流转，寓意角色在万古时光中见证无数时代变迁。"}]';

/** 只装 AI 调用的最小 electronAPI 桩（ai-client 只摸这一个口子） */
const stubAiGenerate = (text: string) => {
  const generate = vi.fn(
    async (): Promise<AiResult<AiGenerateData>> => ({
      ok: true,
      data: { text, items: [], model: "gpt-4o-mini" },
    }),
  );
  (window as unknown as { electronAPI: unknown }).electronAPI = { ai: { generate } };
  return generate;
};

const buildActions = (): NamingActions => ({
  onInsertToEditor: vi.fn(),
  onInsertMeaning: vi.fn(),
  onCreateCharacter: vi.fn(),
  onAddFavorite: vi.fn(),
  onRemoveFavorite: vi.fn(),
});

const CARDS = ".nv-name__card";

/** 点击 AI 起名并等结果落地 */
const runAiNaming = async (container: HTMLElement) => {
  const button = container.querySelector<HTMLElement>(".nv-name__ai-btn");
  expect(button).not.toBeNull();
  fireEvent.click(button as HTMLElement);
  await waitFor(() => {
    expect(container.querySelectorAll(CARDS).length).toBeGreaterThan(0);
  });
};

describe("AI 起名：真实坏输出不得上屏", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("分隔符写错的真实数组 → 10 条 AI 结果全部还原，卡片无 JSON 残片", async () => {
    stubAiGenerate(REAL_BAD_RAW);
    const { container } = render(
      <NameGeneratorPanel
        exclude={[]}
        favorites={[]}
        book={{ workName: "我在修仙界万古长青", entities: [] }}
        actions={buildActions()}
      />,
    );
    await runAiNaming(container);

    const cards = Array.from(container.querySelectorAll(CARDS));
    expect(cards).toHaveLength(10);
    // 每条都必须是 AI 产出的（而不是靠本地引擎补齐）
    expect(container.querySelectorAll(".nv-name__badge")).toHaveLength(10);
    // 名字 + 寓意里不允许出现任何 JSON 标点
    for (const card of cards) {
      expect(card.textContent ?? "").not.toMatch(/[[\]{}"]/);
    }
    // 字段齐全 → 不该再提示「寓意可能缺失」
    expect(container.textContent ?? "").not.toContain("寓意可能缺失");
  });

  it("AI 回来纯垃圾 → 面板只留本地结果，并在提示里说明已切回", async () => {
    stubAiGenerate("[{\"name\":\"江长青\",\"meaning\":\"寓意寿命长青");
    const { container } = render(
      <NameGeneratorPanel exclude={[]} favorites={[]} actions={buildActions()} />,
    );
    await runAiNaming(container);

    const cards = Array.from(container.querySelectorAll(CARDS));
    expect(cards.length).toBeGreaterThan(0);
    // 没有任何 AI 条目可用 → 全部是本地结果，且没有任何 AI 角标
    expect(container.querySelectorAll(".nv-name__badge")).toHaveLength(0);
    for (const card of cards) {
      expect(card.textContent ?? "").not.toMatch(/[[\]{}"]/);
    }
    expect(container.textContent ?? "").toContain("已切回本地起名");
  });
});
