import type { MetadataRoute } from 'next';

/** Manifest da PWA (PRD §8: instalável no celular, mobile-first nas telas de campo). Servido em /manifest.webmanifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tríade',
    short_name: 'Tríade',
    description:
      'CRM de captação da KOMUNE: parceiros, Radar, funis, conversas de WhatsApp, agenda, metas e relatórios.',
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
    background_color: '#f0f8ff',
    theme_color: '#0f172a',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
