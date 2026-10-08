import { useMemo, useState } from "react";
import { Button, Input, InputNumber, Switch } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import ModifierList from "../ModifierList";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { thresholdOf, type ThresholdLevel } from "../../pack-utils";
import "./index.scss";

interface SkillsModuleProps {
  api: PackPanelApi;
}

function parseThresholds(raw: string): ThresholdLevel[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? (parsed as ThresholdLevel[]) : [];
  } catch {
    return [];
  }
}

/**
 * 技能栏（A-4 / A-5）
 *
 * 技能开关（载体闸门）与技能上「持续型效果自己的开关」是两件事，前者关掉整个技能
 * 不再在效，后者只切换某一条持续效果是否计入 —— 两者都在这一行里，不要合并。
 */
export default function SkillsModule({ api }: SkillsModuleProps) {
  const doc = api.doc;
  const [expanded, setExpanded] = useState<string | null>(null);

  const thresholds = useMemo(
    () => (api.proficiencySystem ? parseThresholds(api.proficiencySystem.levels) : []),
    [api.proficiencySystem],
  );

  if (!doc) return null;
  const key = "skills" as const;
  const skills = [...doc.skills].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      actions={
        <>
          <label className="cpk-skl__toggle" title="关闭后熟练度相关的界面完全隐藏，而不是置灰">
            <span>熟练度</span>
            <Switch
              size="small"
              checked={api.prefs.showProficiency}
              onChange={(checked) => api.patchPrefs({ showProficiency: checked })}
            />
          </label>
          <Button className="cpk-btn ghost" onClick={() => api.addSkill()}>
            <PlusOutlined />技能
          </Button>
        </>
      }
    >
      {skills.length === 0 ? (
        <p className="cpk-empty">
          还没有技能。技能开启时，它挂着的被动加成会立刻计入总属性 ——
          剧情里「这门功法他还不会」就是关掉它。
        </p>
      ) : (
        <ul className="cpk-skl">
          {skills.map((skill) => {
            const mods = api.modifiersOf("skill", skill.id);
            const active = api.isCarrierActive("skill", skill.id);
            const position = api.prefs.showProficiency
              ? thresholdOf(thresholds, skill.proficiencyRaw)
              : null;
            const open = expanded === skill.id;
            return (
              <li key={skill.id} className={`cpk-skl__item${active ? "" : " is-off"}`}>
                <div className="cpk-skl__head">
                  <Switch
                    size="small"
                    checked={skill.enabled}
                    onChange={(checked) => api.updateSkill(skill.id, { enabled: checked })}
                    title={skill.enabled ? "在效：加成效力计入总属性" : "已关闭：不参与汇总"}
                  />
                  <Input
                    size="small"
                    className="cpk-skl__name"
                    value={skill.name}
                    placeholder="技能名"
                    onChange={(event) => api.updateSkill(skill.id, { name: event.target.value })}
                  />
                  {position ? (
                    <>
                      <InputNumber
                        size="small"
                        min={0}
                        style={{ width: 72 }}
                        value={skill.proficiencyRaw}
                        onChange={(value) =>
                          api.updateSkill(skill.id, { proficiencyRaw: Math.max(0, Number(value) || 0) })
                        }
                        title="熟练度（可被效果按上限 500 缩放）"
                      />
                      {position.name ? (
                        <span className="cpk-skl__tier">
                          {position.name}
                          {position.overflow ? "+" : ""}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  <Button
                    className={`cpk-btn ghost${mods.length > 0 ? "" : " is-plain"}`}
                    onClick={() => setExpanded(open ? null : skill.id)}
                  >
                    效果 {mods.length > 0 ? mods.length : ""}
                  </Button>
                  <Button
                    className="cpk-iconbtn tiny danger"
                    onClick={() => api.removeSkill(skill.id)}
                    title="删除技能"
                  >
                    <DeleteOutlined />
                  </Button>
                </div>

                {open ? (
                  <div className="cpk-skl__effects">
                    <ModifierList
                      modifiers={mods}
                      attributes={doc.attributes}
                      ownerActive={active}
                      onOpenEditor={(modifierId) =>
                        api.openEffectEditor("skill", skill.id, skill.name || "技能", modifierId)
                      }
                      onToggleActive={api.toggleModifierActive}
                      onToggleDisabled={api.toggleModifierDisabled}
                      onDuplicate={api.duplicateModifier}
                      onRemove={api.removeModifier}
                      onJumpAttribute={api.setDetailAttrId}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </PackModuleShell>
  );
}
