/**
 * Eski bot (MongoDB) ma'lumotlarini Supabase (Postgres) ga bir martalik ko'chirish.
 *
 *   npm run migrate:mongo              # haqiqiy ko'chirish
 *   npm run migrate:mongo -- --dry-run # faqat nima ko'chishini ko'rsatadi
 *
 * .env da MONGODB_URI (eski baza) va DATABASE_URL (Supabase) bo'lishi kerak. Avval
 * `npm run db:deploy` bilan jadvallar yaratilgan bo'lsin.
 *
 * Qayta ishga tushirish xavfsiz: Postgres'da retsepti bor foydalanuvchining retseptlari
 * qayta ko'chirilmaydi (faqat profil ma'lumotlari yangilanadi).
 *
 * Moslik:
 *   users          -> User (vaqt zonasi, eslatma sozlamalari)
 *   prescriptions  -> Prescription (dorisiz "bo'sh" retseptlar tashlab ketiladi — eski botdagi xato)
 *   pills          -> Medication
 *   pillhistories  -> Dose (taken -> TAKEN, missed -> SKIPPED, o'tgan pending -> MISSED)
 *   + faol dorilar uchun kelajakdagi dozalar yangidan rejalashtiriladi.
 */
import { MongoClient, type Document, type ObjectId } from 'mongodb';
import { db } from '../lib/db';
import { LEAD_OPTIONS } from '../lib/constants';
import type { Prisma } from '../lib/generated/prisma/client';
import { planDoses } from '../lib/services/prescriptions';
import { addDays, dateIn, isDateString, isTimeString, safeTimeZone, zonedToUtc } from '../lib/time';

const DRY = process.argv.includes('--dry-run');

interface OldUser extends Document {
  _id: ObjectId;
  telegramId: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  timezone?: string;
  remindersEnabled?: boolean;
  reminderLeadMinutes?: number;
  createdAt?: Date;
  lastActive?: Date;
}
interface OldPrescription extends Document {
  _id: ObjectId;
  userId: ObjectId;
  name?: string;
  startDate: string;
  endDate: string;
  status?: string;
  createdAt?: Date;
}
interface OldPill extends Document {
  _id: ObjectId;
  userId: ObjectId;
  courseId?: ObjectId | null;
  name: string;
  times?: string[];
  isActive?: boolean;
  courseDays?: number | null;
  createdAt?: Date;
}
interface OldHistory extends Document {
  pillId: ObjectId;
  scheduledTime: string;
  status: string;
  date: string;
  actualTime?: Date;
}

function leadOption(value: number | undefined): number {
  const v = Number(value) || 0;
  return [...LEAD_OPTIONS].reverse().find((o) => o <= v) ?? 0;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI sozlanmagan (.env)');
  if (!DRY && !process.env.DATABASE_URL) throw new Error('DATABASE_URL sozlanmagan (.env)');

  const mongo = new MongoClient(uri);
  await mongo.connect();
  const mdb = mongo.db();
  console.log(`MongoDB: ${mdb.databaseName}${DRY ? '  (DRY RUN — hech narsa yozilmaydi)' : ''}`);

  const users = await mdb.collection<OldUser>('users').find().toArray();
  const now = new Date();
  const stats = { users: 0, prescriptions: 0, skippedEmpty: 0, skippedExisting: 0, medications: 0, history: 0, future: 0 };

  for (const u of users) {
    if (typeof u.telegramId !== 'number') continue;
    const tz = safeTimeZone(u.timezone);
    const today = dateIn(tz, now);

    const profile = {
      firstName: u.firstName ?? '',
      lastName: u.lastName || null,
      username: u.username || null,
      timezone: tz,
      remindersEnabled: u.remindersEnabled !== false,
      leadMinutes: leadOption(u.reminderLeadMinutes),
    };
    stats.users += 1;
    if (DRY) {
      console.log(`- ${u.telegramId} ${profile.firstName}`);
    }
    const user = DRY
      ? null
      : await db.user.upsert({
          where: { telegramId: BigInt(u.telegramId) },
          create: {
            telegramId: BigInt(u.telegramId),
            ...profile,
            createdAt: u.createdAt ?? now,
            lastActiveAt: u.lastActive ?? now,
          },
          update: profile,
        });

    if (user && (await db.prescription.count({ where: { userId: user.id } })) > 0) {
      stats.skippedExisting += 1;
      continue;
    }

    const prescriptions = await mdb.collection<OldPrescription>('prescriptions').find({ userId: u._id }).toArray();
    for (const p of prescriptions) {
      if (!isDateString(p.startDate) || !isDateString(p.endDate)) continue;
      const pills = (await mdb.collection<OldPill>('pills').find({ courseId: p._id }).toArray()).filter(
        (pill) => pill.name && (pill.times ?? []).some(isTimeString)
      );
      if (pills.length === 0) {
        stats.skippedEmpty += 1;
        continue;
      }
      const active = p.status !== 'completed' && p.endDate >= today;
      stats.prescriptions += 1;
      stats.medications += pills.length;
      if (DRY) {
        console.log(`    ${active ? '●' : '○'} ${p.name || 'Retsept'} (${p.startDate} – ${p.endDate}): ${pills.map((x) => x.name).join(', ')}`);
        continue;
      }

      const created = await db.prescription.create({
        data: {
          userId: user!.id,
          title: (p.name || 'Retsept').slice(0, 80),
          startDate: p.startDate,
          endDate: p.endDate,
          status: active ? 'ACTIVE' : 'COMPLETED',
          completedAt: active ? null : now,
          createdAt: p.createdAt ?? now,
        },
      });

      for (const pill of pills) {
        const times = [...new Set((pill.times ?? []).filter(isTimeString))].sort().slice(0, 8);
        let endDate = p.endDate;
        if (pill.courseDays && pill.courseDays > 0) {
          const e = addDays(p.startDate, pill.courseDays - 1);
          if (e < endDate) endDate = e;
        }
        const med = await db.medication.create({
          data: {
            prescriptionId: created.id,
            userId: user!.id,
            name: pill.name.slice(0, 80),
            times,
            startDate: p.startDate,
            endDate,
            isActive: active && pill.isActive !== false,
            createdAt: pill.createdAt ?? now,
          },
        });

        // Tarix
        const history = await mdb.collection<OldHistory>('pillhistories').find({ pillId: pill._id }).toArray();
        const rows: Prisma.DoseCreateManyInput[] = [];
        for (const h of history) {
          if (!isDateString(h.date) || !isTimeString(h.scheduledTime) || h.status === 'cancelled') continue;
          const scheduledAt = zonedToUtc(h.date, h.scheduledTime, tz);
          const past = scheduledAt <= now;
          const status =
            h.status === 'taken' ? 'TAKEN' : h.status === 'missed' ? 'SKIPPED' : past && h.date < today ? 'MISSED' : 'PENDING';
          rows.push({
            medicationId: med.id,
            userId: user!.id,
            date: h.date,
            time: h.scheduledTime,
            scheduledAt,
            status,
            actedAt: status === 'TAKEN' || status === 'SKIPPED' ? (h.actualTime ?? scheduledAt) : null,
            // O'tgan dozalar uchun eslatma qayta yuborilmasin.
            remindedAt: past ? scheduledAt : null,
            followUpAt: past ? scheduledAt : null,
          });
        }
        if (rows.length) {
          const res = await db.dose.createMany({ data: rows, skipDuplicates: true });
          stats.history += res.count;
        }

        // Kelajak
        if (med.isActive) {
          const future = planDoses(med, tz, now);
          if (future.length) {
            const res = await db.dose.createMany({ data: future, skipDuplicates: true });
            stats.future += res.count;
          }
        }
      }
    }
  }

  await mongo.close();
  console.log('\nNatija:');
  console.log(`  foydalanuvchilar:           ${stats.users}`);
  console.log(`  retseptlar:                 ${stats.prescriptions}`);
  console.log(`  dorilar:                    ${stats.medications}`);
  console.log(`  tarixdagi dozalar:          ${stats.history}`);
  console.log(`  kelajakdagi dozalar:        ${stats.future}`);
  console.log(`  bo'sh retseptlar (tashlandi): ${stats.skippedEmpty}`);
  console.log(`  allaqachon ko'chirilgan:    ${stats.skippedExisting}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
