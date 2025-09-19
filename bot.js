// Asosiy bot fayli
const BotConfig = require('./config/bot');
const DatabaseConfig = require('./config/database');
const BotHandlers = require('./controllers/botHandlers');
const ReminderService = require('./services/reminderService');

async function startBot() {
  try {
    // Database ga ulanish
    await DatabaseConfig.connect();
    
    // Bot yaratish
    const bot = BotConfig.createBot();
    
    // Bot handlers ni sozlash
    new BotHandlers(bot);
    
    // Eslatmalar xizmatini ishga tushirish
    new ReminderService(bot);
    
    // Bot ni ishga tushirish
    await BotConfig.startBot(bot);
    
    // Graceful shutdown ni sozlash
    BotConfig.setupGracefulShutdown(bot);
    
  } catch (error) {
    console.error("❌ Bot ishga tushirishda xatolik:", error);
    process.exit(1);
  }
}

// Bot ni ishga tushirish
startBot();