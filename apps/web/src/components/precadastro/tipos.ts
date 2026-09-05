/**
 * O que a tela sabe sobre o pré-cadastro, e como ela lê o que o banco devolve.
 *
 * As três RPCs do módulo devolvem `jsonb`, então do lado do TypeScript tudo chega
 * como `unknown`. As leituras defensivas ficam aqui (mesma gramática de
 * `components/radar/dados.ts`), com teste próprio: nenhum campo do payload é
 * garantido, e uma tela que quebra porque `linha_do_tempo` veio vazia é uma tela
 * que a Heloísa perde no meio da rua.
 */

/** Valores do enum `app.prereg_status`. */
export const SITUACOES_DO_PRECADASTRO = [
  'pending',
  'draft_created',
  'link_sent',
  'in_progress',
  'completed',
  'published',
  'rejected',
  'expired',
] as const;

export type SituacaoDoPreCadastro = (typeof SITUACOES_DO_PRECADASTRO)[number];

/** Rótulos em pt-BR, escritos do ponto de vista de quem opera o CRM. */
export const ROTULO_SITUACAO: Record<SituacaoDoPreCadastro, string> = {
  pending: 'Sem rascunho',
  draft_created: 'Rascunho criado',
  link_sent: 'Link enviado',
  in_progress: 'Cadastro em andamento',
  completed: 'Cadastro completo',
  published: 'Publicado na Komune',
  rejected: 'Recusado pelo fornecedor',
  expired: 'Apagado por prazo',
};

/** Uma linha da linha do tempo (`pre_registration_events`). */
export type EventoDoPreCadastro = {
  evento: string;
  quando: string;
  quem: string;
};

export type PreCadastro = {
  existe: boolean;
  id: string | null;
  situacao: SituacaoDoPreCadastro;
  publicado: boolean;
  /** O `prefilled` do rascunho, já em pares rótulo/valor prontos para a tela. */
  rascunho: { campo: string; valor: string }[];
  origem: string | null;
  fotosPublicas: number | null;
  completude: number | null;
  temAutorizacao: boolean;
  linkAtivo: boolean;
  linkExpiraEm: string | null;
  linkEnviadoEm: string | null;
  linkAbertoEm: string | null;
  reivindicadoEm: string | null;
  recusadoEm: string | null;
  expiraEm: string | null;
  apagadoEm: string | null;
  linhaDoTempo: EventoDoPreCadastro[];
};

/** Link recém-emitido. O token em claro só existe aqui, e só até a próxima recarga. */
export type LinkEmitido = {
  url: string;
  expiraEm: string | null;
  versao: number | null;
};

// ---------------------------------------------------------------------------
// Leituras defensivas
// ---------------------------------------------------------------------------

export function objeto(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

export function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor : null;
}

export function numero(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() && Number.isFinite(Number(valor))) {
    return Number(valor);
  }
  return null;
}

function situacao(valor: unknown): SituacaoDoPreCadastro {
  return typeof valor === 'string' &&
    (SITUACOES_DO_PRECADASTRO as readonly string[]).includes(valor)
    ? (valor as SituacaoDoPreCadastro)
    : 'pending';
}

/**
 * Rótulos dos campos do `prefilled` (whitelist do `app.prefilled_ok`).
 *
 * A lista cobre a whitelist inteira, e não só o que `app.prefill_da_organizacao`
 * monta hoje: o rascunho também pode ser atualizado por outro caminho, e um campo
 * sem rótulo cairia na tela como `area_atendimento`.
 */
const ROTULO_DO_CAMPO: Record<string, string> = {
  nome_exibicao: 'Nome',
  categorias: 'Categorias',
  subnichos: 'Subnichos',
  cidade: 'Cidade',
  bairro: 'Bairro',
  area_atendimento: 'Área de atendimento',
  faixa_preco: 'Faixa de preço',
  instagram: 'Instagram',
  site: 'Site',
  telefone_comercial: 'Telefone comercial',
  descricao_neutra: 'Descrição',
  anos_de_mercado: 'Anos de mercado',
  fotos_publicas_encontradas: 'Fotos públicas encontradas',
};

/** Ordem de leitura do rascunho; o que não estiver aqui vai para o fim, em ordem alfabética. */
const ORDEM_DOS_CAMPOS = Object.keys(ROTULO_DO_CAMPO);

/** Um valor do `prefilled` em texto: string, número, ou lista virando "a, b, c". */
function valorEmTexto(valor: unknown): string | null {
  if (Array.isArray(valor)) {
    const itens = valor.map((v) => valorEmTexto(v)).filter((v): v is string => v !== null);
    return itens.length ? itens.join(', ') : null;
  }
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  if (typeof valor === 'boolean') return valor ? 'sim' : 'não';
  return texto(valor);
}

/** `prefilled` → pares rótulo/valor, na ordem de leitura, sem campo vazio. */
export function lerRascunho(valor: unknown): { campo: string; valor: string }[] {
  const bruto = objeto(valor);
  return Object.entries(bruto)
    .map(([chave, v]) => ({ chave, valor: valorEmTexto(v) }))
    .filter((p): p is { chave: string; valor: string } => p.valor !== null)
    .sort((a, b) => {
      const ia = ORDEM_DOS_CAMPOS.indexOf(a.chave);
      const ib = ORDEM_DOS_CAMPOS.indexOf(b.chave);
      if (ia === ib) return a.chave.localeCompare(b.chave, 'pt-BR');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    })
    .map((p) => ({ campo: ROTULO_DO_CAMPO[p.chave] ?? p.chave, valor: p.valor }));
}

/** Rótulos dos eventos do log (R10 §5.2), só os que o CRM chega a produzir hoje. */
export const ROTULO_EVENTO: Record<string, string> = {
  pre_registration_created: 'Rascunho criado',
  contacted: 'Fornecedor contatado',
  replied: 'Fornecedor respondeu',
  authorization_requested: 'Autorização pedida',
  authorization_granted: 'Autorização registrada',
  authorization_denied: 'Autorização negada',
  claim_link_sent: 'Link de reivindicação emitido',
  claim_link_revoked: 'Link anterior invalidado',
  claim_link_opened: 'Link aberto pelo fornecedor',
  claim_refused: 'Fornecedor recusou o perfil',
  claimed: 'Perfil reivindicado',
  terms_accepted: 'Termos aceitos',
  data_authorization_granted: 'Uso dos dados autorizado',
  expiry_reminder_sent: 'Aviso de expiração enviado',
  pre_registration_purged: 'Dados do rascunho apagados',
  published: 'Perfil publicado na Komune',
  publish_requested: 'Publicação solicitada',
  returned: 'Devolvido pela curadoria',
};

/** Quem fez (coluna `actor`). */
export const ROTULO_ATOR: Record<string, string> = {
  supplier: 'fornecedor',
  cs: 'time',
  system: 'sistema',
  bot: 'robô',
  komune: 'plataforma',
};

function lerLinhaDoTempo(valor: unknown): EventoDoPreCadastro[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .map((linha) => {
      const e = objeto(linha);
      const evento = texto(e.evento);
      const quando = texto(e.quando);
      if (!evento || !quando) return null;
      return { evento, quando, quem: texto(e.quem) ?? 'system' };
    })
    .filter((e): e is EventoDoPreCadastro => e !== null);
}

/** Traduz o retorno de `public.pre_cadastro_do_parceiro`. */
export function lerPreCadastro(valor: unknown): PreCadastro {
  const r = objeto(valor);
  return {
    existe: r.existe === true,
    id: texto(r.id),
    situacao: situacao(r.status),
    publicado: r.publicado === true,
    rascunho: lerRascunho(r.rascunho),
    origem: texto(r.origem),
    fotosPublicas: numero(r.fotos_publicas),
    completude: numero(r.completude),
    temAutorizacao: r.tem_autorizacao === true,
    linkAtivo: r.link_ativo === true,
    linkExpiraEm: texto(r.link_expira_em),
    linkEnviadoEm: texto(r.link_enviado_em),
    linkAbertoEm: texto(r.link_aberto_em),
    reivindicadoEm: texto(r.reivindicado_em),
    recusadoEm: texto(r.recusado_em),
    expiraEm: texto(r.expira_em),
    apagadoEm: texto(r.apagado_em),
    linhaDoTempo: lerLinhaDoTempo(r.linha_do_tempo),
  };
}

/**
 * O rascunho ainda pode receber um link?
 *
 * Espelha as recusas de `public.gerar_link_de_reivindicacao` para que a tela
 * desabilite o botão em vez de deixar a pessoa bater e receber um motivo.
 */
export function podeEmitirLink(p: PreCadastro): boolean {
  return (
    p.existe &&
    p.temAutorizacao &&
    p.recusadoEm === null &&
    p.apagadoEm === null &&
    p.reivindicadoEm === null
  );
}
