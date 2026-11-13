import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
import './globals.css'
import type { Metadata } from 'next'
import ErrorBoundary from '../components/ErrorBoundary'
import Providers from '../components/Providers'

export const metadata: Metadata = {
  title: 'RetroBoard — Ретроспектива команды',
  description: 'Интерактивная доска ретроспектив, голосования и Action Items',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <Providers>
          <ErrorBoundary>{children}</ErrorBoundary>
        </Providers>
      </body>
    </html>
  )
}
