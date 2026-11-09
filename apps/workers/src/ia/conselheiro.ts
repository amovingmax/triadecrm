/**
 * O conselheiro de vendas da Imova — o "relatório que vende" (09/11/2026).
 *
 * Uma vez por dia o banco põe na fila `ai_jobs`, com o propósito `aconselhar_vendas`:
 *
 *   - `{ alvo: 'lead', conversation_id }` para cada conversa de cliente com mensagem nova;
 *   - `{ alvo: 'imovel', codigo }` para cada imóvel com pelo menos um cliente interessado.
 *
 * Este trabalho lê a entrada pronta pela porta do banco
 * (`public.ia_conselheiro_lead_entrada` / `public.ia_conselheiro_imovel_entrada`), pede o
 * conselho ao Haiku 5.5 (`conselheiro-do-lead` / `conselheiro-do-imovel`) e o grava pela
 * outra porta (`public.ia_conselheiro_lead_gravar` / `public.ia_conselheiro_imovel_gravar`).
 * É o mesmo meio da IA juíza (`juiza.ts`), e pelos mesmos motivos.
 *
 * ## O que é de quem
 *
 * O banco escolhe os alvos, monta a carteira, recorta as 40 mensagens, tira os telefones
 * e decide o que grava (ADR-03). O worker só converte a forma, pseudonimiza (por
 * `executar`, o único caminho até a API), descarta o código de imóvel que não está na
 * carteira e devolve ao texto o que uma pessoa vai ler — com uma regra a mais que a
 * juíza: **nada de dado pessoal no conselho**. A `situacao` vai para o conselho do imóvel,
 * que junta clientes, e sai sem nome nenhum ("o cliente"); o `falar` leva no máximo o
 * primeiro nome. Telefone e e-mail nunca voltam: o SDR vê o telefone mascarado no CRM, e
 * um conselho com o número inteiro furaria a máscara.
 *
 * ## Erros, pelo critério do resto do worker
 *
 *   SEM O QUE FAZER (sai da fila, sem chamar o modelo): a porta devolveu `{ok: false}` ou
 *     nada, conversa sem mensagem, imóvel sem cliente interessado, empresa que não é a
 *     Imova.
 *   DETERMINÍSTICO (sai da fila, o motivo fica no log): payload torto, entrada fora do
 *     contrato, o modelo recusando o pedido (400/401), o guardrail de dado pessoal, a
 *     gravação recusada, o freio do orçamento (este volta pelo cron dos adiados).
 *   TRANSITÓRIO (volta com backoff): rede, 429, 5xx, e a RPC que não respondeu.
 *
 * ## O que ele nunca faz
 *
 * Não escreve para o cliente, não muda a conversa nem a etapa, e não põe o conselho no
 * log (ele pode ter o primeiro nome do cliente).
 */
import { z } from 'zod';

import {
  ATITUDES_DO_CLIENTE,
  NIVEIS_DE_INTERESSE,
  ORIGENS_DO_SINAL,
  type EntradaDoConselhoDoImovel,
  type EntradaDoConselhoDoLead,
  type ImovelDaCarteira,
  type MapaDePseudonimos,
  conselheiroDoImovelV1,
  conselheiroDoLeadV1,
  encurtarTexto,
} from '@komune/prompts';

import { ErroDaEsteira } from '../fila/esteira';
import { buscarContatoDaFicha, buscarConversa } from './banco';
import { ErroDoModelo } from './cliente';
import { ErroDeterministico } from './erros';
import { type ContextoDaIa, executar, leadIdCurto } from './execucao';

// ---------------------------------------------------------------------------
// O payload da fila
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();

/** O que `app.ia_enfileirar('aconselhar_vendas', …)` põe na fila (mais a `chave`). */
export const payloadDoConselheiro = z.discriminatedUnion('alvo', [
  z.object({
    purpose: z.literal('aconselhar_vendas'),
    alvo: z.literal('lead'),
    conversation_id: uuid,
  }),
  z.object({
    purpose: z.literal('aconselhar_vendas'),
    alvo: z.literal('imovel'),
    codigo: z.string().trim().min(1).max(80),
  }),
]);

export type PayloadDoConselheiro = z.infer<typeof payloadDoConselheiro>;

// ---------------------------------------------------------------------------
// O que as portas de leitura devolvem (tolerante: campo pode vir nulo ou faltar)
// ---------------------------------------------------------------------------

const AGORA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const texto = z.string().nullish();
const numero = z.number().nullish();

const imovelNoBanco = z.object({
  codigo: z.string().nullish(),
  titulo: texto,
  tipo: texto,
  negocio: texto,
  bairro: texto,
  quartos: numero,
  area: numero,
  preco_venda: numero,
  preco_aluguel: numero,
  condominio: numero,
});

const entradaDoLeadNoBanco = z.object({
  agora: z.string().regex(AGORA, 'agora vem como AAAA-MM-DD HH:MM'),
  /**
   * Fora do contrato pedido, e bem-vindos: com eles a pseudonimização conhece o nome e o
   * telefone do cliente e `ai_runs` fica ligada à ficha. Ausentes, o worker os lê da
   * conversa.
   */
  organization_id: uuid.nullish(),
  contact_id: uuid.nullish(),
  conversa: z
    .object({
      quem: texto,
      atitude: texto,
      antes_de_esfriar: texto,
      etapa: texto,
      visita_marcada: texto,
      dono: texto,
    })
    .nullish(),
  ficha: z
    .object({
      resumo: texto,
      intencao: texto,
      score: numero,
      motivo: texto,
      objecoes: z.array(z.string()).nullish(),
      perfil: z.record(z.string(), z.unknown()).nullish(),
      proxima_acao: texto,
    })
    .nullish(),
  sinais: z.array(z.object({ codigo: z.string(), origem: texto })).nullish(),
  carteira: z.array(imovelNoBanco).nullish(),
  compromissos_abertos: z.array(z.object({ quem: texto, o_que: texto, prazo: texto })).nullish(),
  mensagens: z.array(z.object({ de: z.string(), quando: z.string(), texto })).nullish(),
});

export type EntradaDoLeadNoBanco = z.infer<typeof entradaDoLeadNoBanco>;

const entradaDoImovelNoBanco = z.object({
  agora: z.string().regex(AGORA, 'agora vem como AAAA-MM-DD HH:MM'),
  imovel: imovelNoBanco.extend({ iptu: numero, dias_no_ar: numero, descricao: texto }),
  numeros: z
    .object({
      visualizacoes: numero,
      contatos: numero,
      interessados: numero,
      muito: numero,
      visitas: numero,
      propostas: numero,
    })
    .nullish(),
  leads: z
    .array(
      z.object({
        nivel: texto,
        situacao: texto,
        perguntas: z.array(z.string()).nullish(),
        objecoes: z.array(z.string()).nullish(),
        valor_max: numero,
        pagamento: texto,
      }),
    )
    .nullish(),
  perguntas_top: z.array(z.object({ tema: z.string(), leads: numero })).nullish(),
  objecoes_top: z.array(z.object({ objecao: z.string(), leads: numero })).nullish(),
});

export type EntradaDoImovelNoBanco = z.infer<typeof entradaDoImovelNoBanco>;

export interface ResultadoDoConselheiro {
  readonly feito: boolean;
  readonly motivo?: string;
  readonly aiRunId?: number;
  readonly custoUsd?: number;
  readonly detalhes?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Conversões
// ---------------------------------------------------------------------------

function conhecido<T extends string>(
  lista: readonly T[],
  valor: string | null | undefined,
): T | null {
  return valor !== null && valor !== undefined && (lista as readonly string[]).includes(valor)
    ? (valor as T)
    : null;
}

/** Texto aparado e no teto; vazio vira null. */
function corte(valor: string | null | undefined, maximo: number): string | null {
  const limpo = (valor ?? '').trim();
  return limpo === '' ? null : limpo.slice(0, maximo);
}

/** Número finito no intervalo; o resto vira null, em vez de derrubar o conselho. */
function numeroEntre(
  valor: number | null | undefined,
  minimo: number,
  maximo: number,
  inteiro = false,
): number | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < minimo || valor > maximo) {
    return null;
  }
  return inteiro ? Math.round(valor) : valor;
}

/** Contagem que a porta mandou nula ou torta conta como zero. */
function contagem(valor: number | null | undefined): number {
  return numeroEntre(valor, 0, 1_000_000, true) ?? 0;
}

/** O Canal Pro grava `venda_aluguel`; o prompt fala `venda_e_aluguel`. */
function negocio(valor: string | null | undefined): ImovelDaCarteira['negocio'] {
  if (valor === 'venda_aluguel') return 'venda_e_aluguel';
  return conhecido(['venda', 'aluguel', 'venda_e_aluguel'] as const, valor);
}

function imovelDaCarteira(i: z.infer<typeof imovelNoBanco>, codigo: string): ImovelDaCarteira {
  return {
    codigo,
    titulo: corte(i.titulo, 200) ?? corte(i.tipo, 200) ?? 'imóvel',
    tipo: corte(i.tipo, 60),
    negocio: negocio(i.negocio),
    bairro: corte(i.bairro, 80),
    quartos: numeroEntre(i.quartos, 0, 50, true),
    area: numeroEntre(i.area, 0, 10_000_000),
    precoVenda: numeroEntre(i.preco_venda, 0, Number.MAX_SAFE_INTEGER),
    precoAluguel: numeroEntre(i.preco_aluguel, 0, Number.MAX_SAFE_INTEGER),
    condominio: numeroEntre(i.condominio, 0, Number.MAX_SAFE_INTEGER),
  };
}

const QUEM_ESCREVEU: Readonly<Record<string, EntradaDoConselhoDoLead['mensagens'][number]['de']>> =
  {
    cliente: 'cliente',
    // Como a conversa da KOMUNE chama quem está do outro lado, e como `lerCliente` traduz.
    parceiro: 'cliente',
    equipe: 'equipe',
    ia: 'ia',
    automatica: 'automatica',
  };

/** O valor que a leitura anterior registrou, como texto: lista vira "a, b". */
function valorDoPerfil(valor: unknown): string | null {
  if (typeof valor === 'string') return corte(valor, 200);
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (Array.isArray(valor)) {
    const itens = valor.filter(
      (v): v is string | number => typeof v === 'string' || typeof v === 'number',
    );
    return corte(itens.map(String).join(', '), 200);
  }
  return null;
}

/**
 * A entrada do prompt, a partir do que a porta devolveu. O que o prompt não conhece
 * (atitude, origem ou quem escreveu de um tipo novo) é traduzido ou fica de fora, em vez
 * de derrubar o conselho: uma etiqueta nova no banco não pode parar a fila. Os imóveis
 * ligados à pessoa vão primeiro na carteira, para não serem os cortados no teto.
 */
export function montarEntradaDoLead(
  e: EntradaDoLeadNoBanco,
  leadId: string,
): EntradaDoConselhoDoLead {
  const sinais: EntradaDoConselhoDoLead['sinais'] = [];
  const sinaisVistos = new Set<string>();
  for (const s of e.sinais ?? []) {
    const codigo = corte(s.codigo, 80);
    if (codigo === null) continue;
    const origem = conhecido(ORIGENS_DO_SINAL, s.origem) ?? 'outra';
    const chave = `${codigo}:${origem}`;
    if (sinaisVistos.has(chave)) continue;
    sinaisVistos.add(chave);
    sinais.push({ codigo, origem });
  }

  const porCodigo = new Map<string, ImovelDaCarteira>();
  for (const i of e.carteira ?? []) {
    const codigo = corte(i.codigo, 80);
    if (codigo !== null && !porCodigo.has(codigo))
      porCodigo.set(codigo, imovelDaCarteira(i, codigo));
  }
  const ligados = new Set(sinais.map((s) => s.codigo));
  const carteira = [
    ...[...porCodigo.values()].filter((i) => ligados.has(i.codigo)),
    ...[...porCodigo.values()].filter((i) => !ligados.has(i.codigo)),
  ].slice(0, 100);

  const c = e.conversa ?? {};
  const f = e.ficha;
  const ficha: EntradaDoConselhoDoLead['ficha'] =
    f === null || f === undefined
      ? null
      : {
          resumo: corte(f.resumo, 800),
          intencao: corte(f.intencao, 60),
          score: numeroEntre(f.score, 0, 100),
          motivo: corte(f.motivo, 400),
          objecoes: (f.objecoes ?? [])
            .map((o) => corte(o, 60))
            .filter((o): o is string => o !== null)
            .slice(0, 10),
          perfil: Object.entries(f.perfil ?? {})
            .flatMap(([campo, valor]) => {
              const nome = corte(campo, 40);
              const dito = valorDoPerfil(valor);
              return nome === null || dito === null ? [] : [{ campo: nome, valor: dito }];
            })
            .slice(0, 15),
          proximaAcao: corte(f.proxima_acao, 300),
        };

  const compromissosAbertos: EntradaDoConselhoDoLead['compromissosAbertos'] = (
    e.compromissos_abertos ?? []
  )
    .flatMap((k) => {
      const quem =
        k.quem === 'equipe'
          ? 'equipe'
          : k.quem === 'parceiro' || k.quem === 'cliente'
            ? 'parceiro'
            : null;
      const oQue = corte(k.o_que, 300);
      return quem === null || oQue === null
        ? []
        : [{ quem: quem as 'equipe' | 'parceiro', oQue, prazo: corte(k.prazo, 40) }];
    })
    .slice(0, 20);

  // As 40 mais novas, se vier mais: o que a pessoa disse por último pesa mais.
  const mensagens = (e.mensagens ?? [])
    .flatMap((m) => {
      const de = QUEM_ESCREVEU[m.de];
      const quando = corte(m.quando, 40);
      return de === undefined || quando === null
        ? []
        : [{ de, quando, texto: (m.texto ?? '').slice(0, 1200) }];
    })
    .slice(-40);

  return {
    leadId,
    agora: e.agora,
    conversa: {
      quem: corte(c.quem, 40) ?? 'não informado',
      atitude: conhecido(ATITUDES_DO_CLIENTE, c.atitude),
      antesDeEsfriar: conhecido(['muito_interessado', 'interessado'] as const, c.antes_de_esfriar),
      etapa: corte(c.etapa, 80),
      visitaMarcada: corte(c.visita_marcada, 40),
      temDono: corte(c.dono, 200) !== null,
    },
    ficha,
    sinais: sinais.slice(0, 20),
    carteira,
    compromissosAbertos,
    mensagens,
  };
}

/** A entrada do conselho do imóvel. Cliente de nível que o prompt não conhece fica de fora. */
export function montarEntradaDoImovel(
  e: EntradaDoImovelNoBanco,
  codigo: string,
): EntradaDoConselhoDoImovel {
  const i = e.imovel;
  const n = e.numeros ?? {};
  const lista = (itens: readonly string[] | null | undefined, maximo: number, teto: number) =>
    (itens ?? [])
      .map((x) => corte(x, teto))
      .filter((x): x is string => x !== null)
      .slice(0, maximo);
  return {
    agora: e.agora,
    imovel: {
      ...imovelDaCarteira(i, corte(i.codigo, 80) ?? codigo),
      iptu: numeroEntre(i.iptu, 0, Number.MAX_SAFE_INTEGER),
      diasNoAr: numeroEntre(i.dias_no_ar, 0, 36_500, true),
      descricao: corte(i.descricao, 600),
    },
    numeros: {
      visualizacoes: numeroEntre(n.visualizacoes, 0, 1_000_000, true),
      contatos: numeroEntre(n.contatos, 0, 1_000_000, true),
      interessados: contagem(n.interessados),
      muito: contagem(n.muito),
      visitas: contagem(n.visitas),
      propostas: contagem(n.propostas),
    },
    leads: (e.leads ?? [])
      .flatMap((l) => {
        const nivel = conhecido(NIVEIS_DE_INTERESSE, l.nivel);
        return nivel === null
          ? []
          : [
              {
                nivel,
                situacao: corte(l.situacao, 200),
                perguntas: lista(l.perguntas, 8, 60),
                objecoes: lista(l.objecoes, 8, 60),
                valorMax: numeroEntre(l.valor_max, 0, Number.MAX_SAFE_INTEGER),
                pagamento: corte(l.pagamento, 40),
              },
            ];
      })
      .slice(0, 20),
    perguntasTop: (e.perguntas_top ?? [])
      .flatMap((p) => {
        const tema = corte(p.tema, 60);
        return tema === null ? [] : [{ tema, leads: contagem(p.leads) }];
      })
      .slice(0, 10),
    objecoesTop: (e.objecoes_top ?? [])
      .flatMap((o) => {
        const objecao = corte(o.objecao, 60);
        return objecao === null ? [] : [{ objecao, leads: contagem(o.leads) }];
      })
      .slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// O texto que volta: sem dado pessoal, ou só com o primeiro nome
// ---------------------------------------------------------------------------

/** O que fica no lugar de cada marcador quando o dado não pode voltar. */
const NO_LUGAR_DO_DADO: Readonly<Record<string, string>> = {
  NOME: 'o cliente',
  // Na Imova a "empresa" da ficha é o próprio cliente.
  EMPRESA: 'o cliente',
  TELEFONE: 'o telefone',
  EMAIL: 'o e-mail',
  INSTAGRAM: 'o Instagram',
  DOCUMENTO: 'o documento',
};

const MARCADOR = /\[\[([A-Z]+)_\d+\]\]/g;

/**
 * Tira os marcadores do texto que o modelo escreveu. Com `primeiroNome`, o nome do
 * cliente volta só com a primeira palavra ("Janio", nunca "Janio Ramalho"); todo o resto
 * — sobrenome, empresa, telefone, e-mail, @, documento — vira uma expressão neutra. É
 * mais estrito que `reidratar`, de propósito: o conselho fica numa tabela que o relatório
 * mostra a quem tem acesso, e o telefone inteiro só se vê pelo botão que registra.
 */
export function semDadoPessoal(
  texto: string,
  mapa: MapaDePseudonimos,
  primeiroNome: boolean,
): string {
  const trocado = texto.replace(MARCADOR, (marcador: string, tipo: string) => {
    if (primeiroNome && tipo === 'NOME') {
      const original = mapa.porMarcador.get(marcador);
      const primeira = original?.trim().split(/\s+/)[0];
      if (primeira !== undefined && primeira !== '') return primeira;
    }
    return NO_LUGAR_DO_DADO[tipo] ?? 'o cliente';
  });
  // O schema encurta o texto ainda com os marcadores, e o corte pode cair no meio de um
  // ("… ligar para [[NOME_…"): o pedaço sai, e fica só o "…".
  const semPedaco = trocado.replace(/\s*\[\[[A-Z_\d]*\]?…?$/u, '…');
  // "[[NOME_1]] pediu visita" vira "O cliente pediu visita", com a maiúscula do começo.
  return /^\[\[[A-Z]+_\d+\]\]/.test(texto)
    ? semPedaco.charAt(0).toUpperCase() + semPedaco.slice(1)
    : semPedaco;
}

/** Encurta de novo depois da troca: o nome pode ser mais longo que o marcador. */
function caber(texto: string, maximo: number): string {
  return encurtarTexto(maximo)(texto.trim()) as string;
}

function semRepetir(itens: readonly string[]): string[] {
  const vistos = new Set<string>();
  return itens.filter((item) => {
    const chave = item.toLowerCase();
    if (item === '' || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

// ---------------------------------------------------------------------------
// O meio
// ---------------------------------------------------------------------------

async function rpc(
  contexto: ContextoDaIa,
  funcao: string,
  argumentos: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await contexto.cliente.rpc(funcao, argumentos);
  // Erro de RPC é rede ou banco fora do ar: volta para a fila com backoff.
  if (error) throw new ErroDaEsteira(funcao, error.message);
  return data;
}

/**
 * A porta de leitura: a entrada, ou o motivo de não haver o que fazer. `null` e
 * `{ok: false, motivo}` não são erro — são o banco dizendo que hoje não tem conselho
 * (sem mensagem nova, conversa que não é de cliente, imóvel sem interessado).
 */
async function lerPorta(
  contexto: ContextoDaIa,
  funcao: string,
  argumentos: Record<string, unknown>,
): Promise<{ readonly dados: unknown } | { readonly recusa: string }> {
  const data = await rpc(contexto, funcao, argumentos);
  if (data === null || data === undefined) return { recusa: 'sem_entrada' };
  if (typeof data === 'object' && !Array.isArray(data) && (data as { ok?: unknown }).ok === false) {
    const motivo = (data as { motivo?: unknown }).motivo;
    return { recusa: typeof motivo === 'string' && motivo !== '' ? motivo : 'porta_recusou' };
  }
  return { dados: data };
}

function foraDoContrato(funcao: string, erro: z.ZodError): ErroDeterministico {
  const problema = erro.issues[0];
  // O banco respondeu fora do combinado: repetir traz a mesma resposta.
  return new ErroDeterministico(
    `${funcao} fora do contrato — ${problema ? `${problema.path.join('.') || '(raiz)'}: ${problema.message}` : '?'}`,
  );
}

/** 400 e 401 não mudam com o tempo: repetir é pagar a mesma recusa até a dead-letter. */
function recusaDoModelo(erro: unknown): unknown {
  return erro instanceof ErroDoModelo && !erro.transitorio
    ? new ErroDeterministico(`o modelo recusou o conselho: ${erro.message}`)
    : erro;
}

async function gravar(
  contexto: ContextoDaIa,
  funcao: string,
  argumentos: Record<string, unknown>,
  alvo: string,
): Promise<Record<string, unknown>> {
  const gravada = (await rpc(contexto, funcao, argumentos)) as Record<string, unknown> | null;
  if (gravada?.ok !== true) {
    // O alvo sumiu entre a leitura e a gravação: a chamada já foi paga, e repetir não
    // traz o alvo de volta.
    throw new ErroDeterministico(
      `o conselho de ${alvo} não foi gravado: ${String(gravada?.motivo ?? 'sem resposta')}`,
    );
  }
  return gravada;
}

async function aconselharSobreOCliente(
  contexto: ContextoDaIa,
  conversationId: string,
): Promise<ResultadoDoConselheiro> {
  const porta = await lerPorta(contexto, 'ia_conselheiro_lead_entrada', {
    p_conversation_id: conversationId,
  });
  if ('recusa' in porta) return { feito: false, motivo: porta.recusa };
  const lida = entradaDoLeadNoBanco.safeParse(porta.dados);
  if (!lida.success) throw foraDoContrato('ia_conselheiro_lead_entrada', lida.error);
  const e = lida.data;

  // A ficha e o contato: da porta, quando ela os manda; senão, da própria conversa.
  let organizationId = e.organization_id ?? null;
  let contactId = e.contact_id ?? null;
  let telefone: string | null = null;
  if (e.organization_id === undefined && e.contact_id === undefined) {
    const conversa = await buscarConversa(contexto.cliente, conversationId);
    if (conversa === null) return { feito: false, motivo: 'conversa_nao_existe' };
    organizationId = conversa.organizationId;
    contactId = conversa.contactId;
    telefone = conversa.telefone;
  }

  // O lead precisa ser o mesmo em todo conselho desta conversa, como na juíza.
  const leadId = leadIdCurto(organizationId ?? conversationId);
  const entrada = montarEntradaDoLead(e, leadId);
  // Sem conversa não há conselho: pagar por um seria pagar por um palpite.
  if (entrada.mensagens.length === 0) return { feito: false, motivo: 'sem_mensagens' };

  // O nome e o telefone da ficha entram na troca: o cliente escreve o próprio nome, e a
  // ficha e os compromissos o citam.
  const ficha = await buscarContatoDaFicha(contexto.cliente, organizationId, contactId, telefone);

  let executada;
  try {
    executada = await executar(
      contexto,
      conselheiroDoLeadV1,
      entrada,
      {
        leadId,
        nome: ficha.nome,
        empresa: ficha.empresa,
        telefones: ficha.telefones,
        emails: ficha.emails,
        instagram: ficha.instagram,
      },
      { organizationId, contactId, conversationId },
    );
  } catch (erro) {
    throw recusaDoModelo(erro);
  }

  const conselho = executada.saida;
  const mapa = executada.mapa;
  const neutro = (t: string) => semDadoPessoal(t, mapa, false).trim();

  // Código que não está na carteira não vira dado — a mesma regra do Pulso e da ficha.
  // A caixa não importa ("te0002_imova" é o TE0002_IMOVA); o código gravado é o da carteira.
  const daCarteira = new Map(entrada.carteira.map((i) => [i.codigo.toUpperCase(), i.codigo]));
  const vistos = new Set<string>();
  const imoveis = conselho.imoveis.flatMap((i) => {
    const codigo = daCarteira.get(i.codigo.trim().toUpperCase());
    if (codigo === undefined || vistos.has(codigo)) return [];
    vistos.add(codigo);
    return [
      {
        codigo,
        nivel: i.nivel,
        perguntas: semRepetir(i.perguntas.map((p) => caber(neutro(p), 40))),
      },
    ];
  });
  const descartados = conselho.imoveis.length - imoveis.length;

  const saida = {
    imoveis,
    perfil: {
      ...conselho.perfil,
      tipos: [...new Set(conselho.perfil.tipos)],
      bairros: semRepetir(conselho.perfil.bairros.map((b) => caber(neutro(b), 60))),
    },
    situacao: caber(neutro(conselho.situacao), 140),
    falar: caber(semDadoPessoal(conselho.falar, mapa, true), 180),
    dadosInsuficientes: conselho.dadosInsuficientes,
  };

  await gravar(
    contexto,
    'ia_conselheiro_lead_gravar',
    {
      p_conversation_id: conversationId,
      p_saida: saida,
      p_ai_run_id: executada.aiRunId,
      p_prompt_version: executada.promptVersion,
    },
    `conversa ${conversationId}`,
  );

  const detalhes = {
    alvo: 'lead',
    imoveis: imoveis.length,
    descartados,
    niveis: imoveis.map((i) => i.nivel),
    dados_insuficientes: saida.dadosInsuficientes,
  };
  if (descartados > 0) {
    contexto.logger.warn('o conselheiro citou imóvel fora da carteira: descartado', {
      conversation_id: conversationId,
      descartados,
    });
  }
  // Sem a situação e o falar: o falar pode ter o primeiro nome do cliente.
  contexto.logger.info('o conselheiro aconselhou sobre o cliente', {
    conversation_id: conversationId,
    mensagens: entrada.mensagens.length,
    carteira: entrada.carteira.length,
    ...detalhes,
    custo_usd: executada.custoUsd,
  });
  return { feito: true, aiRunId: executada.aiRunId, custoUsd: executada.custoUsd, detalhes };
}

async function aconselharSobreOImovel(
  contexto: ContextoDaIa,
  codigo: string,
): Promise<ResultadoDoConselheiro> {
  const porta = await lerPorta(contexto, 'ia_conselheiro_imovel_entrada', { p_codigo: codigo });
  if ('recusa' in porta) return { feito: false, motivo: porta.recusa };
  const lida = entradaDoImovelNoBanco.safeParse(porta.dados);
  if (!lida.success) throw foraDoContrato('ia_conselheiro_imovel_entrada', lida.error);

  const entrada = montarEntradaDoImovel(lida.data, codigo);
  // O trabalho é de imóvel com cliente interessado: sem nenhum, não há o que sustentar.
  if (entrada.leads.length === 0) return { feito: false, motivo: 'sem_leads' };

  let executada;
  try {
    executada = await executar(
      contexto,
      conselheiroDoImovelV1,
      entrada,
      // O conselho do imóvel não é de uma pessoa: não há nome nem telefone conhecidos. A
      // pseudonimização ainda troca o telefone que a descrição do anúncio trouxer.
      { leadId: 'imovel', nome: null, empresa: null },
      {},
    );
  } catch (erro) {
    throw recusaDoModelo(erro);
  }

  const mapa = executada.mapa;
  const sugestoes = executada.saida.sugestoes
    .map((s) => ({
      tipo: s.tipo,
      acao: caber(semDadoPessoal(s.acao, mapa, false), 90),
      porque: caber(semDadoPessoal(s.porque, mapa, false), 160),
    }))
    .filter((s) => s.acao !== '');
  const saida = { sugestoes, dadosInsuficientes: executada.saida.dadosInsuficientes };

  await gravar(
    contexto,
    'ia_conselheiro_imovel_gravar',
    {
      p_codigo: codigo,
      p_saida: saida,
      p_ai_run_id: executada.aiRunId,
      p_prompt_version: executada.promptVersion,
    },
    `imóvel ${codigo}`,
  );

  const detalhes = {
    alvo: 'imovel',
    sugestoes: sugestoes.length,
    leads: entrada.leads.length,
    dados_insuficientes: saida.dadosInsuficientes,
  };
  contexto.logger.info('o conselheiro aconselhou sobre o imóvel', {
    codigo,
    ...detalhes,
    custo_usd: executada.custoUsd,
  });
  return { feito: true, aiRunId: executada.aiRunId, custoUsd: executada.custoUsd, detalhes };
}

export async function aconselharVendas(
  contexto: ContextoDaIa,
  bruto: unknown,
): Promise<ResultadoDoConselheiro> {
  const lido = payloadDoConselheiro.safeParse(bruto);
  if (!lido.success) {
    const problemas = lido.error.issues
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('; ');
    throw new ErroDeterministico(`payload do conselheiro fora do contrato — ${problemas}`);
  }
  // O prompt é de imobiliária e as portas só existem no banco da Imova.
  if (contexto.empresa !== 'imova') return { feito: false, motivo: 'so_na_imova' };
  const payload = lido.data;
  return payload.alvo === 'lead'
    ? aconselharSobreOCliente(contexto, payload.conversation_id)
    : aconselharSobreOImovel(contexto, payload.codigo);
}
