/**
 * Corrigir o resultado de uma ligação (13/10/2026), falando com o banco.
 *
 * `public.ligacao_corrigir` (migração `20261013150000`) estorna o que o
 * resultado errado mexeu — etapa, próxima ação, recontato — e lança o certo
 * pelo caminho de sempre, na hora da ligação e no nome de quem ligou. O
 * registro antigo fica na ficha como nota. Quem ligou corrige no mesmo dia; a
 * gestão, sempre: a regra vale no banco, e a tela só esconde o botão que o
 * banco recusaria.
 *
 * Como nas outras ações do CRM, a recusa volta como `{ ok: false, motivo }`, e
 * a frase que a pessoa lê sai de `recadoDaCorrecao`.
 */
import { createClient } from '@/lib/supabase/client';

import type { LigacaoDoDia } from './tipos';

/** O desfecho de reunião: tem data, sala e convite, e por isso mora na Agenda. */
export const SLUG_DE_REUNIAO = 'lig_reuniao_marcada';

/** Uma opção de resultado certo: os dois eixos que `tabular_chamada` também pede. */
export type OpcaoDeResultado = {
  chave: string;
  rotulo: string;
  resultado: string;
  desfechoId: number | null;
  pedeMotivoDePerda: boolean;
};

export type MotivoDePerda = { id: number; nome: string };

/** Ninguém atendeu: o resultado da linha basta, sem desfecho. */
const NAO_ATENDIDAS: readonly OpcaoDeResultado[] = [
  {
    chave: 'nao_atendeu',
    rotulo: 'Não atendeu',
    resultado: 'nao_atendeu',
    desfechoId: null,
    pedeMotivoDePerda: false,
  },
  {
    chave: 'ocupado',
    rotulo: 'Ocupado',
    resultado: 'ocupado',
    desfechoId: null,
    pedeMotivoDePerda: false,
  },
  {
    chave: 'caixa_postal',
    rotulo: 'Caixa postal',
    resultado: 'caixa_postal',
    desfechoId: null,
    pedeMotivoDePerda: false,
  },
  {
    chave: 'numero_invalido',
    rotulo: 'Número errado',
    resultado: 'numero_invalido',
    desfechoId: null,
    pedeMotivoDePerda: false,
  },
];

export const CHAVE_DAS_OPCOES_DE_CORRECAO = ['ligacoes-do-dia', 'opcoes-de-correcao'] as const;

/** Estoura em falha: quem chama é o TanStack Query. */
export async function carregarOpcoesDeCorrecao(): Promise<{
  atendidas: OpcaoDeResultado[];
  naoAtendidas: readonly OpcaoDeResultado[];
  motivosDePerda: MotivoDePerda[];
}> {
  const supabase = createClient();
  const [desfechos, motivos] = await Promise.all([
    supabase
      .from('interaction_outcomes')
      .select('id, slug, name, position, requires_lost_reason')
      .eq('is_active', true)
      .eq('requires_answer', true)
      .contains('surfaces', ['ligacao'])
      .order('position'),
    supabase.from('lost_reasons').select('id, name').eq('is_active', true).order('position'),
  ]);
  if (desfechos.error) throw desfechos.error;
  if (motivos.error) throw motivos.error;
  return {
    atendidas: (desfechos.data ?? [])
      .filter((d) => d.slug !== SLUG_DE_REUNIAO)
      .map((d) => ({
        chave: d.slug,
        rotulo: d.name,
        resultado: 'atendida_humano',
        desfechoId: d.id,
        pedeMotivoDePerda: d.requires_lost_reason === true,
      })),
    naoAtendidas: NAO_ATENDIDAS,
    motivosDePerda: (motivos.data ?? []).map((m) => ({ id: m.id, nome: m.name })),
  };
}

/** A opção que a ligação JÁ tem: ela não é oferecida como correção. */
export function chaveAtual(ligacao: Pick<LigacaoDoDia, 'resultado' | 'desfecho'>): string | null {
  if (ligacao.resultado === null) return null;
  return ligacao.resultado === 'atendida_humano' ? ligacao.desfecho : ligacao.resultado;
}

/**
 * Esta ligação tem botão de corrigir?
 *
 * Sem resultado não há o que corrigir (tabula-se na tela de ligar); reunião
 * marcada se desfaz pela Agenda. `corrige` é o que quem chama sabe sobre a
 * pessoa: a gestão sempre, quem ligou só no próprio dia de hoje.
 */
export function podeCorrigir(
  ligacao: Pick<LigacaoDoDia, 'resultado' | 'desfecho'>,
  corrige: boolean,
): boolean {
  return corrige && ligacao.resultado !== null && ligacao.desfecho !== SLUG_DE_REUNIAO;
}

const RECADO: Record<string, string> = {
  sem_permissao: 'Seu perfil não pode corrigir ligações.',
  ligacao_inexistente: 'Esta ligação não existe mais. Recarregue a página.',
  de_outra_pessoa: 'Esta ligação é de outra pessoa. Quem corrige é ela mesma, no dia, ou a gestão.',
  de_outro_dia:
    'Esta ligação é de outro dia. Depois que o dia vira, quem corrige é a gestão: peça a um gestor.',
  sem_resultado: 'Esta ligação ainda não tem resultado. Abra o lote e registre o que aconteceu.',
  motivo_obrigatorio: 'Escreva o motivo da correção.',
  resultado_invalido: 'Este resultado não vale para esta ligação. Escolha outro.',
  mesmo_resultado: 'A ligação já está com este resultado.',
  reuniao_pela_agenda:
    'Reunião se marca pela Agenda, com data e sala. Corrija para "Interessado" e marque a reunião na Agenda.',
  tem_reuniao:
    'Esta ligação marcou uma reunião. Cancele a reunião na Agenda antes de mudar o resultado.',
  motivo_de_perda_obrigatorio: 'Escolha o motivo da perda.',
};

export function recadoDaCorrecao(motivo: string): string {
  return RECADO[motivo] ?? 'Não deu para falar com o servidor. Tente de novo.';
}

export type ResultadoDaCorrecao =
  | {
      ok: true;
      era: string | null;
      ficou: string | null;
      /** `voltou`, `ja_tinha_andado`, `nao_voltou` ou `nao_mexeu`. */
      etapa: string;
      etapaDepois: string | null;
    }
  | { ok: false; motivo: string };

export async function corrigirLigacao(entrada: {
  chaveDoCliente: string;
  ligacaoId: string;
  opcao: OpcaoDeResultado;
  motivo: string;
  motivoDePerdaId: number | null;
}): Promise<ResultadoDaCorrecao> {
  const { data, error } = await createClient().rpc('ligacao_corrigir', {
    p_client_key: entrada.chaveDoCliente,
    p_attempt_id: entrada.ligacaoId,
    p_resultado: entrada.opcao.resultado,
    p_outcome_id: entrada.opcao.desfechoId ?? undefined,
    p_motivo: entrada.motivo,
    p_lost_reason_id: entrada.motivoDePerdaId ?? undefined,
  });
  if (error) return { ok: false, motivo: 'erro_do_servidor' };
  const r = (data ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
  if (r.ok !== true) return { ok: false, motivo: texto(r.motivo) ?? 'erro_do_servidor' };
  return {
    ok: true,
    era: texto(r.era),
    ficou: texto(r.ficou),
    etapa: texto(r.etapa) ?? 'nao_mexeu',
    etapaDepois: texto(r.etapa_depois),
  };
}

/** O aviso depois de corrigir: o que mudou, e o que a pessoa precisa saber da etapa. */
export function avisoDaCorrecao(resultado: Extract<ResultadoDaCorrecao, { ok: true }>): {
  titulo: string;
  detalhe: string | undefined;
} {
  const titulo =
    resultado.era && resultado.ficou
      ? `Resultado corrigido: era "${resultado.era}", ficou "${resultado.ficou}".`
      : 'Resultado corrigido.';
  if (resultado.etapa === 'ja_tinha_andado') {
    return {
      titulo,
      detalhe:
        'O negócio já tinha mudado de etapa depois desta ligação, então a etapa não foi mexida. Confira na ficha.',
    };
  }
  if (resultado.etapa === 'nao_voltou') {
    return {
      titulo,
      detalhe: 'A etapa do negócio não pôde voltar sozinha. Confira e ajuste na ficha.',
    };
  }
  return {
    titulo,
    detalhe: resultado.etapaDepois ? `O negócio está em ${resultado.etapaDepois}.` : undefined,
  };
}
