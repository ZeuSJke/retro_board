import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppStore } from "../store";
import { toggleLike, deleteCard } from "../api";
import { userColor, initials } from "../utils/theme";
import Dialog from "./Dialog";

export default function CardWidget({ card, onUpdate, onDelete }) {
  const { username } = useAppStore();
  const liked = (card.likes || []).includes(username);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const handleLike = async (e) => {
    e.stopPropagation();
    const updated = await toggleLike(card.id, username);
    onUpdate(updated);
  };

  const confirmDelete = async () => {
    setDeleteOpen(false);
    await deleteCard(card.id);
    onDelete(card.id);
  };

  const isLight = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 180;
  };

  const cardBg = card.color || "#FFFFFF";
  const textColor = isLight(cardBg) ? "#1C1B1F" : "#FFFFFF";
  const subtleColor = isLight(cardBg) ? "#49454F" : "rgba(255,255,255,0.7)";
  const btnBg = isLight(cardBg) ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.15)";

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
        }}
        className="card-widget"
      >
        {/* Drag handle area */}
        <div
          {...attributes}
          {...listeners}
          style={{
            cursor: isDragging ? "grabbing" : "grab",
            marginBottom: 8,
            touchAction: "none",
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
          <div style={{ ...styles.text, color: textColor }}>{card.text}</div>
        </div>

        {/* Actions — always visible */}
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
