import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './app.css';

export const metadata: Metadata = {
  title: "Sog'lom Hayot",
  robots: { index: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function MiniAppLayout({ children }: { children: ReactNode }) {
  return children;
}
