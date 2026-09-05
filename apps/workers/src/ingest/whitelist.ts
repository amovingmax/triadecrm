/**
 * A whitelist de campos, do lado do worker.
 *
 * Ela é LEI (CLAUDE.md, R06 SCR-01/SCR-02) e já é constraint no banco:
 * `raw_capture_payload_na_whitelist` chama `app.payload_e_permitido(payload)` e
 * recusa o INSERT. Esta cópia existe por dois motivos, nenhum deles decorativo:
 *
 *  1. Para que o campo proibido nunca SAIA da máquina do coletor. A página traz
 *     foto, descrição e texto de avaliação; se o worker mandasse tudo e deixasse
 *     o Postgres recusar, o dado proibido teria trafegado, teria aparecido em log
 *     de erro e teria ficado no corpo da requisição. O filtro roda antes.
 *  2. Para que a recusa tenha NOME. O banco devolve `campo_fora_da_whitelist`
 *     para o objeto inteiro; aqui o log diz qual chave foi barrada, e é isso que
 *     permite descobrir que uma fonte mudou de layout.
 *
 * As duas listas abaixo são cópia literal de `app.payload_e_permitido`
 * (supabase/migrations/20260904001600_esteira_de_ingestao.sql, seção 2). Mudar
 * uma sem a outra é bug: o banco passa a recusar o que o worker acha que pode.
 */

/** Campos que a esteira pode guardar. Acrescentar um aqui é decisão de projeto. */
export const CAMPOS_DA_WHITELIST = [
  'nome_comercial',
  'razao_social',
  'cnpj',
  'categoria_origem',
  'cidade',
  'bairro',
  'endereco',
  'cep',
  'telefones',
  'email',
  'site',
  'instagram',
  'place_id',
  'source_url',
  'data_abertura',
  'mei',
  'situacao_cadastral',
  'nota',
  'avaliacoes_qtd',
  'preco_a_partir_de',
  'capacidade_max',
  'fotos_qtd',
] as const;

export type CampoDaWhitelist = (typeof CAMPOS_DA_WHITELIST)[number];

/** Nomes proibidos em qualquer nível: foto, texto de terceiro, avaliação, preço de tabela, PII sensível. */
export const CHAVE_PROIBIDA =
  /(foto|photo|imagem|image|picture|midia|media|logo|banner|thumb|avatar|descri|description|texto|resumo|sobre|bio|review|resenha|coment|depoiment|opiniao|testemunh|preco_tabela|tabela_de_preco|price_list|cpf|pix|conta_banc|conta_corrente|cartao|agencia|banco|bank|iban|rg_|cnh|senha|password|token|secret)/;

const PERMITIDOS = new Set<string>(CAMPOS_DA_WHITELIST);

export type ValorDeCaptura = string | number | boolean | string[];
export type PayloadDeCaptura = Partial<Record<CampoDaWhitelist, ValorDeCaptura>>;

export interface PayloadFiltrado {
  payload: PayloadDeCaptura;
  /** Chaves fora da whitelist que a fonte trouxe e o coletor descartou. */
  descartados: string[];
  /** Subconjunto dos descartados que casa com a lista de nomes proibidos: isso é para alguém ler. */
  proibidos: string[];
}

function valorUtil(valor: unknown): ValorDeCaptura | null {
  if (typeof valor === 'string') {
    const limpo = valor.trim();
    return limpo === '' ? null : limpo;
  }
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'boolean') return valor;
  if (Array.isArray(valor)) {
    const itens = valor
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    return itens.length > 0 ? itens : null;
  }
  return null;
}

/**
 * Deixa passar só o que a whitelist permite. O que não passa é nomeado, não
 * silenciado — o coletor precisa saber que a fonte mudou.
 */
export function filtrarPelaWhitelist(bruto: Record<string, unknown>): PayloadFiltrado {
  const payload: PayloadDeCaptura = {};
  const descartados: string[] = [];
  const proibidos: string[] = [];

  for (const [chave, valor] of Object.entries(bruto)) {
    if (!PERMITIDOS.has(chave)) {
      descartados.push(chave);
      if (CHAVE_PROIBIDA.test(chave.toLowerCase())) proibidos.push(chave);
      continue;
    }
    const util = valorUtil(valor);
    if (util === null) continue;
    payload[chave as CampoDaWhitelist] = util;
  }

  return { payload, descartados, proibidos };
}

/** Um payload só vale a viagem se tiver nome e alguma origem — a constraint do banco exige. */
export function payloadTemIdentidade(payload: PayloadDeCaptura): boolean {
  const nome = payload.nome_comercial ?? payload.razao_social;
  return typeof nome === 'string' && nome.length > 0;
}
