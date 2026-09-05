// =============================================================================
// TRIADE — `claim-link`  (RF-PRE-07/08; R06 PRE-06/07/09; LGPD art. 8º §2º)
//
// A página do fornecedor: "este rascunho é seu?". Sem login, sem conta, sem
// atrito — o token de 32 bytes É a credencial, e por isso ele é tratado como
// credencial: nunca entra em log, nunca volta na resposta, nunca vai para a
// URL de redirecionamento.
//
//   GET  ?token=<64 hex>              → mostra o rascunho (T1)
//   POST { acao: "aceitar", ... }     → grava o aceite COM PROVA (T3)
//   POST { acao: "recusar", motivo }  → recusa, suprime e agenda o apagamento
//
// IP e user-agent NÃO são pedidos ao navegador: são lidos da própria conexão.
// Prova que o titular digita não é prova. Na abertura, o IP só vira hash; no
// aceite, ele é guardado inteiro, porque é o ônus da prova do controlador
// (LGPD art. 8º §2º) e está declarado no aviso de privacidade.
//
// Todo o resto — validade, expiração, supressão, whitelist, consent_events —
// é decidido pelas três funções `definer` do Postgres. Aqui não há regra
// nenhuma que o banco não repita.
// =============================================================================

import { erro, exigirMetodo, json, preflight, registrar } from '../_compartilhado/http.ts';
import { rpcAnonimo } from '../_compartilhado/postgrest.ts';

const TOKEN = /^[0-9a-f]{64}$/;

/**
 * O Postgres devolve um `motivo` curto e estável. Quem lê é um fornecedor no
 * celular, no meio do dia: a frase tem de dizer o que fazer agora, não o nome
 * da regra que barrou.
 */
const FRASES: Record<string, string> = {
  token_invalido:
    'Este link não vale mais. Peça um link novo pelo WhatsApp da Komune, ou responda a última mensagem que recebeu.',
  token_expirado:
    'Este link venceu (ele dura 7 dias). Peça um link novo pelo WhatsApp da Komune e a gente reenvia na hora.',
  rascunho_encerrado:
    'Este rascunho já foi encerrado a seu pedido. Se mudou de ideia, é só falar com a gente pelo WhatsApp.',
  prova_incompleta:
    'Faltou algum dado do aceite. Recarregue a página, confira seu nome e tente de novo.',
  motivo_invalido: 'Escolha um dos motivos oferecidos na página.',
};

function comFrase(resultado: Record<string, unknown> | null): Record<string, unknown> {
  const motivo = String(resultado?.motivo ?? 'token_invalido');
  return {
    ok: false,
    codigo: motivo,
    mensagem:
      FRASES[motivo] ?? 'Não consegui concluir agora. Fale com a gente pelo WhatsApp da Komune.',
  };
}

/** O IP de quem chamou, pela borda. `x-forwarded-for` traz a cadeia; o primeiro é o cliente. */
function ipDaConexao(req: Request, info?: Deno.ServeHandlerInfo): string | null {
  const encaminhado = req.headers.get('x-forwarded-for');
  if (encaminhado) {
    const primeiro = encaminhado.split(',')[0]?.trim();
    if (primeiro && primeiro.length > 0) return primeiro;
  }
  const real = req.headers.get('x-real-ip');
  if (real && real.trim().length > 0) return real.trim();
  const remoto = info?.remoteAddr;
  if (remoto && remoto.transport === 'tcp') return remoto.hostname;
  return null;
}

function userAgent(req: Request): string {
  const ua = (req.headers.get('user-agent') ?? '').trim();
  // A tabela exige entre 5 e 400 caracteres: navegador sem user-agent não
  // impede o aceite, mas fica registrado que não veio.
  return ua.length >= 5 ? ua.slice(0, 400) : 'user-agent nao informado';
}

Deno.serve(async (req: Request, info?: Deno.ServeHandlerInfo): Promise<Response> => {
  const cors = preflight(req);
  if (cors) return cors;
  const metodo = exigirMetodo(req, ['GET', 'POST']);
  if (metodo) return metodo;

  const url = new URL(req.url);

  // -------------------------------------------------------------------------
  // GET — abrir o rascunho
  // -------------------------------------------------------------------------
  if (req.method === 'GET') {
    const token = (url.searchParams.get('token') ?? '').trim();
    if (!TOKEN.test(token)) {
      return erro(
        400,
        'token_invalido',
        'Este link não está completo. Abra o link exatamente como recebeu, sem cortar o final.',
      );
    }
    try {
      const resultado = await rpcAnonimo<Record<string, unknown>>('abrir_reivindicacao', {
        p_token: token,
        p_user_agent: userAgent(req),
        p_ip: ipDaConexao(req, info),
      });
      if (resultado?.ok !== true) {
        registrar('aviso', { funcao: 'claim-link', acao: 'abrir', motivo: resultado?.motivo });
        return json(comFrase(resultado), 404);
      }
      // `no-store`: a prévia do rascunho não fica em cache de navegador nem de CDN.
      return json(resultado, 200, { 'Cache-Control': 'no-store' });
    } catch (e) {
      return erro(
        500,
        'falha_ao_abrir',
        'Não consegui abrir seu rascunho agora. Tente de novo em alguns minutos.',
        e,
      );
    }
  }

  // -------------------------------------------------------------------------
  // POST — aceitar ou recusar
  // -------------------------------------------------------------------------
  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
    if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo))
      throw new Error('não é objeto');
  } catch {
    return erro(
      400,
      'json_invalido',
      'Não entendi o que foi enviado. Recarregue a página e tente de novo.',
    );
  }

  const token = String(corpo.token ?? '').trim();
  if (!TOKEN.test(token)) {
    return erro(
      400,
      'token_invalido',
      'Este link não está completo. Abra o link exatamente como recebeu, sem cortar o final.',
    );
  }
  const acao = String(corpo.acao ?? '').trim();

  if (acao === 'recusar') {
    const motivo = String(corpo.motivo ?? 'nao_quero').trim();
    try {
      const resultado = await rpcAnonimo<Record<string, unknown>>('recusar_reivindicacao', {
        p_token: token,
        p_motivo: motivo,
      });
      registrar('info', { funcao: 'claim-link', acao: 'recusar', aceito: resultado?.ok === true });
      if (resultado?.ok !== true) return json(comFrase(resultado), 400);
      return json({
        ...resultado,
        mensagem:
          'Pronto. Apagamos o rascunho e não entramos mais em contato. Obrigado por avisar.',
      });
    } catch (e) {
      return erro(
        500,
        'falha_ao_recusar',
        'Não consegui registrar sua recusa agora. Tente de novo em alguns minutos.',
        e,
      );
    }
  }

  if (acao !== 'aceitar') {
    return erro(400, 'acao_desconhecida', 'Escolha uma ação: "aceitar" ou "recusar".');
  }

  const versaoDoTermo = String(corpo.terms_version ?? '').trim();
  const hashDoTermo = String(corpo.terms_hash ?? '').trim();
  const quemAceitou = String(corpo.quem_aceitou ?? '').trim();
  if (versaoDoTermo.length === 0 || !/^[0-9a-f]{64}$/.test(hashDoTermo)) {
    return erro(
      400,
      'termo_ausente',
      'Faltou identificar a versão do termo aceito. Recarregue a página e tente de novo.',
    );
  }
  if (quemAceitou.length < 2) {
    return erro(400, 'sem_nome', 'Escreva seu nome para confirmar o aceite.');
  }

  const ip = ipDaConexao(req, info);
  if (ip === null) {
    // Sem IP não há prova completa, e prova incompleta não é aceite.
    return erro(
      400,
      'prova_incompleta',
      'Não consegui identificar a origem da sua conexão, e o aceite precisa desse registro. Tente por outra rede ou fale com a gente pelo WhatsApp.',
    );
  }

  try {
    const resultado = await rpcAnonimo<Record<string, unknown>>('aceitar_reivindicacao', {
      p_token: token,
      p_terms_version: versaoDoTermo,
      p_terms_hash: hashDoTermo,
      p_ip: ip,
      p_user_agent: userAgent(req),
      p_who_accepted: quemAceitou,
      p_auth_method: 'claim_link',
      p_marketing_optin: corpo.marketing_optin === true,
      p_photo_import: corpo.photo_import === true,
    });
    registrar('info', {
      funcao: 'claim-link',
      acao: 'aceitar',
      aceito: resultado?.ok === true,
      motivo: resultado?.motivo,
      pre_registration_id: resultado?.pre_registration_id,
    });
    if (resultado?.ok !== true) return json(comFrase(resultado), 400);
    return json({
      ...resultado,
      mensagem:
        'Aceite registrado. Seu perfil na Komune já é seu — o próximo passo chega pelo WhatsApp.',
    });
  } catch (e) {
    return erro(
      500,
      'falha_ao_aceitar',
      'Não consegui registrar seu aceite agora. Tente de novo em alguns minutos.',
      e,
    );
  }
});
