const express = require("express");
const {
  createConversation,
  sendFriendRequest,
  listFriendRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  listFriends,
  removeFriend,
  blockUser,
  unblockUser,
  listBlockedUsers,
  uploadAttachment,
  setTyping,
  getTyping,
  listConversations,
  listMessages,
  forwardMessage,
  updateMessage,
  deleteMessage,
  reactToMessage,
  sendMessage
} = require("../controllers/messageController");

const router = express.Router();

const requireAuth = require("../middleware/requireAuth");
const rateLimit = require("../middleware/rateLimit");
const multer = require("multer");
const allowedAttachmentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "audio/3gpp",
  "audio/mp4",
  "audio/aac",
  "audio/mpeg",
  "audio/ogg",
  "audio/webm",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!allowedAttachmentTypes.has(file.mimetype)) {
      const error = new Error("Unsupported file type");
      error.code = "UNSUPPORTED_FILE_TYPE";
      return callback(error);
    }
    callback(null, true);
  },
});
const parseAttachment = (req, res, next) => {
  attachmentUpload.single("file")(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({
        message: status === 413
          ? "Attachments must be 10 MB or smaller"
          : "Could not read the attachment",
      });
    }
    if (error.code === "UNSUPPORTED_FILE_TYPE") {
      return res.status(415).json({ message: error.message });
    }
    next(error);
  });
};
const friendRequestRateLimit = rateLimit({
  limit: 25,
  windowMs: 60 * 60 * 1000,
  message: "Too many friend requests. Try again later.",
});
const messageRateLimit = rateLimit({
  limit: 60,
  windowMs: 60 * 1000,
  message: "You are sending messages too quickly. Please wait a minute.",
});
const conversationRateLimit = rateLimit({
  limit: 30,
  windowMs: 60 * 60 * 1000,
  message: "Too many new conversation requests. Try again later.",
});
const attachmentRateLimit = rateLimit({
  limit: 25,
  windowMs: 60 * 60 * 1000,
  message: "Too many attachments. Try again later.",
});
const typingRateLimit = rateLimit({
  limit: 60,
  windowMs: 60 * 1000,
  message: "Typing updates are being sent too quickly.",
});

router.post("/conversations", requireAuth, conversationRateLimit, createConversation);
router.post("/friend-requests", requireAuth, friendRequestRateLimit, sendFriendRequest);
router.get("/friend-requests", requireAuth, listFriendRequests);
router.post("/friend-requests/:requestId/accept", requireAuth, acceptFriendRequest);
router.post("/friend-requests/:requestId/reject", requireAuth, rejectFriendRequest);
router.get("/friends", requireAuth, listFriends);
router.delete("/friends/:userId", requireAuth, removeFriend);
router.post("/blocks/:userId", requireAuth, blockUser);
router.delete("/blocks/:userId", requireAuth, unblockUser);
router.get("/blocks", requireAuth, listBlockedUsers);
router.post("/conversations/:conversationId/typing", requireAuth, typingRateLimit, setTyping);
router.get("/conversations/:conversationId/typing", requireAuth, getTyping);
router.post(
  "/attachments",
  requireAuth,
  attachmentRateLimit,
  parseAttachment,
  uploadAttachment,
);
router.get("/conversations", requireAuth, listConversations);
router.get("/conversations/:conversationId/messages", requireAuth, listMessages);
router.patch(
  "/conversations/:conversationId/messages/:messageId",
  requireAuth,
  messageRateLimit,
  updateMessage,
);
router.delete(
  "/conversations/:conversationId/messages/:messageId",
  requireAuth,
  messageRateLimit,
  deleteMessage,
);
router.put(
  "/conversations/:conversationId/messages/:messageId/reactions",
  requireAuth,
  messageRateLimit,
  reactToMessage,
);
router.post(
  "/conversations/:conversationId/messages/:messageId/forward",
  requireAuth,
  messageRateLimit,
  forwardMessage,
);
router.post(
  "/conversations/:conversationId/messages",
  requireAuth,
  messageRateLimit,
  sendMessage,
);

module.exports = router;
