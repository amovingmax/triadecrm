/**
 * Os cabeçalhos com que a rota `/inteligencia/painel` entrega a página pronta da
 * Inteligência de mercado (revisão de 18/11/2026). Lógica pura, sem Next nem disco.
 *
 * POR QUE `sandbox`. A página roda na mesma origem do CRM, onde os cookies de sessão
 * do Supabase (`@supabase/ssr`, sem httpOnly) podem ser lidos por JavaScript. Ela
 * monta HTML em texto com títulos e endereços de anúncios coletados de terceiros e
 * carrega duas bibliotecas de CDN. Com `sandbox` sem `allow-same-origin`, o navegador
 * a trata como origem opaca: nenhum código dela (nem um `esc()` esquecido, nem uma CDN
 * comprometida) lê cookie, localStorage ou faz pedido com a sessão do CRM. As
 * bibliotecas ainda vão presas ao hash (`integrity`, em `scripts/inteligencia/adaptar.mjs`).
 *
 * O PREÇO DO `sandbox`. Página de origem opaca não manda o cabeçalho Referer, e a
 * política de uso do OpenStreetMap pede Referer de quem pede ladrilho pelo navegador.
 * Decisão de 19/11/2026: a cópia do CRM fica SEM fundo de mapa (`semFundoDoMapa`, em
 * `scripts/inteligencia/adaptar.mjs`, troca cada ladrilho por um GIF transparente dentro
 * da página), e por isso tile.openstreetmap.org saiu do `img-src`: nenhum pedido sai.
 */

/** De onde a página pode carregar código. Cada arquivo vai preso ao hash pelo adaptar.mjs. */
export const ORIGENS_DE_SCRIPT = ['https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'];

/** De onde vêm estilo (Google Fonts e o CSS do Leaflet) e fonte. */
const ORIGENS_DE_ESTILO = ['https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'];
const ORIGENS_DE_FONTE = ['https://fonts.gstatic.com'];

/** Imagens: os ícones do CSS do Leaflet. O mapa vai sem fundo (ver acima). */
const ORIGENS_DE_IMAGEM = ['https://cdnjs.cloudflare.com'];

export const SANDBOX_DA_PAGINA_PRONTA =
  'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox';

/**
 * A política inteira. `connect-src 'none'`: a página não busca nada (os dados estão
 * dentro dela; o adaptar.mjs recusa `fetch` do próprio site). `frame-ancestors 'none'`:
 * ninguém a põe dentro de outro site.
 */
export const POLITICA_DA_PAGINA_PRONTA = [
  SANDBOX_DA_PAGINA_PRONTA,
  "default-src 'none'",
  `script-src 'unsafe-inline' ${ORIGENS_DE_SCRIPT.join(' ')}`,
  `style-src 'unsafe-inline' ${ORIGENS_DE_ESTILO.join(' ')}`,
  `font-src data: ${ORIGENS_DE_FONTE.join(' ')}`,
  `img-src data: blob: ${ORIGENS_DE_IMAGEM.join(' ')}`,
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** O que vale para toda resposta da rota, inclusive "ainda sem página" e 304. */
const COMUNS: Record<string, string> = {
  // Dado interno, só com login: nada de cache compartilhado, e o navegador pergunta de
  // novo a cada abertura (304 quando não mudou, sem baixar a página de novo).
  'Cache-Control': 'private, no-cache',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

/** Os cabeçalhos da página pronta (200 e 304). O corpo vai em gzip, como está no disco. */
export function cabecalhosDaPaginaPronta(etag: string): Record<string, string> {
  return {
    ...COMUNS,
    'Content-Security-Policy': POLITICA_DA_PAGINA_PRONTA,
    ETag: etag,
  };
}

/** Os cabeçalhos de uma página simples da rota (aviso em HTML puro, sem script). */
export function cabecalhosDePaginaSimples(): Record<string, string> {
  return {
    ...COMUNS,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
}

/** O `If-None-Match` do navegador bate com a etiqueta da página? (aceita lista e `W/`) */
export function aindaIgual(seNaoBater: string | null, etag: string): boolean {
  if (!seNaoBater) return false;
  return seNaoBater
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''))
    .some((v) => v === '*' || v === etag);
}

const escapar = (texto: string) =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Uma página de aviso em HTML puro (sem script, sem nada de fora): "ainda sem página",
 * "não deu para conferir o acesso" e parecidos. Segue o tema do sistema.
 */
export function paginaSimples({
  titulo,
  texto,
  voltarPara,
}: {
  titulo: string;
  texto: string;
  voltarPara: string;
}): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapar(titulo)}</title>
<style>
:root{color-scheme:light dark;--fundo:#fafafa;--texto:#18181b;--suave:#52525b;--borda:#e4e4e7}
@media (prefers-color-scheme:dark){:root{--fundo:#09090b;--texto:#fafafa;--suave:#a1a1aa;--borda:#27272a}}
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box;background:var(--fundo);color:var(--texto);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:30rem;border:1px solid var(--borda);border-radius:12px;padding:24px}
h1{margin:0 0 8px;font-size:18px}
p{margin:0 0 16px;color:var(--suave)}
a{color:inherit;font-weight:600}
</style>
</head>
<body>
<main>
<h1>${escapar(titulo)}</h1>
<p>${escapar(texto)}</p>
<a href="${escapar(voltarPara)}">← Voltar ao CRM</a>
</main>
</body>
</html>
`;
}
