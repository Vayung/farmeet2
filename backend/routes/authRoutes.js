const express = require("express");
const {
  register,
  login,
  verifyOTP,
  getProfile,
  updateProfile,
} = require("../controllers/authController");
const requireAuth = require("../middleware/requireAuth");
const rateLimit = require("../middleware/rateLimit");
const loginAttemptGuard = require("../middleware/loginAttemptGuard");

const router = express.Router();
const loginRateLimit = rateLimit({
  limit: 15,
  windowMs: 15 * 60 * 1000,
  message: "Too many login requests. Try again in 15 minutes.",
});
const signupRateLimit = rateLimit({
  limit: 5,
  windowMs: 60 * 60 * 1000,
  message: "Too many sign-up requests. Try again in 1 hour.",
});
const otpRateLimit = rateLimit({
  limit: 10,
  windowMs: 15 * 60 * 1000,
  message: "Too many OTP attempts. Try again in 15 minutes.",
});

router.post("/register", signupRateLimit, register);
router.post("/login", loginRateLimit, loginAttemptGuard, login);
router.post("/verify-otp", otpRateLimit, verifyOTP);
router.get("/profile", requireAuth, getProfile);
router.patch("/profile", requireAuth, updateProfile);

module.exports = router;
