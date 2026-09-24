import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Server javoblarida "X-Powered-By: Next.js" ko'rsatmaymiz.
  poweredByHeader: false,

  // Telegraf ichida dinamik require'lar bor — bundlerdan o'tkazmasdan Node'ning o'zi yuklaydi.
  serverExternalPackages: ['telegraf', 'pg', '@prisma/adapter-pg'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default nextConfig;
