# 🌿 Sog'lom Hayot — dori eslatuvchi Telegram bot + Mini App

Bemor shifokor yozib bergan retseptni botga (yoki Mini App'ga) kiritadi — bot butun davolanish
kursi davomida har bir dori vaqtida eslatib turadi, ichilgan dorilarni belgilaydi va hisobot beradi.

**Texnologiyalar:** Next.js 16 (App Router) · TypeScript · Telegraf (webhook) ·
Supabase Postgres + Prisma 7 · Vercel · cron-job.org.

---

## Imkoniyatlar

**Bot**
- ➕ Retsept kiritish dialogi: nomi, muddati (kun), boshlanish sanasi, dorilar — miqdori,
  kuniga necha marta, aniq soatlar (tavsiya yoki o'zi yozadi: `8:00 13:30 21:00`), dori o'z
  muddati (masalan antibiotik 5 kun, kurs 7 kun), ovqatga nisbatan. Har qadamda «Orqaga» /
  «Bekor qilish». Retsept faqat oxirida saqlanadi.
- ⏰ Eslatmalar: bir vaqtdagi dorilar bitta xabarda, «✅ Ichdim» / «⏭ O'tkazib yubordim» /
  «Hammasini ichdim». Oldindan eslatish (5–30 daq), javob bo'lmasa qayta eslatish (eski xabar
  o'chiriladi), 3 soatdan keyin «belgilanmadi» — keyin ham «Ichgan edim» deb tuzatish mumkin.
- 📅 Bugungi dorilar (kunlar bo'yicha varaqlash), 📋 Retseptlarim (muddatni o'zgartirish,
  vaqtlarni o'zgartirish, dorini to'xtatish, kursni yakunlash, o'chirish), 🧾 tarix.
- 📊 Hisobot: 7/30 kun, rioya %, ketma-ket to'liq kunlar, dorilar bo'yicha.
- 🎉 Kurs tugaganda natija xabari. Vaqt zonasi sozlamasi (eslatmalar zonaga qarab qayta hisoblanadi).
- Eski versiya klaviaturasi tugmalari ham ishlaydi.

**Mini App** (`/app`, chatdagi «Ilova» tugmasi): Bugun · Retseptlar (+ yangi retsept formasi) ·
Hisobot · Sozlamalar. Telegram mavzusiga (yorug'/qorong'i) moslashadi. Har so'rov Telegram
`initData` imzosi bilan tekshiriladi — boshqa odamning ma'lumotini ko'rib bo'lmaydi.

---

## Qanday ishlaydi

Bot doimiy ishlaydigan server emas — Vercel funksiyalari so'rov kelgandagina ishga tushadi,
shuning uchun Render'dagi "uxlab qolish" muammosi yo'q.

| Endpoint | Kim chaqiradi | Nima qiladi |
|---|---|---|
| `POST /api/telegram` | Telegram (webhook) | Xabar va tugmalarni qayta ishlaydi |
| `GET /api/cron/tick?key=…` | cron-job.org, **har daqiqada** | Eslatma, qayta eslatma, "belgilanmadi", kurs yakuni |
| `GET /api/telegram/setup?key=…` | Siz, deploydan keyin bir marta | Webhook, «Ilova» menyu tugmasi, buyruqlar |
| `/app` + `/api/app/*` | Telegram Mini App | Ilova ekranlari |

Retsept saqlanganda butun kurs uchun har bir doza (dori + sana + soat) oldindan `Dose`
jadvaliga yoziladi. Cron har daqiqada "vaqti kelgan, hali eslatilmagan" dozalarni topadi.
Har doza avval bazada atomar band qilinadi, keyin xabar ketadi — cron ikki marta ishlasa ham
takror xabar bo'lmaydi. Botni bloklagan foydalanuvchiga xabar yuborilmaydi.

> ⚠️ **Bot tokeni bilan hech qayerda `bot.launch()` (long polling) ishlamasligi kerak** —
> u webhook'ni o'chirib yuboradi. Eski Render servisi butunlay o'chirilishi shart (6-qadam).

---

## 🚀 Deploy

### 1. Supabase

1. [supabase.com](https://supabase.com) → New project (region: **Frankfurt / eu-central-1** tavsiya).
2. **Connect → ORMs → Prisma** dan ikki satrni oling:
   - `DATABASE_URL` — Transaction pooler, **6543** port, oxirida `?pgbouncer=true`;
   - `DIRECT_URL` — Session pooler yoki direct, **5432** port.
3. Lokal `.env` ga yozing va jadvallarni yarating:

```bash
npm install
npm run db:deploy
```

> Supabase bepul loyiha 7 kun faolsiz qolsa to'xtatiladi. Har daqiqalik cron bazaga murojaat
> qilgani uchun bu holat yuz bermaydi.

### 2. Eski ma'lumotlarni ko'chirish (ixtiyoriy, bir marta)

`.env` da `MONGODB_URI` (eski baza) bo'lsa:

```bash
npm run migrate:mongo -- --dry-run   # nima ko'chishini ko'rish
npm run migrate:mongo                # ko'chirish
```

Foydalanuvchilar, retseptlar, dorilar va ichish tarixi ko'chadi; faol dorilar uchun kelajakdagi
eslatmalar qayta rejalashtiriladi. Qayta ishga tushirish xavfsiz.

### 3. Vercel

1. GitHub repo'ni [vercel.com](https://vercel.com) ga import qiling (Framework: Next.js).
2. **Settings → Environment Variables** (`.env.example` ga qarang):

| O'zgaruvchi | Qiymat |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather tokeni |
| `TELEGRAM_WEBHOOK_SECRET` | Tasodifiy 32+ belgi (`A-Z a-z 0-9 _ -`) |
| `CRON_SECRET` | Boshqa tasodifiy 32+ belgi |
| `DATABASE_URL` | Supabase pooler (6543) |
| `DIRECT_URL` | Supabase 5432 (build uchun shart emas, lekin bir xil saqlang) |

   Kalit yaratish: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

3. **Settings → Functions → Function Region** — Supabase regioniga eng yaqinini tanlang
   (Frankfurt → `fra1`).
4. Deploy.

### 4. Webhook (bir marta)

Brauzerda **production domen**da oching:

```
https://<DOMEN>/api/telegram/setup?key=<CRON_SECRET>&drop=1
```

`"ok": true` chiqishi kerak. `drop=1` eski botdan qolgan navbatni tashlaydi. Domen yoki
`TELEGRAM_WEBHOOK_SECRET` o'zgarsa — qayta oching.

### 5. Cron (cron-job.org)

1. [cron-job.org](https://cron-job.org) → Create cronjob.
2. URL: `https://<DOMEN>/api/cron/tick?key=<CRON_SECRET>`
3. Interval: **har 1 daqiqa**.

**Bu cron sozlanmasa eslatmalar yuborilmaydi.**

### 6. Eski infratuzilmani o'chirish

- **Render**: servisni butunlay o'chiring (Suspend emas — Delete).
- Ma'lumotlar ko'chirilgach MongoDB Atlas klasterini ham o'chirish mumkin.

### ✅ Tekshiruv

- [ ] `https://<DOMEN>/api/telegram` → `{"ok":true,...}`
- [ ] `/api/telegram/setup?key=...` → `"ok": true`, `lastError: null`
- [ ] Botga `/start` → javob + «📱 Ilovani ochish»
- [ ] «➕ Yangi retsept» → retsept saqlanadi, «📅 Bugungi dorilar» da ko'rinadi
- [ ] cron-job.org birinchi chaqiruv → `{"ok":true,"reminders":0,...}`
- [ ] Render servisi o'chirilgan

---

## Lokal ishlab chiqish

```bash
npm install
cp .env.example .env     # qiymatlarni to'ldiring
npm run dev              # http://localhost:3000

npm run selftest         # mantiq + integratsiya (PGlite, soxta Telegram) — tashqi servissiz
npm run typecheck
npm run lint
npm run build
```

Sxema o'zgarsa: `npm run db:migrate-dev -- --name <nom>` (yangi migratsiya), prod'ga — `npm run db:deploy`.

## Tuzilma

```
app/api/telegram        webhook + setup
app/api/cron/tick       fon vazifalari
app/api/app/*           Mini App API
app/app/                Mini App (React)
lib/bot/                bot: handler'lar, klaviaturalar, xabar ko'rinishlari, dialog holati
lib/services/           retseptlar, dozalar, eslatmalar (scheduler), statistika, foydalanuvchilar
lib/webapp/             initData tekshiruvi, API turlari
lib/time.ts             vaqt zonasi bilan ishlash
prisma/                 sxema va migratsiyalar
scripts/                selftest, MongoDB'dan ko'chirish
```

⚠️ Bot shifokor o'rnini bosmaydi — dori, miqdor va muddatni faqat shifokor belgilaydi.
