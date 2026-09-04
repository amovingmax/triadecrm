import type { Temperature } from '@komune/schema';

import {
  comQuemPadrao,
  desfechosOferecidos,
  diaEmFortaleza,
  instanteEmFortaleza,
  SLUGS_REUNIAO_AGENDADA,
  type DesfechoCatalogo,
} from '@/components/registro/tipos';

/**
 * Contrato da Agenda (PRD §7.5, RF-AGE-01 a RF-AGE-08 e RF-ROT-03/05).
 *
 * ===========================================================================
 * O QUE A AGENDA É, HOJE
 * ===========================================================================
 * Não existe tabela de eventos no banco, e não deve existir: um compromisso já é uma
 * `public.tasks` de tipo `meeting` ou `visit` com `due_at`. Quem as cria é o próprio
 * catálogo de desfechos, pela `public.registrar_contato` — "Reunião marcada" produz a
 * tarefa `meeting` na data combinada, "Não estava / fechado" produz a `visit` de D+7.
 * A Agenda LÊ essas tarefas e devolve o desfecho pelo MESMO caminho. Nenhuma escrita
 * daqui inventa etapa, temperatura ou porta: tudo passa por `registrar_contato`.
 *
 * ===========================================================================
 * A DISTINÇÃO QUE ESTA TELA NÃO PODE APAGAR
 * ===========================================================================
 * `meeting` não quer dizer "reunião marcada". Metade das tarefas desse tipo na base
 * real é "Marcar apresentação", criada por "Interessado" numa ligação ou visita: é
 * tarefa A FAZER, e a hora que ela carrega (09:00) é o prazo calculado pela régua do
 * RF-MET-06, não uma hora combinada com ninguém. O próprio `components/registro`
 * escreve isso em `SLUGS_REUNIAO_AGENDADA`: só `lig_reuniao_marcada` e
 * `reu_reagendada` marcam reunião de verdade.
 *
 * Pintar as nove "Marcar apresentação" de terça como nove reuniões às 09:00 seria a
 * tela mentindo com dado verdadeiro. Então a agenda separa:
 *
 *   `marcado`   reunião cujo negócio está numa etapa que EXIGE `meeting_at`
 *               (`stages.required_fields`: `reuniao_marcada` no funil fornecedor,
 *               `demonstracao_marcada` no produtor). Aí a hora é hora combinada.
 *   `visita`    tarefa `visit`: porta a bater no dia, com bairro e link do mapa.
 *   `a_marcar`  o resto das `meeting`: apresentação a combinar, sem hora.
 *
 * A regra sai de `stages.required_fields`, lido do banco, e não de uma lista de slugs
 * em código: o gestor edita etapas (RF-ADM-02).
 */

/** Um compromisso da agenda, do jeito que o cartão precisa dele. */
export type Compromisso = {
  /** `public.tasks.id`: a agenda é a lista de tarefas de campo, não uma tabela nova. */
  taskId: string;
  /** Como a tela o trata. Ver o cabeçalho deste arquivo. */
  natureza: NaturezaDoCompromisso;
  /** `tasks.kind`, traduzido para a superfície de registro correspondente. */
  tipo: 'reuniao' | 'visita';
  titulo: string;
  /** `tasks.due_at` em ISO. Nunca nulo: a agenda só lista tarefa com data. */
  quando: string;
  /** `tasks.status = 'done'`: já registrado, fica no rodapé do dia. */
  concluido: boolean;
  organizationId: string;
  organizacao: string;
  bairro: string | null;
  cidade: string | null;
  /** `organizations.address`. Hoje é nulo em toda a base: ver `consultaDoMapa`. */
  endereco: string | null;
  categoria: string | null;
  temperatura: Temperature;
  precisaAtencao: boolean;
  dealId: string | null;
  pipelineId: number | null;
  etapa: string | null;
  etapaId: number | null;
  diasSemContato: number | null;
  /** `organizations.do_not_contact`: a folha de desfecho corta o que criaria tarefa. */
  naoContatar: boolean;
};

export type NaturezaDoCompromisso = 'marcado' | 'visita' | 'a_marcar';

/** O dia em foco, sempre `YYYY-MM-DD` no fuso de Natal. */
export type Dia = string;

export type Visao = 'dia' | 'semana';

// ---------------------------------------------------------------------------
// Calendário: aritmética de dias civis, sem depender do fuso do aparelho
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` → meia-noite UTC do mesmo dia civil (aritmética de calendário pura). */
function meiaNoiteUtc(dia: Dia): number {
  const [ano = 1970, mes = 1, d = 1] = dia.split('-').map(Number);
  return Date.UTC(ano, mes - 1, d);
}

export function somarDias(dia: Dia, dias: number): Dia {
  return new Date(meiaNoiteUtc(dia) + dias * 86_400_000).toISOString().slice(0, 10);
}

/** 1 = segunda … 7 = domingo (ISO 8601, como o `isodow` do Postgres). */
export function diaDaSemana(dia: Dia): number {
  const domingoZero = new Date(meiaNoiteUtc(dia)).getUTCDay();
  return domingoZero === 0 ? 7 : domingoZero;
}

/** A segunda-feira da semana que contém `dia`. */
export function inicioDaSemana(dia: Dia): Dia {
  return somarDias(dia, 1 - diaDaSemana(dia));
}

/** Os sete dias da semana que começa em `inicio`, de segunda a domingo. */
export function diasDaSemana(inicio: Dia): Dia[] {
  return Array.from({ length: 7 }, (_, i) => somarDias(inicio, i));
}

export function ehFimDeSemana(dia: Dia): boolean {
  return diaDaSemana(dia) > 5;
}

/** Hoje, em `America/Fortaleza`. Reusa a régua de `components/registro`. */
export function hojeEmNatal(agora: Date = new Date()): Dia {
  return diaEmFortaleza(agora);
}

/**
 * A janela de busca de um intervalo de dias, em instantes ISO com o deslocamento de
 * Fortaleza: `[00:00 do primeiro dia, 00:00 do dia seguinte ao último)`.
 */
export function janelaDeDias(primeiro: Dia, ultimo: Dia): { de: string; ate: string } {
  return {
    de: instanteEmFortaleza(primeiro, 0),
    ate: instanteEmFortaleza(somarDias(ultimo, 1), 0),
  };
}

const FUSO = 'America/Fortaleza';

const SEMANA_CURTA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' });
const DIA_POR_EXTENSO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  weekday: 'long',
  day: '2-digit',
  month: 'long',
});
const DIA_E_MES = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
});

/** "seg", "ter"… sem o ponto que o pt-BR acrescenta. */
export function rotuloSemanaCurto(dia: Dia): string {
  return SEMANA_CURTA.format(new Date(meiaNoiteUtc(dia))).replace('.', '');
}

/** O número do dia, para a tira da semana. Vai em IBM Plex Mono. */
export function numeroDoDia(dia: Dia): string {
  return dia.slice(8, 10);
}

/** "quinta-feira, 10 de setembro". */
export function rotuloDiaPorExtenso(dia: Dia): string {
  return DIA_POR_EXTENSO.format(new Date(meiaNoiteUtc(dia)));
}

/** "10/09". */
export function rotuloDiaCurto(dia: Dia): string {
  return DIA_E_MES.format(new Date(meiaNoiteUtc(dia)));
}

/** "07/09 a 13/09" — o título da tira de navegação. */
export function rotuloDaSemana(inicio: Dia): string {
  return `${rotuloDiaCurto(inicio)} a ${rotuloDiaCurto(somarDias(inicio, 6))}`;
}

const HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
});

/** "10:30", sempre no relógio de Natal, seja qual for o fuso do aparelho. */
export function horaEmNatal(iso: string): string {
  const quando = new Date(iso);
  return Number.isNaN(quando.getTime()) ? '--:--' : HORA.format(quando);
}

/** O dia civil (em Natal) de um instante ISO. */
export function diaDoInstante(iso: string): Dia {
  return diaEmFortaleza(new Date(iso));
}

// ---------------------------------------------------------------------------
// Recortes da lista
// ---------------------------------------------------------------------------

/**
 * Ordem estável da lista: relógio, depois nome, depois id.
 *
 * O desempate por nome não é enfeite: cinco visitas do mesmo dia nascem todas às
 * 09:00 (a régua do catálogo põe a tarefa no começo do expediente), e sem critério de
 * desempate a ordem passa a ser a que o Postgres devolveu naquela consulta — a mesma
 * tela desenhava os bairros em ordens diferentes a cada carregamento.
 */
export function compararCompromissos(a: Compromisso, b: Compromisso): number {
  return (
    a.quando.localeCompare(b.quando) ||
    a.organizacao.localeCompare(b.organizacao, 'pt-BR') ||
    a.taskId.localeCompare(b.taskId)
  );
}

export type BlocosDoDia = {
  marcados: Compromisso[];
  visitas: Compromisso[];
  aMarcar: Compromisso[];
  concluidos: Compromisso[];
};

/**
 * Os quatro blocos do dia. Concluído sai dos três primeiros e desce para o rodapé:
 * depois do registro o negócio já mudou de etapa, e reclassificar pela etapa NOVA
 * faria o cartão que ela acabou de registrar pular de seção na frente dela.
 */
export function blocosDoDia(itens: readonly Compromisso[]): BlocosDoDia {
  const porHora = [...itens].sort(compararCompromissos);
  return {
    marcados: porHora.filter((c) => !c.concluido && c.natureza === 'marcado'),
    visitas: porHora.filter((c) => !c.concluido && c.natureza === 'visita'),
    aMarcar: porHora.filter((c) => !c.concluido && c.natureza === 'a_marcar'),
    concluidos: porHora.filter((c) => c.concluido),
  };
}

export type GrupoDeBairro = { bairro: string; itens: Compromisso[] };

export const BAIRRO_SEM_NOME = 'Bairro não informado';

/**
 * As visitas do dia agrupadas por bairro (RF-ROT-03).
 *
 * NÃO é roteirização: não há geocodificação na base (`lat`/`lng` são nulos em 100 de
 * 100 organizações, e o RF-ROT-01 é justamente o que ainda não rodou), então ordenar
 * por "vizinho mais próximo" seria inventar distância. A ordem dentro do grupo é a do
 * relógio; os grupos vêm na ordem do primeiro horário de cada bairro. O bairro sem
 * nome fica sempre por último, porque não ajuda a decidir o caminho.
 */
export function agruparPorBairro(visitas: readonly Compromisso[]): GrupoDeBairro[] {
  const grupos = new Map<string, Compromisso[]>();
  for (const visita of [...visitas].sort(compararCompromissos)) {
    const bairro = visita.bairro?.trim() || BAIRRO_SEM_NOME;
    const atual = grupos.get(bairro);
    if (atual) atual.push(visita);
    else grupos.set(bairro, [visita]);
  }
  const lista = [...grupos].map(([bairro, itens]) => ({ bairro, itens }));
  return lista.sort((a, b) => {
    if (a.bairro === BAIRRO_SEM_NOME) return 1;
    if (b.bairro === BAIRRO_SEM_NOME) return -1;
    return (
      (a.itens[0]?.quando ?? '').localeCompare(b.itens[0]?.quando ?? '') ||
      a.bairro.localeCompare(b.bairro, 'pt-BR')
    );
  });
}

/** Quantos compromissos abertos cada dia da semana tem, para a tira de navegação. */
export function contarPorDia(itens: readonly Compromisso[]): Map<Dia, number> {
  const contagem = new Map<Dia, number>();
  for (const item of itens) {
    if (item.concluido) continue;
    const dia = diaDoInstante(item.quando);
    contagem.set(dia, (contagem.get(dia) ?? 0) + 1);
  }
  return contagem;
}

/** O primeiro compromisso aberto a partir de agora, para o estado vazio ter saída. */
export function proximoCompromisso(
  itens: readonly Compromisso[],
  agoraIso: string,
): Compromisso | null {
  return (
    [...itens].filter((c) => !c.concluido && c.quando >= agoraIso).sort(compararCompromissos)[0] ??
    null
  );
}

// ---------------------------------------------------------------------------
// O mapa
// ---------------------------------------------------------------------------

/**
 * O que vai na busca do Google Maps.
 *
 * Com endereço cadastrado, o endereço. Sem endereço — que é o caso de 100 das 100
 * organizações da base hoje —, o NOME do parceiro mais bairro e cidade, que é
 * exatamente o que a Heloísa digitaria no celular. O cartão diz qual dos dois foi
 * usado, para ninguém sair achando que tem número e rua.
 */
export function consultaDoMapa(c: Compromisso): string {
  const local = [c.bairro, c.cidade ?? 'Natal', 'RN'].filter(Boolean).join(', ');
  return c.endereco?.trim() ? `${c.endereco}, ${local}` : `${c.organizacao}, ${local}`;
}

export function linkDoMapa(c: Compromisso): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(consultaDoMapa(c))}`;
}

/** `true` quando o link do mapa é uma busca pelo nome, e não por endereço. */
export function mapaPorNome(c: Compromisso): boolean {
  return !c.endereco?.trim();
}

// ---------------------------------------------------------------------------
// Os três desfechos que a agenda oferece, tirados do catálogo
// ---------------------------------------------------------------------------

/**
 * "Realizada", "Não compareceu" e "Reagendar" recortados do próprio
 * `public.interaction_outcomes`, e não de uma lista de slugs em código — o gestor
 * edita o catálogo (RF-ADM-02) e a agenda tem de desenhar o que vier.
 *
 * A régua dos recortes vem de dois campos que o catálogo já declara:
 *
 * - `reagendar`: os desfechos de `SLUGS_REUNIAO_AGENDADA` (os únicos que exigem
 *   `meeting_at` e movem para a etapa de reunião marcada);
 * - `ausente`: os que afirmam `ninguem` em `COM_QUEM_AFIRMADO_PELO_DESFECHO`, isto é,
 *   os que dizem que não havia ninguém do outro lado — "No-show" na reunião,
 *   "Não estava / fechado" na visita;
 * - `realizada`: todo o resto da superfície, que é o que se registra depois de uma
 *   conversa que aconteceu.
 *
 * O filtro de `do_not_contact` é o mesmo da tela de campo (`desfechosOferecidos`):
 * para quem pediu para sair, sobra só o que não cria tarefa nova.
 */
export function recortesDoCompromisso(
  catalogo: readonly DesfechoCatalogo[],
  compromisso: Compromisso,
): { realizada: DesfechoCatalogo[]; ausente: DesfechoCatalogo[]; reagendar: DesfechoCatalogo[] } {
  const superficie = compromisso.tipo === 'visita' ? 'visita' : 'reuniao';
  const daSuperficie = desfechosOferecidos(catalogo, superficie, compromisso.naoContatar);

  const reagendar = daSuperficie.filter((d) =>
    (SLUGS_REUNIAO_AGENDADA as readonly string[]).includes(d.slug),
  );
  const ausente = daSuperficie.filter(
    (d) => comQuemPadrao(d) === 'ninguem' && !reagendar.includes(d),
  );
  const realizada = daSuperficie.filter((d) => !reagendar.includes(d) && !ausente.includes(d));

  return { realizada, ausente, reagendar };
}

/** O que a folha de desfecho está perguntando. */
export type PedidoDeDesfecho = {
  compromisso: Compromisso;
  titulo: string;
  descricao: string;
  opcoes: DesfechoCatalogo[];
};
