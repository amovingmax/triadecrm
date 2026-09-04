import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';

import './globals.css';

import { ProvedorTema } from '@/components/tema/provedor-tema';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { appUrl } from '@/lib/env';

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: 'KOMUNE CRM',
    template: '%s · KOMUNE CRM',
  },
  description:
    'CRM de captação da KOMUNE: parceiros, Radar, funis, conversas de WhatsApp, agenda, metas e relatórios.',
  applicationName: 'KOMUNE CRM',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'KOMUNE CRM',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Barra do navegador na cor do fundo de cada tema (grafite frio, nunca preto puro).
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#12151a' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Geist entra por next/font (arquivos locais, sem requisição a CDN em build ou em campo):
    // `.variable` publica --font-geist-sans e --font-geist-mono, lidos pelo globals.css.
    // `suppressHydrationWarning` é exigido pelo next-themes, que escreve a classe do tema
    // no <html> antes da hidratação.
    <html
      lang="pt-BR"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ProvedorTema>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster position="top-center" richColors closeButton />
        </ProvedorTema>
      </body>
    </html>
  );
}
