import { useEffect, useRef, useState } from 'react';
import { tokenStore, type LiveEvent } from './api.ts';

export type LiveStatus = 'connecting' | 'live' | 'offline';

/**
 * Subscribes to the server's live feed and reconnects with backoff.
 * `onResync` fires after every (re)connect, because events sent while the socket
 * was down are gone and the only safe move is to refetch.
 */
export function useLive(
  enabled: boolean,
  onEvent: (event: LiveEvent) => void,
  onResync: () => void,
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const handlers = useRef({ onEvent, onResync });
  useEffect(() => {
    handlers.current = { onEvent, onResync };
  });

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let stopped = false;
    let connectedBefore = false;

    const connect = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.host}/api/live`);

      socket.onopen = () => {
        const token = tokenStore.get();
        if (token) socket?.send(JSON.stringify({ type: 'auth', token }));
      };
      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as LiveEvent | { type: 'ready' };
        if (event.type === 'ready') {
          attempts = 0;
          setStatus('live');
          if (connectedBefore) handlers.current.onResync();
          connectedBefore = true;
          return;
        }
        handlers.current.onEvent(event);
      };
      socket.onclose = () => {
        if (stopped) return;
        setStatus(attempts === 0 ? 'connecting' : 'offline');
        retry = setTimeout(connect, Math.min(15_000, 500 * 2 ** attempts++));
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [enabled]);

  return status;
}
