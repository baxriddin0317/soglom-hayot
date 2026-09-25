import { NextResponse, type NextRequest } from 'next/server';
import { getBot } from '@/lib/bot';
import { hasCronSecret } from '@/lib/secrets';
import { runScheduledJobs } from '@/lib/services/scheduler';
import { recordCronRun } from '@/lib/services/system';

// Fon vazifalari: dori eslatmalari, qayta eslatish, belgilanmagan dozalar, kurs yakuni, zaxira.
// Tashqi cron (cron-job.org) HAR DAQIQADA chaqiradi:
//   https://<DOMEN>/api/cron/tick?key=<CRON_SECRET>
// (yoki `Authorization: Bearer <CRON_SECRET>` sarlavhasi bilan).
//
// Vercel Cron ishlatilmaydi: Hobby planda u kuniga faqat bir marta ishlay oladi.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET sozlanmagan' }, { status: 500 });
  }
  if (!hasCronSecret(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { telegram } = getBot();
  const startedAt = new Date();
  try {
    const result = await runScheduledJobs(telegram, startedAt);
    // Heartbeat: admin panel va /api/health cron tirik ekanini shu yozuvdan biladi.
    await recordCronRun(telegram, { startedAt, result }).catch((err) => console.error('[cron tick] heartbeat:', err));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron tick] xato:', err);
    await recordCronRun(telegram, { startedAt, error: err }).catch(() => {});
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
