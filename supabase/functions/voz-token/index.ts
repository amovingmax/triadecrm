// =============================================================================
// TRIADE — `voz-token` (R13 §3.4)
//
// Emite a credencial temporária do softphone para quem está logado no CRM.
//
// O QUE O NAVEGADOR RECEBE: um Access Token de uma hora, que só serve para
// fazer chamada de SAÍDA pelo TwiML App do CRM, com a identidade `crm_<id>`.
// O QUE ELE NUNCA RECEBE: Auth Token, segredo da API Key, ou qualquer coisa que
// permita emitir outra credencial.
//
// QUEM É A PESSOA não sai de campo nenhum do pedido: a função repassa o
// Authorization ao Postgres (`voz_pode_ligar`), que confere o JWT, o papel e a
// chave geral da telefonia, e devolve a identidade. A credencial sozinha também
// não disca para ninguém: o número é escolhido pelo banco em `voz-twiml`, para
// uma chamada que `voz_abrir_ligacao` já tenha aberto.
// =============================================================================

import { erro, exigirMetodo, json, preflight, registrar } from '../_compartilhado/http.ts';
import { ErroDeBanco, rpcDoUsuario } from '../_compartilhado/postgrest.ts';
import { SegredoAusente } from '../_compartilhado/segredos.ts';
import { credencialDeVoz, VALIDADE_DA_CREDENCIAL_SEG } from '../_compartilhado/twilio.ts';
import { credenciaisDaApi } from '../_compartilhado/voz-config.ts';

type Permissao = { ok: true; identidade: string } | { ok: false; motivo: string };

const RECUSAS: Record<string, { status: number; mensagem: string }> = {
  sem_permissao: { status: 403, mensagem: 'Seu perfil não faz ligações pelo CRM.' },
  telefonia_desligada: {
    status: 409,
    mensagem: 'A ligação pelo navegador está desligada. Use o telefone e registre o contato.',
  },
};

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  const metodo = exigirMetodo(req, ['POST']);
  if (metodo) return metodo;

  const autorizacao = req.headers.get('authorization');
  if (!autorizacao) {
    return erro(401, 'sem_sessao', 'Sua sessão expirou. Entre de novo para ligar.');
  }

  let permissao: Permissao;
  try {
    permissao = await rpcDoUsuario<Permissao>('voz_pode_ligar', {}, autorizacao);
  } catch (e) {
    if (e instanceof ErroDeBanco && (e.status === 401 || e.status === 403)) {
      return erro(401, 'sem_sessao', 'Sua sessão expirou. Entre de novo para ligar.', e);
    }
    return erro(
      500,
      'falha_ao_conferir',
      'Não consegui preparar o telefone agora. Tente de novo.',
      e,
    );
  }
  if (!permissao.ok) {
    const recusa = RECUSAS[permissao.motivo] ?? RECUSAS.sem_permissao;
    return erro(recusa.status, permissao.motivo, recusa.mensagem);
  }

  try {
    const token = await credencialDeVoz({
      ...(await credenciaisDaApi()),
      identidade: permissao.identidade,
    });
    registrar('info', {
      funcao: 'voz-token',
      evento: 'credencial_emitida',
      identidade: permissao.identidade,
    });
    return json(
      {
        ok: true,
        token,
        identity: permissao.identidade,
        expira_em_seg: VALIDADE_DA_CREDENCIAL_SEG,
      },
      200,
      { 'Cache-Control': 'no-store' },
    );
  } catch (e) {
    if (e instanceof SegredoAusente) {
      return erro(
        503,
        'integracao_nao_configurada',
        'A telefonia ainda não está configurada. Avise quem administra o CRM.',
        e,
        { segredo_faltando: e.nome },
      );
    }
    return erro(
      500,
      'falha_ao_emitir',
      'Não consegui preparar o telefone agora. Tente de novo.',
      e,
    );
  }
});
