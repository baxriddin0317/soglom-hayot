const cron = require("node-cron");
const DatabaseService = require('./databaseService');
const { Markup } = require("telegraf");

class ReminderService {
  constructor(bot) {
    this.bot = bot;
    this.currentHourTimeouts = [];
    this.setupCronJobs();
    // Dastur ishga tushganda joriy soat uchun darhol rejalashtirib qo'yamiz
    this.scheduleHourlyReminders();
  }

  setupCronJobs() {
    // Har soat boshida: shu soat ichidagi eslatmalarni (masalan 14:00, 14:30 ...) rejalashtirish
    cron.schedule('0 * * * *', this.scheduleHourlyReminders.bind(this));
    // Har soat oxirida: yuborilmay qolganlarni yakuniy tekshirish (dupning oldi uchun reminderSent flag bor)
    cron.schedule('59 * * * *', this.finalizeHourlyReminders.bind(this));
    // Har kuni 00:02 da tugagan retseptlarni yakunlash va pillarni faol emasga o'tkazish
    cron.schedule('2 0 * * *', this.completeEndedCourses.bind(this));
    
    // Har kuni ertalab 00:01 da bugungi kun uchun pill history yaratish
    cron.schedule('1 0 * * *', this.createDailyPillHistory.bind(this));
  }

  // Shu soat uchun eslatmalarni rejalashtirish
  async scheduleHourlyReminders() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const hour = now.toTimeString().slice(0, 2); // "HH"

    // Oldingi timeoutlarni tozalash
    for (const t of this.currentHourTimeouts) {
      clearTimeout(t);
    }
    this.currentHourTimeouts = [];

    console.log(`⏳ ${hour}:00 uchun eslatmalar rejalashtirilmoqda...`);

    try {
      const histories = await DatabaseService.getPendingRemindersForHour(hour, today);

      for (const history of histories) {
        const [h, m] = history.scheduledTime.split(':').map(Number);
        const target = new Date(now);
        target.setHours(h, m, 0, 0);

        const delayMs = target.getTime() - now.getTime();

        if (delayMs <= 0) {
          // Agar vaqt allaqachon o'tib ketgan bo'lsa, darhol yuboramiz
          this.sendReminder(history);
        } else {
          const timeout = setTimeout(() => {
            this.sendReminder(history);
          }, delayMs);
          this.currentHourTimeouts.push(timeout);
        }
      }

      console.log(`🗓️ ${histories.length} ta eslatma shu soat ichida yuborishga rejalashtirildi`);
    } catch (error) {
      console.error('❌ Soatlik eslatmalarni rejalashtirishda xatolik:', error);
    }
  }

  // Soat oxirida yuborilmay qolgan pendinglarni tekshirish va yuborish
  async finalizeHourlyReminders() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const hour = now.toTimeString().slice(0, 2); // joriy soat
    try {
      const histories = await DatabaseService.getPendingRemindersForHour(hour, today);
      for (const history of histories) {
        await this.sendReminder(history);
      }
      console.log(`🔁 Soat oxiri tekshiruvi: ${histories.length} ta eslatma qayta ko'rib chiqildi`);
    } catch (error) {
      console.error('❌ Soat oxiri tekshiruvida xatolik:', error);
    }
  }

  // Eslatmalarni tekshirish va yuborish
  async checkReminders() {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5); // "HH:MM" format
    const today = now.toISOString().split('T')[0];
    
    console.log(`🔍 Eslatmalar tekshirilmoqda: ${currentTime}`);
    
    try {
      // Hozirgi vaqtda eslatma berish kerak bo'lgan dorilarni topish
      const histories = await DatabaseService.getPendingReminders(currentTime, today);
      
      console.log(`📋  ${histories.length} ta eslatma topildi`);
      
      for (const history of histories) {
        await this.sendReminder(history);
      }
    } catch (error) {
      console.error('❌ Eslatmalar tekshirishda xatolik:', error);
    }
  }

  // Eslatma yuborish
  async sendReminder(history) {
    const user = history.userId;
    const pill = history.pillId;
    const currentTime = history.scheduledTime;
    
    const message = `⏰ Dori qabul qilish vaqti!\n\n💊 ${pill.name}\n🕐 ${currentTime}\n\nDoringizni ichdingizmi?`;
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("✅ Ichdim", `taken_${history._id}`), 
       Markup.button.callback("❌ O'tkazib yubordim", `missed_${history._id}`)]
    ]);
    
    try {
      // Duplicateni oldini olish: bazada tekshirib, flag qo'yish
      if (history.reminderSent) {
        return;
      }
      await this.bot.telegram.sendMessage(user.telegramId, message, { reply_markup: keyboard.reply_markup });
      await DatabaseService.markReminderSent(history._id);
      console.log(`📤 Eslatma yuborildi: ${user.firstName} - ${pill.name} (${currentTime})`);
    } catch (error) {
      console.error(`❌ Foydalanuvchi ${user.telegramId} ga xabar yuborishda xatolik:`, error);
    }
  }

  // Kunlik pill history yaratish
  async createDailyPillHistory() {
    console.log('🌅 Yangi kun - pill history yaratilmoqda...');
    
    try {
      const results = await DatabaseService.createDailyPillHistory();
      console.log(`✅ ${results.length} ta pill history yaratildi`);
    } catch (error) {
      console.error('❌ Kunlik pill history yaratishda xatolik:', error);
    }
  }

  // Eslatma qo'shish (kelajakda ishlatish uchun)
  async addReminder(pillId, userId, scheduledTime, date) {
    return await DatabaseService.createPillHistory(pillId, userId, scheduledTime, date);
  }

  // Eslatma o'chirish
  async removeReminder(historyId) {
    return await DatabaseService.updatePillHistory(historyId, { status: "cancelled" });
  }

  // Foydalanuvchi eslatmalarini olish
  async getUserReminders(userId, date) {
    return await DatabaseService.getPillHistory(userId, date);
  }

  // Bugungi eslatmalarni olish
  async getTodaysReminders(userId) {
    return await DatabaseService.getTodaysPillHistory(userId);
  }

  async completeEndedCourses() {
    try {
      const ended = await DatabaseService.completeEndedPrescriptions();
      if (ended.length > 0) {
        for (const course of ended) {
          // Istasak: foydalanuvchiga kurs yakunlangani haqida xabar yuborish
          // Bu yerda course.userId ni populate qilmaganimiz uchun xabar yuborishni hozircha o'tkazamiz
        }
        console.log(`🏁 ${ended.length} ta retsept yakunlandi`);
      }
    } catch (e) {
      console.error('❌ Retseptlarni yakunlashda xatolik:', e);
    }
  }
}

module.exports = ReminderService;
