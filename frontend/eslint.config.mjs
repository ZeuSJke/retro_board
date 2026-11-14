import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import tseslint from 'typescript-eslint'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Правила typescript-eslint, которым нужна информация о типах (no-floating-promises и др.).
  ...tseslint.configs.recommendedTypeCheckedOnly,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Обработчики вида onClick={async () => …} в JSX — штатный приём React,
      // остальные проверки правила (условия, spread, аргументы) остаются.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      // Правила React Compiler из eslint-plugin-react-hooks 7 (пришли с eslint-config-next 16).
      // Находки сидят в BoardPage, WebSocket-хуках и диалогах; их исправление — это
      // перестройка эффектов и «latest ref»-паттернов, то есть рефакторинг, а не обновление
      // платформы. Пока оставлены предупреждениями, чтобы новые места были видны.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
  {
    // В тестах `any` приходит из моков и JSON-ответов (res.json(), vi.fn()) по самой их природе,
    // а expect(obj.method) — обычная проверка шпиона, а не потеря this.
    files: ['tests/**', 'e2e/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // Конфиги на чистом JS не входят в tsconfig — типовые правила для них выключены.
    files: ['**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
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
