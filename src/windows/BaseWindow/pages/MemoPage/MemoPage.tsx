import { Card, Input, Modal, Empty } from "antd";
import Page from "@/shared/components/Page";
import MemoEditor from "./components/MemoEditor";
import MemoHeader, { MemoCardTitle } from "./components/MemoHeader";
import MemoPreview from "./components/MemoPreview";
import MemoSidebar from "./components/MemoSidebar";
import { useMemoData } from "./hooks/useMemoData";
import { useMemoEditorState } from "./hooks/useMemoEditorState";
import { useMemoViewState } from "./hooks/useMemoViewState";
import "./index.scss";

function MemoPage() {
  const data = useMemoData();
  const editor = useMemoEditorState(data);
  const view = useMemoViewState(
    editor.content,
    editor.originalContent,
    editor.isEditing,
  );

  const {
    files,
    loading,
    importing,
    loadFiles,
    openInExplorer,
  } = data;
  const {
    selected,
    content,
    saving,
    isEditing,
    createModalOpen,
    newFileName,
    setIsEditing,
    setCreateModalOpen,
    setNewFileName,
    setContent,
    handleSelectFile,
    handleRename,
    handleSave,
    handleCreate,
    handleImport,
    handleTextAreaBlur,
    handleDelete,
  } = editor;
  const {
    searchOpen,
    searchQuery,
    searchInputRef,
    highlightedHtml,
    highlightedEditorHtml,
    setSearchQuery,
    setSearchOpen,
    setActiveSearchQuery,
    setActiveSearchIndex,
    handleFind,
  } = view;

  return (
    <Page>
      <div className="memo-page">
        <MemoSidebar
          files={files}
          selected={selected}
          loading={loading || importing}
          onCreate={() => setCreateModalOpen(true)}
          onImport={() => void handleImport()}
          onRefresh={() => void loadFiles()}
          onSelect={(filename) => void handleSelectFile(filename)}
          onRename={handleRename}
          onDelete={(filename) => void handleDelete(filename)}
          onOpenInExplorer={(filename) => void openInExplorer(filename)}
        />

        <div className="memo-editor">
          {selected ? (
            <>
              <MemoHeader
                selected={selected}
                isEditing={isEditing}
                searchOpen={searchOpen}
                searchQuery={searchQuery}
                saving={saving}
                searchInputRef={searchInputRef}
                onModeChange={setIsEditing}
                onSearchQueryChange={setSearchQuery}
                onFind={handleFind}
                onToggleSearch={() => {
                  setSearchOpen((open) => !open);
                  setActiveSearchQuery("");
                  setActiveSearchIndex(0);
                }}
                onSave={() => void handleSave()}
              />

              <Card
                title={
                  <MemoCardTitle selected={selected} isEditing={isEditing} />
                }
                className="memo-editor-card"
              >
                {isEditing ? (
                  <MemoEditor
                    content={content}
                    highlightedHtml={highlightedEditorHtml}
                    onChange={setContent}
                    onBlur={handleTextAreaBlur}
                  />
                ) : (
                  <MemoPreview html={highlightedHtml} />
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
          onChange={(e) => setNewFileName(e.target.value)}
          onPressEnter={() => void handleCreate()}
          autoFocus
        />
      </Modal>
    </Page>
  );
}

export default MemoPage;
