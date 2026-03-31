"""Tests for board summary endpoints."""

import pytest
from unittest.mock import patch, MagicMock


class TestBoardSummary:
    """Tests for board summary retrieval."""

    def test_get_summary_not_found(self, client, sample_board, workspace_headers):
        """Test getting summary when none exists."""
        resp = client.get(
            f"/api/boards/{sample_board['id']}/summary",
            headers=workspace_headers,
        )
        assert resp.status_code == 404

    def test_get_summary_after_generation(
        self, db_session, client, sample_board, workspace_headers
    ):
        """Test getting summary after it was created directly in DB."""
        from app.models import BoardSummary
        import uuid

        # Create summary directly in DB
        summary = BoardSummary(
            id=str(uuid.uuid4()),
            board_id=sample_board["id"],
            session_id=12345,
            summary_text="Retrospective went well",
            key_themes=["Communication", "Process"],
            recommendations=["Daily standups", "Better docs"],
        )
        db_session.add(summary)
        db_session.commit()

        # Now get the summary
        resp = client.get(
            f"/api/boards/{sample_board['id']}/summary",
            headers=workspace_headers,
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["summary_text"] == "Retrospective went well"
        assert data["board_id"] == sample_board["id"]
        assert data["key_themes"] == ["Communication", "Process"]


class TestSummaryWSIntegration:
    """Tests for summary WebSocket integration."""

    def test_summary_phase_in_valid_phases(self, client, ws_board, ws_token):
        """Test that summary is a valid phase that can be set."""
        from app.routers.websocket import VALID_PHASES

        assert "summary" in VALID_PHASES

    def test_summary_event_in_known_events(self, client, ws_board, ws_token):
        """Test that summary_generated is a known WebSocket event."""
        from app.routers.websocket import KNOWN_EVENTS

        assert "summary_generated" in KNOWN_EVENTS


class TestSummaryModel:
    """Tests for BoardSummary model."""

    def test_summary_creation(self, db_session, sample_board):
        """Test creating a summary directly in the database."""
        from app.models import BoardSummary
        import uuid

        summary = BoardSummary(
            id=str(uuid.uuid4()),
            board_id=sample_board["id"],
            session_id=12345,
            summary_text="Test summary text",
            key_themes=["Theme 1", "Theme 2"],
            recommendations=["Rec 1"],
        )
        db_session.add(summary)
        db_session.commit()
        db_session.refresh(summary)

        assert summary.id is not None
        assert summary.board_id == sample_board["id"]
        assert summary.session_id == 12345
        assert summary.summary_text == "Test summary text"
        assert summary.key_themes == ["Theme 1", "Theme 2"]
        assert summary.recommendations == ["Rec 1"]
        assert summary.created_at is not None

    def test_summary_board_relationship(self, db_session, sample_board):
        """Test relationship between Board and BoardSummary."""
        from app.models import BoardSummary
        import uuid

        summary = BoardSummary(
            id=str(uuid.uuid4()),
            board_id=sample_board["id"],
            session_id=12345,
            summary_text="Test",
            key_themes=[],
            recommendations=[],
        )
        db_session.add(summary)
        db_session.commit()

        # Query board and check summaries
        from app.models import Board

        board = db_session.query(Board).filter(Board.id == sample_board["id"]).first()
        assert len(board.summaries) >= 1
        assert board.summaries[0].summary_text == "Test"
