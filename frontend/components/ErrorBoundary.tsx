'use client'

import React from 'react'

interface State {
  hasError: boolean
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: 16,
            fontFamily: 'Roboto, sans-serif',
          }}
        >
          <span
            className="material-symbols-rounded"
            style={{ fontSize: 48, color: 'var(--md-error, #BA1A1A)' }}
          >
            error
          </span>
          <p style={{ fontSize: 16, color: 'var(--md-on-surface, #1C1B1F)' }}>
            Произошла ошибка. Попробуйте обновить страницу.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px',
              borderRadius: 20,
              border: 'none',
              background: 'var(--md-primary, #6750A4)',
              color: 'var(--md-on-primary, #FFFFFF)',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Обновить страницу
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
