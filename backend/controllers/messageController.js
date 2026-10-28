const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const FriendRequest = require("../models/FriendRequest");
const mongoose = require("mongoose");
const typingUsers = new Map();
const typingKey = (conversationId, userId) => `${conversationId}:${userId}`;

const getAccessibleConversation = async (conversationId, userId) => {
  if (!mongoose.isValidObjectId(conversationId)) return null;
  const conversation = await Conversation.findOne({
    _id: conversationId,
    participants: userId,
  });
  if (!conversation) return null;
  if (
    !conversation.isSelfChat &&
    conversation.participants.length === 2 &&
    !(await hasAcceptedFriendship(
      conversation.participants[0],
      conversation.participants[1],
    ))
  ) {
    return null;
  }
  return conversation;
};

const ensureConversation = async (userId, recipientId, isSelfChat = false) => {
  const participants = isSelfChat ? [userId] : [userId, recipientId];
  let conversation = isSelfChat
    ? await Conversation.findOne({ participants: [userId], isSelfChat: true })
    : await Conversation.findOne({
        participants: { $all: participants, $size: 2 },
        isSelfChat: false,
      });

  if (!conversation) {
    conversation = await Conversation.create({ participants, isSelfChat });
  }
  return conversation;
};

const hasAcceptedFriendship = async (firstUserId, secondUserId) => {
  const blocked = await User.exists({
    $or: [
      { _id: firstUserId, blockedUsers: secondUserId },
      { _id: secondUserId, blockedUsers: firstUserId },
    ],
  });
  if (blocked) return false;
  return FriendRequest.exists({
    status: "accepted",
    $or: [
      { sender: firstUserId, recipient: secondUserId },
      { sender: secondUserId, recipient: firstUserId },
    ],
  });
};

const refreshConversationPreview = async (conversationId) => {
  const latestMessage = await Message.findOne({
    conversation: conversationId,
  }).sort({ createdAt: -1 });
  await Conversation.updateOne(
    { _id: conversationId },
    {
      $set: {
        lastMessage: latestMessage
          ? latestMessage.deletedForEveryone
            ? "This message was deleted"
            : latestMessage.text ||
              (latestMessage.attachment
                ? `Attachment: ${latestMessage.attachment.fileName}`
                : "")
          : "",
        lastMessageAt: latestMessage?.createdAt ?? null,
      },
    },
  );
};

exports.sendFriendRequest = async (req, res) => {
  try {
    const { recipient } = req.body;
    if (typeof recipient !== "string" || !recipient.trim()) {
      return res.status(400).json({ message: "Email or phone is required" });
    }
    const identifier = recipient.trim();
    const recipientUser = await User.findOne(
      identifier.includes("@")
        ? { email: identifier.toLowerCase() }
        : { phone: identifier },
    ).select("name email phone");
    if (!recipientUser) return res.status(404).json({ message: "Connecta user not found" });
    if (recipientUser._id.equals(req.user.userId)) {
      return res.status(400).json({ message: "Use self-chat to message yourself" });
    }
    const blocked = await User.exists({
      $or: [
        { _id: req.user.userId, blockedUsers: recipientUser._id },
        { _id: recipientUser._id, blockedUsers: req.user.userId },
      ],
    });
    if (blocked) {
      return res.status(403).json({ message: "Friend requests are unavailable for this user" });
    }

    const request = await FriendRequest.findOne({
      $or: [
        { sender: req.user.userId, recipient: recipientUser._id },
        { sender: recipientUser._id, recipient: req.user.userId },
      ],
    });
    if (request?.status === "accepted") {
      const conversation = await ensureConversation(
        req.user.userId,
        recipientUser._id,
      );
      await conversation.populate("participants", "name email phone");
      return res.json({
        status: "accepted",
        conversation,
        contact: recipientUser,
      });
    }
    if (request) {
      if (request.status === "rejected") {
        request.sender = req.user.userId;
        request.recipient = recipientUser._id;
        request.status = "pending";
        request.createdAt = new Date();
        await request.save();
        return res.status(201).json({ status: "pending", message: "Friend request sent" });
      }
      const incoming = String(request.recipient) === String(req.user.userId);
      return res.status(409).json({
        message: incoming
          ? "This person already sent you a request. Accept it from your inbox."
          : "Friend request is already pending",
      });
    }

    await FriendRequest.create({
      sender: req.user.userId,
      recipient: recipientUser._id,
    });
    res.status(201).json({ status: "pending", message: "Friend request sent" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not send friend request" });
  }
};

exports.listFriendRequests = async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      recipient: req.user.userId,
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .populate("sender", "name email phone");
    res.json({ requests });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not load friend requests" });
  }
};

exports.acceptFriendRequest = async (req, res) => {
  try {
    const request = await FriendRequest.findOneAndUpdate(
      {
        _id: req.params.requestId,
        recipient: req.user.userId,
        status: "pending",
      },
      { $set: { status: "accepted" } },
      { returnDocument: "after" },
    );
    if (!request) {
      return res.status(404).json({ message: "Pending friend request not found" });
    }

    const conversation = await ensureConversation(
      request.sender,
      request.recipient,
    );
    res.json({ message: "Friend request accepted", conversationId: conversation._id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not accept friend request" });
  }
};

exports.rejectFriendRequest = async (req, res) => {
  try {
    const request = await FriendRequest.findOneAndUpdate(
      {
        _id: req.params.requestId,
        recipient: req.user.userId,
        status: "pending",
      },
      { $set: { status: "rejected" } },
      { returnDocument: "after" },
    );
    if (!request) {
      return res.status(404).json({ message: "Pending friend request not found" });
    }
    res.json({ message: "Friend request declined" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not decline friend request" });
  }
};

exports.listFriends = async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      status: "accepted",
      $or: [
        { sender: req.user.userId },
        { recipient: req.user.userId },
      ],
    }).populate("sender recipient", "name email phone");
    const friends = requests
      .map((request) =>
        String(request.sender._id) === String(req.user.userId)
          ? request.recipient
          : request.sender,
      )
      .filter(Boolean);
    res.json({ friends });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not load friends" });
  }
};

exports.removeFriend = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ message: "Friend identifier is invalid" });
    }
    const request = await FriendRequest.findOneAndUpdate(
      {
        status: "accepted",
        $or: [
          { sender: req.user.userId, recipient: req.params.userId },
          { sender: req.params.userId, recipient: req.user.userId },
        ],
      },
      { $set: { status: "rejected" } },
      { returnDocument: "after" },
    );
    if (!request) return res.status(404).json({ message: "Friend not found" });
    res.json({ message: "Friend removed" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not remove friend" });
  }
};

exports.blockUser = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ message: "User identifier is invalid" });
    }
    if (String(req.user.userId) === req.params.userId) {
      return res.status(400).json({ message: "You cannot block yourself" });
    }
    const blockedUser = await User.findById(req.params.userId).select("_id");
    if (!blockedUser) return res.status(404).json({ message: "User not found" });
    await User.updateOne(
      { _id: req.user.userId },
      { $addToSet: { blockedUsers: blockedUser._id } },
    );
    await FriendRequest.updateMany(
      {
        $or: [
          { sender: req.user.userId, recipient: blockedUser._id },
          { sender: blockedUser._id, recipient: req.user.userId },
        ],
      },
      { $set: { status: "rejected" } },
    );
    res.json({ message: "User blocked" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not block user" });
  }
};

exports.unblockUser = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ message: "User identifier is invalid" });
    }
    const result = await User.updateOne(
      { _id: req.user.userId },
      { $pull: { blockedUsers: req.params.userId } },
    );
    if (!result.matchedCount) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User unblocked" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not unblock user" });
  }
};

exports.listBlockedUsers = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.userId)
      .select("blockedUsers")
      .populate("blockedUsers", "name email phone");
    if (!currentUser) return res.status(404).json({ message: "User not found" });
    res.json({ blockedUsers: currentUser.blockedUsers });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not load blocked users" });
  }
};

exports.setTyping = async (req, res) => {
  try {
    const conversation = await getAccessibleConversation(
      req.params.conversationId,
      req.user.userId,
    );
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });
    if (req.body.isTyping === true) {
      typingUsers.set(typingKey(conversation.id, req.user.userId), Date.now() + 5000);
    } else {
      typingUsers.delete(typingKey(conversation.id, req.user.userId));
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not update typing status" });
  }
};

exports.getTyping = async (req, res) => {
  try {
    const conversation = await getAccessibleConversation(
      req.params.conversationId,
      req.user.userId,
    );
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });
    const otherUserId = conversation.participants.find(
      (participant) => String(participant) !== String(req.user.userId),
    );
    if (!otherUserId) return res.json({ isTyping: false });
    const key = typingKey(conversation.id, otherUserId);
    const expiresAt = typingUsers.get(key) ?? 0;
    if (expiresAt <= Date.now()) typingUsers.delete(key);
    res.json({ isTyping: expiresAt > Date.now() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not load typing status" });
  }
};

exports.uploadAttachment = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Choose a file to upload" });
    const { conversationId, clientId } = req.body;
    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(400).json({ message: "Conversation identifier is invalid" });
    }
    if (typeof clientId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(clientId)) {
      return res.status(400).json({ message: "Message identifier is invalid" });
    }
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user.userId,
    });
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });
    if (
      !conversation.isSelfChat &&
      conversation.participants.length === 2 &&
      !(await hasAcceptedFriendship(
        conversation.participants[0],
        conversation.participants[1],
      ))
    ) {
      return res.status(403).json({ message: "Friend request must be accepted to chat" });
    }
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    if (!cloudName || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(503).json({ message: "File uploads are not configured on this server" });
    }

    const cloudinary = require("cloudinary").v2;
    cloudinary.config({
      cloud_name: cloudName,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    const isImage = req.file.mimetype.startsWith("image/");
    const isVideoOrAudio =
      req.file.mimetype.startsWith("video/") ||
      req.file.mimetype.startsWith("audio/");
    const safeFileName = req.file.originalname
      .replace(/[^\w.-]/g, "_")
      .slice(-120) || "attachment";
    const uploadOptions = {
      folder: "connecta/messages",
      public_id: `${req.user.userId}_${clientId}_${safeFileName}`,
      overwrite: true,
      resource_type: isImage ? "image" : isVideoOrAudio ? "video" : "raw",
      ...(isImage
        ? { transformation: [{ quality: "auto:low", fetch_format: "auto", width: 1600, crop: "limit" }] }
        : {}),
    };
    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
      stream.end(req.file.buffer);
    });
    res.status(201).json({
      attachment: {
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        resourceType: uploaded.resource_type,
        mimeType: req.file.mimetype,
        fileName: req.file.originalname.slice(0, 180),
        size: uploaded.bytes,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not upload attachment" });
  }
};

exports.createConversation = async (req, res) => {
  try {
    const { self } = req.body;
    if (self === true) {
      const conversation = await ensureConversation(req.user.userId, null, true);
      await conversation.populate("participants", "name email phone");
      return res.json({ conversation, contact: { name: "My notes" } });
    }

    const { recipient } = req.body;
    if (typeof recipient !== "string" || !recipient.trim()) {
      return res.status(400).json({ message: "Recipient email or phone is required" });
    }
    const identifier = recipient.trim();
    const recipientUser = await User.findOne(
      identifier.includes("@")
        ? { email: identifier.toLowerCase() }
        : { phone: identifier },
    ).select("name email phone");
    if (!recipientUser) return res.status(404).json({ message: "Connecta user not found" });
    if (recipientUser._id.equals(req.user.userId)) {
      const conversation = await ensureConversation(req.user.userId, null, true);
      await conversation.populate("participants", "name email phone");
      return res.json({ conversation, contact: { name: "My notes" } });
    }

    if (!(await hasAcceptedFriendship(req.user.userId, recipientUser._id))) {
      return res.status(403).json({
        message: "You can chat after this person accepts your friend request",
      });
    }

    const conversation = await ensureConversation(
      req.user.userId,
      recipientUser._id,
    );

    await conversation.populate("participants", "name email phone");
    res.status(200).json({ conversation, contact: recipientUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not start conversation" });
  }
};

exports.listConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user.userId,
    })
      .sort({ lastMessageAt: -1 })
      .populate("participants", "name email phone");

    const result = await Promise.all(
      conversations.map(async (conversation) => {
        if (
          !conversation.isSelfChat &&
          conversation.participants.length === 2 &&
          !(await hasAcceptedFriendship(
            conversation.participants[0]._id,
            conversation.participants[1]._id,
          ))
        ) {
          return null;
        }
        const lastMessage = await Message.findOne({
          conversation: conversation._id,
          hiddenFor: { $ne: req.user.userId },
        })
          .sort({ createdAt: -1 })
          .select("text attachment deletedForEveryone createdAt sender");
        const unreadCount = await Message.countDocuments({
          conversation: conversation._id,
          sender: { $ne: req.user.userId },
          readAt: null,
        });
        return {
          ...conversation.toObject(),
          lastMessage: lastMessage?.deletedForEveryone
            ? "This message was deleted"
            : lastMessage?.text || (
                lastMessage?.attachment ? `Attachment: ${lastMessage.attachment.fileName}` : ""
              ),
          lastMessageAt: lastMessage?.createdAt ?? null,
          unreadCount,
        };
      }),
    );
    const visibleConversations = result.filter(Boolean);
    visibleConversations.sort(
      (first, second) =>
        new Date(second.lastMessageAt || 0).getTime() -
        new Date(first.lastMessageAt || 0).getTime(),
    );
    res.json({
      conversations: visibleConversations,
      currentUserId: String(req.user.userId),
      unreadCount: visibleConversations.reduce(
        (total, conversation) => total + conversation.unreadCount,
        0,
      ),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not load conversations" });
  }
};

exports.listMessages = async (req, res) => {
  try {
    const after = req.query.after;
    const since = after === undefined ? null : new Date(after);
    if (after !== undefined && Number.isNaN(since.getTime())) {
      return res.status(400).json({ message: "Message cursor is invalid" });
    }
    const conversation = await Conversation.findOne({
      _id: req.params.conversationId,
      participants: req.user.userId,
    });
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });
    if (
      !conversation.isSelfChat &&
      conversation.participants.length === 2 &&
      !(await hasAcceptedFriendship(
        conversation.participants[0],
        conversation.participants[1],
      ))
    ) {
      return res.status(403).json({ message: "Friend request must be accepted to chat" });
    }

    await Message.updateMany(
      {
        conversation: conversation._id,
        sender: { $ne: req.user.userId },
        readAt: null,
      },
      { $set: { readAt: new Date() } },
    );
    const messageQuery = { conversation: conversation._id };
    if (since) messageQuery.updatedAt = { $gte: since };
    messageQuery.hiddenFor = { $ne: req.user.userId };
    const messages = await Message.find(messageQuery)
      .sort({ createdAt: 1 })
      .populate("sender", "name email")
      .populate({
        path: "replyTo",
        select: "text sender attachment deletedForEveryone",
        populate: { path: "sender", select: "name" },
      });
    const unreadCount = await Message.countDocuments({
      conversation: { $ne: conversation._id },
      sender: { $ne: req.user.userId },
      readAt: null,
    });
    res.json({
      messages,
      currentUserId: String(req.user.userId),
      unreadCount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not load messages" });
  }
};

exports.forwardMessage = async (req, res) => {
  try {
    const { recipientId } = req.body;
    if (!mongoose.isValidObjectId(recipientId)) {
      return res.status(400).json({ message: "Recipient identifier is invalid" });
    }
    const sourceConversation = await getAccessibleConversation(
      req.params.conversationId,
      req.user.userId,
    );
    if (!sourceConversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    if (String(recipientId) === String(req.user.userId)) {
      return res.status(400).json({ message: "Choose a different recipient" });
    }
    if (!(await hasAcceptedFriendship(req.user.userId, recipientId))) {
      return res.status(403).json({ message: "You can forward messages to accepted friends only" });
    }
    const sourceMessage = await Message.findOne({
      _id: req.params.messageId,
      conversation: sourceConversation._id,
      deletedForEveryone: { $ne: true },
      hiddenFor: { $ne: req.user.userId },
    });
    if (!sourceMessage) return res.status(404).json({ message: "Message not found" });
    const targetConversation = await ensureConversation(req.user.userId, recipientId);
    const message = await Message.create({
      conversation: targetConversation._id,
      sender: req.user.userId,
      text: sourceMessage.text,
      attachment: sourceMessage.attachment?.url ? sourceMessage.attachment : undefined,
      forwarded: true,
    });
    targetConversation.lastMessage = message.text || (
      message.attachment ? `Attachment: ${message.attachment.fileName}` : ""
    );
    targetConversation.lastMessageAt = message.createdAt;
    await targetConversation.save();
    res.status(201).json({ message });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not forward message" });
  }
};

exports.updateMessage = async (req, res) => {
  try {
    const conversation = await getAccessibleConversation(
      req.params.conversationId,
      req.user.userId,
    );
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });
    const { text } = req.body;
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ message: "Message text is required" });
    }
    if (text.trim().length > 2000) {
      return res.status(400).json({ message: "Messages cannot exceed 2000 characters" });
    }
    const message = await Message.findOne({
      _id: req.params.messageId,
      conversation: conversation._id,
      sender: req.user.userId,
      deletedForEveryone: { $ne: true },
      attachment: { $exists: false },
    });
    if (!message) return res.status(404).json({ message: "Editable text message not found" });
    if (Date.now() - message.createdAt.getTime() > 15 * 60 * 1000) {
      return res.status(403).json({ message: "Messages can only be edited within 15 minutes" });
    }
    message.text = text.trim();
    message.editedAt = new Date();
    await message.save();
    await refreshConversationPreview(message.conversation);
    res.json({ message });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not edit message" });
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    const conversation = await getAccessibleConversation(
      req.params.conversationId,
      req.user.userId,
    );
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });
    const deleteForEveryone = req.body.deleteForEveryone === true;
    const query = {
      _id: req.params.messageId,
      conversation: conversation._id,
      hiddenFor: { $ne: req.user.userId },
    };
    if (deleteForEveryone) query.sender = req.user.userId;
    const message = await Message.findOne(query);
    if (!message) return res.status(404).json({ message: "Message not found" });
    if (deleteForEveryone) {
      if (message.deletedForEveryone) {
        return res.status(409).json({ message: "Message has already been deleted" });
      }
      if (Date.now() - message.createdAt.getTime() > 2 * 24 * 60 * 60 * 1000) {
        return res.status(403).json({ message: "Messages can only be deleted for everyone within 2 days" });
      }
      message.text = "";
      message.attachment = undefined;
      message.deletedForEveryone = true;
      message.reactions = [];
      await message.save();
      await refreshConversationPreview(message.conversation);
      return res.json({ message, deleteForEveryone: true });
    }
    if (!message.hiddenFor.some(
      (userId) => String(userId) === String(req.user.userId),
    )) {
      message.hiddenFor.push(req.user.userId);
    }
    await message.save();
    res.json({ messageId: message._id, deleteForEveryone: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not delete message" });
  }
};

exports.reactToMessage = async (req, res) => {
  try {
    const conversation = await getAccessibleConversation(
      req.params.conversationId,
      req.user.userId,
    );
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });
    const { emoji } = req.body;
    if (typeof emoji !== "string" || !/^(👍|❤️|😂|😮|😢|🙏)$/.test(emoji)) {
      return res.status(400).json({ message: "Reaction is not supported" });
    }
    const message = await Message.findOne({
      _id: req.params.messageId,
      conversation: conversation._id,
      deletedForEveryone: { $ne: true },
      hiddenFor: { $ne: req.user.userId },
    });
    if (!message) return res.status(404).json({ message: "Message not found" });
    const hadSameReaction = message.reactions.some(
      (reaction) => String(reaction.user) === String(req.user.userId) &&
        reaction.emoji === emoji,
    );
    message.reactions = message.reactions.filter(
      (reaction) => String(reaction.user) !== String(req.user.userId),
    );
    if (!hadSameReaction) message.reactions.push({ user: req.user.userId, emoji });
    await message.save();
    res.json({ messageId: message._id, reactions: message.reactions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not update reaction" });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const { text = "", attachment, clientId, replyTo } = req.body;
    if (typeof text !== "string") {
      return res.status(400).json({ message: "Message text must be text" });
    }
    if (text.trim().length > 2000) {
      return res.status(400).json({ message: "Messages cannot exceed 2000 characters" });
    }
    if (!text.trim() && !attachment) {
      return res.status(400).json({ message: "Write a message or attach a file" });
    }
    if (
      attachment &&
      (typeof attachment.url !== "string" ||
        !attachment.url.startsWith(`https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/`) ||
        typeof attachment.publicId !== "string" ||
        typeof attachment.fileName !== "string" ||
        !["image", "raw", "video"].includes(attachment.resourceType))
    ) {
      return res.status(400).json({ message: "Attachment details are invalid" });
    }
    if (clientId !== undefined && (
      typeof clientId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(clientId)
    )) {
      return res.status(400).json({ message: "Message identifier is invalid" });
    }

    const conversation = await Conversation.findOne({
      _id: req.params.conversationId,
      participants: req.user.userId
    });
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });

    if (
      !conversation.isSelfChat &&
      conversation.participants.length === 2 &&
      !(await hasAcceptedFriendship(
        conversation.participants[0],
        conversation.participants[1],
      ))
    ) {
      return res.status(403).json({ message: "Friend request must be accepted to chat" });
    }

    let replyMessage;
    if (replyTo !== undefined) {
      if (!mongoose.isValidObjectId(replyTo)) {
        return res.status(400).json({ message: "Reply target is invalid" });
      }
      replyMessage = await Message.findOne({
        _id: replyTo,
        conversation: conversation._id,
        deletedForEveryone: { $ne: true },
        hiddenFor: { $ne: req.user.userId },
      });
      if (!replyMessage) {
        return res.status(404).json({ message: "Reply target not found" });
      }
    }
    const messageData = {
      conversation: conversation._id,
      sender: req.user.userId,
      text: text.trim(),
      attachment,
      clientId,
      replyTo: replyMessage?._id,
    };
    let message;
    if (clientId) {
      message = await Message.findOneAndUpdate(
        { sender: req.user.userId, clientId },
        { $setOnInsert: messageData },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
      );
    } else {
      message = await Message.create(messageData);
    }
    conversation.lastMessage = message.text;
    if (!message.text && message.attachment) {
      conversation.lastMessage = `Attachment: ${message.attachment.fileName}`;
    }
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();

    res.status(201).json({ message: message.toObject() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not send message" });
  }
};
