import type { NextRequest } from 'next/server';
import { withWebAppUser } from '@/lib/webapp/handler';
import { getMe } from '@/lib/webapp/service';

export const dynamic = 'force-dynamic';

// Ilova ochilganda: interfeys tili va admin huquqi.
export function GET(req: NextRequest) {
  return withWebAppUser(req, async (user) => getMe(user));
}
