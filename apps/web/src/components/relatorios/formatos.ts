import { formatarNumero } from '@/components/parceiros/formatos';

/**
 * Formatação dos números dos relatórios. Reaproveita `formatarNumero` da tela de
 * Parceiros (uma só fonte para o separador de milhar) e acrescenta o que é próprio
 * daqui: percentual, decimal e a diferença entre "é zero" e "não dá para calcular".
 *
 * Toda saída é string pronta para o utilitário `numerico` (IBM Plex Mono com
 * tabular-nums). `null` quer dizer "sem base": a tabela desenha o marcador de sem
 * dado, e não um zero que mentiria sobre o denominador.
 */

export { formatarNumero };

const DECIMAL = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function numeroFinito(valor: unknown): number | null {
  const numero = typeof valor === 'string' ? Number(valor) : valor;
  return typeof numero === 'number' && Number.isFinite(numero) ? numero : null;
}

/** `28.0` vira `28,0%`; nulo continua nulo (sem denominador não há taxa). */
export function formatarPercentual(valor: unknown): string | null {
  const numero = numeroFinito(valor);
  return numero === null ? null : `${DECIMAL.format(numero)}%`;
}

/** Um decimal, para mediana de dias na etapa e ritmo. */
export function formatarDecimal(valor: unknown): string | null {
  const numero = numeroFinito(valor);
  return numero === null ? null : DECIMAL.format(numero);
}

/** Contagem inteira. Zero é zero e aparece: esconder a linha vazia é esconder o problema. */
export function formatarInteiro(valor: unknown): string {
  const numero = numeroFinito(valor);
  return numero === null ? '0' : formatarNumero(Math.round(numero));
}

/**
 * Rótulos das superfícies de interação (`app.interaction_surface`).
 *
 * Espelham os que a tela de registro usa, mas moram aqui: `components/registro/tipos.ts`
 * declara ter dono exclusivo, e um relatório não pode passar a depender do contrato de
 * outra tela. `triagem` não é canal de conversa — é o descarte da caixa de triagem — e
 * aparece com nome próprio para ninguém a confundir com um toque no fornecedor.
 */
export const ROTULO_SUPERFICIE: Record<string, string> = {
  whatsapp: 'WhatsApp',
  ligacao: 'Ligação',
  visita: 'Visita',
  reuniao: 'Reunião',
  instagram_dm: 'DM do Instagram',
  triagem: 'Triagem',
};

export function rotuloDaSuperficie(valor: string | null | undefined): string {
  if (!valor) return 'Sem canal';
  return ROTULO_SUPERFICIE[valor] ?? valor;
}

/** Rótulos do tipo de fonte (`app.source_kind`, PRD RF-BAS-10). */
export const ROTULO_TIPO_DE_FONTE: Record<string, string> = {
  scrape: 'Coleta',
  import: 'Importação',
  manual: 'Manual',
  api: 'API',
  referral: 'Indicação',
};

export function rotuloDoTipoDeFonte(valor: string | null | undefined): string {
  if (!valor) return '';
  return ROTULO_TIPO_DE_FONTE[valor] ?? valor;
}

/**
 * Rótulos dos grupos de categoria (`categories.group`).
 *
 * O banco guarda o slug; a interface é em português e não mostra `alimentos_bebidas`
 * para ninguém. Grupo desconhecido volta como veio, para a tela nunca esconder uma
 * categoria nova que alguém acrescentou no catálogo.
 */
export const ROTULO_GRUPO: Record<string, string> = {
  alimentos_bebidas: 'Alimentos e bebidas',
  infraestrutura: 'Infraestrutura',
  locais: 'Locais',
  producao: 'Produção',
  recreacao: 'Recreação',
  servicos: 'Serviços',
};

export function rotuloDoGrupo(valor: string | null | undefined): string {
  if (!valor) return '';
  return ROTULO_GRUPO[valor] ?? valor;
}
