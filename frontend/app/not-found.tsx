import type { Metadata } from 'next'
import Link from 'next/link'
import { Home, SearchX } from 'lucide-react'
import { BrandLogo } from '@/components/BrandLogo'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Страница не найдена — RetroBoard',
}

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-center">
      <BrandLogo />
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <SearchX className="h-7 w-7" />
      </div>
      <div className="space-y-1">
        <p className="font-mono text-xs font-medium text-muted-foreground">Ошибка 404</p>
        <h1 className="text-lg font-semibold text-foreground">Страница не найдена</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Такой страницы нет: возможно, ссылка устарела или в адресе опечатка.
        </p>
      </div>
      <Button asChild>
        <Link href="/">
          <Home className="h-4 w-4" />
          На главную
        </Link>
      </Button>
    </div>
  )
}
