/**
 * Tradução e formatação da tela de Admin.
 *
 * Aqui mora tudo que transforma o vocabulário do banco (inglês, slugs, `INSERT`) na
 * língua de quem usa o CRM. É lógica pura, sem React e sem Supabase, para poder ser
 * testada no Vitest — e porque um rótulo errado na auditoria é um erro de leitura de
 * registro legal, não um detalhe de interface.
 *
 * Todo horário sai em `America/Fortaleza` (CLAUDE.md): o time está em Natal, e um
 * registro de auditoria com a hora de outro fuso não serve para responder "quem mexeu
 * nisso hoje de manhã?".
 */
import { TIMEZONE } from '@komune/schema';

const DATA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: TIMEZONE,
});

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});

const NUMERO = new Intl.NumberFormat('pt-BR');

export function formatarNumero(n: number): string {
  return NUMERO.format(n);
}

export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '';
  return DATA.format(new Date(iso));
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '';
  return DATA_HORA.format(new Date(iso));
}

/**
 * Data de coluna `date` (feriados), que chega como "2026-09-07" e NÃO é um instante.
 *
 * `new Date('2026-09-07')` é meia-noite em UTC, ou seja 21:00 do dia 6 em Fortaleza:
 * o feriado da Independência apareceria como 06/09. Por isso a data pura é fatiada,
 * nunca convertida.
 */
export function formatarDataPura(data: string | null | undefined): string {
  if (!data) return '';
  const [ano, mes, dia] = data.slice(0, 10).split('-');
  if (!ano || !mes || !dia) return data;
  return `${dia}/${mes}/${ano}`;
}

/** Dia da semana de uma data pura, para o feriado dizer se cai em dia útil. */
export function diaDaSemana(data: string | null | undefined): string {
  if (!data) return '';
  const [ano, mes, dia] = data.slice(0, 10).split('-').map(Number);
  if (!ano || !mes || !dia) return '';
  const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  // Data em UTC lida em UTC: sem fuso no meio, o dia da semana é o do calendário.
  return nomes[new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()] ?? '';
}

/**
 * Começo e fim de um dia de Natal, em ISO, para filtrar `created_at`.
 *
 * O Brasil não tem mais horário de verão e Fortaleza é UTC-03 o ano inteiro, então o
 * deslocamento fixo é correto e evita depender de biblioteca de fuso no navegador.
 */
export function intervaloDoDia(dia: string): { de: string; ate: string } {
  const inicio = new Date(`${dia}T00:00:00-03:00`);
  const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
  return { de: inicio.toISOString(), ate: fim.toISOString() };
}

/** Hoje em Natal, no formato do `<input type="date">`. */
export function hojeEmNatal(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
  return partes;
}

/** Nome de tabela do Postgres → o nome que o time usa. */
const NOME_DA_TABELA: Record<string, string> = {
  organizations: 'Parceiro',
  deals: 'Negócio',
  activities: 'Atividade',
  tasks: 'Tarefa',
  contacts: 'Pessoa de contato',
  profiles: 'Acesso de pessoa',
  allowed_users: 'Lista de permitidos',
  allowed_domains: 'Domínio permitido',
  consent_events: 'Consentimento',
  suppression_list: 'Lista de supressão',
  interaction_outcomes: 'Desfecho de interação',
  message_templates: 'Modelo de mensagem',
  categories: 'Categoria',
  cities: 'Cidade',
  holidays: 'Feriado',
  lost_reasons: 'Motivo de perda',
  stages: 'Etapa',
  stage_equivalences: 'Equivalência de etapa',
  goals: 'Meta',
  deal_stage_history: 'Passagem de etapa',
  // Tabelas dos outros módulos do MVP: sem rótulo, a auditoria mostraria o nome em
  // inglês do Postgres no meio de uma frase em português.
  call_batches: 'Lote de ligações',
  call_batch_items: 'Item do lote de ligações',
  call_attempts: 'Tentativa de ligação',
  call_scripts: 'Roteiro de ligação',
  supplier_candidates: 'Candidato do Radar',
  organization_categories: 'Categoria do parceiro',
  organization_contacts: 'Contato do parceiro',
  organization_tags: 'Etiqueta do parceiro',
  audio_assets: 'Áudio da Heloísa',
  teams: 'Time',
  tags: 'Etiqueta',
  sources: 'Origem',
  pipelines: 'Funil',
};

export function rotuloDaTabela(tabela: string): string {
  return NOME_DA_TABELA[tabela] ?? tabela;
}

export function rotuloDaAcao(acao: string): string {
  if (acao === 'INSERT') return 'Criou';
  if (acao === 'UPDATE') return 'Alterou';
  if (acao === 'DELETE') return 'Apagou';
  return acao;
}

/** Ações do registro de acesso a telefone (`pii_access_log.action`). */
export function rotuloDoAcesso(acao: string): string {
  if (acao === 'reveal_phone') return 'Revelou o telefone do parceiro';
  if (acao === 'view_contact_phone') return 'Revelou o telefone de um contato';
  if (acao === 'export_csv') return 'Exportou uma lista';
  if (acao === 'bulk_view') return 'Abriu muitas fichas de uma vez';
  return acao;
}

export function rotuloDoTipoSuprimido(tipo: string): string {
  if (tipo === 'phone') return 'Telefone';
  if (tipo === 'cnpj') return 'CNPJ';
  if (tipo === 'instagram') return 'Instagram';
  return tipo;
}

export function rotuloDoMotivoSuprimido(motivo: string | null): string {
  if (!motivo) return 'Sem motivo registrado';
  if (motivo === 'contact_optout') return 'Pediu para parar';
  if (motivo === 'hard_no') return 'Não firme';
  if (motivo === 'invalid') return 'Número inválido';
  return motivo;
}

export function rotuloDoCanal(canal: string | null): string {
  if (!canal) return 'Sem canal';
  const canais: Record<string, string> = {
    whatsapp: 'WhatsApp',
    ligacao: 'Ligação',
    visita: 'Visita',
    reuniao: 'Reunião',
    instagram_dm: 'DM do Instagram',
    email: 'E-mail',
    sistema: 'Sistema',
    outro: 'Outro',
  };
  return canais[canal] ?? canal;
}

export function rotuloDaSuperficie(superficie: string): string {
  return rotuloDoCanal(superficie);
}

export function rotuloDaTemperatura(temperatura: string | null): string {
  if (!temperatura) return '';
  const mapa: Record<string, string> = {
    frio: 'Frio',
    morno: 'Morno',
    quente: 'Quente',
    cliente: 'Cliente',
    cliente_ativo: 'Cliente ativo',
  };
  return mapa[temperatura] ?? temperatura;
}

export function rotuloDaPorta(contaComo: string): string {
  if (contaComo === 'aberta') return 'Porta aberta';
  if (contaComo === 'batida') return 'Porta batida';
  return 'Não conta';
}

export function rotuloDoGrupo(grupo: string): string {
  const mapa: Record<string, string> = {
    alimentos_bebidas: 'Alimentos e bebidas',
    infraestrutura: 'Infraestrutura',
    servicos: 'Serviços',
    locais: 'Locais',
    recreacao: 'Recreação',
    producao: 'Produção',
  };
  return mapa[grupo] ?? grupo;
}

export function rotuloDaPrioridade(prioridade: number): string {
  if (prioridade === 1) return 'Alta';
  if (prioridade === 2) return 'Média';
  return 'Baixa';
}

export function rotuloDoEscopo(escopo: string): string {
  const mapa: Record<string, string> = {
    nacional: 'Nacional',
    estadual: 'Estadual (RN)',
    municipal: 'Municipal (Natal)',
  };
  return mapa[escopo] ?? escopo;
}

export function rotuloDaCategoriaDeModelo(categoria: string): string {
  const mapa: Record<string, string> = {
    marketing: 'Marketing',
    utility: 'Utilidade',
    authentication: 'Autenticação',
    service: 'Atendimento',
    internal: 'Interno',
  };
  return mapa[categoria] ?? categoria;
}

export function rotuloDoSegmento(segmento: string | null): string {
  if (!segmento) return 'Geral';
  const mapa: Record<string, string> = {
    AEB: 'Alimentos e bebidas',
    INF: 'Infraestrutura',
    PRE: 'Prestadores',
    ESP: 'Espaços',
    CER: 'Cerimonialistas',
    FOR: 'Formaturas',
    GEN: 'Geral',
  };
  return mapa[segmento] ?? segmento;
}

/** Janela de silêncio do desfecho, em português. 36500 dias é "para sempre". */
export function rotuloDoSilencio(dias: number): string {
  if (dias >= 3650) return 'Para sempre';
  if (dias === 0) return 'Sem espera';
  if (dias === 1) return '1 dia';
  return `${dias} dias`;
}

/**
 * Campos cujo VALOR nunca é exibido na auditoria.
 *
 * O `audit_log` guarda a linha inteira, telefone incluído. Mostrar o valor antigo e o
 * novo transformaria a auditoria num atalho para ler telefone sem passar pela RPC
 * `reveal_phone` — exatamente o caminho que o RF-BAS-14 existe para fechar. A
 * auditoria diz QUE o telefone mudou; para VER o número, a ficha do parceiro, onde a
 * revelação fica registrada.
 */
export const CAMPOS_OCULTOS = new Set([
  'phone_e164',
  'email',
  'cnpj',
  'instagram_handle',
  'address',
  'lat',
  'lng',
  'body',
  'evidence_text',
  'notes',
  'ai_summary',
  'ai_next_action',
  'hash',
  'search_name',
  'legal_name',
  'website',
  'source_url',
  'custom',
]);

/** Campos de controle que mudam em toda escrita e não dizem nada a quem lê. */
const CAMPOS_IGNORADOS = new Set([
  'updated_at',
  'created_at',
  'search_name',
  'score_breakdown',
  'website_domain',
]);

const NOME_DO_CAMPO: Record<string, string> = {
  name: 'nome',
  full_name: 'nome',
  role: 'papel',
  is_active: 'acesso ativo',
  team_id: 'time',
  city_id: 'cidade',
  stage_id: 'etapa',
  pipeline_id: 'funil',
  owner_id: 'responsável',
  status: 'situação',
  temperature: 'temperatura',
  temperature_override: 'temperatura forçada',
  do_not_contact: 'não contatar',
  vip: 'VIP',
  tier: 'tier',
  score: 'pontuação',
  next_action: 'próxima ação',
  next_action_at: 'data da próxima ação',
  last_activity_at: 'último contato',
  last_intent: 'última intenção',
  lost_reason_id: 'motivo de perda',
  entered_stage_at: 'entrada na etapa',
  needs_attention: 'precisa de atenção',
  phone_e164: 'telefone',
  email: 'e-mail',
  cnpj: 'CNPJ',
  instagram_handle: 'Instagram',
  body: 'texto',
  outcome_id: 'desfecho',
  due_at: 'prazo',
  assignee_id: 'responsável pela tarefa',
  won_at: 'ganho em',
  lost_at: 'perdido em',
  paused_until: 'pausado até',
  stage_change_reason: 'motivo da mudança de etapa',
  last_intent_at: 'última intenção em',
  primary_contact_id: 'contato principal',
  source_id: 'origem',
  is_natural_person: 'é pessoa física',
  anonymized_at: 'anonimizado em',
  deleted_at: 'apagado em',
  komune_supplier_id: 'fornecedor na Komune',
  temperature_override_reason: 'motivo da temperatura forçada',
  temperature_override_at: 'temperatura forçada em',
  temperature_override_by: 'quem forçou a temperatura',
  daily_digest_at: 'horário do resumo diário',
  title: 'título',
  kind: 'tipo',
  origin: 'de onde veio',
  priority: 'prioridade',
  position: 'ordem',
  scope: 'alcance',
  date: 'data',
  note: 'observação',
  default_role: 'papel padrão',
  is_metro_natal: 'Grande Natal',
  cooldown_days: 'janela de silêncio',
  can_reactivate: 'pode reativar',
  target_stage_slug: 'etapa de destino',
  sets_temperature: 'temperatura que aplica',
  counts_as: 'conta como',
  requires_lost_reason: 'exige motivo de perda',
  surfaces: 'canais',
  next_action_label: 'rótulo da próxima ação',
  next_action_offset_days: 'prazo da próxima ação',
  template_code: 'código do modelo',
  meta_status: 'situação na Meta',
  channel: 'canal',
  category: 'categoria',
  segment: 'segmento',
  variant: 'variante',
  variables: 'variáveis',
  version: 'versão',
  language: 'idioma',
  total: 'total de alvos',
  pending: 'alvos na fila',
  talked: 'alvos falados',
  target_calls: 'meta de ligações',
  max_attempts: 'tentativas por alvo',
  min_hours_between_attempts: 'horas entre tentativas',
  order_mode: 'ordem da fila',
  starts_on: 'começa em',
  ends_on: 'termina em',
  script_id: 'roteiro',
  script_version: 'versão do roteiro',
  temperature_origin: 'temperatura de origem',
  nome: 'nome',
  seed: 'semente do sorteio',
};

export function rotuloDoCampo(campo: string): string {
  return NOME_DO_CAMPO[campo] ?? campo.replace(/_/g, ' ');
}

/** Um instante ISO vindo do banco (`2026-09-08T09:00:00-03:00`). */
const ISO_INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valor de campo como a pessoa lê, não como o Postgres guarda.
 *
 * Data e hora entram formatadas no fuso de Natal: um `2026-09-08T09:00:00-03:00`
 * cru no meio da auditoria obriga quem lê a decodificar ISO 8601 de cabeça para
 * responder "quando ficou a reunião?".
 */
function comoTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'boolean') return valor ? 'sim' : 'não';
  if (typeof valor === 'number') return String(valor);
  if (typeof valor === 'string') {
    if (ISO_INSTANTE.test(valor)) return formatarDataHora(valor);
    if (ISO_DATA.test(valor)) return formatarDataPura(valor);
    return valor;
  }
  return JSON.stringify(valor);
}

export type Mudanca = { campo: string; de: string | null; para: string | null; oculto: boolean };

/**
 * O que mudou entre a linha antiga e a nova, em campos legíveis.
 *
 * Campos sensíveis entram na lista (saber que o telefone mudou importa) mas com
 * `oculto: true` e sem valor nenhum. Campos de controle não entram: `updated_at` muda
 * em toda escrita e só faz barulho.
 */
export function diferencas(
  antes: Record<string, unknown> | null,
  depois: Record<string, unknown> | null,
): Mudanca[] {
  if (!antes || !depois) return [];
  const campos = new Set([...Object.keys(antes), ...Object.keys(depois)]);
  const mudancas: Mudanca[] = [];

  for (const campo of campos) {
    if (CAMPOS_IGNORADOS.has(campo)) continue;
    const de = comoTexto(antes[campo]);
    const para = comoTexto(depois[campo]);
    if (de === para) continue;
    const oculto = CAMPOS_OCULTOS.has(campo);
    mudancas.push({ campo, de: oculto ? null : de, para: oculto ? null : para, oculto });
  }

  return mudancas.sort((a, b) => a.campo.localeCompare(b.campo, 'pt-BR'));
}

/** Primeiros dígitos do hash da supressão: identifica a linha sem reconstruir o número. */
export function hashCurto(hash: string): string {
  return hash.slice(0, 12);
}

/**
 * Erro do Supabase em português, dizendo o que fazer.
 *
 * Texto cru do Postgres ("new row violates row-level security policy") não é
 * mensagem de erro: é log. Quem está na tela precisa saber se o problema é a conexão,
 * a sessão, a permissão ou uma regra do banco.
 */
export function mensagemDoErro(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : String(erro ?? '');

  if (/row-level security|permission denied|42501|not authorized/i.test(texto)) {
    return 'Seu acesso não alcança este registro. Peça a um admin (Rafael, Luiz ou Matheus).';
  }
  if (/jwt|session|autenticad/i.test(texto)) {
    return 'A sua sessão expirou. Entre de novo para continuar.';
  }
  if (/fetch|network|failed to fetch|timeout/i.test(texto)) {
    return 'O aplicativo não alcançou o servidor. Confira a conexão e tente de novo.';
  }
  if (/duplicate key|already exists|23505/i.test(texto)) {
    return 'Esse registro já existe na lista.';
  }
  if (/só admin/i.test(texto)) {
    return texto;
  }
  return texto ? `O servidor respondeu: ${texto}` : 'O servidor não respondeu.';
}
