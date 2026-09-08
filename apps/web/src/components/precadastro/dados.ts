/**
 * Idas ao banco do pré-cadastro, todas pelo cliente do navegador.
 *
 * Três RPCs `security definer` fazem o trabalho — `pre_cadastro_do_parceiro`
 * (leitura), `criar_pre_cadastro_da_ficha` (rascunho) e
 * `gerar_link_de_reivindicacao` (link). Aqui ficam a tradução do que volta e a
 * tradução do MOTIVO: as duas RPCs de escrita não levantam exceção, elas
 * devolvem `{ok: false, motivo: '...'}`, e cada motivo tem uma frase que diz o
 * que fazer.
 */
import { createClient } from '@/lib/supabase/client';

import { lerPreCadastro, numero, objeto, texto, type LinkEmitido, type PreCadastro } from './tipos';

export function chaveDoPreCadastro(organizationId: string) {
  return ['precadastro', organizationId] as const;
}

export async function buscarPreCadastro(organizationId: string): Promise<PreCadastro> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('pre_cadastro_do_parceiro', {
    p_organization_id: organizationId,
  });
  if (error) throw new Error(error.message);
  return lerPreCadastro(data);
}

export type RespostaDeCriacao = { ok: true; novo: boolean } | { ok: false; motivo: string };

export async function criarRascunho(organizationId: string): Promise<RespostaDeCriacao> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('criar_pre_cadastro_da_ficha', {
    p_organization_id: organizationId,
  });
  if (error) throw new Error(error.message);

  const r = objeto(data);
  if (r.ok === true) return { ok: true, novo: r.novo === true };
  return { ok: false, motivo: texto(r.motivo) ?? 'desconhecido' };
}

export type RespostaDoLink = { ok: true; link: LinkEmitido } | { ok: false; motivo: string };

/**
 * Emite o link e devolve o endereço para onde o fornecedor vai.
 *
 * Quem decide esse endereço é o BANCO, não esta tela: ele sai de
 * `app_settings[precadastro.link].modelo` (migração 20260908120000). Antes, esta
 * função montava `origem + /c/<token>` por conta própria enquanto a RPC devolvia
 * um domínio fixo que nunca existiu — dois lugares construindo o mesmo link, e
 * nenhum deles sabendo o certo.
 *
 * A decisão de produto de 08/09/2026 é que o fornecedor **não passa por uma
 * página daqui**: o link leva ao cadastro que a Komune já tem. Por isso o
 * `origem` deixou de ser usado; ele continua no parâmetro porque a assinatura é
 * chamada pela tela, e removê-lo é outro commit.
 */
export async function gerarLink(organizationId: string, _origem: string): Promise<RespostaDoLink> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('gerar_link_de_reivindicacao', {
    p_organization_id: organizationId,
  });
  if (error) throw new Error(error.message);

  const r = objeto(data);
  if (r.ok !== true) return { ok: false, motivo: texto(r.motivo) ?? 'desconhecido' };

  const token = texto(r.token);
  if (!token) return { ok: false, motivo: 'token_ausente' };

  // O `url` vem pronto do banco. Se ele não vier, não improvisamos um endereço:
  // link improvisado é link quebrado na mão de um fornecedor, e isso é pior que
  // um botão que se recusa a funcionar e diz por quê.
  const url = texto(r.url);
  if (!url) return { ok: false, motivo: 'endereco_nao_configurado' };

  return {
    ok: true,
    link: {
      url,
      expiraEm: texto(r.expira_em),
      versao: numero(r.versao),
    },
  };
}

// ---------------------------------------------------------------------------
// Tradução de erro e de motivo
// ---------------------------------------------------------------------------

/** O que deu errado ao falar com o servidor, em português e com uma saída. */
export function mensagemDoErro(erro: unknown): string {
  const bruto = erro instanceof Error ? erro.message : '';
  if (/sem permissão|42501|permission/i.test(bruto)) {
    return 'O seu acesso não enxerga o pré-cadastro deste parceiro.';
  }
  if (/jwt|autenticad/i.test(bruto)) return 'A sua sessão expirou.';
  if (/fetch|network|failed/i.test(bruto)) return 'O aplicativo não alcançou o servidor.';
  return 'O servidor não respondeu como esperado.';
}

/** Motivos de `criar_pre_cadastro_da_ficha` e de `criar_pre_cadastro`. */
export const MOTIVO_DA_CRIACAO: Record<string, string> = {
  sem_permissao: 'O seu acesso não cria pré-cadastro. Peça a um gestor.',
  organizacao_inexistente: 'Esta ficha não existe mais. Volte para a lista de parceiros.',
  contato_suprimido:
    'Este contato pediu para não ser procurado. Nenhum pré-cadastro nasce para ele, e essa decisão é dele.',
  ficha_sem_nome: 'A ficha está sem nome. Complete o nome do parceiro antes de criar o rascunho.',
  campo_fora_da_whitelist:
    'O rascunho tentou levar um campo que não é permitido (RF-PRE-03). Avise no grupo do time.',
};

/** Motivos de `gerar_link_de_reivindicacao`. */
export const MOTIVO_DO_LINK: Record<string, string> = {
  sem_permissao: 'O seu acesso não emite link de reivindicação. Peça a um gestor.',
  contato_suprimido:
    'Este contato pediu para não ser procurado. Nenhum link é emitido para ele, em nenhum modo.',
  sem_autorizacao:
    'Não há autorização registrada. Peça a autorização na conversa e registre-a antes de emitir o link.',
  sem_pre_cadastro: 'Crie o rascunho antes de emitir o link.',
  rascunho_encerrado: 'Este rascunho foi recusado ou apagado. Não há link a emitir.',
  ja_reivindicado: 'O fornecedor já reivindicou o perfil. O link não é mais necessário.',
  token_ausente: 'O banco não devolveu o link. Tente de novo; se continuar, avise no grupo do time.',
  endereco_nao_configurado:
    'Ninguém configurou para onde o link leva. Nenhum link foi emitido e o anterior continua valendo — peça a um admin para preencher o endereço do cadastro em Administração.',
};

/** Frase de um motivo, com uma saída genérica para o que não estiver mapeado. */
export function frase(mapa: Record<string, string>, motivo: string): string {
  return mapa[motivo] ?? 'O servidor recusou a operação e não disse por quê. Avise no grupo do time.';
}
