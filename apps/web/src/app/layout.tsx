import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';

import './globals.css';

import { ProvedorTema } from '@/components/tema/provedor-tema';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EMPRESA } from '@/lib/empresa';
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

/**
 * As fontes da Imova (10/11/2026): Figtree na interface e Urbanist nos títulos, que
 * tem o O redondo do logo. Só a Imova liga as variáveis delas no <html>; na KOMUNE
 * nenhum elemento as usa, e o navegador não baixa fonte que ninguém usa.
 *
 * `preload: false` por isso mesmo: fonte do layout raiz é pré-carregada em TODA rota
 * (docs do next/font, "Preloading"), e a KOMUNE passaria a baixar duas fontes que não
 * desenha. Na Imova o preço é o primeiro desenho com a fonte do sistema, por um
 * instante, na primeira visita (`display: swap`).
 */
const figtree = localFont({
  src: [
    { path: './fontes/Figtree-latin.woff2', weight: '300 800', style: 'normal' },
    { path: './fontes/Figtree-latin-ext.woff2', weight: '300 800', style: 'normal' },
  ],
  variable: '--font-figtree',
  display: 'swap',
  preload: false,
});

const urbanist = localFont({
  src: [
    { path: './fontes/Urbanist-latin.woff2', weight: '500 800', style: 'normal' },
    { path: './fontes/Urbanist-latin-ext.woff2', weight: '500 800', style: 'normal' },
  ],
  variable: '--font-urbanist',
  display: 'swap',
  preload: false,
});

/** As classes de fonte que cada empresa liga no <html>. A KOMUNE fica com as de sempre. */
const FONTES_DA_EMPRESA =
  EMPRESA.slug === 'imova'
    ? `${jakarta.variable} ${geistMono.variable} ${figtree.variable} ${urbanist.variable}`
    : `${jakarta.variable} ${geistMono.variable}`;

/** Os ícones da PWA ficam numa pasta por empresa (`public/icons`, `public/icons/imova`). */
const ICONES = EMPRESA.visual.icones;

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: EMPRESA.tituloDoApp,
    template: `%s · ${EMPRESA.tituloDoApp}`,
  },
  description: EMPRESA.descricaoDoApp,
  applicationName: EMPRESA.tituloDoApp,
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: EMPRESA.tituloDoApp,
  },
  icons: {
    icon: [
      { url: `${ICONES}/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { url: `${ICONES}/icon-512.png`, sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: `${ICONES}/icon-192.png`, sizes: '192x192', type: 'image/png' }],
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
  // Por empresa desde 10/11/2026: a barra nasce na cor do tema de entrada da empresa
  // (KOMUNE: escuro, #0f172a, como sempre; Imova: claro).
  themeColor: EMPRESA.visual.corDaBarra[EMPRESA.visual.temaPadrao],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // O tema de entrada primeiro: é o que o next-themes resolve por padrão, e é o que os
  // controles nativos (barra de rolagem, campo de data) devem desenhar.
  colorScheme: EMPRESA.visual.temaPadrao === 'dark' ? 'dark light' : 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `.variable` publica --font-geist e --font-geist-mono, lidos pelo globals.css.
    // `suppressHydrationWarning` é exigido pelo next-themes, que escreve a classe do tema
    // no <html> antes da hidratação.
    // `data-empresa` liga o bloco de cores da empresa no globals.css. Só a Imova tem
    // bloco; na KOMUNE o atributo não casa com nenhuma regra e a tela fica a de sempre.
    <html
      lang="pt-BR"
      data-empresa={EMPRESA.slug}
      className={`${FONTES_DA_EMPRESA} h-full antialiased`}
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
