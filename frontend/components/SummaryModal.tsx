'use client'

import { useState, useEffect } from 'react'
import { getBoardSummary } from '../api'
import type { BoardSummary } from '../types'
import styles from './SummaryModal.module.css'

interface SummaryModalProps {
  boardId: string
  hasSummary: boolean
  isGeneratingSummary?: boolean
  onClose: () => void
}

export default function SummaryModal({ boardId, hasSummary, isGeneratingSummary, onClose }: SummaryModalProps) {
  const [summary, setSummary] = useState<BoardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const loadSummary = async () => {
    setLoading(true)
    try {
      const data = await getBoardSummary(boardId)
      setSummary(data)
    } catch {
      // Ignore errors
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (hasSummary) {
      loadSummary()
    } else {
      setLoading(false)
      setSummary(null)
    }
  }, [boardId, hasSummary])

  useEffect(() => {
    if (isGeneratingSummary && !hasSummary) {
      const interval = setInterval(() => {
        loadSummary()
      }, 2000)
      return () => clearInterval(interval)
    }
  }, [isGeneratingSummary, hasSummary])

  const handleExportPDF = () => {
    window.open(`/board/${boardId}?export=pdf`, '_blank')
  }

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

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const isLoading = loading || isGeneratingSummary

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.currentTarget.setAttribute('data-clicking-overlay', 'true')
        } else {
          e.currentTarget.removeAttribute('data-clicking-overlay')
        }
      }}
      onMouseUp={(e) => {
        if (
          e.target === e.currentTarget &&
          e.currentTarget.getAttribute('data-clicking-overlay') === 'true'
        ) {
          onClose()
        }
        e.currentTarget.removeAttribute('data-clicking-overlay')
      }}
    >
      <div className={styles.dialog} onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={`${styles.iconWrap} ${hasSummary ? styles.hasSummary : ''}`}>
            <span className={`material-symbols-rounded ${styles.icon}`}>
              summarize
            </span>
          </div>
          <div className={styles.titleWrap}>
            <div className={styles.title}>Резюме ретроспективы</div>
            {summary && (
              <div className={styles.subtitle}>AI-сгенерированные итоги</div>
            )}
          </div>
        </div>

        <div className={styles.content}>
          {isLoading ? (
            <div className={styles.loadingState}>
              <div className={styles.spinner} />
              <div className={styles.loadingText}>
                {isGeneratingSummary ? 'Генерация итогов...' : 'Загрузка...'}
              </div>
              <div className={styles.loadingHint}>
                {isGeneratingSummary 
                  ? 'Искусственный интеллект анализирует данные' 
                  : 'Подождите, пожалуйста'}
              </div>
            </div>
          ) : !hasSummary || !summary ? (
            <div className={styles.emptyState}>
              <span className={`material-symbols-rounded ${styles.emptyIcon}`}>summarize</span>
              <div className={styles.emptyText}>Резюме ещё не создано</div>
              <div className={styles.emptyHint}>
                Резюме автоматически сгенерируется после перехода в фазу подведения итогов
              </div>
            </div>
          ) : (
            <>
              <div className={styles.mainText}>{summary.summary_text}</div>

              {summary.key_themes.length > 0 && (
                <div className={styles.sections}>
                  <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                      <div className={`${styles.sectionIcon} ${styles.themes}`}>
                        <span className="material-symbols-rounded">label</span>
                      </div>
                      <div className={styles.sectionTitle}>Ключевые темы</div>
                    </div>
                    <div className={styles.list}>
                      {summary.key_themes.map((theme, idx) => (
                        <div key={idx} className={styles.listItem}>
                          <div className={`${styles.bullet} ${styles.themes}`} />
                          {theme}
                        </div>
                      ))}
                    </div>
                  </div>

                  {summary.recommendations.length > 0 && (
                    <div className={styles.section}>
                      <div className={styles.sectionHeader}>
                        <div className={`${styles.sectionIcon} ${styles.recommendations}`}>
                          <span className="material-symbols-rounded">lightbulb</span>
                        </div>
                        <div className={styles.sectionTitle}>Рекомендации</div>
                      </div>
                      <div className={styles.list}>
                        {summary.recommendations.map((rec, idx) => (
                          <div key={idx} className={styles.listItem}>
                            <div className={`${styles.bullet} ${styles.recommendations}`} />
                            {rec}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.footer}>
          {summary && (
            <div className={styles.timestamp}>
              <span className={`material-symbols-rounded ${styles.timestampIcon}`}>schedule</span>
              {formatDate(summary.created_at)}
            </div>
          )}

          <div className={styles.actions}>
            <button className={styles.textBtn} onClick={onClose}>
              Закрыть
            </button>

            {hasSummary && summary && (
              <button className={`${styles.filledBtn} ${styles.secondaryBtn}`} onClick={handleCopy}>
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                  {copied ? 'check' : 'content_copy'}
                </span>
                {copied ? 'Скопировано' : 'Копировать'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
