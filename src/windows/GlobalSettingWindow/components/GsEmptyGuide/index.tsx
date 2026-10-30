/**
 * 全局设定中心 · 空库引导卡（R7）
 *
 * 只在**库里一条分类都没有**时出现（`settings.length === 0`）。
 * 筛选 / 搜索 0 命中时**不出现** —— 那时右栏保持上一选中分类不变（左栏给
 * 「没找到…」空态），避免「筛掉就以为数据没了」。
 *
 * 与装载失败态互斥：装载失败由 `App.tsx` 渲染 `Alert` + 重试，**不得**退化成
 * 这里的「还没有设定分类 / 套用内置预设」（那等于把失败伪装成空库）。
 *
 * 两个动作：
 * - 「套用内置预设」→ 打开既有 `TemplateLibraryModal`（`c.openLibrary()`）；
 * - 「新建空白分类」→ 聚焦左栏新建输入框（与工具头「＋ 新建分类」同一个 ref）。
 */

import { AppstoreOutlined, PlusOutlined } from "@ant-design/icons";
import { Button } from "antd";
import "./index.scss";

export interface GsEmptyGuideProps {
  /** 打开模板库（套用内置预设） */
  onApplyPreset: () => void;
  /** 聚焦左栏新建输入框 */
  onFocusNewCategory: () => void;
}

export default function GsEmptyGuide({
  onApplyPreset,
  onFocusNewCategory,
}: GsEmptyGuideProps) {
  return (
    <div className="gs-empty">
      <div className="gs-empty__inner">
        {/* 图标方片：与影响面的图标底、书架统计卡同一套语言 */}
        <span className="gs-empty__tile" aria-hidden>
          <AppstoreOutlined />
        </span>
        <div className="gs-empty__desc">
          <div className="gs-empty__title">全局库还是空的</div>
          <p className="gs-empty__line">
            这里的设定被任意作品引用 · 改动会同步到仍引用它的书
          </p>
          <p className="gs-empty__line is-faint">
            建好一条后，在作品里「从全局库选择」即可引用
          </p>
        </div>
        <div className="gs-empty__actions">
          <Button size="small" type="primary" onClick={onApplyPreset}>
            <AppstoreOutlined />
            套用内置预设
          </Button>
          <Button size="small" onClick={onFocusNewCategory}>
            <PlusOutlined />
            新建空白分类
          </Button>
        </div>
      </div>
    </div>
  );
}
