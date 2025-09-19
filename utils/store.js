const { createStore } = require('zustand/vanilla');

// Foydalanuvchi holatini boshqarish (vanilla store)
const useUserStore = createStore((set, get) => ({
  // Foydalanuvchi ma'lumotlari
  users: new Map(), // telegramId -> user data
  
  // Foydalanuvchi holatini olish
  getUser: (telegramId) => {
    return get().users.get(telegramId);
  },
  
  // Foydalanuvchi holatini saqlash
  setUser: (telegramId, userData) => {
    set((state) => {
      const newUsers = new Map(state.users);
      newUsers.set(telegramId, userData);
      return { users: newUsers };
    });
  },
  
  // Foydalanuvchi holatini o'chirish
  removeUser: (telegramId) => {
    set((state) => {
      const newUsers = new Map(state.users);
      newUsers.delete(telegramId);
      return { users: newUsers };
    });
  },
  
  // Foydalanuvchi holatini yangilash
  updateUser: (telegramId, updates) => {
    const currentUser = get().getUser(telegramId);
    if (currentUser) {
      get().setUser(telegramId, { ...currentUser, ...updates });
    }
  }
}));

// Dori qo'shish holatini boshqarish (vanilla store)
const usePillStore = createStore((set, get) => ({
  // Dori qo'shish jarayoni
  pillStates: new Map(), // telegramId -> pill state
  
  // Dori holatini olish
  getPillState: (telegramId) => {
    return get().pillStates.get(telegramId);
  },
  
  // Dori holatini saqlash
  setPillState: (telegramId, state) => {
    set((currentState) => {
      const newPillStates = new Map(currentState.pillStates);
      newPillStates.set(telegramId, state);
      return { pillStates: newPillStates };
    });
  },
  
  // Dori holatini o'chirish
  removePillState: (telegramId) => {
    set((currentState) => {
      const newPillStates = new Map(currentState.pillStates);
      newPillStates.delete(telegramId);
      return { pillStates: newPillStates };
    });
  },
  
  // Dori holatini yangilash
  updatePillState: (telegramId, updates) => {
    const currentState = get().getPillState(telegramId);
    if (currentState) {
      get().setPillState(telegramId, { ...currentState, ...updates });
    }
  }
}));

// Eslatmalar holatini boshqarish (vanilla store)
const useReminderStore = createStore((set, get) => ({
  // Faol eslatmalar
  activeReminders: new Map(), // pillId -> reminder data
  
  // Eslatma qo'shish
  addReminder: (pillId, reminderData) => {
    set((state) => {
      const newReminders = new Map(state.activeReminders);
      newReminders.set(pillId, reminderData);
      return { activeReminders: newReminders };
    });
  },
  
  // Eslatma olish
  getReminder: (pillId) => {
    return get().activeReminders.get(pillId);
  },
  
  // Eslatma o'chirish
  removeReminder: (pillId) => {
    set((state) => {
      const newReminders = new Map(state.activeReminders);
      newReminders.delete(pillId);
      return { activeReminders: newReminders };
    });
  },
  
  // Barcha eslatmalarni olish
  getAllReminders: () => {
    return Array.from(get().activeReminders.values());
  }
}));

// Sozlamalar holati
const useSettingsStore = createStore((set, get) => ({
  settingsStates: new Map(), // telegramId -> settings state
  getSettingsState: (telegramId) => get().settingsStates.get(telegramId),
  setSettingsState: (telegramId, state) => {
    set((currentState) => {
      const newStates = new Map(currentState.settingsStates);
      newStates.set(telegramId, state);
      return { settingsStates: newStates };
    });
  },
  updateSettingsState: (telegramId, updates) => {
    const current = get().getSettingsState(telegramId);
    if (current) {
      get().setSettingsState(telegramId, { ...current, ...updates });
    }
  },
  removeSettingsState: (telegramId) => {
    set((currentState) => {
      const newStates = new Map(currentState.settingsStates);
      newStates.delete(telegramId);
      return { settingsStates: newStates };
    });
  }
}));

module.exports = {
  useUserStore,
  usePillStore,
  useReminderStore,
  useSettingsStore
};
