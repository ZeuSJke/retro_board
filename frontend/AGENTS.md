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
# Стенд на других портах: E2E_BASE_URL=http://localhost:<прокси> E2E_API_URL=http://localhost:<бэкенд> npx playwright test
```

- **TypeScript остаётся на 6.x**: typescript-eslint не поддерживает TypeScript 7 (нативный компилятор без JS API). Обновлять мажор только вместе с ним.
- **Линтер**: `eslint-config-next` (core-web-vitals + typescript) и типовые правила typescript-eslint (`no-floating-promises`, `no-misused-promises`, `no-unsafe-*`). Вызов «запустить и не ждать» помечайте `void`, если функция сама ловит ошибки. Правила React Compiler (`react-hooks/set-state-in-effect`, `refs`, `immutability`, `preserve-manual-memoization`) пока в режиме `warn` — существующие находки в `BoardPage`, WebSocket-хуках и диалогах не исправлены; новые не добавляйте.

## Архитектура и паттерны

- **Алиас и компоненты**: `@/*` ведёт в корень `frontend/` (`tsconfig.json`, `vitest.config.mts`). Все четыре страницы в `app/` (`page.tsx`, `board/[id]/page.tsx`, `dashboard/page.tsx`, `admin/page.tsx`) — клиентские компоненты (`'use client'`): данные загружаются в браузере через `api/`. Серверными остаются `layout.tsx` (metadata, шрифты, провайдеры) и `not-found.tsx`; `error.tsx` по требованию Next — клиентский.
- **UI-примитивы (`components/ui/`)**: переиспользуйте shadcn/ui + Radix UI (`dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `select.tsx`, `dropdown-menu.tsx`, `popover.tsx`, `tooltip.tsx`, `tabs.tsx`, `scroll-area.tsx`, `button.tsx`).
- **Провайдеры**: корневые провайдеры настроены в `components/Providers.tsx` (`MotionConfig`, `ThemeProvider`, `<TooltipProvider delayDuration={250}>`, `sonner` `<Toaster />`).
- **API и состояние**:
  - `api/index.ts` (Axios `baseURL: '/api'`) подставляет `X-CSRF-Token` и обрабатывает `401/403/423/429/5xx`; админ-клиент — `api/admin.ts`. Ответы типизируйте дженериком (`api.get<Board>(…)`), иначе сработает `no-unsafe-return`.
  - **Сессия**: токен живёт только в `httpOnly`-cookie `workspace_token` — в сторе, заголовках и адресе WebSocket его нет. Вход — `loginToWorkspace` (возвращает `SessionInfo`: `{ workspace, participant }`), сверка с сервером — `refreshWorkspaceSession` (`GET /workspaces/me`: участник, команда, `ai_enabled` → стор), выход — `logoutWorkspace`, затем `clearSession()`. Ответ `401` сам сбрасывает сессию в сторе, и приложение показывает `WelcomeDialog`.
  - **Участник**: «я» на доске — это `participant.id` из стора (`{ id, name }`), а не имя: тёзки — разные участники. `username` в сторе — только имя для формы входа.
  - **Ошибки API**: текст для пользователя берите через `getApiErrorMessage(err, fallback)` из `utils/apiError.ts` — вызов помечает ошибку показанной, и общий тост перехватчика (`403/423/429/5xx`) не дублирует ваш. Если показываете ошибку иначе (в форме), вызовите `markApiErrorReported(err)`.
  - Глобальный стор: `store/index.ts` (`useAppStore`, ключ localStorage `retroboard-app`): `workspace`, `participant`, `username`, тема, сетка, текущая доска; `aiEnabled` не сохраняется. У persist есть `version` (`APP_STORE_VERSION`, сейчас 1) и `migrate`: при изменении формы сохраняемого состояния поднимите версию и добавьте шаг в `MIGRATION_STEPS`. Без изменения формы версию не трогайте — после отката старая сборка отбросит данные с незнакомой версией.
  - WebSocket: `hooks/useWebSocket.ts` подключается к `/ws/${boardId}` (или `'workspace'`) без токена в URL (через `httpOnly` cookie), только когда в сторе есть участник. Он же следит за соединением: `ping` без ответа — переподключение, `online` / `visibilitychange` — проверка сразу, код `1008` — остановка попыток, очередь исходящих живёт пять секунд. События доски маршрутизирует `hooks/useBoardWebSocket.ts`, а меняют состояние чистые редьюсеры в `lib/board-events.ts` (порядок из `card_moved`, `column_updated` без карточек, `participant_renamed` и т. д.) — новые серверные события добавляйте туда и в `types/index.ts`. Курсоры, готовность, набор текста и ведущий различают участников по `participant_id` / `facilitator_id`, не по имени.
  - **Синхронизация доски**: события данных несут `seq` / `epoch`, снимок доски — `event_seq` / `event_epoch`; порядок проверяет `lib/board-sync.ts` (пропуск или другая `epoch` — доска перечитывается: `resync` в `useBoardWebSocket`, оно же после каждого переподключения). Колонки меняйте только через `applyChange(change, source)` из того же хука: `'ws'` — событие, `'rest'` — ответ на свой запрос (не затирает более свежее событие), `'local'` — оптимистичная правка или её откат. Откаты точечные (`card_patched`, `card_relocated`, `*_restored`), а не снимком. Пока участник тащит карточку, чужие изменения отложены (`holdRemoteChanges`). Отказ сервера при рукопожатии браузер видит как код `1006`, поэтому причину (нет сессии, нет доски) хук выясняет запросом REST.
  - **Таймер**: состояние приходит только с сервера (`timer_*` и начальное состояние при подключении) и хранится моментом окончания (`TimerState.endsAt`, `lib/timer.ts`); тик — внутри `TimerWidget`. Не заводите состояние, которое меняется каждую секунду, в `BoardPage`: колонки и карточки мемоизированы (`lib/memo.ts`), обработчики для них должны оставаться стабильными.
  - **Права и «моё»**: `lib/participants.ts` — своя карточка и свои голоса (`isOwnCard`, `countMyVotes`), модератор доски (`canModerateBoard`), права на карточку, подписи голосовавших. Правила повторяют серверные (`backend/app/board_view.py`) и нужны только для интерфейса: недоступное действие отключайте с причиной, а не прячьте молча.
  - **Что скрыто, решает сервер**: чужая карточка до раскрытия приходит как `masked` (без текста, автора и голосов), состояние сбора — `board.cards_hidden`, авторы и голоса в анонимном режиме уже обезличены. Клиент ничего не прячет и не раскрывает сам; при `cards_visibility_changed` (оно приходит и при смене анонимного режима) доска перечитывается (`resync` в `useBoardWebSocket`). Экспорт и AI-действия обязаны учитывать `masked` / `cards_hidden`.
  - **AI**: признак `aiEnabled` в сторе (`ai_enabled` из `/workspaces/me`; `null` — ещё не знаем). При `false` AI-кнопки скрыты, при `board.cards_hidden` — отключены с пояснением.
  - Уведомления: вызывайте `showToast(message, type?: 'error' | 'info' | 'success', options?)` из `store/toastStore.ts` (`sonner`). Длинному объяснению («что произошло и что делать») дайте `options.description` и `options.duration`.
- **Шрифты**: `Inter` и `JetBrains Mono` зашиты локально через `@fontsource/*` в `app/layout.tsx` — внешние font-домены запрещены строгим CSP `font-src 'self'` (`next.config.mjs` и Traefik Middleware).
- **Ленивая загрузка тяжёлого**: графики дашборда (`TrendChart`, `MoodTrendChart` → recharts) подключаются через `next/dynamic` в `Dashboard.tsx`; палитра команд — через обёртку `CommandPaletteLazy.tsx` (она же держит Ctrl/Cmd+K, пока чанк не загружен); генератор PDF-отчёта `utils/exportPDF.ts` — динамическим `import()` по клику. Не импортируйте их статически из `BoardPage`/`Dashboard`.
- **Адреса и список досок**: адрес доски собирайте через `boardPath` из `lib/board-routes.ts`; `/board/start` — служебный адрес «открыть первую доску» (сервер такой slug не выдаёт). Доску за пользователя не создаём: команда без досок — это `NoBoardsScreen` с кнопкой создания. Список досок хранит `App`, а панель досок и диалог настроек рисует `BoardPage`, поэтому они сообщают о событиях через `lib/board-list-signals.ts`: `requestBoardsRefresh()` (счётчики считает сервер — список перечитывается при открытии панели) и `markOwnBoardDeletion()` (событие `board_deleted` приходит удаляющему раньше ответа на запрос — без пометки был бы второй переход и лишний тост).
- **Словарь интерфейса**: «команда» (не workspace и не пространство), «код команды», «ключ доступа», «ведущий» (не фасилитатор), «участник», «доска», «панель управления» (дашборд). Панель справа на доске — «Задачи». «Итоги» — только AI-резюме встречи: фаза «Итоги» и окно «Итоги ретроспективы». Шпаргалка клавиш (`ShortcutsDialog.tsx`) описывает то, что доска делает на самом деле: меняете горячие клавиши, выделение или перетаскивание — поправьте и её.
- **Состояния вместо одинокого тоста**: если действие не удалось и пользователю есть что сделать дальше, показывайте причину там, где он ждал результат, с действием («Повторить», «Открыть экспорт»): так устроены окно итогов (`SummaryModal`), AI-подбор задач (`SuggestActionItemsDialog`) и блок «Открытые с прошлых ретро». Пустой список и ошибка загрузки — разные состояния.

## E2E (Playwright)

- `e2e/global-setup.ts` на каждый прогон пересоздаёт команду `e2e-team` через админку и входит общим участником «E2E Тестер»; его сессия передаётся воркерам в `E2E_SHARED_SESSION`. Нужны `ADMIN_LOGIN` / `ADMIN_PASSWORD` стенда.
- Сервер отдаёт токен только в cookie: `ensureE2EWorkspace(request)` возвращает сессию общего участника с полем `token` (значение cookie) — его спеки шлют в `X-Workspace-Token` при вызовах API.
- `setUsername(page, name)` + `loginWorkspace(page, request)` открывают сессию для страницы без формы входа. Имя по умолчанию — тот же общий участник (создатель досок и автор карточек, созданных через API); другое имя — отдельный участник (`loginViaAPI`).
- Удалить доску может только её создатель: доски в спеках создавайте общим участником (через API его токеном или со страницы с именем по умолчанию), иначе `cleanupBoards` упадёт.

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
