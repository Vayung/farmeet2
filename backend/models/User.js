const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    default: ""
  },
  email: {
    type: String,
    lowercase: true,
    trim: true,
    sparse: true,
    unique: true,
    default: undefined
  },

  phone: {
    type: String,
    trim: true,
    sparse: true,
    unique: true,
    default: undefined
  },

  bio: {
    type: String,
    default: "",
    maxlength: 280
  },

  location: {
    type: String,
    default: "",
    maxlength: 100
  },

  password: {
    type: String,
    required: true
  },

  otpHash: {
    type: String,
    default: null
  },

  otpExpiry: {
    type: Date,
    default: null
  },

  otpAttempts: {
    type: Number,
    default: 0
  },
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  loginLockUntil: {
    type: Date,
    default: null
  },
  loginLockLevel: {
    type: Number,
    default: 0
  },
  blockedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }]
});

module.exports = mongoose.model("User", UserSchema);