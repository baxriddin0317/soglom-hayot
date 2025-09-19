# 💊 Soglom Hayot - Dori Eslatuvchi Bot

O'zbekistondagi foydalanuvchilar uchun maxsus yaratilgan dori eslatuvchi Telegram bot.

## 🌟 Xususiyatlar

- 💊 Dorilar qo'shish va boshqarish
- ⏰ Vaqtida eslatmalar
- 📊 Dorilar olish tarixini kuzatish
- 📋 Barcha dorilar ro'yxatini ko'rish
- 🔔 Qulay va tushunarli interfeys
- 🇺🇿 O'zbek tilida to'liq qo'llab-quvvatlash

## 🚀 O'rnatish

### Talablar
- Node.js 16.0.0 yoki undan yuqori versiya
- MongoDB (keyinchalik qo'shiladi)

### O'rnatish qadamlari

1. **Loyihani klonlash**
```bash
git clone https://github.com/your-username/soglom-hayot.git
cd soglom-hayot
```

2. **Kerakli paketlarni o'rnatish**
```bash
npm install
```

3. **Muhit o'zgaruvchilarini sozlash**
`.env` fayli yarating va quyidagilarni qo'shing:
```env
BOT_TOKEN=your_telegram_bot_token_here
MONGODB_URI=your_mongodb_connection_string
```

4. **Botni ishga tushirish**
```bash
npm start
```

Yoki ishlab chiqarish uchun:
```bash
npm run dev
```

## 📱 Foydalanish

1. Telegramda botni toping: `@your_bot_username`
2. `/start` buyrug'ini yuboring
3. Menyudan kerakli funksiyani tanlang

## 🛠️ Rivojlantirish

### Loyiha strukturasi
```
soglom-hayot/
├── bot.js          # Asosiy bot fayli
├── models/         # Ma'lumotlar bazasi modellari
│   ├── User.js
│   └── Pill.js
├── package.json
└── README.md
```

### Yangi funksiyalar qo'shish
1. `bot.js` faylida yangi handler qo'shing
2. Kerakli model fayllarini yarating
3. Test qiling

## 🤝 Hissa qo'shish

1. Fork qiling
2. Yangi branch yarating (`git checkout -b feature/yangi-funksiya`)
3. O'zgarishlarni commit qiling (`git commit -am 'Yangi funksiya qo'shildi'`)
4. Branch'ni push qiling (`git push origin feature/yangi-funksiya`)
5. Pull Request yarating

## 📄 Litsenziya

Bu loyiha MIT litsenziyasi ostida tarqatiladi. Batafsil ma'lumot uchun `LICENSE` faylini ko'ring.

## 📞 Bog'lanish

- Telegram: @support_username
- Email: support@soglom-hayot.uz
- GitHub Issues: [Loyiha muammolari](https://github.com/your-username/soglom-hayot/issues)

## 🙏 Minnatdorchilik

Bu loyiha O'zbekistondagi sog'liqni saqlash sohasini rivojlantirish maqsadida yaratilgan.

---

**Soglom Hayot Team** ❤️ 