const mongoose = require("mongoose");

const prescriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  startDate: { type: String, required: true }, // YYYY-MM-DD
  endDate: { type: String, required: true },   // YYYY-MM-DD
  pillCount: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["active", "completed"], default: "active" }
});

module.exports = mongoose.model("Prescription", prescriptionSchema);


