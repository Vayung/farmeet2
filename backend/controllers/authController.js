const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const {
  generateOTP,
  hashOTP
} = require("../services/otpService");

const sendOTPEmail =
  require("../services/emailService");

const sendUSSDOTP =
  require("../services/ussdService");


/*
========================================
REGISTER
========================================
*/

exports.register = async (req, res) => {
  try {

    const {
      name,
      email,
      phone,
      password
    } = req.body;

    const normalizedEmail =
      typeof email === "string" && email.trim()
        ? email.trim().toLowerCase()
        : undefined;
    const normalizedPhone =
      typeof phone === "string" && phone.trim()
        ? phone.trim()
        : undefined;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof password !== "string" ||
      !password ||
      (!normalizedEmail && !normalizedPhone)
    ) {
      return res.status(400).json({
        message: "Name, password, and at least one of email or phone are required"
      });
    }

    if (
      normalizedEmail &&
      (normalizedEmail.length > 254 || !/^\S+@\S+\.\S+$/.test(normalizedEmail))
    ) {
      return res.status(400).json({ message: "Enter a valid email address" });
    }
    if (normalizedPhone && !/^[+0-9()\s-]{7,20}$/.test(normalizedPhone)) {
      return res.status(400).json({ message: "Enter a valid phone number" });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }

    const duplicateConditions = [];
    if (normalizedEmail) duplicateConditions.push({ email: normalizedEmail });
    if (normalizedPhone) duplicateConditions.push({ phone: normalizedPhone });
    const existingUsers = await User.find({ $or: duplicateConditions })
      .select("email phone")
      .lean();
    const duplicateEmail = normalizedEmail &&
      existingUsers.some((user) => user.email === normalizedEmail);
    const duplicatePhone = normalizedPhone &&
      existingUsers.some((user) => user.phone === normalizedPhone);

    if (duplicateEmail || duplicatePhone) {
      const duplicateFields = [];
      if (duplicateEmail) duplicateFields.push("email address");
      if (duplicatePhone) duplicateFields.push("phone number");
      return res.status(400).json({
        message: `This ${duplicateFields.join(" and ")} is already registered.`
      });
    }

    const hashedPassword =
      await bcrypt.hash(password, 12);

    try {
      await User.create({
        name: name.trim(),
        email: normalizedEmail,
        phone: normalizedPhone,
        password: hashedPassword
      });
    } catch (error) {
      if (error.code === 11000) {
        const duplicateField = error.keyPattern?.email
          ? "email address"
          : "phone number";
        return res.status(409).json({
          message: `This ${duplicateField} is already registered.`
        });
      }
      throw error;
    }

    res.status(201).json({
      message: "User Created"
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Registration failed"
    });

  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      "name email phone bio location",
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ profile: user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not load profile" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, bio, location } = req.body;
    const normalizedPhone =
      typeof phone === "string" && phone.trim() ? phone.trim() : undefined;
    if (
      typeof name !== "string" ||
      !name.trim()
    ) {
      return res.status(400).json({ message: "Name is required" });
    }

    if (normalizedPhone) {
      const existingPhoneUser = await User.findOne({
        phone: normalizedPhone,
        _id: { $ne: req.user.userId },
      });
      if (existingPhoneUser) {
        return res.status(409).json({ message: "Phone number is already in use" });
      }
    }

    const currentUser = await User.findById(req.user.userId);
    if (!currentUser) return res.status(404).json({ message: "User not found" });
    if (!normalizedPhone && !currentUser.email) {
      return res.status(400).json({
        message: "Add a phone number because your account has no email address",
      });
    }
    const updates = {
      name: name.trim(),
      bio: typeof bio === "string" ? bio.trim() : "",
      location: typeof location === "string" ? location.trim() : "",
    };
    if (normalizedPhone) updates.phone = normalizedPhone;
    const updateOperation = { $set: updates };
    if (phone === "" && currentUser.email) updateOperation.$unset = { phone: 1 };

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      updateOperation,
      {
        returnDocument: "after",
        runValidators: true,
        select: "name email phone bio location",
      },
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ profile: user, message: "Profile updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not update profile" });
  }
};


/*
========================================
LOGIN
========================================
*/

exports.login = async (req, res) => {
  try {

    const { identifier, email, password, method } = req.body;
    const loginIdentifier = identifier || email;

    if (
      typeof loginIdentifier !== "string" ||
      !loginIdentifier.trim() ||
      loginIdentifier.length > 254 ||
      typeof password !== "string" ||
      !password ||
      password.length > 256 ||
      (method !== "email" && method !== "ussd")
    ) {
      return res.status(400).json({
        message:
          "Email or phone, password and verification method are required"
      });
    }

    const normalizedIdentifier = loginIdentifier.trim();
    const user = await User.findOne(
      normalizedIdentifier.includes("@")
        ? { email: normalizedIdentifier.toLowerCase() }
        : { phone: normalizedIdentifier },
    );

    if (!user) {
      const failure = req.recordLoginFailure();
      if (failure.retryAfterSeconds) {
        res.set("Retry-After", String(failure.retryAfterSeconds));
        return res.status(429).json({
          message: "Too many incorrect attempts. Try again in 3 minutes.",
          retryAfterSeconds: failure.retryAfterSeconds,
        });
      }
      return res.status(401).json({
        message: `Invalid email/phone or password. ${failure.attemptsRemaining} attempt(s) remaining before a temporary lockout.`
      });
    }

    const now = new Date();
    if (user.loginLockUntil && user.loginLockUntil > now) {
      const retryAfterSeconds = Math.ceil(
        (user.loginLockUntil.getTime() - now.getTime()) / 1000,
      );
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        message: `Too many incorrect attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        retryAfterSeconds,
      });
    }

    if (user.loginLockUntil && user.loginLockUntil <= now) {
      user.loginLockUntil = null;
      user.failedLoginAttempts = 0;
    }

    const passwordCorrect =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!passwordCorrect) {
      const failure = req.recordLoginFailure();
      user.failedLoginAttempts += 1;
      const accountLockMinutes = [3, 10, 30, 60][
        Math.min(user.loginLockLevel, 3)
      ];
      const retryAfterSeconds =
        failure.retryAfterSeconds ||
        (user.failedLoginAttempts >= 3 ? accountLockMinutes * 60 : 0);
      if (retryAfterSeconds) {
        const lockDurationMs = retryAfterSeconds * 1000;
        user.loginLockUntil = new Date(Date.now() + lockDurationMs);
        user.loginLockLevel = Math.min(user.loginLockLevel + 1, 3);
        user.failedLoginAttempts = 0;
      }
      await user.save();
      if (retryAfterSeconds) {
        res.set("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
          message: `Too many incorrect attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`,
          retryAfterSeconds,
        });
      }
      return res.status(401).json({
        message: `Invalid email/phone or password. ${failure.attemptsRemaining} attempt(s) remaining before a temporary lockout.`
      });
    }

    req.clearLoginFailures();
    user.failedLoginAttempts = 0;
    user.loginLockUntil = null;
    user.loginLockLevel = 0;

    if (method === "email" && !user.email) {
      return res.status(400).json({
        message: "This account has no email address. Choose phone verification.",
      });
    }
    if (method === "ussd" && !user.phone) {
      return res.status(400).json({
        message: "This account has no phone number. Choose email verification.",
      });
    }

    /*
    Generate a new OTP
    */

    const otp = generateOTP();

    /*
    Hash OTP before storing it
    */

    const otpHash = hashOTP(otp);

    user.otpHash = otpHash;

    /*
    OTP expires after 5 minutes
    */

    user.otpExpiry =
      new Date(Date.now() + 5 * 60 * 1000);

    /*
    Reset failed attempts
    */

    user.otpAttempts = 0;

    await user.save();

    res.json({
      message: "Credentials verified. OTP is being sent.",
      identifier: user.email || user.phone,
      deliveryMethod: method,
    });

    const delivery =
      method === "email"
        ? sendOTPEmail(user.email, otp)
        : sendUSSDOTP(user.phone, otp);

    delivery.catch((error) => {
      console.error("OTP delivery failed:", error);
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      message: "Login failed"
    });

  }
};


/*
========================================
VERIFY OTP
========================================
*/

exports.verifyOTP = async (req, res) => {
  try {

    const { identifier, email, otp } = req.body;
    const otpIdentifier = identifier || email;

    if (
      typeof otpIdentifier !== "string" ||
      otpIdentifier.length > 254 ||
      typeof otp !== "string" ||
      !/^\d{6}$/.test(otp)
    ) {
      return res.status(400).json({
        message: "Email or phone and OTP are required"
      });
    }

    const normalizedIdentifier = otpIdentifier.trim();
    const user = await User.findOne(
      normalizedIdentifier.includes("@")
        ? { email: normalizedIdentifier.toLowerCase() }
        : { phone: normalizedIdentifier },
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    /*
    Check number of failed attempts
    */

    if (user.otpAttempts >= 5) {

      return res.status(429).json({
        message:
          "Too many incorrect attempts. Request a new OTP."
      });

    }

    /*
    Check whether OTP exists
    */

    if (!user.otpHash) {

      return res.status(400).json({
        message:
          "No active OTP. Please request a new one."
      });

    }

    /*
    Check expiration
    */

    if (
      !user.otpExpiry ||
      new Date() > user.otpExpiry
    ) {

      user.otpHash = null;
      user.otpExpiry = null;
      user.otpAttempts = 0;

      await user.save();

      return res.status(400).json({
        message:
          "OTP expired. Please request a new one."
      });

    }

    /*
    Hash the OTP entered by the user
    */

    const enteredOTPHash =
      hashOTP(otp);

    /*
    Compare hashes
    */

    if (
      enteredOTPHash !== user.otpHash
    ) {

      user.otpAttempts += 1;

      await user.save();

      return res.status(400).json({
        message: "Invalid OTP"
      });

    }

    /*
    OTP is correct.
    Delete it so it cannot be reused.
    */

    user.otpHash = null;
    user.otpExpiry = null;
    user.otpAttempts = 0;

    await user.save();

    /*
    Generate login token
    */

    const token =
      jwt.sign(
        {
          userId: user._id,
          email: user.email || null
        },
        process.env.JWT_SECRET,
        {
          expiresIn: "1h"
        }
      );

    res.json({
      success: true,
      message: "OTP verified successfully",
      token,
      identifier: user.email || user.phone,
      email: user.email || "",
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      message: "OTP verification failed"
    });

  }
};