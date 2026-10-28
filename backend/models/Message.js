const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Conversation",
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  text: {
    type: String,
    default: "",
    trim: true,
    maxlength: 2000
  },
  attachment: {
    url: { type: String, trim: true },
    publicId: { type: String, trim: true },
    resourceType: { type: String, enum: ["image", "raw", "video"] },
    mimeType: { type: String, trim: true },
    fileName: { type: String, trim: true, maxlength: 180 },
    size: { type: Number, min: 0 }
  },
  clientId: {
    type: String,
    trim: true,
    maxlength: 80
  },
  forwarded: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date,
    default: null
  },
  deletedForEveryone: {
    type: Boolean,
    default: false
  },
  hiddenFor: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }],
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Message",
    default: null
  },
  reactions: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    emoji: {
      type: String,
      required: true,
      maxlength: 8
    }
  }],
  readAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

MessageSchema.index({ conversation: 1, createdAt: 1 });
MessageSchema.index(
  { sender: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } },
);

module.exports = mongoose.model("Message", MessageSchema);
