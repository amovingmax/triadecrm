import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';

import './globals.css';

import { ProvedorTema } from '@/components/tema/provedor-tema';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { appUrl } from '@/lib/env';

/**
 * Plus Jakarta Sans na interface, Geist Mono em todo número
 * (Tríade Design System, 29/09/2026).
 *
 * A troca veio com o sistema de design que o Rafael mandou. Plus Jakarta Sans é
 * uma grotesca humanista com terminais levemente arredondados: mais presença que
 * a Geist nos títulos, e altura de x suficiente para aguentar 12px numa célula
 * de tabela — que é o que uma ferramenta de uso diário precisa. O par Mono fica:
 * número e código continuam com esqueleto próprio, e telefone alinha embaixo de
 * telefone.
 *
 * Ênfase continua vindo do PESO da mesma família (300 a 600), nunca de uma
 * segunda família.
 *
 * SERVIDAS DA PASTA, e não do `next/font/google`. Duas razões, e a segunda doeu:
 * o sistema já traz os arquivos variáveis com os `unicode-range` certos, e o
 * build da Vercel quebrou em 28/09/2026 baixando fonte do Google com cache
 * corrompido. Arquivo no repositório não depende de rede em tempo de build.
 */
const jakarta = localFont({
  src: [
    { path: './fontes/PlusJakartaSans-latin.woff2', weight: '300 600', style: 'normal' },
    { path: './fontes/PlusJakartaSans-latin-ext.woff2', weight: '300 600', style: 'normal' },
  ],
  variable: '--font-jakarta',
  display: 'swap',
});

const geistMono = localFont({
  src: [
    { path: './fontes/GeistMono-latin.woff2', weight: '400 500', style: 'normal' },
    { path: './fontes/GeistMono-latin-ext.woff2', weight: '400 500', style: 'normal' },
  ],
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
    'CRM de captação da KOMUNE: parceiros, Revisão, funis, conversas de WhatsApp, agenda, metas e relatórios.',
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
      className={`${jakarta.variable} ${geistMono.variable} h-full antialiased`}
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
