import { z } from 'zod';

import {
  type ComQuem,
  type DesfechoCatalogo,
  type Feriado,
  diaEmFortaleza,
} from '@/components/registro/tipos';
import { type OrgKind, type Temperature } from '@komune/schema';

/**
 * Contrato do módulo de prospecção ativa por ligação (R13; PRD §5 funis e temperatura;
 * R08 playbook; R09 mercado de Natal).
 *
 * Este arquivo tem dono exclusivo: `components/ligacao/**` e a rota `(app)/ligar/**`
 * importam daqui e não editam nada aqui. Ele NÃO redefine nada que já existe — importa
 * `ComQuem`, `DesfechoCatalogo`, `Feriado` e `diaEmFortaleza` de `components/registro`,
 * porque a ligação termina exatamente no mesmo commit que a tela `/registrar` já faz
 * (`public.registrar_contato`), e duas cópias do mesmo vocabulário viram duas verdades.
 *
 * ===========================================================================
 * O PROBLEMA, EM UMA FRASE
 * ===========================================================================
 * A base tem 100 organizações reais e 66 com telefone (38 fornecedores, 28 entre
 * produtores e cerimonialistas), todas em `sources.slug = 'planilha'`. O WhatsApp não
 * pode abrir conversa antes de a Meta liberar o número — duas a três semanas. A ligação
 * não espera nada disso (R13 §1). Falta ao Tríade a única coisa que a ligação exige e
 * a visita não: **saber para quem ligar agora, sem escolher.**
 *
 * ===========================================================================
 * AS CINCO DECISÕES QUE ESTÃO GRAVADAS NOS TIPOS
 * ===========================================================================
 *
 * 1. **Quem liga não escolhe e não decide** (R13 §3.1). Não existe busca na tela de
 *    ligação. O lote é montado antes, a ordem é congelada na montagem (`posicao`) e o
 *    que vem depois da ligação sai do catálogo de desfechos, não da cabeça de quem
 *    ligou. Por isso `ItemDoLote.posicao` é gravado e não calculado na leitura: fila
 *    que se reordena sozinha durante o dia é fila que a pessoa aprende a driblar.
 *
 * 2. **Reserva na montagem, não na discagem** (R13 §3.1). São duas pessoas ligando da
 *    mesma base: sem reserva, o Matheus e a Heloísa ligam para o mesmo buffet no mesmo
 *    dia. A reserva é um índice único parcial em `call_batch_items (organization_id)`
 *    enquanto o item está `fila` ou `em_andamento` — e um segundo em `phone_e164`,
 *    porque duas organizações podem compartilhar o mesmo número (o índice único de
 *    telefone existe em `contacts`, não em `organizations`).
 *
 * 3. **Dois eixos, e o técnico não é escolha de ninguém** (R13 §3.3). O eixo comercial
 *    é o catálogo `interaction_outcomes` que já existe — e ele já está NO TETO de 8
 *    chips por superfície (`TETO_DESFECHOS_POR_SUPERFICIE`), o que por si só decide a
 *    arquitetura: o eixo técnico **não pode** virar chip novo no catálogo. Ele vira
 *    `ResultadoTecnico`, gravado na tentativa, e se conecta ao catálogo por
 *    `MAPA_RESULTADO_TECNICO` — três desfechos que já existem, nenhum criado, nenhum
 *    aposentado, `/registrar` intacta.
 *
 * 4. **A telefonia é um adaptador, não uma integração** (R13 §3.4, e a restrição que
 *    manda no desenho: não existe discador contratado). `ProvedorTelefonia` nasce com
 *    uma implementação só, `manual`: a tela mostra o número grande, abre o discador do
 *    aparelho por `tel:` e quem ligou toca em "Liguei". O cronômetro e os eventos são
 *    os mesmos que um discador de verdade vai emitir depois — por isso `EventoTelefonia`
 *    já tem `origem`, e por isso o resultado técnico é um valor do provedor, não um
 *    campo de formulário.
 *
 * 5. **A janela bloqueia a DISCAGEM, nunca a TABULAÇÃO** (R13 §6). Uma ligação que
 *    começou 19h58 é tabulada 20h03, e recusar isso perderia o registro de uma conversa
 *    que aconteceu. `janelaDeLigacao` responde sobre discar; nada mais.
 */

// ---------------------------------------------------------------------------
// 1. Janela de horário (R13 §6; RF-CON-11; fuso America/Fortaleza)
// ---------------------------------------------------------------------------

/**
 * A janela conservadora do R13 §6, em hora local de Fortaleza: seg–sex 9h–20h,
 * sábado 10h–13h, domingo e feriado bloqueados. Domingo (0) é ausência deliberada
 * na tabela, e não uma linha com zeros: o que não está aqui não abre.
 *
 * O número é o mesmo em três lugares — esta tabela, a função SQL `app.call_window` e o
 * teste `supabase/tests/13_*` —, e a duplicação é consciente: o cliente precisa
 * desenhar a contagem regressiva sem ida à rede, e o banco precisa recusar mesmo que
 * alguém chame a RPC por fora da tela. O teste de paridade é o que segura as duas.
 */
export const JANELA_DE_LIGACAO: Readonly<Record<number, { de: number; ate: number }>> = {
  1: { de: 9, ate: 20 },
  2: { de: 9, ate: 20 },
  3: { de: 9, ate: 20 },
  4: { de: 9, ate: 20 },
  5: { de: 9, ate: 20 },
  6: { de: 10, ate: 13 },
};

export type MotivoDeBloqueio = 'domingo' | 'feriado' | 'antes_da_abertura' | 'depois_do_fechamento';

export const MENSAGENS_DE_BLOQUEIO: Record<MotivoDeBloqueio, string> = {
  domingo: 'Domingo não se liga. A fila volta amanhã às 9h.',
  feriado: 'Hoje é feriado. A fila volta no próximo dia útil, às 9h.',
  antes_da_abertura: 'Cedo demais.',
  depois_do_fechamento: 'Passou do horário. Amanhã, a partir das 9h.',
};

export type EstadoDaJanela =
  | { aberta: true; fechaEm: string }
  | { aberta: false; motivo: MotivoDeBloqueio; abreEm: string | null };

/** Hora local em Fortaleza, como número decimal (14h30 → 14.5). */
export function horaEmFortaleza(quando: Date): number {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(quando);
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '0');
  const minuto = Number(partes.find((p) => p.type === 'minute')?.value ?? '0');
  return hora + minuto / 60;
}

/** Dia da semana em Fortaleza (0 = domingo), sem depender do fuso do aparelho. */
export function diaDaSemanaEmFortaleza(quando: Date): number {
  const sigla = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' }).format(
    quando,
  );
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(sigla);
}

const FUSO = 'America/Fortaleza';

/**
 * Se dá para discar agora, e quando muda.
 *
 * Devolve o instante da virada (`fechaEm` / `abreEm`) porque a tela precisa de uma
 * contagem regressiva, não de um booleano: "faltam 12 minutos" faz a pessoa decidir se
 * começa mais uma; "bloqueado" faz ela ficar tentando.
 *
 * `abreEm` é `null` só quando não há dia útil nos próximos 30 dias — impossível com a
 * `holidays` real, e mesmo assim melhor que um laço infinito.
 */
export function janelaDeLigacao(quando: Date, feriados: readonly Feriado[]): EstadoDaJanela {
  const dia = diaEmFortaleza(quando);
  const dow = diaDaSemanaEmFortaleza(quando);
  const hora = horaEmFortaleza(quando);
  const faixa = JANELA_DE_LIGACAO[dow];
  const ehFeriado = feriados.includes(dia);

  if (!ehFeriado && faixa && hora >= faixa.de && hora < faixa.ate) {
    return { aberta: true, fechaEm: instanteLocal(dia, faixa.ate) };
  }

  const motivo: MotivoDeBloqueio = ehFeriado
    ? 'feriado'
    : !faixa
      ? 'domingo'
      : hora < faixa.de
        ? 'antes_da_abertura'
        : 'depois_do_fechamento';

  // Hoje ainda abre? Só no caso "cedo demais" e fora de feriado.
  if (motivo === 'antes_da_abertura' && faixa) {
    return { aberta: false, motivo, abreEm: instanteLocal(dia, faixa.de) };
  }
  return { aberta: false, motivo, abreEm: proximaAbertura(dia, feriados) };
}

/** Início da próxima janela depois do dia informado, ou `null` se não houver em 30 dias. */
export function proximaAbertura(dia: string, feriados: readonly Feriado[]): string | null {
  for (let i = 1; i <= 30; i += 1) {
    const candidato = somarDias(dia, i);
    const dow = new Date(`${candidato}T12:00:00Z`).getUTCDay();
    const faixa = JANELA_DE_LIGACAO[dow];
    if (faixa && !feriados.includes(candidato)) return instanteLocal(candidato, faixa.de);
  }
  return null;
}

function somarDias(dia: string, dias: number): string {
  const base = new Date(`${dia}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

/**
 * `YYYY-MM-DD` + hora local de Fortaleza → ISO com offset.
 *
 * Fortaleza não tem horário de verão desde 2019 e o offset é fixo em −03:00 — por isso
 * a concatenação é honesta aqui e seria um bug em São Paulo.
 */
export function instanteLocal(dia: string, hora: number): string {
  const h = Math.floor(hora);
  const m = Math.round((hora - h) * 60);
  return `${dia}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`;
}

// ---------------------------------------------------------------------------
// 2. O lote (R13 §3.1)
// ---------------------------------------------------------------------------

/**
 * Como a fila do lote é ordenada. A ordem é resolvida UMA VEZ, na montagem, e gravada
 * em `ItemDoLote.posicao`.
 *
 * `aleatorio` não é capricho: é o único modo que permite comparar duas versões de
 * roteiro sem que a comparação seja contaminada pela ordem (quem liga de manhã pega os
 * melhores alvos em `prioridade`). Ele usa a semente do lote, então a mesma montagem
 * dá sempre a mesma fila.
 */
export type OrdemDaFila = 'prioridade' | 'mais_parado' | 'aleatorio';

export const ROTULOS_ORDEM: Record<OrdemDaFila, string> = {
  prioridade: 'Prioridade (tier, temperatura, tempo parado)',
  mais_parado: 'Quem está há mais tempo sem contato',
  aleatorio: 'Aleatório (para comparar roteiros)',
};

export type StatusDoLote = 'rascunho' | 'ativo' | 'pausado' | 'encerrado';

export const ROTULOS_STATUS_LOTE: Record<StatusDoLote, string> = {
  rascunho: 'Rascunho',
  ativo: 'Ativo',
  pausado: 'Pausado',
  encerrado: 'Encerrado',
};

/**
 * Um lote, como a tela o lê.
 *
 * `temperaturaOrigem` é a "origem única de temperatura" do R13 §3.1, e é campo, não
 * filtro opcional: um lote que mistura base quente com coleta fria produz uma taxa de
 * conversão que não quer dizer nada. Quem quiser ligar para os dois grupos monta dois
 * lotes — e aí compara.
 *
 * `pipelineId` é único pelo mesmo motivo somado a outro: a variante do roteiro sai de
 * `organizations.kind`, e um lote de funil único é um lote de variante única, o que faz
 * a comparação por versão de roteiro (R13 §7.7) existir.
 */
export type Lote = {
  id: string;
  nome: string;
  donoId: string;
  donoNome: string;
  status: StatusDoLote;
  /** Funil único: `fornecedor` ou `produtor`. */
  pipelineId: number;
  /** Origem única de temperatura. Todo item do lote tem esta temperatura na montagem. */
  temperaturaOrigem: Temperature;
  /** Roteiro vinculado, congelado na versão publicada no dia da montagem. */
  roteiroId: string;
  roteiroVersao: number;
  ordem: OrdemDaFila;
  /** Semente do `aleatorio`; irrelevante nos outros modos, mas sempre gravada. */
  semente: number;
  /** Teto de tentativas por telefone dentro do lote (R13 §3.1). Padrão `MAX_TENTATIVAS`. */
  maxTentativas: number;
  /** Piso de horas entre duas tentativas ao mesmo telefone. Padrão `HORAS_ENTRE_TENTATIVAS`. */
  horasEntreTentativas: number;
  /** Meta de ligações do lote (R13 §8.2: vira parâmetro, e por isso o campo existe já). */
  metaLigacoes: number | null;
  /** Período de validade: fora dele o lote não entrega item e a reserva cai. */
  iniciaEm: string;
  terminaEm: string;
  criadoEm: string;
  /** Contadores materializados para a tela de lotes não fazer cinco consultas. */
  total: number;
  pendentes: number;
  falados: number;
};

/** Padrões do R13 §3.1, aplicados na montagem e editáveis por lote. */
export const MAX_TENTATIVAS = 3;
export const HORAS_ENTRE_TENTATIVAS = 20;
/** Tamanho padrão de um lote de um turno para uma pessoa. Ver `fluxo_operador`. */
export const TAMANHO_PADRAO_DO_LOTE = 25;
export const TAMANHO_MAXIMO_DO_LOTE = 60;

/**
 * O que a tela de montagem manda. É o único formulário do módulo — depois dele, quem
 * liga não preenche mais nada além do desfecho.
 */
export const montarLoteSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, { error: 'Dê um nome ao lote (ex.: "Buffets frios — quinta").' })
    .max(60, { error: 'Máximo de 60 caracteres.' }),
  pipelineId: z.number().int().positive({ error: 'Escolha o funil.' }),
  temperaturaOrigem: z.enum(['frio', 'morno', 'quente'], {
    error: 'Escolha a origem: um lote não mistura base quente com coleta fria.',
  }),
  /** Vazio = todas as categorias do funil. */
  categoriaIds: z.array(z.number().int().positive()).default([]),
  roteiroId: z.uuid({ error: 'Escolha o roteiro.' }),
  ordem: z.enum(['prioridade', 'mais_parado', 'aleatorio']).default('prioridade'),
  tamanho: z
    .number()
    .int()
    .min(1)
    .max(TAMANHO_MAXIMO_DO_LOTE, { error: `No máximo ${TAMANHO_MAXIMO_DO_LOTE} por lote.` })
    .default(TAMANHO_PADRAO_DO_LOTE),
  maxTentativas: z.number().int().min(1).max(5).default(MAX_TENTATIVAS),
  horasEntreTentativas: z.number().int().min(1).max(168).default(HORAS_ENTRE_TENTATIVAS),
  metaLigacoes: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((v) => v ?? null),
  /** Dia civil em Fortaleza (`YYYY-MM-DD`). O padrão é hoje e hoje. */
  iniciaEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Data inválida.' }),
  terminaEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Data inválida.' }),
});

export type MontarLote = z.infer<typeof montarLoteSchema>;

/**
 * Quem NÃO entra na montagem, e por quê. É a lista que o SQL da montagem aplica como
 * `where`, escrita aqui porque é o que a tela precisa explicar quando o lote sai menor
 * do que a pessoa pediu ("pedi 25, vieram 11").
 */
export type MotivoDeExclusao =
  | 'sem_telefone'
  | 'suprimido'
  | 'nao_contatar'
  | 'em_janela_de_recontato'
  | 'reservado_em_outro_lote'
  | 'sem_negocio_aberto'
  | 'temperatura_diferente';

export const MENSAGENS_DE_EXCLUSAO: Record<MotivoDeExclusao, string> = {
  sem_telefone: 'sem telefone (34 dos 100 da base)',
  suprimido: 'pediu para não ser contatado',
  nao_contatar: 'marcado como não contatar',
  em_janela_de_recontato: 'em janela de recontato (RF-FUN-13)',
  reservado_em_outro_lote: 'já reservado em outro lote',
  sem_negocio_aberto: 'sem negócio aberto no funil',
  temperatura_diferente: 'temperatura diferente da origem do lote',
};

export type ResumoDaMontagem = {
  loteId: string;
  entraram: number;
  /** Quantos ficaram de fora por cada motivo, para a tela dizer a verdade. */
  excluidos: Partial<Record<MotivoDeExclusao, number>>;
};

// ---------------------------------------------------------------------------
// 3. O item do lote e a fila
// ---------------------------------------------------------------------------

/**
 * Estado de um item. `em_andamento` é o que segura a reserva enquanto a ligação
 * acontece — e é por isso que ele precisa expirar sozinho (`RESERVA_EXPIRA_MIN`): a aba
 * fechada no meio de uma ligação não pode prender um buffet para sempre.
 */
export type StatusDoItem = 'fila' | 'em_andamento' | 'concluido' | 'devolvido';

/** Quanto tempo um item fica `em_andamento` sem notícia antes de voltar para a fila. */
export const RESERVA_EXPIRA_MIN = 30;

export type ItemDoLote = {
  id: string;
  loteId: string;
  organizationId: string;
  /** Nome da organização, como aparece na tela grande. */
  nome: string;
  kind: OrgKind;
  categoria: string | null;
  bairro: string | null;
  cidade: string | null;
  /** E.164. A tela mostra formatado e o `tel:` usa este valor. */
  telefone: string;
  /** Contato nomeado, quando existe: falar o nome da pessoa muda a ligação. */
  contatoId: string | null;
  contatoNome: string | null;
  /** `sources.slug` do contato — vira a frase de origem do primeiro nó (`fraseDeOrigem`). */
  origemSlug: string;
  origemUrl: string | null;
  dealId: string | null;
  etapaId: number | null;
  etapa: string | null;
  temperatura: Temperature;
  status: StatusDoItem;
  /** Ordem congelada na montagem. */
  posicao: number;
  tentativas: number;
  /** Reagendamento ("me liga terça às 10h"): item com data volta na frente da fila. */
  agendadoPara: string | null;
  ultimaTentativaEm: string | null;
  /** Notas curtas que a pessoa deixou na ligação anterior deste mesmo item. */
  observacao: string | null;
};

/**
 * A ordem em que os itens saem da fila. Uma regra só, e ela não é o `ordem` do lote:
 *
 * 1. reagendado para agora ou para trás — a hora foi combinada com o cliente;
 * 2. depois, a `posicao` congelada na montagem.
 *
 * Itens `concluido`, `devolvido` e os que estão em janela de recontato não chegam aqui:
 * a consulta já os deixou fora. O que esta função faz é só decidir o topo, e por isso
 * ela é pura e testável sem banco.
 */
export function ordenarFila(itens: readonly ItemDoLote[], agora: Date): ItemDoLote[] {
  const t = agora.getTime();
  const venceu = (i: ItemDoLote) => i.agendadoPara !== null && Date.parse(i.agendadoPara) <= t;
  return [...itens]
    .filter((i) => i.status === 'fila')
    .sort((a, b) => {
      if (venceu(a) !== venceu(b)) return venceu(a) ? -1 : 1;
      if (venceu(a) && venceu(b)) return Date.parse(a.agendadoPara!) - Date.parse(b.agendadoPara!);
      return a.posicao - b.posicao;
    });
}

/** O próximo da fila, ou `null` quando o lote acabou. */
export function proximoDaFila(itens: readonly ItemDoLote[], agora: Date): ItemDoLote | null {
  return ordenarFila(itens, agora)[0] ?? null;
}

// ---------------------------------------------------------------------------
// 4. Eixo técnico (R13 §3.3) — resultado da CHAMADA, não escolha de quem ligou
// ---------------------------------------------------------------------------

/**
 * O que aconteceu com a chamada, do ponto de vista da linha.
 *
 * No adaptador `manual` os quatro primeiros vêm de um toque na barra "não falei com
 * ninguém" e `atendida_humano` vem de a pessoa entrar na árvore do roteiro — o que é
 * uma afirmação honesta: ela só lê o roteiro se alguém atendeu. Num discador de verdade
 * os mesmos valores chegam do AMD e dos eventos de linha, sem mudar nada acima.
 *
 * A lista é fechada de propósito e igual à do R13 §3.3. Ela vira o enum `app.call_result`
 * na migração 20260904001300, e o teste 13_* compara os dois.
 */
export const RESULTADOS_TECNICOS = [
  'atendida_humano',
  'nao_atendeu',
  'caixa_postal',
  'ocupado',
  'numero_invalido',
  'chamada_muda',
  'queda_de_linha',
] as const;

export type ResultadoTecnico = (typeof RESULTADOS_TECNICOS)[number];

export const ROTULOS_RESULTADO_TECNICO: Record<ResultadoTecnico, string> = {
  atendida_humano: 'Atendeu',
  nao_atendeu: 'Não atendeu',
  caixa_postal: 'Caixa postal',
  ocupado: 'Ocupado',
  numero_invalido: 'Número não existe',
  chamada_muda: 'Chamada muda',
  queda_de_linha: 'Caiu a ligação',
};

/**
 * Os resultados que a pessoa toca na barra "não falei com ninguém". `atendida_humano`
 * não está aqui porque não é botão: é consequência de ela abrir o roteiro.
 * `chamada_muda` e `queda_de_linha` também não: no adaptador manual não existe evento
 * que os distinga de "não atendeu", e oferecer um botão que ninguém sabe quando usar é
 * dado sujo. Eles ficam reservados para o dia em que o discador os emitir.
 */
export const RESULTADOS_SEM_CONVERSA: readonly ResultadoTecnico[] = [
  'nao_atendeu',
  'caixa_postal',
  'ocupado',
  'numero_invalido',
];

/**
 * A ponte entre o eixo técnico e o catálogo que já existe.
 *
 * **Esta é a mudança mínima que o R13 §3.3 pede, e ela não toca em nada da `/registrar`.**
 * Os três desfechos técnicos continuam ativos, na mesma posição e na mesma superfície —
 * porque a Heloísa também liga do celular dela, fora de lote, e precisa dos oito chips.
 * O que muda é quem os escolhe: dentro do módulo de ligação, ninguém. O sistema resolve
 * pelo mapa abaixo e chama `public.registrar_contato` com o mesmo `outcome_id` de sempre,
 * de modo que a espera, a próxima ação e a etapa continuam saindo do catálogo.
 *
 * Por que mapear quatro resultados em três desfechos, em vez de criar chips novos:
 * a superfície `ligacao` já tem exatamente 8 desfechos ativos, que é o teto do catálogo
 * (`TETO_DESFECHOS_POR_SUPERFICIE`, spec §3). Criar "Ocupado" como chip estouraria o
 * teto e mudaria a tela de todo mundo para registrar uma diferença que não muda
 * consequência nenhuma: ocupado, mudo e queda de linha pedem exatamente o mesmo de
 * volta — ligar amanhã. A diferença fica gravada em `call_attempts.resultado`, que é
 * onde ela serve para alguma coisa: o relatório por horário do R13 §7.7.
 *
 * `atendida_humano` não tem desfecho aqui porque o eixo comercial é que responde.
 */
export const MAPA_RESULTADO_TECNICO: Readonly<Record<ResultadoTecnico, string | null>> = {
  atendida_humano: null,
  nao_atendeu: 'lig_nao_atendeu',
  ocupado: 'lig_nao_atendeu',
  chamada_muda: 'lig_nao_atendeu',
  queda_de_linha: 'lig_nao_atendeu',
  caixa_postal: 'lig_caixa_postal',
  numero_invalido: 'lig_numero_errado',
};

// ---------------------------------------------------------------------------
// 5. Eixo comercial (R13 §3.3) — só existe se alguém atendeu
// ---------------------------------------------------------------------------

/**
 * Os cinco desfechos de ligação que pressupõem conversa. São os que já existem, na
 * ordem em que aparecem no catálogo.
 *
 * A migração 20260904001300 acrescenta a coluna `interaction_outcomes.requires_answer`
 * (boolean, default false) e a marca `true` exatamente nestes cinco — coluna aditiva,
 * com padrão, que a `/registrar` não lê. Esta constante é o espelho da seed no cliente,
 * e existe para a tela poder desenhar antes da primeira leitura do catálogo; quem manda
 * continua sendo a coluna, lida por `exigeAtendimento`.
 */
export const SLUGS_COMERCIAIS_DA_LIGACAO = [
  'lig_atendeu_retorna',
  'lig_interessado',
  'lig_agora_nao',
  'lig_sem_interesse',
  'lig_reuniao_marcada',
] as const;

export type SlugComercial = (typeof SLUGS_COMERCIAIS_DA_LIGACAO)[number];

/** Um desfecho do catálogo, com a coluna nova que a migração 001300 acrescenta. */
export type DesfechoDeLigacao = DesfechoCatalogo & { requires_answer?: boolean | null };

/**
 * O desfecho só vale depois de alguém atender. Lê a coluna quando ela existe e cai na
 * lista de slugs enquanto a migração não foi aplicada — nunca o contrário, para que o
 * dia em que o gestor marcar um sexto desfecho como comercial não exija deploy.
 */
export function exigeAtendimento(desfecho: DesfechoDeLigacao): boolean {
  if (typeof desfecho.requires_answer === 'boolean') return desfecho.requires_answer;
  return (SLUGS_COMERCIAIS_DA_LIGACAO as readonly string[]).includes(desfecho.slug);
}

/**
 * Os desfechos que a tela oferece depois de uma chamada. Com atendimento, os cinco
 * comerciais; sem atendimento, nenhum — o técnico já resolveu, e oferecer "Sem
 * interesse" para quem não atendeu é fabricar uma recusa que ninguém disse.
 */
export function desfechosDaChamada(
  catalogo: readonly DesfechoDeLigacao[],
  resultado: ResultadoTecnico,
): DesfechoDeLigacao[] {
  // O catálogo já chega filtrado por `is_active` do servidor (`carregarContextoDoRegistro`),
  // e `DesfechoCatalogo` nem carrega a coluna: filtrar de novo aqui seria mentir sobre
  // quem decide o que está ativo.
  if (resultado !== 'atendida_humano') return [];
  return catalogo.filter((d) => exigeAtendimento(d));
}

/**
 * O pedido de tabulação não é válido quando promete uma conversa que não houve. É a
 * regra dos dois eixos escrita como função — e a RPC `tabular_chamada` a repete no SQL,
 * porque a tela é a primeira barreira e nunca a única.
 */
export function tabulacaoCoerente(
  resultado: ResultadoTecnico,
  desfecho: DesfechoDeLigacao | null,
): boolean {
  if (resultado === 'atendida_humano') return desfecho !== null && exigeAtendimento(desfecho);
  return desfecho === null;
}

// ---------------------------------------------------------------------------
// 6. Roteiro em árvore (R13 §3.2 e §5)
// ---------------------------------------------------------------------------

/**
 * A variante é escolhida pelo SISTEMA, a partir de `organizations.kind` (R13 §5), e
 * nunca por quem liga. `cerimonialista` entra em `produtor` porque o gancho é o mesmo —
 * controle do evento — e porque é o funil em que ele está.
 */
export type VarianteRoteiro = 'fornecedor' | 'produtor';

export function variantePara(kind: OrgKind): VarianteRoteiro {
  return kind === 'produtor' || kind === 'cerimonialista' ? 'produtor' : 'fornecedor';
}

/**
 * A frase de origem do primeiro nó ("peguei o contato de vocês …"), por `sources.slug`.
 *
 * O R13 §5 e o R08 §5.5 pedem o aviso de origem na abertura, e o R06 o trata como
 * exigência de transparência do legítimo interesse. O que a tabela `sources` guarda é
 * nome de catálogo — "Planilha (importação)", "Google Maps" —, e nenhum deles se fala ao
 * telefone. Este mapa é a tradução para o que é verdade E dá para dizer em voz alta.
 *
 * A frase de `planilha` merece explicação, porque é a de todas as 100 organizações de
 * hoje: a planilha foi montada a partir de diretórios públicos e do mercado de Natal
 * (R09), então "numa lista de fornecedores de evento aqui de Natal" é verdadeiro e
 * verificável. No dia em que o Radar preencher `source_id` de verdade, cada linha passa
 * a falar a sua própria origem sem mudar uma vírgula do roteiro.
 *
 * Origem desconhecida cai em `ORIGEM_PADRAO`. Nunca em vazio: pular o aviso de origem é
 * a única parte do roteiro que não é escolha de redação.
 */
export const FRASE_DE_ORIGEM: Readonly<Record<string, string>> = {
  casamentos_com_br: 'no Casamentos.com',
  google_places: 'no Google, procurando fornecedor de evento aqui em Natal',
  instagram: 'no Instagram de vocês',
  sympla_outgo: 'no Sympla, num evento de vocês',
  olx: 'no anúncio de vocês na OLX',
  telelistas: 'numa lista de fornecedores de evento de Natal',
  planilha: 'numa lista de fornecedores de evento aqui de Natal',
  base_cnpj: 'no cadastro público de empresas de evento de Natal',
  contato_pessoal: 'com uma pessoa aqui da Komune, que me passou o contato de vocês',
  indicacao: 'por indicação de outro fornecedor que já trabalha com a gente',
  captura_campo: 'num evento aqui em Natal, onde vocês estavam trabalhando',
};

export const ORIGEM_PADRAO = 'numa lista pública de fornecedores de evento aqui de Natal';

export function fraseDeOrigem(slug: string): string {
  return FRASE_DE_ORIGEM[slug] ?? ORIGEM_PADRAO;
}

/** Um nó vale para uma variante ou para as duas. */
export type EscopoDoNo = VarianteRoteiro | 'ambas';

export function noValeNaVariante(escopo: EscopoDoNo, variante: VarianteRoteiro): boolean {
  return escopo === 'ambas' || escopo === variante;
}

/**
 * O que o nó é, e o que a tela faz com ele:
 *
 * - `fala` — texto para ler, com um botão só ("falei"). Usado onde a resposta não
 *   bifurca; é raro de propósito, porque nó sem pergunta é nó onde a ligação morre.
 * - `pergunta` — texto que termina em pergunta e uma saída por resposta possível.
 * - `captura` — pergunta cuja resposta vira dado (`campo`), não caminho.
 * - `objecao` — nó do bloco lateral, alcançável de QUALQUER nó (R13: o bloco é
 *   acessível de qualquer ponto). Não aparece na árvore principal.
 * - `acao` — o que fazer, não o que falar (mandar o resumo no WhatsApp, anotar o nome
 *   do decisor). Some da tela quando cumprido.
 * - `fim` — encerra a ligação e carrega o desfecho comercial (`desfecho`).
 */
export type TipoDeNo = 'fala' | 'pergunta' | 'captura' | 'objecao' | 'acao' | 'fim';

/** Uma saída do nó: o que o cliente respondeu → para onde a tela vira. */
export const saidaSchema = z.object({
  /** O rótulo do botão, na boca do cliente ("já tenho fornecedor"). */
  rotulo: z.string().trim().min(1).max(48),
  /** Id do próximo nó. */
  destino: z.string().trim().min(1),
});

export type SaidaDoNo = z.infer<typeof saidaSchema>;

export const noSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/, { error: 'Id do nó: minúsculas, números e _.' }),
  tipo: z.enum(['fala', 'pergunta', 'captura', 'objecao', 'acao', 'fim']),
  variante: z.enum(['ambas', 'fornecedor', 'produtor']),
  /**
   * O texto que a pessoa fala, literal. Placeholders entre colchetes são substituídos
   * pela tela (`preencherTexto`): `[saudacao]`, `[empresa]`, `[nome]`, `[origem]`
   * (de `fraseDeOrigem`), `[eu]`, `[dia]`, `[hora]`.
   */
  texto: z.string().trim().min(1),
  saidas: z.array(saidaSchema).default([]),
  /** Só em `fim`: o slug do desfecho comercial que o nó grava. */
  desfecho: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  /**
   * Só em `fim`, e no lugar de `desfecho`: o nó fecha pelo eixo TÉCNICO.
   *
   * Existe por um caso real e um só — "aqui não é o [Empresa], você ligou errado". A
   * pessoa atendeu, então o eixo técnico não podia ter sido decidido antes de discar;
   * mas não houve conversa comercial nenhuma, e forçar um desfecho comercial ali
   * gravaria uma recusa que ninguém fez. O nó devolve `numero_invalido`, que
   * `MAPA_RESULTADO_TECNICO` leva a `lig_numero_errado` — que é exatamente o que o
   * catálogo já faz com número errado desde a migração 000800.
   */
  resultadoTecnico: z
    .enum(RESULTADOS_TECNICOS)
    .nullish()
    .transform((v) => v ?? null),
  /** Só em `captura`: onde a resposta é guardada (`metadata` da atividade). */
  campo: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  /** Dica curta para quem lê, fora da fala (não se lê em voz alta). */
  nota: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
});

export type NoRoteiro = z.infer<typeof noSchema>;

export const roteiroSchema = z.object({
  id: z.uuid(),
  slug: z.string().trim().min(1),
  nome: z.string().trim().min(1),
  versao: z.number().int().positive(),
  nos: z.array(noSchema).min(1),
});

export type Roteiro = z.infer<typeof roteiroSchema>;

/** Id do nó de entrada. Fixo, e o mesmo nas duas variantes: a abertura é comum. */
export const NO_DE_ABERTURA = 'abertura';

/**
 * O roteiro está íntegro? Roda na publicação da versão e no teste, não a cada leitura.
 *
 * Cobre o que dá para verificar sem ouvir a ligação: existe abertura, todo destino
 * existe, todo caminho chega a um `fim`, todo `fim` tem desfecho de ligação, e nenhum
 * nó de pergunta ficou sem saída (que é a falha que trava a pessoa no telefone).
 */
export function validarRoteiro(roteiro: Roteiro): string[] {
  const erros: string[] = [];
  const porId = new Map(roteiro.nos.map((n) => [n.id, n]));
  if (!porId.has(NO_DE_ABERTURA)) erros.push(`Falta o nó "${NO_DE_ABERTURA}".`);

  for (const no of roteiro.nos) {
    for (const s of no.saidas) {
      if (!porId.has(s.destino))
        erros.push(`"${no.id}" aponta para "${s.destino}", que não existe.`);
    }
    if (no.tipo === 'fim') {
      if (no.desfecho === null && no.resultadoTecnico === null)
        erros.push(`"${no.id}" é fim e não fecha por nenhum dos dois eixos.`);
      else if (no.desfecho !== null && no.resultadoTecnico !== null)
        erros.push(`"${no.id}" fecha pelos dois eixos ao mesmo tempo.`);
      else if (
        no.desfecho !== null &&
        !(SLUGS_COMERCIAIS_DA_LIGACAO as readonly string[]).includes(no.desfecho)
      )
        erros.push(`"${no.id}" usa o desfecho "${no.desfecho}", que não é comercial de ligação.`);
    } else if (no.saidas.length === 0 && no.tipo !== 'acao') {
      erros.push(`"${no.id}" não tem saída e não é fim: a ligação trava aqui.`);
    }
  }

  // O mesmo nó pode ter saídas para as duas variantes (é assim que a abertura, que é
  // comum, cai no gancho certo). Um nó só está de pé se sobrar saída DEPOIS do filtro.
  for (const variante of ['fornecedor', 'produtor'] as const) {
    for (const no of roteiro.nos) {
      if (!noValeNaVariante(no.variante, variante)) continue;
      if (no.tipo === 'fim' || no.tipo === 'acao') continue;
      if (saidasNaVariante(roteiro, no, variante).length === 0) {
        erros.push(`"${no.id}" fica sem saída na variante ${variante}.`);
      }
    }
  }
  return erros;
}

/**
 * As saídas de um nó que existem nesta variante.
 *
 * É o mecanismo que deixa a abertura ser um nó só: ela tem duas saídas "Pode falar",
 * uma para `gancho_fornecedor` e outra para `gancho_produtor`, e a tela mostra a que
 * vale para o `kind` da organização. Sem isso, ou a abertura vira dois nós quase iguais
 * (e o aviso de gravação passa a ter duas redações que divergem no primeiro remendo),
 * ou o roteiro ganha um nó de roteamento que a pessoa lê na tela sem falar nada.
 */
export function saidasNaVariante(
  roteiro: Roteiro,
  no: NoRoteiro,
  variante: VarianteRoteiro,
): SaidaDoNo[] {
  return no.saidas.filter((s) => {
    const destino = roteiro.nos.find((n) => n.id === s.destino);
    return destino !== undefined && noValeNaVariante(destino.variante, variante);
  });
}

/** Os nós do bloco de objeções, que a tela mostra fixos, fora da árvore. */
export function objecoesDoRoteiro(roteiro: Roteiro, variante: VarianteRoteiro): NoRoteiro[] {
  return roteiro.nos.filter((n) => n.tipo === 'objecao' && noValeNaVariante(n.variante, variante));
}

/** Os nós da árvore principal, já filtrados pela variante. */
export function arvoreDoRoteiro(roteiro: Roteiro, variante: VarianteRoteiro): NoRoteiro[] {
  return roteiro.nos.filter((n) => n.tipo !== 'objecao' && noValeNaVariante(n.variante, variante));
}

export function noPorId(roteiro: Roteiro, id: string): NoRoteiro | null {
  return roteiro.nos.find((n) => n.id === id) ?? null;
}

/**
 * Substitui os placeholders pelo que a ligação tem em mãos. Sem valor, o placeholder
 * SOME em vez de virar "[nome]" na tela: ler um colchete em voz alta é pior do que
 * pular a palavra.
 */
export function preencherTexto(texto: string, valores: Record<string, string | null>): string {
  return texto
    .replace(/\[(\w+)\]/g, (todo, chave: string) => valores[chave] ?? '')
    .replace(/ {2,}/g, ' ')
    .replace(/ ([,.!?])/g, '$1')
    .trim();
}

/** O caminho percorrido, na ordem, como vai para `call_attempts.caminho_script`. */
export type CaminhoDoScript = string[];

// ---------------------------------------------------------------------------
// 7. Telefonia (R13 §3.4) — interface primeiro, adaptador manual atrás
// ---------------------------------------------------------------------------

/**
 * Como a chamada foi discada. Hoje só existe `manual`; o campo existe para que o
 * relatório saiba comparar o dia em que houver discador.
 */
export type ProvedorId = 'manual';

export const PROVEDOR_ATUAL: ProvedorId = 'manual';

/**
 * Eventos que um provedor de telefonia emite. No adaptador manual todos têm
 * `origem: 'operador'` — são toques na tela. Num discador eles chegam por WebSocket
 * (R13 §3.4: pelo menos um fornecedor brasileiro não manda webhook) e passam a ter
 * `origem: 'provedor'`, sem que a tela mude de forma.
 */
export type EventoTelefonia =
  | { tipo: 'discando'; em: string; origem: OrigemDoEvento }
  | { tipo: 'atendida'; em: string; origem: OrigemDoEvento }
  | { tipo: 'encerrada'; em: string; origem: OrigemDoEvento; resultado: ResultadoTecnico };

export type OrigemDoEvento = 'operador' | 'provedor';

/**
 * A interface do R13 §3.4, com o recorte do que existe hoje.
 *
 * `pausar` do R13 ficou de fora: ele serve a estados de pausa NR-17, que o próprio R13
 * §4 descarta para duas pessoas que fazem outras coisas. Entra quando entrar posição
 * dedicada — e entra na interface, não no módulo.
 */
export type ProvedorTelefonia = {
  id: ProvedorId;
  /** `false` no manual: a tela não sabe se atendeu; quem sabe é quem está com o fone. */
  detectaAtendimento: boolean;
  iniciarChamada(alvo: { telefone: string; itemId: string }): Promise<ChamadaEmCurso>;
  encerrar(chamadaId: string, resultado: ResultadoTecnico): Promise<void>;
  aoEvento(ouvinte: (e: EventoTelefonia) => void): () => void;
};

export type ChamadaEmCurso = {
  /** Id da linha em `call_attempts`, criada no início e fechada na tabulação. */
  id: string;
  itemId: string;
  telefone: string;
  iniciadaEm: string;
  provedor: ProvedorId;
};

/** `tel:` com o E.164 limpo — é o que abre o discador do aparelho. */
export function linkDoDiscador(telefoneE164: string): string {
  return `tel:${telefoneE164.replace(/[^\d+]/g, '')}`;
}

/**
 * Telefone brasileiro em E.164 formatado para leitura em voz alta: `+55 84 99999-8888`.
 * A tela mostra assim e copia o E.164 puro — ler número agrupado errado é ligar errado.
 */
export function telefoneLegivel(e164: string): string {
  const d = e164.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) {
    return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 12 && d.startsWith('55')) {
    return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  }
  return e164;
}

/**
 * Uma chamada com menos de 3 segundos é o que a Anatel trata como abandonada (R13 §6).
 * No modo manual não há chamada abandonada — quem disca é gente —, mas o limiar fica
 * aqui porque é ele que o relatório usa para vigiar o dia em que houver discador.
 */
export const SEGUNDOS_CHAMADA_ABANDONADA = 3;

// ---------------------------------------------------------------------------
// 8. A tabulação: o que sai da tela
// ---------------------------------------------------------------------------

/** RPC que abre a tentativa e segura a reserva. */
export const RPC_INICIAR_CHAMADA = 'iniciar_chamada' as const;
/** RPC que fecha a tentativa, grava os dois eixos e chama `registrar_contato`. */
export const RPC_TABULAR_CHAMADA = 'tabular_chamada' as const;
/** RPC da montagem do lote (com a reserva). */
export const RPC_MONTAR_LOTE = 'montar_lote' as const;
/** RPC que devolve um item à fila sem tabular (aba fechada, engano). */
export const RPC_DEVOLVER_ITEM = 'devolver_item_do_lote' as const;

/**
 * "Com quem você falou" é o MESMO vocabulário da `/registrar` (`ComQuem`), porque é o
 * mesmo `p_com_quem` da mesma RPC e é ele que decide porta aberta × porta batida
 * (RF-MET-01). O `satisfies` existe para que acrescentar um valor lá quebre aqui, em vez
 * de a ligação passar a gravar um interlocutor que o gatilho do banco não conhece.
 */
const VALORES_COM_QUEM = [
  'decisor',
  'influenciador',
  'funcionario',
  'ninguem',
  'nao_informado',
] as const satisfies readonly ComQuem[];

const comQuemSchema = z.enum(VALORES_COM_QUEM);

export const tabularChamadaSchema = z
  .object({
    /** Idempotência, gerada no cliente. Mesmo mecanismo da `/registrar`. */
    clientKey: z.uuid(),
    chamadaId: z.uuid(),
    itemId: z.uuid(),
    resultado: z.enum(RESULTADOS_TECNICOS),
    /** Nulo sempre que ninguém atendeu. */
    outcomeId: z
      .number()
      .int()
      .positive()
      .nullish()
      .transform((v) => v ?? null),
    comQuem: comQuemSchema,
    caminhoScript: z.array(z.string()).default([]),
    duracaoSeg: z.number().int().min(0).max(7200),
    observacao: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((v) => v ?? null),
    /** Campos capturados nos nós `captura`, como `{ eventos_por_mes: "4" }`. */
    capturas: z.record(z.string(), z.string()).default({}),
    /** "Me liga terça às 10h" — vira `tasks` e reagenda o item. */
    agendarPara: z.iso
      .datetime({ offset: true })
      .nullish()
      .transform((v) => v ?? null),
    lostReasonId: z
      .number()
      .int()
      .positive()
      .nullish()
      .transform((v) => v ?? null),
    reuniaoEm: z.iso
      .datetime({ offset: true })
      .nullish()
      .transform((v) => v ?? null),
    reuniaoFormato: z
      .string()
      .nullish()
      .transform((v) => v ?? null),
    /** O nó `fim_optout`: grava `consent_events.contact_optout` além do desfecho. */
    pediuParaNaoLigar: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.resultado === 'atendida_humano' && v.outcomeId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['outcomeId'],
        message: 'Alguém atendeu: escolha o que ficou combinado.',
      });
    }
    if (v.resultado !== 'atendida_humano' && v.outcomeId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['outcomeId'],
        message: 'Sem atendimento não existe resultado comercial.',
      });
    }
  });

export type TabularChamada = z.infer<typeof tabularChamadaSchema>;

export const resultadoTabulacaoSchema = z.discriminatedUnion('tabulado', [
  z.object({
    tabulado: z.literal(true),
    repetido: z.boolean(),
    attempt_id: z.uuid(),
    /** Nulo quando ninguém atendeu e o desfecho técnico não gerou atividade. */
    activity_id: z.uuid().nullable(),
    item_status: z.enum(['fila', 'em_andamento', 'concluido', 'devolvido']),
    /** `true` quando o item volta à fila (tentativa abaixo do teto do lote). */
    volta_para_fila: z.boolean(),
    tentativas: z.number().int(),
    proxima_acao_em: z.string().nullable(),
    proxima_acao_titulo: z.string().nullable(),
    /** Quantos ainda faltam no lote — é o número que a tela mostra entre uma e outra. */
    restantes: z.number().int(),
  }),
  z.object({
    tabulado: z.literal(false),
    motivo: z.enum([
      'sem_permissao',
      'item_de_outro_dono',
      'chamada_ja_encerrada',
      'eixos_incoerentes',
      'desfecho_invalido',
      'motivo_de_perda_obrigatorio',
      'reuniao_sem_data',
      'lote_encerrado',
    ]),
    detalhe: z.string().nullable(),
  }),
]);

export type ResultadoTabulacao = z.infer<typeof resultadoTabulacaoSchema>;

export const MENSAGENS_DE_RECUSA_DA_CHAMADA: Record<
  Extract<ResultadoTabulacao, { tabulado: false }>['motivo'],
  string
> = {
  sem_permissao: 'Seu perfil não registra ligação.',
  item_de_outro_dono: 'Este contato está reservado no lote de outra pessoa.',
  chamada_ja_encerrada: 'Esta chamada já foi tabulada.',
  eixos_incoerentes: 'Sem atendimento não existe resultado comercial.',
  desfecho_invalido: 'Esse resultado saiu do catálogo. Recarregue a tela.',
  motivo_de_perda_obrigatorio: 'Perda exige motivo (RF-FUN-04).',
  reuniao_sem_data: 'Reunião marcada precisa de data e hora.',
  lote_encerrado: 'Este lote foi encerrado. Abra o lote de hoje.',
};

export const MENSAGENS_DE_RECUSA_DA_DISCAGEM: Record<string, string> = {
  fora_da_janela: 'Fora do horário permitido. A discagem volta na próxima janela.',
  contato_suprimido: 'Este contato pediu para não ser procurado. Ele sai do lote.',
  teto_de_tentativas: 'Já foram feitas todas as tentativas previstas para este número.',
  reserva_expirada: 'A reserva caiu. Puxe o próximo da fila.',
};

// ---------------------------------------------------------------------------
// 9. Estado da tela
// ---------------------------------------------------------------------------

/**
 * Os passos, e o que cada um custa em toque:
 *
 * `discar` (1 toque) → `falando` (1 por nó, 3 a 5) → `tabular` (1) → `recibo` (0: some
 * sozinho e traz o próximo). Sem atendimento, `discar` → `tabular` em 1 toque na barra.
 */
export type PassoDaLigacao = 'discar' | 'falando' | 'tabular' | 'recibo';

export type EstadoDaLigacao = {
  passo: PassoDaLigacao;
  lote: Lote | null;
  item: ItemDoLote | null;
  chamada: ChamadaEmCurso | null;
  variante: VarianteRoteiro;
  noAtual: string;
  caminho: CaminhoDoScript;
  capturas: Record<string, string>;
  resultado: ResultadoTecnico | null;
  janela: EstadoDaJanela;
};

/** Janela de arrependimento antes de o próximo contato entrar. Igual à da `/registrar`. */
export const ESPERA_ANTES_DO_PROXIMO_MS = 5_000;

/** De quanto em quanto tempo a tela reavalia a janela de horário (contagem regressiva). */
export const INTERVALO_RELOGIO_MS = 15_000;

/** Chave do rascunho local: a aba fechada no meio de uma ligação não perde o caminho. */
export const CHAVE_LIGACAO_EM_CURSO = 'triade.ligacao.emcurso.v1';
