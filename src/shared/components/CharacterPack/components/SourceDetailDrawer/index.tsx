import { Button, Modal } from "antd";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { formatAttrValue } from "../../pack-utils";
import { NATURE_META, OP_META } from "../../types";
import type { PackDoc } from "../../hooks/usePackData";
import "./index.scss";

interface SourceDetailDrawerProps {
  api: PackPanelApi;
}

/** 把 carrierKey 解析成「谁给的」：装备名 / 技能名 / 状态名 */
function ownerLabel(doc: PackDoc, ownerType: string, ownerId: string): string {
  if (ownerType === "item") {
    return doc.items.find((item) => item.id === ownerId)?.name || "（已删除的装备）";
  }
  if (ownerType === "skill") {
    return doc.skills.find((skill) => skill.id === ownerId)?.name || "（已删除的技能）";
  }
  return (
    doc.modifiers.find((mod) => mod.ownerType === "status" && mod.ownerId === ownerId)?.name ||
    "状态效果"
  );
}

/**
 * 来源明细（REQ-017）
 *
 * 汇总面板上的每一个总览值都必须能点开看到「这个数是怎么来的」——
 * 否则作者不敢信面板，功能就白做了。
 */
export default function SourceDetailDrawer({ api }: SourceDetailDrawerProps) {
  const doc = api.doc;
  const attrId = api.detailAttrId;
  if (!doc) return null;

  const attr = doc.attributes.find((candidate) => candidate.id === attrId) ?? null;
  const row = attrId ? api.summary.byAttr.get(attrId) : undefined;

  return (
    <Modal
      open={Boolean(attrId)}
      title={attr ? `「${attr.name}」的来源明细` : "来源明细"}
      centered
      width={460}
      onCancel={() => api.setDetailAttrId(null)}
      footer={
        <div className="cpk-guard__footer">
          <Button onClick={() => api.setDetailAttrId(null)}>关闭</Button>
        </div>
      }
    >
      {!attr || !row ? (
        <p className="cpk-empty">这项属性已经不存在了。</p>
      ) : (
        <>
          <ul className="cpk-src">
            <li className="cpk-src__row is-base">
              <span className="cpk-src__who">基础值</span>
              <span className="cpk-src__what">
                {formatAttrValue(row.base, attr.decimals)}
                {attr.unit}
              </span>
            </li>
            {row.contributions.length === 0 ? (
              <li className="cpk-src__row">
                <span className="cpk-src__who">暂无加成</span>
                <span className="cpk-src__what cpk-src__what--muted">
                  穿上装备或开启技能后会出现在这里
                </span>
              </li>
            ) : (
              row.contributions.map((item) => (
                <li key={item.modifierId} className={`cpk-src__row is-${item.nature}`}>
                  <span className="cpk-src__who">
                    <span className={`cpk-bdg is-${item.nature}`} title={NATURE_META[item.nature].hint}>
                      {NATURE_META[item.nature].badge}
                    </span>
                    {ownerLabel(doc, item.ownerType, item.ownerId)}
                  </span>
                  <span className="cpk-src__what">
                    {OP_META[item.op].symbol}
                    {formatAttrValue(item.applied, item.op === "mul" ? 2 : attr.decimals)}
                    {item.op === "percent" ? "%" : ""}
                  </span>
                </li>
              ))
            )}
          </ul>

          <div className="cpk-src__total">
            <span>总览值</span>
            <span className="cpk-src__totalnum">
              {formatAttrValue(row.final, attr.decimals)}
              {attr.unit}
            </span>
          </div>

          <p className="cpk-guard__sub">
            被动与持续是同一个运算池：先加算、再百分比、最后乘算；覆盖型命中时直接取覆盖值。
            {row.overrideCount > 1 ? ` 当前有 ${row.overrideCount} 条覆盖型效果互相冲突。` : ""}
          </p>
        </>
      )}
    </Modal>
  );
}
