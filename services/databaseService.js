const User = require('../models/User');
const { Pill, PillHistory } = require('../models/Pill');
const MedicalHistory = require('../models/MedicalHistory');
const Prescription = require('../models/Prescription');

class DatabaseService {
  // Foydalanuvchi bilan ishlash
  static async findOrCreateUser(telegramUser) {
    const telegramId = telegramUser.id;
    let user = await User.findOne({ telegramId });
    
    if (!user) {
      user = new User({
        telegramId,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name || "",
        username: telegramUser.username || "",
        isFirstTime: true
      });
      await user.save();
    } else {
      user.lastActive = new Date();
      await user.save();
    }
    
    return user;
  }

  static async getUserById(telegramId) {
    return await User.findOne({ telegramId });
  }

  static async updateUser(telegramId, updates) {
    return await User.findOneAndUpdate({ telegramId }, updates, { new: true });
  }

  // Dori bilan ishlash
  static async createPill(userId, pillData) {
    const pill = new Pill({
      userId,
      courseId: pillData.courseId,
      name: pillData.name,
      dosagePerDay: pillData.dosagePerDay,
      times: pillData.times.sort(),
      endDate: pillData.endDate || null
    });
    return await pill.save();
  }

  static async getUserPills(userId, activeOnly = true) {
    const query = { userId };
    if (activeOnly) {
      query.isActive = true;
    }
    return await Pill.find(query);
  }

  static async getPillById(pillId) {
    return await Pill.findById(pillId);
  }

  static async updatePill(pillId, updates) {
    return await Pill.findByIdAndUpdate(pillId, updates, { new: true });
  }

  static async deletePill(pillId) {
    return await Pill.findByIdAndUpdate(pillId, { isActive: false }, { new: true });
  }

  // Pill History bilan ishlash
  static async createPillHistory(pillId, userId, scheduledTime, date, status = "pending") {
    const history = new PillHistory({
      pillId,
      userId,
      scheduledTime,
      date,
      status
    });
    return await history.save();
  }

  static async getPillHistory(userId, date) {
    return await PillHistory.find({
      userId,
      date
    }).populate('pillId');
  }

  static async getPendingReminders(scheduledTime, date) {
    return await PillHistory.find({
      scheduledTime,
      date,
      status: "pending",
      reminderSent: false
    }).populate('pillId').populate('userId');
  }

  // Belgilangan soat ichidagi pending eslatmalarni olish (HH)
  static async getPendingRemindersForHour(hour, date) {
    // scheduledTime format: "HH:MM"
    const hourPrefix = new RegExp('^' + hour + ':');
    return await PillHistory.find({
      scheduledTime: { $regex: hourPrefix },
      date,
      status: 'pending',
      reminderSent: false
    }).populate('pillId').populate('userId');
  }

  // Belgilangan oynada (start <= time < end) pending eslatmalar
  static async getPendingRemindersInWindow(startHHMM, endHHMM, date) {
    const query = {
      scheduledTime: { $gte: startHHMM, $lt: endHHMM },
      date,
      status: 'pending',
      reminderSent: false
    };
    return await PillHistory.find(query).populate('pillId').populate('userId');
  }

  static async markReminderSent(historyId) {
    return await PillHistory.findByIdAndUpdate(historyId, { reminderSent: true }, { new: true });
  }

  static async updatePillHistory(historyId, updates) {
    return await PillHistory.findByIdAndUpdate(historyId, updates, { new: true });
  }

  static async getTodaysPillHistory(userId) {
    const today = new Date().toISOString().split('T')[0];
    return await this.getPillHistory(userId, today);
  }

  // Kunlik pill history yaratish
  static async createDailyPillHistory() {
    const today = new Date().toISOString().split('T')[0];
    const activePills = await Pill.find({ isActive: true }).populate('userId');
    
    const results = [];
    
    for (const pill of activePills) {
      for (const time of pill.times) {
        // Bugungi kun uchun pill history mavjudligini tekshirish
        const existingHistory = await PillHistory.findOne({
          pillId: pill._id,
          userId: pill.userId._id,
          scheduledTime: time,
          date: today
        });
        
        // Agar mavjud bo'lmasa, yangi yaratish
        if (!existingHistory) {
          const history = await this.createPillHistory(
            pill._id,
            pill.userId._id,
            time,
            today,
            "pending"
          );
          results.push(history);
        }
      }
    }
    
    return results;
  }

  // Course (retsept) yaratish
  static async createPrescription(userId, days, pillCount) {
    const start = new Date();
    const end = new Date(start.getTime() + (days - 1) * 24 * 60 * 60 * 1000);
    const doc = new Prescription({
      userId,
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
      pillCount
    });
    return await doc.save();
  }

  static async completeEndedPrescriptions() {
    const today = new Date().toISOString().split('T')[0];
    const ended = await Prescription.find({ status: 'active', endDate: { $lt: today } });
    for (const p of ended) {
      p.status = 'completed';
      await p.save();
      await Pill.updateMany({ courseId: p._id, isActive: true }, { isActive: false });
    }
    return ended;
  }

  // Bugungi kun uchun faqat kelajakdagi vaqtlar uchun pill history yaratish
  static async createTodaysFuturePillHistory(pillId, userId, times) {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5);
    const currentHourStart = currentTime.slice(0, 2) + ":00";
    
    const results = [];
    
    for (const time of times) {
      // Hozirgi soat boshidan boshlab (HH:00) va kelajakdagi vaqtlar uchun pill history yaratish
      if (time >= currentHourStart) {
        const history = await this.createPillHistory(
          pillId,
          userId,
          time,
          today,
          "pending"
        );
        results.push(history);
      }
    }
    
    return results;
  }

  // Statistika olish
  static async getDailyStats(userId, date) {
    const histories = (await this.getPillHistory(userId, date)).filter(h => h.status !== 'cancelled');
    
    const taken = histories.filter(h => h.status === "taken").length;
    const missed = histories.filter(h => h.status === "missed").length;
    const pending = histories.filter(h => h.status === "pending").length;
    
    return {
      total: histories.length,
      taken,
      missed,
      pending,
      histories
    };
  }

  // Foydalanuvchining ichilgan dorilar tarixi: dori bo'yicha guruhlab, oxirgi sana/vaqt
  static async getTakenHistorySummary(userId) {
    const pipeline = [
      { $match: { userId, status: 'taken' } },
      { $lookup: { from: 'pills', localField: 'pillId', foreignField: '_id', as: 'pill' } },
      { $unwind: '$pill' },
      { $group: { _id: '$pillId', name: { $first: '$pill.name' }, lastDate: { $max: '$date' }, count: { $sum: 1 } } },
      { $sort: { lastDate: -1 } }
    ];
    return await PillHistory.aggregate(pipeline);
  }

  // Foydalanuvchining ichilgan dorilarini sanalar kesimida guruhlab olish
  static async getTakenHistoryByDate(userId, startDate, endDate) {
    const pipeline = [
      { $match: { userId, status: 'taken', date: { $gte: startDate, $lte: endDate } } },
      { $lookup: { from: 'pills', localField: 'pillId', foreignField: '_id', as: 'pill' } },
      { $unwind: '$pill' },
      { $project: { date: 1, scheduledTime: 1, name: '$pill.name' } },
      { $group: { _id: '$date', items: { $push: { time: '$scheduledTime', name: '$name' } } } },
      { $sort: { _id: -1 } }
    ];
    return await PillHistory.aggregate(pipeline);
  }

  // MedicalHistory ga yozish (taken bo'lganda)
  static async appendMedicalHistory(userId, pillId, pillName, date, time) {
    let doc = await MedicalHistory.findOne({ userId, date });
    if (!doc) {
      doc = new MedicalHistory({ userId, date, items: [] });
    }
    doc.items.push({ pillId, name: pillName, time });
    await doc.save();
    return doc;
  }

  // MedicalHistory dan oxirgi 30 kunlik sanalar kesimida olish
  static async getMedicalHistoryByDate(userId, startDate, endDate) {
    return await MedicalHistory.find({ userId, date: { $gte: startDate, $lte: endDate } })
      .sort({ date: -1 });
  }

  // Bugungi kun uchun tanlangan vaqtlar bilan pill history ni sinxronlashtirish
  // - Yangi vaqtlar: hozirgi soat boshidan (HH:00) boshlab yaratiladi
  // - Olib tashlangan vaqtlar: 'cancelled' qilinadi
  static async syncTodaysPillHistory(pillId, userId, times) {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const currentHourStart = now.toTimeString().slice(0,2) + ":00";

    const existing = await PillHistory.find({ pillId, userId, date: today });
    const existingByTime = new Map();
    existing.forEach(h => existingByTime.set(h.scheduledTime, h));

    // Cancel removed times
    for (const h of existing) {
      if (!times.includes(h.scheduledTime) && h.status === 'pending') {
        await PillHistory.findByIdAndUpdate(h._id, { status: 'cancelled', reminderSent: true });
      }
    }

    // Create new times (from current hour start)
    const results = [];
    for (const t of times) {
      const exists = existingByTime.get(t);
      if (!exists && t >= currentHourStart) {
        const created = await this.createPillHistory(pillId, userId, t, today, 'pending');
        results.push(created);
      }
    }
    return results;
  }
}

module.exports = DatabaseService;
