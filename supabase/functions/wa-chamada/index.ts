// =============================================================================
// TRIADE — `wa-chamada`: o CRM fala com a Meta para atender, ligar e desligar.
//
// O navegador nunca vê o token da Meta nem o número do cliente. Ele manda o SDP e o id
// da ligação; quem é a pessoa e o que ela pode fazer saem do Postgres
// (`wa_chamada_autorizar`, com o JWT dela), e o número sai de uma porta do serviço
// (`wa_chamada_para_meta`), porque o SDR vê o telefone mascarado.
//
// A ligação em si não passa por aqui: o áudio vai direto entre o navegador e a Meta.
//
//   pre_aceitar  a resposta SDP, para a conexão subir antes de atender
//   aceitar      atende de verdade; só depois do 200 o áudio pode correr
//   ligar        a oferta SDP para o cliente que já deu permissão
//   encerrar     desliga, mesmo que o áudio já tenha parado (a Meta cobra por isso)
//
// Guia e regras da Meta: docs/operacao/ligacao-whatsapp.md.
// =============================================================================

import { erro, exigirMetodo, json, preflight, registrar } from '../_compartilhado/http.ts';
import { ErroDeBanco, rpcDoUsuario, rpcServico } from '../_compartilhado/postgrest.ts';
import { segredo, SegredoAusente } from '../_compartilhado/segredos.ts';
import { corpoDaMeta, fraseDoErro, idDaChamada, lerErroDaMeta, type PedidoDaMeta } from './meta.ts';

const TAMANHO_MAXIMO = 64 * 1024;
const TEMPO_DA_META_MS = 10_000;
const URL_DA_GRAPH = (Deno.env.get('META_WA_GRAPH_URL') ?? 'https://graph.facebook.com').replace(/\/+$/, '');
const VERSAO_DA_GRAPH = Deno.env.get('META_WA_API_VERSION') ?? 'v26.0';

type Autorizacao = { ok: boolean; motivo?: string };
type DadosDaMeta = { meta_call_id: string | null; para: string; direcao: string; estado: string } | null;
type RespostaDaMeta = { ok: boolean; corpo: unknown };

const RECUSAS: Record<string, string> = {
  sem_permissao: 'Seu perfil não faz ligações pelo CRM.',
  ligacao_desconhecida: 'Esta ligação não existe mais.',
  acao_nao_permitida: 'Esta ligação já mudou de estado ou está com outra pessoa.',
};

async function pedirAMeta(pedido: PedidoDaMeta): Promise<RespostaDaMeta> {
  const [token, numero] = await Promise.all([
    segredo('meta_wa_access_token'),
    segredo('meta_wa_phone_number_id'),
  ]);
  const controle = new AbortController();
  const tempo = setTimeout(() => controle.abort(), TEMPO_DA_META_MS);
  try {
    const r = await fetch(`${URL_DA_GRAPH}/${VERSAO_DA_GRAPH}/${numero}/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(corpoDaMeta(pedido)),
      signal: controle.signal,
    });
    const texto = await r.text();
    let corpo: unknown = null;
    try {
      corpo = texto.length > 0 ? JSON.parse(texto) : null;
    } catch {
      corpo = null;
    }
    return { ok: r.ok, corpo };
  } finally {
    clearTimeout(tempo);
  }
}

/** A Meta recusou: registra o código no log e devolve a frase para a tela. */
function recusaDaMeta(acao: string, chamadaId: string, corpo: unknown): Response {
  const e = lerErroDaMeta(corpo);
  registrar('erro', { funcao: 'wa-chamada', acao, chamada: chamadaId, codigo: e.codigo, mensagem: e.mensagem });
  return json({ ok: false, codigo: 'meta_recusou', meta: e.codigo, mensagem: fraseDoErro(e.codigo) }, 502);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  const metodo = exigirMetodo(req, ['POST']);
  if (metodo) return metodo;

  const autorizacao = req.headers.get('authorization');
  if (!autorizacao) {
    return erro(401, 'sem_sessao', 'Sua sessão expirou. Entre de novo para ligar.');
  }

  let pedido: { acao?: unknown; chamada_id?: unknown; sdp?: unknown };
  try {
    const cru = await req.text();
    if (cru.length > TAMANHO_MAXIMO) {
      return erro(413, 'corpo_grande_demais', 'O pedido é grande demais.');
    }
    pedido = JSON.parse(cru);
  } catch (e) {
    return erro(400, 'json_invalido', 'O pedido não é um JSON válido.', e);
  }
  const acao = typeof pedido.acao === 'string' ? pedido.acao : '';
  const chamadaId = typeof pedido.chamada_id === 'string' ? pedido.chamada_id : '';
  const sdp = typeof pedido.sdp === 'string' ? pedido.sdp : '';
  if (!['pre_aceitar', 'aceitar', 'ligar', 'encerrar'].includes(acao) || chamadaId === '') {
    return erro(400, 'pedido_invalido', 'Pedido de ligação inválido.');
  }
  if (acao !== 'encerrar' && sdp === '') {
    return erro(400, 'sem_sdp', 'O pedido veio sem os dados da conexão.');
  }

  // Quem é a pessoa e se pode: o Postgres confere o JWT.
  const acaoNoBanco = acao === 'pre_aceitar' || acao === 'aceitar' ? 'atender' : acao;
  let permissao: Autorizacao;
  try {
    permissao = await rpcDoUsuario<Autorizacao>(
      'wa_chamada_autorizar',
      { p_chamada_id: chamadaId, p_acao: acaoNoBanco },
      autorizacao,
    );
  } catch (e) {
    if (e instanceof ErroDeBanco && (e.status === 401 || e.status === 403)) {
      return erro(401, 'sem_sessao', 'Sua sessão expirou. Entre de novo para ligar.', e);
    }
    return erro(500, 'falha_ao_conferir', 'Não consegui conferir a ligação. Tente de novo.', e);
  }
  if (!permissao.ok) {
    const motivo = permissao.motivo ?? 'sem_permissao';
    return erro(409, motivo, RECUSAS[motivo] ?? RECUSAS.sem_permissao);
  }

  try {
    const dados = await rpcServico<DadosDaMeta>('wa_chamada_para_meta', { p_chamada_id: chamadaId });
    if (!dados) return erro(409, 'ligacao_desconhecida', RECUSAS.ligacao_desconhecida);

    if (acao === 'ligar') {
      const r = await pedirAMeta({ acao: 'connect', para: dados.para, sdp, opaco: chamadaId });
      if (!r.ok) {
        const e = lerErroDaMeta(r.corpo);
        await rpcServico('wa_chamada_marcar', {
          p_chamada_id: chamadaId,
          p_evento: 'falhou',
          p_dados: { codigo: e.codigo, mensagem: e.mensagem },
        });
        return recusaDaMeta(acao, chamadaId, r.corpo);
      }
      const id = idDaChamada(r.corpo);
      if (id !== null) {
        await rpcServico('wa_chamada_marcar', {
          p_chamada_id: chamadaId,
          p_evento: 'meta_id',
          p_dados: { meta_call_id: id },
        });
      }
      return json({ ok: true }, 200, { 'Cache-Control': 'no-store' });
    }

    if (dados.meta_call_id === null) {
      // Desligou antes de a Meta dar o id: não há o que pedir a ela.
      if (acao === 'encerrar') {
        await rpcServico('wa_chamada_marcar', {
          p_chamada_id: chamadaId,
          p_evento: 'falhou',
          p_dados: { motivo: 'encerrada_antes_da_meta' },
        });
        return json({ ok: true });
      }
      return erro(409, 'ligacao_desconhecida', RECUSAS.ligacao_desconhecida);
    }

    if (acao === 'encerrar') {
      const r = await pedirAMeta({ acao: 'terminate', callId: dados.meta_call_id });
      // O cliente pode ter desligado no mesmo instante; o fim chega pelo webhook de qualquer jeito.
      if (!r.ok) {
        const e = lerErroDaMeta(r.corpo);
        registrar('info', { funcao: 'wa-chamada', acao, chamada: chamadaId, codigo: e.codigo });
      }
      return json({ ok: true });
    }

    if (acao === 'pre_aceitar') {
      const r = await pedirAMeta({ acao: 'pre_accept', callId: dados.meta_call_id, sdp });
      return r.ok ? json({ ok: true }) : recusaDaMeta(acao, chamadaId, r.corpo);
    }

    const r = await pedirAMeta({ acao: 'accept', callId: dados.meta_call_id, sdp, opaco: chamadaId });
    if (!r.ok) {
      const e = lerErroDaMeta(r.corpo);
      await rpcServico('wa_chamada_marcar', {
        p_chamada_id: chamadaId,
        p_evento: 'falhou',
        p_dados: { codigo: e.codigo, mensagem: e.mensagem },
      });
      return recusaDaMeta(acao, chamadaId, r.corpo);
    }
    await rpcServico('wa_chamada_marcar', { p_chamada_id: chamadaId, p_evento: 'aceita' });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof SegredoAusente) {
      return erro(
        503,
        'integracao_nao_configurada',
        'A ligação pelo WhatsApp ainda não está configurada. Avise quem administra o CRM.',
        e,
        { segredo_faltando: e.nome },
      );
    }
    return erro(502, 'falha_na_meta', 'Não consegui falar com a Meta agora. Tente de novo.', e);
  }
});
