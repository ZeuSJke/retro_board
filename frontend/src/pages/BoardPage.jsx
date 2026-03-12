import { useState, useCallback, useRef, useEffect } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCorners,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import Column from "../components/Column";
import CardWidget from "../components/CardWidget";
import Dialog from "../components/Dialog";
import { createColumn, moveCard } from "../api";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAppStore } from "../store";
import { userColor, initials } from "../utils/theme";

const COLUMN_COLORS = [
  "#6750A4",
  "#0061A4",
  "#006E1C",
  "#BA1A1A",
  "#E8760A",
  "#006A60",
  "#7D5260",
  "#FF6D00",
  "#43A047",
  "#1B6CA8",
];

// ── Cursor marker ─────────────────────────────────────────────────────────────

function CursorMarker({ username, x, y }) {
  const color = userColor(username);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        pointerEvents: "none",
        zIndex: 500,
        transition: "left 0.08s linear, top 0.08s linear",
        userSelect: "none",
      }}
    >
      {/* Arrow SVG */}
      <svg
        width="20"
        height="24"
        viewBox="0 0 20 24"
        fill="none"
        style={{
          display: "block",
          filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))",
        }}
      >
        <path
          d="M2 2L2 18L6.5 13L11 22L13.5 20.8L9 12L15 12L2 2Z"
          fill={color}
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      {/* Name badge */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 14,
          background: color,
          color: "white",
          borderRadius: 10,
          padding: "2px 8px",
          fontSize: 11,
          fontWeight: 700,
          fontFamily: "'Roboto', sans-serif",
          whiteSpace: "nowrap",
          boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
          letterSpacing: 0.2,
        }}
      >
        {username}
      </div>
    </div>
  );
}

// ── BoardPage ─────────────────────────────────────────────────────────────────

export default function BoardPage({ board, onBoardUpdate }) {
  const { username } = useAppStore();
  const [columns, setColumns] = useState(board.columns || []);
  const [activeCard, setActiveCard] = useState(null);

  const [addColOpen, setAddColOpen] = useState(false);
  const [newColTitle, setNewColTitle] = useState("");
  const [newColColor, setNewColColor] = useState("#6750A4");

  // Cursors: { username → { x, y } }
  const [cursors, setCursors] = useState({});
  const cursorTimeouts = useRef({});
  const boardRef = useRef(null);
  const lastSentRef = useRef(0);

  // Keep columns in sync when board prop changes
  useState(() => {
    setColumns(board.columns || []);
  });

  // Cleanup cursor timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(cursorTimeouts.current).forEach(clearTimeout);
    };
  }, []);

  // Send cursor_leave when switching boards or unmounting
  const { sendMessage } = useWebSocket(
    board.id,
    useCallback((msg) => {
      const { event, data } = msg;

      // ── Cursor events ──────────────────────────────────────────────────
      if (event === "cursor_move") {
        const { username: u, x, y } = data;
        if (!u) return;
        setCursors((prev) => ({ ...prev, [u]: { x, y } }));

        // Auto-remove cursor after 6s of inactivity
        clearTimeout(cursorTimeouts.current[u]);
        cursorTimeouts.current[u] = setTimeout(() => {
          setCursors((prev) => {
            const next = { ...prev };
            delete next[u];
            return next;
          });
        }, 6000);
        return;
      }

      if (event === "cursor_leave") {
        const { username: u } = data;
        if (!u) return;
        clearTimeout(cursorTimeouts.current[u]);
        setCursors((prev) => {
          const next = { ...prev };
          delete next[u];
          return next;
        });
        return;
      }

      // ── Board events ───────────────────────────────────────────────────
      setColumns((prev) => {
        switch (event) {
          case "column_created":
            if (prev.find((c) => c.id === data.id)) return prev;
            return [...prev, { ...data, cards: [] }];
          case "column_updated":
            return prev.map((c) => (c.id === data.id ? { ...c, ...data } : c));
          case "column_deleted":
            return prev.filter((c) => c.id !== data.id);
          case "card_created":
            return prev.map((c) =>
              c.id === data.column_id
                ? {
                    ...c,
                    cards: [
                      ...c.cards.filter((x) => x.id !== data.id),
                      data,
                    ].sort((a, b) => a.position - b.position),
                  }
                : c,
            );
          case "card_updated":
            return prev.map((c) => ({
              ...c,
              cards: c.cards.map((x) => (x.id === data.id ? data : x)),
            }));
          case "card_moved": {
            const { card, old_column_id } = data;
            return prev.map((c) => {
              if (c.id === old_column_id)
                return {
                  ...c,
                  cards: c.cards.filter((x) => x.id !== card.id),
                };
              if (c.id === card.column_id) {
                const cards = [
                  ...c.cards.filter((x) => x.id !== card.id),
                  card,
                ].sort((a, b) => a.position - b.position);
                return { ...c, cards };
              }
              return c;
            });
          }
          case "card_deleted":
            return prev.map((c) => ({
              ...c,
              cards: c.cards.filter((x) => x.id !== data.id),
            }));
          default:
            return prev;
        }
      });
    }, []),
  );

  // ── Cursor tracking ──────────────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e) => {
      const now = Date.now();
      if (now - lastSentRef.current < 50) return; // throttle ~20fps
      lastSentRef.current = now;

      const board = boardRef.current;
      if (!board) return;

      const rect = board.getBoundingClientRect();
      const x = e.clientX - rect.left + board.scrollLeft;
      const y = e.clientY - rect.top + board.scrollTop;

      sendMessage({ event: "cursor_move", data: { username, x, y } });
    },
    [username, sendMessage],
  );

  const handleMouseLeave = useCallback(() => {
    sendMessage({ event: "cursor_leave", data: { username } });
  }, [username, sendMessage]);

  // ── DnD ─────────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
  );

  const findCard = (id) => {
    for (const col of columns) {
      const card = col.cards.find((c) => c.id === id);
      if (card) return { card, colId: col.id };
    }
    return null;
  };

  const onDragStart = ({ active }) => {
    const found = findCard(active.id);
    if (found) setActiveCard(found.card);
  };

  const onDragOver = ({ active, over }) => {
    if (!over) return;
    const activeFound = findCard(active.id);
    if (!activeFound) return;

    const overId = over.id;
    const overColId = overId.startsWith("col-")
      ? overId.slice(4)
      : findCard(overId)?.colId;
    if (!overColId || overColId === activeFound.colId) return;

    setColumns((prev) => {
      const srcCol = prev.find((c) => c.id === activeFound.colId);
      const dstCol = prev.find((c) => c.id === overColId);
      if (!srcCol || !dstCol) return prev;
      const card = srcCol.cards.find((c) => c.id === active.id);
      const newSrc = {
        ...srcCol,
        cards: srcCol.cards.filter((c) => c.id !== active.id),
      };
      const overCardIdx = dstCol.cards.findIndex((c) => c.id === overId);
      const newCards = [...dstCol.cards];
      newCards.splice(overCardIdx >= 0 ? overCardIdx : newCards.length, 0, {
        ...card,
        column_id: overColId,
      });
      return prev.map((c) => {
        if (c.id === activeFound.colId) return newSrc;
        if (c.id === overColId) return { ...dstCol, cards: newCards };
        return c;
      });
    });
  };

  const onDragEnd = async ({ active, over }) => {
    setActiveCard(null);
    if (!over) return;

    const activeFound = findCard(active.id);
    if (!activeFound) return;

    const overId = over.id;
    const overColId = overId.startsWith("col-")
      ? overId.slice(4)
      : findCard(overId)?.colId;
    if (!overColId) return;

    const dstCol = columns.find((c) => c.id === overColId);
    if (!dstCol) return;

    const overIdx = dstCol.cards.findIndex((c) => c.id === overId);
    const newPos = overIdx >= 0 ? overIdx : dstCol.cards.length;

    try {
      await moveCard(active.id, { column_id: overColId, position: newPos });
    } catch (e) {
      console.error("Move failed", e);
    }
  };

  // ── Add column ───────────────────────────────────────────────────────────

  const openAddCol = () => {
    setNewColTitle("");
    setNewColColor("#6750A4");
    setAddColOpen(true);
  };

  const confirmAddColumn = async () => {
    if (!newColTitle.trim()) return;
    setAddColOpen(false);
    const col = await createColumn({
      board_id: board.id,
      title: newColTitle.trim(),
      color: newColColor,
    });
    setColumns((prev) =>
      prev.find((c) => c.id === col.id)
        ? prev
        : [...prev, { ...col, cards: [] }],
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div
        ref={boardRef}
        style={styles.board}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {columns.map((col) => (
          <Column
            key={col.id}
            column={col}
            onUpdate={(updated) =>
              setColumns((prev) =>
                prev.map((c) =>
                  c.id === updated.id ? { ...c, ...updated } : c,
                ),
              )
            }
            onDelete={(id) =>
              setColumns((prev) => prev.filter((c) => c.id !== id))
            }
            onCardCreated={(colId, card) =>
              setColumns((prev) =>
                prev.map((c) =>
                  c.id === colId && !c.cards.find((x) => x.id === card.id)
                    ? { ...c, cards: [...c.cards, card] }
                    : c,
                ),
              )
            }
            onCardUpdated={(colId, card) =>
              setColumns((prev) =>
                prev.map((c) =>
                  c.id === colId
                    ? {
                        ...c,
                        cards: c.cards.map((x) =>
                          x.id === card.id ? card : x,
                        ),
                      }
                    : c,
                ),
              )
            }
            onCardDeleted={(colId, cardId) =>
              setColumns((prev) =>
                prev.map((c) =>
                  c.id === colId
                    ? { ...c, cards: c.cards.filter((x) => x.id !== cardId) }
                    : c,
                ),
              )
            }
          />
        ))}

        <button style={styles.addColBtn} onClick={openAddCol}>
          <span className="material-symbols-rounded">add</span>
          Новая колонка
        </button>

        {/* Other users' cursors */}
        {Object.entries(cursors).map(([u, pos]) => (
          <CursorMarker key={u} username={u} x={pos.x} y={pos.y} />
        ))}
      </div>

      {/* Add Column Dialog */}
      <Dialog
        open={addColOpen}
        title="Новая колонка"
        icon="view_column"
        onClose={() => setAddColOpen(false)}
        onConfirm={confirmAddColumn}
        confirmLabel="Создать"
      >
        <div style={styles.field}>
          <label style={styles.label}>Название</label>
          <input
            style={styles.input}
            value={newColTitle}
            onChange={(e) => setNewColTitle(e.target.value)}
            placeholder="Например: Что прошло хорошо?"
            maxLength={80}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && confirmAddColumn()}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Цвет метки</label>
          <div style={styles.colorGrid}>
            {COLUMN_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColColor(c)}
                style={{
                  ...styles.colorSwatch,
                  background: c,
                  outline:
                    c === newColColor
                      ? `3px solid ${c}`
                      : "3px solid transparent",
                  outlineOffset: 2,
                  transform: c === newColColor ? "scale(1.18)" : "scale(1)",
                }}
                title={c}
              />
            ))}
          </div>
        </div>

        {/* Preview */}
        <div style={{ ...styles.preview, borderLeftColor: newColColor }}>
          <div style={{ ...styles.previewDot, background: newColColor }} />
          <span style={styles.previewTitle}>
            {newColTitle.trim() || "Название колонки"}
          </span>
          <span style={styles.previewCount}>0</span>
        </div>
      </Dialog>

      <DragOverlay>
        {activeCard && (
          <div style={{ transform: "rotate(3deg)", opacity: 0.9 }}>
            <CardWidget
              card={activeCard}
              onUpdate={() => {}}
              onDelete={() => {}}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

const styles = {
  board: {
    position: "relative",
    display: "flex",
    gap: 16,
    alignItems: "flex-start",
    padding: "24px",
    minHeight: "calc(100vh - 120px)",
    paddingBottom: 40,
    width: "100%",
    minWidth: "fit-content",
    boxSizing: "border-box",
  },
  addColBtn: {
    minWidth: 180,
    height: 56,
    flexShrink: 0,
    padding: "0 20px",
    borderRadius: 16,
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
    gap: 8,
    alignSelf: "flex-start",
    transition: "var(--transition)",
  },
  field: {
    marginBottom: 18,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "var(--md-on-surface-variant)",
    marginBottom: 8,
  },
  input: {
    width: "100%",
    border: "1.5px solid var(--md-outline-variant)",
    borderRadius: 12,
    padding: "12px 14px",
    fontFamily: "'Roboto', sans-serif",
    fontSize: 14,
    color: "var(--md-on-surface)",
    background: "var(--md-surface-variant)",
    outline: "none",
    transition: "border-color 0.15s",
    boxSizing: "border-box",
  },
  colorGrid: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  colorSwatch: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    transition: "transform 0.15s, outline 0.15s",
    flexShrink: 0,
  },
  preview: {
    marginTop: 4,
    borderRadius: 10,
    padding: "10px 14px",
    background: "var(--md-surface-variant)",
    borderLeft: "4px solid #6750A4",
    display: "flex",
    alignItems: "center",
    gap: 8,
    transition: "border-color 0.2s",
  },
  previewDot: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    flexShrink: 0,
    transition: "background 0.2s",
  },
  previewTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--md-on-surface)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    opacity: 0.7,
  },
  previewCount: {
    fontSize: 12,
    fontWeight: 600,
    background: "var(--md-surface)",
    color: "var(--md-on-surface-variant)",
    padding: "1px 8px",
    borderRadius: 20,
  },
};
