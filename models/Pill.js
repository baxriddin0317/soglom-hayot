const mongoose = require("mongoose");

const pillSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Prescription" },
  name: { type: String, required: true },
  dosagePerDay: { type: Number, required: true },
  times: [{ type: String, required: true }], // e.g. ["08:00", "13:00", "20:00"]
  isActive: { type: Boolean, default: true },
  startDate: { type: Date, default: Date.now },
  endDate: Date,
  createdAt: { type: Date, default: Date.now }
});

// Dori ichish tarixi uchun alohida schema
const pillHistorySchema = new mongoose.Schema({
  pillId: { type: mongoose.Schema.Types.ObjectId, ref: "Pill", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  scheduledTime: { type: String, required: true }, // "08:00"
  actualTime: { type: Date, default: Date.now },
  status: { type: String, enum: ["taken", "missed", "pending"], default: "pending" },
  date: { type: String, required: true }, // "2024-01-15"
  reminderSent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const Pill = mongoose.model("Pill", pillSchema);
const PillHistory = mongoose.model("PillHistory", pillHistorySchema);

module.exports = { Pill, PillHistory };
