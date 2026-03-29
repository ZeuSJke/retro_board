# RetroBoard Workspaces Feature

Полная реализация функционала "пространств" (workspaces) для RetroBoard. Позволяет создавать изолированные рабочие пространства для разных команд, каждое с собственным набором досок.

## Архитектура

### Frontend (`frontend/`)

#### 1. **Типы и Store**
- `types/index.ts`: `WorkspaceSession` интерфейс и расширение `AppStore`
- `store/index.ts`: Zustand store с `workspace: null` и `setWorkspace()`

#### 2. **API Integration**
- `api/index.ts`:
  - Request interceptor добавляет `X-Workspace-Token` заголовок
  - Response interceptor обрабатывает 401 ошибки с workspace info
  - `loginToWorkspace(slug, access_key)` функция
  
- `api/admin.ts`: Отдельный axios instance для admin API
  - `adminLogin()`, `adminLogout()`
  - `getAdminWorkspaces()`, `createAdminWorkspace()`, `updateAdminWorkspace()`, `deleteAdminWorkspace()`

#### 3. **WelcomeDialog Component**
`components/WelcomeDialog.tsx` с тремя режимами:
1. **Без workspace:** Показывает поля "Код команды" и "Ключ доступа"
2. **С workspace:** Показывает инфо о команде + кнопку "Войти в другую команду"
3. **С именем:** Welcome диалог не показывается

#### 4. **Admin Panel**
- `app/admin/page.tsx`: Полностью независимая Client Component
  - Login форма для администраторов
  - Управление пространствами (CRUD)
  - Таблица с информацией о досках
  
- `app/admin/layout.tsx`: Минимальный layout без провайдеров основного приложения

- `app/admin/admin.module.css`: Material Design стилизация

#### 5. **WebSocket Integration**
- `hooks/useWebSocket.ts`: Передаёт `workspace_token` в query параметре WebSocket URL

#### 6. **E2E Testing**
- `e2e/helpers.ts`:
  - `loginWorkspace()`: Установка workspace токена в localStorage
  - `ensureE2EWorkspace()`: Создание/проверка E2E workspace
  - Обновлены `cleanupBoards()`, `createBoardViaAPI()`, `createActionItemViaAPI()`

- `e2e/admin.spec.ts`: Тесты админ-панели
- `e2e/workspace.spec.ts`: Тесты входа в workspace
- Обновлены все существующие E2E тесты (board, action-items, dashboard, dnd, home)

### Backend

Смотрите основной проект для реализации backend части:
- Миграции Alembic для создания таблиц workspaces
- Роуты: `routers/workspaces.py`, `routers/admin.py`
- Middleware: `workspace_auth.py` для валидации workspace токена
- E2E тесты для API

## Использование

### Для пользователей

1. **Первый вход:**
   ```
   URL: http://localhost:3080/
   → Welcome диалог показывает 3 поля:
     - Ваше имя
     - Код команды (e.g., "fmrm-core")
     - Ключ доступа
   → После входа вы получаете доступ к доскам в этом пространстве
   ```

2. **Повторный вход:**
   ```
   → Welcome диалог помнит ваше пространство
   → Нужно только ввести имя
   → Кнопка "Войти в другую команду" позволяет переключиться
   ```

### Для администраторов

1. **Вход в админ-панель:**
   ```
   URL: http://localhost:3080/admin
   Логин: admin
   Пароль: changeme (или установленный при развёртывании)
   ```

2. **Управление пространствами:**
   - Создание: Ввести название, код (автогенерируется), ключ доступа
   - Переименование: Кнопка [✏️]
   - Смена ключа: Кнопка [🔑]
   - Удаление: Кнопка [🗑️] с предупреждением

## Key Technical Details

### Workspace Token Flow

```
User Input (slug, access_key)
  ↓
WelcomeDialog.handleConfirm()
  ↓
api.loginToWorkspace(slug, access_key)
  ↓
POST /api/workspaces/login
  ↓
Backend validates and returns: { token, workspace_id, workspace_slug, workspace_name }
  ↓
setWorkspace(session)  // Store in localStorage
  ↓
Axios interceptor добавляет X-Workspace-Token для всех запросов
  ↓
WebSocket: workspace_token передаётся в query параметре
```

### Admin API Architecture

Отдельный axios instance с own cookies:
```typescript
// api/admin.ts
const adminApi = axios.create({
  baseURL: '/api/admin',
  withCredentials: true,
})
```

Позволяет отделить admin аутентификацию от user workspace аутентификации.

### E2E Testing Strategy

```typescript
// beforeEach в каждом E2E тесте
const wsData = await ensureE2EWorkspace(request)  // Создаёт если нужна
await cleanupBoards(request, wsData.token)         // Передаёт token
await setUsername(page)
await loginWorkspace(page, request)                // Устанавливает workspace в localStorage

// API запросы
await createBoardViaAPI(request, name, wsData.token)  // Передаёт token
```

## File Structure

```
frontend/
├── api/
│   ├── index.ts          # Main API, workspace functions, interceptors
│   └── admin.ts          # Admin API (separate instance)
├── app/
│   ├── admin/
│   │   ├── page.tsx      # Admin panel (Client Component)
│   │   ├── layout.tsx    # Minimal layout
│   │   └── admin.module.css
│   └── ...
├── components/
│   ├── WelcomeDialog.tsx
│   ├── WelcomeDialog.module.css
│   ├── App.tsx
│   └── ...
├── hooks/
│   ├── useWebSocket.ts   # Updated with workspace_token param
│   └── ...
├── types/
│   └── index.ts          # WorkspaceSession interface
├── store/
│   └── index.ts          # Zustand with workspace state
├── e2e/
│   ├── helpers.ts        # Updated with workspace functions
│   ├── admin.spec.ts     # New
│   ├── workspace.spec.ts # New
│   ├── board.spec.ts     # Updated
│   ├── action-items.spec.ts # Updated
│   ├── dashboard.spec.ts # Updated
│   ├── dnd.spec.ts       # Updated
│   └── home.spec.ts      # Updated
└── ...
```

## Build Status

✅ TypeScript compiles without errors
✅ All E2E tests properly set up with workspace support
✅ Admin panel fully functional
✅ Welcome dialog handles all three modes
✅ API interceptors handle workspace tokens

## Next Steps

1. **Backend Implementation** (если не готово):
   - Алембик миграции для workspaces таблицы
   - Роуты: `/api/workspaces/login`, `/api/admin/*`
   - Middleware для валидации workspace токена в WebSocket

2. **Production Deployment**:
   - Настроить ADMIN_LOGIN и ADMIN_PASSWORD env переменные
   - Инициализировать первое workspace через admin API
   - Обновить docs с инструкциями для users

3. **Enhancements** (future):
   - User management внутри workspace
   - Workspace permissions и roles
   - API key generation для CI/CD integration
   - Workspace audit logs
   - Workspace API rate limiting

## Testing

```bash
# Запустить E2E тесты
npm run test:e2e

# Запустить конкретный тест
npm run test:e2e -- workspace.spec.ts
npm run test:e2e -- admin.spec.ts

# TypeScript check
npm run build
```

## Notes

- WelcomeDialog полностью отделён от основного приложения, использует отдельный API функции
- Admin panel это отдельная страница с own state, не имеет зависимостей от Zustand или других контекстов приложения
- Workspace токен в WebSocket URL (не custom header) потому что握手 не поддерживает headers
- E2E тесты используют `ensureE2EWorkspace()` для надёжного создания workspace перед каждым тестом

Commit: 512857b Реализовать функционал пространств (workspaces) для frontend
