import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

export default defineConfig([
  ...nextVitals,
  {
    // Правила React Compiler из eslint-plugin-react-hooks 7 (пришли с eslint-config-next 16).
    // Находки сидят в BoardPage, WebSocket-хуках и диалогах; их исправление — это
    // перестройка эффектов и «latest ref»-паттернов, то есть рефакторинг, а не обновление
    // платформы. Пока оставлены предупреждениями, чтобы новые места были видны.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'test-results/**',
    'playwright-report/**',
    'next-env.d.ts',
  ]),
])
