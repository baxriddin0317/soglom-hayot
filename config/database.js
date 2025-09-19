const mongoose = require("mongoose");
require("dotenv").config();

class DatabaseConfig {
  static async connect() {
    try {
      if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI muhit o'zgaruvchisi topilmadi!");
      }

      await mongoose.connect(process.env.MONGODB_URI);
      console.log("✅ MongoDB ga ulandi");
    } catch (error) {
      console.error("❌ MongoDB ulanishida xatolik:", error);
      process.exit(1);
    }
  }

  static async disconnect() {
    try {
      await mongoose.disconnect();
      console.log("✅ MongoDB ulanishi uzildi");
    } catch (error) {
      console.error("❌ MongoDB ulanishini uzishda xatolik:", error);
    }
  }
}

module.exports = DatabaseConfig;
