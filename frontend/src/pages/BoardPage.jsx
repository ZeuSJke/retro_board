import { useState, useCallback, useRef, useEffect } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  pointerWithin,
  closestCenter,
} from "@dnd-kit/core";
import Column from "../components/Column";
import CardWidget from "../components/CardWidget";
import Dialog from "../components/Dialog";
import { createColumn, moveCard, createGroup, addCardToGroup, removeCardFromGroup, moveGroup } from "../api";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAppStore } from "../store";
import { userColor } from "../utils/theme";
import { exportBoardToPDF } from "../utils/exportPDF";

const COLUMN_COLORS = [
  "#6750A4", "#0061A4", "#006E1C", "#BA1A1A", "#E8760A",
  "#006A60", "#7D5260", "#FF6D00", "#43A047", "#1B6CA8",
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
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none"
        style={{ display: "block", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))" }}
      >
        <path
          d="M2 2L2 18L6.5 13L11 22L13.5 20.8L9 12L15 12L2 2Z"
          fill={color} stroke="white" strokeWidth="1.5" strokeLinejoin="round"
        />
      </svg>
      <div style={{
        position: "absolute", top: 18, left: 14, background: color, color: "white",
        borderRadius: 10, padding: "2px 8px", fontSize: 11, fontWeight: 700,
        fontFamily: "'Roboto', sans-serif", whiteSpace: "nowrap",
        boxShadow: "0 2px 6px rgba(0,0,0,0.25)", letterSpacing: 0.2,
      }}>
        {username}
      </div>
    </div>
  );
}

// ── BoardPage ─────────────────────────────────────────────────────────────────

export default function BoardPage({ board, onBoardUpdate, exportRef, onTimerWsEvent, sendTimerRef }) {
  const { username } = useAppStore();
  const [columns, setColumns] = useState(board.columns || []);
  const [activeCard, setActiveCard] = useState(null);
  const [activeGroup, setActiveGroup] = useState(null);
  const [addColOpen, setAddColOpen] = useState(false);
  const [newColTitle, setNewColTitle] = useState("");
  const [newColColor, setNewColColor] = useState("#6750A4");

  // Cursors: { username → { x, y } }
  const [cursors, setCursors] = useState({});
  const cursorTimeouts = useRef({});
  const boardRef = useRef(null);
  const lastSentRef = useRef(0);
  const savedColumnsRef = useRef(null);
  const [groupTargetId, setGroupTargetId] = useState(null);

  // Keep columns in sync when board prop changes
  useState(() => { setColumns(board.columns || []); });

  // Expose export function via ref
  useEffect(() => {
    if (exportRef) {
      exportRef.current = () => exportBoardToPDF(board, columns);
    }
  }, [exportRef, board, columns]);

  // Expose WS timer send functions via ref
  useEffect(() => {
    if (sendTimerRef) {
      sendTimerRef.current = {
        start: (duration, remaining) =>
          sendMessage({ event: "timer_start", data: { duration, remaining, ts: Date.now() } }),
        pause: (remaining) =>
          sendMessage({ event: "timer_pause", data: { remaining } }),
        reset: (duration) =>
          sendMessage({ event: "timer_reset", data: { duration } }),
      };
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(cursorTimeouts.current).forEach(clearTimeout);
    };
  }, []);

  // ── WebSocket ─────────────────────────────────────────────────────────────

  const { sendMessage } = useWebSocket(
    board.id,
    useCallback((msg) => {
      const { event, data } = msg;

      if (event === "cursor_move") {
        const { username: u, x, y } = data;
        if (!u) return;
        setCursors((prev) => ({ ...prev, [u]: { x, y } }));
        clearTimeout(cursorTimeouts.current[u]);
        cursorTimeouts.current[u] = setTimeout(() => {
          setCursors((prev) => { const n = { ...prev }; delete n[u]; return n; });
        }, 6000);
        return;
      }

      if (event === "cursor_leave") {
        const { username: u } = data;
        if (!u) return;
        clearTimeout(cursorTimeouts.current[u]);
        setCursors((prev) => { const n = { ...prev }; delete n[u]; return n; });
        return;
      }

      // Timer events: forward to App for state management
      if (event === "timer_start" || event === "timer_pause" || event === "timer_reset") {
        onTimerWsEvent?.(event, data);
        return;
      }

      setColumns((prev) => {
        switch (event) {
          case "column_created":
            if (prev.find((c) => c.id === data.id)) return prev;
            return [...prev, { ...data, cards: [], groups: [] }];
          case "column_updated":
            return prev.map((c) => (c.id === data.id ? { ...c, ...data } : c));
          case "column_deleted":
            return prev.filter((c) => c.id !== data.id);
          case "card_created":
            return prev.map((c) =>
              c.id === data.column_id
                ? { ...c, cards: [...c.cards.filter((x) => x.id !== data.id), data].sort((a, b) => a.position - b.position) }
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
              if (c.id === old_column_id && c.id === card.column_id) {
                // Same-column reorder: remove and re-insert with updated position
                const cards = [...c.cards.filter((x) => x.id !== card.id), card].sort((a, b) => a.position - b.position);
                return { ...c, cards };
              }
              if (c.id === old_column_id) return { ...c, cards: c.cards.filter((x) => x.id !== card.id) };
              if (c.id === card.column_id) {
                const cards = [...c.cards.filter((x) => x.id !== card.id), card].sort((a, b) => a.position - b.position);
                return { ...c, cards };
              }
              return c;
            });
          }
          case "card_deleted":
            return prev.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== data.id) }));
          case "group_created":
            return prev.map((c) =>
              c.id === data.column_id
                ? { ...c, groups: [...(c.groups || []).filter((g) => g.id !== data.id), data] }
                : c,
            );
          case "group_updated":
            return prev.map((c) => ({
              ...c,
              groups: (c.groups || []).map((g) => (g.id === data.id ? data : g)),
            }));
          case "group_deleted": {
            const { id, column_id, card_ids } = data;
            return prev.map((c) =>
              c.id === column_id
                ? {
                    ...c,
                    groups: (c.groups || []).filter((g) => g.id !== id),
                    cards: c.cards.map((card) =>
                      (card_ids || []).includes(card.id) ? { ...card, group_id: null } : card,
                    ),
                  }
                : c,
            );
          }
          case "group_moved": {
            const { group, old_column_id, cards } = data;
            const movedCardIds = cards.map((c) => c.id);
            return prev.map((c) => {
              if (c.id === old_column_id) {
                return {
                  ...c,
                  groups: (c.groups || []).filter((g) => g.id !== group.id),
                  cards: c.cards.filter((card) => !movedCardIds.includes(card.id)),
                };
              }
              if (c.id === group.column_id) {
                return {
                  ...c,
                  groups: [...(c.groups || []).filter((g) => g.id !== group.id), group],
                  cards: [...c.cards.filter((card) => !movedCardIds.includes(card.id)), ...cards],
                };
              }
              return c;
            });
          }
          default:
            return prev;
        }
      });
    }, [onTimerWsEvent]),
  );

  // ── Cursor tracking ──────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e) => {
    const now = Date.now();
    if (now - lastSentRef.current < 50) return;
    lastSentRef.current = now;
    const b = boardRef.current;
    if (!b) return;
    const rect = b.getBoundingClientRect();
    sendMessage({ event: "cursor_move", data: { username, x: e.clientX - rect.left + b.scrollLeft, y: e.clientY - rect.top + b.scrollTop } });
  }, [username, sendMessage]);

  const handleMouseLeave = useCallback(() => {
    sendMessage({ event: "cursor_leave", data: { username } });
  }, [username, sendMessage]);

  // ── DnD ─────────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const collisionDetection = useCallback((args) => {
    // When dragging a group, prefer column droppables
    if (String(args.active?.id || "").startsWith("group-")) {
      const pointer = pointerWithin(args);
      const cols = pointer.filter((c) => String(c.id).startsWith("col-"));
      if (cols.length > 0) return cols;
      return closestCenter(args);
    }
    // When dragging a card, prefer cards over columns
    const pointer = pointerWithin(args);
    const cards = pointer.filter((c) => !String(c.id).startsWith("col-"));
    if (cards.length > 0) return cards;
    if (pointer.length > 0) return pointer;
    return closestCenter(args);
  }, []);

  const findCard = (id) => {
    for (const col of columns) {
      const card = col.cards.find((c) => c.id === id);
      if (card) return { card, colId: col.id };
    }
    return null;
  };

  const onDragStart = ({ active }) => {
    savedColumnsRef.current = columns;
    if (String(active.id).startsWith("group-")) {
      const groupId = String(active.id).slice(6);
      for (const col of columns) {
        const g = (col.groups || []).find((g) => g.id === groupId);
        if (g) { setActiveGroup(g); break; }
      }
      return;
    }
    const found = findCard(active.id);
    if (found) setActiveCard(found.card);
  };

  const onDragOver = ({ active, over }) => {
    if (!over) { setGroupTargetId(null); return; }
    // Group drags don't need optimistic moves; column isOver handles visual feedback
    if (String(active.id).startsWith("group-")) return;

    const activeFound = findCard(active.id);
    if (!activeFound) return;
    const overId = over.id;
    const isOverCol = String(overId).startsWith("col-");
    const overColId = isOverCol ? overId.slice(4) : findCard(overId)?.colId;

    // Hovering over a different ungrouped card → show group-target indicator
    // Works for same-column and cross-column drags
    if (!isOverCol && overId !== active.id && !activeFound.card.group_id && overColId) {
      setGroupTargetId(overId);
      // Cross-column: also do optimistic move so the card appears in the target column
      if (overColId !== activeFound.colId) {
        setColumns((prev) => {
          const srcCol = prev.find((c) => c.id === activeFound.colId);
          const dstCol = prev.find((c) => c.id === overColId);
          if (!srcCol || !dstCol) return prev;
          const card = srcCol.cards.find((c) => c.id === active.id);
          const newSrc = { ...srcCol, cards: srcCol.cards.filter((c) => c.id !== active.id) };
          const overCardIdx = dstCol.cards.findIndex((c) => c.id === overId);
          const newCards = [...dstCol.cards];
          newCards.splice(overCardIdx >= 0 ? overCardIdx : newCards.length, 0, { ...card, column_id: overColId, group_id: null });
          return prev.map((c) => {
            if (c.id === activeFound.colId) return newSrc;
            if (c.id === overColId) return { ...dstCol, cards: newCards };
            return c;
          });
        });
      }
      return;
    }
    setGroupTargetId(null);

    // Cross-column (hovering over column droppable background): optimistically move card
    if (!overColId || overColId === activeFound.colId) return;
    setColumns((prev) => {
      const srcCol = prev.find((c) => c.id === activeFound.colId);
      const dstCol = prev.find((c) => c.id === overColId);
      if (!srcCol || !dstCol) return prev;
      const card = srcCol.cards.find((c) => c.id === active.id);
      const newSrc = { ...srcCol, cards: srcCol.cards.filter((c) => c.id !== active.id) };
      const newCards = [...dstCol.cards, { ...card, column_id: overColId, group_id: null }];
      return prev.map((c) => {
        if (c.id === activeFound.colId) return newSrc;
        if (c.id === overColId) return { ...dstCol, cards: newCards };
        return c;
      });
    });
  };

  const onDragEnd = async ({ active, over }) => {
    setActiveCard(null);
    setActiveGroup(null);
    setGroupTargetId(null);

    if (!over) {
      if (savedColumnsRef.current) setColumns(savedColumnsRef.current);
      return;
    }

    // ── Group drag: move entire group to a different column ──────────────────
    if (String(active.id).startsWith("group-")) {
      const groupId = String(active.id).slice(6);
      const overId = over.id;
      const isOverCol = String(overId).startsWith("col-");
      const targetColId = isOverCol ? overId.slice(4) : findCard(overId)?.colId;
      if (!targetColId) return;

      // Find group in saved state
      let srcColId = null;
      let groupData = null;
      for (const col of (savedColumnsRef.current || [])) {
        const g = (col.groups || []).find((g) => g.id === groupId);
        if (g) { srcColId = col.id; groupData = g; break; }
      }
      if (!groupData || targetColId === srcColId) return;

      // Optimistic update
      const groupCards = (savedColumnsRef.current || [])
        .find((c) => c.id === srcColId)?.cards
        .filter((card) => card.group_id === groupId) || [];
      setColumns((prev) =>
        prev.map((c) => {
          if (c.id === srcColId) {
            return {
              ...c,
              groups: (c.groups || []).filter((g) => g.id !== groupId),
              cards: c.cards.filter((card) => card.group_id !== groupId),
            };
          }
          if (c.id === targetColId) {
            return {
              ...c,
              groups: [...(c.groups || []).filter((g) => g.id !== groupId), { ...groupData, column_id: targetColId }],
              cards: [...c.cards, ...groupCards.map((card) => ({ ...card, column_id: targetColId }))],
            };
          }
          return c;
        }),
      );

      try {
        await moveGroup(groupId, { column_id: targetColId });
      } catch (e) {
        console.error("Move group failed", e);
        if (savedColumnsRef.current) setColumns(savedColumnsRef.current);
      }
      return;
    }

    // ── Card drag ────────────────────────────────────────────────────────────
    const activeFound = findCard(active.id);
    if (!activeFound) return;
    const overId = over.id;
    const isOverCol = String(overId).startsWith("col-");
    const overColId = isOverCol ? overId.slice(4) : findCard(overId)?.colId;
    if (!overColId) return;

    // Dropped on a different ungrouped card → create group (same or different column)
    if (!isOverCol && overId !== active.id && !activeFound.card.group_id) {
      // Find original column (pre-drag) to detect cross-column move
      let origColId = null;
      for (const col of (savedColumnsRef.current || [])) {
        if (col.cards.find((c) => c.id === active.id)) { origColId = col.id; break; }
      }
      try {
        // Cross-column: move card to target column in DB first so group assignment works
        if (origColId && origColId !== overColId) {
          const dstCards = (savedColumnsRef.current || []).find((c) => c.id === overColId)?.cards || [];
          await moveCard(active.id, { column_id: overColId, position: dstCards.length });
        }
        const group = await createGroup({ column_id: overColId, title: "Группа" });
        setColumns((prev) =>
          prev.map((c) =>
            c.id === overColId
              ? { ...c, groups: [...(c.groups || []).filter((g) => g.id !== group.id), group] }
              : c,
          ),
        );
        const [updatedOver, updatedActive] = await Promise.all([
          addCardToGroup(group.id, overId),
          addCardToGroup(group.id, active.id),
        ]);
        setColumns((prev) =>
          prev.map((c) =>
            c.id === overColId
              ? {
                  ...c,
                  cards: c.cards.map((card) => {
                    if (card.id === overId) return updatedOver;
                    if (card.id === active.id) return updatedActive;
                    return card;
                  }),
                }
              : c,
          ),
        );
      } catch (e) {
        console.error("Group creation from drag failed", e);
        if (savedColumnsRef.current) setColumns(savedColumnsRef.current);
      }
      return;
    }

    // Normal card move
    const dstCol = columns.find((c) => c.id === overColId);
    if (!dstCol) return;
    const overIdx = dstCol.cards.findIndex((c) => c.id === overId);
    const newPos = overIdx >= 0 ? overIdx : dstCol.cards.length;
    try {
      // Grouped card dropped in same column → remove from group first
      if (activeFound.card.group_id && overColId === activeFound.colId) {
        await removeCardFromGroup(activeFound.card.group_id, active.id);
      }
      await moveCard(active.id, { column_id: overColId, position: newPos });
    } catch (e) {
      console.error("Move failed", e);
    }
  };

  // ── Add column ───────────────────────────────────────────────────────────

  const openAddCol = () => { setNewColTitle(""); setNewColColor("#6750A4"); setAddColOpen(true); };

  const confirmAddColumn = async () => {
    if (!newColTitle.trim()) return;
    setAddColOpen(false);
    const col = await createColumn({ board_id: board.id, title: newColTitle.trim(), color: newColColor });
    setColumns((prev) =>
      prev.find((c) => c.id === col.id) ? prev : [...prev, { ...col, cards: [], groups: [] }],
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection}
      onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
    >
      <div ref={boardRef} style={styles.board} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
        {columns.map((col) => (
          <Column
            key={col.id}
            column={col}
            groupTargetId={groupTargetId}
            onUpdate={(updated) =>
              setColumns((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)))
            }
            onDelete={(id) => setColumns((prev) => prev.filter((c) => c.id !== id))}
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
                    ? { ...c, cards: c.cards.map((x) => (x.id === card.id ? card : x)) }
                    : c,
                ),
              )
            }
            onCardDeleted={(colId, cardId) =>
              setColumns((prev) =>
                prev.map((c) =>
                  c.id === colId ? { ...c, cards: c.cards.filter((x) => x.id !== cardId) } : c,
                ),
              )
            }
            onGroupCreated={(colId, group) =>
              setColumns((prev) =>
                prev.map((c) =>
                  c.id === colId
                    ? { ...c, groups: [...(c.groups || []).filter((g) => g.id !== group.id), group] }
                    : c,
                ),
              )
            }
            onGroupUpdated={(colId, group) =>
              setColumns((prev) =>
                prev.map((c) =>
                  c.id === colId
                    ? { ...c, groups: (c.groups || []).map((g) => (g.id === group.id ? group : g)) }
                    : c,
                ),
              )
            }
            onGroupDeleted={(colId, groupId) =>
              setColumns((prev) =>
                prev.map((c) =>
                  c.id === colId
                    ? {
                        ...c,
                        groups: (c.groups || []).filter((g) => g.id !== groupId),
                        cards: c.cards.map((card) =>
                          card.group_id === groupId ? { ...card, group_id: null } : card,
                        ),
                      }
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

        {Object.entries(cursors).map(([u, pos]) => (
          <CursorMarker key={u} username={u} x={pos.x} y={pos.y} />
        ))}
      </div>

      {/* Add Column Dialog */}
      <Dialog open={addColOpen} title="Новая колонка" icon="view_column"
        onClose={() => setAddColOpen(false)} onConfirm={confirmAddColumn} confirmLabel="Создать"
      >
        <div style={styles.field}>
          <label style={styles.label}>Название</label>
          <input style={styles.input} value={newColTitle}
            onChange={(e) => setNewColTitle(e.target.value)}
            placeholder="Например: Что прошло хорошо?" maxLength={80} autoFocus
            onKeyDown={(e) => e.key === "Enter" && confirmAddColumn()}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Цвет метки</label>
          <div style={styles.colorGrid}>
            {COLUMN_COLORS.map((c) => (
              <button key={c} onClick={() => setNewColColor(c)}
                style={{
                  ...styles.colorSwatch, background: c,
                  outline: c === newColColor ? `3px solid ${c}` : "3px solid transparent",
                  outlineOffset: 2,
                  transform: c === newColColor ? "scale(1.18)" : "scale(1)",
                }}
              />
            ))}
          </div>
        </div>
        <div style={{ ...styles.preview, borderLeftColor: newColColor }}>
          <div style={{ ...styles.previewDot, background: newColColor }} />
          <span style={styles.previewTitle}>{newColTitle.trim() || "Название колонки"}</span>
          <span style={styles.previewCount}>0</span>
        </div>
      </Dialog>

      <DragOverlay>
        {activeCard && (
          <div style={{ transform: "rotate(3deg)", opacity: 0.9 }}>
            <CardWidget card={activeCard} onUpdate={() => {}} onDelete={() => {}} dragOverlay />
          </div>
        )}
        {activeGroup && (
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            borderRadius: 10,
            background: "color-mix(in srgb, var(--md-primary) 8%, var(--md-surface-variant))",
            border: "1.5px solid var(--md-outline-variant)",
            boxShadow: "var(--elevation-2)",
            opacity: 0.9,
            transform: "rotate(2deg)",
            cursor: "grabbing",
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: 14, color: "var(--md-primary)" }}>folder</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--md-primary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              {activeGroup.title}
            </span>
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
  field: { marginBottom: 18 },
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
  colorGrid: { display: "flex", gap: 8, flexWrap: "wrap" },
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
  previewDot: { width: 12, height: 12, borderRadius: "50%", flexShrink: 0, transition: "background 0.2s" },
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
