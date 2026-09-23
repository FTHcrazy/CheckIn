import { useCallback } from "react";
import { Card, Input, Modal, Empty } from "antd";
import Page from "@/shared/components/Page";
import MemoEditor from "./components/MemoEditor";
import MemoHeader, { MemoCardTitle } from "./components/MemoHeader";
import MemoPreview from "./components/MemoPreview";
import MemoSidebar from "./components/MemoSidebar";
import { useMemoData } from "./hooks/useMemoData";
import { useMemoEditorState } from "./hooks/useMemoEditorState";
import "./index.scss";

/**
 * 备忘页
 *
 * 编排层只持有低频状态（选中文件 / 编辑态 / 弹窗 / 保存中）与稳定回调：
 * 正文草稿由 MemoEditor 订阅、预览原文由 MemoPreview 订阅、搜索态由
 * MemoHeader 订阅——因此「敲一个字」不再让侧栏虚拟列表陪跑。
 */
function MemoPage() {
  const data = useMemoData();
  const editor = useMemoEditorState(data);

  const {
    files,
    loading,
    importing,
    loadFiles,
    openInExplorer,
    exportBackup,
    importBackup,
  } = data;
  const {
    selected,
    isEditing,
    createModalOpen,
    newFileName,
    saving,
    handleSelectFile,
    handleRename,
    handleImport,
    handleExport,
    handleDelete,
    handleTextAreaBlur,
    handleSave,
    handleCreate,
    setNewFileName,
    setCreateModalOpen,
  } = editor;

  // 侧栏回调收敛成稳定引用：此前这里写着 8 个内联箭头，
  // 父层每渲染一次就换一批身份，任何 memo 都会被立刻击穿
  const onCreate = useCallback(
    () => setCreateModalOpen(true),
    [setCreateModalOpen],
  );
  const onImport = useCallback(() => {
    void handleImport();
  }, [handleImport]);
  const onImportBackup = useCallback(() => {
    void importBackup();
  }, [importBackup]);
  const onExport = useCallback(
    (format: "txt" | "docx" | "backup") => {
      if (format === "backup") void exportBackup();
      else void handleExport(format);
    },
    [exportBackup, handleExport],
  );
  const onRefresh = useCallback(() => {
    void loadFiles();
  }, [loadFiles]);
  const onSelect = useCallback(
    (filename: string) => {
      void handleSelectFile(filename);
    },
    [handleSelectFile],
  );
  const onDelete = useCallback(
    (filename: string) => {
      void handleDelete(filename);
    },
    [handleDelete],
  );
  const onOpenInExplorer = useCallback(
    (filename: string) => {
      void openInExplorer(filename);
    },
    [openInExplorer],
  );

  return (
    <Page>
      <div className="memo-page">
        <MemoSidebar
          files={files}
          selected={selected}
          loading={loading || importing}
          onCreate={onCreate}
          onImport={onImport}
          onImportBackup={onImportBackup}
          onExport={onExport}
          onRefresh={onRefresh}
          onSelect={onSelect}
          onRename={handleRename}
          onDelete={onDelete}
          onOpenInExplorer={onOpenInExplorer}
        />

        <div className="memo-editor">
          {selected ? (
            <>
              <MemoHeader
                isEditing={isEditing}
                saving={saving}
                onSave={() => void handleSave()}
              />

              <Card
                title={
                  <MemoCardTitle selected={selected} isEditing={isEditing} />
                }
                className="memo-editor-card"
              >
                {isEditing ? (
                  <MemoEditor onBlur={() => void handleTextAreaBlur()} />
                ) : (
                  <MemoPreview />
                )}
              </Card>
            </>
          ) : (
            <div className="memo-editor-empty">
              <Empty description="选择左侧文件或新建一个备忘" />
            </div>
          )}
        </div>
      </div>

      <Modal
        title="新建备忘文件"
        open={createModalOpen}
        destroyOnHidden
        onOk={() => void handleCreate()}
        onCancel={() => {
          setCreateModalOpen(false);
          setNewFileName("");
        }}
        okText="创建"
        cancelText="取消"
      >
        <Input
          placeholder="输入文件名（自动添加 .md 后缀）"
          value={newFileName}
          onChange={(event) => setNewFileName(event.target.value)}
          onPressEnter={() => void handleCreate()}
          autoFocus
        />
      </Modal>
    </Page>
  );
}

export default MemoPage;
