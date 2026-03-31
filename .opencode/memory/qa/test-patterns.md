# QA Patterns

## Test Patterns

### Backend (pytest)

```python
def test_create_card(client, workspace_headers, db_session):
    response = client.post(
        "/api/cards/",
        json={"text": "Test", "column_id": column_id},
        headers=workspace_headers,
    )
    assert response.status_code == 201
    assert response.json()["text"] == "Test"
```

### Frontend (Vitest)

```typescript
test('renders card', () => {
  render(<CardWidget card={mockCard} />)
  expect(screen.getByText(mockCard.text)).toBeInTheDocument()
})
```

---

## Mock Strategies

### Backend
```python
# Для WS тестов
from tests.conftest import ws_workspace, ws_token
```

### Frontend
```typescript
vi.mock('@/hooks/useBoardWebSocket', () => ({
  useBoardWebSocket: () => ({
    send: vi.fn(),
    isConnected: true,
    users: [],
    cursors: new Map(),
  })
}))
```

---

## Edge Cases

### Cards
- Пустой text ( пробелы)
- max_votes = 0
- Одновременный like (race condition)

### Boards
- Duplicate slug
- Soft deleted board

### Action Items
- Carry forward с пустым result
- Invalid status transition

---

## Coverage Goals

- Backend: 80%+ critical paths
- Frontend: 70%+ business logic

---

## AI Title Generation Tests (2026-03-31)

Добавлены 5 тестов для endpoint `/generate-title`:

```python
class TestGenerateTitle:
    test_generate_title_success  # Мок AI, проверка ответа
    test_generate_title_fallback_on_error  # Exception → fallback с обрезкой до 50 символов
    test_generate_title_empty_text  # 422 при пустом тексте
    test_generate_title_long_text  # 422 при тексте >2000 символов
    test_generate_title_requires_auth  # 401 без токена
```

**Все тесты прошли:** 170 backend + 75 frontend тестов
