const mongoose = require("mongoose");

const medicalHistoryItemSchema = new mongoose.Schema({
  pillId: { type: mongoose.Schema.Types.ObjectId, ref: "Pill", required: true },
  name: { type: String, required: true },
  time: { type: String, required: true } // HH:MM
}, { _id: false });

const medicalHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  items: { type: [medicalHistoryItemSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

medicalHistorySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("MedicalHistory", medicalHistorySchema);


