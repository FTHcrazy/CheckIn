import { useMemo, useState } from "react";
import { Button, Input, Modal, Switch } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import "./index.scss";

interface GroupManagerProps {
  api: PackPanelApi;
}

/**
 * 分组设置（Phase 2 载体分组；1.39.1 起只服务物品栏）
 *
 * 分组是物品的分类维度，三颗开关各管一件事：
 * - `canEquip`：这组的物品能被装备部位接受（accepts 按组 id 匹配）
 * - `canEnable`：组内条目有没有自己的启停开关（丹药匣有、随身杂物没有）
 * - `enabled`：组停用 = 闸门 0，组内全部条目不再计入总属性
 *
 * 技能分组已删（没有实际意义），弹框不再分技能 / 物品语境；
 * `profSchemeId` 随之失去绑定方，编辑入口一并撤下（旧数据字段保留，compat）。
 *
 * 分组名在这里直接输入（带边框输入框，所见即所改）；导出读的是同一格
 * 数据，改完立刻反映到导出文本里。
 *
 * 删除分组：组内条目退回「未分组」（不删除），确认框要报条数 ——
 * 「这一类都没了」和「这些东西没了」是两件事，必须让作者分清。
 */
export default function GroupManager({ api }: GroupManagerProps) {
  const doc = api.doc;
  /** 待删除的分组 id（确认框开着时非空） */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const groups = useMemo(
    () =>
      doc
        ? [...doc.groups].sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [doc],
  );

  if (!doc) return null;

  const pending = groups.find((group) => group.id === pendingDelete);
  const pendingCount = pending
    ? doc.items.filter((item) => item.groupId === pending.id).length
    : 0;

  const confirmRemove = () => {
    if (pendingDelete) {
      const count = api.removeGroup(pendingDelete);
      api.showToast(
        count > 0
          ? `已删除分组，${count} 个条目退回「未分组」`
          : "已删除分组",
        "info",
      );
    }
    setPendingDelete(null);
  };

  return (
    <Modal
      open={api.groupManagerOpen}
      title="分组设置"
      centered
      width={560}
      onCancel={() => api.setGroupManagerOpen(false)}
      footer={
        <div className="cpk-guard__footer">
          <Button onClick={() => api.setGroupManagerOpen(false)}>完成</Button>
        </div>
      }
    >
      <p className="cpk-guard__sub">
        分组决定物品的能力：<b>可穿戴</b>的组能被部位「仅接受」选中；
        <b>载体开关</b>关掉后组内物品不再显示启停；停用<b>整组</b>时组内全部效果不计入总属性。
        分组名在下面直接输入，物品下拉与导出文本用的都是这里实时改的名字。
      </p>

      {groups.length === 0 ? (
        <p className="cpk-empty">还没有分组。物品默认都是「未分组」。</p>
      ) : (
        <ul className="cpk-grpmgr">
          {groups.map((group) => {
            const memberCount = doc.items.filter((item) => item.groupId === group.id).length;
            return (
              <li key={group.id} className="cpk-grpmgr__row">
                <div className="cpk-grpmgr__line">
                  <Input
                    size="small"
                    className="cpk-grpmgr__icon"
                    value={group.icon}
                    placeholder="⚔"
                    maxLength={2}
                    aria-label={`分组图标：${group.name}`}
                    onChange={(event) =>
                      api.updateGroup(group.id, { icon: event.target.value })
                    }
                  />
                  <Input
                    size="small"
                    className="cpk-grpmgr__name"
                    value={group.name}
                    placeholder="输入分组名"
                    aria-label={`分组名：${group.name}`}
                    title="分组名：物品下拉与导出文本实时跟随"
                    onChange={(event) =>
                      api.updateGroup(group.id, { name: event.target.value })
                    }
                  />
                  <label
                    className="cpk-grpmgr__switch"
                    title="关掉后组内物品不再显示启停开关（如随身杂物）"
                  >
                    <span>载体开关</span>
                    <Switch
                      size="small"
                      checked={group.canEnable}
                      onChange={(checked) =>
                        api.updateGroup(group.id, { canEnable: checked })
                      }
                    />
                  </label>
                  <label
                    className="cpk-grpmgr__switch"
                    title={
                      group.enabled
                        ? "启用中：组内物品正常计入总属性"
                        : "已停用：组内全部效果不计入总属性（闸门 0）"
                    }
                  >
                    <span>整组</span>
                    <Switch
                      size="small"
                      checked={group.enabled}
                      onChange={(checked) =>
                        api.updateGroup(group.id, { enabled: checked })
                      }
                    />
                  </label>
                  <Button
                    className="cpk-iconbtn tiny danger"
                    onClick={() => setPendingDelete(group.id)}
                    title="删除分组（组内物品退回未分组，不会删除）"
                  >
                    <DeleteOutlined />
                  </Button>
                </div>
                <div className="cpk-grpmgr__sub">
                  <span className="cpk-grpmgr__count">
                    {memberCount} 个物品
                    {group.enabled ? "" : " · 已停用"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="cpk-grpmgr__foot">
        <Button icon={<PlusOutlined />} onClick={() => api.addGroup()}>
          新增分组
        </Button>
        <span className="cpk-grpmgr__count">共 {groups.length} 个分组</span>
      </div>

      <Modal
        open={pendingDelete !== null}
        title="删除分组"
        centered
        width={360}
        onCancel={() => setPendingDelete(null)}
        footer={
          <div className="cpk-guard__footer">
            <Button onClick={() => setPendingDelete(null)}>取消</Button>
            <Button type="primary" onClick={confirmRemove}>
              删除分组
            </Button>
          </div>
        }
      >
        <p className="cpk-guard__text">
          删除「{pending?.name}」？组内的 {pendingCount} 个条目会退回「未分组」，
          本身不会被删除。
        </p>
        <p className="cpk-guard__sub">
          如果这条分组已经停用，删除前这些条目的效果也不会计入 —— 退回未分组后按各自状态重新判定。
        </p>
      </Modal>
    </Modal>
  );
}
