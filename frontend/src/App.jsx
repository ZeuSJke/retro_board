import { useState, useEffect } from "react";
import Topbar from "./components/Topbar";
import BoardsPanel from "./components/BoardsPanel";
import ThemePanel from "./components/ThemePanel";
import BoardPage from "./pages/BoardPage";
import { useAppStore } from "./store";
import { applyTheme } from "./utils/theme";
import { getBoards, getBoard, updateBoard, createBoard } from "./api";

export default function App() {
  const { theme, currentBoardId, setCurrentBoard } = useAppStore();
  const [boards, setBoards] = useState([]);
  const [currentBoard, setCurrentBoardData] = useState(null);
  const [boardsPanelOpen, setBoardsPanelOpen] = useState(false);
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Apply theme on mount & changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Load boards
  useEffect(() => {
    loadBoards();
  }, []);

  const loadBoards = async () => {
    try {
      setLoading(true);
      setError(null);
      let list = await getBoards();
      if (list.length === 0) {
        const board = await createBoard("Моя первая ретро-доска");
        list = [board];
      }
      setBoards(list);

      const targetId =
        currentBoardId && list.find((b) => b.id === currentBoardId)
          ? currentBoardId
          : list[0].id;

      await loadBoard(targetId);
    } catch (e) {
      setError(
        "Не удалось подключиться к серверу. Убедитесь, что бэкенд запущен.",
      );
    } finally {
      setLoading(false);
    }
  };

  const loadBoard = async (id) => {
    const board = await getBoard(id);
    setCurrentBoardData(board);
    setCurrentBoard(id);
  };

  const handleSelectBoard = async (id) => {
    setBoardsPanelOpen(false);
    await loadBoard(id);
  };

  const handleBoardCreated = async (board) => {
    setBoards((prev) => [board, ...prev]);
    setBoardsPanelOpen(false);
    await loadBoard(board.id);
  };

  const handleBoardDeleted = (id) => {
    const remaining = boards.filter((b) => b.id !== id);
    setBoards(remaining);
    if (currentBoard?.id === id && remaining.length > 0) {
      loadBoard(remaining[0].id);
    }
  };

  const handleRename = async (name) => {
    if (!name?.trim() || !currentBoard) return;
    await updateBoard(currentBoard.id, { name: name.trim() });
    const updated = { ...currentBoard, name: name.trim() };
    setCurrentBoardData(updated);
    setBoards((prev) =>
      prev.map((b) => (b.id === updated.id ? { ...b, name: updated.name } : b)),
    );
  };

  const closePanels = () => {
    setBoardsPanelOpen(false);
    setThemePanelOpen(false);
  };

  if (loading)
    return (
      <div style={styles.centered}>
        <div style={styles.spinner} />
        <p style={{ color: "var(--md-on-surface-variant)", fontSize: 14 }}>
          Загрузка...
        </p>
      </div>
    );

  if (error)
    return (
      <div style={styles.centered}>
        <span
          className="material-symbols-rounded"
          style={{ fontSize: 48, color: "var(--md-error)", marginBottom: 16 }}
        >
          error
        </span>
        <p
          style={{ color: "var(--md-error)", fontWeight: 600, marginBottom: 8 }}
        >
          {error}
        </p>
        <button style={styles.retryBtn} onClick={loadBoards}>
          Повторить
        </button>
      </div>
    );

  return (
    <>
      <Topbar
        boardName={currentBoard?.name || ""}
        onBoardsToggle={() => {
          setThemePanelOpen(false);
          setBoardsPanelOpen((v) => !v);
        }}
        onThemeToggle={() => {
          setBoardsPanelOpen(false);
          setThemePanelOpen((v) => !v);
        }}
        onRename={handleRename}
      />

      {/* Overlay */}
      {(boardsPanelOpen || themePanelOpen) && (
        <div style={styles.overlay} onClick={closePanels} />
      )}

      <BoardsPanel
        open={boardsPanelOpen}
        boards={boards}
        currentId={currentBoard?.id}
        onSelect={handleSelectBoard}
        onCreated={handleBoardCreated}
        onDeleted={handleBoardDeleted}
      />

      <ThemePanel open={themePanelOpen} />

      <main style={styles.main}>
        {currentBoard && (
          <BoardPage
            key={currentBoard.id}
            board={currentBoard}
            onBoardUpdate={setCurrentBoardData}
          />
        )}
      </main>
    </>
  );
}

const styles = {
  main: { marginTop: 64, overflowX: "auto" },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    zIndex: 85,
  },
  centered: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    gap: 12,
  },
  spinner: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    border: "3px solid var(--md-outline-variant)",
    borderTopColor: "var(--md-primary)",
    animation: "spin 0.8s linear infinite",
  },
  retryBtn: {
    height: 40,
    padding: "0 20px",
    borderRadius: 20,
    border: "none",
    background: "var(--md-primary)",
    color: "var(--md-on-primary)",
    fontFamily: "'Roboto', sans-serif",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
};
