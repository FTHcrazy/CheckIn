import { Button, InputNumber, Modal, Select, Switch } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { ITEM_CATEGORIES } from "../../types";
import "./index.scss";

interface SlotManagerProps {
  api: PackPanelApi;
}

const CATEGORY_OPTIONS = ITEM_CATEGORIES.map((category) => ({
  value: category,
  label: category,
}));

/**
 * 部位设置（A-2）
 *
 * 容量与「可接受类别」是作者自定义装备栏的两把钥匙：戒指容量 2 就能戴两个，
 * 只在 accepts 里选「装备」就挡住了丹药被塞进武器位。
 */
export default function SlotManager({ api }: SlotManagerProps) {
  const doc = api.doc;
  if (!doc) return null;
  const slots = [...doc.slots].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <Modal
      open={api.slotManagerOpen}
      title="装备部位设置"
      centered
      width={540}
      onCancel={() => api.setSlotManagerOpen(false)}
      footer={
        <div className="cpk-guard__footer">
          <Button onClick={() => api.setSlotManagerOpen(false)}>完成</Button>
        </div>
      }
    >
      <p className="cpk-guard__sub">
        容量决定这个部位能同时穿几件（戒指给 2 就是双手都戴）。「仅接受」留空表示任何分类都放得进去。
      </p>

      <ul className="cpk-slotmgr">
        {slots.map((slot) => (
          <li key={slot.id} className="cpk-slotmgr__row">
            <div className="cpk-slotmgr__line">
              <input
                className="cpk-inline cpk-slotmgr__name"
                value={slot.name}
                placeholder="部位名"
                aria-label="部位名"
                onChange={(event) => api.updateSlot(slot.id, { name: event.target.value })}
              />
              <label className="cpk-slotmgr__field">
                <span>容量</span>
                <InputNumber
                  size="small"
                  min={1}
                  max={8}
                  style={{ width: 58 }}
                  value={slot.capacity}
                  onChange={(value) => api.shrinkSlotCapacity(slot.id, Number(value) || 1)}
                />
              </label>
              <Select
                size="small"
                mode="multiple"
                allowClear
                className="cpk-slotmgr__accepts"
                placeholder="仅接受（不限）"
                value={slot.accepts}
                options={CATEGORY_OPTIONS}
                maxTagCount={2}
                classNames={{ popup: { root: "cpk-dropdown" } }}
                onChange={(value: string[]) => api.updateSlot(slot.id, { accepts: value })}
              />
              <Switch
                size="small"
                checked={slot.enabled}
                onChange={(checked) => api.updateSlot(slot.id, { enabled: checked })}
                title={slot.enabled ? "启用中" : "已停用（该部位的装备不再在效）"}
              />
              <button
                type="button"
                className="cpk-iconbtn tiny danger"
                onClick={() => api.removeSlot(slot.id)}
                title="删除部位（里面的装备退回物品栏）"
              >
                <DeleteOutlined />
              </button>
            </div>
            <input
              className="cpk-inline cpk-slotmgr__note"
              value={slot.note}
              placeholder="备注（例如「作者私设：灵器位」）"
              aria-label="部位备注"
              onChange={(event) => api.updateSlot(slot.id, { note: event.target.value })}
            />
          </li>
        ))}
      </ul>

      <div className="cpk-slotmgr__foot">
        <Button icon={<PlusOutlined />} onClick={() => api.addSlot()}>
          新增部位
        </Button>
        <span className="cpk-slotmgr__count">共 {slots.length} 个部位</span>
      </div>
    </Modal>
  );
}
