import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dropdown, Input, InputNumber, Progress, Select, Switch } from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  SlidersOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import PackExportButton from "../PackExportButton";
import PackChangedDot from "../PackChangedDot";
import ModifierList from "../ModifierList";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import {
  carryBreakdown,
  thresholdOf,
  type ProficiencySchemeMeta,
  type ThresholdLevel,
} from "../../pack-utils";
import "./index.scss";

interface SkillsModuleProps {
  api: PackPanelApi;
}

/** 档位的量纲标注：`100–299` / `300+`（末档无上限） */
function scaleOf(position: { min: number; max: number | null }): string {
  return position.max === null ? `${position.min}+` : `${position.min}–${position.max}`;
}

/**
 * 技能栏（A-4 / A-5）
 *
 * 技能开关（载体闸门）与技能上「持续型效果自己的开关」是两件事，前者关掉整个技能
 * 不再在效，后者只切换某一条持续效果是否计入 —— 两者都在这一行里，不要合并。
 *
 * ── 熟练度：档位就在行内改（2026-10 用户报障「设置过于复杂、入门/熟练不知道去哪设」）──
 *
 * 旧版把「档位区间」只放在头部的量纲弹窗里，而技能栏这一行只给了一个光秃秃的数字框，
 * 于是读者看到「497 熟练」时既不知道「熟练」是怎么来的，也找不到改它的地方
 * （要先去点头部一个滑块图标 → 弹窗 → 熟练度那一段，路径完全不可发现）。
 *
 * 现在档位 chip 自己是**下拉入口**：点开就能切档位、改这一档的区间、加一档，
 * 最下面一条直达量纲设置。这条路径与「熟练度进度条」是同一份数据，
 * 改完立刻反映到 chip / 条 / 量纲标注上。
 *
 * 头部那颗开关因此改名为「显示熟练度」——它只控制整块显隐，
 * 与档位配置是两件事，旧名「熟练度」让读者以为档位也归它管。
 */
export default function SkillsModule({ api }: SkillsModuleProps) {
  const doc = api.doc;
  const [expanded, setExpanded] = useState<string | null>(null);

  // ── 熟练度体系（Phase 3）──
  //
  // 体系可以多套并存且**按组绑定**：行内档位 / 别名 / 进位跟随技能所属的体系
  // （组绑了 profSchemeId 用那套，否则回落默认体系）。这里只解析**默认体系**
  // 供体系级入口用（建档入口、「加一档」缺省落点）；行内各取各的。
  const defaultScheme = api.schemeForSkill("");
  const thresholds = defaultScheme.meta.levels;

  /**
   * 行节点表：新增技能后要把它滚进视野。
   *
   * ⚠️ 用「id → 节点」的 ref Map 而不是数组下标：行会因排序 / 删除整体位移，
   * 下标会在下一次渲染前就失真。新技能是追加到数组尾部的（见 `addSkill`），
   * 所以拿它的 id 找节点即可，不依赖顺序。
   */
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const pendingScrollId = useRef<string | null>(null);

  const setRowRef = useCallback((id: string, node: HTMLLIElement | null) => {
    if (node) rowRefs.current.set(id, node);
    else rowRefs.current.delete(id);
  }, []);

  /**
   * 新增技能：先记下要滚到的 id，等这一轮渲染把新行挂上之后再做滚动。
   *
   * 必须分成「点按钮」和「行已挂载」两步 —— `addSkill` 只是往 store 里塞数据，
   * 这一刻新行还不存在，直接 scrollIntoView 会拿到 null 而静默失败。
   */
  const handleAddSkill = () => {
    const id = api.addSkill();
    if (id) pendingScrollId.current = id;
  };

  useEffect(() => {
    const id = pendingScrollId.current;
    if (!id) return;
    const node = rowRefs.current.get(id);
    if (!node) return;
    pendingScrollId.current = null;
    node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  // 分组下拉选项（Phase 2）：技能的 groupId 指向这里的组 id。
  // 组的 canEnable=0 时该组条目不渲染载体开关（闸门语义不变，只是没有开关可关）。
  const groupOptions = useMemo(
    () =>
      [...(doc?.groups ?? [])]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((group) => ({
          value: group.id,
          label: group.icon ? `${group.icon} ${group.name}` : group.name,
        })),
    [doc],
  );
  const groupOf = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const group of doc?.groups ?? []) map.set(group.id, group.canEnable);
    return map;
  }, [doc]);

  if (!doc) return null;
  const key = "skills" as const;
  const showProficiency = api.prefs.showProficiency;
  const skills = [...doc.skills].sort((a, b) => a.sortOrder - b.sortOrder);

  /** 该技能所在组是否提供载体开关：未分组恒 true（沿用旧行为） */
  const skillHasToggle = (skillGroupId: string): boolean =>
    skillGroupId === "" ? true : (groupOf.get(skillGroupId) ?? true);

  /**
   * 写回整套档位到**技能所属的那套体系**（`levels` 是存储格式，JSON 字符串由
   * upsert 统一序列化），与 `UnitSystemManager.writeProficiencySystem` 走同一个
   * `upsertUnitSystem("threshold", ...)` 通道 —— 两条路必须写同一份数据，
   * 否则「行内改的」和「弹窗里改的」会互相覆盖。别名 / autoCarry 原样带回，
   * 避免改档位把体系配置冲掉。
   */
  const writeLevelsFor = (
    systemId: string | undefined,
    meta: ProficiencySchemeMeta,
    levels: ThresholdLevel[],
  ) => {
    api.upsertUnitSystem("threshold", "proficiency", {
      id: systemId,
      levels,
      config: { alias: meta.alias, autoCarry: meta.autoCarry },
    });
  };

  /** 档位下拉：切档位 = 把这门技能的数值挪到该档位起点（按该技能所属体系的档位） */
  const tierMenu = (
    skillId: string,
    systemId: string | undefined,
    meta: ProficiencySchemeMeta,
  ) => {
    const levels = meta.levels;
    return {
      items: [
        ...(levels.length > 0
          ? [
              ...levels.map((level) => ({
                key: `pick:${level.name}`,
                label: (
                  <span className="cpk-skl__tieropt">
                    <span>{level.name}</span>
                    <span className="cpk-skl__tieropt-range">{scaleOf(level)}</span>
                  </span>
                ),
              })),
              { type: "divider" as const },
            ]
          : []),
        { key: "edit", label: "改档位区间…", icon: <SlidersOutlined /> },
        { key: "add", label: "再加一档", icon: <PlusOutlined /> },
      ],
      onClick: ({ key: picked }: { key: string }) => {
        if (picked.startsWith("pick:")) {
          const name = picked.slice("pick:".length);
          const level = levels.find((item) => item.name === name);
          // 切档位 = 把数值搬到该档起点：只改数字不改区间 —— 区间是体系（同组技能共用），
          // 数值是这一门技能的进度。
          if (level) api.updateSkill(skillId, { proficiencyRaw: level.min });
          return;
        }
        if (picked === "edit") {
          api.setUnitManagerOpen(true);
          return;
        }
        if (picked === "add") {
          const maxMin = levels.reduce((acc, level) => Math.max(acc, level.min), 0);
          const last = [...levels].sort((a, b) => a.min - b.min).at(-1);
          // 新档位接在最后一档之后：老末档若「无上限」要补上界，否则两档会重叠。
          const next = last && last.max === null
            ? [...levels.slice(0, -1), { ...last, max: last.min + 99 }, { name: "新档位", min: last.min + 100, max: null }]
            : [...levels, { name: "新档位", min: maxMin + 100, max: null }];
          writeLevelsFor(systemId, meta, next);
        }
      },
    };
  };

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      actions={
        <>
          <PackExportButton api={api} moduleKey="skills" label={moduleLabel(key)} />
          <label
            className="cpk-skl__toggle"
            title="只控制熟练度这块界面显不显示；档位区间在下面每行的档位标签里改"
          >
            <span>显示{defaultScheme.meta.alias}</span>
            <Switch
              size="small"
              checked={api.prefs.showProficiency}
              onChange={(checked) => api.patchPrefs({ showProficiency: checked })}
            />
          </label>
          <Button className="cpk-btn ghost cpk-skl__add" onClick={handleAddSkill}>
            <PlusOutlined />技能
          </Button>
          <Button
            className="cpk-iconbtn"
            onClick={() => api.setGroupManagerOpen(true)}
            title="分组设置（可穿戴 / 载体开关 / 停用整组）"
          >
            <TeamOutlined />
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
        <>
          {/*
            没有档位体系时给一条**一次性**的建立入口。
            旧版这里是彻底沉默的：熟练度开着、数值能填，但「入门 / 熟练」这些词
            一个都不出现，作者完全不知道该去哪配（用户原话）。
          */}
          {showProficiency && thresholds.length === 0 ? (
            <div className="cpk-skl__setuptip">
              <span>还没有档位（入门 / 熟练 …）</span>
              <Button className="cpk-btn ghost" onClick={() => api.applyProficiencyTemplate()}>
                套用默认三档
              </Button>
              <Button className="cpk-btn ghost" onClick={() => api.setUnitManagerOpen(true)}>
                自定义
              </Button>
            </div>
          ) : null}

          <ul className="cpk-skl">
            {skills.map((skill) => {
              const mods = api.modifiersOf("skill", skill.id);
              const active = api.isCarrierActive("skill", skill.id);
              // 该技能所属体系（组绑定 → 默认）与展示元数据（档位 / 别名 / 进位）
              const scheme = api.schemeForSkill(skill.groupId);
              const meta = scheme.meta;
              const skillThresholds = meta.levels;
              const position = showProficiency
                ? thresholdOf(skillThresholds, skill.proficiencyRaw)
                : null;
              // 进位展示（Phase 3）：autoCarry 关 / 无 ratio 时为空串，只显示原始值。
              // 原始值是唯一真相源 —— 这里不影响缩放（scaleByProficiency 吃原始值）。
              const carry =
                showProficiency && meta.autoCarry
                  ? carryBreakdown(skill.proficiencyRaw, skillThresholds)
                  : "";
              const open = expanded === skill.id;
              return (
                <li
                  key={skill.id}
                  ref={(node) => setRowRef(skill.id, node)}
                  className={`cpk-skl__item${active ? "" : " is-off"}`}
                >
                  <div className="cpk-skl__head">
                    {skillHasToggle(skill.groupId) ? (
                      <Switch
                        size="small"
                        checked={skill.enabled}
                        onChange={(checked) => api.updateSkill(skill.id, { enabled: checked })}
                        title={skill.enabled ? "在效：加成效力计入总属性" : "已关闭：不参与汇总"}
                      />
                    ) : null}
                    <Input
                      size="small"
                      className="cpk-skl__name"
                      value={skill.name}
                      placeholder="技能名"
                      onChange={(event) => api.updateSkill(skill.id, { name: event.target.value })}
                    />
                    <Select
                      size="small"
                      allowClear
                      className="cpk-skl__group"
                      placeholder="未分组"
                      value={skill.groupId || undefined}
                      options={groupOptions}
                      classNames={{ popup: { root: "cpk-dropdown" } }}
                      onChange={(value) => api.updateSkill(skill.id, { groupId: value ?? "" })}
                      title="所属分组（分组能力与停用见分组设置）"
                    />
                    <PackChangedDot
                      updatedAt={skill.updatedAt}
                      changed={api.isRecentlyChanged(skill.updatedAt)}
                    />
                    {/*
                      数值与档位的可见条件**不一样**：
                      数值是熟练度的本体（效果可以按它缩放，`scaleByProficiency`），
                      没有配过档位体系时它照样可改；档位 chip 要有阈值体系才有意义。
                      两者都挂在同一个「显示熟练度」开关下（关掉即整块缺席，不是置灰）。
                    */}
                    {showProficiency ? (
                      <>
                        <InputNumber
                          size="small"
                          className="cpk-skl__raw"
                          min={0}
                          value={skill.proficiencyRaw}
                          onChange={(value) =>
                            api.updateSkill(skill.id, { proficiencyRaw: Math.max(0, Number(value) || 0) })
                          }
                          title={`${meta.alias}数值（可被效果按上限 500 缩放）`}
                        />
                        {skillThresholds.length > 0 ? (
                          <Dropdown
                            trigger={["click"]}
                            classNames={{ root: "cpk-dropdown" }}
                            menu={tierMenu(skill.id, scheme.system?.id, meta)}
                          >
                            <Button
                              className="cpk-skl__tier"
                              autoInsertSpace={false}
                              title={`点这里切档位 / 改区间（体系：${meta.alias}）`}
                            >
                              {position?.name ? `${position.name}${position.overflow ? "+" : ""}` : "未入门"}
                            </Button>
                          </Dropdown>
                        ) : null}
                      </>
                    ) : null}
                    {/* 「效果」是这一行的主行为（技能存在的理由就是它挂的加成），
                        留一个带数量的按钮；数量为 0 时仍是同一颗按钮，靠 is-plain 降调 */}
                    <Button
                      className={`cpk-btn ghost cpk-skl__effects${mods.length > 0 ? "" : " is-plain"}`}
                      onClick={() => setExpanded(open ? null : skill.id)}
                      title="展开 / 收起这条技能挂着的加成"
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

                  {/*
                    熟练度进度条（REQ-014）：只描述「当前档位内走了多少」，
                    档位的量纲（min–max）标在右边 —— 光有一根条读者不知道满格是多少。
                    末档无上限（`max === null`）时不存在「进度」，改标 `min+`，
                    条固定满格（`thresholdOf` 的 progress 就是二值的）。
                  */}
                  {position && skillThresholds.length > 0 ? (
                    <div className="cpk-skl__prog">
                      <Progress
                        percent={Math.round(position.progress * 100)}
                        showInfo={false}
                        size="small"
                        className="cpk-skl__bar"
                        aria-label={`${meta.alias}进度`}
                      />
                      <span className="cpk-skl__scale">{scaleOf(position)}</span>
                      {carry ? <span className="cpk-skl__carry">{carry}</span> : null}
                    </div>
                  ) : null}

                  {open ? (
                    <div className="cpk-skl__effects-list">
                      <ModifierList
                        modifiers={mods}
                        attributes={api.attrView}
                        ownerActive={active}
                        proficiencyAlias={meta.alias}
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
        </>
      )}
    </PackModuleShell>
  );
}
