import { useCallback, useRef } from "react";
import Page from "@/shared/components/Page";
import TodoOutlineSidebar from "./components/TodoOutlineSidebar";
import TodoListItem from "./components/TodoListItem";
import NoteModal from "./components/NoteModal";
import TodoSection from "./components/TodoSection";
import TodoToolbar from "./components/TodoToolbar";
import WorkHourModal from "./components/WorkHourModal";
import { useTodoData } from "./hooks/useTodoData";
import { useTodoEditorState } from "./hooks/useTodoEditorState";
import { useTodoViewState } from "./hooks/useTodoViewState";
import type { TodoItem } from "./types";
import "./index.scss";

function TodoPage() {
  const data = useTodoData();
  const editor = useTodoEditorState({
    handleUpdateContent: data.handleUpdateContent,
    handleUpdateNote: data.handleUpdateNote,
    handleUpdateWorkHour: data.handleUpdateWorkHour,
  });
  const view = useTodoViewState(
    data.items,
    data.todoItems,
    data.doneItems,
    data.getChildren,
  );

  // 把每次渲染都变化的 data/editor/view 放进 ref：
  // renderItem 因此可以保持稳定引用，让 Virtuoso 只在数据真正变化时重算可见行。
  const dataRef = useRef(data);
  const editorRef = useRef(editor);
  const viewRef = useRef(view);
  dataRef.current = data;
  editorRef.current = editor;
  viewRef.current = view;

  const handleAdd = useCallback(async (content: string): Promise<boolean> => {
    const id = await dataRef.current.handleAdd(content);
    if (id === null) return false;
    viewRef.current.markAdded(id);
    return true;
  }, []);

  const handleSaveEdit = useCallback((id: number, value: string) => {
    void editorRef.current.saveContent(id, value);
  }, []);

  const handleToggleChildInput = useCallback((id: number) => {
    const current = editorRef.current;
    current.setChildInputFor(current.childInputFor === id ? null : id);
  }, []);

  const handleCloseChildInput = useCallback(() => {
    editorRef.current.setChildInputFor(null);
  }, []);

  const handleOpenNote = useCallback((id: number, note: string | null) => {
    const current = editorRef.current;
    current.setNoteModalFor(id);
    current.setNoteDraft(note ?? "");
  }, []);

  const handleOpenWorkHour = useCallback(
    (id: number, workHour: number | null) => {
      const current = editorRef.current;
      current.setWorkHourModalFor(id);
      current.setWorkHourDraft(workHour);
    },
    [],
  );

  const handleSetEditingId = useCallback((id: number | null) => {
    editorRef.current.setEditingId(id);
  }, []);

  const handleCancelEdit = useCallback(() => {
    editorRef.current.setEditingId(null);
  }, []);

  const handleToggleOutline = useCallback(() => {
    viewRef.current.setOutlineCollapsed((value) => !value);
  }, []);

  const handleToggleTodoSection = useCallback(() => {
    viewRef.current.toggleSection("todo");
  }, []);

  const handleToggleDoneSection = useCallback(() => {
    viewRef.current.toggleSection("done");
  }, []);

  const handleCancelNote = useCallback(() => {
    const current = editorRef.current;
    current.setNoteModalFor(null);
    current.setNoteDraft("");
  }, []);

  const handleOkNote = useCallback(() => {
    void editorRef.current.saveNote();
  }, []);

  const handleCancelWorkHour = useCallback(() => {
    const current = editorRef.current;
    current.setWorkHourModalFor(null);
    current.setWorkHourDraft(null);
  }, []);

  const handleSaveWorkHour = useCallback((value: number | null) => {
    void editorRef.current.saveWorkHour(value);
  }, []);

  const renderItem = useCallback((item: TodoItem) => {
    const currentData = dataRef.current;
    const currentEditor = editorRef.current;
    const currentView = viewRef.current;
    return (
      <TodoListItem
        item={item}
        editingId={currentEditor.editingId}
        childInputFor={currentEditor.childInputFor}
        flashIds={currentView.flashIds}
        enterIds={currentView.enterIds}
        getChildren={currentData.getChildren}
        getRemainingWorkHour={currentData.getRemainingWorkHour}
        getWorkHourLabel={currentData.getWorkHourLabel}
        onSetEditingId={handleSetEditingId}
        onToggleChildInput={handleToggleChildInput}
        onCloseChildInput={handleCloseChildInput}
        onOpenNote={handleOpenNote}
        onOpenWorkHour={handleOpenWorkHour}
        onAddChild={currentData.handleAddChild}
        onDelete={currentData.handleDelete}
        onDeleteNote={currentData.handleDeleteNote}
        onDeleteWorkHour={currentData.handleDeleteWorkHour}
        onToggleImportant={currentData.handleToggleImportant}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={handleCancelEdit}
        onToggle={currentData.handleToggle}
        onToggleChild={currentData.handleToggleChild}
        onToggleParent={currentData.handleToggleParent}
      />
    );
  }, [
    handleCancelEdit,
    handleCloseChildInput,
    handleOpenNote,
    handleOpenWorkHour,
    handleSaveEdit,
    handleSetEditingId,
    handleToggleChildInput,
  ]);

  return (
    <Page>
      <div
        className={`todo-page ${view.outlineCollapsed ? "todo-page--outline-collapsed" : ""}`}
      >
        <div
          className={`todo-outline-wrap ${view.outlineCollapsed ? "todo-outline-wrap--collapsed" : ""}`}
        >
          <TodoOutlineSidebar
            items={view.todoOutlineItems}
            activeId={view.activeOutlineId}
            onSelect={view.handleScrollToItem}
          />
        </div>

        <div className="todo-main">
          <TodoToolbar
            filterText={view.filterText}
            onlyImportant={view.onlyImportant}
            outlineCollapsed={view.outlineCollapsed}
            onFilterTextChange={view.setFilterText}
            onOnlyImportantChange={view.setOnlyImportant}
            onAdd={handleAdd}
            onToggleOutline={handleToggleOutline}
          />

          <div className="todo-list-container">
            <TodoSection
              kind="todo"
              items={view.filteredTodoItems}
              collapsed={view.isTodoCollapsed}
              otherCollapsed={view.isDoneCollapsed}
              hasFilter={view.hasFilter}
              virtuosoRef={view.todoVirtuosoRef}
              renderItem={renderItem}
              onToggle={handleToggleTodoSection}
            />
            <TodoSection
              kind="done"
              items={view.filteredDoneItems}
              collapsed={view.isDoneCollapsed}
              otherCollapsed={view.isTodoCollapsed}
              hasFilter={view.hasFilter}
              virtuosoRef={view.doneVirtuosoRef}
              renderItem={renderItem}
              onToggle={handleToggleDoneSection}
            />
          </div>
        </div>

        <NoteModal
          open={editor.noteModalFor !== null}
          value={editor.noteDraft}
          onChange={editor.setNoteDraft}
          onCancel={handleCancelNote}
          onOk={handleOkNote}
        />
        <WorkHourModal
          open={editor.workHourModalFor !== null}
          value={editor.workHourDraft}
          onChange={editor.setWorkHourDraft}
          onCancel={handleCancelWorkHour}
          onSave={handleSaveWorkHour}
        />
      </div>
    </Page>
  );
}

export default TodoPage;
