import { NextResponse, type NextRequest } from 'next/server';
import { getBot } from '@/lib/bot';
import { hasCronSecret } from '@/lib/secrets';
import { runScheduledJobs } from '@/lib/services/scheduler';

// Fon vazifalari: dori eslatmalari, qayta eslatish, belgilanmagan dozalar, kurs yakuni.
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

  try {
    const result = await runScheduledJobs(getBot().telegram);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron tick] xato:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
