import { useState, useEffect, useRef } from "react";

const PRESETS = [
  { label: "5 мин", value: 300 },
  { label: "10 мин", value: 600 },
  { label: "15 мин", value: 900 },
  { label: "20 мин", value: 1200 },
];

function fmt(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function TimerWidget({ timerState, onStart, onPause, onReset }) {
  const { duration, remaining, running } = timerState;
  const [expanded, setExpanded] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState(duration);
  const finished = remaining <= 0 && !running && duration > 0;

  // Flash effect when timer finishes
  const [flash, setFlash] = useState(false);
  const prevRunning = useRef(running);
  useEffect(() => {
    if (prevRunning.current && !running && remaining <= 0) {
      setFlash(true);
      setTimeout(() => setFlash(false), 2000);
    }
    prevRunning.current = running;
  }, [running, remaining]);

  // Progress: 0→1
  const progress = duration > 0 ? remaining / duration : 1;
  const pct = Math.round(progress * 100);

  // Color: green → yellow → red
  const color =
    pct > 50
      ? `hsl(${120 * ((pct - 50) / 50)}, 70%, 42%)`
      : `hsl(${(pct / 50) * 60}, 80%, 42%)`;

  const handleStart = () => {
    const dur = running ? duration : selectedDuration;
    const rem = running ? remaining : selectedDuration;
    onStart(dur, rem);
  };

  const handleReset = () => {
    onReset(selectedDuration);
    setExpanded(true);
  };

  return (
    <div style={{ ...styles.wrapper, ...(flash ? styles.wrapperFlash : {}) }}>
      {/* Compact pill — always visible */}
      <button
        style={{
          ...styles.pill,
          background: running
            ? `color-mix(in srgb, ${color} 15%, var(--md-surface-variant))`
            : finished
              ? "color-mix(in srgb, #BA1A1A 12%, var(--md-surface-variant))"
              : "var(--md-surface-variant)",
          color: running ? color : "var(--md-on-surface-variant)",
          animation: flash ? "pillGlow 0.45s ease-in-out 4" : "none",
        }}
        onClick={() => setExpanded((v) => !v)}
        title="Таймер"
      >
        <span
          className="material-symbols-rounded"
          style={{
            fontSize: 16,
            animation: flash ? "iconRing 0.45s ease-in-out 4" : "none",
            display: "inline-block",
          }}
        >
          {running ? "timer" : finished ? "alarm_on" : "timer"}
        </span>
        <span style={styles.pillTime}>{fmt(remaining)}</span>
        {running && (
          <span
            style={{
              ...styles.dot,
              background: color,
              animation: "blink 1s step-start infinite",
            }}
          />
        )}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span className="material-symbols-rounded" style={{ fontSize: 18, color: "var(--md-primary)" }}>
              timer
            </span>
            <span style={styles.panelTitle}>Таймер</span>
            <button style={styles.closeBtn} onClick={() => setExpanded(false)}>
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>close</span>
            </button>
          </div>

          {/* Big countdown */}
          <div style={styles.countdown}>
            <svg width="120" height="120" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--md-outline-variant)" strokeWidth="6" />
              <circle
                cx="60" cy="60" r="52"
                fill="none"
                stroke={finished ? "#BA1A1A" : running ? color : "var(--md-outline-variant)"}
                strokeWidth="6"
                strokeDasharray={`${2 * Math.PI * 52}`}
                strokeDashoffset={`${2 * Math.PI * 52 * (1 - progress)}`}
                strokeLinecap="round"
                style={{ transition: "stroke-dashoffset 0.9s linear, stroke 0.5s" }}
              />
            </svg>
            <div style={styles.countdownText}>
              <span style={{ ...styles.countdownTime, color: finished ? "#BA1A1A" : running ? color : "var(--md-on-surface)" }}>
                {fmt(remaining)}
              </span>
              {finished && (
                <span style={styles.finishedLabel}>Время вышло!</span>
              )}
            </div>
          </div>

          {/* Duration presets — only when not running */}
          {!running && (
            <div style={styles.presets}>
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  style={{
                    ...styles.presetBtn,
                    background:
                      selectedDuration === p.value
                        ? "var(--md-primary-container)"
                        : "var(--md-surface-variant)",
                    color:
                      selectedDuration === p.value
                        ? "var(--md-on-primary-container)"
                        : "var(--md-on-surface-variant)",
                    fontWeight: selectedDuration === p.value ? 700 : 500,
                  }}
                  onClick={() => {
                    setSelectedDuration(p.value);
                    onReset(p.value);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Controls */}
          <div style={styles.controls}>
            <button
              style={{
                ...styles.primaryBtn,
                background: running ? "var(--md-secondary-container)" : "var(--md-primary)",
                color: running ? "var(--md-on-secondary-container)" : "var(--md-on-primary)",
              }}
              onClick={running ? onPause : handleStart}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                {running ? "pause" : "play_arrow"}
              </span>
              {running ? "Пауза" : "Старт"}
            </button>
            <button style={styles.secondaryBtn} onClick={handleReset}>
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>restart_alt</span>
              Сброс
            </button>
          </div>

          {running && (
            <div style={styles.syncNote}>
              <span className="material-symbols-rounded" style={{ fontSize: 12 }}>sync</span>
              Синхронизован для всех
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes blink { 50% { opacity: 0; } }
        @keyframes iconRing {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.5); color: #BA1A1A; }
        }
        @keyframes pillGlow {
          0%, 100% { box-shadow: none; }
          50% { box-shadow: 0 0 0 3px rgba(186, 26, 26, 0.35); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  wrapper: {
    position: "relative",
    transition: "background 0.3s",
  },
  wrapperFlash: {},
  pill: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 20,
    border: "none",
    fontFamily: "'Roboto', sans-serif",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "background 0.3s, color 0.3s",
    userSelect: "none",
  },
  pillTime: {
    fontFamily: "'Roboto Mono', 'Roboto', monospace",
    fontSize: 13,
    letterSpacing: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
  },
  panel: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    width: 240,
    background: "var(--md-surface)",
    borderRadius: 20,
    padding: "16px",
    boxShadow: "var(--elevation-3)",
    zIndex: 300,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    border: "1px solid var(--md-outline-variant)",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  panelTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: 700,
    color: "var(--md-on-surface)",
  },
  closeBtn: {
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
  },
  countdown: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  countdownText: {
    position: "absolute",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
  },
  countdownTime: {
    fontFamily: "'Roboto Mono', 'Roboto', monospace",
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 1,
    transition: "color 0.5s",
  },
  finishedLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#BA1A1A",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  presets: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  },
  presetBtn: {
    flex: "1 0 auto",
    padding: "5px 10px",
    borderRadius: 20,
    border: "none",
    fontFamily: "'Roboto', sans-serif",
    fontSize: 12,
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
  },
  controls: {
    display: "flex",
    gap: 8,
  },
  primaryBtn: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    border: "none",
    fontFamily: "'Roboto', sans-serif",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    transition: "background 0.15s",
  },
  secondaryBtn: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    border: "none",
    background: "var(--md-surface-variant)",
    color: "var(--md-on-surface-variant)",
    fontFamily: "'Roboto', sans-serif",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    transition: "background 0.15s",
  },
  syncNote: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    fontSize: 11,
    color: "var(--md-on-surface-variant)",
    opacity: 0.7,
  },
};
