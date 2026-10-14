import { useCallback, useEffect, useState } from "react";
import { Button, Select, Tooltip } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import {
  fetchPackBindableEntities,
  logUsageEvent,
} from "@/shared/services/novel-shared";
import { subLabelAt } from "../../pack-utils";
import "./index.scss";

interface RealmModuleProps {
  api: PackPanelApi;
}

/**
 * 境界（R25 联动，§9.7）
 *
 * 全部读写都走 `getRealm / getPanelRealm / setRealm` 三个口子（REQ-048）——
 * 面板上这两个读数故意同时显示，就是为了让「行囊改了、面板没跟着变」这种
 * 静默不同步一眼可见。
 */
export default function RealmModule({ api }: RealmModuleProps) {
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [bindOpen, setBindOpen] = useState(false);

  const loadEntities = useCallback(async () => {
    if (entities.length > 0) return;
    try {
      const bundle = await fetchPackBindableEntities();
      setEntities(bundle);
    } catch {
      setEntities([]);
    }
  }, [entities.length]);

  // 挂载即加载，而不是等下拉展开才加载：`Select` 是「value 有值 + options 为空」
  // 的展示形态时，antd 会直接把裸 id 显示出来（模板书里就是一串
  // `tpl-e-char-shen`），看上去和「没设主角」几乎一样。
  useEffect(() => {
    void loadEntities();
  }, [loadEntities]);

  const rungs = api.rungs;
  const doc = api.doc;
  if (!doc) return null;
  const key = "realm" as const;
  const rung = rungs[api.realmPos.index];
  const subMax = Math.max(1, rung?.subLevels ?? 1);
  /** 已在顶阶最后一小层：再进位无处可去（按钮据此置灰并给出原因） */
  const atLadderTop =
    api.realmPos.index === rungs.length - 1 && api.realmPos.sub >= subMax;
  /**
   * 已在第一阶第一小层：再退无处可去。
   *
   * 与 `atLadderTop` 成对 —— 历史报障的观感问题是「点了没反应」与「功能坏了」
   * 长得一样，只给「到顶」置灰而放任「到底」照点，等于把同一个坑留在另一半。
   */
  const atLadderBottom = api.realmPos.index === 0 && api.realmPos.sub <= 1;

  const step = (delta: number) => {
    void api.writeRealm(api.realmPos, "pack", { carry: true, delta });
  };

  const pick = (index: number) => {
    void api.writeRealm({ index, sub: 1 }, "pack");
  };

  /**
   * 当前小层的显示别名（1.39.1）：拆出子层级的阶，每层有自己的名字
   * （「合体一层」的别名往往就是「初期」）。「合体 1/4」只答了走到哪，
   * 别名才回答「现在是什么」—— 空串（纯数字小层 / 没写别名）不显示。
   */
  const subAlias = subLabelAt(rung, api.realmPos.sub);

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      actions={
        <Tooltip
          title="境界层级在「设定中心」的等级序列里设置：每阶小层数 / 别名 / 子层级都在那里改，改完这里与实体面板立刻同步。"
        >
          <Button className="cpk-iconbtn" aria-label="境界层级去哪里设置？">
            <QuestionCircleOutlined />
          </Button>
        </Tooltip>
      }
    >
      {rungs.length === 0 ? (
        <p className="cpk-empty">
          这本书还没有等级体系。境界直接复用「设定 → 等级体系」（R25）里的那一套，
          先在那里建好阶梯，这里就能用了。
        </p>
      ) : (
        <>
          {/*
            横向阶梯 chip 行（对齐设计稿）。
            刻意不换行 + 横向滚动：换行会让「炼气…化神」这排高低次序变成两段，
            反而看不出进度；横向滚动保持「一条尺子」的读法，窄窗口下也能拖。
          */}
          <div className="cpk-rlm__ladderwrap">
            <ul className="cpk-rlm__ladder">
              {rungs.map((item, index) => (
                <li key={item.id}>
                  <Button
                    className={`cpk-rlm__rung${index === api.realmPos.index ? " is-on" : ""}${
                      index < api.realmPos.index ? " is-passed" : ""
                    }`}
                    onClick={() => pick(index)}
                    title="点击跳到这一阶"
                  >
                    {item.name}
                  </Button>
                </li>
              ))}
            </ul>
          </div>

          {/* 当前境界 + 距下一阶进度（设计稿此处是一条横向进度条） */}
          <div className="cpk-rlm__now">
            <span className="cpk-rlm__value">{api.realmText}</span>
            {subAlias ? (
              <span className="cpk-rlm__alias" title={`当前小层：${subAlias}`}>
                {subAlias}
              </span>
            ) : null}
            <span className="cpk-rlm__stepper">
              <Button
                className="cpk-btn ghost"
                // 已在第一阶第一层：再退无处可去（carryRealm 会原样返回）。
                // 不禁用的话「点了没反应」与「功能坏了」长得一样 ——
                // 这正是本模块历史上反复出现过的观感问题（见文件头注释），
                // 所以「到头」一律显式置灰并说明原因。
                disabled={atLadderBottom}
                title={atLadderBottom ? "已是第一阶第一层" : "退回一小层，跨阶自动退位"}
                onClick={() => step(-1)}
              >
                − 1 层
              </Button>
              <Button
                className="cpk-btn ghost"
                // 已在顶阶满层时进位无处可去（carryRealm 会原样返回）。
                // 与 `− 1 层` 一样把「到顶」显式说出来。
                disabled={atLadderTop}
                title={atLadderTop ? "已是最高阶最后一层" : "推进一小层，满层自动进位"}
                onClick={() => step(1)}
              >
                + 1 层
              </Button>
            </span>
          </div>

          {/*
            阶内进度条：**纯读数**，不挂动作按钮。

            这里原本还有一颗「阶内进位」（`delta: 1` + `carry: true`），与上一行
            的「+ 1 层」调的是**同一个 writeRealm 入参** —— 两颗按钮做同一件事，
            而「阶内进位」这个名字暗示的是「满层后跨越到下一阶」，
            与实际行为（推进一小层）不符，是误解的来源。
            删的是它而不是 stepper：stepper 有一对加减、覆盖两个方向，
            「阶内进位」只有加、丢掉它不损失任何能力。
          */}
          {subMax > 1 ? (
            <div className="cpk-rlm__progress">
              <div className="cpk-rlm__bar">
                <span
                  className="cpk-rlm__fill"
                  style={{ width: `${Math.round((api.realmPos.sub / subMax) * 100)}%` }}
                />
              </div>
              <span className="cpk-rlm__progresslabel">
                阶内 {api.realmPos.sub} / {subMax}
              </span>
            </div>
          ) : null}

          {/* 双读数对照：行囊改了、实体面板没跟上时，一眼可见「已分叉」 */}
          <div className="cpk-rlm__mirror">
            <span className="cpk-rlm__mirrorlabel">实体面板显示</span>
            <span className="cpk-rlm__mirrorvalue">{api.panelRealmText}</span>
            {api.panelRealmText !== api.realmText ? (
              <span className="cpk-rlm__diverge" title="两处已分叉，请检查绑定">
                已分叉
              </span>
            ) : (
              <span className="cpk-rlm__same">同源</span>
            )}
          </div>

          <div className="cpk-rlm__bind">
            <span className="cpk-rlm__bindlabel">主角</span>
            <Select
              size="small"
              style={{ flex: 1, minWidth: 0 }}
              value={doc.character.entityId || undefined}
              placeholder="未指定（境界仅在行囊内使用）"
              open={bindOpen}
              onOpenChange={setBindOpen}
              allowClear
              options={entities.map((entity) => ({ value: entity.id, label: entity.name }))}
              classNames={{ popup: { root: "cpk-dropdown" } }}
              onChange={(value: string | undefined) => {
                void api.bindEntity(value ?? "");
                void logUsageEvent("pack_realm_bind", { bound: Boolean(value) });
              }}
            />
          </div>
          {/* 主角是两边共用的同一个设定：说清楚入口关系，作者才不会以为
              「这里绑了、那边还要再设一次」 */}
          <p className="cpk-rlm__hint">
            {api.realmHint
              ? `${api.realmHint}。右侧「要素」栏的角色卡上点皇冠图标同样能设为主角。`
              : "与右侧「要素」栏的角色卡是同一个人：那边设了主角，这里立刻跟着变。"}
          </p>
        </>
      )}
    </PackModuleShell>
  );
}
