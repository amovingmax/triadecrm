import type {
  CampoQueVende,
  FaixaDePassagem,
  FaixaDeResposta,
  LacunaDaIA,
  LinhaImovel,
  LinhaPessoaVende,
  LinhaSituacao,
  NivelDeInteresse,
  Premissas,
  Previsao,
  SemanaDaIA,
  SituacaoParada,
  Sugestao,
  TipoDeImovel,
} from './dados-vende';

/**
 * Formatos e frases do "relatório que vende" da Imova (09/11/2026).
 *
 * Tudo aqui é puro (o relógio entra por parâmetro, o fuso é sempre o de Natal) para
 * o Vitest conferir. Nenhuma CONTA de negócio mora aqui (ADR-03: quem soma é o
 * banco); o que existe é a conta de EXIBIÇÃO: o dinheiro curto, o delta contra o
 * período anterior, a frase-título de cada gráfico montada com os números que
 * chegaram, e a versão neutra quando não chegou nada.
 *
 * O contrato (`dados-vende.ts`) diz: dinheiro em reais, porcentagem de 0 a 100,
 * chance de 0 a 1. Toda função aceita nulo e devolve o marcador de sem dado (“—”)
 * em vez de um zero que mentiria.
 */

const FUSO = 'America/Fortaleza';

const DIA_CIVIL = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });

const REAIS_INTEIROS = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const INTEIRO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

/** O espaço fixo do `Intl` vira espaço comum: a frase quebra onde a tela pedir. */
const espacos = (texto: string) => texto.replace(/[  ]/g, ' ');

// ---------------------------------------------------------------------------
// Defesa contra o que vier do banco
// ---------------------------------------------------------------------------

/** A lista, ou vazia: a função do banco pode devolver `null` onde a forma diz lista. */
export function lista<T>(valor: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(valor) ? valor : [];
}

/** O número finito, ou nulo. Aceita o `numeric` que vier como texto. */
export function numero(valor: unknown): number | null {
  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Contagem: nulo vira zero (contar nada é zero), e nunca negativo. */
export function contagem(valor: unknown): number {
  return Math.max(0, numero(valor) ?? 0);
}

/** Plural simples: `plural(1, 'lead', 'leads')`. */
export function plural(n: number, um: string, varios: string): string {
  return Math.abs(n) === 1 ? um : varios;
}

/**
 * O título do imóvel dentro de uma frase: o anúncio do portal chega a ter 120
 * caracteres ("Terreno Comercial 3.500–5.000 m² na Área da BONOR, Esquina…"), e o
 * título-conclusão do gráfico não pode virar parágrafo. Corta na palavra, com "…".
 */
export function encurtar(texto: string | null | undefined, maximo = 42): string {
  const t = (texto ?? '').trim().replace(/\s+/g, ' ');
  if (t.length <= maximo) return t;
  const corte = t.slice(0, maximo + 1);
  const espaco = corte.lastIndexOf(' ');
  const base = (espaco > maximo * 0.6 ? corte.slice(0, espaco) : t.slice(0, maximo)).replace(/[\s,;:.·–-]+$/, '');
  return `${base}…`;
}

/** "23 leads", "1 lead". */
export function contar(n: number, um: string, varios: string): string {
  return `${inteiro(n)} ${plural(n, um, varios)}`;
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

/** "1.240". */
export function inteiro(valor: unknown): string {
  const n = numero(valor);
  return n === null ? '—' : espacos(INTEIRO.format(Math.round(n)));
}

/** Uma casa, com vírgula, sem o ",0" que só faz barulho: 4,4 · 4 · 0,6. */
export function decimalEnxuto(valor: unknown, casas = 1): string {
  const n = numero(valor);
  if (n === null) return '—';
  const fator = 10 ** casas;
  const texto = (Math.round(n * fator) / fator).toFixed(casas).replace('.', ',');
  return texto.includes(',') ? texto.replace(/0+$/, '').replace(/,$/, '') : texto;
}

/** Uma casa sempre (a nota de 1 a 5): "4,2", "4,0". */
export function decimalFixo(valor: unknown): string {
  const n = numero(valor);
  return n === null ? '—' : (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
}

/** Porcentagem que já vem de 0 a 100: "24%". */
export function pct(valor: unknown): string {
  const n = numero(valor);
  return n === null ? '—' : `${Math.round(n)}%`;
}

/** Chance de 0 a 1: "38%", e "0,6%" quando arredondar para inteiro daria zero. */
export function pctDaChance(chance: unknown): string {
  const n = numero(chance);
  if (n === null) return '—';
  const p = n * 100;
  return p > 0 && p < 1 ? `${decimalEnxuto(p)}%` : `${Math.round(p)}%`;
}

/** A parte sobre o todo, de 0 a 100, inteira; nulo sem denominador. */
export function parteDe(parte: number, todo: number): number | null {
  return todo > 0 ? Math.round((parte / todo) * 100) : null;
}

/** Fração de 0 a 1 para largura de barra: protegida contra máximo zero e estouro. */
export function fracao(valor: unknown, maximo: number): number {
  const n = numero(valor);
  if (n === null || !(maximo > 0)) return 0;
  return Math.max(0, Math.min(1, n / maximo));
}

/**
 * Dinheiro curto, como se fala na mesa: "R$ 74 mil", "R$ 27,2 mil", "R$ 1,1 mi",
 * "R$ 950". Nulo é "—".
 */
export function dinheiroCurto(valor: unknown): string {
  const n = numero(valor);
  if (n === null) return '—';
  const sinal = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 999_950) return `${sinal}R$ ${decimalEnxuto(a / 1_000_000)} mi`;
  if (a >= 999.5) return `${sinal}R$ ${decimalEnxuto(a / 1_000)} mil`;
  return `${sinal}R$ ${Math.round(a)}`;
}

/** Reais inteiros, por extenso: "R$ 2.400". */
export function reais(valor: unknown): string {
  const n = numero(valor);
  return n === null ? '—' : espacos(REAIS_INTEIROS.format(n));
}

/** "US$ 0,67". */
export function dolares(valor: unknown): string {
  const n = numero(valor);
  return n === null ? '—' : `US$ ${n.toFixed(2).replace('.', ',')}`;
}

/** O preço do imóvel na lista: "R$ 690 mil", "R$ 2.400/mês" ou os dois. */
export function precoCurto(venda: number | null, aluguel: number | null): string {
  const partes: string[] = [];
  if (numero(venda) !== null && (numero(venda) ?? 0) > 0) partes.push(dinheiroCurto(venda));
  if (numero(aluguel) !== null && (numero(aluguel) ?? 0) > 0) partes.push(`${reais(aluguel)}/mês`);
  return partes.length > 0 ? partes.join(' · ') : 'sem preço';
}

/** Minutos como se fala: "8 min", "1 h 20 min", "2 dias". */
export function minutos(valor: unknown): string {
  const n = numero(valor);
  if (n === null) return '—';
  const m = Math.max(0, Math.round(n));
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) {
    const h = Math.floor(m / 60);
    const resto = m % 60;
    return resto === 0 ? `${h} h` : `${h} h ${resto} min`;
  }
  const dias = Math.round(m / (60 * 24));
  return `${dias} ${plural(dias, 'dia', 'dias')}`;
}

/** Horas (o tempo entre etapas): "6 min", "5 h", "3,5 dias". */
export function horas(valor: unknown): string {
  const n = numero(valor);
  if (n === null) return '—';
  if (n < 1) return `${Math.max(0, Math.round(n * 60))} min`;
  if (n < 24) return `${decimalEnxuto(n)} h`;
  const dias = n / 24;
  return `${decimalEnxuto(dias)} ${Math.round(dias * 10) === 10 ? 'dia' : 'dias'}`;
}

/** "21 dias", "1 dia". */
export function dias(valor: unknown): string {
  const n = numero(valor);
  if (n === null) return '—';
  const d = Math.round(n);
  return `${d} ${plural(d, 'dia', 'dias')}`;
}

// ---------------------------------------------------------------------------
// Datas, no fuso de Natal
// ---------------------------------------------------------------------------

function instante(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** O dia civil de Natal (`AAAA-MM-DD`) de um instante ou de um dia já civil. */
export function diaCivil(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = instante(iso);
  return d ? DIA_CIVIL.format(d) : null;
}

/** "09/11". */
export function diaMes(iso: string | null | undefined): string {
  const dia = diaCivil(iso);
  return dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : '';
}

/** "09/11/2026". */
export function diaMesAno(iso: string | null | undefined): string {
  const dia = diaCivil(iso);
  return dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}` : '';
}

/** "09:40", na hora de Natal. */
export function horaEmNatal(iso: string | null | undefined): string {
  const d = instante(iso);
  return d ? HORA.format(d) : '';
}

/** "Novembro", de `2026-11`. */
export function nomeDoMes(mes: string | null | undefined): string {
  const m = mes && /^\d{4}-\d{2}/.test(mes) ? Number(mes.slice(5, 7)) : NaN;
  return MESES[m - 1] ?? 'Este mês';
}

/** O último dia do mês `AAAA-MM`, como "30/11". */
export function fimDoMes(mes: string | null | undefined): string {
  if (!mes || !/^\d{4}-\d{2}/.test(mes)) return '';
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return `${String(ultimo).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

function diasEntre(deDia: string, ateDia: string): number {
  return Math.round((Date.parse(`${ateDia}T00:00:00Z`) - Date.parse(`${deDia}T00:00:00Z`)) / 86_400_000);
}

/**
 * Há quanto tempo, curto e com os minutos que importam na fila: "há 55 min",
 * "há 1 h 40", "ontem", "há 4 dias". "Ontem" é o dia civil de Natal.
 */
export function haQuantoCurto(iso: string | null | undefined, agora: Date = new Date()): string {
  const d = instante(iso);
  if (!d) return '';
  const min = Math.floor((agora.getTime() - d.getTime()) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const diasCivis = diasEntre(DIA_CIVIL.format(d), DIA_CIVIL.format(agora));
  if (diasCivis <= 0 || min < 12 * 60) {
    const h = Math.floor(min / 60);
    const resto = min % 60;
    return resto === 0 ? `há ${h} h` : `há ${h} h ${String(resto).padStart(2, '0')}`;
  }
  if (diasCivis === 1) return 'ontem';
  return `há ${diasCivis} dias`;
}

/** A semana (pelo seu primeiro dia) em que cai uma data; -1 antes da primeira. */
export function indiceDaSemana(inicios: readonly string[], data: string | null | undefined): number {
  const dia = diaCivil(data);
  if (!dia || inicios.length === 0) return -1;
  let achado = -1;
  inicios.forEach((inicio, i) => {
    const d = diaCivil(inicio);
    if (d && d <= dia) achado = i;
  });
  return achado;
}

// ---------------------------------------------------------------------------
// Delta contra o período anterior
// ---------------------------------------------------------------------------

export type Tom = 'bom' | 'ruim' | 'neutro';

export type Delta = {
  /** "▲ 23%", "▼ 8 min", "= igual". */
  texto: string;
  tom: Tom;
  /** A mesma coisa por extenso, para o leitor de tela: "subiu 23%, melhor". */
  leitura: string;
};

export type JeitoDoDelta = 'contagem' | 'pontos' | 'minutos' | 'dias' | 'dinheiro' | 'nota' | 'dolar';

/**
 * O delta de um indicador. Contagem com base de 10 ou mais vira porcentagem ("▲ 23%");
 * abaixo disso, a diferença absoluta ("▲ 3"), porque 2 contra 1 não é "+100%" para
 * ninguém. Taxa (0 a 100) vira pontos percentuais. `menorEMelhor` inverte o bom e o
 * ruim (primeira resposta, ciclo, custo, comissão parada).
 */
export function deltaDe(
  agora: unknown,
  antes: unknown,
  jeito: JeitoDoDelta,
  { menorEMelhor = false }: { menorEMelhor?: boolean } = {},
): Delta | null {
  const a = numero(agora);
  const b = numero(antes);
  if (a === null || b === null) return null;
  const diff = a - b;

  let valor: string;
  let zero: boolean;
  let quaseZero = false;
  switch (jeito) {
    case 'contagem': {
      if (b >= 10) {
        const rel = Math.round((diff / b) * 100);
        valor = `${Math.abs(rel)}%`;
        zero = rel === 0;
        quaseZero = Math.abs(rel) < 3;
      } else {
        valor = inteiro(Math.abs(diff));
        zero = Math.round(diff) === 0;
      }
      break;
    }
    case 'pontos': {
      const p = Math.round(diff);
      valor = `${Math.abs(p)} p.p.`;
      zero = p === 0;
      quaseZero = Math.abs(p) < 2;
      break;
    }
    case 'minutos':
      valor = minutos(Math.abs(diff));
      zero = Math.round(diff) === 0;
      break;
    case 'dias':
      valor = dias(Math.abs(diff));
      zero = Math.round(diff) === 0;
      break;
    case 'dinheiro':
      valor = dinheiroCurto(Math.abs(diff));
      zero = Math.round(diff) === 0;
      break;
    case 'nota':
      valor = decimalFixo(Math.abs(diff));
      zero = Math.round(diff * 10) === 0;
      break;
    case 'dolar':
      valor = dolares(Math.abs(diff));
      zero = Math.round(diff * 100) === 0;
      break;
  }

  if (zero) return { texto: '= igual', tom: 'neutro', leitura: 'igual ao período anterior' };
  const subiu = diff > 0;
  const melhor = subiu !== menorEMelhor;
  const tom: Tom = quaseZero ? 'neutro' : melhor ? 'bom' : 'ruim';
  const juizo = tom === 'neutro' ? 'estável' : melhor ? 'melhor' : 'pior';
  return {
    texto: `${subiu ? '▲' : '▼'} ${valor}`,
    tom,
    leitura: `${subiu ? 'subiu' : 'caiu'} ${valor}, ${juizo}`,
  };
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

export const SITUACOES_EM_ORDEM: readonly SituacaoParada[] = [
  'esperando',
  'promessa',
  'proposta',
  'visita',
  'combina',
  'esfriando',
];

const SITUACAO: Record<SituacaoParada, { longo: string; curto: string }> = {
  esperando: { longo: 'Quente esperando resposta', curto: 'Esperando resposta' },
  promessa: { longo: 'A equipe prometeu e o prazo venceu', curto: 'Promessa vencida' },
  proposta: { longo: 'Proposta sem resposta há 3 dias ou mais', curto: 'Proposta parada' },
  visita: { longo: 'Visitou e ninguém voltou a falar', curto: 'Visitou sem retorno' },
  combina: { longo: 'Combina com um imóvel e não recebeu', curto: 'Combina com imóvel' },
  esfriando: { longo: 'Esfriando: era quente e parou de responder', curto: 'Esfriando' },
};

export function rotuloDaSituacao(s: SituacaoParada, jeito: 'longo' | 'curto' = 'curto'): string {
  return SITUACAO[s]?.[jeito] ?? String(s);
}

/** As duas situações que não podem esperar: o cliente quente sem resposta e a promessa vencida. */
export function situacaoUrgente(s: SituacaoParada): boolean {
  return s === 'esperando' || s === 'promessa';
}

/** Desde quando, do jeito de cada situação: "há 1 h 40", "venceu ontem", "6 dias sem responder". */
export function tempoDaSituacao(
  s: SituacaoParada,
  desde: string | null | undefined,
  agora: Date = new Date(),
): string {
  if (!desde) return '';
  const ha = haQuantoCurto(desde, agora);
  if (!ha) return '';
  switch (s) {
    case 'promessa':
      return ha === 'agora' ? 'venceu agora' : `venceu ${ha === 'ontem' ? 'ontem' : ha}`;
    case 'esfriando': {
      const d = diaCivil(desde);
      const n = d ? diasEntre(d, DIA_CIVIL.format(agora)) : 0;
      return n >= 1 ? `${n} ${plural(n, 'dia', 'dias')} sem responder` : 'sem responder desde hoje';
    }
    case 'combina':
      return `desde ${diaMes(desde)}`;
    default:
      return ha;
  }
}

const LACUNA: Record<LacunaDaIA, string> = {
  condominio_iptu: 'Não sabia o condomínio ou o IPTU',
  financiamento: 'Resposta genérica sobre financiamento',
  fotos: 'Não mandou fotos quando pediram',
  demorou_visita: 'Demorou para oferecer visita',
  passou_sem_precisar: 'Passou para a equipe sem precisar',
  nao_sabia_do_imovel: 'Não sabia os dados do imóvel',
  tom: 'O tom não foi o da equipe',
  outra: 'Outras falhas',
};

export function rotuloDaLacuna(l: LacunaDaIA): string {
  return LACUNA[l] ?? String(l);
}

/**
 * O que fazer com cada lacuna. Cada caminho existe no CRM: o anúncio (Anúncios), o
 * caderno da IA ("IA, anota: ...") e a conversa do treino.
 */
const CORRIGIR_LACUNA: Record<LacunaDaIA, string> = {
  condominio_iptu: 'Preencher condomínio e IPTU nos anúncios que não têm.',
  financiamento: 'Ensinar no caderno da IA as regras de financiamento e FGTS da Imova.',
  fotos: 'Conferir se cada anúncio tem as fotos que a IA pode mandar.',
  demorou_visita: 'No treino, mostrar à IA quando oferecer a visita.',
  passou_sem_precisar: 'Ensinar no caderno da IA o que ela pode responder sozinha.',
  nao_sabia_do_imovel: 'Completar a descrição do anúncio com o que os clientes perguntam.',
  tom: 'Corrigir no treino as respostas com o tom errado.',
  outra: 'Ler as conversas avaliadas para entender a falha.',
};

export function comoCorrigirLacuna(l: LacunaDaIA): string | null {
  return CORRIGIR_LACUNA[l] ?? null;
}

/**
 * O que cada versão da IA que atende mudou, no texto que o time entende. Versão nova
 * sem linha aqui aparece só com o efeito medido.
 */
const O_QUE_MUDOU: Record<string, string> = {
  'atendente-imova@v1':
    'Responde sozinha, assina “Imova” e passa para um corretor quando pedem visita, proposta ou ligação.',
  'atendente-imova@v2':
    'Fala como a equipe, não puxa assunto velho, reconhece a foto do anúncio que o cliente manda e conhece os dados de cada imóvel.',
};

export function oQueMudouNaVersao(versao: string | null | undefined): string | null {
  return versao ? (O_QUE_MUDOU[versao] ?? null) : null;
}

const FAIXA_DE_RESPOSTA: Record<FaixaDeResposta, string> = {
  ate_5: 'até 5 min',
  '5_15': '5–15 min',
  '15_60': '15–60 min',
  '1_4h': '1–4 h',
  mais_4h: '+ de 4 h',
};

export const FAIXAS_DE_RESPOSTA: readonly FaixaDeResposta[] = ['ate_5', '5_15', '15_60', '1_4h', 'mais_4h'];

export function rotuloDaFaixaDeResposta(f: FaixaDeResposta): string {
  return FAIXA_DE_RESPOSTA[f] ?? String(f);
}

const FAIXA_DE_PASSAGEM: Record<FaixaDePassagem, string> = {
  ate_15: 'até 15 min',
  '15_60': '15 a 60 min',
  '1_2h': '1 a 2 h',
  mais_2h: 'mais de 2 h',
  sem_resposta: 'sem resposta',
};

export const FAIXAS_DE_PASSAGEM: readonly FaixaDePassagem[] = [
  'ate_15',
  '15_60',
  '1_2h',
  'mais_2h',
  'sem_resposta',
];

export function rotuloDaFaixaDePassagem(f: FaixaDePassagem): string {
  return FAIXA_DE_PASSAGEM[f] ?? String(f);
}

const CAMPO: Record<CampoQueVende, { rotulo: string; naFrase: string }> = {
  valor_maximo: { rotulo: 'Orçamento', naFrase: 'o orçamento' },
  forma_pagamento: { rotulo: 'Forma de pagamento', naFrase: 'a forma de pagamento' },
  prazo_mudanca: { rotulo: 'Prazo para mudar', naFrase: 'o prazo para mudar' },
  decide_com: { rotulo: 'Quem decide junto', naFrase: 'quem decide junto' },
  bairros: { rotulo: 'Bairro', naFrase: 'o bairro' },
};

export function rotuloDoCampo(c: CampoQueVende, jeito: 'rotulo' | 'naFrase' = 'rotulo'): string {
  return CAMPO[c]?.[jeito] ?? String(c);
}

const NIVEL: Record<NivelDeInteresse, string> = {
  muito: 'muito interessado',
  interessado: 'interessado',
  morno: 'morno',
};

export function rotuloDoNivel(n: NivelDeInteresse | null | undefined): string {
  return n ? (NIVEL[n] ?? String(n)) : 'sem leitura';
}

/** O filtro de tipo da lista de Imóveis. `outro` só aparece em "Todos". */
export type FiltroDeTipo = 'todos' | Exclude<TipoDeImovel, 'outro'>;

export const FILTROS_DE_TIPO: readonly { chave: FiltroDeTipo; rotulo: string }[] = [
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'apartamento', rotulo: 'Apartamentos' },
  { chave: 'casa', rotulo: 'Casas' },
  { chave: 'terreno', rotulo: 'Terrenos' },
  { chave: 'comercial', rotulo: 'Comercial' },
];

/** "atendente-imova@v2" vira "v2". */
export function versaoCurta(versao: string | null | undefined): string {
  if (!versao) return '';
  const depois = versao.includes('@') ? versao.slice(versao.lastIndexOf('@') + 1) : versao;
  return depois || versao;
}

/** O que mais travou: "Sem orçamento (41%) · imóvel não servia (27%)". */
export function textoDaTrava(trava: readonly { motivo: string; pct: number }[] | null | undefined): string {
  return lista(trava)
    .slice(0, 2)
    .map((t, i) => {
      const motivo = i === 0 ? t.motivo : t.motivo.charAt(0).toLowerCase() + t.motivo.slice(1);
      return `${motivo} (${pct(t.pct)})`;
    })
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Ordem e escolhas de exibição
// ---------------------------------------------------------------------------

export type OrdemDosImoveis = 'total' | 'muito';

/** "Mais leads" ou "Mais quentes"; empate vai para o outro critério. */
export function ordenarImoveis(
  imoveis: readonly LinhaImovel[],
  ordem: OrdemDosImoveis,
): LinhaImovel[] {
  return [...imoveis].sort((a, b) =>
    ordem === 'muito'
      ? contagem(b.muito) - contagem(a.muito) || contagem(b.total) - contagem(a.total)
      : contagem(b.total) - contagem(a.total) || contagem(b.muito) - contagem(a.muito),
  );
}

export function filtrarImoveis(imoveis: readonly LinhaImovel[], filtro: FiltroDeTipo): LinhaImovel[] {
  return filtro === 'todos' ? [...imoveis] : imoveis.filter((m) => m.tipo === filtro);
}

/** O mais procurado: mais leads, desempate por mais muito interessados. Nulo se ninguém. */
export function maisProcurado(imoveis: readonly LinhaImovel[]): LinhaImovel | null {
  const primeiro = ordenarImoveis(imoveis, 'total')[0];
  return primeiro && contagem(primeiro.total) > 0 ? primeiro : null;
}

/**
 * A fila na ordem de trabalho: primeiro quem espera resposta (o mais antigo antes),
 * depois o maior valor provável. Sem valor conhecido vai para o fim.
 */
export function ordenarFila<
  L extends { situacao: SituacaoParada; desde: string | null; valor: number | null },
>(fila: readonly L[]): L[] {
  const espera = (l: L) => (l.situacao === 'esperando' ? 1 : 0);
  return [...fila].sort((a, b) => {
    const ea = espera(a);
    const eb = espera(b);
    if (ea !== eb) return eb - ea;
    if (ea === 1) return (a.desde ?? '9999').localeCompare(b.desde ?? '9999');
    return (numero(b.valor) ?? -1) - (numero(a.valor) ?? -1);
  });
}

/** Abaixo disto a passagem é amostra pequena demais para ser "o gargalo" (1 → 0 é 0%). */
export const MINIMO_PARA_GARGALO = 5;

/**
 * O gargalo: a passagem com a menor taxa; empate vai para a que perdeu mais gente.
 * Só disputa a passagem cuja etapa anterior tem pelo menos `MINIMO_PARA_GARGALO`
 * leads; se nenhuma tem, vale qualquer uma com gente.
 */
export function gargaloDoFunil(
  etapas: readonly { etapa: string; leads: number }[],
): { indice: number; taxa: number; perdidos: number } | null {
  const comAmostra = etapas.some((e, i) => i < etapas.length - 1 && contagem(e.leads) >= MINIMO_PARA_GARGALO);
  const piso = comAmostra ? MINIMO_PARA_GARGALO : 1;
  let melhor: { indice: number; taxa: number; perdidos: number } | null = null;
  etapas.forEach((e, i) => {
    const anterior = etapas[i - 1];
    if (i === 0 || !anterior || contagem(anterior.leads) < piso) return;
    const taxa = Math.round((contagem(e.leads) / contagem(anterior.leads)) * 100);
    const perdidos = Math.max(0, contagem(anterior.leads) - contagem(e.leads));
    if (!melhor || taxa < melhor.taxa || (taxa === melhor.taxa && perdidos > melhor.perdidos)) {
      melhor = { indice: i, taxa, perdidos };
    }
  });
  return melhor;
}

/** O que a sugestão vale, no número grande, e o complemento embaixo. */
export function impactoDaSugestao(s: Pick<Sugestao, 'impacto_valor' | 'impacto_tipo' | 'unidade'>): {
  numero: string;
  unidade: string;
} {
  const n = contagem(s.impacto_valor);
  switch (s.impacto_tipo) {
    case 'reais':
      return { numero: dinheiroCurto(s.impacto_valor), unidade: s.unidade };
    case 'leads':
      return { numero: contar(n, 'lead', 'leads'), unidade: s.unidade };
    case 'compradores':
      return { numero: contar(n, 'comprador', 'compradores'), unidade: s.unidade };
    case 'visitas':
      return { numero: contar(n, 'visita', 'visitas'), unidade: s.unidade };
    default:
      return { numero: inteiro(n), unidade: s.unidade };
  }
}

/** "4 muito interessados · 9 interessados · 10 mornos" (a dica da barra de interesse). */
export function textoDoInteresse(m: { muito: number; interessado: number; morno: number }): string {
  return [
    contar(contagem(m.muito), 'muito interessado', 'muito interessados'),
    contar(contagem(m.interessado), 'interessado', 'interessados'),
    contar(contagem(m.morno), 'morno', 'mornos'),
  ].join(' · ');
}

/** A média do time (de quem tem número), para o traço dos múltiplos pequenos. */
export function media(valores: readonly (number | null | undefined)[]): number | null {
  const bons = valores.map(numero).filter((v): v is number => v !== null);
  return bons.length > 0 ? bons.reduce((s, v) => s + v, 0) / bons.length : null;
}

/** Visita que vira proposta no time todo: propostas ÷ visitas feitas. */
export function visitaPropostaDoTime(equipe: readonly LinhaPessoaVende[]): number | null {
  const visitas = equipe.reduce((s, p) => s + contagem(p.visitas_feitas), 0);
  const propostas = equipe.reduce((s, p) => s + contagem(p.propostas), 0);
  return parteDe(propostas, visitas);
}

// ---------------------------------------------------------------------------
// Meta e previsão
// ---------------------------------------------------------------------------

/** "4 ou 5" (de 4,4), "4" (de 4,0). */
export function faixaDeNegocios(esperado: unknown): string {
  const e = numero(esperado);
  if (e === null) return '—';
  const baixo = Math.floor(e + 1e-9);
  const alto = Math.ceil(e - 1e-9);
  return baixo === alto ? inteiro(baixo) : `${inteiro(baixo)} ou ${inteiro(alto)}`;
}

/** Quantos negócios faltam para a meta pela previsão; nulo sem meta. */
export function faltamParaAMeta(previsao: Pick<Previsao, 'esperado'>, meta: number | null): number | null {
  const m = numero(meta);
  if (m === null) return null;
  return Math.max(0, Math.ceil(m - (numero(previsao.esperado) ?? 0) - 1e-9));
}

export type ContaDaMeta = {
  faltam: number;
  /** Visitas feitas a mais, pelo ritmo de visitas por negócio. */
  visitasFeitas: number | null;
  /** Visitas marcadas a mais, pelo comparecimento. */
  visitasMarcadas: number | null;
  /** Visitas marcadas a mais por semana até o fim do mês. */
  porSemana: number | null;
  semanasRestantes: number;
};

/**
 * A conta de trás para a frente: faltam N negócios; cada negócio pede V visitas
 * feitas; de cada visita marcada, C% acontecem. Nulo quando não há meta ou quando a
 * previsão já passa dela.
 */
export function contaDaMeta(previsao: Previsao, meta: number | null): ContaDaMeta | null {
  const faltam = faltamParaAMeta(previsao, meta);
  if (faltam === null || faltam === 0) return null;
  const porNegocio = numero(previsao.ritmo?.visitas_por_negocio);
  const comparecimento = numero(previsao.ritmo?.comparecimento);
  const visitasFeitas = porNegocio !== null && porNegocio > 0 ? Math.ceil(faltam * porNegocio) : null;
  const visitasMarcadas =
    visitasFeitas !== null && comparecimento !== null && comparecimento > 0
      ? Math.ceil(visitasFeitas / comparecimento)
      : null;
  const semanasRestantes = Math.max(1, Math.ceil(contagem(previsao.dias_restantes) / 7));
  return {
    faltam,
    visitasFeitas,
    visitasMarcadas,
    porSemana: visitasMarcadas !== null ? Math.ceil(visitasMarcadas / semanasRestantes) : null,
    semanasRestantes,
  };
}

/** "Novembro deve fechar 4 ou 5; faltam 2 para a meta de 6". */
export function tituloDaPrevisao(previsao: Previsao | null | undefined, meta: number | null): string {
  if (!previsao) return 'A previsão do mês ainda não tem dado';
  const mes = nomeDoMes(previsao.mes);
  const fechados = contagem(previsao.fechados);
  const m = numero(meta);
  const faixa = faixaDeNegocios(previsao.esperado);
  const alto = Math.ceil((numero(previsao.esperado) ?? 0) - 1e-9);
  const negocios = plural(alto, 'negócio', 'negócios');
  if ((numero(previsao.esperado) ?? 0) <= 0 && fechados === 0) {
    return `${mes} ainda não tem negócio previsto`;
  }
  if (m === null) return `${mes} deve fechar ${faixa} ${negocios}`;
  if (fechados >= m) return `${mes} já bateu a meta de ${inteiro(m)}`;
  const faltam = faltamParaAMeta(previsao, m) ?? 0;
  if (faltam === 0) return `${mes} deve passar da meta de ${inteiro(m)}: previsão de ${faixa} ${negocios}`;
  return `${mes} deve fechar ${faixa}; faltam ${contar(faltam, 'negócio', 'negócios')} para a meta de ${inteiro(m)}`;
}

/** "Os 5 negócios em “Proposta” são 43% da previsão". */
export function tituloDaPrevisaoPorEtapa(porEtapa: readonly Previsao['por_etapa'][number][] | null | undefined): string {
  const linhas = lista(porEtapa);
  const total = linhas.reduce((s, e) => s + Math.max(0, numero(e.esperado) ?? 0), 0);
  if (total <= 0) return 'Nenhum negócio aberto conta para a previsão';
  const topo = [...linhas].sort((a, b) => (numero(b.esperado) ?? 0) - (numero(a.esperado) ?? 0))[0];
  if (!topo) return 'Nenhum negócio aberto conta para a previsão';
  const parte = parteDe(numero(topo.esperado) ?? 0, total) ?? 0;
  const abertos = contagem(topo.abertos);
  return `${abertos === 1 ? 'O negócio' : `Os ${inteiro(abertos)} negócios`} em “${topo.etapa}” ${abertos === 1 ? 'é' : 'são'} ${parte}% da previsão`;
}

// ---------------------------------------------------------------------------
// Frases-título: a conclusão de cada gráfico, com os números que chegaram
// ---------------------------------------------------------------------------

/** "Apto 3 quartos · Ponta Negra (IM-0429) é o mais procurado: 23 leads". */
export function tituloDoMaisProcurado(imoveis: readonly LinhaImovel[]): string {
  const topo = maisProcurado(imoveis);
  if (!topo) return 'Nenhum imóvel teve lead interessado no período';
  return `${encurtar(topo.titulo)} (${topo.codigo}) é o mais procurado: ${contar(contagem(topo.total), 'lead', 'leads')}`;
}

export function tituloDoRanking(imoveis: readonly LinhaImovel[], ordem: OrdemDosImoveis): string {
  if (ordem === 'muito') {
    const topo = ordenarImoveis(imoveis, 'muito')[0];
    if (!topo || contagem(topo.muito) === 0) return 'Nenhum imóvel tem lead muito interessado';
    const n = contagem(topo.muito);
    return `Mais quentes: o ${topo.codigo} tem ${contar(n, 'lead muito interessado', 'leads muito interessados')}`;
  }
  const topo = maisProcurado(imoveis);
  if (!topo) return 'Nenhum imóvel teve lead interessado no período';
  return `O mais procurado é ${encurtar(topo.titulo)}: ${contar(contagem(topo.total), 'lead', 'leads')}`;
}

/** Visão geral: "O funil perde mais de “Conversaram” para “Visita marcada”: só 32% passam". */
export function tituloDoFunilCurto(etapas: readonly { etapa: string; leads: number }[]): string {
  const g = gargaloDoFunil(etapas);
  const anterior = g ? etapas[g.indice - 1] : undefined;
  const etapa = g ? etapas[g.indice] : undefined;
  if (!g || !anterior || !etapa) {
    return etapas.some((e) => contagem(e.leads) > 0)
      ? 'Leads do período em cada etapa'
      : 'Nenhum lead passou pelo funil no período';
  }
  return g.taxa === 0
    ? `O funil perde mais de “${anterior.etapa}” para “${etapa.etapa}”: ninguém passou`
    : `O funil perde mais de “${anterior.etapa}” para “${etapa.etapa}”: só ${g.taxa}% passam`;
}

/** Funil e equipe: "A maior perda é antes de “Visita marcada”: 65 leads pararam ali". */
export function tituloDoFunilLongo(etapas: readonly { etapa: string; leads: number }[]): string {
  const g = gargaloDoFunil(etapas);
  const etapa = g ? etapas[g.indice] : undefined;
  if (!g || !etapa) {
    return etapas.some((e) => contagem(e.leads) > 0)
      ? 'Leads do período em cada etapa'
      : 'Nenhum lead passou pelo funil no período';
  }
  return `A maior perda é antes de “${etapa.etapa}”: ${contar(g.perdidos, 'lead parou', 'leads pararam')} ali`;
}

/** "R$ 74 mil de comissão provável parada em 38 leads". */
export function tituloDaMesa(valor: unknown, leads: unknown): string {
  const n = contagem(leads);
  if (n === 0) return 'Nenhum lead com chance de negócio está parado agora';
  const v = numero(valor);
  if (v === null || v <= 0) return `${contar(n, 'lead parado', 'leads parados')}, sem valor conhecido`;
  return `${dinheiroCurto(v)} de comissão provável parada em ${contar(n, 'lead', 'leads')}`;
}

/** "61% do valor parado está em “Proposta parada” e “Visitou sem retorno”". */
export function tituloDasSituacoes(situacoes: readonly LinhaSituacao[]): string {
  const total = situacoes.reduce((s, x) => s + Math.max(0, numero(x.valor) ?? 0), 0);
  const leads = situacoes.reduce((s, x) => s + contagem(x.leads), 0);
  if (leads === 0) return 'Nada parado agora';
  if (total <= 0) return 'Leads parados por situação';
  const ordem = [...situacoes].sort((a, b) => (numero(b.valor) ?? 0) - (numero(a.valor) ?? 0));
  const [a, b] = ordem;
  if (!a) return 'Leads parados por situação';
  const pa = parteDe(numero(a.valor) ?? 0, total) ?? 0;
  if (pa >= 50 || !b || (numero(b.valor) ?? 0) <= 0) {
    return `${pa}% do valor parado está em “${rotuloDaSituacao(a.situacao)}”`;
  }
  const pab = parteDe((numero(a.valor) ?? 0) + (numero(b.valor) ?? 0), total) ?? 0;
  return `${pab}% do valor parado está em “${rotuloDaSituacao(a.situacao)}” e “${rotuloDaSituacao(b.situacao)}”`;
}

/** "7 leads parados estão sem dono", ou quem tem o maior valor parado. */
export function tituloDosDonos(donos: readonly { dono: string | null; leads: number; valor: number }[]): string {
  const sem = donos.find((d) => d.dono === null && contagem(d.leads) > 0);
  if (sem) {
    const n = contagem(sem.leads);
    return `${n === 1 ? '1 lead parado está' : `${inteiro(n)} leads parados estão`} sem dono`;
  }
  const topo = [...donos]
    .filter((d) => contagem(d.leads) > 0)
    .sort((a, b) => (numero(b.valor) ?? 0) - (numero(a.valor) ?? 0))[0];
  if (!topo) return 'Ninguém tem lead parado agora';
  return `${topo.dono ?? 'Sem dono'} tem o maior valor parado: ${dinheiroCurto(topo.valor)}`;
}

/** "A nota da IA subiu de 3,4 para 4,3". */
export function tituloDaNotaDaIA(notas: readonly { nota: number | null }[]): string {
  const validas = notas.map((n) => numero(n.nota)).filter((n): n is number => n !== null);
  const primeira = validas[0];
  const ultima = validas[validas.length - 1];
  if (primeira === undefined || ultima === undefined) return 'A IA ainda não tem nota da avaliação diária';
  if (validas.length === 1) return `A nota média da IA está em ${decimalFixo(ultima)}`;
  const d = Math.round((ultima - primeira) * 10);
  if (d > 0) return `A nota da IA subiu de ${decimalFixo(primeira)} para ${decimalFixo(ultima)}`;
  if (d < 0) return `A nota da IA caiu de ${decimalFixo(primeira)} para ${decimalFixo(ultima)}`;
  return `A nota da IA está estável em ${decimalFixo(ultima)}`;
}

/** "Respondido em até 5 minutos, o lead marca visita 5 vezes mais do que depois de 4 horas". */
export function tituloDaVelocidade(
  velocidade: readonly { faixa: FaixaDeResposta; leads: number; visitas: number }[],
): string {
  const taxa = (f: FaixaDeResposta) => {
    const l = velocidade.find((v) => v.faixa === f);
    return l && contagem(l.leads) > 0 ? contagem(l.visitas) / contagem(l.leads) : null;
  };
  const rapido = taxa('ate_5');
  const lento = taxa('mais_4h');
  if (rapido === null || lento === null) return 'Quanto marcou visita, pela demora da primeira resposta';
  if (lento === 0 && rapido > 0) {
    return `Respondido em até 5 minutos, ${Math.round(rapido * 100)}% marcam visita; depois de 4 horas, nenhum`;
  }
  if (lento > 0 && rapido / lento >= 1.5) {
    return `Respondido em até 5 minutos, o lead marca visita ${vezes(rapido / lento)} mais do que depois de 4 horas`;
  }
  return 'A demora da primeira resposta não mudou a chance de visita neste período';
}

/** "2 vezes", "1,6 vez", "5 vezes". */
export function vezes(razao: number): string {
  if (razao < 2) return `${decimalEnxuto(razao)} ${Math.round(razao * 10) === 10 ? 'vez' : 'vezes'}`;
  return `${Math.round(razao)} vezes`;
}

/** "Saber o orçamento triplica a chance de visita". */
export function tituloDasPerguntas(
  perguntas: readonly { campo: CampoQueVende; sabe_pct: number | null; nao_sabe_pct: number | null }[],
): string {
  let melhor: { campo: CampoQueVende; razao: number } | null = null;
  for (const p of perguntas) {
    const sabe = numero(p.sabe_pct);
    const nao = numero(p.nao_sabe_pct);
    if (sabe === null || nao === null || nao <= 0) continue;
    const razao = sabe / nao;
    if (!melhor || razao > melhor.razao) melhor = { campo: p.campo, razao };
  }
  if (!melhor || melhor.razao < 1.5) return 'Quanto marcou visita: quem já disse e quem ainda não disse';
  const campo = rotuloDoCampo(melhor.campo, 'naFrase');
  const perto = (alvo: number) => Math.abs((melhor?.razao ?? 0) - alvo) < 0.15;
  const verbo = perto(2) ? 'dobra' : perto(3) ? 'triplica' : `multiplica por ${decimalEnxuto(melhor.razao)}`;
  return `Saber ${campo} ${verbo} a chance de visita`;
}

/** "Preço é a objeção que mais aparece; financiamento é a que mais se resolve". */
export function tituloDasObjecoes(
  objecoes: readonly { objecao: string; leads: number; visitaram_pct: number | null }[],
): string {
  const comLeads = objecoes.filter((o) => contagem(o.leads) > 0);
  const maisComum = [...comLeads].sort((a, b) => contagem(b.leads) - contagem(a.leads))[0];
  if (!maisComum) return 'Nenhuma objeção no período';
  const candidatas = comLeads.filter((o) => contagem(o.leads) >= 3 && numero(o.visitaram_pct) !== null);
  const resolve = [...(candidatas.length > 0 ? candidatas : comLeads)]
    .filter((o) => numero(o.visitaram_pct) !== null)
    .sort((a, b) => (numero(b.visitaram_pct) ?? 0) - (numero(a.visitaram_pct) ?? 0))[0];
  if (!resolve || (numero(resolve.visitaram_pct) ?? 0) <= 0) {
    return `${maisComum.objecao} é a objeção que mais aparece`;
  }
  if (resolve.objecao === maisComum.objecao) {
    return `${maisComum.objecao} é a objeção que mais aparece e a que mais se resolve`;
  }
  const segunda = resolve.objecao.charAt(0).toLowerCase() + resolve.objecao.slice(1);
  return `${maisComum.objecao} é a objeção que mais aparece; ${segunda} é a que mais se resolve`;
}

/** "Indicação traz 8% dos leads e 25% das vendas". */
export function tituloDosCanais(
  canais: readonly { canal: string; leads_pct: number; vendas_pct: number }[] | null,
): string {
  if (!canais || canais.length === 0) return 'De onde vêm os leads e as vendas';
  const melhor = [...canais]
    .filter((c) => (numero(c.vendas_pct) ?? 0) > 0)
    .sort(
      (a, b) =>
        (numero(b.vendas_pct) ?? 0) - (numero(b.leads_pct) ?? 0) -
        ((numero(a.vendas_pct) ?? 0) - (numero(a.leads_pct) ?? 0)),
    )[0];
  if (!melhor) return 'Nenhum canal fechou negócio ainda';
  return `${melhor.canal} traz ${pct(melhor.leads_pct)} dos leads e ${pct(melhor.vendas_pct)} das vendas`;
}

/** "Equipe: Ana faz proposta em 63% das visitas; a média é 39%". */
export function tituloDaEquipe(equipe: readonly LinhaPessoaVende[]): string {
  const time = visitaPropostaDoTime(equipe);
  const melhor = [...equipe]
    .filter((p) => numero(p.visita_proposta_pct) !== null && contagem(p.visitas_feitas) > 0)
    .sort((a, b) => (numero(b.visita_proposta_pct) ?? 0) - (numero(a.visita_proposta_pct) ?? 0))[0];
  if (!melhor || time === null || (numero(melhor.visita_proposta_pct) ?? 0) <= time) {
    return 'Equipe: os três passos que decidem a venda';
  }
  return `Equipe: ${melhor.nome} faz proposta em ${pct(melhor.visita_proposta_pct)} das visitas; a média é ${time}%`;
}

/** "A mensagem que mais marca visita chega a 46%; a média é 24%". */
export function tituloDasMensagens(
  mensagens: readonly { visitas_pct: number }[],
  mediaPct: number | null,
): string {
  const topo = [...mensagens].sort((a, b) => (numero(b.visitas_pct) ?? 0) - (numero(a.visitas_pct) ?? 0))[0];
  if (!topo) return 'As mensagens que mais marcam visita';
  const m = numero(mediaPct);
  if (m === null) return `A mensagem que mais marca visita chega a ${pct(topo.visitas_pct)}`;
  return `A mensagem que mais marca visita chega a ${pct(topo.visitas_pct)}; a média é ${pct(m)}`;
}

type SerieDaNota = 'duvida' | 'informacao' | 'satisfacao';

export const SERIES_DA_NOTA: readonly { chave: SerieDaNota; rotulo: string }[] = [
  { chave: 'duvida', rotulo: 'Tirou a dúvida' },
  { chave: 'informacao', rotulo: 'Informação útil' },
  { chave: 'satisfacao', rotulo: 'Cliente satisfeito' },
];

/** O primeiro e o último valor que existem numa série com buracos. */
export function pontas(valores: readonly (number | null | undefined)[]): { primeiro: number; ultimo: number } | null {
  const bons = valores.map(numero).filter((v): v is number => v !== null);
  const primeiro = bons[0];
  const ultimo = bons[bons.length - 1];
  return primeiro === undefined || ultimo === undefined ? null : { primeiro, ultimo };
}

/** "As três notas subiram; informação útil foi a que mais cresceu". */
export function tituloDasNotas(semanas: readonly SemanaDaIA[]): string {
  const deltas = SERIES_DA_NOTA.map((s) => {
    const p = pontas(semanas.map((w) => w[s.chave]));
    return { rotulo: s.rotulo, p, d: p ? Math.round((p.ultimo - p.primeiro) * 10) / 10 : null };
  }).filter((x) => x.d !== null && x.p !== null);
  if (deltas.length === 0) return 'A avaliação diária ainda não deu nota à IA';
  const subiram = deltas.filter((x) => (x.d ?? 0) > 0);
  const maior = [...deltas].sort((a, b) => (b.d ?? 0) - (a.d ?? 0))[0];
  if (!maior || subiram.length === 0) return 'As notas da avaliação diária, semana a semana';
  const nome = maior.rotulo.charAt(0).toLowerCase() + maior.rotulo.slice(1);
  if (subiram.length === deltas.length && deltas.length === 3) {
    return `As três notas subiram; ${nome} foi a que mais cresceu`;
  }
  return `${maior.rotulo} foi a nota que mais cresceu: ${decimalFixo(maior.p?.primeiro)} → ${decimalFixo(maior.p?.ultimo)}`;
}

/** "O cliente sai da conversa mais interessado: 18% no começo, 31% agora". */
export function tituloDoInteresse(semanas: readonly SemanaDaIA[]): string {
  const p = pontas(semanas.map((s) => s.subiu_pct));
  if (!p) return 'O interesse antes e depois de cada conversa com a IA';
  if (Math.round(p.ultimo) > Math.round(p.primeiro)) {
    return `O cliente sai da conversa mais interessado: ${pct(p.primeiro)} no começo, ${pct(p.ultimo)} agora`;
  }
  return `${pct(p.ultimo)} dos clientes saem da conversa com a IA mais interessados`;
}

/** "Resolve sozinha mais da metade das conversas: 56%". */
export function tituloDasResolvidas(semanas: readonly SemanaDaIA[]): string {
  const p = pontas(semanas.map((s) => s.resolvidas_pct));
  if (!p) return 'Conversas que a IA resolve sozinha';
  return p.ultimo >= 50
    ? `Resolve sozinha mais da metade das conversas: ${pct(p.ultimo)}`
    : `Resolve sozinha ${pct(p.ultimo)} das conversas`;
}

/**
 * "Marcou 4 visitas na última semana completa; começou com 1". A última semana da
 * lista é a corrente (ainda pela metade): a frase lê a anterior a ela.
 */
export function tituloDasVisitasDaIA(semanas: readonly SemanaDaIA[]): string {
  if (semanas.length === 0) return 'Visitas marcadas pela IA';
  if (semanas.length === 1) {
    return `Marcou ${contar(contagem(semanas[0]?.visitas), 'visita', 'visitas')} nesta semana`;
  }
  const completa = contagem(semanas[semanas.length - 2]?.visitas);
  if (semanas.length === 2) {
    return `Marcou ${contar(completa, 'visita', 'visitas')} na primeira semana`;
  }
  const primeiro = contagem(semanas[0]?.visitas);
  const frase = `Marcou ${contar(completa, 'visita', 'visitas')} na última semana completa`;
  return completa === primeiro ? frase : `${frase}; começou com ${inteiro(primeiro)}`;
}

/** "O que ainda falta: “Não sabia o condomínio ou o IPTU” é a maior lacuna". */
export function tituloDasLacunas(lacunas: readonly { lacuna: LacunaDaIA; agora: number }[]): string {
  const topo = [...lacunas].sort((a, b) => contagem(b.agora) - contagem(a.agora))[0];
  if (!topo || contagem(topo.agora) === 0) return 'A avaliação diária não achou falha nas últimas 4 semanas';
  return `O que ainda falta: “${rotuloDaLacuna(topo.lacuna)}” é a maior lacuna`;
}

/** "Onde a IA depende da equipe: 9 de 23 leads passados esperaram mais de 2 horas". */
export function tituloDaPassagem(passagem: readonly { faixa: FaixaDePassagem; leads: number }[]): string {
  const total = passagem.reduce((s, p) => s + contagem(p.leads), 0);
  if (total === 0) return 'A IA não passou nenhuma conversa para a equipe nas últimas 4 semanas';
  const lentos = passagem
    .filter((p) => p.faixa === 'mais_2h' || p.faixa === 'sem_resposta')
    .reduce((s, p) => s + contagem(p.leads), 0);
  if (lentos === 0) return `A equipe respondeu os ${inteiro(total)} leads passados pela IA em até 2 horas`;
  return `Onde a IA depende da equipe: ${inteiro(lentos)} de ${inteiro(total)} leads passados esperaram mais de 2 horas`;
}

/** A frase das 8 semanas do imóvel. */
export function tituloDasSemanasDoImovel(
  semanas: readonly { inicio: string; novos: number }[],
  entrouNoAr: string | null,
): string {
  const n = semanas.map((s) => contagem(s.novos));
  const total = n.reduce((s, v) => s + v, 0);
  if (semanas.length === 0 || total === 0) return 'Nenhum lead novo nas últimas 8 semanas';
  const entrada = indiceDaSemana(
    semanas.map((s) => s.inicio),
    entrouNoAr,
  );
  if (entrouNoAr && entrada >= 0) {
    return `Entrou no ar em ${diaMes(entrouNoAr)} e já tem ${contar(total, 'lead novo', 'leads novos')}`;
  }
  const recentes = n.slice(-2);
  const antes = n.slice(0, -2);
  const mediaRecente = recentes.reduce((s, v) => s + v, 0) / Math.max(1, recentes.length);
  const mediaAntes = antes.length > 0 ? antes.reduce((s, v) => s + v, 0) / antes.length : null;
  if (mediaAntes !== null && mediaAntes > 0 && mediaRecente >= mediaAntes * 1.5) {
    return `O interesse subiu nas últimas 2 semanas: ${decimalEnxuto(mediaRecente)} leads por semana, contra ${decimalEnxuto(mediaAntes)} antes`;
  }
  if (mediaAntes !== null && mediaAntes > 0 && mediaRecente <= mediaAntes * 0.5) {
    return `O interesse caiu nas últimas 2 semanas: ${decimalEnxuto(mediaRecente)} leads por semana, contra ${decimalEnxuto(mediaAntes)} antes`;
  }
  const min = Math.min(...n);
  const max = Math.max(...n);
  return min === max
    ? `Interesse estável: ${contar(max, 'lead novo', 'leads novos')} por semana`
    : `Interesse estável: ${inteiro(min)} a ${inteiro(max)} leads novos por semana`;
}

// ---------------------------------------------------------------------------
// Premissas
// ---------------------------------------------------------------------------

/** "Comissão: 6% na venda · 1 aluguel na locação · Meta: 6 negócios". */
export function textoDasPremissas(p: Premissas | null | undefined): string {
  if (!p) return '';
  const venda = `${decimalEnxuto(p.comissao_venda_pct)}% na venda`;
  const n = numero(p.alugueis_na_locacao) ?? 0;
  const locacao =
    n === 0 ? 'nada na locação' : `${decimalEnxuto(n)} ${n > 0 && n <= 1 ? 'aluguel' : 'aluguéis'} na locação`;
  const meta = numero(p.meta_mes);
  return `Comissão: ${venda} · ${locacao} · Meta: ${meta === null ? 'sem meta' : contar(meta, 'negócio', 'negócios')}`;
}

export type PremissasDigitadas = { comissao: string; alugueis: string; meta: string };

export type LeituraDasPremissas =
  | { ok: true; valor: { comissao_venda_pct: number; alugueis_na_locacao: number; meta_mes: number | null } }
  | { ok: false; erros: Partial<Record<keyof PremissasDigitadas, string>> };

function lerDecimal(texto: string): number | null {
  const limpo = texto.trim().replace(/\s/g, '').replace('%', '').replace(',', '.');
  if (limpo === '' || !/^-?\d+(\.\d+)?$/.test(limpo)) return null;
  return Number(limpo);
}

/**
 * Confere o que foi digitado no "Ajustar": comissão de 0,5% a 20%, de 0 a 3
 * aluguéis, meta vazia (sem meta) ou de 1 a 500 negócios inteiros. Aceita vírgula.
 */
export function lerPremissas(d: PremissasDigitadas): LeituraDasPremissas {
  const erros: Partial<Record<keyof PremissasDigitadas, string>> = {};
  const comissao = lerDecimal(d.comissao);
  if (comissao === null || comissao < 0.5 || comissao > 20) {
    erros.comissao = 'Use um número de 0,5 a 20.';
  }
  const alugueis = lerDecimal(d.alugueis);
  if (alugueis === null || alugueis < 0 || alugueis > 3) {
    erros.alugueis = 'Use um número de 0 a 3.';
  }
  let meta: number | null = null;
  if (d.meta.trim() !== '') {
    const m = lerDecimal(d.meta);
    if (m === null || !Number.isInteger(m) || m < 1 || m > 500) {
      erros.meta = 'Deixe em branco ou use um número inteiro de 1 a 500.';
    } else {
      meta = m;
    }
  }
  if (Object.keys(erros).length > 0 || comissao === null || alugueis === null) return { ok: false, erros };
  return { ok: true, valor: { comissao_venda_pct: comissao, alugueis_na_locacao: alugueis, meta_mes: meta } };
}

/** O que vai para os campos ao abrir o "Ajustar". */
export function premissasParaDigitar(p: Premissas): PremissasDigitadas {
  return {
    comissao: decimalEnxuto(p.comissao_venda_pct, 2),
    alugueis: decimalEnxuto(p.alugueis_na_locacao, 2),
    meta: numero(p.meta_mes) === null ? '' : inteiro(p.meta_mes),
  };
}

/** Os pontos (0 a 100) de uma série com buracos, para a linha em SVG. */
export function pontosDaLinha(
  valores: readonly (number | null | undefined)[],
  [min, max]: readonly [number, number],
): ({ x: number; y: number } | null)[] {
  const n = valores.length;
  const faixa = max - min || 1;
  return valores.map((v, i) => {
    const valor = numero(v);
    if (valor === null) return null;
    const x = n <= 1 ? 50 : (i / (n - 1)) * 100;
    const y = 100 - ((Math.max(min, Math.min(max, valor)) - min) / faixa) * 100;
    return { x, y };
  });
}

/** Os trechos contínuos (sem buraco) de uma série, no formato `points` do SVG. */
export function trechosDaLinha(pontos: readonly ({ x: number; y: number } | null)[]): string[] {
  const trechos: string[] = [];
  let atual: string[] = [];
  for (const p of pontos) {
    if (p) {
      atual.push(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
    } else if (atual.length > 0) {
      trechos.push(atual.join(' '));
      atual = [];
    }
  }
  if (atual.length > 0) trechos.push(atual.join(' '));
  return trechos;
}

/** O teto "redondo" do eixo: 34 → 40, 7 → 10, 0,4 → 1. */
export function tetoRedondo(maximo: number, passo = 10): number {
  if (!(maximo > 0)) return passo;
  return Math.ceil(maximo / passo) * passo;
}
