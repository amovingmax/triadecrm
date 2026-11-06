// =============================================================================
// TRIADE — `canal-pro-feed`: o arquivo de anúncios que o Canal Pro lê (04/11/2026)
//
// Só da Imova: é publicada só no projeto dela. O Grupo OLX não tem API para
// criar anúncio; o anunciante cola UMA URL no Canal Pro ("Integração de
// anúncios") e o robô deles baixa o XML VRSync a cada 12 horas. Esta é a URL:
//
//   GET <projeto>/functions/v1/canal-pro-feed?chave=<64 hex>
//
// A chave é a credencial (o arquivo tem o endereço inteiro de cada imóvel,
// inclusive o que o anúncio esconde) e nunca entra em log. Chave errada recebe
// 404, sem dizer por quê, e o Postgres não anota nada.
//
// FALHA NUNCA VIRA ARQUIVO VAZIO. Um XML válido sem anúncios diria ao Grupo OLX
// que a Imova tirou tudo do ar. Se o banco não responde, sai 503: segundo a
// documentação, com o arquivo indisponível os anúncios só deixam de ser
// atualizados até a próxima leitura.
// =============================================================================

import { registrar } from '../_compartilhado/http.ts';
import { rpcAnonimo } from '../_compartilhado/postgrest.ts';
import { montarVrsync, type RespostaDoFeed } from './vrsync.ts';

const CHAVE = /^[0-9a-f]{64}$/;

// A URL das fotos é a pública do projeto. No ambiente local o SUPABASE_URL de
// dentro do contêiner não é alcançável de fora, e `URL_PUBLICA_DO_PROJETO` o troca.
const URL_DO_PROJETO = (
  Deno.env.get('URL_PUBLICA_DO_PROJETO') ??
  Deno.env.get('SUPABASE_URL') ??
  ''
).replace(/\/$/, '');

function urlDaFoto(caminho: string): string {
  return `${URL_DO_PROJETO}/storage/v1/object/public/anuncios/${caminho.split('/').map(encodeURIComponent).join('/')}`;
}

function texto(corpo: string, status: number): Response {
  return new Response(corpo, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return texto('Este endereço só serve o arquivo de anúncios, por GET.', 405);
  }
  const chave = new URL(req.url).searchParams.get('chave') ?? '';
  if (!CHAVE.test(chave)) return texto('Não encontrado.', 404);
  // O HEAD de quem confere a URL não conta como leitura e não vai ao banco.
  if (req.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    });
  }

  const quem = (req.headers.get('user-agent') ?? '').slice(0, 300);
  let resposta: RespostaDoFeed;
  try {
    resposta = await rpcAnonimo<RespostaDoFeed>('canal_pro_feed', { p_chave: chave, p_quem: quem });
  } catch (e) {
    registrar('erro', {
      funcao: 'canal-pro-feed',
      etapa: 'banco',
      interno: e instanceof Error ? e.message : String(e),
    });
    return texto('O arquivo está indisponível agora. A próxima leitura tenta de novo.', 503);
  }
  if (!resposta?.ok || !resposta.imobiliaria || !Array.isArray(resposta.anuncios)) {
    return texto('Não encontrado.', 404);
  }

  const xml = montarVrsync(resposta.imobiliaria, resposta.anuncios, urlDaFoto);
  registrar('info', {
    funcao: 'canal-pro-feed',
    anuncios: resposta.anuncios.length,
    robo: /VivaRealBot/i.test(quem),
  });
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
});
