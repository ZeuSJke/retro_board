"""Tests for WebSocket /ws/{board_id} endpoint."""
import json


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

                msg = ws2.receive_json()
                assert msg["event"] == "cursor_move"
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
                # Listener receives the cursor_move first
                ws_listener.receive_json()

            # ws_leaver disconnected — listener should get cursor_leave
            msg = ws_listener.receive_json()
            assert msg["event"] == "cursor_leave"
            assert msg["data"]["username"] == "Bob"


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
