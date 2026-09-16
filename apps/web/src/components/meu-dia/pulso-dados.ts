import { createClient } from '@/lib/supabase/client';

/**
 * O Pulso do dia, lido por quem abre o Meu dia.
 *
 * ===========================================================================
 * POR QUE O MAIS RECENTE, E NÃO O DE HOJE
 * ===========================================================================
 * O Pulso sai às 18h30. Quem abre o Meu dia às 7h da manhã quer o de ONTEM — o de
 * hoje ainda não existe, e uma tela que diz "sem Pulso hoje" às 7h estaria certa e
 * inútil. Então a consulta pega o mais recente que existe e a tela diz de quando
 * ele é. É a mesma razão de o jornal da manhã falar do dia anterior.
 *
 * RLS (`20260917100000`): o Pulso da equipe é visto por quem enxerga tudo; o de
 * uma pessoa, só por ela.
 */

export interface PrioridadeDoPulso {
  readonly leadId: string;
  readonly porque: string;
  readonly acao: string;
  readonly urgencia: 'hoje' | 'amanha' | 'esta_semana';
  readonly conversationId: string | null;
  readonly organizationId: string | null;
  readonly nome: string | null;
}

export interface PulsoDoDia {
  readonly id: string;
  readonly dia: string;
  readonly titulo: string | null;
  readonly texto: string | null;
  readonly prioridades: readonly PrioridadeDoPulso[];
  readonly riscos: readonly string[];
  readonly diaSemMovimento: boolean;
  readonly metricas: Record<string, number>;
  readonly promptVersion: string | null;
}

export const CHAVE_PULSO = ['meu-dia', 'pulso'] as const;

function prioridadesDe(bruto: unknown): PrioridadeDoPulso[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.flatMap((item): PrioridadeDoPulso[] => {
    if (typeof item !== 'object' || item === null) return [];
    const linha = item as Record<string, unknown>;
    const texto = (valor: unknown): string | null => (typeof valor === 'string' ? valor : null);
    const urgencia = linha.urgencia;
    return [
      {
        leadId: texto(linha.leadId) ?? '',
        porque: texto(linha.porque) ?? '',
        acao: texto(linha.acao) ?? '',
        urgencia: urgencia === 'hoje' || urgencia === 'amanha' ? urgencia : 'esta_semana',
        conversationId: texto(linha.conversation_id),
        organizationId: texto(linha.organization_id),
        nome: texto(linha.nome),
      },
    ];
  });
}

export async function buscarPulso(): Promise<PulsoDoDia | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('pulso_do_dia')
    .select('id, dia, conteudo, texto, metricas')
    .order('dia', { ascending: false })
    .order('versao', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data === null) return null;

  const linha = data as Record<string, unknown>;
  const conteudo = (linha.conteudo ?? {}) as Record<string, unknown>;
  const numeros: Record<string, number> = {};
  if (typeof linha.metricas === 'object' && linha.metricas !== null) {
    for (const [chave, valor] of Object.entries(linha.metricas)) {
      if (typeof valor === 'number') numeros[chave] = valor;
    }
  }

  return {
    id: String(linha.id),
    dia: String(linha.dia),
    titulo: typeof conteudo.titulo === 'string' ? conteudo.titulo : null,
    texto: typeof linha.texto === 'string' ? linha.texto : null,
    prioridades: prioridadesDe(conteudo.prioridades),
    riscos: Array.isArray(conteudo.riscos)
      ? conteudo.riscos.filter((r): r is string => typeof r === 'string')
      : [],
    diaSemMovimento: conteudo.diaSemMovimento === true,
    metricas: numeros,
    promptVersion: typeof conteudo.prompt_version === 'string' ? conteudo.prompt_version : null,
  };
}
