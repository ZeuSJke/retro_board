import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import CardWidget from "./CardWidget";
import Dialog from "./Dialog";
import { updateColumn, deleteColumn, createCard } from "../api";
import { useAppStore } from "../store";
import { CARD_COLORS } from "../utils/theme";

export default function Column({
  column,
  onUpdate,
  onDelete,
  onCardCreated,
  onCardUpdated,
  onCardDeleted,
}) {
  const { username } = useAppStore();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cardText, setCardText] = useState("");
  const [cardColor, setCardColor] = useState("#FFFFFF");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(column.title);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  const { setNodeRef, isOver } = useDroppable({
    id: `col-${column.id}`,
    data: { type: "column", columnId: column.id },
  });

  const saveTitle = async () => {
    setEditingTitle(false);
    if (titleVal.trim() && titleVal !== column.title) {
      const updated = await updateColumn(column.id, { title: titleVal.trim() });
      onUpdate(updated);
    }
  };

  const saveColor = async (color) => {
    setColorPickerOpen(false);
    const updated = await updateColumn(column.id, { color });
    onUpdate(updated);
  };

  const confirmDelete = async () => {
    setDeleteOpen(false);
    await deleteColumn(column.id);
    onDelete(column.id);
  };

  const handleAddCard = async () => {
    if (!cardText.trim()) return;
    const card = await createCard({
      column_id: column.id,
      text: cardText.trim(),
      author: username,
      color: cardColor,
    });
    onCardCreated(column.id, card);
    setCardText("");
    setCardColor("#FFFFFF");
    setAddOpen(false);
  };

  const cardIds = column.cards.map((c) => c.id);

  return (
    <>
      <div
        className="column"
        style={{
          ...styles.column,
          background: isOver
            ? "color-mix(in srgb, var(--md-primary) 8%, var(--md-surface-variant))"
            : "var(--md-surface-variant)",
        }}
      >
        {/* Header */}
        <div style={styles.header}>
          <div
            style={{ ...styles.dot, background: column.color }}
            onClick={() => setColorPickerOpen(true)}
            title="Изменить цвет"
          />
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
                setTitleVal(column.title);
                setEditingTitle(true);
              }}
              title="Двойной клик чтобы редактировать"
            >
              {column.title}
            </span>
          )}
          <span style={styles.count}>{column.cards.length}</span>
          <button
            style={styles.iconBtn}
            onClick={() => setDeleteOpen(true)}
            title="Удалить колонку"
            className="col-del-btn"
          >
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
              close
            </span>
          </button>
        </div>

        {/* Cards */}
        <div ref={setNodeRef} style={styles.cards}>
          <SortableContext
            items={cardIds}
            strategy={verticalListSortingStrategy}
          >
            {column.cards.map((card) => (
              <CardWidget
                key={card.id}
                card={card}
                onUpdate={(updated) => onCardUpdated(column.id, updated)}
                onDelete={(id) => onCardDeleted(column.id, id)}
              />
            ))}
          </SortableContext>
          {column.cards.length === 0 && (
            <div style={styles.emptyDrop}>Перетащи карточку сюда</div>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button style={styles.addBtn} onClick={() => setAddOpen(true)}>
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
              add
            </span>
            Добавить заметку
          </button>
        </div>
      </div>

      {/* Color picker popover */}
      {colorPickerOpen && (
        <div
          style={styles.colorOverlay}
          onClick={() => setColorPickerOpen(false)}
        >
          <div style={styles.colorPopover} onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                marginBottom: 10,
                color: "var(--md-on-surface)",
              }}
            >
              Цвет колонки
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginBottom: 10,
              }}
            >
              {[
                "#6750A4",
                "#0061A4",
                "#006E1C",
                "#BA1A1A",
                "#E8760A",
                "#006A60",
                "#7D5260",
                "#FF6D00",
                "#43A047",
              ].map((c) => (
                <div
                  key={c}
                  style={{ ...styles.swatchSmall, background: c }}
                  onClick={() => saveColor(c)}
                />
              ))}
            </div>
            <input
              type="color"
              value={column.color}
              onChange={(e) => saveColor(e.target.value)}
              style={{ cursor: "pointer" }}
            />
          </div>
        </div>
      )}

      {/* Add card dialog */}
      <Dialog
        open={addOpen}
        title="Новая заметка"
        icon="edit_note"
        onClose={() => {
          setAddOpen(false);
          setCardText("");
          setCardColor("#FFFFFF");
        }}
        onConfirm={handleAddCard}
        confirmLabel="Добавить"
      >
        <textarea
          style={styles.textarea}
          value={cardText}
          onChange={(e) => setCardText(e.target.value)}
          placeholder="Что думаете?"
          rows={4}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && handleAddCard()}
        />
        <div style={{ marginTop: 16 }}>
          <div style={styles.sectionLabel}>Цвет заметки</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CARD_COLORS.map((c) => (
              <div
                key={c}
                onClick={() => setCardColor(c)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  cursor: "pointer",
                  background: c,
                  border:
                    c === cardColor
                      ? "3px solid var(--md-primary)"
                      : "2px solid var(--md-outline-variant)",
                  transform: c === cardColor ? "scale(1.18)" : "scale(1)",
                  transition: "all 0.15s",
                  boxShadow:
                    c === cardColor
                      ? "0 0 0 2px var(--md-primary-container)"
                      : "none",
                }}
              />
            ))}
          </div>
        </div>
      </Dialog>

      {/* Delete column confirmation dialog */}
      <Dialog
        open={deleteOpen}
        title="Удалить колонку?"
        icon="delete"
        danger
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        confirmLabel="Удалить"
      >
        <p style={styles.confirmText}>
          Колонка{" "}
          <strong style={{ color: "var(--md-on-surface)" }}>
            «{column.title}»
          </strong>{" "}
          и все её заметки ({column.cards.length}) будут удалены без возможности
          восстановления.
        </p>
      </Dialog>
    </>
  );
}

const styles = {
  column: {
    flex: "1 1 260px",
    minWidth: 240,
    maxWidth: 420,
    borderRadius: 16,
    display: "flex",
    flexDirection: "column",
    maxHeight: "calc(100vh - 120px)",
    transition: "background 0.15s",
  },
  header: {
    padding: 14,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    flexShrink: 0,
    cursor: "pointer",
    border: "2px solid rgba(0,0,0,0.1)",
    transition: "transform 0.15s",
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: 700,
    color: "var(--md-on-surface)",
    cursor: "default",
    userSelect: "none",
  },
  titleInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: 700,
    border: "none",
    background: "transparent",
    outline: "2px solid var(--md-primary)",
    borderRadius: 6,
    padding: "2px 4px",
    fontFamily: "'Roboto', sans-serif",
    color: "var(--md-on-surface)",
  },
  count: {
    fontSize: 12,
    fontWeight: 600,
    background: "var(--md-surface)",
    color: "var(--md-on-surface-variant)",
    padding: "2px 8px",
    borderRadius: 20,
    minWidth: 24,
    textAlign: "center",
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    border: "none",
    background: "transparent",
    color: "var(--md-on-surface-variant)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.15s",
  },
  cards: {
    flex: 1,
    overflowY: "auto",
    padding: "0 12px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minHeight: 60,
  },
  emptyDrop: {
    textAlign: "center",
    fontSize: 13,
    color: "var(--md-on-surface-variant)",
    padding: "20px 0",
    opacity: 0.6,
  },
  footer: { padding: "0 12px 12px" },
  addBtn: {
    width: "100%",
    height: 40,
    borderRadius: 20,
    border: "2px dashed var(--md-outline-variant)",
    background: "transparent",
    color: "var(--md-on-surface-variant)",
    fontFamily: "'Roboto', sans-serif",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    transition: "var(--transition)",
  },
  textarea: {
    width: "100%",
    border: "1px solid var(--md-outline-variant)",
    borderRadius: 12,
    padding: 14,
    fontFamily: "'Roboto', sans-serif",
    fontSize: 14,
    color: "var(--md-on-surface)",
    background: "var(--md-surface-variant)",
    outline: "none",
    resize: "vertical",
    transition: "border-color 0.15s",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "var(--md-on-surface-variant)",
    marginBottom: 10,
  },
  confirmText: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--md-on-surface-variant)",
  },
  colorOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.3)",
  },
  colorPopover: {
    background: "var(--md-surface)",
    borderRadius: 16,
    padding: 16,
    boxShadow: "var(--elevation-3)",
  },
  swatchSmall: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    cursor: "pointer",
    border: "2px solid transparent",
    transition: "transform 0.1s",
  },
};
