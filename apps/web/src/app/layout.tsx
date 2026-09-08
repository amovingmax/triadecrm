import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import './globals.css';

import { ProvedorTema } from '@/components/tema/provedor-tema';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { appUrl } from '@/lib/env';

/**
 * Geist na interface, Geist Mono em todo número.
 *
 * Poppins saiu em 08/09/2026: é uma geométrica de marca, desenhada para título
 * curto e respiro. Numa tela densa, com tabela de 100 linhas e rótulo de 11px,
 * ela fica larga, perde legibilidade nos tamanhos pequenos e dá ar de material
 * de marketing a uma ferramenta de trabalho.
 *
 * Geist é grotesca neutra com altura de x generosa: aguenta 12px numa célula de
 * tabela e some do caminho, que é o que uma ferramenta de uso diário precisa.
 * O par Mono é da mesma família, então número e texto compartilham o esqueleto —
 * telefone alinhado embaixo de telefone sem parecer outro tipo de coisa.
 *
 * Ênfase continua vindo do peso da MESMA família, nunca de uma segunda.
 */
const geist = Geist({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-geist',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: 'Tríade',
    template: '%s · Tríade',
  },
  description:
    'CRM de captação da KOMUNE: parceiros, Radar, funis, conversas de WhatsApp, agenda, metas e relatórios.',
  applicationName: 'Tríade',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Tríade',
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
  // Preço assumido: quem tem "Claro" salvo vê a moldura do navegador escura até o
  // efeito do ProvedorTema rodar, um frame depois da hidratação. Só a COR da barra
  // fica pendurada em JS; o `color-scheme` do documento, que é o que faria os
  // controles nativos piscarem, o next-themes já carimba antes do primeiro paint.
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
    // `.variable` publica --font-geist e --font-geist-mono, lidos pelo globals.css.
    // `suppressHydrationWarning` é exigido pelo next-themes, que escreve a classe do tema
    // no <html> antes da hidratação.
    <html
      lang="pt-BR"
      className={`${geist.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ProvedorTema>
          <TooltipProvider>{children}</TooltipProvider>
          {/* Sem `richColors`: ele injeta em runtime uma paleta própria (verde, vermelho,
              âmbar e azul) fora da rampa, e o verde de sucesso é praticamente o #34d399
              que significa `cliente` na escala térmica. Sem ele o aviso volta aos tokens
              de sonner.tsx, e o erro entra pela brasa só no ícone e na borda (globals.css). */}
          <Toaster position="top-center" closeButton />
        </ProvedorTema>
      </body>
    </html>
  );
}
