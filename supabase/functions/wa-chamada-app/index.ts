// =============================================================================
// TRIADE — `wa-chamada-app`: o iPhone atende a ligação pelo WhatsApp na tela de chamada.
//
// A irmã de `wa-chamada` para o app. Com o app fechado não há página aberta nem sessão
// do site: quem identifica a pessoa é o CONVITE que veio no aviso de chamada (um por
// aparelho e por ligação, gerado em `public.voip_a_enviar`). As regras são as do botão
// Atender do navegador, no banco (`public.wa_chamada_app`). O número do cliente e o
// token da Meta ficam aqui dentro, como em `wa-chamada`.
//
//   atender      reserva a ligação que ainda toca e devolve a oferta SDP da Meta
//   pre_aceitar  a resposta SDP, para a conexão subir antes de atender
//   aceitar      atende de verdade; só depois do 200 o áudio corre
//   encerrar     desliga (a Meta cobra a ligação aberta)
//   soltar       a rede caiu antes de atender: a ligação volta a tocar para o CRM aberto
//   recusar      Recusar neste iPhone: só ele para de tocar (não recebe o "parar")
//   estado       o app pergunta, tocando e durante a ligação, se a ligação continua
//   diario       o app manda as linhas do diário (passos, áudio, conexão), 24/11/2026
//
// A `wa-chamada` do navegador não muda. Guia: docs/operacao/ligacao-whatsapp.md.
// =============================================================================

import { erro, exigirMetodo, json, preflight, registrar } from '../_compartilhado/http.ts';
import { rpcServico } from '../_compartilhado/postgrest.ts';
import { segredo, SegredoAusente } from '../_compartilhado/segredos.ts';
import { corpoDaMeta, fraseDoErro, lerErroDaMeta, type PedidoDaMeta } from '../wa-chamada/meta.ts';

const TAMANHO_MAXIMO = 64 * 1024;
const TEMPO_DA_META_MS = 10_000;
const URL_DA_GRAPH = (Deno.env.get('META_WA_GRAPH_URL') ?? 'https://graph.facebook.com').replace(/\/+$/, '');
const VERSAO_DA_GRAPH = Deno.env.get('META_WA_API_VERSION') ?? 'v26.0';
const ACOES = ['atender', 'pre_aceitar', 'aceitar', 'encerrar', 'soltar', 'recusar', 'estado', 'diario'] as const;
type Acao = (typeof ACOES)[number];

type DoBanco = {
  ok: boolean;
  motivo?: string;
  chamada_id?: string;
  oferta_sdp?: string | null;
  quem?: string;
  estado?: string;
  minha?: boolean;
};
type DadosDaMeta = { meta_call_id: string | null; para: string; direcao: string; estado: string } | null;

const RECUSAS: Record<string, string> = {
  convite_invalido: 'Esta ligação não pode mais ser atendida por aqui.',
  sem_permissao: 'Seu perfil não atende ligações pelo CRM.',
  ja_atendida: 'Outra pessoa já atendeu esta ligação.',
  encerrada: 'O cliente desligou antes.',
  voce_ja_esta_em_ligacao: 'Você já está em outra ligação.',
  ligacao_desconhecida: 'Esta ligação não existe mais.',
  acao_nao_permitida: 'Esta ligação já mudou de estado.',
};

async function pedirAMeta(pedido: PedidoDaMeta): Promise<{ ok: boolean; corpo: unknown }> {
  const [token, numero] = (
    await Promise.all([segredo('meta_wa_access_token'), segredo('meta_wa_phone_number_id')])
  ).map((valor) => valor.trim());
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

function recusa(motivo: string | undefined): Response {
  const m = motivo ?? 'sem_permissao';
  return erro(409, m, RECUSAS[m] ?? RECUSAS.sem_permissao);
}

function recusaDaMeta(acao: string, chamadaId: string, corpo: unknown): Response {
  const e = lerErroDaMeta(corpo);
  registrar('erro', { funcao: 'wa-chamada-app', acao, chamada: chamadaId, codigo: e.codigo, mensagem: e.mensagem });
  return json({ ok: false, codigo: 'meta_recusou', meta: e.codigo, mensagem: fraseDoErro(e.codigo) }, 502);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  const metodo = exigirMetodo(req, ['POST']);
  if (metodo) return metodo;

  let pedido: { convite?: unknown; acao?: unknown; sdp?: unknown; linhas?: unknown };
  try {
    const cru = await req.text();
    if (cru.length > TAMANHO_MAXIMO) return erro(413, 'corpo_grande_demais', 'O pedido é grande demais.');
    pedido = JSON.parse(cru);
  } catch (e) {
    return erro(400, 'json_invalido', 'O pedido não é um JSON válido.', e);
  }
  const convite = typeof pedido.convite === 'string' ? pedido.convite : '';
  const acao = (ACOES as readonly string[]).includes(pedido.acao as string) ? (pedido.acao as Acao) : null;
  const sdp = typeof pedido.sdp === 'string' ? pedido.sdp : '';
  if (!acao || convite === '') return erro(400, 'pedido_invalido', 'Pedido de ligação inválido.');
  if ((acao === 'pre_aceitar' || acao === 'aceitar') && sdp === '') {
    return erro(400, 'sem_sdp', 'O pedido veio sem os dados da conexão.');
  }

  const noBanco = (a: string) => rpcServico<DoBanco>('wa_chamada_app', { p_convite: convite, p_acao: a });

  if (acao === 'diario') {
    if (!Array.isArray(pedido.linhas)) return erro(400, 'pedido_invalido', 'O diário veio sem linhas.');
    try {
      const r = await rpcServico<{ ok: boolean; motivo?: string; linhas?: number }>('voip_diario', {
        p_convite: convite,
        p_linhas: pedido.linhas,
      });
      return r.ok ? json({ ok: true, linhas: r.linhas ?? 0 }) : recusa(r.motivo);
    } catch (e) {
      return erro(502, 'falha_no_banco', 'Não consegui guardar o diário.', e);
    }
  }

  try {
    if (acao === 'atender' || acao === 'soltar' || acao === 'recusar' || acao === 'estado') {
      const r = await noBanco(acao);
      if (!r.ok) return recusa(r.motivo);
      if (acao === 'atender') {
        if (!r.oferta_sdp) return recusa('ja_atendida');
        return json(
          { ok: true, chamada_id: r.chamada_id, oferta_sdp: r.oferta_sdp, quem: r.quem },
          200,
          { 'Cache-Control': 'no-store' },
        );
      }
      return json({ ok: true, estado: r.estado ?? null, minha: r.minha ?? null }, 200, { 'Cache-Control': 'no-store' });
    }

    const permissao = await noBanco(acao === 'encerrar' ? 'encerrar' : 'autorizar');
    if (!permissao.ok || !permissao.chamada_id) {
      // Desligar o que já acabou não é erro para o app: a tela de chamada só fecha.
      if (acao === 'encerrar') return json({ ok: true, ja_encerrada: true });
      return recusa(permissao.motivo);
    }
    const chamadaId = permissao.chamada_id;
    const dados = await rpcServico<DadosDaMeta>('wa_chamada_para_meta', { p_chamada_id: chamadaId });
    if (!dados || dados.meta_call_id === null) {
      if (acao === 'encerrar') return json({ ok: true });
      return recusa('ligacao_desconhecida');
    }

    if (acao === 'encerrar') {
      const r = await pedirAMeta({ acao: 'terminate', callId: dados.meta_call_id });
      // O cliente pode ter desligado no mesmo instante; o fim chega pelo webhook de qualquer jeito.
      if (!r.ok) {
        registrar('info', { funcao: 'wa-chamada-app', acao, chamada: chamadaId, codigo: lerErroDaMeta(r.corpo).codigo });
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
        p_dados: { codigo: e.codigo, mensagem: e.mensagem, pelo: 'app' },
      });
      return recusaDaMeta(acao, chamadaId, r.corpo);
    }
    await rpcServico('wa_chamada_marcar', { p_chamada_id: chamadaId, p_evento: 'aceita' });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof SegredoAusente) {
      return erro(503, 'integracao_nao_configurada', 'A ligação pelo WhatsApp ainda não está configurada.', e, {
        segredo_faltando: e.nome,
      });
    }
    return erro(502, 'falha_na_meta', 'Não consegui falar com a Meta agora. Tente de novo.', e, { acao });
  }
});
