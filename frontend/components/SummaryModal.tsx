'use client'

import { useState, useEffect } from 'react'
import { getBoardSummary } from '../api'
import type { BoardSummary } from '../types'
import styles from './SummaryModal.module.css'

interface SummaryModalProps {
  boardId: string
  hasSummary: boolean
  onClose: () => void
}

export default function SummaryModal({ boardId, hasSummary, onClose }: SummaryModalProps) {
  const [summary, setSummary] = useState<BoardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const data = await getBoardSummary(boardId)
        if (!cancelled) {
          setSummary(data)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    if (hasSummary) {
      load()
    } else {
      setLoading(false)
    }

    return () => { cancelled = true }
  }, [boardId, hasSummary])

  const handleCopy = async () => {
    if (!summary) return

    const text = [
      '📝 Резюме ретроспективы',
      '',
      summary.summary_text,
      '',
      '🎯 Ключевые темы:',
      ...summary.key_themes.map((t) => `• ${t}`),
      '',
      '💡 Рекомендации:',
      ...summary.recommendations.map((r) => `• ${r}`),
    ].join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback - ignore errors
    }
  }

  const handleExportPDF = () => {
    // Открываем доску в режиме PDF экспорта
    window.open(`/board/${boardId}?export=pdf`, '_blank')
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <div className={`${styles.iconWrap} ${hasSummary ? styles.hasSummary : ''}`}>
            <span className={`material-symbols-rounded ${styles.icon}`}>
              {hasSummary ? 'summarize' : 'summarize'}
            </span>
          </div>
          <div className={styles.title}>
            {hasSummary ? 'Резюме ретроспективы' : 'Резюме недоступно'}
          </div>
        </div>

        <div className={styles.content}>
          {loading ? (
            <div className={styles.empty}>
              <span className="material-symbols-rounded" style={{ fontSize: 32, marginBottom: 12 }}>
                hourglass_empty
              </span>
              <div className={styles.emptyText}>Загрузка...</div>
            </div>
          ) : !hasSummary || !summary ? (
            <div className={styles.empty}>
              <span className={`material-symbols-rounded ${styles.emptyIcon}`}>summarize</span>
              <div className={styles.emptyText}>Резюме ещё не создано</div>
              <div className={styles.emptyHint}>
                Резюме будет доступно после завершения фазы подведения итогов
              </div>
            </div>
          ) : (
            <>
              <div className={styles.summaryText}>{summary.summary_text}</div>

              {summary.key_themes.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16 }}>label</span>
                    Ключевые темы
                  </div>
                  <div className={styles.list}>
                    {summary.key_themes.map((theme, idx) => (
                      <div key={idx} className={styles.listItem}>
                        <div className={styles.bullet} />
                        {theme}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {summary.recommendations.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>
                    <span className="material-symbols-rounded" style={{ fontSize: 16 }}>lightbulb</span>
                    Рекомендации
                  </div>
                  <div className={styles.list}>
                    {summary.recommendations.map((rec, idx) => (
                      <div key={idx} className={`${styles.listItem} ${styles.recommendationItem}`}>
                        <div className={styles.bullet} />
                        {rec}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--md-on-surface-variant)', marginTop: 12 }}>
                Создано: {formatDate(summary.created_at)}
              </div>
            </>
          )}
        </div>

        <div className={styles.actions}>
          <button className={styles.textBtn} onClick={onClose}>
            Закрыть
          </button>

          {hasSummary && summary && (
            <>
              <button className={`${styles.filledBtn} ${styles.secondaryBtn}`} onClick={handleCopy}>
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                  {copied ? 'check' : 'content_copy'}
                </span>
                {copied ? 'Скопировано' : 'Копировать'}
              </button>

              <button className={styles.filledBtn} onClick={handleExportPDF}>
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>picture_as_pdf</span>
                PDF
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
