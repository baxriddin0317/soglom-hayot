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
    this.bot.action(/^confirm_delete_prescription$/, this.handleConfirmDeletePrescription.bind(this));
    this.bot.action(/^cancel_delete_prescription$/, this.handleCancelDeletePrescription.bind(this));
  }

  // Asosiy menyu
  getMainMenu(includeAdd = true) {
    const firstRow = includeAdd ? ["💊 Yangi retsept qo'shish", "📋 Mening dorilarim"] : ["📋 Mening dorilarim"];
    return Markup.keyboard([
      firstRow,
      ["⏰ Eslatmalar", "📊 Kunlik hisobot"],
      ["🧾 Kasallik tarixi"],
      ["ℹ️ Biz haqida", "⚙️ Sozlamalar"]
    ]).resize();
  }

  async sendMainMenu(ctx, text = "Asosiy menyu") {
    try {
      const user = await DatabaseService.findOrCreateUser(ctx.from);
      const presc = await DatabaseService.getActivePrescription(user._id);
      ctx.reply(text, this.getMainMenu(!presc));
    } catch (e) {
      ctx.reply(text, this.getMainMenu());
    }
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
    
    const activePrescription = await DatabaseService.getActivePrescription(user._id);
    ctx.reply(welcomeMessage, this.getMainMenu(!activePrescription));
    
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
      step: "course_days",
      data: {}
    });
    
    ctx.reply("🗓️ Davolanish nomi? (masalan: Gripp uchun)", this.getAddPillMenu());
  }

  // "Mening dorilarim" tugmasi
  async handleMyPills(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    const pills = await DatabaseService.getUserPills(user._id);
    const activePrescription = await DatabaseService.getActivePrescription(user._id);
    
    if (pills.length === 0) {
      await this.sendMainMenu(ctx, "📋 Hozircha dorilaringiz yo'q.\n\nYangi dori qo'shish uchun \"Yangi retsept qo'shish\" tugmasini bosing.");
      return;
    }
    
    let message = "📋 Sizning dorilaringiz:\n\n";
    pills.forEach((pill, index) => {
      const course = pill.courseId;
      const courseTitle = course ? (course.name || `Retsept #${(index + 1)}`) : "Retseptsiz";
      const courseDuration = course ? `${course.startDate} → ${course.endDate}` : "-";
      const pillDuration = pill.courseDays ? `${pill.courseDays} kun` : (course ? "Butun kurs" : "-");
      message += `${index + 1}. ${pill.name}\n`;
      message += `   Retsept: ${courseTitle}\n`;
      message += `   Davomiylik: ${pillDuration}${course ? ` (kurs: ${courseDuration})` : ""}\n`;
      message += `   Kunlik: ${pill.dosagePerDay} marta\n`;
      message += `   Vaqtlar: ${pill.times.join(", ")}\n\n`;
    });
    
    message += "Dorini boshqarish uchun dori raqamini yuboring:";
    
    // Raqam kutilayotgan holatni saqlaymiz
    usePillStore.getState().setPillState(user.telegramId, {
      step: "manage_select",
      data: { pills, courseId: activePrescription?._id || null, courseName: activePrescription?.name || '', courseStart: activePrescription?.startDate, courseEnd: activePrescription?.endDate }
    });
    
    ctx.reply(message, Keyboards.getPillListMenu(pills, !!activePrescription));
  }

  // "Eslatmalar" tugmasi
  async handleReminders(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    const today = new Date().toISOString().split('T')[0];
    const histories = (await DatabaseService.getPillHistory(user._id, today)).filter(h => h.status !== 'cancelled');
    
    if (!histories || histories.length === 0) {
      await this.sendMainMenu(ctx, "⏰ Bugun uchun eslatmalar topilmadi.");
      return;
    }
    
    const sorted = histories.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
    let message = "⏰ Bugungi eslatmalar:\n\n";
    for (const h of sorted) {
      const statusEmoji = h.status === "taken" ? "✅" : h.status === "missed" ? "❌" : "⏰";
      message += `${statusEmoji} ${h.scheduledTime} - ${h.pillId.name}\n`;
    }
    await this.sendMainMenu(ctx, message);
  }

  // "Kunlik hisobot" tugmasi
  async handleDailyReport(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    const today = new Date().toISOString().split('T')[0];
    const stats = await DatabaseService.getDailyStats(user._id, today);
    
    if (stats.total === 0) {
      await this.sendMainMenu(ctx, "📊 Bugun hali hech qanday dori ichilmagan.");
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
    
    await this.sendMainMenu(ctx, message);
  }

  // Kasallik tarixi (retsept kesimida, foydalanuvchi formati)
  async handleHistory(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    const prescriptions = await DatabaseService.getCompletedPrescriptions(user._id);
    if (!prescriptions || prescriptions.length === 0) {
      await this.sendMainMenu(ctx, "🧾 Retseptlar tarixi topilmadi.");
      return;
    }
    const fmt = (iso) => {
      // iso: YYYY-MM-DD -> DD.MM.YY
      if (!iso) return '-';
      const [y, m, d] = iso.split('-');
      return `${d}.${m}.${String(y).slice(2)}`;
    };
    const diffDaysInclusive = (startIso, endIso) => {
      const s = new Date(startIso);
      const e = new Date(endIso);
      const ms = e.getTime() - s.getTime();
      return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
    };
    let message = '';
    for (let i = 0; i < prescriptions.length; i++) {
      const presc = prescriptions[i];
      const pills = await DatabaseService.getPillsByCourse(user._id, presc._id);
      const totalDays = diffDaysInclusive(presc.startDate, presc.endDate);
      message += `${i + 1}. ${presc.name || '-'} uchun davolanish vaqti: ${totalDays} kun (boshlanish sanasi ${fmt(presc.startDate)} tugash sanasi ${fmt(presc.endDate)})\n`;
      message += `Dorilar:\n`;
      if (!pills || pills.length === 0) {
        message += `  1. (dorilar yo'q)\n`;
      } else {
        pills.forEach((p, idx) => {
          const dtext = p.courseDays ? `${p.courseDays} kun` : 'butun kurs';
          message += `  -${p.name} (${dtext}, ${p.dosagePerDay} mahal)\n`;
        });
      }
      message += `\n`;
    }
    await this.sendMainMenu(ctx, message.trim());
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
    (async () => {
      try {
        const user = await DatabaseService.findOrCreateUser(ctx.from);
        const presc = await DatabaseService.getActivePrescription(user._id);
        ctx.reply("Asosiy menyu", this.getMainMenu(!presc));
      } catch (e) {
        ctx.reply("Asosiy menyu", this.getMainMenu());
      }
    })();
  }

  // Asosiy menyuga qaytish: oqimlarni tozalab, bosh menyuni ko'rsatish
  async handleGoHome(ctx) {
    const telegramId = ctx.from.id;
    usePillStore.getState().removePillState(telegramId);
    useSettingsStore.getState().removeSettingsState(telegramId);
    try {
      const user = await DatabaseService.findOrCreateUser(ctx.from);
      const presc = await DatabaseService.getActivePrescription(user._id);
      ctx.reply("Asosiy menyu", this.getMainMenu(!presc));
    } catch (e) {
      ctx.reply("Asosiy menyu", this.getMainMenu());
    }
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
      if (text === '📝 Retseptni tahrirlash') {
        const cid = pillState.data.courseId;
        if (!cid) {
          ctx.reply("❌ Faol retsept topilmadi.", Keyboards.getPillListMenu(pillState.data.pills || [], false));
          return;
        }
        const courseName = pillState.data.courseName || 'Nomlanmagan';
        const courseStart = pillState.data.courseStart;
        const courseEnd = pillState.data.courseEnd;
        usePillStore.getState().updatePillState(user.telegramId, { step: 'edit_prescription_menu' });
        ctx.reply(`Retsept: ${courseName} (${courseStart} → ${courseEnd})\nNimani tahrirlaymiz?`, Keyboards.getPrescriptionEditMenu());
        return;
      }
      const pills = pillState.data.pills || [];
      const idx = parseInt(text) - 1;
      if (isNaN(idx) || idx < 0 || idx >= pills.length) {
        ctx.reply("❌ Iltimos ro'yxatdan to'g'ri raqam yuboring.", Keyboards.getPillListMenu(pills, !!pillState.data.courseId));
        return;
      }
      const selected = pills[idx];
      usePillStore.getState().updatePillState(user.telegramId, {
        step: 'manage_action',
        data: { ...pillState.data, selectedPill: selected }
      });
      const course = selected.courseId;
      const courseTitle = course ? (course.name || "Retsept") : "Retseptsiz";
      const courseDuration = course ? `${course.startDate} → ${course.endDate}` : "-";
      const pillDuration = selected.courseDays ? `${selected.courseDays} kun` : (course ? "Butun kurs" : "-");
      const info = `Tanlandi: ${selected.name}\nRetsept: ${courseTitle}${course ? ` (${courseDuration})` : ""}\nDavomiylik: ${pillDuration}`;
      ctx.reply(`${info}\n\nNima qilamiz?`, Keyboards.getPillManageMenu());
      return;
    }

    if (pillState && pillState.step === 'manage_action') {
      const text = ctx.message.text.trim();
      const pill = pillState.data.selectedPill;
      if (text === "🗑️ O'chirish") {
        await DatabaseService.deletePill(pill._id);
        usePillStore.getState().removePillState(user.telegramId);
        await this.sendMainMenu(ctx, "🗑️ Dori o'chirildi.");
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
      if (text === "📝 Retseptni tahrirlash") {
        const full = await DatabaseService.getPillById(pill._id);
        if (!full || !full.courseId) {
          ctx.reply("❌ Ushbu dori retseptga bog'lanmagan.", Keyboards.getPillManageMenu());
          return;
        }
        const course = await DatabaseService.getPrescriptionById(full.courseId);
        usePillStore.getState().updatePillState(user.telegramId, {
          step: 'edit_prescription_menu',
          data: { ...pillState.data, courseId: course._id, courseName: course.name || '', courseStart: course.startDate, courseEnd: course.endDate }
        });
        ctx.reply(`Retsept: ${course.name || 'Nomlanmagan'} (${course.startDate} → ${course.endDate})\nNimani tahrirlaymiz?`, Keyboards.getPrescriptionEditMenu());
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

    // Retsept tahrirlash menyusi
    if (pillState && pillState.step === 'edit_prescription_menu') {
      const text = ctx.message.text.trim();
      if (text === '📝 Nomi') {
        usePillStore.getState().updatePillState(user.telegramId, { step: 'edit_prescription_name' });
        ctx.reply(`✏️ Yangi retsept nomini kiriting (hozirgi: ${pillState.data.courseName || '-'}):`, this.getAddPillMenu());
        return;
      }
      if (text === '📅 Davomiyligi (kun)') {
        usePillStore.getState().updatePillState(user.telegramId, { step: 'edit_prescription_days' });
        ctx.reply(`📅 Yangi davomiylikni kiriting (kun):`, this.getAddPillMenu());
        return;
      }
      if (text === "🗑️ Retseptni o'chirish") {
        usePillStore.getState().updatePillState(user.telegramId, { step: 'confirm_delete_prescription' });
        ctx.reply("❗ Ushbu retsept va unga bog'liq barcha dorilar o'chiriladi. Tasdiqlaysizmi?", Keyboards.getConfirmationMenu('delete_prescription'));
        return;
      }
      ctx.reply(`❌ Qaysi parametr tahrirlanishini tanlang.`, Keyboards.getPrescriptionEditMenu());
      return;
    }

    if (pillState && pillState.step === 'edit_prescription_name') {
      const name = ctx.message.text.trim();
      const updated = await DatabaseService.updatePrescription(pillState.data.courseId, { name });
      usePillStore.getState().removePillState(user.telegramId);
      await this.sendMainMenu(ctx, `✅ Retsept nomi yangilandi: ${updated.name || '-'}`);
      return;
    }

    if (pillState && pillState.step === 'edit_prescription_days') {
      const days = parseInt(ctx.message.text.trim());
      if (isNaN(days) || days < 1 || days > 365) {
        ctx.reply("❌ 1–365 oralig'ida kiriting.", this.getAddPillMenu());
        return;
      }
      const updated = await DatabaseService.updatePrescriptionDays(pillState.data.courseId, days);
      usePillStore.getState().removePillState(user.telegramId);
      await this.sendMainMenu(ctx, `✅ Retsept davomiyligi yangilandi: ${updated.startDate} → ${updated.endDate}`);
      return;
    }
    if (pillState && pillState.step === 'edit_name') {
      const name = ctx.message.text.trim();
      const updated = await DatabaseService.updatePill(pillState.data.pillId, { name });
      usePillStore.getState().removePillState(user.telegramId);
      await this.sendMainMenu(ctx, `✅ Nomi yangilandi: ${updated.name}`);
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
      await this.sendMainMenu(ctx, message);
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
    
    if (pillState.step === "course_days") {
      const name = text.trim();
      usePillStore.getState().updatePillState(user.telegramId, {
        step: "course_days_number",
        data: { name }
      });
      ctx.reply("🗓️ Davolanish necha kun davom etadi? (masalan: 7)", this.getAddPillMenu());
    } else if (pillState.step === "course_days_number") {
      const days = parseInt(text);
      if (isNaN(days) || days < 1 || days > 365) {
        ctx.reply("❌ 1–365 oralig'ida kiriting:", this.getAddPillMenu());
        return;
      }
      usePillStore.getState().updatePillState(user.telegramId, {
        step: "course_pill_count",
        data: { ...pillState.data, days, totalPills: 0, pillsPlanned: 0 }
      });
      ctx.reply("💊 Retseptda nech ta dori bo'ladi? (masalan: 2)", this.getAddPillMenu());
    } else if (pillState.step === "course_pill_count") {
      const count = parseInt(text);
      if (isNaN(count) || count < 1 || count > 20) {
        ctx.reply("❌ 1–20 oralig'ida kiriting:", this.getAddPillMenu());
        return;
      }
      const course = await DatabaseService.createPrescription(user._id, pillState.data.days, count, pillState.data.name || "");
      usePillStore.getState().updatePillState(user.telegramId, {
        step: "pill_name",
        data: { ...pillState.data, totalPills: count, courseId: course._id, startDate: course.startDate, endDate: course.endDate }
      });
      ctx.reply("💊 Yangi dori\n\nDori nomini kiriting:", this.getAddPillMenu());
    } else if (pillState.step === "pill_name") {
      if (text === "🔙 Asosiy menyu") {
        usePillStore.getState().removePillState(user.telegramId);
        ctx.reply("Asosiy menyuga qaytdingiz", this.getMainMenu());
        return;
      }
      
      usePillStore.getState().updatePillState(user.telegramId, {
        data: { ...pillState.data, name: text },
        step: "pill_duration"
      });
      
      const courseInfo = pillState.data.days ? ` (kurs: ${pillState.data.days} kun)` : "";
      ctx.reply(`💊 Dori nomi: ${text}${courseInfo}\n\nQabul qilish davomiyligi? Raqam kiriting (kun) yoki \"♾️ Butun kurs davomida\" ni tanlang.`, Keyboards.getPillDurationMenu());
      
    } else if (pillState.step === "pill_duration") {
      if (text === "♾️ Butun kurs davomida") {
        usePillStore.getState().updatePillState(user.telegramId, {
          data: { ...pillState.data, courseDays: null },
          step: "dosage_per_day"
        });
        ctx.reply(`Kuniga necha marta ichish kerak? (masalan: 3)`, this.getAddPillMenu());
        return;
      }
      const pdays = parseInt(text);
      const maxDays = pillState.data.days || 365;
      if (isNaN(pdays) || pdays < 1) {
        ctx.reply(`❌ 1–${maxDays} oralig'ida kiriting yoki ♾️ ni tanlang.`, Keyboards.getPillDurationMenu());
        return;
      }
      if (pdays > maxDays) {
        ctx.reply(`❌ Retsept davomiyligi ${maxDays} kun. ${maxDays} dan katta bo'lmasin.`, Keyboards.getPillDurationMenu());
        return;
      }
      usePillStore.getState().updatePillState(user.telegramId, {
        data: { ...pillState.data, courseDays: pdays },
        step: "dosage_per_day"
      });
      ctx.reply(`Kuniga necha marta ichish kerak? (masalan: 3)`, this.getAddPillMenu());
      
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
      
      let message = `✅ Dori muvaffaqiyatli qo'shildi!\n\n`;
      message += `💊 Nomi: ${pill.name}\n`;
      message += `📅 Kunlik: ${pill.dosagePerDay} marta\n`;
      message += `⏰ Vaqtlar: ${pill.times.join(", ")}\n\n`;
      message += `Eslatmalar avtomatik ravishda yuboriladi.`;

      const planned = (pillState.data.pillsPlanned || 0) + 1;
      const remaining = (pillState.data.totalPills || 1) - planned;
      if (remaining > 0) {
        usePillStore.getState().updatePillState(user.telegramId, {
          step: "pill_name",
          data: { ...pillState.data, pillsPlanned: planned }
        });
        ctx.reply(`${message}\n\nYana ${remaining} ta dori kiritiladi. Keyingi dori nomini kiriting:`, this.getAddPillMenu());
      } else {
        usePillStore.getState().removePillState(user.telegramId);
        await this.sendMainMenu(ctx, `${message}\n\nRetsept yakunlandi. Davolanish: ${pillState.data.startDate} → ${pillState.data.endDate}`);
      }
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

  async handleConfirmDeletePrescription(ctx) {
    const user = await DatabaseService.findOrCreateUser(ctx.from);
    const pillState = usePillStore.getState().getPillState(user.telegramId);
    if (!pillState || !pillState.data?.courseId) {
      await ctx.answerCbQuery("❌ Holat topilmadi");
      return;
    }
    await DatabaseService.deletePrescription(pillState.data.courseId);
    usePillStore.getState().removePillState(user.telegramId);
    await ctx.answerCbQuery("🗑️ Retsept o'chirildi");
    const hasActive = await DatabaseService.getActivePrescription(user._id);
    await ctx.editMessageText("🗑️ Retsept va bog'liq dorilar o'chirildi.");
      ctx.reply("Asosiy menyu", this.getMainMenu(!hasActive));
  }

  async handleCancelDeletePrescription(ctx) {
    await ctx.answerCbQuery("Bekor qilindi");
    // Faqat callback javobi; matnli oqim davom etadi
  }
}

module.exports = BotHandlers;
