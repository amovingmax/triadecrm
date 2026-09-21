/**
 * OS MODELOS DE MENSAGEM NA META (RF-CON-06; ADR-06; R04 §2.1).
 *
 * Fora da janela de 24 h a Meta só aceita modelo APROVADO por ela. O CRM tem os
 * modelos (`message_templates`); a Meta precisa tê-los também, com o mesmo
 * texto, e dizer se aprovou. Este arquivo é a ponte entre os dois: manda o que
 * falta para aprovação e traz de volta o status do que já foi.
 *
 * QUEM DECIDE O QUÊ
 * ---------------------------------------------------------------------------
 *   · O BANCO decide QUAIS modelos vão, com que nome (`código + versão`), em que
 *     categoria e com que corpo (`public.wa_modelos_para_meta`), e traduz o
 *     status cru da Meta em três estados (`public.wa_modelo_meta_registrar`).
 *   · A META decide se aprova.
 *   · ESTE ARQUIVO só recusa antes de mandar o que a Meta recusaria de certeza
 *     (variável no começo ou no fim, variáveis coladas, nome fora do formato) —
 *     porque cada recusa dela é uma volta a mais de revisão para a Bárbara — e
 *     escolhe os EXEMPLOS das variáveis, que a Meta lê na revisão.
 *
 * IDEMPOTENTE. Rodar duas vezes seguidas não cria nada duas vezes: a primeira
 * coisa é listar o que a Meta já tem; o que já existe (mesmo nome e idioma) só
 * tem o status registrado. Se a lista escapar de algo e a Meta responder "já
 * existe", o modelo é buscado pelo nome e registrado do mesmo jeito.
 *
 * ERRO DO ITEM × ERRO DO MUNDO. Uma recusa de criação (corpo inválido,
 * categoria errada) é do ITEM: registra o motivo e segue para o próximo. Token
 * vencido, rede fora, limite de chamadas, permissão: é do MUNDO, e continuar
 * seria gravar como "recusado" um modelo que ninguém chegou a olhar. Aí a
 * sincronização PARA e devolve o erro, sem registrar nada errado.
 */
import { ErroDaPonte, modelosParaMeta, registrarModeloNaMeta } from './ponte';

import type { ClienteDaGraph, FalhaDaGraph } from './graph';
import type { ClienteDoBanco, ModeloParaMeta } from './ponte';
import type { Logger } from '../lib/log';

// ---------------------------------------------------------------------------
// Exemplos das variáveis
// ---------------------------------------------------------------------------

/**
 * O exemplo que vai no pedido de aprovação, por nome de variável. A Meta
 * REVISA o exemplo junto com o texto: "Oi, exemplo, tudo bem?" tem mais cara
 * de spam que "Oi, Mariana, tudo bem?". Realista, de Natal, e sem dado de
 * pessoa de verdade.
 */
export const EXEMPLOS_POR_VARIAVEL: Readonly<Record<string, string>> = {
  nome: 'Mariana',
  // Quem manda: o CRM preenche com o primeiro nome de quem clicou (migração 20260914100000).
  atendente: 'Rafael',
  empresa: 'Buffet Sabor Potiguar',
  origem: 'Instagram',
  detalhe: 'casamento na praia de Pipa',
  categoria: 'fotografia',
  estilo: 'natural e documental',
  tipo_evento: 'casamento',
  data: '20/10',
  dia: 'terça-feira',
  hora: '15h',
  formato: 'Google Meet',
  hora_hoje: '15h',
  hora_amanha: '15h',
  hora_manha: '15h',
  hora_tarde: '15h',
  local: 'Av. Engenheiro Roberto Freire, 1000',
  endereco: 'Av. Engenheiro Roberto Freire, 1000',
  link: 'https://admin.komune.app.br/seja-parceiro',
  link_app: 'https://admin.komune.app.br/seja-parceiro',
  link_perfil: 'https://admin.komune.app.br/seja-parceiro',
  mes: 'outubro',
  n: '3',
  cliente: 'Joana',
  gancho: 'a feira de noivas de sábado',
  etapa_travada: 'fotos do portfólio',
  campo: 'fotos e preços',
  campos_preenchidos: 'fotos e preços',
  instrucao: 'entrar pelo link e confirmar os dados',
  fundador_autorizado: 'Buffet Sabor Potiguar',
};

export const EXEMPLO_PADRAO = 'exemplo';

export function exemploDaVariavel(nome: string): string {
  return Object.prototype.hasOwnProperty.call(EXEMPLOS_POR_VARIAVEL, nome)
    ? (EXEMPLOS_POR_VARIAVEL[nome] ?? EXEMPLO_PADRAO)
    : EXEMPLO_PADRAO;
}

// ---------------------------------------------------------------------------
// Variáveis e validação local
// ---------------------------------------------------------------------------

/** Qualquer coisa entre chaves duplas — válida ou não. */
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

/** Nome de variável nomeada: o mesmo formato de `app.modelo_variaveis`. */
const NOME_DE_VARIAVEL = /^[a-z][a-z0-9_]*$/;

/**
 * As variáveis nomeadas de um corpo, na ordem da primeira aparição e sem
 * repetir — a mesma regra de `app.modelo_variaveis` no banco.
 */
export function variaveisDoCorpo(corpo: string): string[] {
  const vistas: string[] = [];
  for (const m of corpo.matchAll(PLACEHOLDER)) {
    const nome = (m[1] ?? '').trim();
    if (NOME_DE_VARIAVEL.test(nome) && !vistas.includes(nome)) vistas.push(nome);
  }
  return vistas;
}

export type Validacao = { ok: true } | { ok: false; motivo: string };

export const CATEGORIAS_ACEITAS = ['MARKETING', 'UTILITY'] as const;
const NOME_DE_MODELO = /^[a-z0-9_]{1,512}$/;
const TAMANHO_MAXIMO_DO_CORPO = 1024;

/** Espaço ou pontuação — mas nunca a chave de uma variável. */
function ehBorda(caractere: string): boolean {
  return caractere !== '{' && caractere !== '}' && /[\s\p{P}]/u.test(caractere);
}

function semBordas(corpo: string): string {
  const letras = [...corpo];
  let inicio = 0;
  let fim = letras.length;
  while (inicio < fim && ehBorda(letras[inicio] ?? '')) inicio += 1;
  while (fim > inicio && ehBorda(letras[fim - 1] ?? '')) fim -= 1;
  return letras.slice(inicio, fim).join('');
}

/**
 * O que a Meta recusaria de certeza, dito antes de gastar um pedido. Devolve o
 * motivo em pt-BR, que é o que vai para `meta_rejection_reason` e para a tela.
 */
export function validarModelo(
  item: Pick<ModeloParaMeta, 'nome_sugerido' | 'corpo' | 'categoria' | 'idioma'>,
): Validacao {
  if (!NOME_DE_MODELO.test(item.nome_sugerido)) {
    return {
      ok: false,
      motivo: `Nome "${item.nome_sugerido}" fora do formato da Meta: só letras minúsculas, números e _ (até 512).`,
    };
  }
  if (!(CATEGORIAS_ACEITAS as readonly string[]).includes(item.categoria)) {
    return {
      ok: false,
      motivo: `Categoria "${item.categoria}" não vai para aprovação: só MARKETING ou UTILITY.`,
    };
  }
  if (item.idioma.trim() === '') {
    return { ok: false, motivo: 'Modelo sem idioma: a Meta exige um (ex.: pt_BR).' };
  }

  const corpo = item.corpo.trim();
  if (corpo === '') return { ok: false, motivo: 'Corpo vazio: não há o que aprovar.' };
  const tamanho = [...corpo].length;
  if (tamanho > TAMANHO_MAXIMO_DO_CORPO) {
    return {
      ok: false,
      motivo: `Corpo com ${tamanho} caracteres: a Meta aceita até ${TAMANHO_MAXIMO_DO_CORPO}.`,
    };
  }

  for (const m of corpo.matchAll(PLACEHOLDER)) {
    const nome = (m[1] ?? '').trim();
    if (!NOME_DE_VARIAVEL.test(nome)) {
      return {
        ok: false,
        motivo: `Variável {{${m[1] ?? ''}}} fora do formato nomeado: use letras minúsculas e _ (ex.: {{nome}}).`,
      };
    }
  }

  const miolo = semBordas(corpo);
  if (miolo.startsWith('{{')) {
    return {
      ok: false,
      motivo:
        'O corpo começa com uma variável: a Meta recusa. Ponha texto antes dela (ex.: "Oi, {{nome}}").',
    };
  }
  if (miolo.endsWith('}}')) {
    return {
      ok: false,
      motivo:
        'O corpo termina com uma variável: a Meta recusa. Ponha texto depois dela (ex.: "… {{detalhe}}, tudo bem?").',
    };
  }
  if (/\}\}\s*\{\{/.test(corpo)) {
    return {
      ok: false,
      motivo: 'Há duas variáveis coladas: a Meta recusa. Ponha texto entre elas.',
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// O pedido de criação
// ---------------------------------------------------------------------------

/** Um botão no pedido de aprovação, no formato da Graph API. */
export type BotaoDoPedido =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string; example: string[] };

export interface PedidoDeModelo {
  name: string;
  language: string;
  category: string;
  parameter_format: 'NAMED';
  components: (
    | {
        type: 'BODY';
        text: string;
        example?: { body_text_named_params: { param_name: string; example: string }[] };
      }
    | { type: 'BUTTONS'; buttons: BotaoDoPedido[] }
  )[];
}

/** Um código de exemplo para a URL do botão: a Meta revisa o link completo. */
export const EXEMPLO_DE_CODIGO = 'a1b2c3d4e5f6';

/**
 * O corpo do POST `/{WABA_ID}/message_templates`, com parâmetros nomeados.
 *
 * O botão de link aponta sempre para o NOSSO endereço rastreado — `link_base`
 * + `{{1}}` —, e o `{{1}}` é o código do item do envio (migração
 * 20260921110000). O destino final é escolhido no envio, não no modelo: assim
 * o mesmo modelo aprovado leva a lugares diferentes sem voltar à Meta.
 */
export function montarPedidoDeModelo(
  item: Pick<ModeloParaMeta, 'nome_sugerido' | 'idioma' | 'categoria' | 'corpo'> &
    Partial<Pick<ModeloParaMeta, 'botoes' | 'link_base'>>,
): PedidoDeModelo {
  // `{{ nome }}` e `{{nome}}` são a mesma variável; a Meta só aceita a segunda.
  const corpo = item.corpo.trim().replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, '{{$1}}');
  const variaveis = variaveisDoCorpo(corpo);
  const componentes: PedidoDeModelo['components'] = [
    {
      type: 'BODY',
      text: corpo,
      ...(variaveis.length === 0
        ? {}
        : {
            example: {
              body_text_named_params: variaveis.map((v) => ({
                param_name: v,
                example: exemploDaVariavel(v),
              })),
            },
          }),
    },
  ];
  const botoes: BotaoDoPedido[] = (item.botoes ?? []).flatMap((b): BotaoDoPedido[] => {
    if (b.tipo === 'resposta') return [{ type: 'QUICK_REPLY', text: b.texto }];
    if (!item.link_base) return [];
    return [
      {
        type: 'URL',
        text: b.texto,
        url: `${item.link_base}{{1}}`,
        example: [`${item.link_base}${EXEMPLO_DE_CODIGO}`],
      },
    ];
  });
  if (botoes.length > 0) componentes.push({ type: 'BUTTONS', buttons: botoes });
  return {
    name: item.nome_sugerido,
    language: item.idioma,
    category: item.categoria,
    parameter_format: 'NAMED',
    components: componentes,
  };
}

// ---------------------------------------------------------------------------
// O que a Meta já tem
// ---------------------------------------------------------------------------

export interface ModeloDaMeta {
  id: string | null;
  name: string;
  language: string;
  status: string;
  category: string | null;
  rejected_reason: string | null;
}

const CAMPOS_DO_MODELO = 'id,name,status,category,language,rejected_reason';
/** Teto de páginas: 250 modelos é o limite padrão da WABA; 50 páginas de 100 é folga. */
const MAXIMO_DE_PAGINAS = 50;

function textoOuNulo(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function paraModeloDaMeta(bruto: unknown): ModeloDaMeta | null {
  if (typeof bruto !== 'object' || bruto === null) return null;
  const m = bruto as Record<string, unknown>;
  const name = textoOuNulo(m.name);
  const language = textoOuNulo(m.language);
  if (name === null || language === null) return null;
  return {
    id: textoOuNulo(m.id),
    name,
    language,
    status: (textoOuNulo(m.status) ?? 'PENDING').toUpperCase(),
    category: textoOuNulo(m.category),
    rejected_reason: textoOuNulo(m.rejected_reason),
  };
}

export type ListaDaMeta =
  { ok: true; modelos: ModeloDaMeta[] } | { ok: false; falha: FalhaDaGraph };

/**
 * Todos os modelos da conta. Pagina pelo cursor `after` — a URL de `paging.next`
 * não é seguida como veio: ela aponta para outro host possível e pode trazer o
 * token na query, e URL é o que aparece em log.
 */
export async function listarModelosDaMeta(
  graph: ClienteDaGraph,
  wabaId: string,
  filtro: { nome?: string } = {},
): Promise<ListaDaMeta> {
  const modelos: ModeloDaMeta[] = [];
  const cursoresVistos = new Set<string>();
  let depois: string | null = null;

  for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS; pagina += 1) {
    const consulta: Record<string, string | number> = { fields: CAMPOS_DO_MODELO, limit: 100 };
    if (filtro.nome) consulta.name = filtro.nome;
    if (depois !== null) consulta.after = depois;

    const r = await graph.ler(`${wabaId}/message_templates`, consulta);
    if (!r.ok) return { ok: false, falha: r };

    const dados = Array.isArray(r.json.data) ? r.json.data : [];
    for (const bruto of dados) {
      const m = paraModeloDaMeta(bruto);
      if (m !== null) modelos.push(m);
    }

    const paging =
      typeof r.json.paging === 'object' && r.json.paging !== null
        ? (r.json.paging as { next?: unknown; cursors?: { after?: unknown } })
        : {};
    const proximo = textoOuNulo(paging.cursors?.after);
    if (typeof paging.next !== 'string' || proximo === null || cursoresVistos.has(proximo)) break;
    cursoresVistos.add(proximo);
    depois = proximo;
  }
  return { ok: true, modelos };
}

/** Um modelo pelo nome EXATO e idioma. O filtro `name` da Meta casa por trecho. */
export async function buscarModeloPorNome(
  graph: ClienteDaGraph,
  wabaId: string,
  nome: string,
  idioma: string,
): Promise<{ ok: true; modelo: ModeloDaMeta | null } | { ok: false; falha: FalhaDaGraph }> {
  const lista = await listarModelosDaMeta(graph, wabaId, { nome });
  if (!lista.ok) return lista;
  return {
    ok: true,
    modelo: lista.modelos.find((m) => m.name === nome && m.language === idioma) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Erro do item × erro do mundo
// ---------------------------------------------------------------------------

/** `error_subcode` da Meta para "já existe conteúdo neste idioma com este nome". */
export const SUBCODIGO_MODELO_JA_EXISTE = 2388024;

export function modeloJaExiste(falha: FalhaDaGraph): boolean {
  return falha.subcodigo === SUBCODIGO_MODELO_JA_EXISTE || /already exists/i.test(falha.mensagem);
}

/**
 * O erro não é do modelo, é do mundo: parar tudo. Transitório (`retentar`:
 * rede, 5xx, limite de chamadas, token 190 — ver `graph.ts`), autorização
 * (401/403), permissão da Graph API (10, 200–299) e conta bloqueada (368). Nenhum desses diz nada
 * sobre o texto do modelo, e registrá-lo como recusa seria mentir na tela.
 */
export function ehErroDoMundo(falha: FalhaDaGraph): boolean {
  if (falha.httpStatus === null || falha.retentar) return true;
  if (falha.httpStatus === 401 || falha.httpStatus === 403) return true;
  if (falha.codigo === 'token_meta_invalido') return true;
  const codigo = Number(falha.codigo);
  // 368: conta bloqueada temporariamente por violação de política.
  return codigo === 10 || codigo === 368 || (codigo >= 200 && codigo <= 299);
}

// ---------------------------------------------------------------------------
// A sincronização
// ---------------------------------------------------------------------------

export interface ResumoDosModelos {
  /** Pedidos de criação que a Meta aceitou nesta passada. */
  enviados: number;
  /** Status na Meta ao fim da passada, na mesma leitura do banco. */
  aprovados: number;
  pendentes: number;
  recusados: number;
  /** Não viraram modelo na Meta: recusa local ou recusa do pedido pela Meta. */
  falhas: number;
}

export type ResultadoDaSincronizacao =
  | { ok: true; resumo: ResumoDosModelos; interrompida: boolean }
  | { ok: false; erro: string; resumo: ResumoDosModelos };

export interface ContextoDosModelos {
  cliente: ClienteDoBanco;
  graph: ClienteDaGraph;
  wabaId: string;
  logger: Logger;
  /** Intervalo entre pedidos de criação, para não estourar o limite (padrão 1 s). */
  intervaloEntrePedidosMs?: number;
  /** Substituível no teste. */
  dormir?: (ms: number) => Promise<void>;
  /** Consultado entre um modelo e outro: o worker está parando? */
  deveParar?: () => boolean;
}

/** O status cru que o banco grava quando o pedido não virou modelo na Meta. */
export const NAO_ENVIADO = 'NAO_ENVIADO';

export function resumoZerado(): ResumoDosModelos {
  return { enviados: 0, aprovados: 0, pendentes: 0, recusados: 0, falhas: 0 };
}

/** A mesma leitura em três estados de `public.wa_modelo_meta_registrar`. */
function contarStatus(resumo: ResumoDosModelos, statusCru: string): void {
  const s = statusCru.toUpperCase();
  if (s === 'APPROVED') resumo.aprovados += 1;
  else if (s === 'PENDING' || s === 'IN_APPEAL' || s === 'LIMIT_EXCEEDED') resumo.pendentes += 1;
  else resumo.recusados += 1;
}

const dormirPadrao = (ms: number): Promise<void> =>
  new Promise((resolva) => {
    setTimeout(resolva, ms);
  });

function descreverFalha(falha: FalhaDaGraph): string {
  return `${falha.codigo}${falha.subcodigo ? `/${falha.subcodigo}` : ''}: ${falha.mensagem}`;
}

/** Lê o banco, lista a Meta uma vez, manda o que falta e registra tudo. */
export async function sincronizarModelos(
  ctx: ContextoDosModelos,
): Promise<ResultadoDaSincronizacao> {
  const resumo = resumoZerado();
  const dormir = ctx.dormir ?? dormirPadrao;
  const intervalo = ctx.intervaloEntrePedidosMs ?? 1_000;

  let itens: ModeloParaMeta[];
  try {
    itens = await modelosParaMeta(ctx.cliente);
  } catch (erro) {
    return { ok: false, erro: `banco: ${mensagemDe(erro)}`, resumo };
  }

  const lista = await listarModelosDaMeta(ctx.graph, ctx.wabaId);
  if (!lista.ok) {
    return { ok: false, erro: `listar modelos na Meta: ${descreverFalha(lista.falha)}`, resumo };
  }
  const naMeta = new Map(lista.modelos.map((m) => [`${m.name}|${m.language}`, m]));

  const registrar = async (
    item: ModeloParaMeta,
    situacao: string,
    motivo: string | null,
    idMeta: string | null,
  ): Promise<void> => {
    const r = await registrarModeloNaMeta(ctx.cliente, {
      templateId: item.template_id,
      nomeMeta: item.nome_sugerido,
      situacaoMeta: situacao,
      motivo,
      idMeta,
    });
    if (!r.ok) {
      ctx.logger.warn('o banco não registrou o status do modelo', {
        template_id: item.template_id,
        motivo: r.motivo,
      });
    }
  };

  let pedidos = 0;
  try {
    for (const item of itens) {
      if (ctx.deveParar?.()) {
        ctx.logger.info('sincronização de modelos interrompida pela parada do worker', {
          ...resumo,
        });
        return { ok: true, resumo, interrompida: true };
      }

      // 1 · Já existe na Meta (mesmo nome e idioma): só o status.
      const existente = naMeta.get(`${item.nome_sugerido}|${item.idioma}`);
      if (existente) {
        await registrar(item, existente.status, existente.rejected_reason, existente.id);
        contarStatus(resumo, existente.status);
        ctx.logger.debug('status do modelo sincronizado', {
          template_id: item.template_id,
          nome: item.nome_sugerido,
          status: existente.status,
        });
        continue;
      }

      // 2 · O que a Meta recusaria de certeza não gasta pedido.
      const validacao = validarModelo(item);
      if (!validacao.ok) {
        await registrar(item, NAO_ENVIADO, validacao.motivo, null);
        resumo.falhas += 1;
        ctx.logger.warn('modelo não enviado para aprovação', {
          template_id: item.template_id,
          codigo: item.codigo,
          motivo: validacao.motivo,
        });
        continue;
      }

      // 3 · O pedido de criação.
      if (pedidos > 0) await dormir(intervalo);
      pedidos += 1;
      const r = await ctx.graph.publicar(
        `${ctx.wabaId}/message_templates`,
        montarPedidoDeModelo(item) as unknown as Record<string, unknown>,
      );

      if (r.ok) {
        const status = (textoOuNulo(r.json.status) ?? 'PENDING').toUpperCase();
        await registrar(item, status, null, textoOuNulo(r.json.id));
        resumo.enviados += 1;
        contarStatus(resumo, status);
        ctx.logger.info('modelo enviado para aprovação', {
          template_id: item.template_id,
          nome: item.nome_sugerido,
          status,
        });
        continue;
      }

      if (ehErroDoMundo(r)) {
        return { ok: false, erro: `criar modelo na Meta: ${descreverFalha(r)}`, resumo };
      }

      // 4 · "Já existe": a lista escapou dele. Busca pelo nome e registra.
      if (modeloJaExiste(r)) {
        const achado = await buscarModeloPorNome(
          ctx.graph,
          ctx.wabaId,
          item.nome_sugerido,
          item.idioma,
        );
        if (!achado.ok) {
          return {
            ok: false,
            erro: `buscar modelo na Meta: ${descreverFalha(achado.falha)}`,
            resumo,
          };
        }
        if (achado.modelo !== null) {
          await registrar(
            item,
            achado.modelo.status,
            achado.modelo.rejected_reason,
            achado.modelo.id,
          );
          contarStatus(resumo, achado.modelo.status);
          continue;
        }
      }

      // 5 · A Meta recusou o PEDIDO (não o revisou): é do item.
      const motivo = `A Meta recusou o pedido de criação (${descreverFalha(r)})`;
      await registrar(item, NAO_ENVIADO, motivo, null);
      resumo.falhas += 1;
      ctx.logger.warn('a Meta recusou o pedido de criação do modelo', {
        template_id: item.template_id,
        codigo: r.codigo,
        subcodigo: r.subcodigo ?? null,
      });
    }
  } catch (erro) {
    // O banco parou de responder no meio: é do mundo.
    if (erro instanceof ErroDaPonte) {
      return { ok: false, erro: `banco: ${erro.message}`, resumo };
    }
    throw erro;
  }

  ctx.logger.info('modelos sincronizados com a Meta', { ...resumo });
  return { ok: true, resumo, interrompida: false };
}

/** Uma linha que se lê: "3 enviados · 1 aprovado · …". */
export function fraseDoResumo(resumo: ResumoDosModelos): string {
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  return [
    plural(resumo.enviados, 'enviado', 'enviados'),
    plural(resumo.aprovados, 'aprovado', 'aprovados'),
    plural(resumo.pendentes, 'pendente', 'pendentes'),
    plural(resumo.recusados, 'recusado', 'recusados'),
    plural(resumo.falhas, 'falha', 'falhas'),
  ].join(' · ');
}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

// ---------------------------------------------------------------------------
// A sincronização periódica do laço do worker-wa
// ---------------------------------------------------------------------------

export const INTERVALO_DA_SINCRONIZACAO_MS = 30 * 60 * 1000;

export interface SincronizacaoPeriodica {
  /** Dispara em segundo plano se já deu a hora e nada estiver rodando. */
  talvezDisparar(): void;
  /**
   * Espera a passada em curso. `interromper` pede para parar entre um modelo e
   * outro (SIGTERM); sem ele, a passada termina (`--uma-vez`).
   */
  encerrar(interromper: boolean): Promise<void>;
}

/**
 * Em SEGUNDO PLANO, e nunca derrubando o laço: a primeira passada pode levar um
 * minuto (um pedido por segundo), e um minuto sem ler a fila de entrada é um
 * minuto sem responder quem escreveu — e responder em ≤ 5 min é o que mais pesa
 * na conversão (R08 §0.1). Falha só vira log.
 */
export function criarSincronizacaoPeriodica(
  ctx: Omit<ContextoDosModelos, 'deveParar'>,
  opcoes: {
    intervaloMs?: number;
    agora?: () => number;
    sincronizar?: (ctx: ContextoDosModelos) => Promise<ResultadoDaSincronizacao>;
  } = {},
): SincronizacaoPeriodica {
  const intervalo = opcoes.intervaloMs ?? INTERVALO_DA_SINCRONIZACAO_MS;
  const agora = opcoes.agora ?? Date.now;
  const sincronizar = opcoes.sincronizar ?? sincronizarModelos;
  let proximaEm = 0;
  let emCurso: Promise<void> | null = null;
  let parar = false;

  return {
    talvezDisparar() {
      if (parar || emCurso !== null || agora() < proximaEm) return;
      proximaEm = agora() + intervalo;
      emCurso = sincronizar({ ...ctx, deveParar: () => parar })
        .then((r) => {
          if (!r.ok) {
            ctx.logger.error('sincronização de modelos com a Meta falhou', {
              erro: r.erro,
              ...r.resumo,
            });
          }
        })
        .catch((erro: unknown) => {
          ctx.logger.error('sincronização de modelos com a Meta quebrou', {
            erro: mensagemDe(erro),
          });
        })
        .finally(() => {
          emCurso = null;
        });
    },
    async encerrar(interromper) {
      if (interromper) parar = true;
      if (emCurso !== null) await emCurso;
      parar = true;
    },
  };
}
