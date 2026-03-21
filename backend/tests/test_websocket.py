"""Tests for WebSocket /ws/{board_id} endpoint."""
import json


def recv_event(ws, target_event: str, max_messages: int = 10):
    """Receive messages until we get one with the target event, skipping others."""
    for _ in range(max_messages):
        msg = ws.receive_json()
        if msg["event"] == target_event:
            return msg
    raise AssertionError(f"Did not receive '{target_event}' within {max_messages} messages")


class TestWebSocketConnect:
    def test_connect_and_receive(self, client):
        with client.websocket_connect("/ws/test-board") as ws:
            # Connection should succeed — just send a ping to confirm
            ws.send_text("ping")
            # No response expected for ping, connection is alive


class TestWebSocketCursorMove:
    def test_cursor_broadcast_to_others(self, client):
        """cursor_move should be broadcast to other clients, not the sender."""
        with client.websocket_connect("/ws/board-1") as ws1:
            with client.websocket_connect("/ws/board-1") as ws2:
                ws1.send_text(json.dumps({
                    "event": "cursor_move",
                    "data": {"username": "Alice", "x": 100, "y": 200},
                }))

                msg = recv_event(ws2, "cursor_move")
                assert msg["data"]["username"] == "Alice"
                assert msg["data"]["x"] == 100


class TestWebSocketCursorLeave:
    def test_cursor_leave_on_disconnect(self, client):
        """When a client disconnects, cursor_leave is broadcast for their username."""
        with client.websocket_connect("/ws/board-2") as ws_listener:
            with client.websocket_connect("/ws/board-2") as ws_leaver:
                # Register the leaver's username via cursor_move
                ws_leaver.send_text(json.dumps({
                    "event": "cursor_move",
                    "data": {"username": "Bob", "x": 0, "y": 0},
                }))
                # Listener receives multiple events (cursor_move + presence_update)
                recv_event(ws_listener, "cursor_move")

            # ws_leaver disconnected — listener should get cursor_leave
            msg = recv_event(ws_listener, "cursor_leave")
            assert msg["data"]["username"] == "Bob"


class TestWebSocketPresence:
    def test_presence_update_on_join(self, client):
        """presence_update should be broadcast when a user first sends cursor_move."""
        with client.websocket_connect("/ws/board-presence") as ws1:
            with client.websocket_connect("/ws/board-presence") as ws2:
                ws1.send_text(json.dumps({
                    "event": "cursor_move",
                    "data": {"username": "Alice", "x": 0, "y": 0},
                }))

                msg = recv_event(ws2, "presence_update")
                assert "Alice" in msg["data"]["users"]

    def test_presence_update_on_leave(self, client):
        """presence_update should be broadcast when a user disconnects."""
        with client.websocket_connect("/ws/board-presence2") as ws_listener:
            with client.websocket_connect("/ws/board-presence2") as ws_leaver:
                ws_leaver.send_text(json.dumps({
                    "event": "cursor_move",
                    "data": {"username": "Charlie", "x": 0, "y": 0},
                }))
                recv_event(ws_listener, "presence_update")

            # ws_leaver disconnected — should get presence_update with empty list
            msg = recv_event(ws_listener, "presence_update")
            assert "Charlie" not in msg["data"]["users"]


class TestWebSocketFacilitator:
    def test_facilitator_start(self, client):
        """facilitator_start should set facilitator and broadcast."""
        with client.websocket_connect("/ws/board-fac") as ws1:
            with client.websocket_connect("/ws/board-fac") as ws2:
                # Register username
                ws1.send_text(json.dumps({
                    "event": "cursor_move",
                    "data": {"username": "Facilitator", "x": 0, "y": 0},
                }))
                recv_event(ws2, "cursor_move")

                ws1.send_text(json.dumps({
                    "event": "facilitator_start",
                    "data": {},
                }))

                msg = recv_event(ws2, "facilitator_update")
                assert msg["data"]["facilitator"] == "Facilitator"
                assert msg["data"]["phase"] == "brainstorm"

    def test_facilitator_stop(self, client):
        """facilitator_stop should clear facilitator and broadcast."""
        with client.websocket_connect("/ws/board-fac2") as ws1:
            with client.websocket_connect("/ws/board-fac2") as ws2:
                ws1.send_text(json.dumps({
                    "event": "cursor_move",
                    "data": {"username": "Leader", "x": 0, "y": 0},
                }))
                recv_event(ws2, "cursor_move")

                ws1.send_text(json.dumps({"event": "facilitator_start", "data": {}}))
                recv_event(ws2, "facilitator_update")

                ws1.send_text(json.dumps({"event": "facilitator_stop", "data": {}}))
                msg = recv_event(ws2, "facilitator_update")
                assert msg["data"]["facilitator"] is None
                assert msg["data"]["phase"] is None

    def test_phase_change(self, client):
        """phase_change should update phase and broadcast."""
        with client.websocket_connect("/ws/board-fac3") as ws1:
            with client.websocket_connect("/ws/board-fac3") as ws2:
                ws1.send_text(json.dumps({
                    "event": "cursor_move",
                    "data": {"username": "Boss", "x": 0, "y": 0},
                }))
                recv_event(ws2, "cursor_move")

                ws1.send_text(json.dumps({"event": "facilitator_start", "data": {}}))
                recv_event(ws2, "facilitator_update")

                ws1.send_text(json.dumps({
                    "event": "phase_change",
                    "data": {"phase": "vote"},
                }))
                msg = recv_event(ws2, "phase_update")
                assert msg["data"]["phase"] == "vote"


class TestWebSocketTimerEvents:
    def test_timer_start_broadcast(self, client):
        with client.websocket_connect("/ws/board-t") as ws1:
            with client.websocket_connect("/ws/board-t") as ws2:
                ws1.send_text(json.dumps({
                    "event": "timer_start",
                    "data": {"duration": 300, "remaining": 300, "ts": 0},
                }))

                # Both should receive (timer events broadcast to ALL)
                msg1 = ws1.receive_json()
                msg2 = ws2.receive_json()
                assert msg1["event"] == "timer_start"
                assert msg2["event"] == "timer_start"

    def test_timer_pause_broadcast(self, client):
        with client.websocket_connect("/ws/board-tp") as ws1:
            with client.websocket_connect("/ws/board-tp") as ws2:
                ws1.send_text(json.dumps({
                    "event": "timer_pause",
                    "data": {"remaining": 120},
                }))

                msg1 = ws1.receive_json()
                msg2 = ws2.receive_json()
                assert msg1["event"] == "timer_pause"
                assert msg2["event"] == "timer_pause"
                assert msg2["data"]["remaining"] == 120

    def test_timer_reset_broadcast(self, client):
        with client.websocket_connect("/ws/board-tr") as ws:
            ws.send_text(json.dumps({
                "event": "timer_reset",
                "data": {"duration": 600},
            }))

            msg = ws.receive_json()
            assert msg["event"] == "timer_reset"
            assert msg["data"]["duration"] == 600


class TestWebSocketGroupCollapse:
    def test_group_collapse_broadcast_to_all(self, client):
        with client.websocket_connect("/ws/board-gc") as ws1:
            with client.websocket_connect("/ws/board-gc") as ws2:
                ws1.send_text(json.dumps({
                    "event": "group_collapse",
                    "data": {"group_id": "g1", "collapsed": True},
                }))

                msg1 = ws1.receive_json()
                msg2 = ws2.receive_json()
                assert msg1["event"] == "group_collapse"
                assert msg2["event"] == "group_collapse"
                assert msg2["data"]["collapsed"] is True
