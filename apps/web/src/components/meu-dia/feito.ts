import { ehInteresse, type DesfechoCatalogo } from '@/components/registro/tipos';

/**
 * O "Feito hoje" do Meu dia: cada parceiro com quem a pessoa registrou um resultado
 * hoje, separado por como foi.
 *
 * Conta TODO contato do dia, e não só o da Agenda: a visita registrada pelo Registrar
 * contato, a ligação tabulada e o "Respondeu" do WhatsApp são o mesmo dia de trabalho.
 * A fonte é `public.activities` com `outcome_id` preenchido e `user_id` de quem
 * entrou — é "meu" dia, então o resultado que outra pessoa registrou no mesmo
 * parceiro não entra.
 *
 * Uma linha por PARCEIRO, com o último resultado do dia. Quem foi reagendado às 14:16
 * e saiu interessado às 14:45 está interessado; mostrar as duas linhas contaria a
 * mesma pessoa duas vezes e deixaria o mesmo nome em duas cores.
 */

export type ComoFoi = 'positivo' | 'em_contato' | 'mediano' | 'negativo';

export type DefinicaoDeCategoria = {
  id: ComoFoi;
  titulo: string;
  /** O que junta essas pessoas, dito uma vez no cabeçalho da seção. */
  explicacao: string;
};

/**
 * A ordem é a do R07 §4.2, a mesma do resumo das 18:00: celebrar antes de cobrar.
 * "Em contato" vem logo depois porque é onde ainda há o que fazer hoje.
 */
export const CATEGORIAS: readonly DefinicaoDeCategoria[] = [
  {
    id: 'positivo',
    titulo: 'Positivos',
    explicacao: 'Autorizou, se interessou, marcou reunião ou começou o cadastro.',
  },
  {
    id: 'em_contato',
    titulo: 'Em contato',
    explicacao: 'A conversa está andando: respondeu, pediu retorno ou remarcou a reunião.',
  },
  {
    id: 'mediano',
    titulo: 'Medianos',
    explicacao: 'Aconteceu, mas nada mudou ainda: sem resposta, objeção, falou com funcionário.',
  },
  {
    id: 'negativo',
    titulo: 'Negativos',
    explicacao: 'Recusou, disse "agora não", pediu para parar ou não apareceu.',
  },
];

type DesfechoLido = Pick<
  DesfechoCatalogo,
  'slug' | 'name' | 'surfaces' | 'target_stage_slug' | 'sets_temperature'
>;

/** Etapas de destino que são o parceiro dizendo não, agora ou de vez. */
const ETAPAS_NEGATIVAS = ['perdido', 'optout', 'nutricao'];

/** Etapas de destino que são avanço (fora a autorização, que tem troféu). */
const ETAPAS_POSITIVAS = ['cadastro_em_andamento', 'reuniao_marcada'];

/**
 * Faltas a um compromisso: "No-show" e "Não estava / fechado". A Agenda já as pinta
 * de vermelho. "Não atendeu" e "sem resposta" NÃO entram: tentativa sem resposta é o
 * dia normal de quem prospecta, e não o parceiro faltando ao combinado.
 */
const SLUGS_FALTA = ['reu_no_show', 'vis_nao_estava'];

/**
 * "Reagendada" leva à etapa Reunião marcada, mas não é avanço: a reunião não houve.
 * Também não é fim: o parceiro topou outra data, a conversa segue. É "Em contato",
 * no mesmo âmbar do cartão da Agenda — cinza aqui e âmbar lá era o mesmo resultado
 * com duas cores.
 */
const SLUG_REAGENDADA = 'reu_reagendada';

/**
 * Como foi, a partir do desfecho do catálogo. A ordem das regras importa:
 *
 *   1. autorizou              positivo, com troféu
 *   2. deixa o parceiro morno em contato: Respondeu, Atendeu e retorna depois,
 *                             Respondeu na DM, Pediu WhatsApp — é o próprio catálogo
 *                             dizendo "a conversa está viva"
 *   3. Perdido, Opt-out ou
 *      Nutrição ("agora não") negativo
 *   4. Reagendada             em contato (a conversa segue, com outra data)
 *   5. interesse, cadastro
 *      ou reunião marcada     positivo
 *   6. falta a compromisso    negativo
 *   7. o resto                mediano (sem resposta, objeção, não é a pessoa…)
 */
export function comoFoi(desfecho: DesfechoLido): { categoria: ComoFoi; trofeu: boolean } {
  const etapa = desfecho.target_stage_slug;
  if (etapa === 'autorizou') return { categoria: 'positivo', trofeu: true };
  if (desfecho.sets_temperature === 'morno') return { categoria: 'em_contato', trofeu: false };
  if (etapa && ETAPAS_NEGATIVAS.includes(etapa)) return { categoria: 'negativo', trofeu: false };
  if (desfecho.slug === SLUG_REAGENDADA) return { categoria: 'em_contato', trofeu: false };
  if ((etapa && ETAPAS_POSITIVAS.includes(etapa)) || ehInteresse(desfecho)) {
    return { categoria: 'positivo', trofeu: false };
  }
  if (SLUGS_FALTA.includes(desfecho.slug)) return { categoria: 'negativo', trofeu: false };
  return { categoria: 'mediano', trofeu: false };
}

const ROTULO_DA_SUPERFICIE: Record<string, string> = {
  reuniao: 'Reunião',
  visita: 'Visita',
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  instagram_dm: 'Instagram',
};

/** Por onde foi: a superfície do desfecho, que no catálogo é sempre uma só. */
export function canalDoDesfecho(desfecho: Pick<DesfechoCatalogo, 'surfaces'>): string | null {
  const superficie = (desfecho.surfaces as readonly string[])[0];
  return superficie ? (ROTULO_DA_SUPERFICIE[superficie] ?? null) : null;
}

/** Uma atividade com resultado, já com o parceiro resolvido. */
export type RegistroDoDia = {
  atividadeId: string;
  /** `activities.occurred_at`, em ISO. */
  quando: string;
  organizacaoId: string | null;
  organizacao: string | null;
  bairro: string | null;
  categoriaDoParceiro: string | null;
  desfecho: DesfechoLido;
};

/** Um parceiro no "Feito hoje": o último resultado do dia e quantos vieram antes. */
export type PessoaDoDia = {
  chave: string;
  organizacaoId: string | null;
  organizacao: string;
  bairro: string | null;
  categoriaDoParceiro: string | null;
  quando: string;
  /** O nome do desfecho no catálogo: "Realizada, interessado", "Não atendeu". */
  resultado: string;
  canal: string | null;
  categoria: ComoFoi;
  trofeu: boolean;
  /** Registros anteriores do mesmo parceiro hoje, que esta linha resume. */
  anterioresHoje: number;
  /**
   * O parceiro é legível para quem está vendo (`organizations_view`). Falso quando a
   * atividade aponta para um parceiro fora da carteira (o embaixador depois de o
   * parceiro mudar de dono): aí não há nome nem ficha para abrir.
   */
  naCarteira: boolean;
};

export type CategoriaPreenchida = DefinicaoDeCategoria & { pessoas: PessoaDoDia[] };

/**
 * Uma linha por parceiro (o último resultado vence), cada uma na sua categoria, e
 * cada categoria do mais recente para o mais antigo. Devolve as quatro categorias
 * sempre, na ordem de `CATEGORIAS`, mesmo vazias: quem desenha decide o que esconder.
 *
 * Atividade sem organização não tem com quem juntar e fica como linha própria.
 */
export function agruparFeitoHoje(registros: readonly RegistroDoDia[]): CategoriaPreenchida[] {
  const recentesPrimeiro = [...registros].sort((a, b) => b.quando.localeCompare(a.quando));

  const porParceiro = new Map<string, PessoaDoDia>();
  for (const registro of recentesPrimeiro) {
    const chave = registro.organizacaoId ?? `atividade-${registro.atividadeId}`;
    const jaVisto = porParceiro.get(chave);
    if (jaVisto) {
      jaVisto.anterioresHoje += 1;
      continue;
    }
    const { categoria, trofeu } = comoFoi(registro.desfecho);
    porParceiro.set(chave, {
      chave,
      organizacaoId: registro.organizacaoId,
      organizacao:
        registro.organizacao ??
        (registro.organizacaoId ? 'Parceiro fora da sua carteira' : 'Parceiro sem cadastro'),
      bairro: registro.bairro,
      categoriaDoParceiro: registro.categoriaDoParceiro,
      quando: registro.quando,
      resultado: registro.desfecho.name,
      canal: canalDoDesfecho(registro.desfecho),
      categoria,
      trofeu,
      anterioresHoje: 0,
      naCarteira: registro.organizacaoId !== null && registro.organizacao !== null,
    });
  }

  const pessoas = [...porParceiro.values()];
  return CATEGORIAS.map((definicao) => ({
    ...definicao,
    pessoas: pessoas.filter((pessoa) => pessoa.categoria === definicao.id),
  }));
}

/** Quantos parceiros tiveram resultado hoje: o número da aba. */
export function contarPessoas(categorias: readonly CategoriaPreenchida[]): number {
  return categorias.reduce((total, categoria) => total + categoria.pessoas.length, 0);
}
