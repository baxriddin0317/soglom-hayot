import type { NextRequest } from 'next/server';
import { readJson, withWebAppUser } from '@/lib/webapp/handler';
import { actOnDose } from '@/lib/webapp/service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  return withWebAppUser(req, (user) => actOnDose(user, body.doseId, body.action));
}
