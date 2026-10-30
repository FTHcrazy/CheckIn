/**
 * 全局设定中心 · 引用方名单抽屉（R12）
 *
 * 列出「哪几本书在引用这个全局分类」。入口在影响面条上（`refCount === 0` 时
 * 不渲染入口），所以本组件的「空名单」态实际不可达，仅作兜底。
 *
 * 四条呈现路径，没有一条允许白屏或静默：
 * | 态 | 判定 | 呈现 |
 * |---|---|---|
 * | 加载中 | `loading` | 标题照常 + 列表区居中 `Spin`。**禁止**显示「暂无引用」—— 会把「还在读」误报成「没人引用」 |
 * | 有数据 | `refs.length > 0` | 计数由 `formatReferenceCountLabel` 产出 + `List` 逐行书名（只读，行右侧不放操作） |
 * | 口径不一致 | `refs.length === 0 && refCount > 0` | `Alert type="warning"` + 说明 + 「重试」 |
 * | 异常 | `error !== null` | `Alert type="error" showIcon` + `description={error}` + 「重试」；标题与关闭按钮**始终可用** |
 */

import type { ReactNode } from "react";
import { Alert, Button, Drawer, Empty, List, Spin } from "antd";
import { formatReferenceCountLabel } from "@/shared/novel/setting-reference";
import type { GlobalCategoryRef } from "../../hooks/useGlobalSettingRefs";
import "./index.scss";

export interface GsRefsDrawerProps {
  open: boolean;
  /** 分类名，进标题「引用方 · {categoryName}」 */
  categoryName: string;
  /** 影响面条上的计数（口径基准）：用于校验名单条数 */
  refCount: number;
  refs: GlobalCategoryRef[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}

export default function GsRefsDrawer({
  open,
  categoryName,
  refCount,
  refs,
  loading,
  error,
  onClose,
  onRetry,
}: GsRefsDrawerProps) {
  /** 内容区：四态互斥，异常优先于加载、加载优先于空 */
  const renderBody = (): ReactNode => {
    if (error) {
      return (
        <Alert
          type="error"
          showIcon
          message="引用方名单读取失败"
          description={error}
          action={
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          }
        />
      );
    }
    if (loading) {
      return (
        <div className="gs-refs__loading">
          <Spin size="small" />
        </div>
      );
    }
    if (refs.length > 0) {
      return (
        <>
          <div className="gs-refs__count">
            {formatReferenceCountLabel(refs.length)}
          </div>
          <List
            size="small"
            className="gs-refs__list"
            dataSource={refs}
            renderItem={(item) => (
              <List.Item className="gs-refs__item">
                <span className="gs-refs__name">{item.workName}</span>
              </List.Item>
            )}
          />
        </>
      );
    }
    // 名单为空但计数 > 0：不能静默 —— 那是「读到了 0 条」而不是「没人引用」
    if (refCount > 0) {
      return (
        <Alert
          type="warning"
          showIcon
          message="没能读到引用方名单"
          description={`计数显示 ${refCount} 部书引用，但名单是空的。`}
          action={
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          }
        />
      );
    }
    return (
      <Empty
        className="gs-refs__empty"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="暂无作品引用"
      />
    );
  };

  return (
    <Drawer
      open={open}
      title={`引用方 · ${categoryName}`}
      // antd 6 里 `width` 已废弃：宽度交给 `.gs-refs__wrapper`（classNames.wrapper
      // 落在抽屉面板的 wrapper 上），不在 TSX 里写内联尺寸
      onClose={onClose}
      // 弹层挂 body：用 classNames 挂类命中，不写 :hover / :active 状态选择器
      classNames={{ wrapper: "gs-refs__wrapper", body: "gs-refs__body" }}
    >
      {renderBody()}
    </Drawer>
  );
}
