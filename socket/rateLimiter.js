/**
 * Map<socketId:eventKey, { count, start }>
 */
const eventMap = new Map();

/**
 * Rate limit socket events
 */
export const socketRateLimit = (socket, key, max, windowMs) => {
  const now = Date.now();
  const id = `${socket.id}:${key}`;

  if (!eventMap.has(id)) {
    eventMap.set(id, { count: 1, start: now });
    return true;
  }

  const data = eventMap.get(id);

  if (now - data.start > windowMs) {
    eventMap.set(id, { count: 1, start: now });
    return true;
  }

  if (data.count >= max) {
    socket.emit("rate-limit", { event: key });
    return false;
  }

  data.count++;
  return true;
};

/**
 * Cleanup all limits for a disconnected socket
 */
export const cleanupSocketRateLimits = (socketId) => {
  for (const key of eventMap.keys()) {
    if (key.startsWith(socketId)) {
      eventMap.delete(key);
    }
  }
};
