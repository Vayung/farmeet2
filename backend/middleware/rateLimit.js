const windows = new Map();

const createRateLimit = ({ limit, windowMs, message }) => (req, res, next) => {
  const now = Date.now();
  const key = `${req.baseUrl}${req.path}:${req.ip}`;
  let entry = windows.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    windows.set(key, entry);
  }

  entry.count += 1;
  if (entry.count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.set("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({ message, retryAfterSeconds });
  }

  if (windows.size > 10000) {
    for (const [windowKey, value] of windows) {
      if (value.resetAt <= now) windows.delete(windowKey);
    }
    while (windows.size > 10000) {
      windows.delete(windows.keys().next().value);
    }
  }

  next();
};

module.exports = createRateLimit;
