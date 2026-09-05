// =============================================================================
// TRIADE — `export-lgpd`  (LGPD art. 9º e art. 18, I/II; R06 §61 e ACC-03)
//
// "De onde vocês pegaram meu número?" tem uma resposta certa, e é a URL exata,
// campo a campo. A KASPR foi multada por responder "de fontes públicas". Aqui
// o dossiê traz a proveniência de cada dado, o que já foi compartilhado com
// quem, por quanto tempo guardamos e como o titular sai.
//
// Duas portas, dois modos de provar quem é:
//   1. ?token=<64 hex>            → o próprio titular, com o link de
//      reivindicação. Sem login, sem conta.
//   2. Authorization: Bearer JWT  → gente de dentro (gestor, admin ou o
//      encarregado). Exige `?organizacao=<uuid>` e `?motivo=`, e fica em
//      `pii_access_log`.
//
// A permissão NÃO é decidida aqui. As duas RPCs são `security definer` e
// checam papel, carteira e validade do token no Postgres. Esta função escolhe
// a porta e formata a resposta.
// =============================================================================

import { erro, exigirMetodo, json, preflight, registrar } from '../_compartilhado/http.ts';
import { rpcAnonimo, rpcDoUsuario } from '../_compartilhado/postgrest.ts';

const TOKEN = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nomeDoArquivo(dossie: Record<string, unknown>): string {
  const org = (dossie.organizacao ?? {}) as Record<string, unknown>;
  const bruto = String(org.nome ?? 'dados')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  const dia = new Date().toISOString().slice(0, 10);
  return `komune-seus-dados-${bruto || 'dados'}-${dia}.json`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = preflight(req);
  if (cors) return cors;
  const metodo = exigirMetodo(req, ['GET']);
  if (metodo) return metodo;

  const url = new URL(req.url);
  const token = (url.searchParams.get('token') ?? '').trim();
  const organizacao = (url.searchParams.get('organizacao') ?? '').trim();

  // -------------------------------------------------------------------------
  // Porta 1 — o titular, com o token
  // -------------------------------------------------------------------------
  if (token.length > 0) {
    if (!TOKEN.test(token)) {
      return erro(
        400,
        'token_invalido',
        'Este link não está completo. Abra o link exatamente como recebeu, sem cortar o final.',
      );
    }
    try {
      const dossie = await rpcAnonimo<Record<string, unknown>>('exportar_lgpd_por_token', {
        p_token: token,
      });
      if (dossie?.ok !== true) {
        registrar('aviso', { funcao: 'export-lgpd', porta: 'token', motivo: dossie?.motivo });
        return json(
          {
            ok: false,
            codigo: String(dossie?.motivo ?? 'token_invalido'),
            mensagem:
              'Este link não vale mais. Peça um link novo pelo WhatsApp, ou escreva para privacidade@komune.app.br.',
          },
          404,
        );
      }
      registrar('info', { funcao: 'export-lgpd', porta: 'token', resultado: 'entregue' });
      return json(dossie, 200, {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${nomeDoArquivo(dossie)}"`,
      });
    } catch (e) {
      return erro(
        500,
        'falha_ao_exportar',
        'Não consegui montar seus dados agora. Tente de novo em alguns minutos.',
        e,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Porta 2 — gente de dentro, com JWT
  // -------------------------------------------------------------------------
  const autorizacao = req.headers.get('authorization') ?? '';
  if (!autorizacao.toLowerCase().startsWith('bearer ')) {
    return erro(
      401,
      'sem_credencial',
      'Informe o link do titular (?token=) ou entre no Triade antes de exportar.',
    );
  }
  if (!UUID.test(organizacao)) {
    return erro(
      400,
      'organizacao_ausente',
      'Diga qual parceiro exportar: ?organizacao=<id do parceiro>.',
    );
  }
  const motivo = (url.searchParams.get('motivo') ?? '').trim();
  if (motivo.length < 3) {
    return erro(
      400,
      'motivo_ausente',
      'Toda exportação fica registrada com o porquê. Informe ?motivo= (ex.: "pedido do titular por e-mail em 05/09").',
    );
  }

  try {
    const dossie = await rpcDoUsuario<Record<string, unknown>>(
      'exportar_lgpd',
      { p_organization_id: organizacao, p_motivo: motivo },
      autorizacao,
    );
    if (dossie?.ok !== true) {
      const codigo = String(dossie?.motivo ?? 'sem_permissao');
      const mensagem =
        codigo === 'sem_permissao'
          ? 'Seu papel não permite exportar dados de titular. Peça a um gestor ou ao encarregado.'
          : 'Não encontrei esse parceiro. Confira o id e tente de novo.';
      registrar('aviso', { funcao: 'export-lgpd', porta: 'interna', motivo: codigo });
      return json({ ok: false, codigo, mensagem }, codigo === 'sem_permissao' ? 403 : 404);
    }
    registrar('info', {
      funcao: 'export-lgpd',
      porta: 'interna',
      organizacao,
      resultado: 'entregue',
    });
    return json(dossie, 200, {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${nomeDoArquivo(dossie)}"`,
    });
  } catch (e) {
    return erro(
      500,
      'falha_ao_exportar',
      'Não consegui montar o dossiê agora. Tente de novo em alguns minutos.',
      e,
      {
        organizacao,
      },
    );
  }
});
