class Helpers {
  // Vaqtni formatlash
  static formatTime(date) {
    return date.toTimeString().slice(0, 5); // "HH:MM" format
  }

  // Sana formatlash
  static formatDate(date) {
    return date.toISOString().split('T')[0]; // "YYYY-MM-DD" format
  }

  // Bugungi sana
  static getToday() {
    return this.formatDate(new Date());
  }

  // Hozirgi vaqt
  static getCurrentTime() {
    return this.formatTime(new Date());
  }

  // Vaqt tekshirish (kelajakdagi vaqtmi?)
  static isFutureTime(time) {
    const currentTime = this.getCurrentTime();
    return time > currentTime;
  }

  // Vaqt validatsiyasi
  static isValidTime(time) {
    return /^\d{2}:\d{2}$/.test(time);
  }

  // Raqam validatsiyasi
  static isValidNumber(num, min = 1, max = 10) {
    const number = parseInt(num);
    return !isNaN(number) && number >= min && number <= max;
  }

  // Xabar formatlash
  static formatPillMessage(pill, status = "pending") {
    const statusEmoji = {
      "taken": "✅",
      "missed": "❌",
      "pending": "⏰"
    };
    
    return `${statusEmoji[status]} ${pill.times.join(", ")} - ${pill.name}`;
  }

  // Hisobot xabarini formatlash
  static formatReportMessage(stats, date) {
    let message = `📊 Bugungi hisobot (${date}):\n\n`;
    message += `✅ Ichilgan: ${stats.taken} ta\n`;
    message += `❌ O'tkazib yuborilgan: ${stats.missed} ta\n`;
    message += `⏰ Kutayotgan: ${stats.pending} ta\n\n`;
    
    if (stats.histories && stats.histories.length > 0) {
      message += "Batafsil:\n";
      stats.histories.forEach(history => {
        const statusEmoji = history.status === "taken" ? "✅" : 
                           history.status === "missed" ? "❌" : "⏰";
        message += `${statusEmoji} ${history.scheduledTime} - ${history.pillId.name}\n`;
      });
    }
    
    return message;
  }

  // Eslatma xabarini formatlash
  static formatReminderMessage(pillName, time) {
    return `⏰ Dori vaqti!\n\n💊 ${pillName}\n🕐 ${time}\n\nDoringizni ichdingizmi?`;
  }

  // Xatolik xabarini formatlash
  static formatErrorMessage(error) {
    return `❌ Xatolik yuz berdi: ${error.message}\n\nIltimos, keyinroq urinib ko'ring.`;
  }

  // Muvaffaqiyat xabarini formatlash
  static formatSuccessMessage(message) {
    return `✅ ${message}`;
  }

  // Ma'lumot xabarini formatlash
  static formatInfoMessage(message) {
    return `ℹ️ ${message}`;
  }

  // Ogohlantirish xabarini formatlash
  static formatWarningMessage(message) {
    return `⚠️ ${message}`;
  }

  // Dori ro'yxatini formatlash
  static formatPillList(pills) {
    if (pills.length === 0) {
      return "📋 Hozircha dorilaringiz yo'q.";
    }
    
    let message = "📋 Sizning dorilaringiz:\n\n";
    pills.forEach((pill, index) => {
      message += `${index + 1}. ${pill.name}\n`;
      message += `   Kunlik: ${pill.dosagePerDay} marta\n`;
      message += `   Vaqtlar: ${pill.times.join(", ")}\n\n`;
    });
    
    return message;
  }

  // Eslatmalar ro'yxatini formatlash
  static formatRemindersList(reminders) {
    if (reminders.length === 0) {
      return "⏰ Bugun eslatmalar yo'q.";
    }
    
    let message = "⏰ Bugungi eslatmalar:\n\n";
    reminders.forEach(reminder => {
      const statusEmoji = reminder.status === "taken" ? "✅" : 
                         reminder.status === "missed" ? "❌" : "⏰";
      message += `${statusEmoji} ${reminder.scheduledTime} - ${reminder.pillId.name}\n`;
    });
    
    return message;
  }

  // Vaqt ro'yxatini tartiblash
  static sortTimes(times) {
    return times.sort();
  }

  // Unique vaqtlarni olish
  static getUniqueTimes(times) {
    return [...new Set(times)];
  }

  // Vaqt qo'shish
  static addTime(times, newTime) {
    if (!this.isValidTime(newTime)) {
      return { success: false, error: "Noto'g'ri vaqt formati" };
    }
    
    if (times.includes(newTime)) {
      return { success: false, error: "Bu vaqt allaqachon qo'shilgan" };
    }
    
    const newTimes = [...times, newTime];
    return { success: true, times: this.sortTimes(newTimes) };
  }

  // Vaqt o'chirish
  static removeTime(times, timeToRemove) {
    if (!times.includes(timeToRemove)) {
      return { success: false, error: "Bu vaqt topilmadi" };
    }
    
    const newTimes = times.filter(time => time !== timeToRemove);
    return { success: true, times: this.sortTimes(newTimes) };
  }
}

module.exports = Helpers;
