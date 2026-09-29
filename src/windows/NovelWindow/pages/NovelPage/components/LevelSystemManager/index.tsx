import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button, Input, Modal, Popconfirm, Select, Space } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type { LevelRung, LevelSystem } from "../../types";
import "./index.scss";

interface LevelSystemManagerProps {
  open: boolean;
  levelSystems: LevelSystem[];
  onClose: () => void;
  /** 新建体系：返回 null 表示名称非法（调用方已 toast，这里不再重复提示） */
  onCreateSystem: (name: string) => LevelSystem | null;
  onRenameSystem: (systemId: string, name: string) => void;
  onDeleteSystem: (systemId: string) => void;
  onAddLevel: (systemId: string, name: string) => LevelRung | null;
  onRenameLevel: (rungId: string, name: string) => void;
  onDeleteLevel: (rungId: string) => void;
  /** 等级项重排：orderedIds 为目标顺序（rank 从 1 起） */
  onReorderLevels: (systemId: string, orderedIds: string[]) => void;
}

/**
 * 等级体系管理弹框（R25）
 *
 * 体系下拉切换 + 体系增删改；选中体系内的等级项支持增删改与上下移动。
 * 境界绑定（EntityDetail「当前境界」）引用的是 novel_levels.id，删除等级项 /
 * 体系时主进程与本地乐观更新都会级联摘除绑定，这里不重复处理。
 */
export default function LevelSystemManager({
  open,
  levelSystems,
  onClose,
  onCreateSystem,
  onRenameSystem,
  onDeleteSystem,
  onAddLevel,
  onRenameLevel,
  onDeleteLevel,
  onReorderLevels,
}: LevelSystemManagerProps) {
  const [selectedId, setSelectedId] = useState("");
  const [newSystemName, setNewSystemName] = useState("");
  const [newLevelName, setNewLevelName] = useState("");
  const [renamingSystem, setRenamingSystem] = useState(false);
  const [systemDraft, setSystemDraft] = useState("");
  const [editingLevelId, setEditingLevelId] = useState<string | null>(null);
  const [levelDraft, setLevelDraft] = useState("");

  // 打开或体系列表变化时兜底选中项：保留用户选择，否则取第一个体系
  useEffect(() => {
    if (!open) return;
    setSelectedId((current) =>
      current && levelSystems.some((system) => system.id === current)
        ? current
        : levelSystems[0]?.id ?? "",
    );
  }, [open, levelSystems]);

  // 关闭即清空临时输入，避免残留草稿串场
  useEffect(() => {
    if (open) return;
    setNewSystemName("");
    setNewLevelName("");
    setRenamingSystem(false);
    setEditingLevelId(null);
  }, [open]);

  const system = useMemo(
    () => levelSystems.find((item) => item.id === selectedId) ?? null,
    [levelSystems, selectedId],
  );

  const submitNewSystem = (): void => {
    const created = onCreateSystem(newSystemName);
    if (created) {
      setSelectedId(created.id);
      setNewSystemName("");
    }
  };

  const submitSystemRename = (): void => {
    if (!system) return;
    const trimmed = systemDraft.trim();
    if (trimmed && trimmed !== system.name) onRenameSystem(system.id, trimmed);
    setRenamingSystem(false);
  };

  const submitNewLevel = (): void => {
    if (!system) return;
    const trimmed = newLevelName.trim();
    if (!trimmed) return;
    const rung = onAddLevel(system.id, trimmed);
    if (rung) setNewLevelName("");
  };

  const commitLevelRename = (): void => {
    const trimmed = levelDraft.trim();
    if (editingLevelId && trimmed) onRenameLevel(editingLevelId, trimmed);
    setEditingLevelId(null);
  };

  const handleLevelKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    commit: () => void,
    cancel: () => void,
  ): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      cancel();
    }
  };

  const moveRung = (rungId: string, direction: -1 | 1): void => {
    if (!system) return;
    const ids = system.rungs.map((rung) => rung.id);
    const index = ids.indexOf(rungId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onReorderLevels(system.id, ids);
  };

  return (
    <Modal
      open={open}
      title="等级体系管理"
      footer={null}
      width={480}
      onCancel={onClose}
      destroyOnHidden
    >
      <div className="nv-lsm">
        {/* 体系行：下拉 + 新建 */}
        <div className="nv-lsm__row">
          <Select
            className="nv-lsm__select"
            value={system?.id}
            placeholder={levelSystems.length === 0 ? "还没有体系" : undefined}
            disabled={levelSystems.length === 0}
            onChange={(value: string) => {
              setSelectedId(value);
              setRenamingSystem(false);
            }}
            options={levelSystems.map((item) => ({
              value: item.id,
              label: `${item.name}（${item.rungs.length} 级）`,
            }))}
          />
          <Space.Compact className="nv-lsm__add">
            <Input
              value={newSystemName}
              maxLength={20}
              placeholder="新体系名称，如：炼气十层"
              aria-label="新体系名称"
              onChange={(event) => setNewSystemName(event.target.value)}
              onPressEnter={submitNewSystem}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!newSystemName.trim()}
              onClick={submitNewSystem}
            />
          </Space.Compact>
        </div>

        {!system ? (
          <p className="nv-lsm__empty">
            先创建一个体系，再往里添加等级项；资料卡里即可点选「当前境界」。
          </p>
        ) : (
          <>
            {/* 体系操作行：重命名 / 删除 */}
            <div className="nv-lsm__ops">
              {renamingSystem ? (
                <Input
                  size="small"
                  value={systemDraft}
                  autoFocus
                  maxLength={20}
                  aria-label="体系名称"
                  onChange={(event) => setSystemDraft(event.target.value)}
                  onBlur={submitSystemRename}
                  onKeyDown={(event) =>
                    handleLevelKeyDown(
                      event,
                      submitSystemRename,
                      () => setRenamingSystem(false),
                    )
                  }
                />
              ) : (
                <>
                  <span className="nv-lsm__system-name">{system.name}</span>
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setSystemDraft(system.name);
                      setRenamingSystem(true);
                    }}
                  >
                    重命名
                  </Button>
                  <Popconfirm
                    title="删除该体系？"
                    description={`「${system.name}」及其全部等级项将被删除，已绑定的当前境界一并解除。`}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => {
                      onDeleteSystem(system.id);
                      setSelectedId("");
                    }}
                  >
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </>
              )}
            </div>

            {/* 等级项列表 */}
            <ul className="nv-lsm__list">
              {system.rungs.map((rung, index) => (
                <li key={rung.id} className="nv-lsm__item">
                  <span className="nv-lsm__rank">{rung.rank}</span>
                  {editingLevelId === rung.id ? (
                    <Input
                      size="small"
                      value={levelDraft}
                      autoFocus
                      maxLength={20}
                      aria-label="等级项名称"
                      onChange={(event) => setLevelDraft(event.target.value)}
                      onBlur={commitLevelRename}
                      onKeyDown={(event) =>
                        handleLevelKeyDown(
                          event,
                          commitLevelRename,
                          () => setEditingLevelId(null),
                        )
                      }
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className="nv-lsm__name"
                        title="点击重命名"
                        onClick={() => {
                          setLevelDraft(rung.name);
                          setEditingLevelId(rung.id);
                        }}
                      >
                        {rung.name}
                      </button>
                      <span className="nv-lsm__actions">
                        <Button
                          size="small"
                          type="text"
                          icon={<ArrowUpOutlined />}
                          disabled={index === 0}
                          onClick={() => moveRung(rung.id, -1)}
                        />
                        <Button
                          size="small"
                          type="text"
                          icon={<ArrowDownOutlined />}
                          disabled={index === system.rungs.length - 1}
                          onClick={() => moveRung(rung.id, 1)}
                        />
                        <Popconfirm
                          title="删除该等级项？"
                          description="指向它的「当前境界」绑定将一并解除。"
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => onDeleteLevel(rung.id)}
                        >
                          <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                          />
                        </Popconfirm>
                      </span>
                    </>
                  )}
                </li>
              ))}
              {system.rungs.length === 0 && (
                <p className="nv-lsm__empty">还没有等级项，从低到高依次添加</p>
              )}
            </ul>

            {/* 新增等级项 */}
            <Space.Compact className="nv-lsm__add nv-lsm__add--level">
              <Input
                value={newLevelName}
                maxLength={20}
                placeholder="新增等级项，如：引气"
                aria-label="新增等级项"
                onChange={(event) => setNewLevelName(event.target.value)}
                onPressEnter={submitNewLevel}
              />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!newLevelName.trim()}
                onClick={submitNewLevel}
              />
            </Space.Compact>
          </>
        )}
      </div>
    </Modal>
  );
}
