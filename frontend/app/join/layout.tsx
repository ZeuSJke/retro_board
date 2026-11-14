import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Приглашение — RetroBoard',
  description: 'Вход в команду RetroBoard по ссылке-приглашению',
  // В адресе страницы — токен приглашения: поисковикам её показывать незачем
  robots: { index: false, follow: false },
}

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
