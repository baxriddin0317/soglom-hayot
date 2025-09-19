const { Telegraf } = require("telegraf");
require("dotenv").config();

class BotConfig {
  static createBot() {
    if (!process.env.BOT_TOKEN) {
      console.error("❌ BOT_TOKEN muhit o'zgaruvchisi topilmadi!");
      process.exit(1);
    }

    const bot = new Telegraf(process.env.BOT_TOKEN);
    
    // Xatolikni qayta ishlash
    bot.catch((err, ctx) => {
      console.error(`❌ Xatolik yuz berdi: ${err.message}`);
      ctx.reply("Kechirasiz, xatolik yuz berdi. Iltimos, keyinroq urinib ko'ring.");
    });

    return bot;
  }

  static async startBot(bot) {
    try {
      await bot.launch();
      console.log("🚀 Bot muvaffaqiyatli ishga tushdi!");
      console.log("📱 Telegram bot: @your_bot_username");
    } catch (error) {
      console.error("❌ Bot ishga tushirishda xatolik:", error.message);
      process.exit(1);
    }
  }

  static setupGracefulShutdown(bot) {
    // Graceful shutdown
    process.once("SIGINT", () => {
      console.log("🛑 Bot to'xtatilmoqda...");
      bot.stop("SIGINT");
    });

    process.once("SIGTERM", () => {
      console.log("🛑 Bot to'xtatilmoqda...");
      bot.stop("SIGTERM");
    });
  }
}

module.exports = BotConfig;
