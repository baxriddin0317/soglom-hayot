const { Markup } = require("telegraf");

class Keyboards {
  // Asosiy menyu
  static getMainMenu() {
    return Markup.keyboard([
      ["💊 Yangi retsept qo'shish", "📋 Mening dorilarim"],
      ["⏰ Eslatmalar", "📊 Kunlik hisobot"],
      ["🧾 Kasallik tarixi"],
      ["ℹ️ Biz haqida", "⚙️ Sozlamalar"],
      ["Asosiy menyu"]
    ]).resize();
  }

  // Dori qo'shish menyusi
  static getAddPillMenu() {
    return Markup.keyboard([
      ["🔙 Orqaga"]
    ]).resize();
  }

  // Vaqt tanlash menyusi
  static getTimeMenu() {
    return Markup.keyboard([
      ["08:00", "09:00", "10:00"],
      ["11:00", "12:00", "13:00"],
      ["14:00", "15:00", "16:00"],
      ["17:00", "18:00", "19:00"],
      ["20:00", "21:00", "22:00"],
      ["✅ Vaqtlarni tasdiqlash", "🔙 Orqaga"]
    ]).resize();
  }

  // Dori ichishni tasdiqlash menyusi
  static getConfirmMenu(historyId) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("✅ Ichdim", `taken_${historyId}`), 
       Markup.button.callback("❌ O'tkazib yubordim", `missed_${historyId}`)]
    ]);
  }

  // Dori ro'yxati menyusi
  static getPillListMenu(pills) {
    // Raqamlarni foydalanuvchi qo'lda kiritadi; faqat navigatsiya tugmalari ko'rsatiladi
    return Markup.keyboard([["🔙 Orqaga"]]).resize();
  }

  // Dori boshqaruv menyusi
  static getPillManageMenu() {
    return Markup.keyboard([
      ["✏️ Tahrirlash", "🗑️ O'chirish"],
      ["🔙 Orqaga"]
    ]).resize();
  }

  // Dori tahrirlash menyusi
  static getPillEditMenu() {
    return Markup.keyboard([
      ["📝 Nomi", "🔢 Kunilik miqdor"],
      ["⏰ Vaqtlar"],
      ["🔙 Orqaga"]
    ]).resize();
  }

  // Sozlamalar menyusi
  static getSettingsMenu() {
    return Markup.keyboard([
      ["🕐 Vaqt zonasi", "🔔 Eslatma sozlamalari"],
      ["🔙 Orqaga"]
    ]).resize();
  }

  // Eslatma sozlamalari menyusi
  static getReminderSettingsMenu(remindersEnabled, leadMinutes) {
    const enabledText = remindersEnabled ? "✅ Yoqilgan" : "❌ O'chirilgan";
    return Markup.keyboard([
      [enabledText === "✅ Yoqilgan" ? "🔕 Eslatmalarni o'chirish" : "🔔 Eslatmalarni yoqish"],
      ["⏱️ Eslatma oldindan (daqiqa)"] ,
      ["🔙 Orqaga"]
    ]).resize();
  }

  // Vaqt zonasi menyusi (asosiy tanlovlar)
  static getTimezoneMenu() {
    return Markup.keyboard([
      ["Asia/Tashkent", "Asia/Samarkand"],
      ["Europe/Moscow", "Asia/Almaty"],
      ["UTC", "Boshqa (yozish)"] ,
      ["🔙 Orqaga"]
    ]).resize();
  }

  // Tasdiqlash menyusi
  static getConfirmationMenu(action) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("✅ Ha", `confirm_${action}`), 
       Markup.button.callback("❌ Yo'q", `cancel_${action}`)]
    ]);
  }
}

module.exports = Keyboards;
