'use client'

import { useState } from 'react'
import Dialog from './Dialog'
import { createJiraIssue } from '../api'
import { showToast } from '../store/toastStore'
import { getApiErrorMessage } from '../utils/apiError'
import type { ActionItem } from '../types'

interface JiraDialogProps {
  item: ActionItem
  onClose: () => void
  onCreated: (item: ActionItem) => void
}

export default function JiraDialog({ item, onClose, onCreated }: JiraDialogProps) {
  const [projectKey, setProjectKey] = useState(
    () => localStorage.getItem('retro_jira_project') || '',
  )
  const [summary, setSummary] = useState(item.title || item.text)
  const [description, setDescription] = useState(
    [item.text, item.assignee ? `Ответственный: ${item.assignee}` : ''].filter(Boolean).join('\n\n'),
  )
  const [issueType, setIssueType] = useState('Task')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    if (!projectKey.trim() || !summary.trim()) return
    setLoading(true)
    setError(null)
    try {
      localStorage.setItem('retro_jira_project', projectKey.trim())
      const result = await createJiraIssue({
        action_item_id: item.id,
        project_key: projectKey.trim(),
        summary: summary.trim(),
        description,
        issue_type: issueType,
      })
      showToast(`Задача создана: ${result.jira_issue_key}`, 'info')
      onCreated({ ...item, jira_issue_key: result.jira_issue_key })
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, 'Ошибка создания задачи в Jira'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open
      title="Создать задачу в Jira"
      icon="link"
      onClose={onClose}
      onConfirm={handleConfirm}
      confirmLabel={loading ? 'Создание...' : 'Создать'}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block', color: 'var(--md-on-surface-variant)' }}>
            Ключ проекта
          </label>
          <input
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: '1.5px solid var(--md-outline-variant)',
              borderRadius: 10,
              padding: '9px 12px',
              fontFamily: "'Roboto', sans-serif",
              fontSize: 14,
              color: 'var(--md-on-surface)',
              background: 'var(--md-surface-variant)',
              outline: 'none',
            }}
            value={projectKey}
            onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
            placeholder="Например: RETRO"
            autoFocus
          />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block', color: 'var(--md-on-surface-variant)' }}>
            Заголовок
          </label>
          <input
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: '1.5px solid var(--md-outline-variant)',
              borderRadius: 10,
              padding: '9px 12px',
              fontFamily: "'Roboto', sans-serif",
              fontSize: 14,
              color: 'var(--md-on-surface)',
              background: 'var(--md-surface-variant)',
              outline: 'none',
            }}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Заголовок задачи"
          />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block', color: 'var(--md-on-surface-variant)' }}>
            Описание
          </label>
          <textarea
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: '1.5px solid var(--md-outline-variant)',
              borderRadius: 10,
              padding: '9px 12px',
              fontFamily: "'Roboto', sans-serif",
              fontSize: 14,
              color: 'var(--md-on-surface)',
              background: 'var(--md-surface-variant)',
              outline: 'none',
              resize: 'vertical',
              minHeight: 60,
            }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Описание (необязательно)"
            rows={3}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block', color: 'var(--md-on-surface-variant)' }}>
            Тип задачи
          </label>
          <select
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: '1.5px solid var(--md-outline-variant)',
              borderRadius: 10,
              padding: '9px 12px',
              fontFamily: "'Roboto', sans-serif",
              fontSize: 14,
              color: 'var(--md-on-surface)',
              background: 'var(--md-surface-variant)',
              outline: 'none',
            }}
            value={issueType}
            onChange={(e) => setIssueType(e.target.value)}
          >
            <option value="Task">Task</option>
            <option value="Story">Story</option>
            <option value="Bug">Bug</option>
          </select>
        </div>
        {error && (
          <p style={{ fontSize: 13, color: 'var(--md-error)', margin: 0 }}>{error}</p>
        )}
      </div>
    </Dialog>
  )
}
