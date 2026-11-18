import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InterviewTaxonomyDTO } from "@/shared/types/electron";
import { useInterviewTaxonomy } from "./useInterviewTaxonomy";

/**
 * `remove`（2.70.0 新增）的分类删除走主进程软删通道；这里的重点不在通道本身
 * （通道守卫钉着注册与 preload 白名单），而在 hook 侧的三条分支：
 * 基线 id 拦截、失败报错、成功后刷新。
 */
const taxonomyRow = (overrides: Partial<InterviewTaxonomyDTO> = {}): InterviewTaxonomyDTO => ({
  id: "u-c-rsc",
  label: "RSC 与服务端组件",
  track: "written",
  orderNo: 100,
  status: "adopted",
  origin: "manual",
  note: null,
  updatedAt: 0,
  ...overrides,
});

const deleteMock = vi.fn<(id: string) => Promise<{ ok: boolean; errors?: string[] }>>(
  async () => ({ ok: true }),
);

const reloadMock = vi.fn();

const renderTaxonomy = (rows: InterviewTaxonomyDTO[] = []) =>
  renderHook(() => useInterviewTaxonomy(rows, reloadMock));

describe("useInterviewTaxonomy.remove", () => {
  beforeEach(() => {
    deleteMock.mockClear();
    deleteMock.mockResolvedValue({ ok: true });
    reloadMock.mockClear();
    vi.stubGlobal("electronAPI", {
      interview: { taxonomyDelete: deleteMock },
    });
    return () => vi.unstubAllGlobals();
  });

  it("用户新增的分类：调软删通道并刷新列表", async () => {
    const { result } = renderTaxonomy([taxonomyRow()]);

    let done: boolean | undefined;
    await act(async () => {
      done = await result.current.remove(taxonomyRow());
    });

    expect(done).toBe(true);
    expect(deleteMock).toHaveBeenCalledWith("u-c-rsc");
    expect(reloadMock).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("基线 id（非 u- 前缀）直接拦住：不调通道", async () => {
    const { result } = renderTaxonomy([taxonomyRow({ id: "cat-react" })]);

    let done: boolean | undefined;
    await act(async () => {
      done = await result.current.remove(taxonomyRow({ id: "cat-react" }));
    });

    expect(done).toBe(false);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(result.current.error).toContain("基线分类");
  });

  it("通道返回失败：报错不刷新", async () => {
    deleteMock.mockResolvedValue({ ok: false, errors: ["没有找到这个分类（可能已经删过了）"] });
    const { result } = renderTaxonomy([taxonomyRow()]);

    let done: boolean | undefined;
    await act(async () => {
      done = await result.current.remove(taxonomyRow());
    });

    expect(done).toBe(false);
    expect(reloadMock).not.toHaveBeenCalled();
    expect(result.current.error).toContain("没有找到");
  });
});
