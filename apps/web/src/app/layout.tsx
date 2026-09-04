import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Poppins } from 'next/font/google';

import './globals.css';

import { ProvedorTema } from '@/components/tema/provedor-tema';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { appUrl } from '@/lib/env';

/**
 * Poppins na interface e no display (Ocean Breeze + acabamento do template),
 * IBM Plex Mono em todo número (400 e 500). Ênfase vem do peso da mesma
 * família (400, 500, 600), nunca de uma segunda família. `next/font` baixa e hospeda os
 * arquivos no build, então em campo não há requisição a CDN nem pulo de layout.
 */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-poppins',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

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
  // O padrão do produto é o escuro, então a barra do navegador nasce no fundo
  // escuro do Ocean Breeze (azul-ardósia, nunca preto puro). Quem troca para o
  // claro tem a barra atualizada pelo ProvedorTema, que segue o tema resolvido:
  // aqui não dá para usar `prefers-color-scheme`, que é o aparelho, e não a
  // escolha feita no CRM.
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Escuro primeiro: é o que o next-themes resolve por padrão, e é o que os
  // controles nativos (barra de rolagem, campo de data) devem desenhar.
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `.variable` publica --font-poppins e --font-ibm-plex-mono, lidos pelo globals.css.
    // `suppressHydrationWarning` é exigido pelo next-themes, que escreve a classe do tema
    // no <html> antes da hidratação.
    <html
      lang="pt-BR"
      className={`${poppins.variable} ${ibmPlexMono.variable} h-full antialiased`}
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
