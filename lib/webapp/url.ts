// Mini App manzili. WEBAPP_URL berilmasa Vercel'ning production domeni ishlatiladi
// (VERCEL_PROJECT_PRODUCTION_URL — Vercel avtomatik beradigan tizim o'zgaruvchisi).
export function getWebAppUrl(): string | null {
  if (process.env.WEBAPP_URL) return process.env.WEBAPP_URL.replace(/\/+$/, '');
  const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return domain ? `https://${domain}/app` : null;
}
