import type { MetadataRoute } from 'next';

/** Manifest da PWA (PRD §8: instalável no celular, mobile-first nas telas de campo). Servido em /manifest.webmanifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'KOMUNE CRM',
    short_name: 'KOMUNE',
    description:
      'CRM de captação da KOMUNE: parceiros, Radar, funis, conversas de WhatsApp, agenda, metas e relatórios.',
    lang: 'pt-BR',
    dir: 'ltr',
    id: '/',
    start_url: '/meu-dia',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Espelha o viewport.themeColor de layout.tsx: --grafite-50 no claro e
    // --grafite-950 no escuro. Branco puro e preto puro estão fora da paleta.
    background_color: '#f6f7f9',
    theme_color: '#12151a',
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
