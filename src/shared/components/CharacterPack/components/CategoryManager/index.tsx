import { useMemo, useState } from "react";
import { Button, Input, Modal, Select } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import "./index.scss";

interface CategoryManagerProps {
  api: PackPanelApi;
}

/**
 * 分类管理（1.40.0）：物品栏分类的行内编辑弹窗。
 *
 * 分类是物品的盘点维度（装备 / 丹药 / 材料…），三件事都在一行里：
 * - **改名**：直接输入。名字是物品行 `category` 的关联键，改名会传播到
 *   全部物品；撞名时被拒绝（`updateCategory` 返回 false → toast 说明）。
 * - **绑定体系**：选定小说设定域的一个等级体系（novel_setting_categories）。
 *   绑定后，归属该分类的物品就能从这套体系里选品阶（小刀 · 神器）。
 * - **删除**：分类下物品退回「未分类」，确认框报条数。
 *
 * 「没有小说体系」的引导：设定域一个体系都没有时，绑定列整体降级为一条
 * 引导文案 —— 品阶的前提是有体系可选，先去设定中心建。
 */
export default function CategoryManager({ api }: CategoryManagerProps) {
  const doc = api.doc;
  /** 待删除的分类 id（确认框开着时非空） */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const categories = useMemo(
    () =>
      doc
        ? [...doc.categories].sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [doc],
  );

  const systemOptions = useMemo(
    () =>
      api.gradeSystems.map((system) => ({
        value: system.id,
        label:
          system.levels.length > 0
            ? `${system.name}（${system.levels.length} 级）`
            : system.name,
      })),
    [api.gradeSystems],
  );

  if (!doc) return null;

  const pending = categories.find((category) => category.id === pendingDelete);
  const pendingCount = pending
    ? doc.items.filter((item) => item.category === pending.name).length
    : 0;

  const confirmRemove = () => {
    if (pendingDelete) {
      const count = api.removeCategory(pendingDelete);
      api.showToast(
        count > 0 ? `已删除分类，${count} 个物品退回「未分类」` : "已删除分类",
        "info",
      );
    }
    setPendingDelete(null);
  };

  return (
    <Modal
      open={api.categoryManagerOpen}
      title="分类管理"
      centered
      width={560}
      onCancel={() => api.setCategoryManagerOpen(false)}
      footer={
        <div className="cpk-guard__footer">
          <Button onClick={() => api.setCategoryManagerOpen(false)}>完成</Button>
        </div>
      }
    >
      <p className="cpk-guard__sub">
        分类是物品的盘点维度，名字在下面直接输入，物品的「分类」下拉与导出文本实时跟随。
        给分类<b>绑定小说设定的等级体系</b>后，该分类下的物品就能标注品阶（小刀 · 神器、鞭子 · 仙器）。
      </p>

      {api.gradeSystems.length === 0 ? (
        <p className="cpk-catmgr__guide">
          这本书还没有等级体系：到「设定中心」新建一个分类（如「法宝品阶」：法器、灵器…神器），
          再回来绑定，物品就能标注品阶。
        </p>
      ) : null}

      {categories.length === 0 ? (
        <p className="cpk-empty">还没有分类。物品暂时都是「未分类」。</p>
      ) : (
        <ul className="cpk-catmgr">
          {categories.map((category) => {
            const memberCount = doc.items.filter(
              (item) => item.category === category.name,
            ).length;
            const bound = api.gradeSystems.find((system) => system.id === category.systemId);
            return (
              <li key={category.id} className="cpk-catmgr__row">
                <div className="cpk-catmgr__line">
                  <Input
                    size="small"
                    className="cpk-catmgr__name"
                    value={category.name}
                    placeholder="输入分类名"
                    aria-label={`分类名：${category.name}`}
                    title="分类名：物品下拉与导出文本实时跟随"
                    onChange={(event) => {
                      const ok = api.updateCategory(category.id, { name: event.target.value });
                      if (!ok) api.showToast("已有同名分类，换个名字", "warning");
                    }}
                  />
                  {api.gradeSystems.length > 0 ? (
                    <Select
                      size="small"
                      className="cpk-catmgr__system"
                      value={category.systemId || undefined}
                      placeholder="绑定体系（选品阶用）"
                      allowClear
                      options={systemOptions}
                      popupMatchSelectWidth={false}
                      classNames={{ popup: { root: "cpk-dropdown" } }}
                      title="绑定后，该分类下的物品可标注这套体系的品阶"
                      onChange={(value?: string) =>
                        api.updateCategory(category.id, { systemId: value ?? "" })
                      }
                    />
                  ) : null}
                  <Button
                    className="cpk-iconbtn tiny danger"
                    onClick={() => setPendingDelete(category.id)}
                    title="删除分类（分类下物品退回未分类，不会删除）"
                  >
                    <DeleteOutlined />
                  </Button>
                </div>
                <div className="cpk-catmgr__sub">
                  <span className="cpk-catmgr__count">
                    {memberCount} 个物品
                    {bound ? ` · ${bound.name}` : " · 未绑定体系"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="cpk-catmgr__foot">
        <Button icon={<PlusOutlined />} onClick={() => api.addCategory()}>
          新增分类
        </Button>
        <span className="cpk-catmgr__count">共 {categories.length} 个分类</span>
      </div>

      <Modal
        open={pendingDelete !== null}
        title="删除分类"
        centered
        width={360}
        onCancel={() => setPendingDelete(null)}
        footer={
          <div className="cpk-guard__footer">
            <Button onClick={() => setPendingDelete(null)}>取消</Button>
            <Button type="primary" onClick={confirmRemove}>
              删除分类
            </Button>
          </div>
        }
      >
        <p className="cpk-guard__text">
          删除「{pending?.name}」？分类下的 {pendingCount} 个物品会退回「未分类」，
          本身不会被删除。
        </p>
      </Modal>
    </Modal>
  );
}
