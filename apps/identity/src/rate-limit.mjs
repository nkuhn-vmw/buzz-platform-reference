export function createWindowLimiter({ maxHits = 20, windowMs = 60_000, maxKeys = 10_000, now = Date.now } = {}) {
  const windows = new Map();
  return (key) => {
    const clientKey = typeof key === 'string' && key ? key : 'unknown';
    const currentTime = now();
    let entry = windows.get(clientKey);
    if (!entry || currentTime - entry.startedAt >= windowMs) {
      if (!entry && windows.size >= maxKeys) windows.delete(windows.keys().next().value);
      entry = { startedAt: currentTime, hits: 0 };
      windows.set(clientKey, entry);
    }
    if (entry.hits >= maxHits) return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.startedAt + windowMs - currentTime) / 1000)) };
    entry.hits += 1;
    return { allowed: true, retryAfter: 0 };
  };
}
