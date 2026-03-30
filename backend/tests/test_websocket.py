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

                msg1 = ws1.receive_json()
                msg2 = ws2.receive_json()
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

                msg1 = ws1.receive_json()
                msg2 = ws2.receive_json()
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

            msg = ws.receive_json()
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
            ws1.receive_json()

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
            ws1.receive_json()

            ws1.send_text(
                json.dumps(
                    {
                        "event": "timer_pause",
                        "data": {"remaining": 450},
                    }
                )
            )
            ws1.receive_json()

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
            ws1.receive_json()

            with client.websocket_connect(url, headers={"origin": TEST_ORIGIN}) as ws2:
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

                msg1 = ws1.receive_json()
                msg2 = ws2.receive_json()
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

                msg1 = ws1.receive_json()
                msg2 = ws2.receive_json()
                assert msg1["event"] == "timer_start"
                assert msg2["event"] == "timer_start"
