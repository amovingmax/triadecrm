import type { MetadataRoute } from 'next';

import { EMPRESA } from '@/lib/empresa';

/** A pasta dos ícones da PWA da empresa (`public/icons` na KOMUNE). */
const ICONES = EMPRESA.visual.icones;

/** Manifest da PWA (PRD §8: instalável no celular, mobile-first nas telas de campo). Servido em /manifest.webmanifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: EMPRESA.tituloDoApp,
    short_name: EMPRESA.tituloDoApp,
    description: EMPRESA.descricaoDoApp,
    lang: 'pt-BR',
    dir: 'ltr',
    id: '/',
    start_url: '/meu-dia',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // O `theme_color` é o valor único do viewport.themeColor de layout.tsx
    // (--grafite-900, o fundo do modo escuro, que é o padrão do produto): a cor da
    // barra segue o tema escolhido NO CRM, não o prefers-color-scheme do aparelho.
    // O `background_color` é a cor da splash da PWA instalada e aceita um valor só;
    // hoje ele é o claro (--grafite-50) enquanto o app abre escuro. Pendência de
    // decisão humana registrada no CHANGELOG. Branco e preto puros seguem fora.
    // Por empresa desde 10/11/2026 (`EMPRESA.visual`); a KOMUNE guarda os dois valores
    // de antes, e a Imova usa os do tema claro em que ela abre.
    background_color: EMPRESA.visual.manifest.fundo,
    theme_color: EMPRESA.visual.manifest.tema,
    categories: ['business', 'productivity'],
    icons: [
      { src: `${ICONES}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${ICONES}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: `${ICONES}/icon-512-maskable.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
