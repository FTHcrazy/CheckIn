import { useCallback, useEffect, useState } from "react";
import { Button, InputNumber, Modal, Select } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import {
  fetchPackBindableEntities,
  logUsageEvent,
} from "@/shared/services/novel-shared";
import type { LadderRung } from "../../pack-utils";
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
  const [rungOpen, setRungOpen] = useState(false);
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

  const rungs: LadderRung[] = api.rungs;
  const doc = api.doc;
  if (!doc) return null;
  const key = "realm" as const;
  const rung = rungs[api.realmPos.index];
  const subMax = Math.max(1, rung?.subLevels ?? 1);
  /** 已在顶阶最后一小层：再进位无处可去（按钮据此置灰并给出原因） */
  const atLadderTop =
    api.realmPos.index === rungs.length - 1 && api.realmPos.sub >= subMax;

  const step = (delta: number) => {
    void api.writeRealm(api.realmPos, "pack", { carry: true, delta });
  };

  const pick = (index: number) => {
    void api.writeRealm({ index, sub: 1 }, "pack");
  };

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      actions={
        <Button
          className="cpk-iconbtn"
          onClick={() => setRungOpen(true)}
          title="阶设置（小层数 / 战力当量）"
        >
          <SettingOutlined />
        </Button>
      }
    >
      {rungs.length === 0 ? (
        <p className="cpk-empty">
          这本书还没有等级体系。境界直接复用「设定 → 等级体系」（R25）里的那一套，
          先在那里建好阶梯，这里就能用了。
        </p>
      ) : (
        <>
          <div className="cpk-rlm__now">
            <span className="cpk-rlm__value">{api.realmText}</span>
            <span className="cpk-rlm__stepper">
              <Button className="cpk-btn ghost" onClick={() => step(-1)}>
                − 1 层
              </Button>
              <Button className="cpk-btn ghost" onClick={() => step(1)}>
                + 1 层
              </Button>
            </span>
          </div>

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

          <ul className="cpk-rlm__ladder">
            {rungs.map((item, index) => (
              <li key={item.id}>
                <Button
                  className={`cpk-rlm__rung${index === api.realmPos.index ? " is-on" : ""}${
                    index < api.realmPos.index ? " is-passed" : ""
                  }`}
                  onClick={() => pick(index)}
                  title={item.power ? `战力当量 ${item.power}` : "点击跳到这一阶"}
                >
                  {item.name}
                  {item.subLevels > 1 ? <em>{item.subLevels}</em> : null}
                </Button>
              </li>
            ))}
          </ul>

          {subMax > 1 ? (
            <div className="cpk-rlm__sub">
              <span className="cpk-rlm__sublabel">小层</span>
              <Select
                size="small"
                value={api.realmPos.sub}
                style={{ width: 76 }}
                options={Array.from({ length: subMax }, (_, index) => ({
                  value: index + 1,
                  label: `${index + 1} / ${subMax}`,
                }))}
                classNames={{ popup: { root: "cpk-dropdown" } }}
                onChange={(value: number) =>
                  void api.writeRealm({ index: api.realmPos.index, sub: value }, "pack")
                }
              />
              <Button
                className="cpk-btn ghost"
                // 已在顶阶满层时进位无处可去（carryRealm 会原样返回）。
                // 不禁用的话「点了没反应」与「功能坏了」长得一样 —— 这正是
                // 本次报障的最初观感，所以把「到顶」显式说出来。
                disabled={atLadderTop}
                title={atLadderTop ? "已是最高阶最后一层" : "推进一小层，满层自动进位"}
                onClick={() =>
                  // ⚠️ `carry: true` 不可省：writeRealm / setRealm 都按它分支，
                  // 缺了就走 clampRealm(pos) —— 位置原样返回，看着「点了没反应」
                  void api.writeRealm(api.realmPos, "pack", {
                    carry: true,
                    delta: 1,
                  })
                }
              >
                阶内进位
              </Button>
            </div>
          ) : null}

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

      <Modal
        open={rungOpen}
        title="阶设置（与实体面板共享同一张表）"
        centered
        width={420}
        footer={
          <div className="cpk-guard__footer">
            <Button onClick={() => setRungOpen(false)}>关闭</Button>
          </div>
        }
      >
        <p className="cpk-guard__sub">
          小层数决定「炼气 9 层」这种阶内分层；战力当量是可选的跨阶比较基准。
          两处改动都会立刻同步到实体面板的等级体系。
        </p>
        <ul className="cpk-rlm__metas">
          {rungs.map((item) => (
            <li key={item.id} className="cpk-rlm__meta">
              <span className="cpk-rlm__metaname">{item.name}</span>
              <label className="cpk-rlm__metafield">
                <span>小层</span>
                <InputNumber
                  size="small"
                  min={1}
                  style={{ width: 62 }}
                  value={item.subLevels}
                  onChange={(value) =>
                    void api.setRungMeta(item.id, { subLevels: Math.max(1, Number(value) || 1) })
                  }
                />
              </label>
              <label className="cpk-rlm__metafield">
                <span>当量</span>
                <InputNumber
                  size="small"
                  min={0}
                  style={{ width: 76 }}
                  value={item.power ?? undefined}
                  placeholder="—"
                  onChange={(value) =>
                    void api.setRungMeta(item.id, {
                      power: value === null ? null : Number(value),
                    })
                  }
                />
              </label>
            </li>
          ))}
        </ul>
      </Modal>
    </PackModuleShell>
  );
}
