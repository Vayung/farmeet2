const mongoose = require("mongoose");

const FriendRequestSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true },
);

FriendRequestSchema.index({ sender: 1, recipient: 1 }, { unique: true });

module.exports = mongoose.model("FriendRequest", FriendRequestSchema);
