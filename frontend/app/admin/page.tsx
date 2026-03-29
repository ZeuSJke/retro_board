'use client'

import { useState, useEffect } from 'react'
import {
  adminLogin,
  adminLogout,
  getAdminWorkspaces,
  createAdminWorkspace,
  updateAdminWorkspace,
  deleteAdminWorkspace,
  type WorkspaceListItem,
} from '../../api/admin'
import styles from './admin.module.css'

type PageState = 'login' | 'workspaces'
type EditingWorkspaceId = string | null
type ShowingDialog = 'create' | 'rename' | 'key' | null

export default function AdminPage() {
  const [pageState, setPageState] = useState<PageState>('login')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)

  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create dialog state
  const [showDialog, setShowDialog] = useState<ShowingDialog>(null)
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<EditingWorkspaceId>(null)
  const [dialogLoading, setDialogLoading] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  // Form fields for create
  const [createName, setCreateName] = useState('')
  const [createSlug, setCreateSlug] = useState('')
  const [createAccessKey, setCreateAccessKey] = useState('')

  // Form fields for rename
  const [renameName, setRenameName] = useState('')

  // Form fields for key
  const [keyAccessKey, setKeyAccessKey] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginLoading(true)
    setLoginError(null)

    try {
      await adminLogin({ login, password })
      setPageState('workspaces')
      loadWorkspaces()
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error && 'response' in err && (err as any).response?.status === 401
          ? 'Неверный логин или пароль'
          : 'Ошибка при входе'
      setLoginError(errorMsg)
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      await adminLogout()
      setPageState('login')
      setLogin('')
      setPassword('')
      setWorkspaces([])
    } catch (err) {
      console.error('Logout error:', err)
    }
  }

  const loadWorkspaces = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAdminWorkspaces()
      setWorkspaces(data)
    } catch (err) {
      setError('Не удалось загрузить пространства')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const generateSlugFromName = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  const openCreateDialog = () => {
    setCreateName('')
    setCreateSlug('')
    setCreateAccessKey('')
    setDialogError(null)
    setShowDialog('create')
  }

  const handleCreateConfirm = async () => {
    if (!createName.trim() || !createSlug.trim() || !createAccessKey) {
      setDialogError('Заполните все поля')
      return
    }

    setDialogLoading(true)
    setDialogError(null)

    try {
      const newWorkspace = await createAdminWorkspace({
        slug: createSlug.trim(),
        name: createName.trim(),
        access_key: createAccessKey,
      })
      setWorkspaces((prev) => [newWorkspace, ...prev])
      setShowDialog(null)
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error && 'response' in err
          ? (err as any).response?.data?.detail || 'Ошибка при создании'
          : 'Ошибка при создании'
      setDialogError(errorMsg)
    } finally {
      setDialogLoading(false)
    }
  }

  const openRenameDialog = (ws: WorkspaceListItem) => {
    setEditingWorkspaceId(ws.id)
    setRenameName(ws.name)
    setDialogError(null)
    setShowDialog('rename')
  }

  const handleRenameConfirm = async () => {
    if (!renameName.trim() || !editingWorkspaceId) {
      setDialogError('Введите имя')
      return
    }

    setDialogLoading(true)
    setDialogError(null)

    try {
      const updated = await updateAdminWorkspace(editingWorkspaceId, {
        name: renameName.trim(),
      })
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === editingWorkspaceId ? { ...w, ...updated } : w)),
      )
      setShowDialog(null)
      setEditingWorkspaceId(null)
    } catch (err) {
      setDialogError('Ошибка при переименовании')
    } finally {
      setDialogLoading(false)
    }
  }

  const openKeyDialog = (ws: WorkspaceListItem) => {
    setEditingWorkspaceId(ws.id)
    setKeyAccessKey('')
    setDialogError(null)
    setShowDialog('key')
  }

  const handleKeyConfirm = async () => {
    if (!keyAccessKey || !editingWorkspaceId) {
      setDialogError('Введите ключ доступа')
      return
    }

    setDialogLoading(true)
    setDialogError(null)

    try {
      await updateAdminWorkspace(editingWorkspaceId, {
        access_key: keyAccessKey,
      })
      setShowDialog(null)
      setEditingWorkspaceId(null)
      setKeyAccessKey('')
    } catch (err) {
      setDialogError('Ошибка при смене ключа')
    } finally {
      setDialogLoading(false)
    }
  }

  const handleDelete = async (ws: WorkspaceListItem) => {
    const confirmed = window.confirm(
      `Удалить пространство "${ws.name}"? Это удалит все ${ws.boards_count} доск${
        ws.boards_count === 1 ? 'у' : 'и'
      } в нём.`,
    )
    if (!confirmed) return

    setLoading(true)
    setError(null)

    try {
      await deleteAdminWorkspace(ws.id)
      setWorkspaces((prev) => prev.filter((w) => w.id !== ws.id))
    } catch (err) {
      setError('Ошибка при удалении пространства')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (pageState === 'workspaces') {
      loadWorkspaces()
    }
  }, [pageState])

  if (pageState === 'login') {
    return (
      <div className={styles.container}>
        <div className={styles.loginCard}>
          <div className={styles.loginHeader}>
            <span className="material-symbols-rounded" style={{ fontSize: 28 }}>
              lock
            </span>
            <h1>Панель управления</h1>
          </div>

          <form onSubmit={handleLogin} className={styles.loginForm}>
            <div className={styles.formGroup}>
              <label>Логин</label>
              <div className={styles.inputWrap}>
                <span className="material-symbols-rounded">person</span>
                <input
                  type="text"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="Администратор"
                  disabled={loginLoading}
                  autoFocus
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label>Пароль</label>
              <div className={styles.inputWrap}>
                <span className="material-symbols-rounded">key</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Пароль"
                  disabled={loginLoading}
                />
              </div>
            </div>

            {loginError && <div className={styles.error}>{loginError}</div>}

            <button type="submit" className={styles.btn} disabled={loginLoading}>
              {loginLoading ? 'Вход...' : 'Войти'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.workspacesPage}>
        <div className={styles.header}>
          <h1>Пространства RetroBoard</h1>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            <span className="material-symbols-rounded">logout</span>
            Выйти
          </button>
        </div>

        {error && <div className={styles.errorBanner}>{error}</div>}

        <div className={styles.toolbar}>
          <button className={styles.createBtn} onClick={openCreateDialog} disabled={loading}>
            <span className="material-symbols-rounded">add</span>
            Создать пространство
          </button>
        </div>

        {loading && workspaces.length === 0 ? (
          <div className={styles.centered}>
            <div className={styles.spinner} />
            <p>Загрузка...</p>
          </div>
        ) : workspaces.length === 0 ? (
          <div className={styles.empty}>
            <span className="material-symbols-rounded">folder_open</span>
            <p>Пространства не найдены</p>
            <button className={styles.createBtn} onClick={openCreateDialog}>
              <span className="material-symbols-rounded">add</span>
              Создать первое пространство
            </button>
          </div>
        ) : (
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <div className={styles.colName}>Название</div>
              <div className={styles.colSlug}>Код (slug)</div>
              <div className={styles.colBoards}>Досок</div>
              <div className={styles.colActions}>Действия</div>
            </div>
            <div className={styles.tableBody}>
              {workspaces.map((ws) => (
                <div key={ws.id} className={styles.tableRow}>
                  <div className={styles.colName}>
                    <span className="material-symbols-rounded">business</span>
                    {ws.name}
                  </div>
                  <div className={styles.colSlug}>
                    <code>{ws.slug}</code>
                  </div>
                  <div className={styles.colBoards}>{ws.boards_count}</div>
                  <div className={styles.colActions}>
                    <button
                      className={styles.actionBtn}
                      onClick={() => openRenameDialog(ws)}
                      title="Переименовать"
                    >
                      <span className="material-symbols-rounded">edit</span>
                    </button>
                    <button
                      className={styles.actionBtn}
                      onClick={() => openKeyDialog(ws)}
                      title="Изменить ключ доступа"
                    >
                      <span className="material-symbols-rounded">vpn_key</span>
                    </button>
                    <button
                      className={styles.actionBtn + ' ' + styles.deleteBtn}
                      onClick={() => handleDelete(ws)}
                      title="Удалить"
                      disabled={loading}
                    >
                      <span className="material-symbols-rounded">delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showDialog && (
        <div className={styles.dialogOverlay} onClick={() => !dialogLoading && setShowDialog(null)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <div className={styles.dialogHeader}>
              <h2>
                {showDialog === 'create'
                  ? 'Создать пространство'
                  : showDialog === 'rename'
                    ? 'Переименовать пространство'
                    : 'Изменить ключ доступа'}
              </h2>
              <button
                className={styles.closeBtn}
                onClick={() => !dialogLoading && setShowDialog(null)}
              >
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>

            <div className={styles.dialogBody}>
              {showDialog === 'create' && (
                <>
                  <div className={styles.formGroup}>
                    <label>Название</label>
                    <input
                      type="text"
                      value={createName}
                      onChange={(e) => {
                        setCreateName(e.target.value)
                        if (!createSlug) {
                          setCreateSlug(generateSlugFromName(e.target.value))
                        }
                      }}
                      placeholder="FMRM Core"
                      disabled={dialogLoading}
                      autoFocus
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>Код (slug)</label>
                    <input
                      type="text"
                      value={createSlug}
                      onChange={(e) => setCreateSlug(e.target.value)}
                      placeholder="fmrm-core"
                      disabled={dialogLoading}
                    />
                    <small>Буквы, цифры и дефисы</small>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Ключ доступа</label>
                    <input
                      type="password"
                      value={createAccessKey}
                      onChange={(e) => setCreateAccessKey(e.target.value)}
                      placeholder="Безопасный ключ"
                      disabled={dialogLoading}
                    />
                  </div>
                </>
              )}

              {showDialog === 'rename' && (
                <div className={styles.formGroup}>
                  <label>Новое название</label>
                  <input
                    type="text"
                    value={renameName}
                    onChange={(e) => setRenameName(e.target.value)}
                    placeholder="Название"
                    disabled={dialogLoading}
                    autoFocus
                  />
                </div>
              )}

              {showDialog === 'key' && (
                <div className={styles.formGroup}>
                  <label>Новый ключ доступа</label>
                  <input
                    type="password"
                    value={keyAccessKey}
                    onChange={(e) => setKeyAccessKey(e.target.value)}
                    placeholder="Новый ключ"
                    disabled={dialogLoading}
                    autoFocus
                  />
                </div>
              )}

              {dialogError && <div className={styles.error}>{dialogError}</div>}
            </div>

            <div className={styles.dialogFooter}>
              <button
                className={styles.btnSecondary}
                onClick={() => setShowDialog(null)}
                disabled={dialogLoading}
              >
                Отмена
              </button>
              <button
                className={styles.btn}
                onClick={() => {
                  if (showDialog === 'create') handleCreateConfirm()
                  else if (showDialog === 'rename') handleRenameConfirm()
                  else if (showDialog === 'key') handleKeyConfirm()
                }}
                disabled={dialogLoading}
              >
                {dialogLoading ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
