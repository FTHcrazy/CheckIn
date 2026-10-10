import { useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { Button, Modal, Switch } from "antd";
import { HolderOutlined, ReloadOutlined } from "@ant-design/icons";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleDesc, moduleLabel } from "../module-meta";
import type { PackModuleKey } from "../../types";
import "./index.scss";

interface ModuleManagerProps {
  api: PackPanelApi;
}

/**
 * 模块拼装（E-1）：启用 / 排序 / 恢复默认
 *
 * 排序走**原生 HTML5 拖拽**（与左栏 `ChapterTreeItem` / `VolumeNode` 同一套做法，
 * 不引入 dnd-kit 这类新依赖）。手柄另外吃 ↑↓ 方向键 —— 拖拽对键盘用户完全不可达，
 * 而这一条要求的是「排序」，不该以牺牲可达性为代价换来。
 *
 * 顺序与启用都走**草稿**（它们是这本书的设定数据，不是界面偏好）；折叠才走
 * 全局 config，理由见进度文档 §4。
 */
export default function ModuleManager({ api }: ModuleManagerProps) {
  const ordered = api.modules;
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);

  /** 把 `fromKey` 移到 `toKey` 原位上，其余顺延（插入语义，不是两两交换） */
  const moveTo = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const keys: PackModuleKey[] = ordered.map((module) => module.key);
    const from = keys.indexOf(fromKey as PackModuleKey);
    const to = keys.indexOf(toKey as PackModuleKey);
    if (from < 0 || to < 0) return;
    keys.splice(to, 0, ...keys.splice(from, 1));
    api.setModuleOrder(keys);
  };

  /** 键盘路径：与「上移 / 下移」同效 */
  const moveBy = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const keys: PackModuleKey[] = ordered.map((module) => module.key);
    [keys[index], keys[target]] = [keys[target], keys[index]];
    api.setModuleOrder(keys);
  };

  const handleDragStart = (event: DragEvent<HTMLLIElement>, key: string) => {
    setDragKey(key);
    event.dataTransfer.effectAllowed = "move";
    // 有些实现不带 data 就不会真的启动拖拽，写个占位值
    event.dataTransfer.setData("text/plain", key);
  };

  const handleDragOver = (event: DragEvent<HTMLLIElement>, key: string) => {
    if (!dragKey || dragKey === key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropKey(key);
  };

  const handleDrop = (event: DragEvent<HTMLLIElement>, key: string) => {
    event.preventDefault();
    setDragKey(null);
    setDropKey(null);
    if (dragKey) moveTo(dragKey, key);
  };

  const endDrag = () => {
    setDragKey(null);
    setDropKey(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    moveBy(index, event.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <Modal
      open={api.moduleManagerOpen}
      title="模块管理"
      centered
      width={420}
      onCancel={() => api.setModuleManagerOpen(false)}
      footer={
        <div className="cpk-guard__footer">
          <Button icon={<ReloadOutlined />} onClick={api.resetModules}>
            恢复默认
          </Button>
          <Button type="primary" onClick={() => api.setModuleManagerOpen(false)}>
            完成
          </Button>
        </div>
      }
    >
      <p className="cpk-guard__sub">
        关掉的模块会从面板上消失（配置保留，随时可以再打开）。拖动左侧手柄调整顺序，
        也可以用手柄的方向键。
      </p>
      <ul className="cpk-mgr">
        {ordered.map((module, index) => (
          <li
            key={module.key}
            className={`cpk-mgr__row${dragKey === module.key ? " is-dragging" : ""}${
              dropKey === module.key ? " is-drop" : ""
            }`}
            draggable
            onDragStart={(event) => handleDragStart(event, module.key)}
            onDragOver={(event) => handleDragOver(event, module.key)}
            onDragLeave={() => setDropKey((current) => (current === module.key ? null : current))}
            onDrop={(event) => handleDrop(event, module.key)}
            onDragEnd={endDrag}
          >
            <Button
              className="cpk-iconbtn tiny cpk-mgr__handle"
              aria-label={`调整「${moduleLabel(module.key)}」的顺序`}
              title="拖动排序（也可用 ↑↓ 方向键）"
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <HolderOutlined />
            </Button>
            <span className="cpk-mgr__text">
              <span className="cpk-mgr__label">{moduleLabel(module.key)}</span>
              <span className="cpk-mgr__desc">{moduleDesc(module.key)}</span>
            </span>
            <Switch
              size="small"
              className="cpk-sw2"
              checked={module.enabled}
              onChange={(checked) => api.setModuleEnabled(module.key, checked)}
              title={module.enabled ? "已启用" : "已关闭"}
            />
          </li>
        ))}
      </ul>
    </Modal>
  );
}
