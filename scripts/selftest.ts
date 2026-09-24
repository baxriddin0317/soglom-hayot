/**
 * Mantiq va integratsiya tekshiruvi: `npm run selftest`.
 *
 * Tashqi servislarga ulanmaydi: baza — PGlite (jarayon ichida ishlaydigan haqiqiy Postgres),
 * Telegram — soxta API (yuborilgan xabarlar ro'yxatga yoziladi). Shu sababli uni istalgan
 * joyda, .env siz ham ishga tushirish mumkin.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';

process.env.TELEGRAM_BOT_TOKEN = '123456:TEST_TOKEN';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test_secret';
process.env.WEBAPP_URL = 'https://example.test/app';
Object.assign(process.env, { NODE_ENV: 'test' });

let passed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

async function main() {
  const time = await import('../lib/time');
  const { validateInitData, signInitData } = await import('../lib/webapp/auth');
  const { computeStreak } = await import('../lib/services/stats');

  console.log('Vaqt va matn yordamchilari');
  await test('Toshkent: 08:00 -> 03:00Z', () => {
    assert.equal(time.zonedToUtc('2026-09-24', '08:00', 'Asia/Tashkent').toISOString(), '2026-09-24T03:00:00.000Z');
  });
  await test('Nyu-York yozgi/qishki vaqt', () => {
    assert.equal(time.zonedToUtc('2026-07-01', '09:00', 'America/New_York').toISOString(), '2026-07-01T13:00:00.000Z');
    assert.equal(time.zonedToUtc('2026-12-01', '09:00', 'America/New_York').toISOString(), '2026-12-01T14:00:00.000Z');
  });
  await test('dateIn: UTC 20:00 Toshkentda ertangi kun', () => {
    assert.equal(time.dateIn('Asia/Tashkent', new Date('2026-09-24T20:00:00Z')), '2026-09-25');
    assert.equal(time.timeIn('Asia/Tashkent', new Date('2026-09-24T20:00:00Z')), '01:00');
  });
  await test('addDays / daysInclusive (oy va yil chegarasi)', () => {
    assert.equal(time.addDays('2026-12-30', 3), '2027-01-02');
    assert.equal(time.addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(time.daysInclusive('2026-09-24', '2026-09-30'), 7);
  });
  await test('parseTimes', () => {
    assert.deepEqual(time.parseTimes('20:00 8 14.30'), ['08:00', '14:30', '20:00']);
    assert.deepEqual(time.parseTimes('8, 8:00; 21-15'), ['08:00', '21:15']);
    assert.deepEqual(time.parseTimes('0830 2200'), ['08:30', '22:00']);
    assert.equal(time.parseTimes('25:00'), null);
    assert.equal(time.parseTimes('ertalab'), null);
    assert.equal(time.parseTimes(''), null);
  });
  await test('suggestedTimes', () => {
    assert.deepEqual(time.suggestedTimes(3), ['08:00', '14:00', '20:00']);
    const six = time.suggestedTimes(6);
    assert.equal(six.length, 6);
    assert.equal(new Set(six).size, 6);
    assert.ok(six.every(time.isTimeString));
  });
  await test('isValidTimeZone', () => {
    assert.ok(time.isValidTimeZone('Asia/Tashkent'));
    assert.ok(!time.isValidTimeZone('Mars/Olympus'));
    assert.ok(!time.isValidTimeZone(''));
  });
  await test('initData imzosi: to\'g\'ri / soxta / eskirgan', () => {
    const token = process.env.TELEGRAM_BOT_TOKEN!;
    const now = Date.now();
    const params = new URLSearchParams({ auth_date: String(Math.floor(now / 1000)), user: JSON.stringify({ id: 42, first_name: 'Ali' }) });
    params.set('hash', signInitData(params, token));
    assert.equal(validateInitData(params.toString(), token, now)?.id, 42);
    assert.equal(validateInitData(params.toString(), '999:OTHER', now), null);
    const tampered = new URLSearchParams(params);
    tampered.set('user', JSON.stringify({ id: 43 }));
    assert.equal(validateInitData(tampered.toString(), token, now), null);
    assert.equal(validateInitData(params.toString(), token, now + 2 * 86_400_000), null);
  });
  await test('computeStreak', () => {
    const d = (taken: number, other = 0, pending = 0) => ({ total: taken + other + pending, taken, skipped: other, missed: 0, pending });
    const days = new Map([
      ['2026-09-24', d(1, 0, 2)], // bugun — hali kutilmoqda, seriyani uzmaydi
      ['2026-09-23', d(3)],
      ['2026-09-22', d(3)],
      // 21 — dori yo'q, uzmaydi
      ['2026-09-20', d(2)],
      ['2026-09-19', d(2, 1)], // o'tkazilgan — seriya shu yerda uziladi
      ['2026-09-18', d(3)],
    ]);
    assert.equal(computeStreak(days, '2026-09-24'), 3);
  });

  // -------------------------------------------------------------------------
  console.log('\nBaza (PGlite) bilan integratsiya');
  const pg = new PGlite();
  await pg.exec(readFileSync('prisma/migrations/20260924000000_init/migration.sql', 'utf8'));
  const { PrismaClient } = await import('../lib/generated/prisma/client');
  const prisma = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  const { setDb } = await import('../lib/db');
  setDb(prisma);

  const { getBot } = await import('../lib/bot');
  const { upsertUser, updateSettings } = await import('../lib/services/users');
  const P = await import('../lib/services/prescriptions');
  const { markDose } = await import('../lib/services/doses');
  const { runScheduledJobs } = await import('../lib/services/scheduler');
  const { getUserStats } = await import('../lib/services/stats');

  // --- soxta Telegram ---
  type Call = { method: string; payload: Record<string, unknown> };
  const calls: Call[] = [];
  let messageSeq = 1000;
  const bot = getBot();
  // Telegraf har bir update uchun yangi Telegram obyekti yaratadi — shuning uchun prototipga.
  const { Telegram } = await import('telegraf');
  (Telegram.prototype as unknown as { callApi: unknown }).callApi = async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    if (method === 'getMe') return { id: 1, is_bot: true, first_name: 'Bot', username: 'soglom_test_bot' };
    if (method === 'sendMessage') {
      return { message_id: ++messageSeq, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text };
    }
    return true;
  };
  const sent = (method = 'sendMessage') => calls.filter((c) => c.method === method);
  const lastText = () => String(sent().at(-1)?.payload.text ?? '');
  const reset = () => (calls.length = 0);

  const TG_ID = 777001;
  const from = { id: TG_ID, is_bot: false, first_name: 'Ali', username: 'ali' };
  const chat = { id: TG_ID, type: 'private' as const, first_name: 'Ali' };
  let updateId = 1;
  const sendText = (text: string) => {
    const entities = text.startsWith('/') ? [{ type: 'bot_command' as const, offset: 0, length: text.split(' ')[0].length }] : undefined;
    return bot.handleUpdate({
      update_id: updateId++,
      message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat, from, text, ...(entities ? { entities } : {}) },
    } as never);
  };
  const press = (data: string, messageId = 5000) =>
    bot.handleUpdate({
      update_id: updateId++,
      callback_query: {
        id: String(updateId),
        from,
        chat_instance: '1',
        data,
        message: { message_id: messageId, date: 0, chat, from: { id: 1, is_bot: true, first_name: 'Bot' }, text: '...' },
      },
    } as never);

  await test('/start — foydalanuvchi yaratiladi, menyu va ilova tugmasi', async () => {
    reset();
    await sendText('/start');
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(TG_ID) } });
    assert.ok(user);
    assert.equal(sent().length, 2);
    assert.match(String(sent()[0].payload.text), /Yangi retsept/);
  });

  await test("Bot dialogi: retsept qo'shish (2 ta dori) — oxirida saqlanadi", async () => {
    await sendText('➕ Yangi retsept');
    await sendText('Angina');
    await sendText('7 kun');
    await sendText('Bugundan');
    // hali retsept yaratilmagan bo'lishi kerak (eski botdagi xato)
    assert.equal(await prisma.prescription.count(), 0);
    await sendText('Amoksiklav 625');
    await sendText('1 tabletka');
    await sendText('2 marta');
    await sendText('✅ 08:00 · 20:00');
    await sendText('5 kun');
    await sendText('Ovqatdan keyin');
    assert.match(lastText(), /Amoksiklav 625/);
    await sendText("➕ Yana dori qo'shish");
    await sendText('Paracetamol');
    await sendText("⏭ O'tkazib yuborish");
    await sendText('3 marta');
    await sendText('9 13:30 21'); // o'z vaqtlari
    await sendText('♾ Butun kurs (7 kun)');
    await sendText("Farqi yo'q");
    await sendText('✅ Saqlash');
    assert.match(lastText(), /Retsept saqlandi/);

    const p = await prisma.prescription.findFirstOrThrow({ include: { medications: { orderBy: { createdAt: 'asc' } } } });
    assert.equal(p.title, 'Angina');
    assert.equal(time.daysInclusive(p.startDate, p.endDate), 7);
    assert.equal(p.medications.length, 2);
    assert.deepEqual(p.medications[0].times, ['08:00', '20:00']);
    assert.equal(p.medications[0].meal, 'AFTER');
    assert.equal(time.daysInclusive(p.medications[0].startDate, p.medications[0].endDate), 5);
    assert.deepEqual(p.medications[1].times, ['09:00', '13:30', '21:00']);
    assert.equal(p.medications[1].endDate, p.endDate);
    const user = await prisma.user.findFirstOrThrow();
    assert.equal(user.botState, null);
  });

  await test('Dialog: "Orqaga", noto\'g\'ri qiymat va "Bekor qilish"', async () => {
    const before = await prisma.prescription.count();
    await sendText('➕ Yangi retsept');
    await sendText('Test');
    await sendText('1000'); // juda katta
    assert.match(lastText(), /1 dan 365 gacha/);
    await sendText('◀️ Orqaga');
    assert.match(lastText(), /Retsept yoki kasallik nomini/);
    await sendText('❌ Bekor qilish');
    assert.match(lastText(), /Bekor qilindi/);
    assert.equal(await prisma.prescription.count(), before);
    // Eski klaviatura tugmasi ham ishlaydi
    await sendText('📋 Mening dorilarim');
    assert.match(lastText(), /Faol retseptlar/);
  });

  // --- Aniq vaqt bilan servis testlari ---
  const user2 = await upsertUser({ id: 777002, first_name: 'Vali' });
  const at = (date: string, t: string) => time.zonedToUtc(date, t, 'Asia/Tashkent');
  const D1 = '2030-03-10';
  let rxId = '';

  await test("createPrescription: dozalar oldindan yaratiladi (o'tgan vaqtlar tashlab ketiladi)", async () => {
    const input = P.validatePrescription(
      {
        title: 'Gripp',
        days: 3,
        startDate: D1,
        medications: [
          { name: 'Paracetamol', dosage: '1 tabletka', meal: 'AFTER', times: ['08:00', '20:00'] },
          { name: 'Vitamin C', times: ['08:00'] },
          { name: 'Eski', times: ['06:00'] }, // 06:00 — 1 soatdan ko'p o'tgan, bugunga yaratilmaydi
        ],
      },
      D1
    );
    const p = await P.createPrescription(user2, input, at(D1, '07:30'));
    rxId = p.id;
    const count = await prisma.dose.count({ where: { userId: user2.id } });
    assert.equal(count, 3 * 3 + 2); // 3 kun × (2+1) + "Eski" faqat 2 kun
  });

  const telegram = bot.telegram;

  await test('Eslatma vaqtidan oldin yuborilmaydi', async () => {
    reset();
    const r = await runScheduledJobs(telegram, at(D1, '07:59'));
    assert.equal(r.reminders, 0);
  });

  await test('08:00 — bitta guruhlangan eslatma (2 dori), takroran yuborilmaydi', async () => {
    reset();
    const r = await runScheduledJobs(telegram, at(D1, '08:00'));
    assert.equal(r.reminders, 1);
    const msg = sent().find((c) => c.payload.chat_id === 777002)!;
    assert.match(String(msg.payload.text), /Paracetamol/);
    assert.match(String(msg.payload.text), /Vitamin C/);
    assert.match(JSON.stringify(msg.payload.reply_markup), /Hammasini ichdim/);
    const again = await runScheduledJobs(telegram, at(D1, '08:01'));
    assert.equal(again.reminders, 0);
    const reminded = await prisma.dose.count({ where: { userId: user2.id, remindedAt: { not: null } } });
    assert.equal(reminded, 2);
  });

  await test('Javob bo\'lmasa 30 daqiqadan keyin qayta eslatish (bir marta), eski xabar o\'chiriladi', async () => {
    reset();
    const r = await runScheduledJobs(telegram, at(D1, '08:30'));
    assert.equal(r.followUps, 1);
    assert.match(lastText(), /hali belgilanmagan/);
    assert.equal(sent('deleteMessage').length, 1);
    const again = await runScheduledJobs(telegram, at(D1, '08:45'));
    assert.equal(again.followUps, 0);
  });

  await test("Boshqa foydalanuvchining dozasini bot tugmasi orqali belgilab bo'lmaydi", async () => {
    const dose = await prisma.dose.findFirstOrThrow({
      where: { userId: user2.id, date: D1, time: '08:00', medication: { name: 'Paracetamol' } },
    });
    // Tugmani boshqa foydalanuvchi bosa olmaydi
    reset();
    await press(`r:t:${dose.id}`);
    assert.match(JSON.stringify(sent('answerCallbackQuery')), /topilmadi/);
    assert.equal((await prisma.dose.findUniqueOrThrow({ where: { id: dose.id } })).status, 'PENDING');
  });

  await test("Doza egasi belgilaydi; 3 soatdan keyin qolgani 'belgilanmadi' bo'ladi", async () => {
    const now = at(D1, '09:00');
    const para = await prisma.dose.findFirstOrThrow({
      where: { userId: user2.id, date: D1, time: '08:00', medication: { name: 'Paracetamol' } },
    });
    await markDose(user2, para.id, 'take', now);
    reset();
    const r = await runScheduledJobs(telegram, at(D1, '11:01'));
    assert.equal(r.missed, 1);
    const vit = await prisma.dose.findFirstOrThrow({
      where: { userId: user2.id, date: D1, time: '08:00', medication: { name: 'Vitamin C' } },
    });
    assert.equal(vit.status, 'MISSED');
    assert.equal(sent('editMessageText').length, 1);
    // Kechikib "ichgan edim"
    await markDose(user2, vit.id, 'take', at(D1, '12:00'));
    assert.equal((await prisma.dose.findUniqueOrThrow({ where: { id: vit.id } })).status, 'TAKEN');
    await assert.rejects(() => markDose(user2, vit.id, 'take', at('2030-03-20', '12:00')), /juda eski/);
  });

  await test("Oldindan eslatish (10 daqiqa) — 19:50 da keladi", async () => {
    const u = await updateSettings(user2, { leadMinutes: 10 });
    reset();
    const early = await runScheduledJobs(telegram, at(D1, '19:49'));
    assert.equal(early.reminders, 0);
    const r = await runScheduledJobs(telegram, at(D1, '19:50'));
    assert.equal(r.reminders, 1);
    assert.match(lastText(), /10 daqiqadan so'ng/);
    await updateSettings(u, { leadMinutes: 0 });
  });

  await test('Kelajakdagi kun dozasini belgilab bo\'lmaydi', async () => {
    const future = await prisma.dose.findFirstOrThrow({ where: { userId: user2.id, date: '2030-03-12' } });
    await assert.rejects(() => markDose(user2, future.id, 'take', at(D1, '12:00')), /Kelgusi/);
  });

  await test("Vaqtlarni o'zgartirish: kelajakdagi dozalar qayta yaratiladi, tarix saqlanadi", async () => {
    const vit = await prisma.medication.findFirstOrThrow({ where: { name: 'Vitamin C' } });
    await P.updateMedicationTimes(user2, vit.id, ['09:00', '21:00'], at(D1, '12:00'));
    const doses = await prisma.dose.findMany({ where: { medicationId: vit.id }, orderBy: { scheduledAt: 'asc' } });
    assert.deepEqual(
      doses.map((d) => `${d.date} ${d.time}`),
      [`${D1} 08:00`, `${D1} 21:00`, '2030-03-11 09:00', '2030-03-11 21:00', '2030-03-12 09:00', '2030-03-12 21:00']
    );
  });

  await test('Muddatni uzaytirish va qisqartirish', async () => {
    await P.setPrescriptionDays(user2, rxId, 5, at(D1, '12:00'));
    let p = await P.getPrescription(user2.id, rxId);
    assert.equal(p.endDate, '2030-03-14');
    assert.ok(p.medications.every((m) => m.endDate === '2030-03-14'));
    assert.equal(await prisma.dose.count({ where: { medication: { name: 'Paracetamol' }, date: '2030-03-14' } }), 2);

    await P.setPrescriptionDays(user2, rxId, 2, at(D1, '12:00'));
    p = await P.getPrescription(user2.id, rxId);
    assert.equal(p.endDate, '2030-03-11');
    assert.equal(await prisma.dose.count({ where: { medication: { prescriptionId: rxId }, date: { gt: '2030-03-11' } } }), 0);
    await assert.rejects(() => P.setPrescriptionDays(user2, rxId, 3, at('2030-03-15', '12:00')), /kamida/);
    await P.setPrescriptionDays(user2, rxId, 3, at(D1, '12:00'));
  });

  await test('Vaqt zonasi o\'zgarsa kelajakdagi eslatmalar yangi zona soatida', async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user2.id } });
    const now = new Date('2030-03-10T08:00:00Z'); // Toshkentda 13:00
    const { rescheduleUserDoses } = P;
    await prisma.user.update({ where: { id: u.id }, data: { timezone: 'Europe/Moscow' } });
    await rescheduleUserDoses({ ...u, timezone: 'Europe/Moscow' }, now);
    const d = await prisma.dose.findFirstOrThrow({ where: { medication: { name: 'Paracetamol' }, date: '2030-03-11', time: '08:00' } });
    assert.equal(d.scheduledAt.toISOString(), '2030-03-11T05:00:00.000Z'); // Moskva 08:00 = 05:00Z
    await prisma.user.update({ where: { id: u.id }, data: { timezone: 'Asia/Tashkent' } });
    await rescheduleUserDoses({ ...u, timezone: 'Asia/Tashkent' }, now);
  });

  await test('Dorini to\'xtatish: kelajakdagi dozalar o\'chadi', async () => {
    const eski = await prisma.medication.findFirstOrThrow({ where: { name: 'Eski' } });
    const res = await P.stopMedication(user2, eski.id, at(D1, '12:00'));
    assert.equal(res.prescriptionFinished, false);
    assert.equal(await prisma.dose.count({ where: { medicationId: eski.id, scheduledAt: { gt: at(D1, '12:00') } } }), 0);
  });

  await test('Kurs tugagach retsept yakunlanadi va natija yuboriladi (bir marta)', async () => {
    reset();
    const r = await runScheduledJobs(telegram, at('2030-03-13', '00:05'));
    assert.equal(r.completed, 1);
    assert.match(sent().map((c) => String(c.payload.text)).join('\n'), /davolanish kursi yakunlandi/);
    const p = await prisma.prescription.findUniqueOrThrow({ where: { id: rxId } });
    assert.equal(p.status, 'COMPLETED');
    const again = await runScheduledJobs(telegram, at('2030-03-13', '00:06'));
    assert.equal(again.completed, 0);
  });

  await test('Statistika', async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user2.id } });
    const s = await getUserStats(u, 7, at('2030-03-13', '09:00'));
    assert.equal(s.days.length, 7);
    assert.ok(s.totals.taken >= 2);
    assert.ok(s.percent !== null);
  });

  await test("Bloklagan foydalanuvchiga eslatma yuborilmaydi", async () => {
    const u3 = await upsertUser({ id: 777003, first_name: 'Soli' });
    await P.createPrescription(
      u3,
      P.validatePrescription({ title: 'X', days: 1, startDate: D1, medications: [{ name: 'A', times: ['10:00'] }] }, D1),
      at(D1, '09:00')
    );
    await bot.handleUpdate({
      update_id: updateId++,
      my_chat_member: {
        chat: { id: 777003, type: 'private', first_name: 'Soli' },
        from: { id: 777003, is_bot: false, first_name: 'Soli' },
        date: 0,
        old_chat_member: { status: 'member', user: { id: 1, is_bot: true, first_name: 'Bot' } },
        new_chat_member: { status: 'kicked', until_date: 0, user: { id: 1, is_bot: true, first_name: 'Bot' } },
      },
    } as never);
    reset();
    await runScheduledJobs(telegram, at(D1, '10:00'));
    assert.equal(sent().filter((c) => c.payload.chat_id === 777003).length, 0);
  });

  // --- Mini App API (route handler'lar to'g'ridan-to'g'ri) ---
  const { NextRequest } = await import('next/server');
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const authFor = (id: number) => {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Ali' }) });
    params.set('hash', signInitData(params, token));
    return `tma ${params.toString()}`;
  };
  const call = async (mod: Record<string, unknown>, method: 'GET' | 'POST', path: string, body?: unknown, who = TG_ID) => {
    const req = new NextRequest(`https://example.test/api/app/${path}`, {
      method,
      headers: { authorization: authFor(who), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = (await (mod[method] as (r: unknown) => Promise<Response>)(req)) as Response;
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  const todayRoute = await import('../app/api/app/today/route');
  const rxsRoute = await import('../app/api/app/prescriptions/route');
  const rxRoute = await import('../app/api/app/prescription/route');
  const doseRoute = await import('../app/api/app/dose/route');
  const settingsRoute = await import('../app/api/app/settings/route');
  const statsRoute = await import('../app/api/app/stats/route');

  await test('API: imzosiz so\'rov 401', async () => {
    const req = new NextRequest('https://example.test/api/app/today', { headers: { authorization: 'tma hash=00' } });
    const res = await todayRoute.GET(req);
    assert.equal(res.status, 401);
  });

  await test('API: retsept yaratish, ko\'rish, dozani belgilash', async () => {
    const today = time.dateIn('Asia/Tashkent');
    const bad = await call(rxsRoute, 'POST', 'prescriptions', { title: 'Y', days: 0, medications: [] });
    assert.equal(bad.status, 400);
    const created = await call(rxsRoute, 'POST', 'prescriptions', {
      title: 'Bosh og\'rig\'i',
      days: 3,
      startDate: today,
      medications: [{ name: 'Ibuprofen', dosage: '1 tabletka', meal: 'WITH', times: ['00:00', '23:59'], days: 2 }],
    });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const list = await call(rxsRoute, 'GET', 'prescriptions');
    // "Angina" (bot orqali kiritilgan) yuqoridagi 2030-yilgi cron sinovida yakunlangan.
    assert.deepEqual((list.json.active as { title: string }[]).map((p) => p.title), ["Bosh og'rig'i"]);
    assert.deepEqual((list.json.finished as { title: string }[]).map((p) => p.title), ['Angina']);
    const detail = await call(rxRoute, 'GET', `prescription?id=${created.json.id}`);
    assert.equal((detail.json.medications as { days: number }[])[0].days, 2);
    // Boshqa foydalanuvchi ko'ra olmaydi
    const foreign = await call(rxRoute, 'GET', `prescription?id=${created.json.id}`, undefined, 777002);
    assert.equal(foreign.status, 404);

    const day = await call(todayRoute, 'GET', 'today');
    const doses = day.json.doses as { id: string; editable: boolean; status: string }[];
    assert.ok(doses.length > 0);
    const target = doses.find((d) => d.editable)!;
    const marked = await call(doseRoute, 'POST', 'dose', { doseId: target.id, action: 'take' });
    assert.equal(marked.json.status, 'TAKEN');
    const undone = await call(doseRoute, 'POST', 'dose', { doseId: target.id, action: 'undo' });
    assert.notEqual(undone.json.status, 'TAKEN');
  });

  await test('API: sozlamalar va hisobot', async () => {
    const bad = await call(settingsRoute, 'POST', 'settings', { timezone: 'Nowhere/City' });
    assert.equal(bad.status, 400);
    const ok = await call(settingsRoute, 'POST', 'settings', { leadMinutes: 15, followUpMinutes: 0 });
    assert.equal(ok.json.leadMinutes, 15);
    const stats = await call(statsRoute, 'GET', 'stats?period=30');
    assert.equal((stats.json.days as unknown[]).length, 30);
  });

  await prisma.$disconnect();
  await pg.close();
  console.log(`\n✅ ${passed} ta tekshiruv muvaffaqiyatli o'tdi`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
