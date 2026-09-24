import type { NextRequest } from 'next/server';
import { readJson, withWebAppUser } from '@/lib/webapp/handler';
import { saveSettings, settingsOf } from '@/lib/webapp/service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withWebAppUser(req, async (user) => settingsOf(user));
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  return withWebAppUser(req, (user) => saveSettings(user, body));
}
