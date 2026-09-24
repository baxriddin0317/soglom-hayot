import type { NextRequest } from 'next/server';
import { readJson, withWebAppUser } from '@/lib/webapp/handler';
import { createFromApp, getPrescriptions } from '@/lib/webapp/service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withWebAppUser(req, (user) => getPrescriptions(user));
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  return withWebAppUser(req, (user) => createFromApp(user, body));
}
