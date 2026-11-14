# frontend/AGENTS.md

Область: каталог `frontend/`. Общий процесс, DoD и сквозные инварианты — в корневом [AGENTS.md](../AGENTS.md).

Стек: Next.js 16 (App Router, Turbopack) · React 19 · TypeScript 6 · Tailwind CSS 4 · shadcn/ui (Radix UI) · Zustand 5 · `@dnd-kit` · Vitest 5 · Playwright. Node — 24 (как в CI-образе и `Dockerfile`); локально подойдёт и 22.22+.

## Команды (из `frontend/` или через `Makefile` в корне)

```bash
npm run build        # production standalone build (также генерирует gitignored next-env.d.ts)
npm run typecheck    # tsc --noEmit по всем файлам (включая tests/ и e2e/; запускать после build)
npm run lint         # eslint . — flat config eslint.config.mjs (в Next 16 команды next lint нет)
npm test             # Vitest (tests/), конфиг vitest.config.mts
npx vitest run tests/store/index.test.ts
npx playwright test  # E2E против поднятого стека http://localhost:3080 + :8000 (читает ../.env)
```

- **TypeScript остаётся на 6.x**: typescript-eslint не поддерживает TypeScript 7 (нативный компилятор без JS API). Обновлять мажор только вместе с ним.
- **Линтер**: `eslint-config-next` (core-web-vitals + typescript) и типовые правила typescript-eslint (`no-floating-promises`, `no-misused-promises`, `no-unsafe-*`). Вызов «запустить и не ждать» помечайте `void`, если функция сама ловит ошибки. Правила React Compiler (`react-hooks/set-state-in-effect`, `refs`, `immutability`, `preserve-manual-memoization`) пока в режиме `warn` — существующие находки в `BoardPage`, WebSocket-хуках и диалогах не исправлены; новые не добавляйте.

## Архитектура и паттерны

- **Алиас и компоненты**: `@/*` ведёт в корень `frontend/` (`tsconfig.json`, `vitest.config.mts`). Все четыре страницы в `app/` (`page.tsx`, `board/[id]/page.tsx`, `dashboard/page.tsx`, `admin/page.tsx`) — клиентские компоненты (`'use client'`): данные загружаются в браузере через `api/`. Серверными остаются `layout.tsx` (metadata, шрифты, провайдеры) и `not-found.tsx`; `error.tsx` по требованию Next — клиентский.
- **UI-примитивы (`components/ui/`)**: переиспользуйте shadcn/ui + Radix UI (`dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `select.tsx`, `dropdown-menu.tsx`, `popover.tsx`, `tooltip.tsx`, `tabs.tsx`, `scroll-area.tsx`, `button.tsx`).
- **Провайдеры**: корневые провайдеры настроены в `components/Providers.tsx` (`MotionConfig`, `ThemeProvider`, `<TooltipProvider delayDuration={250}>`, `sonner` `<Toaster />`).
- **API и состояние**:
  - `api/index.ts` (Axios `baseURL: '/api'`) подставляет `X-Workspace-Token` и `X-CSRF-Token`, обрабатывает `401/403/423/429/5xx`; админ-клиент — `api/admin.ts`. Ответы типизируйте дженериком (`api.get<Board>(…)`), иначе сработает `no-unsafe-return`.
  - Глобальный стор: `store/index.ts` (`useAppStore`, ключ localStorage `retroboard-app`). У persist есть `version` (`APP_STORE_VERSION`) и `migrate`: при изменении формы сохраняемого состояния поднимите версию и добавьте шаг в `MIGRATION_STEPS`. Без изменения формы версию не трогайте — после отката старая сборка отбросит данные с незнакомой версией.
  - WebSocket: `hooks/useWebSocket.ts` подключается к `/ws/${boardId}` (или `'workspace'`) без токена в URL (через `httpOnly` cookie); события доски маршрутизируются в `hooks/useBoardWebSocket.ts` — новые серверные события добавляйте туда и в `types/index.ts`.
  - Уведомления: вызывайте `showToast(message, type?: 'error' | 'info' | 'success')` из `store/toastStore.ts` (`sonner`).
- **Шрифты**: `Inter` и `JetBrains Mono` зашиты локально через `@fontsource/*` в `app/layout.tsx` — внешние font-домены запрещены строгим CSP `font-src 'self'` (`next.config.mjs` и Traefik Middleware).
- **Ленивая загрузка тяжёлого**: графики дашборда (`TrendChart`, `MoodTrendChart` → recharts) подключаются через `next/dynamic` в `Dashboard.tsx`; палитра команд — через обёртку `CommandPaletteLazy.tsx` (она же держит Ctrl/Cmd+K, пока чанк не загружен); генератор PDF-отчёта `utils/exportPDF.ts` — динамическим `import()` по клику. Не импортируйте их статически из `BoardPage`/`Dashboard`.

## Tailwind CSS 4

Конфигурация живёт в CSS: `app/globals.css` (`@theme`, `@source`, `@custom-variant`), файла `tailwind.config.ts` нет. Анимации `animate-in`/`fade-in-*`/`zoom-in-*`/`slide-in-from-*` даёт `tw-animate-css`.

Обновление с Tailwind 3 сделано без изменения внешнего вида, поэтому в `globals.css` есть слой совместимости — не убирайте его частями, не сверившись со снимками:

- **Палитра** `app/tailwind-v3-palette.css`: значения цветов Tailwind 3. В Tailwind 4 те же имена (`emerald-500`, `amber-200` …) ярче; чтобы перейти на новую палитру, удалите файл и его `@import`.
- **`space-x-*` / `space-y-*`** переопределены под семантику Tailwind 3 (отступ у всех, кроме первого). Со встроенной в Tailwind 4 пропадает отступ между строчным `<label>` и полем ввода.
- **`line-height` у `text-*`** задан в rem, как в Tailwind 3; стек шрифтов, `hover:` на тач-устройствах, `cursor: pointer` у кнопок, цвет плейсхолдера и рамок — тоже прежние.
- **Градиенты** пишутся `bg-linear-to-*/srgb` (интерполяция как в Tailwind 3).
- **Имена классов**: `shadow-xs` = прежний `shadow-sm`, `shadow-sm` = прежний `shadow`, `outline-hidden` = прежний `outline-none`.
- **`translate-*` / `scale-*` / `rotate-*` — отдельные CSS-свойства**, они не перебиваются `transform`, а складываются с ним. Это касается inline-`transform` от `@dnd-kit` и `motion`, а также keyframes: если анимация задаёт `transform`, не дублируйте в ней смещение, которое уже даёт класс (см. `float-up`, классы `slide-in-from-*` у `Dialog` и `Select`).

## Критические инварианты UI и оверлеев

- **Scroll-lock (`app/globals.css`)**: задавайте `overflow-x: clip` **только на `body`**; не ставьте `height: 100%` и `overflow-x: hidden` на `html, body`, иначе вертикальный скролл уходит с корневого viewport, и компенсация `margin-right` в `react-remove-scroll` при открытии `Dialog`/`Select`/модальных меню смещает шапку и контент по горизонтали.
- **TooltipProvider**: не вкладывайте лишние корневые `TooltipProvider` поверх `Providers.tsx` (`components/ui/tooltip.tsx` использует `InsideTooltipProviderContext` и создаёт fallback-провайдер только для изолированных тестов).
- **DropdownMenu**: выпадающие меню в шапке, которые по первому клику открывают другой диалог или ведут на другую страницу (`Topbar.tsx`), делайте `<DropdownMenu modal={false}>`, чтобы pointer-guard не глотал первый клик. Меню поверх DnD-зон (`CardWidget.tsx`) оставляйте `modal={true}`.
- **Переключатели тем/иконок**: кнопки с `absolute`-иконками внутри (`Sun`/`Moon` и т.п.) обязаны иметь класс `relative`.
