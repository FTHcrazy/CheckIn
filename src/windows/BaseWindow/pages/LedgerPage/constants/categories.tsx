/**
 * 分类图标与配色映射
 * 数据本身（id / name / color / type）在 `@/shared/services/ledger` 的预设里，
 * 这里只做「图标名 → antd 组件」与「色 token → CSS 变量」的渲染层映射。
 */
import type { ReactNode } from "react";
import {
  BookOutlined,
  CarOutlined,
  CoffeeOutlined,
  EllipsisOutlined,
  GiftOutlined,
  HomeOutlined,
  LineChartOutlined,
  MedicineBoxOutlined,
  ShoppingOutlined,
  WalletOutlined,
} from "@ant-design/icons";

/** 图标名 → 组件；未命中时回落到「其他」图标 */
const CATEGORY_ICONS: Record<string, ReactNode> = {
  CoffeeOutlined: <CoffeeOutlined />,
  CarOutlined: <CarOutlined />,
  ShoppingOutlined: <ShoppingOutlined />,
  HomeOutlined: <HomeOutlined />,
  GiftOutlined: <GiftOutlined />,
  MedicineBoxOutlined: <MedicineBoxOutlined />,
  BookOutlined: <BookOutlined />,
  WalletOutlined: <WalletOutlined />,
  LineChartOutlined: <LineChartOutlined />,
  EllipsisOutlined: <EllipsisOutlined />,
};

export function renderCategoryIcon(icon: string): ReactNode {
  return CATEGORY_ICONS[icon] ?? <EllipsisOutlined />;
}

/** 色 token → CSS 变量引用 */
export function colorVar(color: string): string {
  return `var(${color})`;
}

/**
 * 弱底 token：图标底色
 * 「其他」用 text-muted，没有对应的 -weak，改走 surface-alt
 */
export function weakColorVar(color: string): string {
  if (color === "--app-text-muted") return "var(--app-surface-alt)";
  return `var(${color}-weak)`;
}
