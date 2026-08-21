"""Tests for AI auto-clustering feature.

Unit tests for parse_clustering_response and integration tests for
POST /api/groups/auto-cluster endpoint.
"""

import json
from unittest.mock import patch

import pytest

from app.config import settings


# ---------------------------------------------------------------------------
# Unit tests for parse_clustering_response
# ---------------------------------------------------------------------------


class TestParseClusteringResponse:
    """Unit tests for app.ai.clustering.parse_clustering_response."""

    def _parse(self, response: str, valid_ids: set):
        from app.ai.clustering import parse_clustering_response
        return parse_clustering_response(response, valid_ids)

    def test_valid_json_multiple_groups(self):
        """Valid JSON with multiple groups → correct parsing."""
        valid_ids = {"c1", "c2", "c3", "c4"}
        response = json.dumps({
            "groups": [
                {"title": "Group A", "card_ids": ["c1", "c2"]},
                {"title": "Group B", "card_ids": ["c3", "c4"]},
            ],
            "ungrouped": [],
        })
        result = self._parse(response, valid_ids)
        assert len(result["groups"]) == 2
        assert result["groups"][0]["title"] == "Group A"
        assert result["groups"][0]["card_ids"] == ["c1", "c2"]
        assert result["groups"][1]["title"] == "Group B"
        assert result["groups"][1]["card_ids"] == ["c3", "c4"]
        assert result["ungrouped"] == []

    def test_invalid_card_ids_filtered_out(self):
        """Card IDs not in valid set → filtered out; group may become ungrouped."""
        valid_ids = {"c1", "c2"}
        response = json.dumps({
            "groups": [
                {"title": "Group A", "card_ids": ["c1", "c2", "INVALID"]},
            ],
            "ungrouped": [],
        })
        result = self._parse(response, valid_ids)
        # Group should still exist with only valid IDs
        assert len(result["groups"]) == 1
        assert "INVALID" not in result["groups"][0]["card_ids"]
        assert set(result["groups"][0]["card_ids"]) == {"c1", "c2"}

    def test_group_with_less_than_2_cards_moved_to_ungrouped(self):
        """Group with < 2 cards → cards moved to ungrouped."""
        valid_ids = {"c1", "c2", "c3"}
        response = json.dumps({
            "groups": [
                # Only one card → too small, should be dissolved
                {"title": "Solo", "card_ids": ["c1"]},
                {"title": "Pair", "card_ids": ["c2", "c3"]},
            ],
            "ungrouped": [],
        })
        result = self._parse(response, valid_ids)
        # Solo group should not appear
        assert all(g["title"] != "Solo" for g in result["groups"])
        # c1 must be ungrouped
        assert "c1" in result["ungrouped"]
        # Pair group should still exist
        assert len(result["groups"]) == 1
        assert result["groups"][0]["title"] == "Pair"

    def test_duplicate_card_first_group_wins(self):
        """Duplicate card in multiple groups → first group wins."""
        valid_ids = {"c1", "c2", "c3", "c4"}
        response = json.dumps({
            "groups": [
                {"title": "First", "card_ids": ["c1", "c2"]},
                # c1 appears again — should be ignored here
                {"title": "Second", "card_ids": ["c1", "c3", "c4"]},
            ],
            "ungrouped": [],
        })
        result = self._parse(response, valid_ids)
        first_group = next(g for g in result["groups"] if g["title"] == "First")
        assert "c1" in first_group["card_ids"]
        second_group = next(g for g in result["groups"] if g["title"] == "Second")
        assert "c1" not in second_group["card_ids"]
        # c3 and c4 should be in Second (still 2 cards so group survives)
        assert "c3" in second_group["card_ids"]
        assert "c4" in second_group["card_ids"]

    def test_invalid_json_returns_empty_result(self):
        """Invalid JSON → empty result (no groups, all cards ungrouped)."""
        valid_ids = {"c1", "c2", "c3"}
        result = self._parse("this is not json at all!!!", valid_ids)
        assert result["groups"] == []
        assert set(result["ungrouped"]) == valid_ids

    def test_markdown_wrapped_json_parsed_correctly(self):
        """Markdown-wrapped JSON (```json ... ```) → properly stripped and parsed."""
        valid_ids = {"c1", "c2", "c3"}
        payload = json.dumps({
            "groups": [
                {"title": "Main", "card_ids": ["c1", "c2"]},
            ],
            "ungrouped": ["c3"],
        })
        response = f"```json\n{payload}\n```"
        result = self._parse(response, valid_ids)
        assert len(result["groups"]) == 1
        assert result["groups"][0]["title"] == "Main"
        assert "c3" in result["ungrouped"]

    def test_markdown_wrapped_no_language_tag(self):
        """Markdown code fence without language tag also stripped."""
        valid_ids = {"c1", "c2"}
        payload = json.dumps({
            "groups": [{"title": "G", "card_ids": ["c1", "c2"]}],
            "ungrouped": [],
        })
        response = f"```\n{payload}\n```"
        result = self._parse(response, valid_ids)
        assert len(result["groups"]) == 1

    def test_all_cards_ungrouped_when_no_valid_groups(self):
        """When all groups dissolve (< 2 cards each), all cards go to ungrouped."""
        valid_ids = {"c1", "c2"}
        response = json.dumps({
            "groups": [
                {"title": "Solo1", "card_ids": ["c1"]},
                {"title": "Solo2", "card_ids": ["c2"]},
            ],
            "ungrouped": [],
        })
        result = self._parse(response, valid_ids)
        assert result["groups"] == []
        assert set(result["ungrouped"]) == {"c1", "c2"}


# ---------------------------------------------------------------------------
# Integration tests for POST /api/groups/auto-cluster
# ---------------------------------------------------------------------------


class TestAutoCluster:
    """Integration tests for POST /api/groups/auto-cluster endpoint."""

    def _create_cards(self, client, column_id: str, texts: list[str], workspace_headers: dict) -> list[dict]:
        """Helper: create multiple cards in a column."""
        cards = []
        for text in texts:
            resp = client.post(
                "/api/cards/",
                json={"column_id": column_id, "text": text, "author": "Tester"},
                headers=workspace_headers,
            )
            assert resp.status_code == 201, resp.text
            cards.append(resp.json())
        return cards

    def test_success_creates_groups_and_updates_cards(
        self, client, sample_column, workspace_headers
    ):
        """Success case: mock AI response, verify groups created in DB, cards updated."""
        cards = self._create_cards(
            client, sample_column["id"],
            ["CI/CD pipeline broke", "Deploy failed", "Good teamwork"],
            workspace_headers,
        )
        card_ids = [c["id"] for c in cards]

        ai_response = json.dumps({
            "groups": [
                {"title": "Deploy Issues", "card_ids": [card_ids[0], card_ids[1]]},
            ],
            "ungrouped": [card_ids[2]],
        })

        with patch("app.ai.clustering.ai_client") as mock_ai, \
             patch.object(settings, "ai_base_url", "http://llm.test/v1"):
            mock_ai.generate.return_value = ai_response

            resp = client.post(
                "/api/groups/auto-cluster",
                json={"column_id": sample_column["id"]},
                headers=workspace_headers,
            )

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert len(data["created_groups"]) == 1
        assert data["created_groups"][0]["group"]["title"] == "Deploy Issues"
        assert set(data["created_groups"][0]["card_ids"]) == {card_ids[0], card_ids[1]}
        assert card_ids[2] in data["ungrouped_card_ids"]

    def test_column_with_less_than_2_ungrouped_cards_returns_400(
        self, client, sample_column, workspace_headers
    ):
        """Column with < 2 ungrouped cards → 400."""
        self._create_cards(
            client, sample_column["id"], ["Only card"], workspace_headers
        )

        with patch.object(settings, "ai_base_url", "http://llm.test/v1"):
            resp = client.post(
                "/api/groups/auto-cluster",
                json={"column_id": sample_column["id"]},
                headers=workspace_headers,
            )
        assert resp.status_code == 400

    def test_column_with_zero_ungrouped_cards_returns_400(
        self, client, sample_column, workspace_headers
    ):
        """Column with no ungrouped cards → 400."""
        with patch.object(settings, "ai_base_url", "http://llm.test/v1"):
            resp = client.post(
                "/api/groups/auto-cluster",
                json={"column_id": sample_column["id"]},
                headers=workspace_headers,
            )
        assert resp.status_code == 400

    def test_column_not_found_returns_404(self, client, workspace_headers):
        """Column not found → 404."""
        with patch.object(settings, "ai_base_url", "http://llm.test/v1"):
            resp = client.post(
                "/api/groups/auto-cluster",
                json={"column_id": "nonexistent-column-id"},
                headers=workspace_headers,
            )
        assert resp.status_code == 404

    def test_column_belongs_to_different_workspace_returns_404(
        self, client, db_session, workspace_headers
    ):
        """Column belongs to different workspace → 404."""
        import bcrypt
        from app.models import Workspace, Board, Column

        # Create another workspace with its own board and column
        other_ws = Workspace(
            id="other-ws-id",
            slug="other-ws",
            name="Other Workspace",
            access_key_hash=bcrypt.hashpw(b"otherkey", bcrypt.gensalt(rounds=4)).decode(),
        )
        db_session.add(other_ws)
        db_session.flush()

        other_board = Board(
            id="other-board-id",
            name="Other Board",
            slug="other-board",
            workspace_id="other-ws-id",
        )
        db_session.add(other_board)
        db_session.flush()

        other_col = Column(
            id="other-col-id",
            board_id="other-board-id",
            title="Other Column",
            position=0,
            color="#FFFFFF",
        )
        db_session.add(other_col)
        db_session.commit()

        with patch.object(settings, "ai_base_url", "http://llm.test/v1"):
            resp = client.post(
                "/api/groups/auto-cluster",
                json={"column_id": "other-col-id"},
                headers=workspace_headers,
            )
        assert resp.status_code == 404

    def test_already_grouped_cards_are_skipped(
        self, client, sample_column, sample_group, workspace_headers
    ):
        """Cards already in groups are skipped; only ungrouped cards sent to AI."""
        # Create 3 cards
        cards = self._create_cards(
            client, sample_column["id"],
            ["Card A", "Card B", "Card C"],
            workspace_headers,
        )
        # Assign first card to the existing group
        client.post(
            f"/api/groups/{sample_group['id']}/set_card/{cards[0]['id']}",
            headers=workspace_headers,
        )

        # Only cards[1] and cards[2] are ungrouped now (2 cards → valid for AI)
        ungrouped_ids = [cards[1]["id"], cards[2]["id"]]

        ai_response = json.dumps({
            "groups": [
                {"title": "New Theme", "card_ids": ungrouped_ids},
            ],
            "ungrouped": [],
        })

        with patch("app.ai.clustering.ai_client") as mock_ai, \
             patch.object(settings, "ai_base_url", "http://llm.test/v1"):
            mock_ai.generate.return_value = ai_response

            resp = client.post(
                "/api/groups/auto-cluster",
                json={"column_id": sample_column["id"]},
                headers=workspace_headers,
            )

        assert resp.status_code == 200, resp.text
        data = resp.json()
        # Verify the AI was called only with ungrouped cards
        call_prompt = mock_ai.generate.call_args[0][0]
        # Grouped card (cards[0]) should NOT appear in the prompt
        assert cards[0]["id"] not in call_prompt
        # Ungrouped cards should appear in the prompt
        assert cards[1]["id"] in call_prompt
        assert cards[2]["id"] in call_prompt

    def test_ai_service_error_returns_503(
        self, client, sample_column, workspace_headers
    ):
        """AI service error → 503."""
        self._create_cards(
            client, sample_column["id"],
            ["Card X", "Card Y"],
            workspace_headers,
        )

        with patch("app.ai.clustering.ai_client") as mock_ai, \
             patch.object(settings, "ai_base_url", "http://llm.test/v1"):
            mock_ai.generate.side_effect = RuntimeError("Connection timeout")

            resp = client.post(
                "/api/groups/auto-cluster",
                json={"column_id": sample_column["id"]},
                headers=workspace_headers,
            )

        assert resp.status_code == 503

    def test_ai_not_configured_returns_503(self, client, sample_column, workspace_headers):
        """AI_BASE_URL not configured → 503."""
        with patch.object(settings, "ai_base_url", ""):
            resp = client.post(
                "/api/groups/auto-cluster",
                json={"column_id": sample_column["id"]},
                headers=workspace_headers,
            )
        assert resp.status_code == 503

    def test_response_schema_structure(
        self, client, sample_column, workspace_headers
    ):
        """Verify the response matches AutoClusterResult schema."""
        cards = self._create_cards(
            client, sample_column["id"],
            ["Team is great", "Good collaboration", "Slow deploys"],
            workspace_headers,
        )
        card_ids = [c["id"] for c in cards]

        ai_response = json.dumps({
            "groups": [
                {"title": "Team Spirit", "card_ids": [card_ids[0], card_ids[1]]},
            ],
            "ungrouped": [card_ids[2]],
        })

        with patch("app.ai.clustering.ai_client") as mock_ai, \
             patch.object(settings, "ai_base_url", "http://llm.test/v1"):
            mock_ai.generate.return_value = ai_response

            resp = client.post(
                "/api/groups/auto-cluster",
                json={"column_id": sample_column["id"]},
                headers=workspace_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "created_groups" in data
        assert "ungrouped_card_ids" in data
        assert isinstance(data["created_groups"], list)
        assert isinstance(data["ungrouped_card_ids"], list)
        # Each created group has group and card_ids
        for cg in data["created_groups"]:
            assert "group" in cg
            assert "card_ids" in cg
            assert "id" in cg["group"]
            assert "title" in cg["group"]
            assert "column_id" in cg["group"]

    def test_cards_group_id_updated_in_db(
        self, client, sample_column, workspace_headers
    ):
        """After clustering, cards in a group should have their group_id updated."""
        cards = self._create_cards(
            client, sample_column["id"],
            ["Improve CI", "Faster builds"],
            workspace_headers,
        )
        card_ids = [c["id"] for c in cards]

        ai_response = json.dumps({
            "groups": [
                {"title": "CI Improvements", "card_ids": card_ids},
            ],
            "ungrouped": [],
        })

        with patch("app.ai.clustering.ai_client") as mock_ai, \
             patch.object(settings, "ai_base_url", "http://llm.test/v1"):
            mock_ai.generate.return_value = ai_response

            resp = client.post(
                "/api/groups/auto-cluster",
                json={"column_id": sample_column["id"]},
                headers=workspace_headers,
            )

        assert resp.status_code == 200
        group_id = resp.json()["created_groups"][0]["group"]["id"]

        # Verify cards now belong to the created group (fetch via board)
        board_resp = client.get(
            f"/api/boards/{sample_column['board_id']}", headers=workspace_headers
        )
        col_data = next(
            c for c in board_resp.json()["columns"]
            if c["id"] == sample_column["id"]
        )
        updated_cards = {c["id"]: c for c in col_data["cards"]}
        for cid in card_ids:
            assert updated_cards[cid]["group_id"] == group_id
