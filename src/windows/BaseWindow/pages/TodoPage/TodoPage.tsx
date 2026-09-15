import { useCallback } from "react";
import Page from "@/shared/components/Page";
import TodoOutlineSidebar from "./components/TodoOutlineSidebar";
import TodoListItem from "./components/TodoListItem";
import NoteModal from "./components/NoteModal";
import TodoSection from "./components/TodoSection";
import TodoToolbar from "./components/TodoToolbar";
import WorkHourModal from "./components/WorkHourModal";
import { useTodoPage } from "./hooks/useTodoPage";
import { useTodoViewState } from "./hooks/useTodoViewState";
import type { TodoItem } from "./types";
import "./index.scss";

function TodoPage() {
  const data = useTodoPage();
  const view = useTodoViewState(
    data.items,
    data.todoItems,
    data.doneItems,
    data.getChildren,
  );
  const handleAdd = async (): Promise<void> => {
    const id = await data.handleAdd();
    if (id !== null) view.markAdded(id);
  };

  const handleSaveEdit = useCallback(
    (id: number, value: string) => {
      void data.saveContent(id, value);
    },
    [data],
  );

  const renderItem = useCallback(
    (item: TodoItem) => (
      <TodoListItem
        item={item}
        editingId={data.editingId}
        childInputFor={data.childInputFor}
        flashIds={view.flashIds}
        enterIds={view.enterIds}
        getChildren={data.getChildren}
        getRemainingWorkHour={data.getRemainingWorkHour}
        getWorkHourLabel={data.getWorkHourLabel}
        onSetEditingId={data.setEditingId}
        onToggleChildInput={(id) =>
          data.setChildInputFor(data.childInputFor === id ? null : id)
        }
        onCloseChildInput={() => data.setChildInputFor(null)}
        onOpenNote={(id, note) => {
          data.setNoteModalFor(id);
          data.setNoteDraft(note ?? "");
        }}
        onOpenWorkHour={(id, workHour) => {
          data.setWorkHourModalFor(id);
          data.setWorkHourDraft(workHour);
        }}
        onAddChild={data.handleAddChild}
        onDelete={data.handleDelete}
        onDeleteNote={data.handleDeleteNote}
        onDeleteWorkHour={data.handleDeleteWorkHour}
        onToggleImportant={data.handleToggleImportant}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={() => data.setEditingId(null)}
        onToggle={data.handleToggle}
        onToggleChild={data.handleToggleChild}
        onToggleParent={data.handleToggleParent}
      />
    ),
    [data, handleSaveEdit, view.enterIds, view.flashIds],
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
            newContent={data.newContent}
            filterText={view.filterText}
            onlyImportant={view.onlyImportant}
            outlineCollapsed={view.outlineCollapsed}
            onNewContentChange={data.setNewContent}
            onFilterTextChange={view.setFilterText}
            onOnlyImportantChange={view.setOnlyImportant}
            onAdd={() => void handleAdd()}
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
          open={data.noteModalFor !== null}
          value={data.noteDraft}
          onChange={data.setNoteDraft}
          onCancel={() => {
            data.setNoteModalFor(null);
            data.setNoteDraft("");
          }}
          onOk={() => void data.saveNote()}
        />
        <WorkHourModal
          open={data.workHourModalFor !== null}
          value={data.workHourDraft}
          onChange={data.setWorkHourDraft}
          onCancel={() => {
            data.setWorkHourModalFor(null);
            data.setWorkHourDraft(null);
          }}
          onSave={(value) => void data.saveWorkHour(value)}
        />
      </div>
    </Page>
  );
}

export default TodoPage;
