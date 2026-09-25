/**
 * Os redirects permanentes do app, num lugar que o Vitest enxerga.
 *
 * `permanent: true` é 308: o Next repassa a query string, então
 * `/radar?aba=fontes` chega em `/revisao?aba=fontes` — e a Revisão ignora o
 * parâmetro, porque as abas saíram junto com o catálogo de fontes.
 *
 * `/radar` não tem sub-rota (a pasta tinha `page.tsx` e `layout.tsx`, mais
 * nada), por isso uma entrada basta.
 */
export const REDIRECIONAMENTOS = [
  {
    // O Radar desligou em 25/09/2026 (Fase 2 do pivô, ADR-12). A fila de
    // curadoria ficou, e virou Revisão: é por ela que passa cada linha do CSV
    // do Google Maps, e é para lá que o recibo da importação manda decidir.
    source: '/radar',
    destination: '/revisao',
    permanent: true,
  },
] as const;
