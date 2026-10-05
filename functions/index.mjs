import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { createProxy } from './proxy.mjs';
const token = defineSecret('HAEMA_PROXY_TOKEN');
export const haemaProxy = onRequest({
  region: 'asia-northeast3', timeoutSeconds: 60, memory: '256MiB',
  minInstances: 0, maxInstances: 1, concurrency: 4, cors: false,
  invoker: 'public', secrets: [token],
}, (req, res) => createProxy({ token: token.value() })(req, res));
