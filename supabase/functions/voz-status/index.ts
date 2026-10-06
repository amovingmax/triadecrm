// =============================================================================
// TRIADE — `voz-status` (R13 §3.4)
//
// O Twilio avisa aqui cada mudança de estado da perna que toca no telefone do
// parceiro: iniciou, tocou, atendeu, terminou (ou ocupado, não atendeu, falhou).
//
// Mesma ordem das outras portas: corpo cru com teto → assinatura → leitura →
// Postgres. Esta função não decide nada: `voz_registrar_evento` grava o aviso
// uma vez só e avança a chamada. Aviso repetido volta `repetido: true` e não
// muda nada — é isso que torna seguro o Twilio reenviar.
//
// POR QUE NÃO PASSA PELA FILA (ADR-04): a tela de quem está ligando acompanha
// este estado ao vivo, e os workers da máquina dedicada podem estar desligados.
// O que se faz aqui é uma única escrita idempotente, sem processamento.
//
// A assinatura cobre a URL COM o `?ligacao=`: trocar o id da chamada na URL
// invalida a assinatura. E o banco ainda exige que a perna-mãe do aviso seja a
// da chamada.
// =============================================================================

import { erro, exigirMetodo, registrar } from '../_compartilhado/http.ts';
import { rpcServico } from '../_compartilhado/postgrest.ts';
import { SegredoAusente } from '../_compartilhado/segredos.ts';
import { parametrosDoFormulario, UUID, verificarDoTwilio } from '../_compartilhado/twilio.ts';
import { authToken, corpoComTeto, urlDeEstado } from '../_compartilhado/voz-config.ts';

type Registro = { ok: true; repetido: boolean; status: string } | { ok: false; motivo: string };

function instante(carimbo: string | undefined): string | null {
  if (!carimbo) return null;
  const ms = Date.parse(carimbo);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function inteiro(valor: string | undefined): number | null {
  if (!valor || !/^\d{1,6}$/.test(valor)) return null;
  return Number(valor);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const metodo = exigirMetodo(req, ['POST']);
  if (metodo) return metodo;

  const corpoCru = await corpoComTeto(req);
  if (corpoCru === null) return erro(413, 'corpo_grande_demais', 'Pedido grande demais.');

  let token: string;
  try {
    token = await authToken();
  } catch (e) {
    return erro(503, 'integracao_nao_configurada', 'A telefonia ainda não está configurada.', e, {
      segredo_faltando: e instanceof SegredoAusente ? e.nome : undefined,
    });
  }

  const busca = new URL(req.url).search;
  const parametros = parametrosDoFormulario(corpoCru);
  const conferencia = await verificarDoTwilio({
    authToken: token,
    url: `${urlDeEstado()}${busca}`,
    parametros,
    assinaturaRecebida: req.headers.get('x-twilio-signature'),
  });
  if (!conferencia.ok) {
    registrar('erro', { funcao: 'voz-status', recusa: conferencia.codigo });
    return new Response('Chamada recusada.', { status: 403 });
  }

  const ligacao = new URLSearchParams(busca).get('ligacao') ?? '';
  const perna = parametros.CallSid ?? '';
  const estado = parametros.CallStatus ?? '';
  const codigo = parametros.ErrorCode ?? parametros.SipResponseCode ?? null;
  if (!UUID.test(ligacao) || perna.length === 0 || estado.length === 0) {
    registrar('aviso', {
      funcao: 'voz-status',
      recusa: 'aviso_incompleto',
      provider_call_sid: perna,
    });
    return new Response(null, { status: 204 });
  }

  let registro: Registro;
  try {
    registro = await rpcServico<Registro>('voz_registrar_evento', {
      p_call_id: ligacao,
      p_call_sid: perna,
      p_parent_sid: parametros.ParentCallSid ?? '',
      p_estado: estado,
      p_duracao_seg: inteiro(parametros.CallDuration),
      // Código SIP 200 é sucesso, não falha: não vira `error_code`.
      p_error_code: codigo && codigo !== '200' ? codigo : null,
      p_em: instante(parametros.Timestamp),
    });
  } catch (e) {
    // 500 de propósito: o Twilio tenta de novo, e a escrita é idempotente.
    return erro(500, 'falha_ao_registrar', 'Não consegui registrar o aviso agora.', e, {
      call_id: ligacao,
      provider_call_sid: perna,
      event: estado,
    });
  }

  registrar(registro.ok ? 'info' : 'aviso', {
    funcao: 'voz-status',
    call_id: ligacao,
    provider_call_sid: perna,
    event: estado,
    error_code: codigo && codigo !== '200' ? codigo : undefined,
    repetido: registro.ok ? registro.repetido : undefined,
    recusa: registro.ok ? undefined : registro.motivo,
  });
  // Aviso de chamada desconhecida também recebe 2xx: reenviar não mudaria nada.
  return new Response(null, { status: 204 });
});
