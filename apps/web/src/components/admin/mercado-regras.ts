/**
 * Ajustes → Inteligência de mercado: as regras sem tela (19/11/2026, só na Imova).
 *
 * O dono da imobiliária libera as fontes e liga a coleta com o próprio login. Aqui
 * mora o que dá para decidir sem React e sem banco: o veredito e a situação de cada
 * fonte em português de gente, o porquê de cada fonte proibida, o motivo sugerido
 * de cada decisão, as recusas do banco em frases claras, a última coleta e a próxima.
 *
 * NENHUM NOME DE PORTAL NA TELA. A decisão do dono (entrevista de 18/11/2026) é zero
 * associação com os grandes portais de anúncios do país. Os dados da auditoria das
 * fontes citam esses portais (no nome de duas fontes, em condições e em motivos);
 * tudo o que vem do banco e vai para a tela passa por `limparTexto`, e as fontes
 * que só fazem sentido com o nome do portal têm o texto da tela escrito aqui. O
 * teste prova que nada com o nome passa.
 */
import { TIMEZONE } from '@komune/schema';

// ---------------------------------------------------------------------------
// O que vem do banco
// ---------------------------------------------------------------------------

export type Veredito = 'PERMITIDA' | 'CONDICIONAL' | 'PROIBIDA';

export type Grupo = 'anuncios' | 'oficiais' | 'obras' | 'proximidades' | 'temporada' | 'lai';

/** Uma linha de `public.mercado_fontes`, só com o que a tela usa. */
export type FonteDeMercado = {
  id: string;
  nome: string;
  grupo: Grupo;
  tipo_de_dado: string | null;
  veredito: Veredito;
  condicoes: string[];
  reconferir: boolean;
  liberada: boolean;
  liberada_por: string | null;
  liberada_em: string | null;
  liberada_motivo: string | null;
  pode_coletar: boolean;
  frequencia: string;
  coletor: string | null;
};

/** O valor de `app_settings['mercado']`. */
export type ChaveDaColeta = {
  ligado?: unknown;
  /** "IA usa as vantagens com clientes" (etapa 6): padrão desligada. */
  ia_clientes?: unknown;
  ia_clientes_mudou_por?: string | null;
  ia_clientes_mudou_em?: string | null;
  ia_clientes_motivo?: string | null;
  mudou_por?: string | null;
  mudou_em?: string | null;
  motivo?: string | null;
};

/** Uma linha de `public.mercado_coletas`, só com o que a tela usa. */
export type Coleta = {
  fonte: string;
  inicio: string;
  fim: string | null;
  situacao: 'rodando' | 'ok' | 'erro';
};

/** A saúde de uma fonte pela conferência da equipe (`public.mercado_saude_fontes`). */
export type SaudeDaFonte = { fonte: string; estado: string | null };

export type DadosDoMercado = {
  chave: ChaveDaColeta | null;
  fontes: FonteDeMercado[];
  coletas: Coleta[];
  saude: SaudeDaFonte[];
  /** A última batida de ponto do robô da coleta (`worker_heartbeats`, worker `mercado`). */
  roboUltimoSinal: string | null;
};

/** Só o texto "true" liga, como `app.mercado_ligado()` no banco. */
export function coletaLigada(chave: ChaveDaColeta | null | undefined): boolean {
  const valor = chave?.ligado;
  return valor === true || valor === 'true';
}

// ---------------------------------------------------------------------------
// Nenhum nome de portal
// ---------------------------------------------------------------------------

/**
 * Os nomes que a tela não mostra, nem como exemplo, em qualquer grafia (com
 * espaço, junto, dentro de endereço: "zapimoveis.com.br", "grupoolx").
 */
const PORTAL = /zap|olx|viva\s*-?\s*real|canal\s*-?\s*pro/i;

export function citaPortal(texto: string | null | undefined): boolean {
  return Boolean(texto && PORTAL.test(texto));
}

/**
 * Trocas de frase para os textos conhecidos da auditoria; o que sobrar com nome de
 * portal sai inteiro (devolve `null`).
 */
const TROCAS: [RegExp, string][] = [
  [/(o\s+)?índice\s+FipeZAP(\s*\(Fipe\))?/gi, 'o índice de preços da Fipe'],
  [/FipeZAP/gi, 'índice de preços da Fipe'],
  [/;?\s*(nunca|nem)\s+de\s+datazap\.com\.br\s+ou\s+de\s+domínio\s+do\s+Grupo\s+OLX/gi, ''],
  [/,\s*planilha pública da Fipe,/gi, ''],
];

export function limparTexto(texto: string | null | undefined): string | null {
  if (!texto) return null;
  let limpo = texto;
  for (const [de, para] of TROCAS) limpo = limpo.replace(de, para);
  limpo = limpo
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([;,.])/g, '$1')
    .trim();
  if (limpo === '' || citaPortal(limpo)) return null;
  return limpo;
}

/**
 * O nome e as condições das fontes que só se explicam pelo portal: a tela diz o
 * que é, sem dizer o nome.
 */
const TEXTO_PROPRIO: Record<string, { nome?: string; condicoes?: string[] }> = {
  'grupo-olx': {
    nome: 'Os grandes portais de anúncios do país e as empresas do grupo deles',
    condicoes: [
      'Nenhum acesso: nenhuma página, nenhum relatório, nenhum endereço deles.',
      'Nenhum login, conta ou senha da Imova é usado; nada sai com o nome da Imova.',
      'O índice de preços da Fipe é baixado só do site da Fipe.',
    ],
  },
  'portais-nacionais': {
    condicoes: [
      'Decisão do dono em 18/11: nenhum portal nacional de anúncios.',
      'Vários também fecham partes do site para robôs.',
    ],
  },
  redecasas: {
    condicoes: [
      'As regras do site proíbem robôs sem autorização. Também é um portal nacional de anúncios.',
    ],
  },
  'fipezap-planilha': {
    nome: 'Índice de preços de imóveis da Fipe (planilha pública)',
  },
};

export function nomeNaTela(fonte: Pick<FonteDeMercado, 'id' | 'nome'>): string {
  return TEXTO_PROPRIO[fonte.id]?.nome ?? limparTexto(fonte.nome) ?? 'Fonte de dados';
}

export function condicoesNaTela(fonte: Pick<FonteDeMercado, 'id' | 'condicoes'>): string[] {
  const proprias = TEXTO_PROPRIO[fonte.id]?.condicoes;
  if (proprias) return proprias;
  return fonte.condicoes.map((c) => limparTexto(c)).filter((c): c is string => c !== null);
}

// ---------------------------------------------------------------------------
// Grupos, veredito e situação
// ---------------------------------------------------------------------------

/** A ordem da tela: o que mais pesa na comparação vem primeiro. */
export const GRUPOS: readonly { id: Grupo; rotulo: string; descricao: string }[] = [
  {
    id: 'anuncios',
    rotulo: 'Anúncios',
    descricao:
      'O preço pedido em sites de outras imobiliárias, para comparar com os nossos imóveis.',
  },
  {
    id: 'oficiais',
    rotulo: 'Índices oficiais',
    descricao: 'Números públicos de preço, crédito e população da região.',
  },
  {
    id: 'obras',
    rotulo: 'Obras',
    descricao: 'Alvarás, obras públicas e atos das prefeituras perto dos nossos imóveis.',
  },
  {
    id: 'proximidades',
    rotulo: 'Proximidades',
    descricao: 'O que fica perto de cada imóvel: praia, escola, mercado, hospital.',
  },
  {
    id: 'temporada',
    rotulo: 'Temporada',
    descricao: 'Diária e ocupação do aluguel por temporada.',
  },
  {
    id: 'lai',
    rotulo: 'Pedidos pela Lei de Acesso',
    descricao:
      'Dados que só saem por pedido formal à prefeitura, como o preço real de venda (ITBI).',
  },
];

/** As fontes de cada grupo, na ordem da tela: as liberadas, as que esperam e as proibidas. */
export function fontesPorGrupo(
  fontes: readonly FonteDeMercado[],
): { grupo: (typeof GRUPOS)[number]; fontes: FonteDeMercado[] }[] {
  const peso = (f: FonteDeMercado) =>
    f.veredito === 'PROIBIDA' ? 3 : f.liberada ? 0 : f.reconferir ? 2 : 1;
  return GRUPOS.map((grupo) => ({
    grupo,
    fontes: fontes
      .filter((f) => f.grupo === grupo.id)
      .sort((a, b) => peso(a) - peso(b) || nomeNaTela(a).localeCompare(nomeNaTela(b), 'pt-BR')),
  })).filter((g) => g.fontes.length > 0);
}

export const ROTULO_DO_VEREDITO: Record<Veredito, string> = {
  PERMITIDA: 'Permitida',
  CONDICIONAL: 'Com condições',
  PROIBIDA: 'Proibida',
};

const DIA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: TIMEZONE,
});

/** "19/11", no horário de Natal. */
export function diaEMes(iso: string): string {
  return DIA.format(new Date(iso));
}

export type Situacao = { texto: string; tom: 'liberada' | 'parada' | 'proibida' };

/**
 * "Liberada por Rafael em 19/11", "Não liberada", "Reconferir antes".
 * `nomeDe` resolve o id da pessoa (o diretório do time já está em memória).
 */
export function situacaoDaFonte(
  fonte: FonteDeMercado,
  nomeDe: (id: string) => string | null,
): Situacao {
  if (fonte.veredito === 'PROIBIDA') return { texto: 'Nunca é acessada', tom: 'proibida' };
  if (fonte.reconferir) return { texto: 'Reconferir antes', tom: 'parada' };
  const quem = fonte.liberada_por ? nomeDe(fonte.liberada_por) : null;
  const quando = fonte.liberada_em ? diaEMes(fonte.liberada_em) : null;
  if (fonte.liberada) {
    if (quem && quando) return { texto: `Liberada por ${quem} em ${quando}`, tom: 'liberada' };
    if (quando) return { texto: `Liberada em ${quando}`, tom: 'liberada' };
    return { texto: 'Liberada', tom: 'liberada' };
  }
  // Recolhida por alguém (a linha guarda a última decisão).
  if (fonte.liberada_por && quando) {
    return { texto: `Recolhida por ${quem ?? 'alguém da equipe'} em ${quando}`, tom: 'parada' };
  }
  return { texto: 'Não liberada', tom: 'parada' };
}

/** A explicação de "Reconferir antes", ao lado do botão desligado. */
export const POR_QUE_RECONFERIR =
  'A auditoria pediu para ler de novo as regras deste site antes de usar. Até isso ser feito, ela não pode ser liberada nem recolhida aqui.';

/** Liberada, mas o robô ainda não sabe ler esta fonte sozinho. */
export function semLeituraAutomatica(fonte: FonteDeMercado): boolean {
  return fonte.veredito !== 'PROIBIDA' && !fonte.coletor;
}

const FREQUENCIA: Record<string, string> = {
  rodada: 'a cada coleta (segunda e quinta)',
  semanal: 'uma vez por semana',
  mensal: 'uma vez por mês',
  bimestral: 'a cada dois meses',
  unica: 'uma vez só',
  manual: 'só à mão',
  sob_demanda: 'só quando precisa',
  nunca: 'nunca',
};

export function rotuloDaFrequencia(frequencia: string): string {
  return FREQUENCIA[frequencia] ?? frequencia;
}

// ---------------------------------------------------------------------------
// O porquê das proibidas
// ---------------------------------------------------------------------------

const ROBO_BARRADO =
  'O site fecha a porta para robôs. Só com autorização por escrito da imobiliária.';
const REGRAS_PROIBEM = 'As regras do site proíbem copiar os anúncios com robô.';
const REGRAS_ILEGIVEIS = 'Não deu para ler as regras do site, e sem ler não se coleta.';

const PORQUE: Record<string, string> = {
  'grupo-olx':
    'Decisão do dono: nenhum dado dos grandes portais de anúncios, nem de nada ligado a eles.',
  'portais-nacionais': 'Decisão do dono: nada de portais nacionais de anúncios.',
  redecasas: 'As regras do site proíbem robôs, e é um portal nacional de anúncios.',
  'chavesnamao-paginas':
    'O site pede que robôs usem a porta própria para máquinas, e não as páginas. Essa porta está na lista acima.',
  deztop: REGRAS_PROIBEM,
  'apto-vc': REGRAS_PROIBEM,
  'peres-e-peres': ROBO_BARRADO,
  'reis-magos': ROBO_BARRADO,
  'viver-imoveis-rn': ROBO_BARRADO,
  'gorett-imobiliaria': ROBO_BARRADO,
  'sinergy-imoveis': ROBO_BARRADO,
  'heloisa-correia-imoveis': ROBO_BARRADO,
  'marizalda-imoveis': ROBO_BARRADO,
  'jj-assessoria': REGRAS_ILEGIVEIS,
  airbnb: 'As regras do site proíbem robôs e a cópia de preços.',
  booking: 'As regras do site proíbem robôs e a cópia de preços.',
  airroi: 'Só pela versão paga: as regras não deixam robô ler as páginas grátis.',
  airdna: REGRAS_ILEGIVEIS,
  airbtics: 'As regras do site não foram encontradas, e os dados grátis são só de demonstração.',
};

/** Por que a fonte é proibida, em uma frase. */
export function porqueDaProibida(fonte: Pick<FonteDeMercado, 'id'>): string {
  return (
    PORQUE[fonte.id] ??
    'A auditoria das fontes proibiu esta: as regras do site não permitem coleta por robô.'
  );
}

// ---------------------------------------------------------------------------
// O botão de cada fonte e o diálogo
// ---------------------------------------------------------------------------

export type BotaoDaFonte =
  | { tipo: 'cadeado' }
  | { tipo: 'liberar' | 'recolher'; desabilitado: boolean; explicacao: string | null };

export function botaoDaFonte(fonte: FonteDeMercado): BotaoDaFonte {
  if (fonte.veredito === 'PROIBIDA') return { tipo: 'cadeado' };
  const tipo = fonte.liberada ? 'recolher' : 'liberar';
  if (fonte.reconferir) return { tipo, desabilitado: true, explicacao: POR_QUE_RECONFERIR };
  return { tipo, desabilitado: false, explicacao: null };
}

/** O motivo que já vem escrito no diálogo (a pessoa pode trocar). */
export function motivoSugerido(fonte: FonteDeMercado, liberar: boolean): string {
  if (!liberar) return 'Prefiro não usar esta fonte por enquanto.';
  if (fonte.veredito === 'CONDICIONAL') {
    return 'Li as condições desta fonte e autorizo a coleta seguindo todas elas.';
  }
  return 'Fonte de dado público; autorizo a coleta.';
}

/** O menor motivo que o banco aceita (`mercado_fonte_liberar` e `mercado_coleta_ligar`). */
export const MOTIVO_MINIMO_DO_MERCADO = 5;

export function problemaDoMotivo(motivo: string): string | null {
  if (motivo.trim().length < MOTIVO_MINIMO_DO_MERCADO) {
    return `Escreva o motivo, com pelo menos ${MOTIVO_MINIMO_DO_MERCADO} letras: é o que explica a decisão para quem vier depois.`;
  }
  return null;
}

/** O que acontece ao liberar ou recolher, para o diálogo contar (nunca "tem certeza?"). */
export function consequenciaDaFonte(
  fonte: FonteDeMercado,
  liberar: boolean,
  coletaLigadaAgora: boolean,
): string[] {
  const nome = nomeNaTela(fonte);
  if (!liberar) {
    return [
      `O robô deixa de ler “${nome}” a partir de agora. O que já foi gravado dela fica para consulta.`,
    ];
  }
  const frases = [
    fonte.veredito === 'CONDICIONAL'
      ? `Na próxima coleta, o robô passa a ler “${nome}”, seguindo as condições desta fonte.`
      : `Na próxima coleta, o robô passa a ler “${nome}”.`,
  ];
  if (!fonte.coletor) {
    frases.push(
      'O robô ainda não sabe ler esta fonte sozinho: a liberação fica registrada e passa a valer quando ele souber.',
    );
  }
  if (!coletaLigadaAgora) {
    frases.push('A coleta está desligada: nada é lido até alguém ligar a coleta, no alto da tela.');
  }
  return frases;
}

/** Os textos do diálogo de ligar e desligar, como o dono pediu. */
export const CONSEQUENCIA_DE_LIGAR =
  'A partir da próxima segunda ou quinta às 6h, o robô lê as fontes liberadas abaixo, devagar e respeitando o robots.txt de cada uma. Nenhum portal proibido é acessado.';
export const CONSEQUENCIA_DE_DESLIGAR =
  'A coleta para na hora; o que já foi gravado fica para consulta.';

export function motivoSugeridoDaColeta(ligar: boolean): string {
  return ligar
    ? 'Conferi as fontes liberadas e autorizo a coleta.'
    : 'Pausa na coleta por enquanto.';
}

// ---------------------------------------------------------------------------
// As recusas do banco
// ---------------------------------------------------------------------------

const RECUSAS: Record<string, string> = {
  motivo_obrigatorio: `Escreva o motivo, com pelo menos ${MOTIVO_MINIMO_DO_MERCADO} letras.`,
  so_imova: 'A coleta de mercado é só da Imova. Neste CRM ela fica sempre desligada.',
  fonte_proibida: 'Esta fonte é proibida e nunca pode ser liberada.',
  fonte_desconhecida: 'Esta fonte não existe mais. Atualize a tela.',
  sem_permissao: 'Só admin e gestor podem mudar isto.',
};

export function fraseDaRecusaDoMercado(motivo: string | null | undefined): string {
  return RECUSAS[motivo ?? ''] ?? 'O CRM recusou o pedido. Atualize a tela e tente de novo.';
}

// ---------------------------------------------------------------------------
// A última coleta e a próxima
// ---------------------------------------------------------------------------

const DIA_DA_SEMANA = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: TIMEZONE });
const HORA = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});

/** "6h02", "6h": a hora como se fala. */
export function horaCurta(iso: string): string {
  const [h = '0', m = '00'] = HORA.format(new Date(iso)).split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
}

/** "segunda, 16/11, às 6h02" (o dia da semana sem o "-feira"). */
export function quandoFoi(iso: string): string {
  const dia = DIA_DA_SEMANA.format(new Date(iso)).replace(/-feira$/, '');
  return `${dia}, ${diaEMes(iso)}, às ${horaCurta(iso)}`;
}

export type ResumoDaColeta =
  | { tipo: 'nenhuma' }
  | { tipo: 'feita'; quando: string; fontes: number; comErro: number; rodando: number };

/**
 * A rodada mais recente: as coletas que começaram no mesmo dia (de Natal) da última.
 * `coletas` vem da mais nova para a mais velha.
 */
export function resumoDaUltimaColeta(coletas: readonly Coleta[]): ResumoDaColeta {
  const ultima = coletas[0];
  if (!ultima) return { tipo: 'nenhuma' };
  const dia = diaEMes(ultima.inicio);
  const daRodada = coletas.filter((c) => diaEMes(c.inicio) === dia);
  const fontes = new Set(daRodada.map((c) => c.fonte));
  const comErro = new Set(daRodada.filter((c) => c.situacao === 'erro').map((c) => c.fonte));
  const rodando = new Set(daRodada.filter((c) => c.situacao === 'rodando').map((c) => c.fonte));
  // O que conta é quando a rodada começou (a primeira fonte do dia).
  const comeco = daRodada[daRodada.length - 1]?.inicio ?? ultima.inicio;
  return {
    tipo: 'feita',
    quando: quandoFoi(comeco),
    fontes: fontes.size,
    comErro: comErro.size,
    rodando: rodando.size,
  };
}

/**
 * A próxima segunda ou quinta às 6h de Natal depois de `agora` (o pg_cron
 * `mercado_coleta_seg_qui` é "0 9 * * 1,4" em UTC). Natal é UTC-3 o ano inteiro.
 */
export function proximaColeta(agora: Date): Date {
  const natal = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  for (let dias = 0; dias <= 7; dias += 1) {
    const d = new Date(
      Date.UTC(natal.getUTCFullYear(), natal.getUTCMonth(), natal.getUTCDate() + dias, 9, 0, 0),
    );
    const semana = d.getUTCDay();
    if ((semana === 1 || semana === 4) && d.getTime() > agora.getTime()) return d;
  }
  // Inalcançável: em 8 dias sempre há uma segunda ou quinta.
  return agora;
}

/** "12 fontes liberadas; o robô já sabe ler 9 delas." */
export function resumoDasFontes(fontes: readonly FonteDeMercado[]): string {
  const liberadas = fontes.filter((f) => f.pode_coletar);
  const lidas = liberadas.filter((f) => f.coletor).length;
  const n = liberadas.length;
  if (n === 0) return 'Nenhuma fonte liberada ainda.';
  const quantas = n === 1 ? '1 fonte liberada' : `${n} fontes liberadas`;
  if (lidas === n) return `${quantas}; o robô sabe ler ${n === 1 ? 'esta' : 'todas'}.`;
  if (lidas === 0) return `${quantas}; o robô ainda não sabe ler nenhuma delas sozinho.`;
  return `${quantas}; o robô já sabe ler ${lidas === 1 ? 'uma' : lidas} delas.`;
}

/** A conferência da equipe achou erro na fonte: só quarentena e alerta aparecem. */
export function avisoDaSaude(estado: string | null | undefined): string | null {
  if (estado === 'quarentena') {
    return 'Em quarentena: a conferência da equipe achou erros, e os números desta fonte ficam fora das vantagens até ela se acertar.';
  }
  if (estado === 'alerta') {
    return 'Em alerta: a conferência desta semana achou erros nesta fonte.';
  }
  return null;
}
