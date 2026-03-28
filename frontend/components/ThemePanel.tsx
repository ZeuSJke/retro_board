'use client'

import { useAppStore } from '../store'
import { applyTheme, PRIMARY_COLORS } from '../utils/theme'
import type { Theme } from '../types'
import styles from './ThemePanel.module.css'

interface ThemePanelProps {
  open: boolean
}

export default function ThemePanel({ open }: ThemePanelProps) {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  const update = (patch: Partial<Theme>) => {
    const next = { ...theme, ...patch }
    setTheme(next)
    applyTheme(next)
  }

  return (
    <aside className={styles.panel} style={{ right: open ? 0 : -340 }}>
      <div>
        <div className={styles.sectionTitle}>Основной цвет</div>
        <div className={styles.swatches}>
          {PRIMARY_COLORS.map((c) => (
            <div
              key={c}
              className={styles.swatch}
              style={{
                background: c,
                border:
                  c === theme.primary
                    ? '3px solid var(--md-on-surface)'
                    : '2px solid transparent',
                transform: c === theme.primary ? 'scale(1.15)' : 'scale(1)',
              }}
              onClick={() => update({ primary: c })}
            />
          ))}
          <div className={styles.customSwatch} title="Свой цвет">
            <span
              className="material-symbols-rounded"
              style={{ fontSize: 16, pointerEvents: 'none' }}
            >
              colorize
            </span>
            <input
              type="color"
              value={theme.primary}
              onChange={(e) => update({ primary: e.target.value })}
              className={styles.colorInput}
            />
          </div>
        </div>
      </div>

      <div>
        <div className={styles.sectionTitle}>Тёмная тема</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={theme.dark}
            onChange={(e) => update({ dark: e.target.checked })}
            style={{ width: 20, height: 20, accentColor: 'var(--md-primary)', cursor: 'pointer' }}
          />
          <span style={{ fontSize: 14, color: 'var(--md-on-surface-variant)' }}>
            Тёмный режим
          </span>
        </label>
      </div>
    </aside>
  )
}
