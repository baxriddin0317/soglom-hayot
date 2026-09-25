import { NextResponse } from 'next/server';
import { getBot } from '@/lib/bot';
import { cronLagMs, cronWatchdog, getCronState, isCronStale } from '@/lib/services/system';

// Tashqi monitoring uchun (UptimeRobot, Better Stack, cron-job.org "status" va h.k.):
//   https://<DOMEN>/api/health
// 200 — baza ishlayapti va cron oxirgi 5 daqiqada ishlagan; 503 — muammo bor.
// Maxfiy ma'lumot qaytarmaydi, shuning uchun kalitsiz ochiq.

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = await getCronState();
    const stale = isCronStale(state);
    if (stale && process.env.TELEGRAM_BOT_TOKEN) {
      await cronWatchdog(getBot().telegram).catch((err) => console.error('[health] watchdog:', err));
    }
    const lag = cronLagMs(state);
    return NextResponse.json(
      {
        ok: !stale,
        db: true,
        cron: { lastRunAt: state?.at ?? null, lagSeconds: lag === null ? null : Math.round(lag / 1000), stale },
      },
      { status: stale ? 503 : 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[health] xato:', err);
    return NextResponse.json({ ok: false, db: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
