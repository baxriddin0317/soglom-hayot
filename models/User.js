const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String, default: "" },
  username: { type: String, default: "" },
  language: { type: String, default: "uz" },
  timezone: { type: String, default: "Asia/Tashkent" },
  remindersEnabled: { type: Boolean, default: true },
  reminderLeadMinutes: { type: Number, default: 0 },
  isFirstTime: { type: Boolean, default: true },
  lastActive: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);
