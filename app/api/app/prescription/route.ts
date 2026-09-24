import type { NextRequest } from 'next/server';
import { readJson, str, withWebAppUser } from '@/lib/webapp/handler';
import { actOnPrescription, getPrescriptionDetail } from '@/lib/webapp/service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withWebAppUser(req, (user) => getPrescriptionDetail(user, str(req.nextUrl.searchParams.get('id'))));
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  return withWebAppUser(req, (user) => actOnPrescription(user, body));
}
