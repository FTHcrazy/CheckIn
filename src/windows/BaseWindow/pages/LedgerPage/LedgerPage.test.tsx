import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronAPI } from "@/shared/types/electron";
import LedgerPage from "./LedgerPage";

const CATEGORIES = [
  {
    id: "food",
    name: "餐饮",
    icon: "CoffeeOutlined",
    color: "--app-accent-orange",
    type: "expense",
    builtin: true,
    sort: 1,
    archived: false,
  },
];

const TRANSACTIONS = [
  {
    id: "t1",
    type: "expense",
    amount: 28.5,
    currency: "CNY",
    categoryId: "food",
    accountId: null,
    toAccountId: null,
    note: "午饭",
    happenedAt: "2026-09-22 12:00:00",
    createdAt: "2026-09-22 12:00:00",
    updatedAt: "2026-09-22 12:00:00",
  },
];

function mockApi(transactions: typeof TRANSACTIONS): void {
  const api = {
    ledger: {
      listTransactions: vi.fn().mockResolvedValue(transactions),
      listCategories: vi.fn().mockResolvedValue(CATEGORIES),
      upsertCategory: vi.fn().mockResolvedValue(true),
      addTransaction: vi.fn().mockResolvedValue(transactions[0] ?? null),
      updateTransaction: vi.fn().mockResolvedValue(true),
      deleteTransaction: vi.fn().mockResolvedValue(true),
      deleteCategory: vi.fn().mockResolvedValue(true),
    },
  };
  Object.defineProperty(window, "electronAPI", {
    writable: true,
    configurable: true,
    value: api as unknown as ElectronAPI,
  });
}

function renderPage() {
  return render(
    <ConfigProvider locale={zhCN}>
      <MemoryRouter>
        <LedgerPage />
      </MemoryRouter>
    </ConfigProvider>,
  );
}

describe("LedgerPage", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("有数据时渲染结余、分类与时间线", async () => {
    mockApi(TRANSACTIONS);
    const { container } = renderPage();

    await waitFor(() => {
      expect(screen.getByText("结余")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText("餐饮")).toBeTruthy();
    });
    expect(screen.getByText("1 笔")).toBeTruthy();
    // 时间线由 GroupedVirtuoso 承载：容器挂载即视为虚拟列表就位
    expect(container.querySelector(".ld-timeline")).toBeTruthy();
  });

  it("空数据时给出引导空态", async () => {
    mockApi([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("还没有记账记录")).toBeTruthy();
    });
    expect(screen.getByText("记第一笔")).toBeTruthy();
  });
});
