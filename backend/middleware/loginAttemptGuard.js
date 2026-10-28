const crypto = require("crypto");

const attemptsByLogin = new Map();
const lockDurationsMs = [3, 10, 30, 60].map((minutes) => minutes * 60 * 1000);
const maxEntries = 20000;

const getKey = (req) => {
  const identifier = req.body?.identifier || req.body?.email;
  const normalized =
    typeof identifier === "string" ? identifier.trim().toLowerCase() : "";
  return crypto
    .createHash("sha256")
    .update(`${req.ip}:${normalized}`)
    .digest("hex");
};

module.exports = (req, res, next) => {
  const key = getKey(req);
  const now = Date.now();
  let state = attemptsByLogin.get(key);

  if (state?.lockedUntil && state.lockedUntil <= now) {
    state = { attempts: 0, lockLevel: state.lockLevel, lockedUntil: 0 };
    attemptsByLogin.set(key, state);
  }

  if (state?.lockedUntil > now) {
    const retryAfterSeconds = Math.ceil((state.lockedUntil - now) / 1000);
    res.set("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      message: `Too many incorrect attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
      retryAfterSeconds,
    });
  }

  req.recordLoginFailure = () => {
    const current = attemptsByLogin.get(key) ?? {
      attempts: 0,
      lockLevel: 0,
      lockedUntil: 0,
    };
    current.attempts += 1;
    let retryAfterSeconds = 0;

    if (current.attempts >= 3) {
      const lockDuration =
        lockDurationsMs[Math.min(current.lockLevel, lockDurationsMs.length - 1)];
      current.lockedUntil = Date.now() + lockDuration;
      current.lockLevel = Math.min(
        current.lockLevel + 1,
        lockDurationsMs.length - 1,
      );
      current.attempts = 0;
      retryAfterSeconds = Math.ceil(lockDuration / 1000);
    }

    attemptsByLogin.set(key, current);
    if (attemptsByLogin.size > maxEntries) {
      for (const [entryKey, entry] of attemptsByLogin) {
        if (!entry.lockedUntil || entry.lockedUntil <= Date.now()) {
          attemptsByLogin.delete(entryKey);
        }
      }
      while (attemptsByLogin.size > maxEntries) {
        attemptsByLogin.delete(attemptsByLogin.keys().next().value);
      }
    }
    return { retryAfterSeconds, attemptsRemaining: 3 - current.attempts };
  };

  req.clearLoginFailures = () => {
    attemptsByLogin.delete(key);
  };

  next();
};
