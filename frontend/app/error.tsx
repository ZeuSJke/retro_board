'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, Home, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Что-то пошло не так</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Произошла непредвиденная ошибка интерфейса. Попробуйте ещё раз или вернитесь на главную.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={() => retry()}>
          <RotateCcw className="h-4 w-4" />
          Попробовать снова
        </Button>
        <Button asChild variant="outline">
          <Link href="/">
            <Home className="h-4 w-4" />
            На главную
          </Link>
        </Button>
      </div>
    </div>
  )
}
