const { Markup } = require("telegraf");
const DatabaseService = require('../services/databaseService');
const { useUserStore, usePillStore, useSettingsStore } = require('../utils/store');
const Keyboards = require('../utils/keyboards');

class BotHandlers {
  constructor(bot) {
    this.bot = bot;
    this.setupHandlers();
  }

  setupHandlers() {
    // /start command handler
    this.bot.start(this.handleStart.bind(this));
    
    // Button handlers
    this.bot.hears("💊 Yangi retsept qo'shish", this.handleAddPill.bind(this));
    this.bot.hears("📋 Mening dorilarim", this.handleMyPills.bind(this));
    this.bot.hears("⏰ Eslatmalar", this.handleReminders.bind(this));
    this.bot.hears("📊 Kunlik hisobot", this.handleDailyReport.bind(this));
    this.bot.hears("🧾 Kasallik tarixi", this.handleHistory.bind(this));
    this.bot.hears("ℹ️ Biz haqida", this.handleAbout.bind(this));
    this.bot.hears("⚙️ Sozlamalar", this.handleSettings.bind(this));
    this.bot.hears("🕐 Vaqt zonasi", this.handleTimezoneSettings.bind(this));
    this.bot.hears("🔔 Eslatma sozlamalari", this.handleReminderSettings.bind(this));
    this.bot.hears(["🔕 Eslatmalarni o'chirish", "🔔 Eslatmalarni yoqish"], this.toggleReminders.bind(this));
    this.bot.hears("⏱️ Eslatma oldindan (daqiqa)", this.promptLeadMinutes.bind(this));
    this.bot.hears("🔙 Orqaga", this.handleBack.bind(this));
    // Asosiy menyuga qaytish uchun universal handlerlar
    this.bot.hears(["Asosiy menyu", "🔙 Asosiy menyu", "Asosiy menyuga qaytish"], this.handleGoHome.bind(this));
    
    // Text message handler
    this.bot.on('text', this.handleTextMessage.bind(this));
    
    // Callback query handler
    this.bot.action(/^(taken|missed)_(.+)$/, this.handlePillConfirmation.bind(this));
  }

  // Asosiy menyu
  getMainMenu() {
    return Markup.keyboard([
      ["💊 Yangi retsept qo'shish", "📋 Mening dorilarim"],
      ["⏰ Eslatmalar", "📊 Kunlik hisobot"],
      ["🧾 Kasallik tarixi"],
      ["ℹ️ Biz haqida", "⚙️ Sozlamalar"]
    ]).resize();
  }

  // Dori qo'shish menyusi
  getAddPillMenu() {
    return Markup.keyboard([
      ["🔙 Asosiy menyu"]
    ]).resize();
  }

  // Vaqt tanlash menyusi (dinamik filtrlash bilan)
  getTimeMenu(includeConfirm = false, options = {}) {
    const { minTime = null, excludeTimes = [] } = options;
    const allTimes = [
      "08:00","09:00","10:00",
      "11:00","12:00","13:00",
      "14:00","15:00","16:00",
      "17:00","18:00","19:00",
      "20:00","21:00","22:00"
    ];
    const filtered = allTimes.filter((t) => {
      if (excludeTimes.includes(t)) return false;
      if (minTime && t < minTime) return false;
      return true;
    });
    const rows = [];
    for (let i = 0; i < filtered.length; i += 3) {
      rows.push(filtered.slice(i, i + 3));
    }
    if (includeConfirm) {
      rows.push(["✅ Vaqtlarni tasdiqlash", "🔙 Orqaga"]);
    } else {
      rows.push(["🔙 Orqaga"]);
    }
    return Markup.keyboard(rows).resize();
  }

  // Yordamchi: vaqtga soat qo'shish (HH:MM)
  addHours(timeHHMM, hoursToAdd) {
    const [h, m] = timeHHMM.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    d.setHours(d.getHours() + hoursToAdd);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // Dori ichishni tasdiqlash menyusi
  getConfirmMenu(historyId) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("✅ Ichdim", `taken_${historyId}`), 
       Markup.button.callback("❌ O'tkazib yubordim", `missed_${historyId}`)]
    ]);
  }

  // /start command handler
  async handleStart(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    
    // Store ga foydalanuvchini saqlash
    useUserStore.getState().setUser(user.telegramId, {
      id: user._id,
      telegramId: user.telegramId,
      firstName: user.firstName,
      isFirstTime: user.isFirstTime
    });
    
    let welcomeMessage = `
👋 Salom, ${user.firstName}! 

🏥 Soglom Hayot - Dori eslatuvchi botga xush kelibsiz!

Bu bot sizga quyidagi xizmatlarni taqdim etadi:
• 💊 Dorilaringizni qo'shish va boshqarish
• ⏰ Vaqtida eslatmalar olish
• 📊 Dorilar olish tarixini kuzatish
• 📋 Barcha dorilaringiz ro'yxatini ko'rish

Boshlash uchun quyidagi tugmalardan birini tanlang:
    `;
    
    // Agar foydalanuvchi avval botdan foydalangan bo'lsa
    if (!user.isFirstTime) {
      const userPills = await DatabaseService.getUserPills(user._id);
      if (userPills.length > 0) {
        welcomeMessage += `\n\n📋 Sizning faol dorilaringiz: ${userPills.length} ta`;
        welcomeMessage += `\n\n🔄 Eski retseptlarni ko'rish uchun "Mening dorilarim" tugmasini bosing.`;
      }
    }
    
    ctx.reply(welcomeMessage, this.getMainMenu());
    
    // Birinchi marta kelgan foydalanuvchi uchun
    if (user.isFirstTime) {
      await DatabaseService.updateUser(user.telegramId, { isFirstTime: false });
    }
  }

  // "Yangi retsept qo'shish" tugmasi
  async handleAddPill(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    
    // Store ga dori qo'shish holatini saqlash
    usePillStore.getState().setPillState(user.telegramId, {
      step: "pill_name",
      data: {}
    });
    
    ctx.reply("💊 Yangi dori qo'shish\n\nDori nomini kiriting:", this.getAddPillMenu());
  }

  // "Mening dorilarim" tugmasi
  async handleMyPills(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    const pills = await DatabaseService.getUserPills(user._id);
    
    if (pills.length === 0) {
      ctx.reply("📋 Hozircha dorilaringiz yo'q.\n\nYangi dori qo'shish uchun \"Yangi retsept qo'shish\" tugmasini bosing.", this.getMainMenu());
      return;
    }
    
    let message = "📋 Sizning dorilaringiz:\n\n";
    pills.forEach((pill, index) => {
      message += `${index + 1}. ${pill.name}\n`;
      message += `   Kunlik: ${pill.dosagePerDay} marta\n`;
      message += `   Vaqtlar: ${pill.times.join(", ")}\n\n`;
    });
    
    message += "Dorini o'chirish yoki tahrirlash uchun dori raqamini yuboring:";
    
    // Raqam kutilayotgan holatni saqlaymiz
    usePillStore.getState().setPillState(user.telegramId, {
      step: "manage_select",
      data: { pills }
    });
    
    ctx.reply(message, Keyboards.getPillListMenu(pills));
  }

  // "Eslatmalar" tugmasi
  async handleReminders(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    const today = new Date().toISOString().split('T')[0];
    const histories = (await DatabaseService.getPillHistory(user._id, today)).filter(h => h.status !== 'cancelled');
    
    if (!histories || histories.length === 0) {
      ctx.reply("⏰ Bugun uchun eslatmalar topilmadi.", this.getMainMenu());
      return;
    }
    
    const sorted = histories.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
    let message = "⏰ Bugungi eslatmalar:\n\n";
    for (const h of sorted) {
      const statusEmoji = h.status === "taken" ? "✅" : h.status === "missed" ? "❌" : "⏰";
      message += `${statusEmoji} ${h.scheduledTime} - ${h.pillId.name}\n`;
    }
    ctx.reply(message, this.getMainMenu());
  }

  // "Kunlik hisobot" tugmasi
  async handleDailyReport(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    const today = new Date().toISOString().split('T')[0];
    const stats = await DatabaseService.getDailyStats(user._id, today);
    
    if (stats.total === 0) {
      ctx.reply("📊 Bugun hali hech qanday dori ichilmagan.", this.getMainMenu());
      return;
    }
    
    let message = `📊 Bugungi hisobot (${today}):\n\n`;
    message += `✅ Ichilgan: ${stats.taken} ta\n`;
    message += `❌ O'tkazib yuborilgan: ${stats.missed} ta\n`;
    message += `⏰ Kutayotgan: ${stats.pending} ta\n\n`;
    
    message += "Batafsil:\n";
    stats.histories.forEach(history => {
      const statusEmoji = history.status === "taken" ? "✅" : history.status === "missed" ? "❌" : "⏰";
      message += `${statusEmoji} ${history.scheduledTime} - ${history.pillId.name}\n`;
    });
    
    ctx.reply(message, this.getMainMenu());
  }

  // Kasallik tarixi (ichilgan dorilar) ro'yxati
  async handleHistory(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    // Oxirgi 30 kun (MedicalHistory dan)
    const today = new Date();
    const start = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
    const startDate = start.toISOString().split('T')[0];
    const endDate = today.toISOString().split('T')[0];
    const groupedDocs = await DatabaseService.getMedicalHistoryByDate(user._id, startDate, endDate);
    const activePills = await DatabaseService.getUserPills(user._id);
    
    if ((!groupedDocs || groupedDocs.length === 0) && activePills.length === 0) {
      ctx.reply("🧾 Tarix topilmadi.", this.getMainMenu());
      return;
    }
    let message = `🧾 Oxirgi 30 kun tarixi (sana bo'yicha):\n\n`;
    for (const day of groupedDocs) {
      message += `📅 ${day.date}\n`;
      const items = (day.items || []).sort((a,b) => a.time.localeCompare(b.time));
      items.forEach(it => { message += `  ⏰ ${it.time} — ${it.name}\n`; });
      message += `\n`;
    }
    if (activePills.length > 0) {
      message += `🔸 Hozirgi faol dorilar:\n`;
      activePills.forEach(p => {
        message += `  • ${p.name} — ${p.dosagePerDay} marta: ${p.times.join(', ')}\n`;
      });
    }
    ctx.reply(message, this.getMainMenu());
  }

  // "Biz haqida" tugmasi
  handleAbout(ctx) {
    const aboutMessage = `
ℹ️ Biz haqida

Bu bot O'zbekistondagi foydalanuvchilar uchun maxsus yaratilgan. 
Biz sizga quyidagi xizmatlarni taqdim etamiz:

• 🏥 Kundalik dorilaringizni eslatish
• 📱 Qulay va tushunarli interfeys
• 🔔 Vaqtida eslatmalar
• 📊 Dorilar olish tarixini saqlash
• 🔄 Dori ichishni tasdiqlash

Savollar uchun: @support_username
    `;
    ctx.reply(aboutMessage);
  }

  // "Sozlamalar" tugmasi
  handleSettings(ctx) {
    ctx.reply("⚙️ Sozlamalar\n\nKerakli bo'limni tanlang:", Keyboards.getSettingsMenu());
  }

  // Umumiy orqaga handleri
  handleBack(ctx) {
    const telegramId = ctx.from.id;
    const pillState = usePillStore.getState().getPillState(telegramId);
    const settingsState = useSettingsStore.getState().getSettingsState(telegramId);

    // Dori qo'shish oqimi ichida orqaga
    if (pillState) {
      if (pillState.step === "select_time") {
        // Orqaga -> dozani tanlash
        usePillStore.getState().updatePillState(telegramId, {
          step: "dosage_per_day",
          data: { ...pillState.data, times: [], nextIndex: 1, minTime: null }
        });
        ctx.reply(`Kuniga necha marta ichish kerak? (masalan: 3)`, this.getAddPillMenu());
        return;
      }
      if (pillState.step === "dosage_per_day") {
        // Orqaga -> dori nomi
        usePillStore.getState().updatePillState(telegramId, {
          step: "pill_name",
          data: { name: pillState.data?.name || "" }
        });
        ctx.reply("💊 Yangi dori qo'shish\n\nDori nomini kiriting:", this.getAddPillMenu());
        return;
      }
      if (pillState.step === "pill_name") {
        // Oqimdan chiqish
        usePillStore.getState().removePillState(telegramId);
        ctx.reply("Asosiy menyu", this.getMainMenu());
        return;
      }
    }

    // Sozlamalar oqimi ichida orqaga
    if (settingsState) {
      useSettingsStore.getState().removeSettingsState(telegramId);
      ctx.reply("⚙️ Sozlamalar", Keyboards.getSettingsMenu());
      return;
    }

    // Default: asosiy menyuga
    ctx.reply("Asosiy menyu", this.getMainMenu());
  }

  // Asosiy menyuga qaytish: oqimlarni tozalab, bosh menyuni ko'rsatish
  handleGoHome(ctx) {
    const telegramId = ctx.from.id;
    usePillStore.getState().removePillState(telegramId);
    useSettingsStore.getState().removeSettingsState(telegramId);
    ctx.reply("Asosiy menyu", this.getMainMenu());
  }

  async handleReminderSettings(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    const remindersEnabled = user.remindersEnabled !== false;
    const lead = user.reminderLeadMinutes || 0;
    useSettingsStore.getState().setSettingsState(user.telegramId, { step: 'reminders' });
    ctx.reply(`🔔 Eslatma sozlamalari\n\nHolat: ${remindersEnabled ? '✅ Yoqilgan' : "❌ O'chirilgan"}\nOldindan: ${lead} daqiqa`, Keyboards.getReminderSettingsMenu(remindersEnabled, lead));
  }

  async toggleReminders(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    const newValue = !(user.remindersEnabled !== false);
    await DatabaseService.updateUser(user.telegramId, { remindersEnabled: newValue });
    ctx.reply(`Eslatmalar holati: ${newValue ? '✅ Yoqildi' : "❌ O'chirildi"}`, Keyboards.getReminderSettingsMenu(newValue, user.reminderLeadMinutes || 0));
  }

  async promptLeadMinutes(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    useSettingsStore.getState().setSettingsState(user.telegramId, { step: 'lead_minutes' });
    ctx.reply("⏱️ Necha daqiqa oldin ogohlantirish kerak? (0, 5, 10, 15 ...)", Keyboards.getSettingsMenu());
  }

  async handleTimezoneSettings(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    useSettingsStore.getState().setSettingsState(user.telegramId, { step: 'timezone' });
    ctx.reply("🕐 Vaqt zonasi\n\nQuyidagilardan birini tanlang yoki 'Boshqa (yozish)' ni bosing va yozing.", Keyboards.getTimezoneMenu());
  }

  // Matn xabarlarini qayta ishlash
  async handleTextMessage(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    const pillState = usePillStore.getState().getPillState(user.telegramId);
    const settingsState = useSettingsStore.getState().getSettingsState(user.telegramId);
    // Dori boshqarish oqimi
    if (pillState && pillState.step === 'manage_select') {
      const text = ctx.message.text.trim();
      const pills = pillState.data.pills || [];
      const idx = parseInt(text) - 1;
      if (isNaN(idx) || idx < 0 || idx >= pills.length) {
        ctx.reply("❌ Iltimos ro'yxatdan to'g'ri raqam yuboring.", Keyboards.getPillListMenu(pills));
        return;
      }
      const selected = pills[idx];
      usePillStore.getState().updatePillState(user.telegramId, {
        step: 'manage_action',
        data: { ...pillState.data, selectedPill: selected }
      });
      ctx.reply(`Tanlandi: ${selected.name}. Nima qilamiz?`, Keyboards.getPillManageMenu());
      return;
    }

    if (pillState && pillState.step === 'manage_action') {
      const text = ctx.message.text.trim();
      const pill = pillState.data.selectedPill;
      if (text === "🗑️ O'chirish") {
        await DatabaseService.deletePill(pill._id);
        usePillStore.getState().removePillState(user.telegramId);
        ctx.reply("🗑️ Dori o'chirildi.", this.getMainMenu());
        return;
      }
      if (text === "✏️ Tahrirlash") {
        // Nima tahrirlashni tanlash menyusi
        usePillStore.getState().updatePillState(user.telegramId, {
          step: 'edit_menu',
          data: { name: pill.name, dosagePerDay: pill.dosagePerDay, times: pill.times, pillId: pill._id }
        });
        ctx.reply(`Qaysi parametrni tahrirlaymiz?`, Keyboards.getPillEditMenu());
        return;
      }
      ctx.reply("❌ Noto'g'ri buyruq. Tahrirlash yoki O'chirishni tanlang.", Keyboards.getPillManageMenu());
      return;
    }

    // Edit menyusi
    if (pillState && pillState.step === 'edit_menu') {
      const text = ctx.message.text.trim();
      if (text === '📝 Nomi') {
        usePillStore.getState().updatePillState(user.telegramId, { step: 'edit_name' });
        ctx.reply(`✏️ Yangi nomni kiriting (hozirgi: ${pillState.data.name})`, this.getAddPillMenu());
        return;
      }
      if (text === '🔢 Kuniga marta') {
        usePillStore.getState().updatePillState(user.telegramId, { step: 'edit_dosage' });
        ctx.reply(`Kuniga necha marta? (hozirgi: ${pillState.data.dosagePerDay})`, this.getAddPillMenu());
        return;
      }
      if (text === '⏰ Vaqtlar') {
        usePillStore.getState().updatePillState(user.telegramId, { step: 'edit_times', data: { ...pillState.data, times: [], nextIndex: 1, minTime: null } });
        ctx.reply(`1-chi vaqtni tanlang:`, this.getTimeMenu(false, { excludeTimes: [] }));
        return;
      }
      ctx.reply(`❌ Qaysi parametr tahrirlanishini tanlang.`, Keyboards.getPillEditMenu());
      return;
    }

    if (pillState && pillState.step === 'edit_name') {
      const name = ctx.message.text.trim();
      const updated = await DatabaseService.updatePill(pillState.data.pillId, { name });
      usePillStore.getState().removePillState(user.telegramId);
      ctx.reply(`✅ Nomi yangilandi: ${updated.name}`, this.getMainMenu());
      return;
    }

    if (pillState && pillState.step === 'edit_dosage') {
      const dosage = parseInt(ctx.message.text.trim());
      if (isNaN(dosage) || dosage < 1 || dosage > 10) {
        ctx.reply("❌ 1-10 oralig'ida kiriting.", this.getAddPillMenu());
        return;
      }
      // Doza o'zgarsa, vaqtlari ham qayta kiritiladi
      usePillStore.getState().updatePillState(user.telegramId, {
        step: 'edit_times',
        data: { ...pillState.data, dosagePerDay: dosage, times: [], nextIndex: 1, minTime: null }
      });
      ctx.reply(`Doza yangilandi: ${dosage}. Endi 1-chi vaqtni tanlang:`, this.getTimeMenu(false, { excludeTimes: [] }));
      return;
    }

    if (pillState && pillState.step === 'edit_times') {
      const text = ctx.message.text;
      if (text === "🔙 Orqaga") {
        usePillStore.getState().updatePillState(user.telegramId, { step: 'edit_dosage' });
        ctx.reply(`Kuniga necha marta ichish kerak? (hozirgi: ${pillState.data.dosagePerDay})`, this.getAddPillMenu());
        return;
      }
      if (!text.match(/^\d{2}:\d{2}$/)) {
        const excludeTimes = pillState.data.times || [];
        const minTime = pillState.data.minTime || null;
        ctx.reply(`❌ Vaqt formati noto'g'ri. Masalan: 09:00`, this.getTimeMenu(false, { minTime, excludeTimes }));
        return;
      }
      const currentTimes = pillState.data.times || [];
      if (currentTimes.includes(text)) {
        const excludeTimes = pillState.data.times || [];
        const minTime = pillState.data.minTime || null;
        ctx.reply(`❌ ${text} allaqachon tanlangan. Boshqa vaqtni tanlang.`, this.getTimeMenu(false, { minTime, excludeTimes }));
        return;
      }
      if (pillState.data.minTime && text < pillState.data.minTime) {
        const excludeTimes = pillState.data.times || [];
        ctx.reply(`❌ Bu vaqt juda erta. ${pillState.data.minTime} dan keyingi vaqtni tanlang.`, this.getTimeMenu(false, { minTime: pillState.data.minTime, excludeTimes }));
        return;
      }
      const newTimes = [...currentTimes, text].sort();
      const nextIndex = (pillState.data.nextIndex || 1) + 1;
      const total = pillState.data.dosagePerDay;
      if (nextIndex <= total) {
        let computedMinTime = text;
        if (total === 2 && nextIndex === 2) {
          computedMinTime = text < '12:00' ? '12:00' : text;
        } else if (total >= 3) {
          computedMinTime = this.addHours(text, 4);
          if (computedMinTime > '22:00') computedMinTime = '22:00';
        }
        usePillStore.getState().updatePillState(user.telegramId, {
          data: { ...pillState.data, times: newTimes, nextIndex, minTime: computedMinTime }
        });
        const excludeTimes = newTimes;
        ctx.reply(`✅ ${text} saqlandi.\n\n${nextIndex}-chi vaqtni tanlang:`, this.getTimeMenu(false, { minTime: computedMinTime, excludeTimes }));
        return;
      }
      // Oxirgi tanlov -> yangilash va tugatish
      const finalData = { ...pillState.data, times: newTimes };
      const updated = await DatabaseService.updatePill(finalData.pillId, {
        name: finalData.name,
        dosagePerDay: finalData.dosagePerDay,
        times: finalData.times
      });
      // Bugungi pill history ni sinxronlashtirish (reminderlar uchun)
      await DatabaseService.syncTodaysPillHistory(updated._id, user._id, finalData.times);
      usePillStore.getState().removePillState(user.telegramId);
      let message = `✅ Dori yangilandi!\n\n`;
      message += `💊 Nomi: ${updated.name}\n`;
      message += `📅 Kunlik: ${updated.dosagePerDay} marta\n`;
      message += `⏰ Vaqtlar: ${updated.times.join(", ")}\n\n`;
      ctx.reply(message, this.getMainMenu());
      return;
    }
    
    // Global back: handler tartibidan qat'i nazar ishlashi uchun
    if (ctx.message.text === "🔙 Orqaga") {
      this.handleBack(ctx);
      return;
    }

    // Sozlamalar oqimi
    if (settingsState) {
      const text = ctx.message.text;
      if (settingsState.step === 'lead_minutes') {
        const val = parseInt(text);
        if (isNaN(val) || val < 0 || val > 1440) {
          ctx.reply("❌ 0 dan 1440 gacha son kiriting.", Keyboards.getSettingsMenu());
          return;
        }
        await DatabaseService.updateUser(user.telegramId, { reminderLeadMinutes: val });
        useSettingsStore.getState().removeSettingsState(user.telegramId);
        ctx.reply(`✅ Oldindan ogohlantirish ${val} daqiqa qilib saqlandi.`, Keyboards.getReminderSettingsMenu(true, val));
        return;
      }
      if (settingsState.step === 'timezone') {
        // Foydalanuvchi to'g'ridan-to'g'ri kiritishi ham mumkin
        const tz = text;
        await DatabaseService.updateUser(user.telegramId, { timezone: tz });
        useSettingsStore.getState().removeSettingsState(user.telegramId);
        ctx.reply(`✅ Vaqt zonasi yangilandi: ${tz}`, Keyboards.getSettingsMenu());
        return;
      }
    }

    if (!pillState) return;
    
    const text = ctx.message.text;
    
    if (pillState.step === "pill_name") {
      if (text === "🔙 Asosiy menyu") {
        usePillStore.getState().removePillState(user.telegramId);
        ctx.reply("Asosiy menyuga qaytdingiz", this.getMainMenu());
        return;
      }
      
      usePillStore.getState().updatePillState(user.telegramId, {
        data: { ...pillState.data, name: text },
        step: "dosage_per_day"
      });
      
      ctx.reply(`💊 Dori nomi: ${text}\n\nKuniga necha marta ichish kerak? (masalan: 3)`, this.getAddPillMenu());
      
    } else if (pillState.step === "dosage_per_day") {
      if (text === "🔙 Asosiy menyu") {
        usePillStore.getState().removePillState(user.telegramId);
        ctx.reply("Asosiy menyuga qaytdingiz", this.getMainMenu());
        return;
      }
      
      const dosage = parseInt(text);
      if (isNaN(dosage) || dosage < 1 || dosage > 10) {
        ctx.reply("❌ Iltimos, 1 dan 10 gacha bo'lgan raqam kiriting:", this.getAddPillMenu());
        return;
      }
      
      usePillStore.getState().updatePillState(user.telegramId, {
        data: { ...pillState.data, dosagePerDay: dosage, times: [], nextIndex: 1, minTime: null },
        step: "select_time"
      });
      
      ctx.reply(`💊 Kunlik miqdor: ${dosage} marta\n\n1-chi vaqtni tanlang:`, this.getTimeMenu(false, { excludeTimes: [] }));
      
    } else if (pillState.step === "select_time") {
      if (text === "🔙 Orqaga") {
        usePillStore.getState().updatePillState(user.telegramId, {
          step: "dosage_per_day",
          data: { ...pillState.data, times: [], nextIndex: 1 }
        });
        ctx.reply(`Kuniga necha marta ichish kerak? (masalan: 3)`, this.getAddPillMenu());
        return;
      }
      
      if (!text.match(/^\d{2}:\d{2}$/)) {
        const excludeTimes = pillState.data.times || [];
        const minTime = pillState.data.minTime || null;
        ctx.reply(`❌ Vaqt formati noto'g'ri. Masalan: 09:00`, this.getTimeMenu(false, { minTime, excludeTimes }));
        return;
      }
      
      const currentTimes = pillState.data.times || [];
      if (currentTimes.includes(text)) {
        const excludeTimes = pillState.data.times || [];
        const minTime = pillState.data.minTime || null;
        ctx.reply(`❌ ${text} allaqachon tanlangan. Boshqa vaqtni tanlang.`, this.getTimeMenu(false, { minTime, excludeTimes }));
        return;
      }
      // minTime chekloviga rioya qilish
      if (pillState.data.minTime && text < pillState.data.minTime) {
        const excludeTimes = pillState.data.times || [];
        ctx.reply(`❌ Bu vaqt juda erta. ${pillState.data.minTime} dan keyingi vaqtni tanlang.`, this.getTimeMenu(false, { minTime: pillState.data.minTime, excludeTimes }));
        return;
      }
      
      const newTimes = [...currentTimes, text].sort();
      const nextIndex = (pillState.data.nextIndex || 1) + 1;
      const total = pillState.data.dosagePerDay;
      
      if (nextIndex <= total) {
        // Keyingi vaqtni so'rash
        // Dinamik minTime hisoblash: 
        // - 2 mahal bo'lsa va bu keyingi (2-chi) vaqt bo'lsa, ertalab tanlangan bo'lsa kamida 12:00 dan keyin
        // - 3 va undan ko'p bo'lsa, kamida 4 soat farq
        let computedMinTime = text;
        if (total === 2 && nextIndex === 2) {
          computedMinTime = text < '12:00' ? '12:00' : text; // kunning qolgan yarmi
        } else if (total >= 3) {
          computedMinTime = this.addHours(text, 4);
          if (computedMinTime > '22:00') {
            computedMinTime = '22:00';
          }
        }
        usePillStore.getState().updatePillState(user.telegramId, {
          data: { ...pillState.data, times: newTimes, nextIndex, minTime: computedMinTime }
        });
        const excludeTimes = newTimes;
        ctx.reply(`✅ ${text} saqlandi.\n\n${nextIndex}-chi vaqtni tanlang:`, this.getTimeMenu(false, { minTime: computedMinTime, excludeTimes }));
        return;
      }
      
      // Oxirgi vaqt tanlandi -> dori yaratish
      const finalData = { ...pillState.data, times: newTimes };
      const pill = await DatabaseService.createPill(user._id, finalData);
      
      await DatabaseService.createTodaysFuturePillHistory(
        pill._id,
        user._id,
        finalData.times
      );
      
      usePillStore.getState().removePillState(user.telegramId);
      
      let message = `✅ Dori muvaffaqiyatli qo'shildi!\n\n`;
      message += `💊 Nomi: ${pill.name}\n`;
      message += `📅 Kunlik: ${pill.dosagePerDay} marta\n`;
      message += `⏰ Vaqtlar: ${pill.times.join(", ")}\n\n`;
      message += `Eslatmalar avtomatik ravishda yuboriladi.`;
      
      ctx.reply(message, this.getMainMenu());
    }
  }

  // Callback query handler (dori ichishni tasdiqlash)
  async handlePillConfirmation(ctx) {
    const [, action, historyId] = ctx.match;
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    
    const history = await DatabaseService.updatePillHistory(historyId, {
      status: action,
      actualTime: new Date()
    });
    
    if (!history || history.userId.toString() !== user._id.toString()) {
      ctx.answerCbQuery("❌ Xatolik yuz berdi");
      return;
    }
    
    const statusText = action === "taken" ? "✅ Ichildi" : "❌ O'tkazib yuborildi";
    ctx.answerCbQuery(statusText);
    
    ctx.editMessageText(`💊 ${history.scheduledTime} - ${statusText}\n\nRahmat!`);

    // Agar ichilgan bo'lsa, medical history ga yozamiz
    if (action === 'taken') {
      const date = history.date;
      const time = history.scheduledTime;
      const pill = await DatabaseService.getPillById(history.pillId);
      await DatabaseService.appendMedicalHistory(user._id, pill._id, pill.name, date, time);
    }
  }
}

module.exports = BotHandlers;
