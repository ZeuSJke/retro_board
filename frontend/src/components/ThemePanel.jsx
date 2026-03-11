import { useAppStore } from '../store'
import { applyTheme, PRIMARY_COLORS } from '../utils/theme'

export default function ThemePanel({ open }) {
  const { theme, setTheme } = useAppStore()

  const update = (patch) => {
    const next = { ...theme, ...patch }
    setTheme(next)
    applyTheme(next)
  }

  return (
    <aside style={{ ...styles.panel, right: open ? 0 : -340 }}>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Основной цвет</div>
        <div style={styles.swatches}>
          {PRIMARY_COLORS.map(c => (
            <div
              key={c}
              style={{
                ...styles.swatch,
                background: c,
                border: c === theme.primary ? '3px solid var(--md-on-surface)' : '2px solid transparent',
                transform: c === theme.primary ? 'scale(1.15)' : 'scale(1)',
              }}
              onClick={() => update({ primary: c })}
            />
          ))}
          <div style={styles.customSwatch} title="Свой цвет">
            <span className="material-symbols-rounded" style={{ fontSize: 16, pointerEvents: 'none' }}>colorize</span>
            <input
              type="color"
              value={theme.primary}
              onChange={e => update({ primary: e.target.value })}
              style={styles.colorInput}
            />
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Тёмная тема</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={theme.dark}
            onChange={e => update({ dark: e.target.checked })}
            style={{ width: 20, height: 20, accentColor: 'var(--md-primary)', cursor: 'pointer' }}
          />
          <span style={{ fontSize: 14, color: 'var(--md-on-surface-variant)' }}>Тёмный режим</span>
        </label>
      </div>
    </aside>
  )
}

const styles = {
  panel: {
    position: 'fixed',
    top: 64, bottom: 0,
    width: 300,
    background: 'var(--md-surface-1)',
    zIndex: 90,
    transition: 'right 0.2s cubic-bezier(0.2,0,0,1)',
    boxShadow: 'var(--elevation-3)',
    overflowY: 'auto',
    padding: 20,
    display: 'flex', flexDirection: 'column', gap: 24,
  },
  section: {},
  sectionTitle: {
    fontSize: 12, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: 0.8,
    color: 'var(--md-on-surface)',
    marginBottom: 12,
  },
  swatches: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  swatch: {
    width: 36, height: 36,
    borderRadius: '50%',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  customSwatch: {
    width: 36, height: 36,
    borderRadius: '50%',
    border: '2px solid var(--md-outline)',
    background: 'var(--md-surface-variant)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', overflow: 'hidden', cursor: 'pointer',
  },
  colorInput: {
    position: 'absolute', inset: 0,
    width: '150%', height: '150%',
    opacity: 0, cursor: 'pointer',
    border: 'none', padding: 0,
  },
}
