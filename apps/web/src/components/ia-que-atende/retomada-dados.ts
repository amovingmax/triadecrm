import { createClient } from '@/lib/supabase/client';

import { CHAVE_DA_IA } from './dados';

/**
 * A IA que atende retoma o contato com o cliente que parou de responder (Imova,
 * 11/11/2026): o que a tela lê e pede ao banco. Quem decide e grava é o banco
 * (`public.ia_retomada_*`, que confere o papel de novo); a tela só mostra e configura.
 *
 *   - Dia 1: texto da IA, ainda dentro da janela de 24 h do WhatsApp.
 *   - Dias 2 em diante: modelo aprovado pela Meta, escolhido aqui.
 */

export const CHAVE_DA_RETOMADA = [...CHAVE_DA_IA, 'retomada'] as const;

export function chaveDaRetomadaNaConversa(fioId: string) {
  return [...CHAVE_DA_RETOMADA, 'conversa', fioId] as const;
}

/** Frase para a pessoa, a partir do motivo que o banco devolveu ao configurar. */
const MOTIVOS_DA_CONFIGURACAO: Readonly<Record<string, string>> = {
  sem_permissao: 'Ligar e configurar a retomada é da gestão (admin e gestor).',
  dias_invalidos: 'Os dias vão de 1 a 30, em ordem crescente, no máximo cinco.',
  modelos_invalidos: 'Modelo inválido para esse dia.',
  modelo_inexistente: 'Esse modelo não existe no CRM.',
  horas_invalidas: 'As horas do texto do dia 1 estão fora do limite.',
};

export class ErroDaRetomada extends Error {
  readonly motivo: string;
  constructor(motivo: string) {
    super(MOTIVOS_DA_CONFIGURACAO[motivo] ?? 'O servidor recusou o pedido.');
    this.name = 'ErroDaRetomada';
    this.motivo = motivo;
  }
}

/**
 * Por que uma retomada não saiu, como a equipe fala. O motivo do banco pode vir com
 * detalhe depois de dois-pontos ("porteira: …", "a_ia_decidiu_nao_retomar: …").
 */
const ROTULOS_DOS_MOTIVOS: Readonly<Record<string, string>> = {
  sem_horario_permitido_nas_24_horas: 'fora do horário de envio até fechar a janela de 24 h',
  passou_da_hora: 'passou da hora sem horário de envio',
  sem_modelo_escolhido: 'sem modelo escolhido',
  modelo_inexistente_ou_desligado: 'modelo inexistente ou desligado',
  modelo_nao_aprovado_na_meta: 'modelo ainda não aprovado pela Meta',
  variavel_que_a_retomada_nao_preenche: 'modelo com variável que a retomada não preenche',
  a_ia_decidiu_nao_retomar: 'a IA leu que o cliente encerrou',
  a_ia_nao_escreveu_a_tempo: 'a IA não escreveu a tempo',
  a_ia_nao_conseguiu_escrever: 'a IA não conseguiu escrever',
  texto_fora_das_regras: 'o texto da IA saiu fora das regras',
  dado_pessoal_na_conversa: 'a conversa tem dado pessoal que não vai para a IA',
  orcamento_de_ia_no_limite: 'orçamento de IA no limite',
  o_modelo_recusou: 'o modelo recusou',
  o_cliente_respondeu: 'o cliente respondeu antes',
  a_janela_de_24_horas_fechou: 'a janela de 24 h fechou',
  fora_do_horario_permitido: 'fora do horário de envio',
  porteira: 'recusada pela porteira do WhatsApp',
  a_ia_nao_atende: 'a IA não atende mais a conversa',
  visita_marcada: 'visita marcada',
  sem_leitura_da_ia: 'a IA não leu a conversa antes do modelo',
  a_ia_nao_leu_a_tempo: 'a IA não leu a conversa a tempo',
  intervalo_minimo_entre_etapas: 'perto demais da retomada anterior',
  conversa_concluida: 'conversa concluída',
  cliente_sem_interesse: 'cliente sem interesse',
  nao_contatar: 'não contatar',
  negocio_fechado: 'negócio ganho ou perdido',
  a_ia_nao_respondeu_o_cliente: 'a IA não respondeu o cliente',
};

export function rotuloDoMotivo(motivo: string | null | undefined): string {
  const bruto = (motivo ?? '').trim();
  if (bruto === '') return 'sem motivo registrado';
  const chave = bruto
    .split(':')[0]!
    .replace(/\s*\(.*\)$/, '')
    .trim();
  return ROTULOS_DOS_MOTIVOS[chave] ?? bruto.replace(/_/g, ' ');
}

/**
 * Os dias digitados ("1, 3, 7") na forma que o banco aceita: inteiros de 1 a 30, em
 * ordem crescente, sem repetir, de um a cinco. `null` quando não serve.
 */
export function lerDias(texto: string): number[] | null {
  const partes = texto
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (partes.length === 0 || partes.length > 5) return null;
  const dias: number[] = [];
  for (const p of partes) {
    if (!/^\d{1,2}$/.test(p)) return null;
    const d = Number(p);
    if (d < 1 || d > 30) return null;
    if (dias.length > 0 && d <= dias[dias.length - 1]!) return null;
    dias.push(d);
  }
  return dias;
}

const HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  hour: '2-digit',
  minute: '2-digit',
});
const DIA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  day: '2-digit',
  month: '2-digit',
});
const DIA_LOCAL = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Fortaleza',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "hoje, 14:00", "amanhã, 08:00" ou "13/11, 08:00", no relógio de Natal. */
export function quandoPorPerto(instante: string, agora: Date = new Date()): string {
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return '';
  const hoje = DIA_LOCAL.format(agora);
  const amanha = DIA_LOCAL.format(new Date(agora.getTime() + 24 * 3600 * 1000));
  const dia = DIA_LOCAL.format(d);
  const hora = HORA.format(d);
  if (d.getTime() <= agora.getTime()) return 'agora';
  if (dia === hoje) return `hoje, ${hora}`;
  if (dia === amanha) return `amanhã, ${hora}`;
  return `${DIA.format(d)}, ${hora}`;
}

async function pedir(
  funcao: string,
  argumentos: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await createClient().rpc(funcao as never, argumentos as never);
  if (error) throw new Error(error.message);
  const resposta = (data ?? {}) as Record<string, unknown>;
  if (resposta.ok === false) throw new ErroDaRetomada(String(resposta.motivo ?? 'recusado'));
  return resposta;
}

function numero(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

// ---------------------------------------------------------------------------
// O painel: a configuração, os modelos e o placar
// ---------------------------------------------------------------------------

export interface ModeloDaRetomada {
  readonly codigo: string;
  readonly nome: string;
  readonly ativo: boolean;
  /** approved, pending, rejected ou nao_enviado. */
  readonly situacao: string;
  readonly aprovado: boolean;
  readonly variaveis: readonly string[];
  /** Todas as variáveis são das que a retomada preenche (nome, imovel, saudacao). */
  readonly preenche: boolean;
  readonly corpo: string;
}

export interface PainelDaRetomada {
  readonly config: {
    readonly ligada: boolean;
    readonly ligadaEm: string | null;
    readonly dias: readonly number[];
    /** dias (como texto) → código do modelo. */
    readonly modelos: Readonly<Record<string, string>>;
    readonly textoDeHoras: number;
    readonly textoAteHoras: number;
    readonly intervaloMinHoras: number;
  };
  readonly podeConfigurar: boolean;
  readonly modelos: readonly ModeloDaRetomada[];
  readonly placar: {
    readonly enviadas: number;
    readonly porTexto: number;
    readonly porModelo: number;
    readonly falharam: number;
    readonly puladas: number;
    readonly encerradasPelaIa: number;
    readonly semModelo: number;
    readonly naFila: number;
    readonly clientes: number;
    /** Escreveram depois da retomada (reação não conta) e não pediram para sair. */
    readonly responderam: number;
    readonly pediramParaSair: number;
    /** Modelos que não saíram porque a IA não leu a conversa antes. */
    readonly semLeitura: number;
  };
  readonly motivos: readonly { readonly motivo: string; readonly n: number }[];
  readonly custoUsd: number;
}

export async function carregarPainelDaRetomada(dias = 7): Promise<PainelDaRetomada | null> {
  const { data, error } = await createClient().rpc(
    'ia_retomada_painel' as never,
    { p_dias: dias } as never,
  );
  if (error) throw new Error(error.message);
  const p = (data ?? {}) as Record<string, unknown>;
  if (p.existe !== true) return null;
  const c = (p.config ?? {}) as Record<string, unknown>;
  const placar = (p.placar ?? {}) as Record<string, unknown>;
  const modelosDaConfig = (c.modelos ?? {}) as Record<string, unknown>;
  return {
    config: {
      ligada: c.ligada === true,
      ligadaEm: texto(c.ligada_em),
      dias: Array.isArray(c.dias) ? c.dias.map(numero).filter((d) => d >= 1) : [1],
      modelos: Object.fromEntries(
        Object.entries(modelosDaConfig).filter(
          (e): e is [string, string] => typeof e[1] === 'string',
        ),
      ),
      textoDeHoras: numero(c.texto_de_horas ?? 20),
      textoAteHoras: numero(c.texto_ate_horas ?? 23),
      intervaloMinHoras: numero(c.intervalo_min_horas ?? 48),
    },
    podeConfigurar: p.pode_configurar === true,
    modelos: ((Array.isArray(p.modelos) ? p.modelos : []) as Record<string, unknown>[]).map(
      (m) => ({
        codigo: String(m.codigo),
        nome: texto(m.nome) ?? String(m.codigo),
        ativo: m.ativo === true,
        situacao: texto(m.situacao) ?? 'nao_enviado',
        aprovado: m.aprovado === true,
        variaveis: Array.isArray(m.variaveis) ? m.variaveis.map(String) : [],
        preenche: m.preenche === true,
        corpo: String(m.corpo ?? ''),
      }),
    ),
    placar: {
      enviadas: numero(placar.enviadas),
      porTexto: numero(placar.por_texto),
      porModelo: numero(placar.por_modelo),
      falharam: numero(placar.falharam),
      puladas: numero(placar.puladas),
      encerradasPelaIa: numero(placar.encerradas_pela_ia),
      semModelo: numero(placar.sem_modelo),
      naFila: numero(placar.na_fila),
      clientes: numero(placar.clientes),
      responderam: numero(placar.responderam),
      pediramParaSair: numero(placar.pediram_para_sair),
      semLeitura: numero(placar.sem_leitura),
    },
    motivos: ((Array.isArray(p.motivos) ? p.motivos : []) as Record<string, unknown>[]).map(
      (m) => ({
        motivo: String(m.motivo ?? ''),
        n: numero(m.n),
      }),
    ),
    custoUsd: numero(p.custo_usd),
  };
}

export async function configurarRetomada(valores: Record<string, unknown>): Promise<void> {
  await pedir('ia_retomada_configurar', { p_valores: valores });
}

/** A situação do modelo na Meta, como a equipe fala. */
export function rotuloDaSituacao(
  m: Pick<ModeloDaRetomada, 'situacao' | 'aprovado' | 'ativo'>,
): string {
  if (!m.ativo) return 'desligado no CRM';
  if (m.aprovado) return 'aprovado pela Meta';
  if (m.situacao === 'pending') return 'esperando a Meta';
  if (m.situacao === 'rejected') return 'recusado pela Meta';
  if (m.situacao === 'approved') return 'aprovado, sem o nome da Meta';
  return 'ainda não enviado à Meta';
}

// ---------------------------------------------------------------------------
// Na conversa: o selo da próxima retomada
// ---------------------------------------------------------------------------

export interface RetomadaNaConversa {
  readonly situacao: 'desligada' | 'parada' | 'na_fila' | 'aguardando' | 'devida' | 'acabou';
  readonly motivo: string | null;
  readonly etapa: number | null;
  readonly total: number | null;
  readonly dias: number | null;
  readonly tipo: 'texto' | 'modelo' | null;
  readonly quando: string | null;
  /** A próxima, sendo modelo, tem modelo escolhido e aprovado? (null quando é texto) */
  readonly modeloPronto: boolean | null;
}

const SITUACOES: readonly RetomadaNaConversa['situacao'][] = [
  'desligada',
  'parada',
  'na_fila',
  'aguardando',
  'devida',
  'acabou',
];

export async function carregarRetomadaDaConversa(
  fioId: string,
): Promise<RetomadaNaConversa | null> {
  const { data, error } = await createClient().rpc(
    'ia_retomada_da_conversa' as never,
    { p_conversation_id: fioId } as never,
  );
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.existe !== true) return null;
  const situacao = SITUACOES.find((s) => s === r.situacao);
  if (situacao === undefined) return null;
  return {
    situacao,
    motivo: texto(r.motivo),
    etapa: r.etapa === undefined || r.etapa === null ? null : numero(r.etapa),
    total: r.total === undefined || r.total === null ? null : numero(r.total),
    dias: r.dias === undefined || r.dias === null ? null : numero(r.dias),
    tipo: r.tipo === 'texto' || r.tipo === 'modelo' ? r.tipo : null,
    quando: texto(r.quando),
    modeloPronto: typeof r.modelo_pronto === 'boolean' ? r.modelo_pronto : null,
  };
}

/**
 * O que o selo diz, ou null quando não há retomada a caminho. Discreto de propósito:
 * só aparece com uma retomada marcada.
 */
export function textoDoSelo(
  r: RetomadaNaConversa | null,
  agora: Date = new Date(),
): { rotulo: string; detalhe: string } | null {
  if (r === null) return null;
  if (r.situacao === 'na_fila') {
    return {
      rotulo: 'Retomada: a IA está escrevendo',
      detalhe: 'A IA está escrevendo a mensagem para retomar o contato.',
    };
  }
  if (r.situacao !== 'aguardando' && r.situacao !== 'devida') return null;
  // Sem modelo escolhido e aprovado, não há retomada a caminho: o selo não promete.
  if (r.tipo === 'modelo' && r.modeloPronto === false) return null;
  const quando = r.quando === null ? '' : quandoPorPerto(r.quando, agora);
  const como =
    r.tipo === 'texto'
      ? 'texto curto da IA, ainda dentro das 24 h'
      : 'modelo aprovado pela Meta (fora das 24 h só sai modelo)';
  const qual = r.etapa !== null && r.total !== null ? `${r.etapa}ª de ${r.total}` : 'próxima';
  return {
    rotulo: quando === '' || quando === 'agora' ? 'Retomada em breve' : `Retomada ${quando}`,
    detalhe: `Se o cliente não responder, a IA retoma o contato (${qual}, ${r.dias ?? '?'} dia${
      r.dias === 1 ? '' : 's'
    } sem resposta): ${como}. Para se ele responder, se a equipe assumir ou se houver visita marcada.`,
  };
}
