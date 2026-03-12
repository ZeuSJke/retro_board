import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppStore } from "../store";
import { toggleLike, deleteCard, removeCardFromGroup, updateCard } from "../api";
import { userColor, initials } from "../utils/theme";
import Dialog from "./Dialog";

export default function CardWidget({
  card,
  onUpdate,
  onDelete,
  // Group support
  groups = [],
  onAssignGroup,
  groupId,
  isGroupTarget = false,
  dragOverlay = false,
}) {
  const { username } = useAppStore();
  const liked = (card.likes || []).includes(username);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(card.text);
  const inGroup = !!groupId;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: { type: "card", card },
    disabled: dragOverlay,
  });

  const style = {
    transform: dragOverlay ? undefined : CSS.Transform.toString(transform),
    transition: dragOverlay ? undefined : transition,
    opacity: isDragging && !dragOverlay ? 0.4 : 1,
  };

  const handleLike = async (e) => {
    e.stopPropagation();
    const updated = await toggleLike(card.id, username);
    onUpdate(updated);
  };

  const handleRemoveFromGroup = async (e) => {
    e.stopPropagation();
    const updated = await removeCardFromGroup(groupId, card.id);
    onUpdate(updated);
  };

  const handleEditSave = async () => {
    setEditing(false);
    const trimmed = editText.trim();
    if (!trimmed || trimmed === card.text) { setEditText(card.text); return; }
    const updated = await updateCard(card.id, { text: trimmed });
    onUpdate(updated);
  };

  const handleEditKeyDown = (e) => {
    if (e.key === "Enter" && e.ctrlKey) handleEditSave();
    if (e.key === "Escape") { setEditing(false); setEditText(card.text); }
  };

  const confirmDelete = async () => {
    setDeleteOpen(false);
    await deleteCard(card.id);
    onDelete(card.id);
  };

  const isLight = (hex) => {
    if (!hex || hex === "#FFFFFF") return true;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 180;
  };

  const cardBg = card.color || "#FFFFFF";
  const textColor = isLight(cardBg) ? "#1C1B1F" : "#FFFFFF";
  const subtleColor = isLight(cardBg) ? "#49454F" : "rgba(255,255,255,0.7)";
  const btnBg = isLight(cardBg) ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.15)";
  const showGroupBtn = !inGroup && !!onAssignGroup;

  // Show drop-zone placeholder while dragging
  if (isDragging && !dragOverlay) {
    return (
      <div
        ref={setNodeRef}
        style={{
          ...style,
          minHeight: 72,
          borderRadius: 12,
          border: "2px dashed var(--md-primary)",
          background: "color-mix(in srgb, var(--md-primary) 10%, transparent)",
        }}
      />
    );
  }

  return (
    <>
      <div
        ref={setNodeRef}
        style={{
          ...styles.card,
          ...style,
          background: cardBg,
          color: textColor,
          borderLeftColor:
            card.color && card.color !== "#FFFFFF" ? card.color : "transparent",
          cursor: inGroup ? "default" : undefined,
          ...(isGroupTarget
            ? { boxShadow: "0 0 0 3px var(--md-primary), var(--elevation-1)", outline: "none" }
            : {}),
        }}
        className="card-widget"
      >
        {/* Drag handle area (disabled for grouped cards) */}
        <div
          {...(dragOverlay ? {} : { ...attributes, ...listeners })}
          style={{
            cursor: dragOverlay ? "grabbing" : isDragging ? "grabbing" : "grab",
            marginBottom: 8,
            touchAction: dragOverlay ? "auto" : "none",
          }}
        >
          <div style={{ ...styles.author, color: subtleColor }}>
            <div
              style={{ ...styles.avatar, background: userColor(card.author) }}
            >
              {initials(card.author)}
            </div>
            {card.author}
          </div>
          {editing ? (
            <textarea
              style={{ ...styles.editTextarea, color: textColor, background: cardBg }}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={handleEditSave}
              onKeyDown={handleEditKeyDown}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div
              style={{ ...styles.text, color: textColor, cursor: "text" }}
              onDoubleClick={(e) => { e.stopPropagation(); setEditText(card.text); setEditing(true); }}
              title="Двойной клик чтобы редактировать"
            >
              {card.text}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={styles.actions}>
          <button
            style={{
              ...styles.likeBtn,
              background: btnBg,
              color: textColor,
              ...(liked
                ? {
                    background: "var(--md-primary-container)",
                    color: "var(--md-on-primary-container)",
                  }
                : {}),
            }}
            onClick={handleLike}
            title={liked ? "Убрать лайк" : "Лайк"}
          >
            <span
              className={`material-symbols-rounded${liked ? " filled" : ""}`}
              style={{ fontSize: 14 }}
            >
              thumb_up
            </span>
            <span style={styles.likeCount}>{(card.likes || []).length}</span>
          </button>

          {/* Add to group button */}
          {showGroupBtn && (
            <button
              style={{ ...styles.iconBtn, background: btnBg, color: textColor }}
              onClick={() => onAssignGroup(card.id)}
              title="Добавить в группу"
            >
              <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                folder
              </span>
            </button>
          )}

          {/* Remove from group button */}
          {inGroup && (
            <button
              style={{ ...styles.iconBtn, background: btnBg, color: textColor }}
              onClick={handleRemoveFromGroup}
              title="Убрать из группы"
            >
              <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                folder_off
              </span>
            </button>
          )}

          <button
            style={{ ...styles.iconBtn, background: btnBg, color: textColor }}
            onClick={() => setDeleteOpen(true)}
            title="Удалить заметку"
          >
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
              delete
            </span>
          </button>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteOpen}
        title="Удалить заметку?"
        icon="delete"
        danger
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        confirmLabel="Удалить"
      >
        <p style={styles.confirmText}>
          Заметка от{" "}
          <strong style={{ color: "var(--md-on-surface)" }}>
            «{card.author}»
          </strong>{" "}
          будет удалена без возможности восстановления.
        </p>
        {card.text && (
          <div style={styles.cardPreview}>
            <span style={styles.cardPreviewText}>{card.text}</span>
          </div>
        )}
      </Dialog>
    </>
  );
}

const styles = {
  card: {
    borderRadius: 12,
    padding: "14px 14px 10px",
    boxShadow: "var(--elevation-1)",
    borderLeft: "4px solid transparent",
    position: "relative",
    transition: "box-shadow 0.15s",
  },
  author: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 9,
    fontWeight: 700,
    color: "white",
    flexShrink: 0,
  },
  text: {
    fontSize: 14,
    lineHeight: 1.55,
    wordBreak: "break-word",
  },
  editTextarea: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 14,
    lineHeight: 1.55,
    fontFamily: "'Roboto', sans-serif",
    border: "none",
    outline: "2px solid var(--md-primary)",
    borderRadius: 6,
    padding: "2px 4px",
    resize: "vertical",
    minHeight: 56,
  },
  actions: {
    display: "flex",
    gap: 4,
    marginTop: 10,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  likeBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    border: "none",
    borderRadius: 20,
    padding: "4px 10px",
    cursor: "pointer",
    fontFamily: "'Roboto', sans-serif",
    transition: "background 0.15s, color 0.15s",
    minWidth: 40,
  },
  likeCount: {
    minWidth: 8,
    display: "inline-block",
    textAlign: "center",
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.15s",
    flexShrink: 0,
  },
  confirmText: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--md-on-surface-variant)",
    marginBottom: 12,
  },
  cardPreview: {
    borderRadius: 10,
    padding: "10px 14px",
    background: "var(--md-surface-variant)",
    borderLeft: "3px solid var(--md-outline-variant)",
  },
  cardPreviewText: {
    fontSize: 13,
    color: "var(--md-on-surface)",
    lineHeight: 1.5,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
};
