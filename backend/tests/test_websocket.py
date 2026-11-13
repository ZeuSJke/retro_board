"""Tests for WebSocket /ws/{board_id} endpoint."""

import json

TEST_ORIGIN = "http://localhost:3000"


def recv_event(ws, target_event: str, max_messages: int = 10):
    """Receive messages until we get one with the target event, skipping others."""
    for _ in range(max_messages):
        msg = ws.receive_json()
        if msg["event"] == target_event:
            return msg
    raise AssertionError(
        f"Did not receive '{target_event}' within {max_messages} messages"
    )


class TestWebSocketConnect:
    def test_connect_and_receive(self, client, ws_token):
        with client.websocket_connect(
            f"/ws/test-board?workspace_token={ws_token}",
            headers={"origin": TEST_ORIGIN},
        ) as ws:
            ws.send_text("ping")


class TestWebSocketCursorMove:
    def test_cursor_broadcast_to_others(self, client, ws_token):
        """cursor_move should be broadcast to other clients, not the sender."""
        url = f"/ws/board-1?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws1:
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws2:
                ws1.send_text(
                    json.dumps(
                        {
                            "event": "cursor_move",
                            "data": {"username": "Alice", "x": 100, "y": 200},
                        }
                    )
                )

                msg = recv_event(ws2, "cursor_move")
                assert msg["data"]["username"] == "Alice"
                assert msg["data"]["x"] == 100


class TestWebSocketCursorLeave:
    def test_cursor_leave_on_disconnect(self, client, ws_token):
        """When a client disconnects, cursor_leave is broadcast for their username."""
        url = f"/ws/board-2?workspace_token={ws_token}"
        with client.websocket_connect(
            url, headers={"origin": TEST_ORIGIN}
        ) as ws_listener:
            with client.websocket_connect(
                url, headers={"origin": TEST_ORIGIN}
            ) as ws_leaver:
                ws_leaver.send_text(
                    json.dumps(
                        {
                            "event": "cursor_move",
                            "data": {"username": "Bob", "x": 0, "y": 0},
                        }
                    )
                )
                recv_event(ws_listener, "cursor_move")

            msg = recv_event(ws_listener, "cursor_leave")
            assert msg["data"]["username"] == "Bob"


class TestWebSocketPresence:
    def test_presence_update_on_join(self, client, ws_token):
        """presence_update should be broadcast when a user first sends cursor_move."""
        url = f"/ws/board-presence?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws1:
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws2:
                ws1.send_text(
                    json.dumps(
                        {
                            "event": "cursor_move",
                            "data": {"username": "Alice", "x": 0, "y": 0},
                        }
                    )
                )

                msg = recv_event(ws2, "presence_update")
                assert "Alice" in msg["data"]["users"]

    def test_presence_update_on_leave(self, client, ws_token):
        """presence_update should be broadcast when a user disconnects."""
        url = f"/ws/board-presence2?workspace_token={ws_token}"
        with client.websocket_connect(
            url, headers={"origin": TEST_ORIGIN}
        ) as ws_listener:
            with client.websocket_connect(
                url, headers={"origin": TEST_ORIGIN}
            ) as ws_leaver:
                ws_leaver.send_text(
                    json.dumps(
                        {
                            "event": "cursor_move",
                            "data": {"username": "Charlie", "x": 0, "y": 0},
                        }
                    )
                )
                recv_event(ws_listener, "presence_update")

            msg = recv_event(ws_listener, "presence_update")
            assert "Charlie" not in msg["data"]["users"]


class TestWebSocketFacilitator:
    def test_facilitator_start(self, client, ws_token):
        """facilitator_start should set facilitator and broadcast."""
        url = f"/ws/board-fac?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws1:
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws2:
                ws1.send_text(
                    json.dumps(
                        {
                            "event": "cursor_move",
                            "data": {"username": "Facilitator", "x": 0, "y": 0},
                        }
                    )
                )
                recv_event(ws2, "cursor_move")

                ws1.send_text(
                    json.dumps(
                        {
                            "event": "facilitator_start",
                            "data": {},
                        }
                    )
                )

                msg = recv_event(ws2, "facilitator_update")
                assert msg["data"]["facilitator"] == "Facilitator"
                assert msg["data"]["phase"] == "brainstorm"

    def test_facilitator_stop(self, client, ws_token):
        """facilitator_stop should clear facilitator and broadcast."""
        url = f"/ws/board-fac2?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws1:
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws2:
                ws1.send_text(
                    json.dumps(
                        {
                            "event": "cursor_move",
                            "data": {"username": "Leader", "x": 0, "y": 0},
                        }
                    )
                )
                recv_event(ws2, "cursor_move")

                ws1.send_text(json.dumps({"event": "facilitator_start", "data": {}}))
                recv_event(ws2, "facilitator_update")

                ws1.send_text(json.dumps({"event": "facilitator_stop", "data": {}}))
                msg = recv_event(ws2, "facilitator_update")
                assert msg["data"]["facilitator"] is None
                assert msg["data"]["phase"] is None

    def test_phase_change(self, client, ws_token):
        """phase_change should update phase and broadcast."""
        url = f"/ws/board-fac3?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws1:
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws2:
                ws1.send_text(
                    json.dumps(
                        {
                            "event": "cursor_move",
                            "data": {"username": "Boss", "x": 0, "y": 0},
                        }
                    )
                )
                recv_event(ws2, "cursor_move")

                ws1.send_text(json.dumps({"event": "facilitator_start", "data": {}}))
                recv_event(ws2, "facilitator_update")

                ws1.send_text(
                    json.dumps(
                        {
                            "event": "phase_change",
                            "data": {"phase": "vote"},
                        }
                    )
                )
                msg = recv_event(ws2, "phase_update")
                assert msg["data"]["phase"] == "vote"


class TestWebSocketTimerEvents:
    def test_timer_start_broadcast(self, client, ws_token):
        url = f"/ws/board-t?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws1:
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws2:
                ws1.send_text(
                    json.dumps(
                        {
                            "event": "timer_start",
                            "data": {"duration": 300, "remaining": 300, "ts": 0},
                        }
                    )
                )

                msg1 = recv_event(ws1, "timer_start")
                msg2 = recv_event(ws2, "timer_start")
                assert msg1["event"] == "timer_start"
                assert msg2["event"] == "timer_start"

    def test_timer_pause_broadcast(self, client, ws_token):
        url = f"/ws/board-tp?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws1:
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws2:
                ws1.send_text(
                    json.dumps(
                        {
                            "event": "timer_pause",
                            "data": {"remaining": 120},
                        }
                    )
                )

                msg1 = recv_event(ws1, "timer_pause")
                msg2 = recv_event(ws2, "timer_pause")
                assert msg1["event"] == "timer_pause"
                assert msg2["event"] == "timer_pause"
                assert msg2["data"]["remaining"] == 120

    def test_timer_reset_broadcast(self, client, ws_token):
        url = f"/ws/board-tr?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws:
            ws.send_text(
                json.dumps(
                    {
                        "event": "timer_reset",
                        "data": {"duration": 600},
                    }
                )
            )

            msg = recv_event(ws, "timer_reset")
            assert msg["event"] == "timer_reset"
            assert msg["data"]["duration"] == 600


class TestWebSocketTimerSync:
    """Timer state should be sent to newly connected clients."""

    def test_running_timer_sent_on_connect(self, client, ws_token):
        """A client connecting while the timer is running should receive timer_start."""
        url = f"/ws/board-tsync1?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws1:
            ws1.send_text(
                json.dumps(
                    {
                        "event": "timer_start",
                        "data": {"duration": 300, "remaining": 300, "ts": 1000000},
                    }
                )
            )
            recv_event(ws1, "timer_start")

            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws2:
                msg = recv_event(ws2, "timer_start")
                assert msg["data"]["duration"] == 300
                assert msg["data"]["remaining"] <= 300

    def test_paused_timer_sent_on_connect(self, client, ws_token):
        """A client connecting while the timer is paused should receive timer_pause."""
        url = f"/ws/board-tsync2?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws1:
            ws1.send_text(
                json.dumps(
                    {
                        "event": "timer_start",
                        "data": {"duration": 600, "remaining": 600, "ts": 1000000},
                    }
                )
            )
            recv_event(ws1, "timer_start")

            ws1.send_text(
                json.dumps(
                    {
                        "event": "timer_pause",
                        "data": {"remaining": 450},
                    }
                )
            )
            recv_event(ws1, "timer_pause")

            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws2:
                msg = recv_event(ws2, "timer_pause")
                assert msg["data"]["remaining"] == 450
                assert msg["data"]["duration"] == 600

    def test_reset_timer_not_sent_on_connect(self, client, ws_token):
        """After reset to 0 remaining, no timer state should be sent to new clients."""
        url = f"/ws/board-tsync3?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws1:
            ws1.send_text(
                json.dumps(
                    {
                        "event": "timer_reset",
                        "data": {"duration": 300},
                    }
                )
            )
            recv_event(ws1, "timer_reset")

            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws2:
                fac_msg = ws2.receive_json()
                assert fac_msg["event"] == "facilitator_update"
                ws2.send_text("ping")


class TestWebSocketGroupCollapse:
    def test_group_collapse_broadcast_to_all(self, client, ws_token):
        url = f"/ws/board-gc?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws1:
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws2:
                ws1.send_text(
                    json.dumps(
                        {
                            "event": "group_collapse",
                            "data": {"group_id": "g1", "collapsed": True},
                        }
                    )
                )

                msg1 = recv_event(ws1, "group_collapse")
                msg2 = recv_event(ws2, "group_collapse")
                assert msg1["event"] == "group_collapse"
                assert msg2["event"] == "group_collapse"
                assert msg2["data"]["collapsed"] is True


class TestWebSocketOriginValidation:
    """Origin header should be validated against CORS_ORIGINS setting."""

    def test_invalid_origin_rejected(self, client, ws_token):
        """Connecting with an origin not in cors_origins should close with 1008."""
        try:
            with client.websocket_connect(
                f"/ws/board-origin1?workspace_token={ws_token}",
                headers={"origin": "http://evil.example.com"},
            ) as ws:
                pytest.fail("Expected WebSocket to be closed with 1008")
        except Exception:
            pass

    def test_valid_origin_accepted(self, client, ws_token):
        """Connecting with a valid origin (from CORS_ORIGINS) should succeed."""
        with client.websocket_connect(
            f"/ws/board-origin2?workspace_token={ws_token}",
            headers={"origin": TEST_ORIGIN},
        ) as ws:
            ws.send_text("ping")

    def test_no_origin_rejected(self, client, ws_token):
        """Connecting without an Origin header should be rejected for security."""
        try:
            with client.websocket_connect(f"/ws/board-origin3?workspace_token={ws_token}") as ws:
                ws.send_text("ping")
                pytest.fail("Expected WebSocket to be closed when no origin provided")
        except Exception:
            pass


class TestWebSocketTimerRequiresFacilitator:
    """Timer events should only be accepted from the facilitator when a session is active."""

    def test_non_facilitator_timer_ignored(self, client, ws_token):
        """When facilitator is active, non-facilitator timer_start should be ignored."""
        url = f"/ws/board-tfac1?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws_fac:
            with client.websocket_connect(
                url, headers={"origin": TEST_ORIGIN}
            ) as ws_other:
                ws_fac.send_text(
                    json.dumps(
                        {
                            "event": "cursor_move",
                            "data": {"username": "Facilitator", "x": 0, "y": 0},
                        }
                    )
                )
                recv_event(ws_other, "cursor_move")

                ws_other.send_text(
                    json.dumps(
                        {
                            "event": "cursor_move",
                            "data": {"username": "Regular", "x": 0, "y": 0},
                        }
                    )
                )
                recv_event(ws_fac, "cursor_move")

                ws_fac.send_text(
                    json.dumps(
                        {
                            "event": "facilitator_start",
                            "data": {},
                        }
                    )
                )
                recv_event(ws_other, "facilitator_update")

                ws_other.send_text(
                    json.dumps(
                        {
                            "event": "timer_start",
                            "data": {"duration": 300, "remaining": 300, "ts": 0},
                        }
                    )
                )

                ws_fac.send_text(
                    json.dumps(
                        {
                            "event": "cursor_move",
                            "data": {"username": "Facilitator", "x": 50, "y": 50},
                        }
                    )
                )

                msg = ws_other.receive_json()
                assert msg["event"] == "cursor_move", (
                    f"Expected cursor_move sentinel, got {msg['event']} — "
                    "timer event was not ignored"
                )

    def test_no_facilitator_anyone_can_send_timer(self, client, ws_token):
        """When no facilitator is active, anyone can send timer events."""
        url = f"/ws/board-tfac2?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws1:
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws2:
                ws1.send_text(
                    json.dumps(
                        {
                            "event": "timer_start",
                            "data": {"duration": 300, "remaining": 300, "ts": 0},
                        }
                    )
                )

                msg1 = recv_event(ws1, "timer_start")
                msg2 = recv_event(ws2, "timer_start")
                assert msg1["event"] == "timer_start"
                assert msg2["event"] == "timer_start"


class TestWebSocketBugfixes:
    """Tests for real-time bugfixes: unconditional facilitator_update, grace period, /ws/workspace, summary_failed."""

    def test_facilitator_update_sent_unconditionally_on_connect(self, client, ws_token):
        url = f"/ws/board-fac-init?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws:
            msg = ws.receive_json()
            assert msg["event"] == "facilitator_update"
            assert msg["data"]["facilitator"] is None
            assert msg["data"]["phase"] is None

    def test_deleted_board_ws_rejected(self, client, ws_token, ws_board, db_session, monkeypatch):
        from datetime import datetime, timezone
        from types import SimpleNamespace
        from app.routers import websocket as ws_router

        ws_board.deleted_at = datetime.now(timezone.utc)
        db_session.commit()

        snapshot = SimpleNamespace(
            id=ws_board.id,
            workspace_id=ws_board.workspace_id,
            deleted_at=ws_board.deleted_at,
        )

        class _FakeDB:
            def get(self, model, key):
                return snapshot if key == ws_board.id else None

        def _fake_get_db():
            yield _FakeDB()

        monkeypatch.setattr(ws_router, "get_db", _fake_get_db)

        url = f"/ws/{ws_board.id}?workspace_token={ws_token}"
        rejected_code = None
        try:
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}):
                pass
        except Exception as exc:
            rejected_code = getattr(exc, "code", None)
        assert rejected_code == 1008

    def test_workspace_ws_receives_board_events(self, client, ws_token):
        ws_headers = {"X-Workspace-Token": ws_token}
        ws_url = f"/ws/workspace?workspace_token={ws_token}"
        with client.websocket_connect(ws_url, headers={"origin": TEST_ORIGIN}) as ws:
            # Create board
            create_resp = client.post(
                "/api/boards/",
                json={"name": "WS Live Board"},
                headers=ws_headers,
            )
            assert create_resp.status_code == 201
            board = create_resp.json()
            ev_created = recv_event(ws, "board_created")
            assert ev_created["data"]["id"] == board["id"]
            assert ev_created["data"]["name"] == "WS Live Board"

            # Update board
            upd_resp = client.patch(
                f"/api/boards/{board['id']}",
                json={"name": "WS Live Board Renamed"},
                headers=ws_headers,
            )
            assert upd_resp.status_code == 200
            ev_updated = recv_event(ws, "board_updated")
            assert ev_updated["data"]["id"] == board["id"]
            assert ev_updated["data"]["name"] == "WS Live Board Renamed"

            # Delete board
            del_resp = client.delete(
                f"/api/boards/{board['id']}",
                headers=ws_headers,
            )
            assert del_resp.status_code == 204
            ev_deleted = recv_event(ws, "board_deleted")
            assert ev_deleted["data"]["id"] == board["id"]

    def test_facilitator_grace_period_preserves_session_on_reconnect(self, client, ws_token, monkeypatch):
        from app.ws_manager import manager

        monkeypatch.setattr(manager, "FACILITATOR_GRACE_SECONDS", 0.2)
        url = f"/ws/board-grace?workspace_token={ws_token}"

        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws_other:
            assert ws_other.receive_json()["event"] == "facilitator_update"
            # First facilitator session connects, identifies, starts facilitator
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws_fac:
                assert ws_fac.receive_json()["event"] == "facilitator_update"
                ws_fac.send_text(json.dumps({"event": "identify", "data": {"username": "Alice"}}))
                ws_fac.send_text(json.dumps({"event": "facilitator_start", "data": {}}))
                ev = recv_event(ws_other, "facilitator_update")
                assert ev["data"]["facilitator"] == "Alice"

            # ws_fac disconnected (F5): grace task is scheduled, facilitator still set before expiry
            assert manager.get_facilitator("board-grace") == "Alice"

            # Reconnect quickly as Alice before 0.2s grace expires
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws_fac2:
                fac_ev = recv_event(ws_fac2, "facilitator_update")
                # Initial connect already shows Alice still facilitator
                assert fac_ev["data"]["facilitator"] == "Alice"
                ws_fac2.send_text(json.dumps({"event": "identify", "data": {"username": "Alice"}}))

                import time
                time.sleep(0.25)
                # After original grace window passes, Alice is still facilitator
                assert manager.get_facilitator("board-grace") == "Alice"

    def test_facilitator_grace_period_clears_when_not_reconnected(self, client, ws_token, monkeypatch):
        from app.ws_manager import manager
        import time

        monkeypatch.setattr(manager, "FACILITATOR_GRACE_SECONDS", 0.05)
        url = f"/ws/board-grace-exp?workspace_token={ws_token}"

        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws_other:
            assert ws_other.receive_json()["event"] == "facilitator_update"
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws_fac:
                assert ws_fac.receive_json()["event"] == "facilitator_update"
                ws_fac.send_text(json.dumps({"event": "identify", "data": {"username": "Alice"}}))
                ws_fac.send_text(json.dumps({"event": "facilitator_start", "data": {}}))
                ev_start = recv_event(ws_other, "facilitator_update")
                assert ev_start["data"]["facilitator"] == "Alice"

            # Drain grace reset broadcast on ws_other after >0.05s
            time.sleep(0.1)
            ev_clear = recv_event(ws_other, "facilitator_update")
            assert ev_clear["data"]["facilitator"] is None
            assert manager.get_facilitator("board-grace-exp") is None

    def test_identify_rename_updates_facilitator(self, client, ws_token):
        url = f"/ws/board-rename-fac?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws_fac:
            assert ws_fac.receive_json()["event"] == "facilitator_update"
            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws_other:
                assert ws_other.receive_json()["event"] == "facilitator_update"
                ws_fac.send_text(json.dumps({"event": "identify", "data": {"username": "Bob"}}))
                ws_fac.send_text(json.dumps({"event": "facilitator_start", "data": {}}))
                ev_bob = recv_event(ws_other, "facilitator_update")
                assert ev_bob["data"]["facilitator"] == "Bob"

                ws_fac.send_text(json.dumps({"event": "identify", "data": {"username": "Robert"}}))
                ev = recv_event(ws_other, "facilitator_update")
                assert ev["data"]["facilitator"] == "Robert"

    def test_summary_failed_event_on_generation_error(self, client, ws_token, ws_board, monkeypatch):
        from app.routers import boards as boards_router

        monkeypatch.setattr(
            boards_router, "_generate_summary_internal", lambda *args, **kwargs: None
        )

        url = f"/ws/{ws_board.id}?workspace_token={ws_token}"
        with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws:
            ws.send_text(json.dumps({"event": "identify", "data": {"username": "Fac"}}))
            ws.send_text(json.dumps({"event": "facilitator_start", "data": {}}))
            recv_event(ws, "facilitator_update")
            ws.send_text(json.dumps({"event": "phase_change", "data": {"phase": "summary"}}))
            ev = recv_event(ws, "summary_failed")
            assert "message" in ev["data"]
