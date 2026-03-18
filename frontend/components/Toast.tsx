'use client'

import { useToasts, dismissToast } from '../store/toastStore'
import s from './Toast.module.css'

export default function ToastContainer() {
  const toasts = useToasts()
  if (toasts.length === 0) return null

  return (
    <div className={s.container}>
      {toasts.map((t) => (
        <div key={t.id} className={`${s.toast} ${s[t.type]}`}>
          <span className={s.message}>{t.message}</span>
          <button className={s.close} onClick={() => dismissToast(t.id)}>
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>
      ))}
    </div>
  )
}
