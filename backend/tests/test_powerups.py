"""Tests for dot voting, card bulk/merge ops, AI preview/suggest, and WS typing."""

import json
from unittest.mock import patch

from app.config import settings
from app.ws_manager import manager


def _make_board(client, headers, name="Powerups Board", **extra):
    payload = {"name": name, "max_votes": 4, **extra}
    resp = client.post("/api/boards/", json=payload, headers=headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def _add_card(client, headers, col_id: str, text: str, author: str = "Alice"):
    resp = client.post(
        "/api/cards/",
        json={"column_id": col_id, "text": text, "author": author},
        headers=headers,
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


class TestDotVotingAndReset:
    def test_multi_vote_per_card_respects_max_votes_and_removes_one_by_one(
        self, client, workspace_headers
    ):
        board = _make_board(
            client,
            workspace_headers,
            name="Dot Vote Board",
            allow_multiple_votes_per_card=True,
        )
        assert board["allow_multiple_votes_per_card"] is True
        col_id = board["columns"][0]["id"]
        c1 = _add_card(client, workspace_headers, col_id, "Card One")
        c2 = _add_card(client, workspace_headers, col_id, "Card Two")

        # Put 3 votes on c1
        for expected in (1, 2, 3):
            r = client.post(
                f"/api/cards/{c1['id']}/like?username=Bob&action=add",
                headers=workspace_headers,
            )
            assert r.status_code == 200
            assert r.json()["likes"].count("Bob") == expected

        # Put 1 vote on c2 -> total 4/4 reached
        r4 = client.post(
            f"/api/cards/{c2['id']}/like?username=Bob&action=add",
            headers=workspace_headers,
        )
        assert r4.status_code == 200
        assert r4.json()["likes"].count("Bob") == 1

        # 5th vote fails with 403
        r5 = client.post(
            f"/api/cards/{c1['id']}/like?username=Bob&action=add",
            headers=workspace_headers,
        )
        assert r5.status_code == 403

        # Remove single vote from c1 -> 2 votes remain
        rem = client.post(
            f"/api/cards/{c1['id']}/like?username=Bob&action=remove",
            headers=workspace_headers,
        )
        assert rem.status_code == 200
        assert rem.json()["likes"].count("Bob") == 2

        # Reset all Bob votes across board
        reset = client.post(
            f"/api/boards/{board['id']}/reset-votes?username=Bob",
            headers=workspace_headers,
        )
        assert reset.status_code == 200
        assert reset.json()["updated_cards"] == 2

        full = client.get(f"/api/boards/{board['id']}", headers=workspace_headers).json()
        for col in full["columns"]:
            for card in col["cards"]:
                assert "Bob" not in card["likes"]

    def test_update_board_toggles_allow_multiple_votes_per_card(
        self, client, workspace_headers
    ):
        board = _make_board(client, workspace_headers, name="Toggle Multi")
        assert board["allow_multiple_votes_per_card"] is False
        upd = client.patch(
            f"/api/boards/{board['id']}",
            json={"allow_multiple_votes_per_card": True},
            headers=workspace_headers,
        )
        assert upd.status_code == 200
        assert upd.json()["allow_multiple_votes_per_card"] is True


class TestBulkAndMergeCards:
    def test_bulk_update_group_recolor_move_and_delete(self, client, workspace_headers):
        board = _make_board(client, workspace_headers, name="Bulk Board")
        col0 = board["columns"][0]["id"]
        col1 = board["columns"][1]["id"]
        c1 = _add_card(client, workspace_headers, col0, "First item")
        c2 = _add_card(client, workspace_headers, col0, "Second item")
        c3 = _add_card(client, workspace_headers, col0, "Third item")

        # Group c1 + c2 and recolor
        grp = client.post(
            "/api/cards/bulk-update",
            json={
                "card_ids": [c1["id"], c2["id"]],
                "group_title": "Grouped",
                "color": "#FEF3C7",
            },
            headers=workspace_headers,
        )
        assert grp.status_code == 200, grp.text
        updated = grp.json()
        assert len(updated) == 2
        assert updated[0]["color"] == "#FEF3C7"
        gid = updated[0]["group_id"]
        assert gid is not None and updated[1]["group_id"] == gid

        # Move both cards to col1 -> old group auto-pruned
        mv = client.post(
            "/api/cards/bulk-update",
            json={"card_ids": [c1["id"], c2["id"]], "column_id": col1, "color": "#FFFFFF"},
            headers=workspace_headers,
        )
        assert mv.status_code == 200, mv.text
        for item in mv.json():
            assert item["column_id"] == col1
            assert item["group_id"] is None
            assert item["color"] == "#FFFFFF"

        full = client.get(f"/api/boards/{board['id']}", headers=workspace_headers).json()
        assert full["columns"][0]["groups"] == []
        assert len(full["columns"][1]["cards"]) >= 2

        # Bulk delete c3 + c1
        d = client.post(
            "/api/cards/bulk-delete",
            json={"card_ids": [c3["id"], c1["id"]]},
            headers=workspace_headers,
        )
        assert d.status_code == 200
        assert d.json()["deleted"] == 2

    def test_merge_cards_combines_votes_and_deletes_duplicates(
        self, client, workspace_headers
    ):
        board = _make_board(client, workspace_headers, name="Merge Board")
        col0 = board["columns"][0]["id"]
        c1 = _add_card(client, workspace_headers, col0, "Slow CI builds")
        c2 = _add_card(client, workspace_headers, col0, "Long pipeline runs")
        client.post(f"/api/cards/{c1['id']}/like?username=Alice", headers=workspace_headers)
        client.post(f"/api/cards/{c2['id']}/like?username=Alice", headers=workspace_headers)
        client.post(f"/api/cards/{c2['id']}/like?username=Bob", headers=workspace_headers)

        merged = client.post(
            "/api/cards/merge",
            json={"card_ids": [c1["id"], c2["id"]]},
            headers=workspace_headers,
        )
        assert merged.status_code == 200, merged.text
        data = merged.json()
        assert "Slow CI builds" in data["text"]
        assert "Long pipeline runs" in data["text"]
        # Unique voters preserved when dot voting disabled
        assert data["likes"] == ["Alice", "Bob"]

        full = client.get(f"/api/boards/{board['id']}", headers=workspace_headers).json()
        card_ids = [c["id"] for c in full["columns"][0]["cards"]]
        assert c1["id"] in card_ids
        assert c2["id"] not in card_ids


class TestAIPreviewAndSuggestions:
    def test_auto_cluster_preview_does_not_mutate_db_then_apply_clusters_commits(
        self, client, workspace_headers
    ):
        board = _make_board(client, workspace_headers, name="Preview Cluster Board")
        col0 = board["columns"][0]["id"]
        c1 = _add_card(client, workspace_headers, col0, "Card 1")
        c2 = _add_card(client, workspace_headers, col0, "Card 2")

        ai_resp = json.dumps(
            {
                "groups": [{"title": "Release Speed", "card_ids": [c1["id"], c2["id"]]}],
                "ungrouped": [],
            }
        )
        with patch("app.ai.clustering.ai_client") as mock_ai, patch.object(
            settings, "ai_base_url", "http://llm.test/v1"
        ):
            mock_ai.generate.return_value = ai_resp
            prev = client.post(
                "/api/groups/auto-cluster-preview",
                json={"column_id": col0},
                headers=workspace_headers,
            )
        assert prev.status_code == 200, prev.text
        pdata = prev.json()
        assert len(pdata["groups"]) == 1
        assert pdata["groups"][0]["title"] == "Release Speed"

        # DB untouched after preview
        mid = client.get(f"/api/boards/{board['id']}", headers=workspace_headers).json()
        assert mid["columns"][0]["groups"] == []

        applied = client.post(
            "/api/groups/apply-clusters",
            json={
                "column_id": col0,
                "groups": [{"title": "Edited Theme", "card_ids": [c1["id"], c2["id"]]}],
                "username": "Facilitator",
            },
            headers=workspace_headers,
        )
        assert applied.status_code == 200, applied.text
        adata = applied.json()
        assert len(adata["created_groups"]) == 1
        assert adata["created_groups"][0]["group"]["title"] == "Edited Theme"

    def test_suggest_action_items_filters_unknown_card_ids_and_requires_ai(
        self, client, workspace_headers
    ):
        board = _make_board(client, workspace_headers, name="Suggest Board")
        col0 = board["columns"][0]["id"]
        c1 = _add_card(client, workspace_headers, col0, "Flaky tests on CI")

        # 503 when AI not configured
        unconf = client.post(
            "/api/action-items/suggest",
            json={"board_id": board["id"]},
            headers=workspace_headers,
        )
        assert unconf.status_code == 503

        ai_resp = json.dumps(
            {
                "suggestions": [
                    {
                        "title": "Стабилизировать CI",
                        "text": "Вынести нестабильные тесты в отдельный retry-прогон",
                        "assignee_hint": "QA",
                        "source_card_ids": [c1["id"], "nonexistent-id"],
                    }
                ]
            }
        )
        with patch("app.ai.prompts.action_item_suggestions.ai_client") as mock_ai, patch.object(
            settings, "ai_base_url", "http://llm.test/v1"
        ):
            mock_ai.generate.return_value = ai_resp
            resp = client.post(
                "/api/action-items/suggest",
                json={"board_id": board["id"]},
                headers=workspace_headers,
            )
        assert resp.status_code == 200, resp.text
        suggestions = resp.json()["suggestions"]
        assert len(suggestions) == 1
        assert suggestions[0]["title"] == "Стабилизировать CI"
        assert suggestions[0]["source_card_ids"] == [c1["id"]]


class TestWebSocketTypingIndicator:
    def test_card_typing_broadcast_and_disconnect_cleanup(
        self, client, ws_board, ws_token
    ):
        board_id = ws_board.id
        col0 = "typing-col-1"

        with client.websocket_connect(
            f"/ws/{board_id}?workspace_token={ws_token}",
            headers={"origin": "http://localhost:3000"},
        ) as ws1, client.websocket_connect(
            f"/ws/{board_id}?workspace_token={ws_token}",
            headers={"origin": "http://localhost:3000"},
        ) as ws2:
            ws1.send_text(json.dumps({"event": "identify", "data": {"username": "Alice"}}))
            ws2.send_text(json.dumps({"event": "identify", "data": {"username": "Bob"}}))

            seen_typing = None
            ws1.send_text(
                json.dumps(
                    {
                        "event": "card_typing",
                        "data": {"column_id": col0, "is_typing": True},
                    }
                )
            )
            for _ in range(15):
                msg = json.loads(ws2.receive_text())
                if msg["event"] == "typing_update":
                    seen_typing = msg["data"]["typing"]
                    if seen_typing:
                        break
            assert seen_typing == [{"username": "Alice", "column_id": col0}]

            # Stop typing clears state
            ws1.send_text(
                json.dumps(
                    {
                        "event": "card_typing",
                        "data": {"column_id": col0, "is_typing": False},
                    }
                )
            )
            cleared = None
            for _ in range(10):
                msg = json.loads(ws2.receive_text())
                if msg["event"] == "typing_update":
                    cleared = msg["data"]["typing"]
                    break
            assert cleared == []
        assert manager.get_typing(board_id) == []
