import { useMemo, useState } from "react";
import { Button, Input, Modal, Select, Switch } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import "./index.scss";

interface GroupManagerProps {
  api: PackPanelApi;
}

/**
 * 分组设置（Phase 2 载体分组）
 *
 * 分组是物品 / 技能的分类维度，三颗开关各管一件事：
 * - `canEquip`：这组的物品能被装备部位接受（accepts 按组 id 匹配）
 * - `canEnable`：组内条目有没有自己的启停开关（功法有、随身杂物没有）
 * - `enabled`：组停用 = 闸门 0，组内全部条目不再计入总属性
 *
 * `profSchemeId` 绑定熟练度体系（Phase 3 转正）：组内技能的档位 / 别名 /
 * 进位跟随所绑体系，未绑定的回落默认体系（第一套）。
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

  // 绑定候选 = 全部熟练度体系（Phase 3 转正），label 用别名（缺省「熟练度」）。
  // 绑定值悬空（体系已被删）时补一个兜底选项 —— 绝不能让 Select 显示裸 id。
  const profOptions = useMemo(() => {
    const options = api.proficiencySystems.map((system) => {
      const meta = api.proficiencySchemes.get(system.id);
      return {
        value: system.id,
        label: meta && meta.alias !== "熟练度" ? `${meta.alias}（${system.name}）` : system.name,
      };
    });
    const bound = groups.map((group) => group.profSchemeId).filter(Boolean);
    for (const id of bound) {
      if (!options.some((option) => option.value === id)) {
        options.push({ value: id, label: "（已删除的体系）" });
      }
    }
    return options;
  }, [api, groups]);

  if (!doc) return null;

  const pending = groups.find((group) => group.id === pendingDelete);
  const pendingCount = pending
    ? doc.items.filter((item) => item.groupId === pending.id).length +
      doc.skills.filter((skill) => skill.groupId === pending.id).length
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
        分组决定条目的能力：<b>可穿戴</b>的组能被部位「仅接受」选中；
        <b>载体开关</b>关掉后组内条目不再显示启停；停用<b>整组</b>时组内全部效果不计入总属性。
      </p>

      {groups.length === 0 ? (
        <p className="cpk-empty">还没有分组。物品 / 技能默认都是「未分组」。</p>
      ) : (
        <ul className="cpk-grpmgr">
          {groups.map((group) => {
            const memberCount =
              doc.items.filter((item) => item.groupId === group.id).length +
              doc.skills.filter((skill) => skill.groupId === group.id).length;
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
                    variant="borderless"
                    className="cpk-inline cpk-grpmgr__name"
                    value={group.name}
                    placeholder="分组名"
                    aria-label="分组名"
                    onChange={(event) =>
                      api.updateGroup(group.id, { name: event.target.value })
                    }
                  />
                  <label className="cpk-grpmgr__switch" title="组内物品能被装备部位接受（部位「仅接受」按组筛选）">
                    <span>可穿戴</span>
                    <Switch
                      size="small"
                      checked={group.canEquip}
                      onChange={(checked) =>
                        api.updateGroup(group.id, { canEquip: checked })
                      }
                    />
                  </label>
                  <label className="cpk-grpmgr__switch" title="关掉后组内条目不再显示启停开关（如随身杂物）">
                    <span>载体开关</span>
                    <Switch
                      size="small"
                      checked={group.canEnable}
                      onChange={(checked) =>
                        api.updateGroup(group.id, { canEnable: checked })
                      }
                    />
                  </label>
                  <Switch
                    size="small"
                    checked={group.enabled}
                    onChange={(checked) =>
                      api.updateGroup(group.id, { enabled: checked })
                    }
                    title={
                      group.enabled
                        ? "启用中：组内条目正常计入"
                        : "已停用：组内全部效果不计入总属性（闸门 0）"
                    }
                  />
                  <Button
                    className="cpk-iconbtn tiny danger"
                    onClick={() => setPendingDelete(group.id)}
                    title="删除分组（组内条目退回未分组，不会删除）"
                  >
                    <DeleteOutlined />
                  </Button>
                </div>
                <div className="cpk-grpmgr__sub">
                  <span className="cpk-grpmgr__count">
                    {memberCount} 个条目
                    {group.enabled ? "" : " · 已停用"}
                  </span>
                  <Select
                    size="small"
                    allowClear
                    className="cpk-grpmgr__prof"
                    placeholder="熟练度体系（可空 = 默认）"
                    value={group.profSchemeId || undefined}
                    options={profOptions}
                    classNames={{ popup: { root: "cpk-dropdown" } }}
                    onChange={(value) =>
                      api.updateGroup(group.id, { profSchemeId: value ?? "" })
                    }
                  />
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
