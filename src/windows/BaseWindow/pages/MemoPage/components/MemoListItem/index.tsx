import { Button, Input, Popconfirm, Tooltip, Typography } from "antd";
import {
  DeleteOutlined,
  FileMarkdownOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { MemoFile } from "../../types";
import "./index.scss";

const { Text } = Typography;

interface MemoListItemProps {
  item: MemoFile;
  selected: string | null;
  onSelect: (filename: string) => void;
  onRename: (filename: string, name: string) => Promise<boolean>;
  onDelete: (filename: string) => void;
  onOpenInExplorer: (filename: string) => void;
}

export default function MemoListItem({
  item,
  selected,
  onSelect,
  onRename,
  onDelete,
  onOpenInExplorer,
}: MemoListItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const composingRef = useRef(false);
  const submittingRef = useRef(false);

  const startRename = (): void => {
    setEditing(true);
    setDraft(item.name.replace(/\.md$/, ""));
  };

  const cancelRename = (): void => {
    setEditing(false);
    setDraft("");
  };

  const handleRename = async (): Promise<void> => {
    if (submittingRef.current || !editing) return;

    const trimmedName = draft.trim();
    if (!trimmedName) {
      cancelRename();
      return;
    }

    submittingRef.current = true;
    try {
      const renamed = await onRename(item.name, trimmedName);
      if (renamed) {
        cancelRename();
      }
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <div
      key={item.name}
      className={`memo-list-item ${selected === item.name ? "memo-list-item--active" : ""}`}
      onClick={() => onSelect(item.name)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        startRename();
      }}
    >
      <div className="memo-list-item-content">
        <div className="memo-list-item-icon">
          <FileMarkdownOutlined
            style={{ fontSize: 20, color: "var(--app-primary)" }}
          />
        </div>
        <div className="memo-list-item-info">
          {editing ? (
            <Input
              autoFocus
              size="small"
              value={draft}
              className="memo-list-item-title"
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setDraft(event.target.value)}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              onBlur={() => {
                if (composingRef.current) return;
                void handleRename();
              }}
              onPressEnter={(event: KeyboardEvent<HTMLInputElement>) => {
                if (composingRef.current || event.nativeEvent.isComposing) return;
                void handleRename();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  cancelRename();
                }
              }}
            />
          ) : (
            <Text ellipsis className="memo-list-item-title">
              {item.name.replace(/\.md$/, "")}
            </Text>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            {dayjs(item.updatedAt).format("MM-DD HH:mm")}
          </Text>
        </div>
        <div className="memo-list-item-actions">
          <Tooltip title="在文件夹中显示">
            <Button
              type="text"
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                onOpenInExplorer(item.name);
              }}
            />
          </Tooltip>
          <Popconfirm
            title="确定删除此文件？"
            onConfirm={(event) => {
              event?.stopPropagation();
              onDelete(item.name);
            }}
            onCancel={(event) => event?.stopPropagation()}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={(event) => event.stopPropagation()}
            />
          </Popconfirm>
        </div>
      </div>
    </div>
  );
}
