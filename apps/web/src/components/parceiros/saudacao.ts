/**
 * A saudação inicial pelo botão de Prospectados (07/10/2026).
 *
 * O Rafael: "facilite naquela tela de prospectados um botão que envie de forma
 * mais fácil a saudação inicial 'Boa tarde...'". Até aqui a saudação só entrava
 * na fila no instante da aprovação, pelo botão "Aprovar e mandar mensagem" da
 * Revisão; quem foi aprovado sem mensagem não tinha como recebê-la.
 *
 * As duas RPCs (`saudacao_enfileirar`, `saudacao_desfazer`, migração
 * `20261007130000`) usam a mesma fila da saudação automática: "Bom dia!",
 * "Boa tarde!" ou "Boa noite!" conforme a hora em que a mensagem SAI, no ritmo
 * por hora de Ajustes, só no horário de envio. Quem não deve receber é pulado
 * pelo banco, que diz por quê — e a frase que a pessoa lê sai daqui.
 */
import { createClient } from '@/lib/supabase/client';

/** Por que uma ficha não entrou na fila. É a chave que o banco devolve. */
export type MotivoDePular =
  'sem_whatsapp' | 'nao_contatar' | 'ja_conversou' | 'ja_na_fila' | 'ja_recebeu' | 'nao_encontrado';

export type ResultadoDaSaudacao =
  | {
      ok: true;
      naFila: number;
      /** Quantas já esperavam na fila antes destas. */
      naFrente: number;
      porHora: number;
      pulados: Partial<Record<MotivoDePular, number>>;
    }
  | { ok: false; motivo: string };

const PULADO: Record<MotivoDePular, [string, string]> = {
  sem_whatsapp: ['sem WhatsApp', 'sem WhatsApp'],
  nao_contatar: ['pediu para não ser contatado', 'pediram para não ser contatados'],
  ja_conversou: ['já conversa com a gente', 'já conversam com a gente'],
  ja_na_fila: ['já estava na fila', 'já estavam na fila'],
  ja_recebeu: ['já recebeu a saudação', 'já receberam a saudação'],
  nao_encontrado: ['saiu da base', 'saíram da base'],
};

/** A ordem em que os pulados são ditos: do que mais explica ao que menos explica. */
const ORDEM: readonly MotivoDePular[] = [
  'ja_conversou',
  'ja_recebeu',
  'ja_na_fila',
  'sem_whatsapp',
  'nao_contatar',
  'nao_encontrado',
];

const RECUSA: Record<string, string> = {
  sem_permissao: 'Seu perfil não manda a saudação pela lista. Isso é de admin e gestor.',
  saudacao_desligada:
    'A saudação está desligada em Ajustes → Atendimento. Ligue lá para o botão mandar.',
  fila_pausada: 'A fila da saudação está pausada. Nada entra até ela ser retomada.',
  muitos_de_uma_vez: 'São muitos de uma vez. Mande no máximo 200 por pedido.',
  nada_escolhido: 'Escolha pelo menos um parceiro.',
};

export function recadoDaSaudacao(motivo: string): string {
  return RECUSA[motivo] ?? 'Não deu para falar com o servidor. Tente de novo.';
}

/** "1 já conversa com a gente, 2 sem WhatsApp" — ou `null` quando ninguém foi pulado. */
export function frasePulados(pulados: Partial<Record<MotivoDePular, number>>): string | null {
  const partes = ORDEM.flatMap((motivo) => {
    const n = pulados[motivo] ?? 0;
    if (n <= 0) return [];
    const [um, varios] = PULADO[motivo];
    return [`${n} ${n === 1 ? um : varios}`];
  });
  if (partes.length === 0) return null;
  if (partes.length === 1) return partes[0]!;
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

/** O aviso de depois do clique: título e a linha de baixo. */
export function avisoDaSaudacao(r: Extract<ResultadoDaSaudacao, { ok: true }>): {
  titulo: string;
  descricao: string;
  entrou: boolean;
} {
  const pulados = frasePulados(r.pulados);
  if (r.naFila === 0) {
    return {
      titulo: 'Ninguém entrou na fila.',
      descricao: pulados
        ? `Pulados: ${pulados}.`
        : 'Nenhum dos escolhidos pode receber a saudação.',
      entrou: false,
    };
  }
  const ritmo = `Sai ${r.porHora} por hora, só no horário de envio, como "Bom dia!" ou "Boa tarde!" conforme a hora.`;
  const frente = r.naFrente > 0 ? ` ${r.naFrente} na frente.` : '';
  return {
    titulo: r.naFila === 1 ? 'Saudação na fila.' : `Saudação na fila para ${r.naFila} parceiros.`,
    descricao: `${ritmo}${frente}${pulados ? ` Pulados: ${pulados}.` : ''}`,
    entrou: true,
  };
}

type Bruto = Record<string, unknown>;

function inteiro(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Lê a resposta do banco. Separado da chamada para caber em teste. */
export function lerResultado(dados: unknown): ResultadoDaSaudacao {
  const r = (dados ?? {}) as Bruto;
  if (r.ok !== true) {
    return { ok: false, motivo: typeof r.motivo === 'string' ? r.motivo : 'erro_do_servidor' };
  }
  const brutos = (r.recusados ?? {}) as Bruto;
  const pulados: Partial<Record<MotivoDePular, number>> = {};
  for (const motivo of ORDEM) {
    const n = inteiro(brutos[motivo]);
    if (n > 0) pulados[motivo] = n;
  }
  return {
    ok: true,
    naFila: inteiro(r.na_fila),
    naFrente: inteiro(r.na_frente),
    porHora: inteiro(r.por_hora) || 6,
    pulados,
  };
}

export async function mandarSaudacao(ids: readonly string[]): Promise<ResultadoDaSaudacao> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('saudacao_enfileirar', {
    p_organization_ids: [...ids],
  });
  if (error) return { ok: false, motivo: 'erro_do_servidor' };
  return lerResultado(data);
}

/** Tira da fila o que ainda não saiu. Devolve quantas tirou, ou `null` em falha. */
export async function desfazerSaudacao(ids: readonly string[]): Promise<number | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('saudacao_desfazer', {
    p_organization_ids: [...ids],
  });
  if (error) return null;
  const r = (data ?? {}) as Bruto;
  return r.ok === true ? inteiro(r.tiradas) : null;
}
