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
import {
  realmLadderUsesDropdown,
  realmSubAriaLabel,
  realmSubBarVisible,
  realmSubUsesDropdown,
  subLabelAt,
} from "../../pack-utils";
import "./index.scss";

interface RealmModuleProps {
  api: PackPanelApi;
}

/**
 * 境界（R25 联动，§9.7）
 *
 * 全部读写都走 `getRealm / getPanelRealm / setRealm` 三个口子（REQ-048）——
 * 面板上的「实体面板显示」对照条刻意保留，就是为了让「行囊改了、面板没跟着变」
 * 这种静默不同步一眼可见；但同源时不再重复整串等阶文案（去重，见下方 mirror）。
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
   * 直选某一小层（UI-02）：点层号条 / 层下拉。
   *
   * 只在阶内跳，不跨阶；夹取由 `writeRealm → clampRealm` 统一负责，
   * toast 文案取 `plan.position`（唯一真相源），这里不二次计算。
   */
  const pickSub = (sub: number) => {
    void api.writeRealm({ index: api.realmPos.index, sub }, "pack");
  };

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
        <div className="cpk-emptyblock">
          <p className="cpk-empty">
            这本书还没有等级体系。境界复用「设定中心」的等级序列（R25），
            先在那里建好阶梯，这里就能用了。
          </p>
          <div className="cpk-emptyblock__actions">
            <Button
              type="primary"
              size="small"
              className="cpk-emptyblock__cta"
              onClick={() => api.openRealmSettingCenter()}
            >
              去设定中心创建
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/*
            阶的直选（UI-02）。

            阶数 ≤ 阈值：横向阶梯 chip 行（对齐设计稿）。刻意不换行 + 横向滚动：
            换行会让「炼气…化神」这排高低次序变成两段，反而看不出进度；
            横向滚动保持「一条尺子」的读法，窄窗口下也能拖。

            阶数 > 阈值：chip 行太长，扫不动也点不准，改用下拉作主路径
            （阈值与判据见 `realmLadderUsesDropdown`，抽成纯函数便于测试）。
          */}
          {realmLadderUsesDropdown(rungs.length) ? (
            <div className="cpk-rlm__rungdrop">
              <Select
                size="small"
                style={{ flex: 1, minWidth: 0 }}
                value={api.realmPos.index}
                options={rungs.map((item, index) => ({ value: index, label: item.name }))}
                classNames={{ popup: { root: "cpk-dropdown" } }}
                onChange={(index: number) => pick(index)}
                aria-label="选择境界阶"
              />
            </div>
          ) : (
            <div className="cpk-rlm__ladderwrap">
              <ul className="cpk-rlm__ladder">
                {rungs.map((item, index) => (
                  <li key={item.id}>
                    <Button
                      className={`cpk-rlm__rung${index === api.realmPos.index ? " is-on" : ""}${
                        index < api.realmPos.index ? " is-passed" : ""
                      }`}
                      onClick={() => pick(index)}
                      aria-current={index === api.realmPos.index ? "true" : undefined}
                      title="点击跳到这一阶"
                    >
                      {item.name}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 当前境界 + 距下一阶进度（设计稿此处是一条横向进度条）。
              REQ-051/052：小层名已并入 `realmText`（`筑基 * 初期 1/4`），
              不再另挂一枚别名 chip —— 「走到哪 + 现在是什么」合并成一句读。 */}
          <div className="cpk-rlm__now">
            <span className="cpk-rlm__value">{api.realmText}</span>
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
            小层直选（UI-02）：层号条 `1..N`，N > 阈值改下拉。

            ⚠️ 与下方「阶内进度条」是两块：进度条是**纯读数**（不挂按钮，
            有守卫钉住），层号条是**可点选择**（跳层）。两者刻意分 DOM，
            别把层号塞进 `.cpk-rlm__progress` —— 那会让「进度条无按钮」的断言失效，
            而且「读数」与「可点选项」在视觉上混在一起也难分辨。
            `subMax <= 1` 时整块不渲染（单选项 `[1]` 是噪声）。
          */}
          {realmSubBarVisible(subMax) ? (
            realmSubUsesDropdown(subMax) ? (
              <div className="cpk-rlm__subbar">
                <span className="cpk-rlm__sublabel">小层</span>
                <Select
                  size="small"
                  style={{ flex: 1, minWidth: 0 }}
                  value={api.realmPos.sub}
                  options={Array.from({ length: subMax }, (_, i) => {
                    const sub = i + 1;
                    const alias = subLabelAt(rung, sub);
                    return { value: sub, label: alias ? `${sub} · ${alias}` : `${sub}` };
                  })}
                  classNames={{ popup: { root: "cpk-dropdown" } }}
                  onChange={(sub: number) => pickSub(sub)}
                  aria-label="选择小层"
                />
              </div>
            ) : (
              <div className="cpk-rlm__subbar" role="group" aria-label="小层直选">
                <span className="cpk-rlm__sublabel">小层</span>
                <div className="cpk-rlm__subnums">
                  {Array.from({ length: subMax }, (_, i) => {
                    const sub = i + 1;
                    return (
                      <Button
                        key={sub}
                        className={`cpk-rlm__subnum${
                          sub === api.realmPos.sub ? " is-on" : ""
                        }`}
                        aria-current={sub === api.realmPos.sub ? "true" : undefined}
                        aria-label={realmSubAriaLabel(rung, sub)}
                        title={realmSubAriaLabel(rung, sub)}
                        onClick={() => pickSub(sub)}
                      >
                        {sub}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )
          ) : null}

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
                  style={{ transform: `scaleX(${api.realmPos.sub / subMax})` }}
                />
              </div>
              <span className="cpk-rlm__progresslabel">
                阶内 {api.realmPos.sub} / {subMax}
              </span>
            </div>
          ) : null}

          {/*
            双读数对照（去重）：同一等阶信息只完整出现一次 —— 主读数在
            `.cpk-rlm__value`。同源时面板值与主读数逐字相同，这里只给一句
            「同源」弱提示，不再把「凝丹 * 一层 1/3」整串重复一遍；
            分叉时才把面板值摆出来，静默不同步仍一眼可见。
          */}
          <div className="cpk-rlm__mirror">
            <span className="cpk-rlm__mirrorlabel">实体面板显示</span>
            {api.panelRealmText !== api.realmText ? (
              <>
                <span className="cpk-rlm__mirrorvalue">{api.panelRealmText}</span>
                <span className="cpk-rlm__diverge" title="两处已分叉，请检查绑定">
                  已分叉
                </span>
              </>
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
            {/* 未绑定主角时的引导按钮（UI-03）：把「没设主角」变成一键动作，
                而不是只留一句说明。点它展开选择器 —— 绑定必须挑具体是谁，
                所以不做「替你选第一个」的隐式行为。已在档位里绑过就不出现。 */}
            {!doc.character.entityId ? (
              <Button
                size="small"
                className="cpk-emptyblock__cta"
                disabled={entities.length === 0}
                title={
                  entities.length === 0
                    ? "这本书还没有可绑定的角色要素，先去右侧「要素」栏建一个角色"
                    : "选择要设为主角的角色"
                }
                onClick={() => setBindOpen(true)}
              >
                设为主角
              </Button>
            ) : null}
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
