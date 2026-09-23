import type { ActivityType, Channel, DealStatus, Json, Temperature } from '@komune/schema';

import type { LeituraCrua } from './dados';

import {
  PAR_DA_SUPERFICIE,
  ROTULOS_COM_QUEM,
  type ComQuem,
  type Superficie,
} from '@/components/registro/tipos';
import { rotuloDaSuperficie } from '@/components/relatorios/formatos';

import {
  ROTULO_CANAL,
  ROTULO_TIPO,
  type AutorTipo,
  type DiaDaLinha,
  type EtiquetaDoParceiro,
  type EventoDaLinha,
  type FiltrosConversas,
  type ItemConversa,
} from './tipos';
import { chaveDoDia } from './formatos';
import {
  montarFio,
  montarMensagens,
  montarRascunho,
  type FioCru,
  type MensagemCrua,
  type RascunhoCru,
} from './mensagens';

/**
 * A montagem da tela de Conversas, em funções puras.
 *
 * Fica separada de `dados.ts` (que fala com o Supabase) e dos componentes por dois
 * motivos: é a parte que decide a ORDEM da lista e o CONTEÚDO de cada linha do tempo,
 * ou seja, o que a Heloísa lê primeiro; e é a única parte testável sem navegador
 * (`montagem.test.ts`).
 *
 * Regra de ouro deste arquivo: nada é inventado. Se o banco não disse, o campo fica
 * `null` e a interface escreve "sem contato" ou "não sei dizer", nunca um valor
 * plausível. É o mesmo princípio de `formatarDiasSemContato`: "sem contato" não é
 * "hoje".
 */

// ---------------------------------------------------------------------------
// As linhas cruas, como saem do PostgREST
// ---------------------------------------------------------------------------

export type AtividadeCrua = {
  id: string;
  organization_id: string | null;
  deal_id: string | null;
  type: ActivityType;
  channel: Channel | null;
  author_kind: string;
  occurred_at: string;
  body: string | null;
  duration_min: number | null;
  user_id: string | null;
  outcome_id: number | null;
  metadata: Json;
  /** A mensagem que esta atividade registra, quando ela nasceu de uma. */
  message_id?: string | null;
};

export type OrganizacaoCrua = {
  id: string;
  name: string;
  primary_category_name: string | null;
  neighborhood: string | null;
  city_name: string | null;
  temperature: Temperature;
  phone_e164: string | null;
  phone_is_masked: boolean | null;
  do_not_contact: boolean;
};

export type NegocioCru = {
  id: string;
  organization_id: string;
  stage_id: number;
  status: DealStatus;
  owner_id: string | null;
  needs_attention: boolean;
  next_action: string | null;
  next_action_at: string | null;
  updated_at: string;
};

export type HistoricoCru = {
  id: number;
  deal_id: string;
  changed_at: string;
  from_stage_id: number | null;
  to_stage_id: number;
  changed_by: string | null;
  reason: string | null;
};

/** Listas pequenas e estáveis, lidas uma vez no servidor (ver `catalogos.ts`). */
export type CatalogosConversas = {
  pessoas: { id: string; nome: string }[];
  /** As categorias ativas, para criar a ficha de quem escreveu de fora da base. */
  categorias?: { id: number; nome: string }[];
  etapas: { id: number; nome: string; funil: string }[];
  desfechos: { id: number; nome: string }[];
};

// ---------------------------------------------------------------------------
// Leitura defensiva do `metadata` das atividades
// ---------------------------------------------------------------------------

function objetoDoMeta(meta: Json): Record<string, Json | undefined> {
  return meta !== null && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, Json | undefined>)
    : {};
}

function textoDoMeta(meta: Json, chave: string): string | null {
  const valor = objetoDoMeta(meta)[chave];
  return typeof valor === 'string' ? valor : null;
}

function boleanoDoMeta(meta: Json, chave: string): boolean {
  return objetoDoMeta(meta)[chave] === true;
}

/** `metadata.com_quem` traduzido; `null` quando o desfecho não afirma nada (RF-MET-01). */
function comQuemLegivel(meta: Json): string | null {
  const bruto = textoDoMeta(meta, 'com_quem');
  if (bruto === null || bruto === 'nao_informado') return null;
  return bruto in ROTULOS_COM_QUEM ? ROTULOS_COM_QUEM[bruto as ComQuem] : null;
}

function autorTipo(bruto: string): AutorTipo {
  return bruto === 'bot_fixed' || bruto === 'bot_ai' || bruto === 'system' ? bruto : 'human';
}

// ---------------------------------------------------------------------------
// Interação x registro do sistema
// ---------------------------------------------------------------------------

/**
 * O import da lista-semente da R09 entrou como `type = 'system'` em todas as 100
 * organizações. Ele conta como PROVENIÊNCIA (de onde o parceiro veio), nunca como
 * conversa: se contasse, a base inteira apareceria como "falei hoje" e a ordenação
 * da lista viraria a ordem do import.
 */
export function ehInteracao(a: AtividadeCrua): boolean {
  return a.type !== 'system';
}

/** Dias inteiros desde uma data, como o banco calcula em `search_organizations`. */
export function diasDesde(iso: string | null, agora: Date): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((agora.getTime() - new Date(iso).getTime()) / 86_400_000));
}

// ---------------------------------------------------------------------------
// A lista da esquerda
// ---------------------------------------------------------------------------

/** Acumulador por organização, antes de virar `ItemConversa`. */
type Acumulado = {
  ultima: AtividadeCrua | null;
  canais: Set<Channel>;
  quemFalou: Set<string>;
  interacoes: number;
};

export function montarConversas({
  organizacoes,
  atividades,
  negocios,
  catalogos,
  fios = [],
  rascunhos = [],
  leituras = [],
  etiquetas = [],
  etiquetasDoParceiro = [],
  agora = new Date(),
}: {
  organizacoes: OrganizacaoCrua[];
  atividades: AtividadeCrua[];
  negocios: NegocioCru[];
  catalogos: CatalogosConversas;
  /** Os fios de WhatsApp, um por par (número da empresa × número da pessoa). */
  fios?: FioCru[];
  /** Só os PENDENTES: é o que a fila de aprovação e o ponto na lista precisam. */
  rascunhos?: RascunhoCru[];
  /** A leitura da IA por conversa. Vazia quando o módulo está desligado. */
  leituras?: LeituraCrua[];
  /** O catálogo de etiquetas e quem tem qual: a lista mostra as do parceiro. */
  etiquetas?: EtiquetaDoParceiro[];
  etiquetasDoParceiro?: { organization_id: string; tag_id: number }[];
  agora?: Date;
}): ItemConversa[] {
  const nomeDaPessoa = new Map(catalogos.pessoas.map((p) => [p.id, p.nome]));
  const etiquetaPorId = new Map(etiquetas.map((e) => [e.id, e]));
  const etiquetasPorOrganizacao = new Map<string, EtiquetaDoParceiro[]>();
  for (const v of etiquetasDoParceiro) {
    const etiqueta = etiquetaPorId.get(v.tag_id);
    if (!etiqueta) continue;
    etiquetasPorOrganizacao.set(v.organization_id, [
      ...(etiquetasPorOrganizacao.get(v.organization_id) ?? []),
      etiqueta,
    ]);
  }
  const etapaPorId = new Map(catalogos.etapas.map((e) => [e.id, e]));
  const nomeDoDesfecho = new Map(catalogos.desfechos.map((d) => [d.id, d.nome]));

  // O fio da organização. Pode haver mais de um (dois números da KOMUNE falando
  // com a mesma ficha, RF-CON-01): fica o que teve mensagem mais recente, que é
  // onde a conversa está viva.
  const fioPorOrganizacao = new Map<string, FioCru>();
  for (const f of fios) {
    if (!f.organization_id) continue;
    const atual = fioPorOrganizacao.get(f.organization_id);
    if (!atual || (f.last_message_at ?? '') > (atual.last_message_at ?? '')) {
      fioPorOrganizacao.set(f.organization_id, f);
    }
  }

  // Um rascunho pendente por conversa é garantia do banco (índice único
  // parcial); por ORGANIZAÇÃO ainda pode haver mais de um, e aí vale o que
  // expira primeiro — é o que some sozinho se ninguém olhar.
  const rascunhoPorOrganizacao = new Map<string, RascunhoCru>();
  for (const r of rascunhos) {
    const atual = rascunhoPorOrganizacao.get(r.organization_id);
    if (!atual || r.expires_at < atual.expires_at) {
      rascunhoPorOrganizacao.set(r.organization_id, r);
    }
  }

  const porOrganizacao = new Map<string, Acumulado>();
  for (const a of atividades) {
    if (!a.organization_id || !ehInteracao(a)) continue;
    let acumulado = porOrganizacao.get(a.organization_id);
    if (!acumulado) {
      acumulado = { ultima: null, canais: new Set(), quemFalou: new Set(), interacoes: 0 };
      porOrganizacao.set(a.organization_id, acumulado);
    }
    acumulado.interacoes += 1;
    if (a.channel) acumulado.canais.add(a.channel);
    if (a.user_id) acumulado.quemFalou.add(a.user_id);
    if (!acumulado.ultima || a.occurred_at > acumulado.ultima.occurred_at) acumulado.ultima = a;
  }

  // Negócio em foco: o aberto mexido mais recentemente; se nenhum estiver aberto, o
  // mais recente de todos. É a mesma escolha que a lista de Parceiros faz, para as
  // duas telas nunca discordarem sobre em que etapa o parceiro está.
  const negocioEmFoco = new Map<string, NegocioCru>();
  for (const d of negocios) {
    const atual = negocioEmFoco.get(d.organization_id);
    if (!atual || melhorNegocio(d, atual)) negocioEmFoco.set(d.organization_id, d);
  }

  // Uma leitura por PARCEIRO, não por conversa: a lista é de parceiros, e um
  // parceiro pode ter mais de um fio (dois números do mesmo buffet). Fica a mais
  // recentemente analisada — é ela que fala do que está acontecendo agora.
  const leituraPorOrganizacao = new Map<string, LeituraCrua>();
  for (const l of leituras) {
    if (l.organization_id === null) continue;
    leituraPorOrganizacao.set(l.organization_id, l);
  }

  const itens = organizacoes.map((o): ItemConversa => {
    const acumulado = porOrganizacao.get(o.id);
    const ultima = acumulado?.ultima ?? null;
    const negocio = negocioEmFoco.get(o.id) ?? null;
    const etapa = negocio ? (etapaPorId.get(negocio.stage_id) ?? null) : null;
    const fioCru = fioPorOrganizacao.get(o.id) ?? null;
    const rascunhoCru = rascunhoPorOrganizacao.get(o.id) ?? null;

    return {
      id: o.id,
      nome: o.name,
      categoria: o.primary_category_name,
      bairro: o.neighborhood,
      cidade: o.city_name,
      temperatura: o.temperature,
      precisaAtencao: negocio?.needs_attention ?? false,
      telefone: o.phone_e164,
      telefoneMascarado: o.phone_is_masked ?? true,
      naoContatar: o.do_not_contact,
      etapa: etapa?.nome ?? null,
      funil: etapa?.funil ?? null,
      responsavelId: negocio?.owner_id ?? null,
      responsavel: negocio?.owner_id ? (nomeDaPessoa.get(negocio.owner_id) ?? null) : null,
      ultimaEm: ultima?.occurred_at ?? null,
      diasSemContato: diasDesde(ultima?.occurred_at ?? null, agora),
      resumo: ultima ? resumoDaAtividade(ultima, nomeDoDesfecho) : null,
      ultimoCanal: ultima?.channel ?? null,
      canais: [...(acumulado?.canais ?? [])],
      quemFalou: [...(acumulado?.quemFalou ?? [])],
      interacoes: acumulado?.interacoes ?? 0,
      fio: fioCru ? montarFio(fioCru, nomeDaPessoa) : null,
      naoLidas: fioCru?.unread_count ?? 0,
      rascunhoPendente: rascunhoCru ? montarRascunho(rascunhoCru) : null,
      leituraDaIa: montarLeitura(leituraPorOrganizacao.get(o.id) ?? null),
      etiquetas: etiquetasPorOrganizacao.get(o.id) ?? [],
    };
  });

  return ordenarConversas(itens);
}

/**
 * O negócio em foco de uma organização: o aberto mexido mais recentemente e, se
 * nenhum estiver aberto, o mais recente de todos. Exportado porque o cabeçalho da
 * conversa precisa da mesma escolha que a lista fez, senão as duas discordariam
 * sobre a etapa e a próxima ação do mesmo parceiro.
 */
export function escolherNegocio(negocios: NegocioCru[]): NegocioCru | null {
  let escolhido: NegocioCru | null = null;
  for (const d of negocios) {
    if (!escolhido || melhorNegocio(d, escolhido)) escolhido = d;
  }
  return escolhido;
}

function melhorNegocio(candidato: NegocioCru, atual: NegocioCru): boolean {
  const abertoCandidato = candidato.status === 'open';
  const abertoAtual = atual.status === 'open';
  if (abertoCandidato !== abertoAtual) return abertoCandidato;
  return candidato.updated_at > atual.updated_at;
}

/** Uma linha do que aconteceu por último: o desfecho, ou a observação, ou o tipo. */
function resumoDaAtividade(a: AtividadeCrua, nomeDoDesfecho: Map<number, string>): string {
  if (a.outcome_id !== null) {
    const nome = nomeDoDesfecho.get(a.outcome_id);
    if (nome) return nome;
  }
  const corpo = a.body?.trim();
  if (corpo) return corpo.split('\n')[0] ?? corpo;
  return ROTULO_TIPO[a.type];
}

/**
 * O instante que ordena a lista: a interação humana mais recente OU a última
 * mensagem do fio, o que for mais novo.
 *
 * Antes do inbox só existia a primeira. Sem esta soma, um parceiro que acabou de
 * escrever no WhatsApp continuaria no meio da lista, atrás de uma ligação de três
 * dias atrás — que é o defeito clássico de inbox: a mensagem chega e não sobe.
 */
export function momentoDaLista(item: ItemConversa): string | null {
  const mensagem = item.fio?.ultimaEm ?? null;
  if (!item.ultimaEm) return mensagem;
  if (!mensagem) return item.ultimaEm;
  return mensagem > item.ultimaEm ? mensagem : item.ultimaEm;
}

/**
 * Quem tem mensagem por ler vem primeiro; depois, quem falou por último; quem
 * nunca foi contatado vai para o fim, em ordem alfabética.
 *
 * O não lido ganha do recente de propósito: uma mensagem que chegou ontem e
 * ninguém abriu é mais urgente do que uma ligação registrada hoje de manhã, e é
 * ela que o RF-CON-04 quer que não caia num lugar onde ninguém vê. O fim da lista
 * continua sendo a fila de quem falta abordar, em ordem de nome — previsível, dá
 * para continuar de onde parou.
 */
export function ordenarConversas(itens: ItemConversa[]): ItemConversa[] {
  return [...itens].sort((a, b) => {
    if (a.naoLidas > 0 !== b.naoLidas > 0) return a.naoLidas > 0 ? -1 : 1;
    const ma = momentoDaLista(a);
    const mb = momentoDaLista(b);
    if (ma && mb) return mb.localeCompare(ma);
    if (ma) return -1;
    if (mb) return 1;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

// ---------------------------------------------------------------------------
// Os filtros
// ---------------------------------------------------------------------------

/** Sem acento e em minúsculas, como o `unaccent` + `lower` do banco. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Quem está olhando a lista: é o que "Minhas" e "Meu setor" perguntam. */
export type QuemVe = { euId: string | null; meusSetores: readonly number[] };

export function aplicarFiltros(
  itens: ItemConversa[],
  f: FiltrosConversas,
  quem: QuemVe = { euId: null, meusSetores: [] },
): ItemConversa[] {
  const busca = normalizar(f.q);

  return itens.filter((item) => {
    // "Minhas" e "Meu setor" perguntam pelo FIO de WhatsApp: parceiro sem
    // conversa não tem quem atenda nem setor, e sai desses dois recortes.
    if (f.escopo === 'minhas' && (quem.euId === null || item.fio?.responsavelId !== quem.euId)) {
      return false;
    }
    if (
      f.escopo === 'setor' &&
      (item.fio?.setorId == null || !quem.meusSetores.includes(item.fio.setorId))
    ) {
      return false;
    }

    if (busca) {
      const alvo = normalizar(
        [item.nome, item.categoria, item.bairro, item.cidade].filter(Boolean).join(' '),
      );
      if (!alvo.includes(busca)) return false;
    }

    // "Responsável" abrange os TRÊS laços que a base tem com uma pessoa: dono do
    // NEGÓCIO (`deals.owner_id`), quem ATENDE o fio de WhatsApp
    // (`conversations.assignee_id`) e quem REGISTROU as interações. Filtrar só pelo
    // primeiro esconderia as conversas das 72 organizações cujo negócio ainda está
    // sem dono.
    //
    // O atendimento faltava aqui, e faltava do jeito mais caro: o cabeçalho da
    // conversa mostrava o responsável do FIO e este filtro comparava com o dono do
    // NEGÓCIO. Uma conversa atribuída à Heloísa cujo negócio é de outra pessoa
    // aparecia com o nome dela em cima e SUMIA quando ela filtrava por si mesma —
    // duas colunas diferentes chamadas pela mesma palavra, e a pessoa não se achando
    // no próprio filtro. O cabeçalho passou a separar "Responsável" de "Atendendo"; o
    // filtro continua largo de propósito, porque quem filtra por si mesma pergunta "o
    // que é meu?", e uma conversa que ela atende é a resposta mais óbvia que existe.
    if (f.responsavelId !== null) {
      const meu =
        item.responsavelId === f.responsavelId ||
        item.fio?.responsavelId === f.responsavelId ||
        item.quemFalou.includes(f.responsavelId);
      if (!meu) return false;
    }

    // "Atendendo" é ESTREITO, e é essa a diferença. Ele pergunta só por
    // `conversations.assignee_id`: quem está falando com este parceiro agora.
    // Parceiro sem fio de WhatsApp não tem atendente e sai da lista — não é
    // omissão, é a resposta certa para "o que a Heloísa está atendendo".
    if (f.atendenteId !== null) {
      if (item.fio?.responsavelId !== f.atendenteId) return false;
    }

    if (f.canal !== null && !item.canais.includes(f.canal)) return false;

    if (!cabeNaJanela(item.diasSemContato, f.janela)) return false;

    return true;
  });
}

export function cabeNaJanela(dias: number | null, janela: FiltrosConversas['janela']): boolean {
  switch (janela) {
    case 'qualquer':
      return true;
    case 'hoje':
      return dias === 0;
    case 'ate3':
      return dias !== null && dias <= 3;
    case 'mais7':
      return dias !== null && dias > 7;
    case 'mais14':
      return dias !== null && dias > 14;
    case 'nunca':
      return dias === null;
  }
}

// ---------------------------------------------------------------------------
// A linha do tempo da direita
// ---------------------------------------------------------------------------

/**
 * O par (tipo, canal) de volta para a superfície que o produziu.
 *
 * O mapa é IMPORTADO de `registro/tipos` em vez de copiado porque ele não é o
 * contrato de uma tela: é o inverso de `app.interaction_surface(p_channel, p_type)`,
 * a mesma função que o gatilho `activities_apply_outcome` usa para recusar desfecho
 * fora da superfície. Uma cópia aqui envelheceria calada, e a linha do tempo passaria
 * a nomear uma superfície que a RPC não produz mais.
 *
 * A chave junta os dois campos porque nenhum deles decide sozinho: `presencial` é
 * visita E reunião, e é o tipo que separa as duas.
 */
const SUPERFICIE_DO_PAR = new Map<string, Superficie>(
  (Object.entries(PAR_DA_SUPERFICIE) as [Superficie, { tipo: ActivityType; canal: Channel }][]).map(
    ([superficie, par]) => [`${par.tipo}:${par.canal}`, superficie],
  ),
);

export function superficieDaInteracao(
  tipo: ActivityType | null,
  canal: Channel | null,
): Superficie | null {
  if (!tipo || !canal) return null;
  return SUPERFICIE_DO_PAR.get(`${tipo}:${canal}`) ?? null;
}

/**
 * O que o evento foi e por onde, em UMA palavra quando uma palavra basta.
 *
 * Numa ligação a segunda linha escrevia "Ligação · Telefone": o tipo e o canal
 * dizendo a mesma coisa, e quem lê procurando qual é a diferença entre as duas
 * palavras. Quando o par (tipo, canal) é exatamente uma superfície de interação,
 * vale o nome da SUPERFÍCIE — que é a palavra que a tela de registro, a régua de
 * cadência, os relatórios e a administração já usam para a mesma coisa. É o que
 * deixa afirmar que o passo "Ligação" da cadência e esta linha falam do mesmo
 * evento; com "Telefone" de um lado e "Ligação" do outro não dava.
 *
 * Fora dos cinco pares conhecidos os dois campos voltam, porque aí eles não são
 * redundantes: "Nota · Telefone" é a nota tomada durante uma ligação. O que não
 * volta é a palavra repetida — `email` é tipo e canal, e escrevia "E-mail · E-mail".
 */
export function procedenciaDoEvento({
  genero,
  tipo,
  canal,
}: Pick<EventoDaLinha, 'genero' | 'tipo' | 'canal'>): string[] {
  // "Entrou na base" já é o título do evento de origem: repetir "Registro do sistema"
  // embaixo gastaria a segunda linha para não acrescentar nada.
  if (genero === 'origem') return canal ? [ROTULO_CANAL[canal]] : [];

  const superficie = superficieDaInteracao(tipo, canal);
  if (superficie) return [rotuloDaSuperficie(superficie)];

  const palavras: string[] = [];
  if (tipo) palavras.push(ROTULO_TIPO[tipo]);
  if (canal) palavras.push(ROTULO_CANAL[canal]);
  return [...new Set(palavras)];
}

/**
 * Uma coluna só, em ordem cronológica (o mais antigo em cima), como uma conversa.
 *
 * As três fontes entram na mesma coluna e ficam distinguíveis pelo `genero`, não por
 * abas: quem lê precisa ver que a ligação de terça veio ANTES da mudança de etapa que
 * ela causou. Separar em abas quebraria justamente a relação de causa que o registro
 * de desfechos criou (`activities_apply_outcome` grava a atividade e o `move_deal`
 * grava a etapa, no mesmo segundo).
 */
/** Quantos minutos ainda contam como "a mesma fala". */
export const MINUTOS_DO_BLOCO = 5;

/**
 * Duas mensagens do mesmo autor, uma seguida da outra: viram um bloco.
 *
 * É o que tira da tela a repetição de nome, hora e entrega a cada linha — e o
 * que faz "mandei três mensagens seguidas" parecer três mensagens seguidas, e
 * não três registros de auditoria. Evento que não é mensagem nunca entra em
 * bloco: a ligação no meio da conversa é justamente o que separa um assunto do
 * outro.
 */
export function mesmoBloco(a: EventoDaLinha | undefined, b: EventoDaLinha | undefined): boolean {
  if (!a?.mensagem || !b?.mensagem) return false;
  if (a.genero !== 'mensagem' || b.genero !== 'mensagem') return false;
  if (a.mensagem.entrada !== b.mensagem.entrada) return false;
  if ((a.mensagem.autor ?? '') !== (b.mensagem.autor ?? '')) return false;
  if (a.mensagem.autorTipo !== b.mensagem.autorTipo) return false;
  const minutos = Math.abs(new Date(b.em).getTime() - new Date(a.em).getTime()) / 60_000;
  return minutos <= MINUTOS_DO_BLOCO;
}

export function montarLinhaDoTempo({
  atividades,
  historico,
  catalogos,
  mensagens = [],
}: {
  atividades: AtividadeCrua[];
  historico: HistoricoCru[];
  catalogos: CatalogosConversas;
  /** As mensagens de WhatsApp deste parceiro, nos dois sentidos. */
  mensagens?: MensagemCrua[];
}): EventoDaLinha[] {
  const nomeDaPessoa = new Map(catalogos.pessoas.map((p) => [p.id, p.nome]));
  const etapaPorId = new Map(catalogos.etapas.map((e) => [e.id, e]));
  const nomeDoDesfecho = new Map(catalogos.desfechos.map((d) => [d.id, d.nome]));

  // A ATIVIDADE QUE ESPELHA UMA MENSAGEM NÃO VIRA NOTA.
  //
  // Toda mensagem do WhatsApp grava também uma atividade (é ela que alimenta o
  // "último contato", a cadência e os relatórios). Na coluna, isso aparecia duas
  // vezes: a nota "Respondeu · WhatsApp" e, logo abaixo, o balão com o texto. O
  // balão diz tudo o que a nota dizia, e diz melhor. A nota volta a aparecer
  // quando a mensagem NÃO está carregada — aí ela é o único registro do que houve.
  const idsDasMensagens = new Set(mensagens.map((m) => m.id));
  const daAtividade = atividades
    .filter((a) => !(a.message_id && idsDasMensagens.has(a.message_id)))
    .map((a): EventoDaLinha => {
    const interacao = ehInteracao(a);
    return {
      id: `atividade:${a.id}`,
      genero: interacao ? 'interacao' : 'origem',
      em: a.occurred_at,
      titulo: interacao ? ROTULO_TIPO[a.type] : 'Entrou na base',
      desfecho: a.outcome_id !== null ? (nomeDoDesfecho.get(a.outcome_id) ?? null) : null,
      detalhe: a.body?.trim() || null,
      canal: a.channel,
      tipo: a.type,
      autor: a.user_id ? (nomeDaPessoa.get(a.user_id) ?? null) : null,
      autorTipo: autorTipo(a.author_kind),
      comQuem: comQuemLegivel(a.metadata),
      duracaoMin: a.duration_min,
      portaAberta: boleanoDoMeta(a.metadata, 'door_opened'),
      mensagem: null,
    };
  });

  const daEtapa = historico.map((h): EventoDaLinha => {
    const de = h.from_stage_id !== null ? etapaPorId.get(h.from_stage_id) : undefined;
    const para = etapaPorId.get(h.to_stage_id);
    return {
      id: `etapa:${h.id}`,
      genero: 'etapa',
      em: h.changed_at,
      titulo: de
        ? `De ${de.nome} para ${para?.nome ?? 'outra etapa'}`
        : `Entrou em ${para?.nome ?? 'uma etapa'}`,
      desfecho: null,
      detalhe: h.reason?.trim() || null,
      canal: null,
      tipo: 'stage_change',
      autor: h.changed_by ? (nomeDaPessoa.get(h.changed_by) ?? null) : null,
      autorTipo: h.changed_by ? 'human' : 'system',
      comQuem: null,
      duracaoMin: null,
      portaAberta: false,
      mensagem: null,
    };
  });

  // A mensagem entra na mesma coluna, não numa aba: é a promessa que o cabeçalho
  // de `tipos.ts` fazia desde o D5, e é o que deixa ver que o WhatsApp das 14h20
  // veio DEPOIS da ligação das 14h — e por causa dela.
  const daMensagem = montarMensagens(mensagens, nomeDaPessoa).map((m): EventoDaLinha => ({
    id: `mensagem:${m.id}`,
    genero: 'mensagem',
    em: m.em,
    titulo: m.entrada ? 'Mensagem recebida' : 'Mensagem enviada',
    desfecho: null,
    detalhe: m.texto,
    canal: 'whatsapp',
    tipo: 'message',
    autor: m.autor,
    autorTipo: m.autorTipo,
    comQuem: null,
    duracaoMin: null,
    portaAberta: false,
    mensagem: m,
  }));

  // Empate de segundo entre a atividade e a mudança de etapa que ela causou: a
  // atividade primeiro, porque foi ela que causou a mudança. A mensagem fica
  // entre as duas: ela é o que aconteceu, e a etapa é a consequência.
  const peso = { origem: 0, interacao: 1, mensagem: 2, etapa: 3 } as const;
  return [...daAtividade, ...daEtapa, ...daMensagem].sort(
    (a, b) => a.em.localeCompare(b.em) || peso[a.genero] - peso[b.genero],
  );
}

/** Quebra a coluna em dias, para o separador de data. Preserva a ordem recebida. */
export function agruparPorDia(eventos: EventoDaLinha[]): DiaDaLinha[] {
  const dias: DiaDaLinha[] = [];
  for (const evento of eventos) {
    const chave = chaveDoDia(evento.em);
    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.chave === chave) ultimo.eventos.push(evento);
    else dias.push({ chave, em: evento.em, eventos: [evento] });
  }
  return dias;
}

/**
 * A leitura crua do banco vira o pedaço que a lista mostra.
 *
 * Devolve `null` quando não há conselho nem score: uma leitura vazia na tela é
 * ruído com cara de informação, e a IA às vezes analisa uma conversa que não tem
 * nada a dizer ainda ("o parceiro só escreveu 'oi'").
 */
function montarLeitura(crua: LeituraCrua | null): ItemConversa['leituraDaIa'] {
  if (crua === null) return null;
  const acao = (crua.proxima_acao ?? '').trim();
  const score = typeof crua.score_intencao === 'number' ? crua.score_intencao : null;
  const alertas = (crua.alertas ?? []).filter((a) => a.trim() !== '');
  if (acao === '' && score === null && alertas.length === 0) return null;
  return {
    proximaAcao: acao === '' ? null : acao,
    score,
    intencao: crua.intencao,
    alertas,
  };
}
