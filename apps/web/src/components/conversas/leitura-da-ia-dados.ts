import { createClient } from '@/lib/supabase/client';

import type { SinalDaLeitura } from './leitura-da-ia-formatos';

/**
 * A leitura da IA e os compromissos da conversa, lidos no navegador sob a mesma RLS
 * de todo o resto: quem não enxerga a conversa não enxerga a ficha dela
 * (`app.conversa_visivel`, migração `20260917100000`).
 *
 * Nenhuma escrita além do 👍/👎. A ficha é do worker — a tela não corrige o que a
 * IA escreveu; ela discorda por feedback, que é o que calibra a versão seguinte.
 */

export interface CompromissoDaLeitura {
  readonly id: string;
  readonly quem: 'equipe' | 'parceiro';
  readonly oQue: string;
  readonly prazo: string | null;
  readonly status: string;
  readonly messageId: string | null;
}

export interface LeituraDaConversa {
  readonly resumo: string | null;
  readonly intencao: string | null;
  readonly score: number | null;
  readonly motivo: string | null;
  readonly sentimento: string | null;
  readonly sinais: readonly SinalDaLeitura[];
  readonly objecoes: readonly string[];
  readonly alertas: readonly string[];
  readonly proximaAcao: string | null;
  readonly proximaAcaoEm: string | null;
  readonly confianca: number | null;
  readonly dadosInsuficientes: boolean;
  readonly analisadaEm: string | null;
  readonly promptVersion: string | null;
  readonly compromissos: readonly CompromissoDaLeitura[];
}

export function chaveDaLeitura(fioId: string) {
  return ['conversas', 'leitura-da-ia', fioId] as const;
}

function sinaisDe(bruto: unknown): SinalDaLeitura[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.flatMap((item): SinalDaLeitura[] => {
    if (typeof item !== 'object' || item === null) return [];
    const linha = item as Record<string, unknown>;
    const tipo = typeof linha.tipo === 'string' ? linha.tipo : null;
    if (tipo === null) return [];
    return [
      {
        tipo,
        polaridade: linha.polaridade === 'negativo' ? 'negativo' : 'positivo',
        forca: linha.forca === 'fraco' ? 'fraco' : 'forte',
        messageId: typeof linha.message_id === 'string' ? linha.message_id : null,
        trecho: typeof linha.trecho === 'string' ? linha.trecho : '',
      },
    ];
  });
}

export async function carregarLeituraDaIa(fioId: string): Promise<LeituraDaConversa | null> {
  const supabase = createClient();

  const [ficha, compromissos] = await Promise.all([
    supabase
      .from('ficha_da_conversa')
      .select(
        'resumo, intencao, score_intencao, motivo, sentimento, sinais, objecoes, alertas, proxima_acao, proxima_acao_em, confianca, dados_insuficientes, analisada_em, prompt_version',
      )
      .eq('conversation_id', fioId)
      .maybeSingle(),
    supabase
      .from('compromissos_da_conversa')
      .select('id, quem, o_que, prazo, status, message_id')
      .eq('conversation_id', fioId)
      .eq('status', 'aberto')
      .order('prazo', { ascending: true, nullsFirst: false }),
  ]);

  if (ficha.error) throw new Error(ficha.error.message);
  if (compromissos.error) throw new Error(compromissos.error.message);
  if (ficha.data === null) return null;

  const linha = ficha.data as Record<string, unknown>;
  const textos = (valor: unknown): string[] =>
    Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : [];

  return {
    resumo: typeof linha.resumo === 'string' ? linha.resumo : null,
    intencao: typeof linha.intencao === 'string' ? linha.intencao : null,
    score: typeof linha.score_intencao === 'number' ? linha.score_intencao : null,
    motivo: typeof linha.motivo === 'string' ? linha.motivo : null,
    sentimento: typeof linha.sentimento === 'string' ? linha.sentimento : null,
    sinais: sinaisDe(linha.sinais),
    objecoes: textos(linha.objecoes),
    alertas: textos(linha.alertas),
    proximaAcao: typeof linha.proxima_acao === 'string' ? linha.proxima_acao : null,
    proximaAcaoEm: typeof linha.proxima_acao_em === 'string' ? linha.proxima_acao_em : null,
    confianca: typeof linha.confianca === 'number' ? linha.confianca : null,
    dadosInsuficientes: linha.dados_insuficientes !== false,
    analisadaEm: typeof linha.analisada_em === 'string' ? linha.analisada_em : null,
    promptVersion: typeof linha.prompt_version === 'string' ? linha.prompt_version : null,
    compromissos: (compromissos.data ?? []).map((c) => {
      const item = c as Record<string, unknown>;
      return {
        id: String(item.id),
        quem: item.quem === 'parceiro' ? 'parceiro' : 'equipe',
        oQue: typeof item.o_que === 'string' ? item.o_que : '',
        prazo: typeof item.prazo === 'string' ? item.prazo : null,
        status: typeof item.status === 'string' ? item.status : 'aberto',
        messageId: typeof item.message_id === 'string' ? item.message_id : null,
      };
    }),
  };
}

export type TipoDeFeedback = 'util' | 'inutil' | 'correcao_de_intencao';

/**
 * O 👍/👎 de quem leu. É a única escrita desta tela sobre a IA, e ela não muda a
 * ficha: discordar não apaga a leitura, registra a discordância — é dela que sai o
 * gabarito da versão seguinte (`feedback_da_ia`).
 */
export async function registrarFeedback(entrada: {
  fioId: string;
  tipo: TipoDeFeedback;
  valorDaIa: string | null;
  valorHumano?: string | null;
  promptVersion: string | null;
}): Promise<void> {
  const supabase = createClient();
  const { data: sessao } = await supabase.auth.getUser();
  const userId = sessao.user?.id ?? null;
  if (userId === null) throw new Error('sem sessão');

  const { error } = await supabase.from('feedback_da_ia').insert({
    conversation_id: entrada.fioId,
    user_id: userId,
    tipo: entrada.tipo,
    valor_da_ia: entrada.valorDaIa,
    valor_humano: entrada.valorHumano ?? null,
    prompt_version: entrada.promptVersion,
  });
  if (error) throw new Error(error.message);
}
