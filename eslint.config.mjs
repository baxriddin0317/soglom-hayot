import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Matnlar o'zbek tilida — apostrof (o'zbek, qo'shish) juda ko'p va JSX'da xavfsiz.
      'react/no-unescaped-entities': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'lib/generated/**',
    // Eski (Render + MongoDB) bot fayllari — yangi ilova ularni ishlatmaydi.
    'bot.js',
    'config/**',
    'controllers/**',
    'models/**',
    'services/**',
    'utils/**',
  ]),
]);

export default eslintConfig;
