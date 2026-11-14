# frontend/AGENTS.md

Область: каталог `frontend/`. Общий процесс, DoD и сквозные инварианты — в корневом [AGENTS.md](../AGENTS.md).

## Команды (из `frontend/` или через `Makefile` в корне)

```bash
npm run build        # production standalone build (также генерирует gitignored next-env.d.ts)
npm run lint         # next lint (ESLint next/core-web-vitals)
npm test             # Vitest (tests/)
npx vitest run tests/store/index.test.ts
npx playwright test  # E2E против поднятого стека http://localhost:3080 + :8000 (читает ../.env)
```

## Архитектура и паттерны

- **Алиас и компоненты**: `@/*` ведёт в корень `frontend/` (`tsconfig.json`, `vitest.config.ts`). Страницы в `app/` по умолчанию Server Components; добавляйте `'use client'` там, где есть состояние или браузерные API.
- **UI-примитивы (`components/ui/`)**: переиспользуйте shadcn/ui + Radix UI (`dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `select.tsx`, `dropdown-menu.tsx`, `popover.tsx`, `tooltip.tsx`, `tabs.tsx`, `scroll-area.tsx`, `button.tsx`).
- **Провайдеры**: корневые провайдеры настроены в `components/Providers.tsx` (`MotionConfig`, `ThemeProvider`, `<TooltipProvider delayDuration={250}>`, `sonner` `<Toaster />`).
- **API и состояние**:
  - `api/index.ts` (Axios `baseURL: '/api'`) подставляет `X-Workspace-Token` и `X-CSRF-Token`, обрабатывает `401/403/423/429/5xx`; админ-клиент — `api/admin.ts`.
  - Глобальный стор: `store/index.ts` (`useAppStore`, ключ localStorage `retroboard-app`).
  - WebSocket: `hooks/useWebSocket.ts` подключается к `/ws/${boardId}` (или `'workspace'`) без токена в URL (через `httpOnly` cookie); события доски маршрутизируются в `hooks/useBoardWebSocket.ts` — новые серверные события добавляйте туда и в `types/index.ts`.
  - Уведомления: вызывайте `showToast(message, type?: 'error' | 'info' | 'success')` из `store/toastStore.ts` (`sonner`).
- **Шрифты**: `Inter` и `JetBrains Mono` зашиты локально через `@fontsource/*` в `app/layout.tsx` — внешние font-домены запрещены строгим CSP `font-src 'self'` (`next.config.mjs` и Traefik Middleware).

## Критические инварианты UI и оверлеев

- **Scroll-lock (`app/globals.css`)**: задавайте `overflow-x: clip` **только на `body`**; не ставьте `height: 100%` и `overflow-x: hidden` на `html, body`, иначе вертикальный скролл уходит с корневого viewport, и компенсация `margin-right` в `react-remove-scroll` при открытии `Dialog`/`Select`/модальных меню смещает шапку и контент по горизонтали.
- **TooltipProvider**: не вкладывайте лишние корневые `TooltipProvider` поверх `Providers.tsx` (`components/ui/tooltip.tsx` использует `InsideTooltipProviderContext` и создаёт fallback-провайдер только для изолированных тестов).
- **DropdownMenu**: выпадающие меню в шапке, которые по первому клику открывают другой диалог или ведут на другую страницу (`Topbar.tsx`), делайте `<DropdownMenu modal={false}>`, чтобы pointer-guard не глотал первый клик. Меню поверх DnD-зон (`CardWidget.tsx`) оставляйте `modal={true}`.
- **Переключатели тем/иконок**: кнопки с `absolute`-иконками внутри (`Sun`/`Moon` и т.п.) обязаны иметь класс `relative`.
