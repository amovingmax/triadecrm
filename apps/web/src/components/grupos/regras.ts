import {
  TETO_DE_FIXADAS,
  TETO_DE_PESSOAS,
  type AcaoCrua,
  type ConversaParaConvite,
  type EstadoDoGrupo,
  type MensagemDoGrupoCrua,
  type ParticipanteCru,
  type PessoaDoTime,
} from './tipos';

/**
 * As regras dos grupos, sem React e sem rede: o que cada recusa do banco quer
 * dizer, a janela de 24 h, quantas pessoas cabem, quem mandou cada mensagem, o
 * fio com as reações e as citações no lugar, e o que está esperando a Meta.
 */

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

// ---------------------------------------------------------------------------
// O que o banco recusou, em português
// ---------------------------------------------------------------------------

export const JANELA_FECHADA =
  'Ninguém escreveu no grupo nas últimas 24 h: a Meta só deixa mandar mensagem livre depois que alguém do grupo escrever.';

/** A linha que explica a recusa mais comum da criação. */
export const AVISO_DA_CONTA_OFICIAL =
  'Grupo pelo WhatsApp só funciona com a conta oficial da Meta (o selo verde). Sem o selo, a Meta recusa.';

const FRASE_DO_MOTIVO: Readonly<Record<string, string>> = {
  sem_permissao: 'Seu perfil não mexe em grupos.',
  nome_de_1_a_128_letras: 'O nome do grupo vai de 1 a 128 letras.',
  descricao_longa_demais: 'A descrição passou de 2.048 letras.',
  sem_numero_do_whatsapp: 'O número da empresa ainda não está ligado ao CRM.',
  grupo_nao_esta_ativo: 'O grupo não está ativo no WhatsApp agora.',
  grupo_inexistente: 'Este grupo não existe mais.',
  nada_mudou: 'Nada mudou.',
  grupo_sem_link: 'O grupo ainda não tem link de convite. Toque em “Atualizar do WhatsApp”.',
  nenhum_pedido: 'Escolha pelo menos um pedido.',
  de_1_a_8_pessoas: 'Escolha de 1 a 8 pessoas.',
  tipo_nao_vai_para_grupo: 'Grupo aceita texto, foto, vídeo, áudio e documento.',
  texto_vazio: 'Escreva a mensagem.',
  sem_arquivo: 'Falta o arquivo.',
  tem_cpf: 'A mensagem tem um CPF. Tire antes de mandar.',
  janela_do_grupo_fechada: JANELA_FECHADA,
  citada_de_outro_grupo: 'A mensagem citada é de outro grupo.',
  mensagem_sem_id_na_meta:
    'Esta mensagem ainda não chegou ao WhatsApp. Espere ela sair para fixar.',
  de_1_a_30_dias: 'Fixe de 1 a 30 dias.',
};

/**
 * A frase de cada `motivo` das funções `grupo_*`. O convite numa conversa 1:1
 * devolve o texto da porteira de `messages` (`sqlerrm`), e ele é lido pelo que
 * contém: a janela, o opt-out, o horário e o teto são as recusas que acontecem.
 */
export function fraseDoMotivo(motivo: string | null | undefined): string {
  const m = (motivo ?? '').trim();
  if (m === '') return 'Não deu certo. Tente de novo em alguns segundos.';
  const exata = FRASE_DO_MOTIVO[m];
  if (exata) return exata;
  const minusculo = m.toLowerCase();
  if (minusculo.includes('sem_janela') || minusculo.includes('janela')) {
    return 'A conversa está fora da janela de 24 h: o convite só vai para quem escreveu nas últimas 24 h.';
  }
  if (
    minusculo.includes('supress') ||
    minusculo.includes('opt') ||
    minusculo.includes('nao_contatar')
  ) {
    return 'Esta pessoa pediu para não receber mensagem.';
  }
  if (minusculo.includes('fechada') || minusculo.includes('bloque')) {
    return 'Esta conversa está fechada ou bloqueada.';
  }
  if (minusculo.includes('teto')) return 'O teto de mensagens do dia já foi atingido.';
  if (minusculo.includes('permission') || minusculo.includes('permissao')) {
    return 'Seu perfil não manda mensagem nesta conversa.';
  }
  return 'O WhatsApp do CRM recusou agora. Tente de novo em alguns minutos.';
}

// ---------------------------------------------------------------------------
// Estado, janela e lotação
// ---------------------------------------------------------------------------

/** O selo da lista. Grupo ativo não tem selo: é o normal. */
export const ROTULO_DO_ESTADO: Readonly<Record<EstadoDoGrupo, string | null>> = {
  ativo: null,
  criando: 'criando',
  falhou: 'não criado',
  suspenso: 'suspenso',
  apagado: 'apagado',
};

/** A janela do grupo: alguém do grupo escreveu nas últimas 24 h. */
export function janelaDoGrupo(
  ultimaRecebidaEm: string | null,
  agora: Date = new Date(),
): { aberta: boolean; fechaEm: Date | null; restaMs: number } {
  if (!ultimaRecebidaEm) return { aberta: false, fechaEm: null, restaMs: 0 };
  const fecha = Date.parse(ultimaRecebidaEm) + DIA_MS;
  if (!Number.isFinite(fecha)) return { aberta: false, fechaEm: null, restaMs: 0 };
  const resta = fecha - agora.getTime();
  return { aberta: resta > 0, fechaEm: new Date(fecha), restaMs: Math.max(0, resta) };
}

/** A conversa 1:1 aceita mensagem livre (e, portanto, o convite)? */
export function conversaAceitaConvite(
  conversa: Pick<ConversaParaConvite, 'last_inbound_at' | 'window_expires_at'>,
  agora: Date = new Date(),
): boolean {
  const ate = conversa.window_expires_at
    ? Date.parse(conversa.window_expires_at)
    : conversa.last_inbound_at
      ? Date.parse(conversa.last_inbound_at) + DIA_MS
      : Number.NaN;
  return Number.isFinite(ate) && ate > agora.getTime();
}

export function participantesAtivos(participantes: readonly ParticipanteCru[]): ParticipanteCru[] {
  return participantes.filter((p) => p.saiu_em === null);
}

/**
 * Quantas pessoas estão no grupo, contando o número da empresa (o teto da Meta,
 * 8, conta o próprio número). A lista do CRM só conhece quem já escreveu, entrou
 * pelo link depois da criação ou veio na última sincronização; quando a Meta diz
 * um total maior (`participantes_total`), vale o dela.
 */
export function contarPessoas(
  participantes: readonly ParticipanteCru[],
  totalDaMeta: number | null,
): { pessoas: number; vagas: number; cheio: boolean } {
  const pessoas = Math.max(participantesAtivos(participantes).length + 1, totalDaMeta ?? 0);
  const vagas = Math.max(0, TETO_DE_PESSOAS - pessoas);
  return { pessoas, vagas, cheio: vagas === 0 };
}

// ---------------------------------------------------------------------------
// Quem é quem
// ---------------------------------------------------------------------------

/** `5584999998801` → `+55 84 99999-8801`. Fora do Brasil, só os dígitos com `+`. */
export function telefoneLegivel(waId: string | null | undefined): string {
  const d = (waId ?? '').replace(/\D/g, '');
  if (d === '') return 'Número oculto';
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const resto = d.slice(4);
    const corte = resto.length - 4;
    return `+55 ${ddd} ${resto.slice(0, corte)}-${resto.slice(corte)}`;
  }
  return `+${d}`;
}

/** O nome que o participante pôs no WhatsApp, ou o número dele. */
export function nomeDoParticipante(
  waId: string | null,
  participantes: readonly ParticipanteCru[],
  nomeNaMensagem: string | null = null,
): string {
  const doNome = nomeNaMensagem?.trim();
  if (doNome) return doNome;
  const p = waId ? participantes.find((x) => x.wa_id === waId) : undefined;
  return p?.nome?.trim() || telefoneLegivel(waId);
}

/** Quem mandou: o participante (recebida) ou a pessoa do time (enviada). */
export function quemMandou(
  m: Pick<MensagemDoGrupoCrua, 'direction' | 'de_wa_id' | 'de_nome' | 'sent_by'>,
  participantes: readonly ParticipanteCru[],
  pessoas: readonly PessoaDoTime[],
): string {
  if (m.direction === 'in') return nomeDoParticipante(m.de_wa_id, participantes, m.de_nome);
  return pessoas.find((p) => p.id === m.sent_by)?.nome ?? 'Alguém do time';
}

/** "Maria entrou", "Maria saiu", "Maria foi tirada do grupo". */
export function fraseDoEvento(
  m: Pick<MensagemDoGrupoCrua, 'conteudo' | 'de_wa_id' | 'de_nome'>,
  participantes: readonly ParticipanteCru[],
): string {
  const conteudo =
    m.conteudo !== null && typeof m.conteudo === 'object' && !Array.isArray(m.conteudo)
      ? (m.conteudo as Record<string, unknown>)
      : {};
  const quem = nomeDoParticipante(m.de_wa_id, participantes, m.de_nome);
  switch (conteudo.evento) {
    case 'entrou':
      return `${quem} entrou`;
    case 'saiu':
      return `${quem} saiu`;
    case 'removido':
      return `${quem} foi tirado do grupo`;
    default:
      return 'Mudança no grupo';
  }
}

// ---------------------------------------------------------------------------
// O fio: reações e citações no lugar
// ---------------------------------------------------------------------------

export type ItemDoFio =
  | {
      tipo: 'mensagem';
      mensagem: MensagemDoGrupoCrua;
      /** A mensagem que esta cita, se está no que foi carregado. */
      citada: MensagemDoGrupoCrua | null;
      /** As reações a esta mensagem, uma por emoji, com quantas pessoas. */
      reacoes: { emoji: string; quantas: number }[];
    }
  | { tipo: 'evento'; mensagem: MensagemDoGrupoCrua };

export function estaFixada(
  m: Pick<MensagemDoGrupoCrua, 'fixada_ate' | 'apagada_em'>,
  agora: Date = new Date(),
): boolean {
  return (
    m.apagada_em === null && m.fixada_ate !== null && Date.parse(m.fixada_ate) > agora.getTime()
  );
}

/**
 * O fio do grupo como a tela desenha: as reações saem do meio da conversa e vão
 * para baixo do balão reagido (a última de cada pessoa vale; reação vazia é
 * reação desfeita), a citação ganha a mensagem citada, e as linhas de sistema
 * ("Maria entrou") viram eventos. A ordem é a de chegada.
 */
export function montarFio(
  mensagens: readonly MensagemDoGrupoCrua[],
  agora: Date = new Date(),
): { itens: ItemDoFio[]; fixadas: MensagemDoGrupoCrua[] } {
  const porId = new Map(mensagens.map((m) => [m.id, m]));

  // A última reação de cada pessoa a cada mensagem.
  const ultimaReacao = new Map<string, Map<string, string>>();
  for (const m of mensagens) {
    if (m.type !== 'reaction' || !m.reage_a) continue;
    const quem = m.direction === 'in' ? `in:${m.de_wa_id ?? '?'}` : `out:${m.sent_by ?? 'time'}`;
    const doAlvo = ultimaReacao.get(m.reage_a) ?? new Map<string, string>();
    doAlvo.set(quem, (m.body ?? '').trim());
    ultimaReacao.set(m.reage_a, doAlvo);
  }

  const itens: ItemDoFio[] = [];
  for (const m of mensagens) {
    if (m.type === 'reaction') continue;
    if (m.type === 'system') {
      itens.push({ tipo: 'evento', mensagem: m });
      continue;
    }
    const contagem = new Map<string, number>();
    for (const emoji of ultimaReacao.get(m.id)?.values() ?? []) {
      if (emoji !== '') contagem.set(emoji, (contagem.get(emoji) ?? 0) + 1);
    }
    itens.push({
      tipo: 'mensagem',
      mensagem: m,
      citada: m.responde_a ? (porId.get(m.responde_a) ?? null) : null,
      reacoes: [...contagem].map(([emoji, quantas]) => ({ emoji, quantas })),
    });
  }

  const fixadas = mensagens.filter((m) => m.type !== 'reaction' && estaFixada(m, agora));
  return { itens, fixadas };
}

/** Dá para fixar esta? A Meta exige a mensagem lá (com id) e no máximo 3 fixadas. */
export function podeFixar(
  m: Pick<MensagemDoGrupoCrua, 'wa_message_id' | 'apagada_em' | 'type'>,
  fixadasAgora: number,
): { ok: true } | { ok: false; porque: string } {
  if (m.apagada_em !== null) return { ok: false, porque: 'Mensagem apagada não se fixa.' };
  if (m.type === 'system') return { ok: false, porque: 'Aviso do grupo não se fixa.' };
  if (!m.wa_message_id) return { ok: false, porque: 'Espere a mensagem sair para fixar.' };
  if (fixadasAgora >= TETO_DE_FIXADAS) {
    return { ok: false, porque: `Já há ${TETO_DE_FIXADAS} fixadas: desafixe uma antes.` };
  }
  return { ok: true };
}

/** O estado de entrega, na palavra da pessoa. Em grupo, vale o primeiro que leu. */
export function entregaNoGrupo(
  m: Pick<MensagemDoGrupoCrua, 'direction' | 'status'>,
): { rotulo: string; tom: 'normal' | 'espera' | 'falha' } | null {
  if (m.direction === 'in') return null;
  switch (m.status) {
    case 'queued':
      return { rotulo: 'na fila', tom: 'espera' };
    case 'sent':
      return { rotulo: 'enviada', tom: 'normal' };
    case 'delivered':
      return { rotulo: 'entregue', tom: 'normal' };
    case 'read':
      return { rotulo: 'lida', tom: 'normal' };
    case 'failed':
      return { rotulo: 'não saiu', tom: 'falha' };
    default:
      return null;
  }
}

/**
 * O texto sem a assinatura "*Ana:*" da primeira linha, que é como o grupo vê no
 * WhatsApp: no CRM, quem escreveu já está em cima do balão.
 */
export function semAssinatura(texto: string | null): string {
  return (texto ?? '').replace(/^\*[^*\n]{1,60}:\*[ \t]*\n/, '');
}

/** A primeira linha do texto, sem a assinatura, para citação e fixadas. */
export function primeiraLinha(texto: string | null, teto = 80): string {
  const limpo = semAssinatura(texto).trim();
  const linha = limpo.split('\n')[0]?.trim() ?? '';
  return linha.length > teto ? `${linha.slice(0, teto)}…` : linha;
}

/** O que mostrar no lugar do texto quando a mensagem é só arquivo. */
export function resumoDaMensagem(
  m: Pick<MensagemDoGrupoCrua, 'type' | 'body' | 'media_nome' | 'apagada_em'>,
): string {
  if (m.apagada_em !== null) return 'Mensagem apagada';
  const texto = primeiraLinha(m.body);
  if (texto) return texto;
  switch (m.type) {
    case 'image':
      return 'Foto';
    case 'video':
      return 'Vídeo';
    case 'audio':
      return 'Áudio';
    case 'document':
      return m.media_nome ?? 'Documento';
    default:
      return 'Mensagem';
  }
}

// ---------------------------------------------------------------------------
// O que está esperando a Meta
// ---------------------------------------------------------------------------

export const ROTULO_DA_ACAO: Readonly<Record<string, string>> = {
  grupo_criar: 'criar o grupo',
  grupo_atualizar: 'mudar nome, descrição ou foto',
  grupo_apagar: 'apagar o grupo',
  grupo_convite: 'buscar o link',
  grupo_novo_convite: 'trocar o link',
  grupo_pedidos: 'buscar os pedidos de entrada',
  grupo_aprovar: 'aprovar a entrada',
  grupo_recusar: 'recusar a entrada',
  grupo_remover: 'tirar do grupo',
  grupo_sincronizar: 'atualizar do WhatsApp',
  grupo_fixar: 'fixar a mensagem',
  perfil_ler: 'ler o perfil',
  perfil_salvar: 'salvar o perfil',
};

/**
 * O que a tela diz sobre os pedidos à Meta de um grupo (ou do perfil): o que
 * ainda está na fila e, se o último pedido de algum tipo falhou nas últimas
 * 24 h, o porquê. Ler e "digitando…" ficam de fora (são invisíveis para quem
 * usa), e a mensagem também: o balão já mostra se ela saiu.
 */
export function situacaoDasAcoes(
  acoes: readonly AcaoCrua[],
  agora: Date = new Date(),
): { pendentes: string[]; falha: { rotulo: string; erro: string } | null } {
  const relevantes = acoes
    .filter((a) => ROTULO_DA_ACAO[a.tipo] !== undefined)
    .slice()
    .sort((a, b) => Date.parse(b.pedida_em) - Date.parse(a.pedida_em));

  const pendentes: string[] = [];
  for (const a of relevantes) {
    if (a.estado !== 'pendente' && a.estado !== 'fazendo') continue;
    const rotulo = ROTULO_DA_ACAO[a.tipo]!;
    if (!pendentes.includes(rotulo)) pendentes.push(rotulo);
  }

  // A falha que importa é a do ÚLTIMO pedido de cada tipo: se depois dela o
  // mesmo pedido deu certo, ela já passou.
  const vistos = new Set<string>();
  let falha: { rotulo: string; erro: string } | null = null;
  for (const a of relevantes) {
    if (vistos.has(a.tipo)) continue;
    vistos.add(a.tipo);
    const quando = Date.parse(a.feita_em ?? a.pedida_em);
    if (a.estado === 'falhou' && agora.getTime() - quando < DIA_MS && falha === null) {
      falha = {
        rotulo: ROTULO_DA_ACAO[a.tipo]!,
        erro: a.erro?.trim() || 'a Meta não disse por quê',
      };
    }
  }
  return { pendentes, falha };
}

/** Algum pedido ainda na fila? É o que liga a sondagem curta de `wa_acoes`. */
export function temPedidoNaFila(acoes: readonly AcaoCrua[]): boolean {
  return acoes.some((a) => a.estado === 'pendente' || a.estado === 'fazendo');
}

/** "pendente" de uma frase só: "Esperando a Meta: trocar o link e tirar do grupo." */
export function fraseDaFila(pendentes: readonly string[]): string | null {
  if (pendentes.length === 0) return null;
  const lista =
    pendentes.length === 1
      ? pendentes[0]
      : `${pendentes.slice(0, -1).join(', ')} e ${pendentes[pendentes.length - 1]}`;
  return `Esperando a Meta: ${lista}.`;
}

/** O id do grupo citado num evento do Realtime (`wa_grupos` ou `wa_grupo_mensagens`). */
export function grupoDoEvento(
  tabela: 'wa_grupos' | 'wa_grupo_mensagens',
  registro: unknown,
): string | null {
  if (registro === null || typeof registro !== 'object') return null;
  const r = registro as { id?: unknown; grupo_id?: unknown };
  const id = tabela === 'wa_grupos' ? r.id : r.grupo_id;
  return typeof id === 'string' && id !== '' ? id : null;
}
