import { useState, useEffect } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

export function useWebSocket(onMessage) {
  const [connected, setConnected] = useState(false);
  const [ws, setWs] = useState(null);

  useEffect(() => {
    if (!import.meta.env.VITE_ENABLE_WEBSOCKET_UPDATES) {
      return;
    }

    let socket;
    let reconnectTimeout;

    const connect = () => {
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        console.log('WebSocket connected');
        setConnected(true);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (onMessage) {
            onMessage(message);
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      socket.onclose = () => {
        console.log('WebSocket disconnected');
        setConnected(false);
        
        // Reconnect after 5 seconds
        reconnectTimeout = setTimeout(() => {
          console.log('Reconnecting...');
          connect();
        }, 5000);
      };

      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      setWs(socket);
    };

    connect();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (socket) {
        socket.close();
      }
    };
  }, [onMessage]);

  return { connected, ws };
}
