// =============================================================================
// TRIADE — a API externa: a resposta a cada chamada
//
// A ordem é a segurança, a mesma de `grupozap-lead` e `komune-webhook`:
// método → chave (forma) → corpo cru com teto → JSON → Postgres. O banco
// recebe só o SHA-256 da chave, e é ele quem diz se ela vale, se a rota existe,
// se o escopo deixa e se o limite por minuto passou (`public.api_atender`).
//
// A FUNÇÃO NÃO PÕE CORS. A chave dá acesso a telefones e conversas: ela vive no
// servidor de quem integra, nunca numa página. Mas atenção (medido em
// 17/11/2026, no Supabase local): o gateway do Supabase (Kong) responde sozinho
// o OPTIONS do navegador e acrescenta `Access-Control-Allow-Origin: *` a toda
// resposta, então NÃO dá para contar com o navegador barrando a chamada. A
// proteção é a regra da documentação — a chave não entra em código de página,
// aplicativo ou planilha compartilhada — e o botão de revogar, em Ajustes. O
// OPTIONS que passar do gateway recebe 405.
//
// O que vai para o log: um id da requisição (que volta no cabeçalho
// X-Requisicao, para a pessoa citar quando pedir ajuda), o método, o começo da
// chave (o mesmo que a tela mostra), o status e o tempo. Nunca o corpo, a
// consulta, a chave inteira ou o caminho com ids.
// =============================================================================

import {
  caminhoDaRota,
  chaveDeIdempotencia,
  consultaDaUrl,
  interpretarCorpo,
  lerChave,
  lerCorpoCru,
  METODOS,
  type Metodo,
  resumoDaChave,
} from './pedido.ts';

/** O que vai para `public.api_atender`. */
export type Pedido = {
  p_resumo: string;
  p_metodo: Metodo;
  p_caminho: string;
  p_consulta: Record<string, string>;
  p_corpo: unknown;
  p_idempotencia: string | null;
};

/** O que `public.api_atender` devolve: o status e o corpo, mais o que é só nosso. */
export type RespostaDoBanco = {
  status: number;
  dados?: unknown;
  erro?: { codigo: string; mensagem: string; espera_s?: number; [k: string]: unknown };
  registros?: number;
  [k: string]: unknown;
};

export type Dependencias = {
  atender: (pedido: Pedido) => Promise<RespostaDoBanco>;
  registrar: (nivel: 'info' | 'aviso' | 'erro', dados: Record<string, unknown>) => void;
  novoId?: () => string;
  agora?: () => number;
};

const CABECALHOS_FIXOS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Triade-Api': 'v1',
};

function responder(
  status: number,
  corpo: unknown,
  requisicao: string,
  extras: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CABECALHOS_FIXOS, 'X-Requisicao': requisicao, ...extras },
  });
}

function recusar(
  status: number,
  codigo: string,
  mensagem: string,
  requisicao: string,
  extras: Record<string, string> = {},
): Response {
  return responder(status, { erro: { codigo, mensagem } }, requisicao, extras);
}

export function criarAtendente(deps: Dependencias): (req: Request) => Promise<Response> {
  const novoId = deps.novoId ?? (() => crypto.randomUUID());
  const agora = deps.agora ?? (() => Date.now());

  return async (req: Request): Promise<Response> => {
    const requisicao = novoId();
    const inicio = agora();
    const metodo = req.method.toUpperCase();
    let prefixo: string | null = null;
    let status = 500;

    const fim = (resposta: Response): Response => {
      status = resposta.status;
      deps.registrar(status >= 500 ? 'erro' : 'info', {
        funcao: 'api',
        requisicao,
        metodo,
        chave: prefixo,
        status,
        ms: agora() - inicio,
      });
      return resposta;
    };

    if (!(METODOS as readonly string[]).includes(metodo)) {
      return fim(
        recusar(
          405,
          'metodo_nao_permitido',
          'A API aceita GET, POST, PATCH e DELETE, chamados de um servidor (não do navegador).',
          requisicao,
          { Allow: METODOS.join(', ') },
        ),
      );
    }

    const lida = lerChave(req.headers);
    if (!lida.ok) return fim(recusar(lida.status, lida.codigo, lida.mensagem, requisicao));
    prefixo = lida.prefixo;

    const url = new URL(req.url);
    let corpo: unknown = null;
    if (metodo === 'POST' || metodo === 'PATCH') {
      const lido = interpretarCorpo(await lerCorpoCru(req));
      if (!lido.ok) return fim(recusar(lido.status, lido.codigo, lido.mensagem, requisicao));
      corpo = lido.corpo;
    }

    let r: RespostaDoBanco;
    try {
      r = await deps.atender({
        p_resumo: await resumoDaChave(lida.chave),
        p_metodo: metodo as Metodo,
        p_caminho: caminhoDaRota(url.pathname),
        p_consulta: consultaDaUrl(url),
        p_corpo: corpo,
        p_idempotencia: chaveDeIdempotencia(req.headers),
      });
    } catch (e) {
      deps.registrar('erro', {
        funcao: 'api',
        requisicao,
        falha: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
      });
      return fim(
        recusar(
          503,
          'crm_indisponivel',
          'O CRM não respondeu agora. Tente de novo em instantes; o pedido não foi gravado.',
          requisicao,
          { 'Retry-After': '30' },
        ),
      );
    }

    if (!r || typeof r.status !== 'number' || r.status < 200 || r.status > 599) {
      deps.registrar('erro', { funcao: 'api', requisicao, falha: 'resposta do banco sem status' });
      return fim(recusar(500, 'erro_interno', 'Erro inesperado no CRM.', requisicao));
    }

    // `status` e `registros` são da porta e da anotação, não de quem integra.
    const { status: codigoHttp, registros: _registros, ...corpoDaResposta } = r;
    const extras: Record<string, string> = {};
    if (codigoHttp === 429) extras['Retry-After'] = String(r.erro?.espera_s ?? 60);
    return fim(responder(codigoHttp, corpoDaResposta, requisicao, extras));
  };
}
