'use client'

import React from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Что-то пошло не так</h2>
            <p className="text-sm text-muted-foreground">
              Произошла непредвиденная ошибка интерфейса. Попробуйте обновить страницу.
            </p>
          </div>
          <Button onClick={() => window.location.reload()}>
            <RotateCcw className="h-4 w-4" />
            Обновить страницу
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
