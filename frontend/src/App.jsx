import { useState, useEffect, useRef, useCallback } from "react";
import Topbar from "./components/Topbar";
import BoardsPanel from "./components/BoardsPanel";
import ThemePanel from "./components/ThemePanel";
import BoardPage from "./pages/BoardPage";
import WelcomeDialog from "./components/WelcomeDialog";
import { useAppStore } from "./store";
import { applyTheme } from "./utils/theme";
import { getBoards, getBoard, updateBoard, createBoard } from "./api";

export default function App() {
  const { theme, currentBoardId, setCurrentBoard, setUsername, username } = useAppStore();
  const [boards, setBoards] = useState([]);
  const [currentBoard, setCurrentBoardData] = useState(null);
  const [boardsPanelOpen, setBoardsPanelOpen] = useState(false);
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showWelcome, setShowWelcome] = useState(username === "Аноним");

  // Export ref — BoardPage sets this to the current export function
  const exportRef = useRef(null);

  // Timer state — managed here so it persists across board navigation
  const [timer, setTimer] = useState({ duration: 300, remaining: 300, running: false });
  const timerIntervalRef = useRef(null);
  // sendTimerRef — BoardPage sets this to { start, pause, reset } WS senders
  const sendTimerRef = useRef(null);
  // Guard: don't overwrite localStorage with default state before the board is loaded
  const timerRestoredRef = useRef(false);

  // Persist timer to localStorage on every change (fires on each countdown tick too, which is fine)
  useEffect(() => {
    if (!currentBoardId || !timerRestoredRef.current) return;
    localStorage.setItem(`retro_timer_${currentBoardId}`, JSON.stringify({
      duration: timer.duration,
      remaining: timer.remaining,
      running: timer.running,
      savedAt: Date.now(),
    }));
  }, [timer.duration, timer.remaining, timer.running, currentBoardId]);

  const handleWelcomeConfirm = (name) => {
    setUsername(name);
    setShowWelcome(false);
  };

  // Apply theme on mount & changes
  useEffect(() => { applyTheme(theme); }, [theme]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => clearInterval(timerIntervalRef.current);
  }, []);

  // Load boards
  useEffect(() => { loadBoards(); }, []);

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
      setError("Не удалось подключиться к серверу. Убедитесь, что бэкенд запущен.");
    } finally {
      setLoading(false);
    }
  };

  const loadBoard = async (id) => {
    const board = await getBoard(id);
    setCurrentBoardData(board);
    setCurrentBoard(id);

    // Restore timer state from localStorage
    try {
      const saved = localStorage.getItem(`retro_timer_${id}`);
      if (saved) {
        const { duration, remaining, running, savedAt } = JSON.parse(saved);
        clearInterval(timerIntervalRef.current);
        if (running) {
          const elapsed = Math.floor((Date.now() - savedAt) / 1000);
          const adjusted = Math.max(0, remaining - elapsed);
          setTimer({ duration, remaining: adjusted, running: adjusted > 0 });
          if (adjusted > 0) startCountdown(adjusted);
        } else {
          setTimer({ duration, remaining, running: false });
        }
      }
    } catch {}
    timerRestoredRef.current = true;
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

  // ── Timer management ──────────────────────────────────────────────────────

  const startCountdown = useCallback((remaining) => {
    clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      setTimer((prev) => {
        const next = Math.max(0, prev.remaining - 1);
        if (next <= 0) {
          clearInterval(timerIntervalRef.current);
          return { ...prev, remaining: 0, running: false };
        }
        return { ...prev, remaining: next };
      });
    }, 1000);
  }, []);

  // Called by BoardPage when a timer WS event arrives from server
  const handleTimerWsEvent = useCallback(
    (event, data) => {
      if (event === "timer_start") {
        const networkDelay = (Date.now() - (data.ts || Date.now())) / 1000;
        const adjusted = Math.max(0, Math.round(data.remaining - networkDelay));
        setTimer({ duration: data.duration, remaining: adjusted, running: true });
        startCountdown(adjusted);
      } else if (event === "timer_pause") {
        clearInterval(timerIntervalRef.current);
        setTimer((prev) => ({ ...prev, remaining: data.remaining, running: false }));
      } else if (event === "timer_reset") {
        clearInterval(timerIntervalRef.current);
        setTimer({ duration: data.duration, remaining: data.duration, running: false });
      }
    },
    [startCountdown],
  );

  // Called from TimerWidget via Topbar
  const handleTimerStart = useCallback(
    (duration, remaining) => {
      sendTimerRef.current?.start(duration, remaining);
    },
    [],
  );

  const handleTimerPause = useCallback(() => {
    sendTimerRef.current?.pause(timer.remaining);
  }, [timer.remaining]);

  const handleTimerReset = useCallback((duration) => {
    sendTimerRef.current?.reset(duration);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

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
        <p style={{ color: "var(--md-error)", fontWeight: 600, marginBottom: 8 }}>
          {error}
        </p>
        <button style={styles.retryBtn} onClick={loadBoards}>
          Повторить
        </button>
      </div>
    );

  if (showWelcome) {
    return <WelcomeDialog onConfirm={handleWelcomeConfirm} />;
  }

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
        onExport={() => exportRef.current?.()}
        timerState={currentBoard ? timer : null}
        onTimerStart={handleTimerStart}
        onTimerPause={handleTimerPause}
        onTimerReset={handleTimerReset}
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
            exportRef={exportRef}
            onTimerWsEvent={handleTimerWsEvent}
            sendTimerRef={sendTimerRef}
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
