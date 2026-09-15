import { useCallback } from "react";
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
  const handleAdd = async (content: string): Promise<boolean> => {
    const id = await data.handleAdd(content);
    if (id === null) return false;
    view.markAdded(id);
    return true;
  };

  const handleSaveEdit = useCallback(
    (id: number, value: string) => {
      void editor.saveContent(id, value);
    },
    [editor],
  );

  const renderItem = useCallback(
    (item: TodoItem) => (
      <TodoListItem
        item={item}
        editingId={editor.editingId}
        childInputFor={editor.childInputFor}
        flashIds={view.flashIds}
        enterIds={view.enterIds}
        getChildren={data.getChildren}
        getRemainingWorkHour={data.getRemainingWorkHour}
        getWorkHourLabel={data.getWorkHourLabel}
        onSetEditingId={editor.setEditingId}
        onToggleChildInput={(id) =>
          editor.setChildInputFor(editor.childInputFor === id ? null : id)
        }
        onCloseChildInput={() => editor.setChildInputFor(null)}
        onOpenNote={(id, note) => {
          editor.setNoteModalFor(id);
          editor.setNoteDraft(note ?? "");
        }}
        onOpenWorkHour={(id, workHour) => {
          editor.setWorkHourModalFor(id);
          editor.setWorkHourDraft(workHour);
        }}
        onAddChild={data.handleAddChild}
        onDelete={data.handleDelete}
        onDeleteNote={data.handleDeleteNote}
        onDeleteWorkHour={data.handleDeleteWorkHour}
        onToggleImportant={data.handleToggleImportant}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={() => editor.setEditingId(null)}
        onToggle={data.handleToggle}
        onToggleChild={data.handleToggleChild}
        onToggleParent={data.handleToggleParent}
      />
    ),
    [data, editor, handleSaveEdit, view.enterIds, view.flashIds],
  );

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
            onToggleOutline={() => view.setOutlineCollapsed((value) => !value)}
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
              onToggle={() => view.toggleSection("todo")}
            />
            <TodoSection
              kind="done"
              items={view.filteredDoneItems}
              collapsed={view.isDoneCollapsed}
              otherCollapsed={view.isTodoCollapsed}
              hasFilter={view.hasFilter}
              virtuosoRef={view.doneVirtuosoRef}
              renderItem={renderItem}
              onToggle={() => view.toggleSection("done")}
            />
          </div>
        </div>

        <NoteModal
          open={editor.noteModalFor !== null}
          value={editor.noteDraft}
          onChange={editor.setNoteDraft}
          onCancel={() => {
            editor.setNoteModalFor(null);
            editor.setNoteDraft("");
          }}
          onOk={() => void editor.saveNote()}
        />
        <WorkHourModal
          open={editor.workHourModalFor !== null}
          value={editor.workHourDraft}
          onChange={editor.setWorkHourDraft}
          onCancel={() => {
            editor.setWorkHourModalFor(null);
            editor.setWorkHourDraft(null);
          }}
          onSave={(value) => void editor.saveWorkHour(value)}
        />
      </div>
    </Page>
  );
}

export default TodoPage;
