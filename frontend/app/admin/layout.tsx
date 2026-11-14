import '../globals.css'

export const metadata = {
  title: 'Администрирование — RetroBoard',
  description: 'Управление командами RetroBoard',
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
