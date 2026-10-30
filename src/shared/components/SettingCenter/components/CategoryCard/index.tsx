/**
 * 设定中心 · 分类卡（UI-10 拆分）
 *
 * 右栏第一块卡：分类头（标题 + 徽标 + 配色 + 编辑 / 删除）+ 说明（或编辑表单）
 * + 进位规则条。境界体系与自定义分类共用，差别只在徽标与「设为境界体系」入口。
 */

import {
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import { Button, ColorPicker, Input, Popconfirm, Select, Tooltip } from "antd";
import type { CarryDirection, SettingCategory } from "@/shared/novel/setting-types";
import { formatSubLevel } from "@/shared/novel/setting-utils";
import {
  SETTING_REF_DETACHED_HINT,
  SETTING_REF_SYNC_BADGE,
  formatReferenceCountLabel,
} from "@/shared/novel/setting-reference";
import type { CategoryDraft, SettingCenterProps } from "../../setting-center-shared";
import "./index.scss";

export interface CategoryCardProps {
  active: SettingCategory;
  /** 进位示例文案（由父级 Hook 派生） */
  carryExample: string;
  categoryDraft: CategoryDraft | null;
  onStartEdit: () => void;
  onCloseDraft: () => void;
  onSubmitDraft: () => void;
  onDraftChange: (draft: CategoryDraft) => void;
  onPatchCategory: SettingCenterProps["onPatchCategory"];
  onDeleteCategory: SettingCenterProps["onDeleteCategory"];
  /** 全局库形态：徽标换成「N 部书引用」 */
  isGlobal: boolean;
  /** 引用项：本书侧只读（隐藏编辑入口） */
  referenced: boolean;
  /** 已固化副本（原全局项被删） */
  detachedHint: boolean;
  /** 「放置到全局」；调用方没给写通道时不渲染 */
  onPublishGlobal?: () => void;
}

export default function CategoryCard({
  active,
  carryExample,
  categoryDraft,
  onStartEdit,
  onCloseDraft,
  onSubmitDraft,
  onDraftChange,
  onPatchCategory,
  onDeleteCategory,
  isGlobal,
  referenced,
  detachedHint,
  onPublishGlobal,
}: CategoryCardProps) {
  return (
    <div className="nv-sc__card">
      <div className="nv-sc__card-head">
        <span className="nv-sc__cat-title">{active.name}</span>
        <span className="nv-sc__badge">
          {active.kind === "realm" ? "境界体系" : "自定义分类"}
        </span>
        {active.kind === "realm" && !isGlobal && (
          <span className="nv-sc__badge is-link">已联动角色境界</span>
        )}
        {isGlobal && (
          <span
            className="nv-sc__badge is-ref"
            title="有多少部书正在引用这个分类"
          >
            {formatReferenceCountLabel(active.refCount ?? 0)}
          </span>
        )}
        {/* 引用态（D2）：本书分类引用自全局中心 ⇒ 只读 + 自动同步徽标 */}
        {referenced && (
          <span
            className="nv-sc__badge is-sync"
            title="来自全局设定中心，本书只读，改动会自动同步"
          >
            <LinkOutlined /> {SETTING_REF_SYNC_BADGE}
          </span>
        )}
        {/* 已固化副本（D4）：原全局项被删，就地转为本节可编辑副本 */}
        {detachedHint && (
          <span className="nv-sc__badge is-detached" title={SETTING_REF_DETACHED_HINT}>
            {SETTING_REF_DETACHED_HINT}
          </span>
        )}
        {!referenced && active.kind === "custom" && (
          <Button
            size="small"
            type="link"
            className="nv-sc__set-realm"
            aria-label="设为境界体系"
            onClick={() => onPatchCategory(active.id, { kind: "realm" })}
          >
            设为境界体系
          </Button>
        )}
        <span className="nv-sc__spacer" />
        {/* 放置到全局（D3 / REQ-042）：本书域动作，复制快照上架供其它书引用 */}
        {!isGlobal && onPublishGlobal && (
          <Tooltip title="复制一份到全局设定中心，供其它作品引用；本书内容不变">
            <Button size="small" className="nv-sc__publish" onClick={onPublishGlobal}>
              <ExportOutlined />
              放置到全局
            </Button>
          </Tooltip>
        )}
        <ColorPicker
          size="small"
          disabled={referenced}
          value={active.color}
          onChange={(_, hex) => onPatchCategory(active.id, { color: hex })}
        />
        <Button size="small" disabled={referenced} onClick={onStartEdit}>
          <EditOutlined />
          编辑
        </Button>
        <Popconfirm
          title="删除这个分类？"
          description="该分类下的等级项会一并删除，绑在它们上的「当前境界」也会被摘除。"
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={() => onDeleteCategory(active.id)}
        >
          <Button size="small" danger disabled={referenced}>
            <DeleteOutlined />
            删除
          </Button>
        </Popconfirm>
      </div>

      {categoryDraft ? (
        <div className="nv-sc__form">
          <label className="nv-sc__field">
            <span>名称</span>
            <Input
              size="small"
              value={categoryDraft.name}
              onChange={(event) =>
                onDraftChange({ ...categoryDraft, name: event.target.value })
              }
            />
          </label>
          <label className="nv-sc__field">
            <span>说明</span>
            <Input
              size="small"
              value={categoryDraft.note}
              placeholder="这条序列是干嘛的"
              onChange={(event) =>
                onDraftChange({ ...categoryDraft, note: event.target.value })
              }
            />
          </label>
          <label className="nv-sc__field is-narrow">
            <span>每阶小层数</span>
            <Input
              size="small"
              value={categoryDraft.subLevels}
              inputMode="numeric"
              onChange={(event) =>
                onDraftChange({ ...categoryDraft, subLevels: event.target.value })
              }
            />
          </label>
          <label className="nv-sc__field is-narrow">
            <span>小层命名</span>
            <Input
              size="small"
              value={categoryDraft.subPattern}
              placeholder="{n} 为层号；固定名单：初期,中期,后期,圆满"
              onChange={(event) =>
                onDraftChange({ ...categoryDraft, subPattern: event.target.value })
              }
            />
          </label>
          <div className="nv-sc__form-actions">
            <Button size="small" onClick={onCloseDraft}>
              取消
            </Button>
            <Button size="small" type="primary" onClick={onSubmitDraft}>
              保存
            </Button>
          </div>
        </div>
      ) : (
        <div className="nv-sc__note">
          <span className="nv-sc__note-label">说明</span>
          <span>{active.note || "—"}</span>
        </div>
      )}

      <div className="nv-sc__carry">
        <div className="nv-sc__carry-row">
          <span className="nv-sc__carry-item">
            <em>每阶小层数</em>
            {active.subLevels}
          </span>
          <span className="nv-sc__carry-item">
            <em>进位方向</em>
            <Select
              size="small"
              className="nv-sc__carry-select"
              value={active.carryDir}
              aria-label="进位方向"
              options={[
                { value: "asc", label: "由低到高" },
                { value: "desc", label: "由高到低" },
              ]}
              onChange={(value: CarryDirection) =>
                onPatchCategory(active.id, { carryDir: value })
              }
            />
          </span>
          <span className="nv-sc__carry-item">
            <em>小层命名</em>
            {formatSubLevel(active.subPattern, 1)} …{" "}
            {formatSubLevel(active.subPattern, active.subLevels)}
          </span>
        </div>
        <div className="nv-sc__carry-example">
          <em>进位示例</em>
          {carryExample}
        </div>
      </div>
    </div>
  );
}
