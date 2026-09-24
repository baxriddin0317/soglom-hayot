import type { NextRequest } from 'next/server';
import { withWebAppUser } from '@/lib/webapp/handler';
import { getToday } from '@/lib/webapp/service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withWebAppUser(req, (user) => getToday(user, req.nextUrl.searchParams.get('date')));
}
