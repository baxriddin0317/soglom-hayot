import type { NextRequest } from 'next/server';
import { withWebAppUser } from '@/lib/webapp/handler';
import { getStats } from '@/lib/webapp/service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withWebAppUser(req, (user) => getStats(user, req.nextUrl.searchParams.get('period')));
}
