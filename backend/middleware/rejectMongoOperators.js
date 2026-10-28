const containsUnsafeKey = (value) => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsUnsafeKey);

  return Object.entries(value).some(
    ([key, child]) =>
      key.startsWith("$") || key.includes(".") || containsUnsafeKey(child),
  );
};

module.exports = (req, res, next) => {
  if (containsUnsafeKey(req.body)) {
    return res.status(400).json({ message: "Invalid request data" });
  }
  next();
};
