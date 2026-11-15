"""Tests for /api/boards/ endpoints."""


class TestCreateBoard:
    def test_returns_201_with_default_columns(self, client, workspace_headers):
        resp = client.post(
            "/api/boards/", json={"name": "Sprint 42 Retro"}, headers=workspace_headers
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Sprint 42 Retro"
        assert data["slug"] == "sprint-42-retro"
        assert len(data["columns"]) == 3

    def test_default_columns_have_correct_titles(self, client, workspace_headers):
        resp = client.post(
            "/api/boards/", json={"name": "My Board"}, headers=workspace_headers
        )
        titles = [c["title"] for c in resp.json()["columns"]]
        assert "😊 Что хорошо" in titles
        assert "😟 Что улучшить" in titles
        assert "💡 Идеи" in titles

    def test_duplicate_name_returns_409(self, client, workspace_headers, sample_board):
        resp = client.post(
            "/api/boards/",
            json={"name": sample_board["name"]},
            headers=workspace_headers,
        )
        assert resp.status_code == 409


class TestListBoards:
    def test_returns_list(self, client, workspace_headers, sample_board):
        resp = client.get("/api/boards/", headers=workspace_headers)
        assert resp.status_code == 200
        boards = resp.json()
        assert isinstance(boards, list)
        assert len(boards) >= 1
        assert any(b["id"] == sample_board["id"] for b in boards)

    def test_empty_when_no_boards(self, client, workspace_headers):
        resp = client.get("/api/boards/", headers=workspace_headers)
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetBoard:
    def test_by_id(self, client, workspace_headers, sample_board):
        resp = client.get(
            f"/api/boards/{sample_board['id']}", headers=workspace_headers
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == sample_board["id"]
        assert "columns" in resp.json()

    def test_by_slug(self, client, workspace_headers, sample_board):
        resp = client.get(
            f"/api/boards/by-slug/{sample_board['slug']}", headers=workspace_headers
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == sample_board["id"]

    def test_not_found_returns_404(self, client, workspace_headers):
        resp = client.get("/api/boards/nonexistent-id", headers=workspace_headers)
        assert resp.status_code == 404

    def test_slug_not_found_returns_404(self, client, workspace_headers):
        resp = client.get("/api/boards/by-slug/no-such-slug", headers=workspace_headers)
        assert resp.status_code == 404

    def test_id_and_slug_collision_uses_strict_rest_lookup(
        self, client, workspace_headers
    ):
        board_a = client.post(
            "/api/boards/", json={"name": "Original Board"}, headers=workspace_headers
        ).json()
        board_b = client.post(
            "/api/boards/", json={"name": board_a["id"]}, headers=workspace_headers
        ).json()
        assert board_b["slug"] == board_a["id"]
        assert board_b["id"] != board_a["id"]

        by_id = client.get(f"/api/boards/{board_a['id']}", headers=workspace_headers)
        assert by_id.status_code == 200
        assert by_id.json()["id"] == board_a["id"]

        by_slug = client.get(
            f"/api/boards/by-slug/{board_a['id']}", headers=workspace_headers
        )
        assert by_slug.status_code == 200
        assert by_slug.json()["id"] == board_b["id"]


class TestBoardMaxVotes:
    def test_default_max_votes(self, client, workspace_headers):
        resp = client.post(
            "/api/boards/", json={"name": "Votes Board"}, headers=workspace_headers
        )
        assert resp.status_code == 201
        assert resp.json()["max_votes"] == 5

    def test_custom_max_votes(self, client, workspace_headers):
        resp = client.post(
            "/api/boards/",
            json={"name": "Custom Votes", "max_votes": 10},
            headers=workspace_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["max_votes"] == 10

    def test_update_max_votes(self, client, workspace_headers, sample_board):
        resp = client.patch(
            f"/api/boards/{sample_board['id']}",
            json={"max_votes": 3},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["max_votes"] == 3

    def test_max_votes_in_list(self, client, workspace_headers, sample_board):
        resp = client.get("/api/boards/", headers=workspace_headers)
        boards = resp.json()
        assert all("max_votes" in b for b in boards)


class TestUpdateBoard:
    def test_rename(self, client, workspace_headers, sample_board):
        resp = client.patch(
            f"/api/boards/{sample_board['id']}",
            json={"name": "Renamed Board"},
            headers=workspace_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Renamed Board"
        # Адрес доски при переименовании не меняется: разосланные ссылки продолжают работать
        assert data["slug"] == sample_board["slug"]
        by_old_slug = client.get(
            f"/api/boards/by-slug/{sample_board['slug']}", headers=workspace_headers
        )
        assert by_old_slug.status_code == 200
        assert by_old_slug.json()["id"] == sample_board["id"]

    def test_rename_to_existing_name_returns_409(
        self, client, workspace_headers, sample_board
    ):
        client.post(
            "/api/boards/", json={"name": "Other Board"}, headers=workspace_headers
        )
        resp = client.patch(
            f"/api/boards/{sample_board['id']}",
            json={"name": "Other Board"},
            headers=workspace_headers,
        )
        assert resp.status_code == 409

    def test_not_found_returns_404(self, client, workspace_headers):
        resp = client.patch(
            "/api/boards/no-id", json={"name": "X"}, headers=workspace_headers
        )
        assert resp.status_code == 404


class TestDeleteBoard:
    def test_returns_204(self, client, workspace_headers, sample_board):
        resp = client.delete(
            f"/api/boards/{sample_board['id']}", headers=workspace_headers
        )
        assert resp.status_code == 204
        # Board is gone
        assert (
            client.get(
                f"/api/boards/{sample_board['id']}", headers=workspace_headers
            ).status_code
            == 404
        )

    def test_not_found_returns_404(self, client, workspace_headers):
        resp = client.delete("/api/boards/nonexistent", headers=workspace_headers)
        assert resp.status_code == 404


class TestBoardNameValidation:
    def test_create_board_with_html_name_returns_422(self, client, workspace_headers):
        resp = client.post(
            "/api/boards/",
            json={"name": "<script>alert(1)</script>"},
            headers=workspace_headers,
        )
        assert resp.status_code == 422

    def test_update_board_with_html_name_returns_422(
        self, client, workspace_headers, sample_board
    ):
        resp = client.patch(
            f"/api/boards/{sample_board['id']}",
            json={"name": "<b>Bold</b>"},
            headers=workspace_headers,
        )
        assert resp.status_code == 422


class TestSoftDelete:
    def test_delete_board_soft_deletes(self, client, workspace_headers, sample_board):
        resp = client.delete(
            f"/api/boards/{sample_board['id']}", headers=workspace_headers
        )
        assert resp.status_code == 204

        # GET by id returns 404
        assert (
            client.get(
                f"/api/boards/{sample_board['id']}", headers=workspace_headers
            ).status_code
            == 404
        )

        # List does not include deleted board
        boards = client.get("/api/boards/", headers=workspace_headers).json()
        assert not any(b["id"] == sample_board["id"] for b in boards)

    def test_deleted_board_name_can_be_reused(
        self, client, workspace_headers, sample_board
    ):
        name = sample_board["name"]
        client.delete(f"/api/boards/{sample_board['id']}", headers=workspace_headers)

        resp = client.post(
            "/api/boards/", json={"name": name}, headers=workspace_headers
        )
        assert resp.status_code == 201
        assert resp.json()["name"] == name


class TestBoardListActionItemCounts:
    def test_list_includes_action_item_counts(
        self, client, workspace_headers, sample_board
    ):
        # Create 2 items, mark one done
        client.post(
            "/api/action-items/",
            json={
                "board_id": sample_board["id"],
                "text": "Open item",
            },
            headers=workspace_headers,
        )
        done = client.post(
            "/api/action-items/",
            json={
                "board_id": sample_board["id"],
                "text": "Done item",
            },
            headers=workspace_headers,
        ).json()
        client.patch(
            f"/api/action-items/{done['id']}",
            json={"status": "done"},
            headers=workspace_headers,
        )

        resp = client.get("/api/boards/", headers=workspace_headers)
        boards = resp.json()
        board = next(b for b in boards if b["id"] == sample_board["id"])
        assert board["action_items_total"] == 2
        assert board["action_items_open"] == 1

    def test_zero_counts_when_no_items(self, client, workspace_headers, sample_board):
        resp = client.get("/api/boards/", headers=workspace_headers)
        board = next(b for b in resp.json() if b["id"] == sample_board["id"])
        assert board["action_items_total"] == 0
        assert board["action_items_open"] == 0


class TestBoardListHasSummary:
    def test_has_summary_false_when_no_summary(
        self, client, workspace_headers, sample_board
    ):
        """Board without summary should have has_summary=False."""
        resp = client.get("/api/boards/", headers=workspace_headers)
        boards = resp.json()
        board = next(b for b in boards if b["id"] == sample_board["id"])
        assert board["has_summary"] is False

    def test_has_summary_true_when_summary_exists(
        self, db_session, client, workspace_headers, sample_board
    ):
        """Board with summary should have has_summary=True."""
        import uuid

        from app.models import BoardSummary

        summary = BoardSummary(
            id=str(uuid.uuid4()),
            board_id=sample_board["id"],
            session_id=12345,
            summary_text="Test summary",
            key_themes=["Theme 1"],
            recommendations=["Rec 1"],
        )
        db_session.add(summary)
        db_session.commit()

        resp = client.get("/api/boards/", headers=workspace_headers)
        boards = resp.json()
        board = next(b for b in boards if b["id"] == sample_board["id"])
        assert board["has_summary"] is True

    def test_has_summary_reflects_multiple_sessions(
        self, db_session, client, workspace_headers, sample_board
    ):
        """has_summary should be True if ANY summary exists for the board."""
        import uuid

        from app.models import BoardSummary

        for session_id in [100, 200, 300]:
            summary = BoardSummary(
                id=str(uuid.uuid4()),
                board_id=sample_board["id"],
                session_id=session_id,
                summary_text=f"Summary for session {session_id}",
                key_themes=[],
                recommendations=[],
            )
            db_session.add(summary)
        db_session.commit()

        resp = client.get("/api/boards/", headers=workspace_headers)
        boards = resp.json()
        board = next(b for b in boards if b["id"] == sample_board["id"])
        assert board["has_summary"] is True


class TestCardBroadcastActionParity:
    def test_snapshot_matches_card_view_across_modes(self, db_session, test_workspace, monkeypatch):
        import asyncio
        import uuid

        from app import models
        from app.board_view import card_broadcast_action, card_view, cards_hidden
        from app.ws_manager import manager

        board = models.Board(
            id=str(uuid.uuid4()),
            name="Broadcast Parity",
            slug="broadcast-parity",
            workspace_id=test_workspace.id,
        )
        p_human = models.Participant(
            id="p-human",
            workspace_id=test_workspace.id,
            name="Алиса",
        )
        p_agent = models.Participant(
            id="p-agent",
            workspace_id=test_workspace.id,
            name="Ретро-бот",
        )
        p_other = models.Participant(
            id="p-other",
            workspace_id=test_workspace.id,
            name="Боб",
        )
        col = models.Column(id=str(uuid.uuid4()), board_id=board.id, title="Good", position=0)
        human_card = models.Card(
            id=str(uuid.uuid4()),
            column_id=col.id,
            text="Human text",
            author="Алиса",
            author_id=p_human.id,
            author_kind="human",
            color="#FFFFFF",
            likes=[p_human.id, p_other.id],
            position=0,
        )
        agent_card = models.Card(
            id=str(uuid.uuid4()),
            column_id=col.id,
            text="Agent text",
            author="Ретро-бот",
            author_id=p_agent.id,
            author_kind="agent",
            color="#E8F5E9",
            likes=[p_other.id],
            position=1,
        )
        db_session.add_all([board, p_human, p_agent, p_other, col, human_card, agent_card])
        db_session.commit()

        scenarios = [
            {"hide_cards_until_reveal": False, "cards_revealed": False, "anonymous_votes": False},
            {"hide_cards_until_reveal": True, "cards_revealed": False, "anonymous_votes": False},
            {"hide_cards_until_reveal": False, "cards_revealed": False, "anonymous_votes": True},
            {"hide_cards_until_reveal": True, "cards_revealed": True, "anonymous_votes": True},
        ]
        viewers = ["p-human", "p-agent", "p-other", None]

        for flags in scenarios:
            board.hide_cards_until_reveal = flags["hide_cards_until_reveal"]
            board.cards_revealed = flags["cards_revealed"]
            board.anonymous_votes = flags["anonymous_votes"]
            hidden = cards_hidden(board)

            for card in (human_card, agent_card):
                captured_build = None

                async def _fake_broadcast_each(board_id, event, build_fn):
                    nonlocal captured_build
                    assert board_id == board.id
                    captured_build = build_fn

                monkeypatch.setattr(manager, "broadcast_each", _fake_broadcast_each)
                action = card_broadcast_action(board, "card_created", card)
                asyncio.run(action())
                assert captured_build is not None
                for viewer_id in viewers:
                    assert captured_build(viewer_id) == card_view(card, board, viewer_id, hidden)


def test_soft_delete_preserves_name_and_allows_multiple_deletes(
    client, db_session, workspace_headers
):
    """Частичный уникальный индекс сохраняет имя и slug удалённой доски в БД."""
    from app import models

    first = client.post("/api/boards/", json={"name": "Повторный спринт"}, headers=workspace_headers)
    assert first.status_code == 201
    first_id = first.json()["id"]
    first_slug = first.json()["slug"]
    assert client.delete(f"/api/boards/{first_id}", headers=workspace_headers).status_code == 204

    second = client.post("/api/boards/", json={"name": "Повторный спринт"}, headers=workspace_headers)
    assert second.status_code == 201
    second_id = second.json()["id"]
    assert client.delete(f"/api/boards/{second_id}", headers=workspace_headers).status_code == 204

    third = client.post("/api/boards/", json={"name": "Повторный спринт"}, headers=workspace_headers)
    assert third.status_code == 201

    db_session.expire_all()
    row1 = db_session.get(models.Board, first_id)
    row2 = db_session.get(models.Board, second_id)
    assert row1 is not None and row1.name == "Повторный спринт" and row1.slug == first_slug
    assert row2 is not None and row2.name == "Повторный спринт" and row2.deleted_at is not None


def test_rest_boards_and_action_items_pagination_headers(
    client, workspace_headers, sample_board
):
    b2 = client.post("/api/boards/", json={"name": "Board 2"}, headers=workspace_headers).json()
    b3 = client.post("/api/boards/", json={"name": "Board 3"}, headers=workspace_headers).json()

    resp_p1 = client.get("/api/boards/?limit=2&offset=0", headers=workspace_headers)
    assert resp_p1.status_code == 200
    assert resp_p1.headers["X-Total-Count"] == "3"
    assert len(resp_p1.json()) == 2

    resp_p2 = client.get("/api/boards/?limit=2&offset=2", headers=workspace_headers)
    assert resp_p2.status_code == 200
    assert resp_p2.headers["X-Total-Count"] == "3"
    assert len(resp_p2.json()) == 1

    seen_ids = {b["id"] for b in resp_p1.json() + resp_p2.json()}
    assert seen_ids == {sample_board["id"], b2["id"], b3["id"]}

    for idx in range(3):
        assert (
            client.post(
                "/api/action-items/",
                json={"board_id": b2["id"], "text": f"Task {idx}"},
                headers=workspace_headers,
            ).status_code
            == 201
        )
    ai_resp = client.get("/api/action-items/all?limit=2&offset=1", headers=workspace_headers)
    assert ai_resp.status_code == 200
    assert ai_resp.headers["X-Total-Count"] == "3"
    assert len(ai_resp.json()) == 2
