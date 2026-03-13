import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import CardWidget from "./CardWidget";
import Dialog from "./Dialog";
import { updateGroup, deleteGroup } from "../api";

export default function CardGroupWidget({
  group,
  cards,
  collapsed,
  onToggleCollapse,
  onGroupUpdated,
  onGroupDeleted,
  onCardUpdated,
  onCardDeleted,
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(group.title);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `group-${group.id}`,
    data: { type: "group", group },
  });

  const saveTitle = async () => {
    setEditingTitle(false);
    if (titleVal.trim() && titleVal !== group.title) {
      const updated = await updateGroup(group.id, { title: titleVal.trim() });
      onGroupUpdated(updated);
    }
  };

  const confirmDelete = async () => {
    setDeleteOpen(false);
    await deleteGroup(group.id);
    onGroupDeleted(group.id);
  };

  return (
    <>
      <div style={{ ...styles.container, opacity: isDragging ? 0.4 : 1 }}>
        {/* Group header */}
        <div style={styles.header}>
          {/* Drag handle */}
          <button
            ref={setDragRef}
            {...attributes}
            {...listeners}
            style={styles.dragHandle}
            title="Перетащить группу в другую колонку"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
              drag_indicator
            </span>
          </button>

          <button
            style={styles.collapseBtn}
            onClick={() => onToggleCollapse?.()}
            title={collapsed ? "Развернуть" : "Свернуть"}
          >
            <span
              className="material-symbols-rounded"
              style={{
                fontSize: 16,
                transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
                display: "block",
              }}
            >
              expand_more
            </span>
          </button>

          <span
            className="material-symbols-rounded"
            style={{ fontSize: 14, color: "var(--md-primary)", flexShrink: 0 }}
          >
            folder
          </span>

          {editingTitle ? (
            <input
              style={styles.titleInput}
              value={titleVal}
              onChange={(e) => setTitleVal(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === "Enter" && saveTitle()}
              autoFocus
            />
          ) : (
            <span
              style={styles.title}
              onDoubleClick={() => {
                setTitleVal(group.title);
                setEditingTitle(true);
              }}
              title="Двойной клик — переименовать"
            >
              {group.title}
            </span>
          )}

          <span style={styles.count}>{cards.length}</span>

          <button
            style={styles.delBtn}
            onClick={() => setDeleteOpen(true)}
            title="Удалить группу"
          >
            <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
              close
            </span>
          </button>
        </div>

        {/* Cards */}
        {!collapsed && (
          <div style={styles.cards}>
            {cards.length === 0 ? (
              <div style={styles.empty}>Нет карточек в группе</div>
            ) : (
              cards.map((card) => (
                <CardWidget
                  key={card.id}
                  card={card}
                  onUpdate={onCardUpdated}
                  onDelete={onCardDeleted}
                  groupId={group.id}
                  onRemoveFromGroup={onCardUpdated}
                />
              ))
            )}
          </div>
        )}
      </div>

      <Dialog
        open={deleteOpen}
        title="Удалить группу?"
        icon="delete"
        danger
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        confirmLabel="Удалить"
      >
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--md-on-surface-variant)" }}>
          Группа <strong style={{ color: "var(--md-on-surface)" }}>«{group.title}»</strong> будет удалена,
          карточки ({cards.length}) останутся в колонке без группы.
        </p>
      </Dialog>
    </>
  );
}

const styles = {
  container: {
    border: "1.5px solid var(--md-outline-variant)",
    borderRadius: 12,
    overflow: "hidden",
    background: "color-mix(in srgb, var(--md-primary) 4%, var(--md-surface-variant))",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 10px",
    borderBottom: "1px solid var(--md-outline-variant)",
    background: "color-mix(in srgb, var(--md-primary) 8%, var(--md-surface-variant))",
  },
  dragHandle: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    border: "none",
    background: "transparent",
    color: "var(--md-on-surface-variant)",
    cursor: "grab",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    padding: 0,
    touchAction: "none",
  },
  collapseBtn: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    border: "none",
    background: "transparent",
    color: "var(--md-on-surface-variant)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    padding: 0,
  },
  title: {
    flex: 1,
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "var(--md-primary)",
    cursor: "default",
    userSelect: "none",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  titleInput: {
    flex: 1,
    fontSize: 12,
    fontWeight: 700,
    border: "none",
    background: "transparent",
    outline: "2px solid var(--md-primary)",
    borderRadius: 4,
    padding: "1px 4px",
    fontFamily: "'Roboto', sans-serif",
    color: "var(--md-primary)",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  count: {
    fontSize: 11,
    fontWeight: 600,
    background: "var(--md-primary-container)",
    color: "var(--md-on-primary-container)",
    padding: "1px 6px",
    borderRadius: 10,
    flexShrink: 0,
  },
  delBtn: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    border: "none",
    background: "transparent",
    color: "var(--md-on-surface-variant)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    padding: 0,
  },
  cards: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "8px",
  },
  empty: {
    textAlign: "center",
    fontSize: 12,
    color: "var(--md-on-surface-variant)",
    padding: "8px 0",
    opacity: 0.6,
  },
};
