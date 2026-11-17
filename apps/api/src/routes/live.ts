import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { AppDeps } from '../app.js';
import { tokenMatches } from '../auth.js';
import { EventListener, type PulseEvent } from '../events.js';

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 30_000;

/**
 * Live feed. Every committed change reaches every connected dashboard, whichever
 * container made it. Browsers cannot set headers on a WebSocket, so when a token is
 * configured the client sends {"type":"auth","token":"..."} as its first message.
 * That keeps the token out of URLs and access logs.
 */
export function liveRoutes(app: FastifyInstance, { config }: AppDeps): void {
  const subscribers = new Set<WebSocket>();
  const alive = new WeakSet<WebSocket>();

  const broadcast = (event: PulseEvent) => {
    const message = JSON.stringify(event);
    for (const socket of subscribers) {
      if (socket.readyState === socket.OPEN) socket.send(message);
    }
  };

  const listener = new EventListener(config.DATABASE_URL, broadcast, app.log);
  let heartbeat: NodeJS.Timeout | undefined;

  app.addHook('onReady', async () => {
    await listener.start();
    heartbeat = setInterval(() => {
      for (const socket of subscribers) {
        if (!alive.has(socket)) {
          socket.terminate();
          continue;
        }
        alive.delete(socket);
        socket.ping();
      }
    }, HEARTBEAT_MS);
    heartbeat.unref();
  });

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    for (const socket of subscribers) socket.close(1001, 'Server shutting down');
    await listener.close();
  });

  app.get('/api/live', { websocket: true }, (socket) => {
    const subscribe = () => {
      subscribers.add(socket);
      alive.add(socket);
      socket.send(JSON.stringify({ type: 'ready' }));
    };

    socket.on('pong', () => alive.add(socket));
    socket.on('close', () => subscribers.delete(socket));
    socket.on('error', () => subscribers.delete(socket));

    if (!config.API_TOKEN) return subscribe();

    const expected = config.API_TOKEN;
    const timeout = setTimeout(
      () => socket.close(4401, 'Authentication timed out'),
      AUTH_TIMEOUT_MS,
    );
    socket.once('message', (raw) => {
      clearTimeout(timeout);
      try {
        const message = JSON.parse(String(raw)) as { type?: unknown; token?: unknown };
        if (message.type === 'auth' && tokenMatches(message.token, expected)) return subscribe();
      } catch {
        // Fall through to the rejection below.
      }
      socket.close(4401, 'Invalid token');
    });
    socket.on('close', () => clearTimeout(timeout));
  });
}
