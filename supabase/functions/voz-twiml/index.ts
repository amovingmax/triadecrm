// =============================================================================
// TRIADE — `voz-twiml` (R13 §3.4)
//
// O Twilio chama aqui quando o softphone de alguém pede uma chamada, e a
// resposta diz para quem discar.
//
// A ORDEM É A SEGURANÇA, a mesma das outras portas de fora:
//   1. corpo cru, com teto
//   2. assinatura `X-Twilio-Signature` conferida em tempo constante
//   3. só então o pedido é lido
//   4. o Postgres decide (`voz_twiml_autorizar`) e devolve o número
//
// O NÚMERO NÃO VEM DO NAVEGADOR. O softphone manda só o id da chamada que
// `voz_abrir_ligacao` abriu; o banco confere que ela é de quem está pedindo
// (a identidade vem do Twilio, dentro do corpo assinado), que ainda vale e que
// continua dentro das travas, e é ele que entrega o número. Um pedido forjado
// no console do navegador, com outro número ou outra chamada, termina em
// <Hangup/>.
//
// SEM SEGREDO, RECUSA FECHADA: sem o Auth Token não há como conferir, e sem
// conferir não se disca.
// =============================================================================

import { erro, exigirMetodo, registrar } from '../_compartilhado/http.ts';
import { rpcServico } from '../_compartilhado/postgrest.ts';
import { SegredoAusente } from '../_compartilhado/segredos.ts';
import {
  parametrosDoFormulario,
  respostaTwiml,
  twimlDesligar,
  twimlDiscar,
  UUID,
  verificarDoTwilio,
} from '../_compartilhado/twilio.ts';
import {
  authToken,
  corpoComTeto,
  numeroDeOrigem,
  urlDeEstado,
  urlDoTwiml,
} from '../_compartilhado/voz-config.ts';

type Autorizacao = { ok: true; para: string; repetido: boolean } | { ok: false; motivo: string };

Deno.serve(async (req: Request): Promise<Response> => {
  const metodo = exigirMetodo(req, ['POST']);
  if (metodo) return metodo;

  const corpoCru = await corpoComTeto(req);
  if (corpoCru === null) return erro(413, 'corpo_grande_demais', 'Pedido grande demais.');

  let token: string;
  let origem: string;
  try {
    [token, origem] = await Promise.all([authToken(), numeroDeOrigem()]);
  } catch (e) {
    return erro(503, 'integracao_nao_configurada', 'A telefonia ainda não está configurada.', e, {
      segredo_faltando: e instanceof SegredoAusente ? e.nome : undefined,
    });
  }

  const parametros = parametrosDoFormulario(corpoCru);
  const conferencia = await verificarDoTwilio({
    authToken: token,
    url: urlDoTwiml(),
    parametros,
    assinaturaRecebida: req.headers.get('x-twilio-signature'),
  });
  if (!conferencia.ok) {
    registrar('erro', { funcao: 'voz-twiml', recusa: conferencia.codigo });
    return new Response('Chamada recusada.', { status: 403 });
  }

  const ligacao = parametros.ligacao ?? '';
  const identidade = (parametros.From ?? '').replace(/^client:/, '');
  const perna = parametros.CallSid ?? '';
  if (!UUID.test(ligacao) || identidade.length === 0 || perna.length === 0) {
    registrar('aviso', {
      funcao: 'voz-twiml',
      recusa: 'pedido_incompleto',
      provider_call_sid: perna,
    });
    return respostaTwiml(twimlDesligar());
  }

  let autorizacao: Autorizacao;
  try {
    autorizacao = await rpcServico<Autorizacao>('voz_twiml_autorizar', {
      p_call_id: ligacao,
      p_identidade: identidade,
      p_parent_sid: perna,
      p_origem: origem,
    });
  } catch (e) {
    registrar('erro', {
      funcao: 'voz-twiml',
      call_id: ligacao,
      provider_call_sid: perna,
      event: 'falha_ao_autorizar',
      interno: e instanceof Error ? e.message : String(e),
    });
    return respostaTwiml(twimlDesligar());
  }

  if (!autorizacao.ok) {
    registrar('aviso', {
      funcao: 'voz-twiml',
      call_id: ligacao,
      provider_call_sid: perna,
      event: 'recusada',
      error_code: autorizacao.motivo,
    });
    return respostaTwiml(twimlDesligar());
  }

  registrar('info', {
    funcao: 'voz-twiml',
    call_id: ligacao,
    provider_call_sid: perna,
    event: 'discando',
  });
  return respostaTwiml(
    twimlDiscar({
      para: autorizacao.para,
      de: origem,
      urlDeEstado: `${urlDeEstado()}?ligacao=${ligacao}`,
    }),
  );
});
