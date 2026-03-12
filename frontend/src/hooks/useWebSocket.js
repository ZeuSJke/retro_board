import { useCallback, useEffect, useRef } from "react";

export function useWebSocket(boardId, onMessage) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const wsRef = useRef(null);

  const sendMessage = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!boardId) return;

    let cancelled = false;
    let reconnectTimer = null;

    const connect = () => {
      if (cancelled) return;

      const protocol = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${protocol}://${location.host}/ws/${boardId}`);

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          onMessageRef.current(msg);
        } catch {}
      };

      ws.onclose = () => {
        if (cancelled) return;
        reconnectTimer = setTimeout(connect, 2000);
      };

      wsRef.current = ws;
    };

    connect();

    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send("ping");
      }
    }, 25000);

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      clearInterval(ping);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [boardId]);

  return { sendMessage };
}
