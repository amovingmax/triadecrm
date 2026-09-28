import type { Temperature } from '@komune/schema';

/**
 * A escala térmica é a dimensão dos RELATÓRIOS e do override manual de 1–3
 * estrelas. O banco calcula a temperatura de cada negócio a partir da etapa, da
 * última intenção e de quantos dias faz que ninguém fala com a pessoa. Este
 * arquivo é o mapa único `temperatura -> { rótulo, cor, ordem }`; ninguém mais
 * escreve "Quente" ou `#c4472b` na mão.
 *
 * **DESDE 28/09/2026 ELA NÃO PINTA AS TELAS DE TRABALHO** (ADR-16). Até então
 * este arquivo era "o sistema visual do produto (PRD §5.6)", e a cor aparecia no
 * cartão do funil, na lista de parceiros, na lista de conversas e no Meu dia.
 * Rafael: "o fato de só o lead responder e ele já virar morno não faz sentido e
 * tá errado" — cada etapa tem uma temperatura colada na seed, e as 12 etapas do
 * funil fornecedor apareciam nessas quatro telas como três cores. Quem ocupa o
 * lugar é a etapa (`@/components/funis/etapa`). A escala continua inteira no
 * banco e nos relatórios, e as variáveis de `globals.css` continuam servindo a
 * eles.
 *
 * `ordem` acompanha a ordem de declaração do enum `app.temperature` no Postgres
 * (frio < morno < quente < cliente < cliente_ativo), que é a mesma usada pelo
 * gatilho que sobe a maior temperatura dos negócios para a organização. Ordenar
 * pela UI e ordenar pelo banco dão o mesmo resultado.
 */

/** Apelido local do enum do banco, para quem não quer importar de @komune/schema. */
export type Temperatura = Temperature;

export interface DefinicaoTemperatura {
  /** Valor gravado no banco. */
  valor: Temperatura;
  /** Rótulo curto de interface, em pt-BR. */
  rotulo: string;
  /** Frase de apoio para `title`, tooltip e leitor de tela. */
  descricao: string;
  /** Cor da marca (barra térmica, ponto, traço de gráfico). */
  cor: string;
  /** Variante com contraste suficiente para texto sobre o fundo da página. */
  corTexto: string;
  /** Preenchimento tênue, para chip ou faixa. */
  corFundo: string;
  /** Ordem crescente de calor, igual à do enum no Postgres. */
  ordem: number;
}

export const ESCALA_TERMICA: Record<Temperatura, DefinicaoTemperatura> = {
  frio: {
    valor: 'frio',
    rotulo: 'Frio',
    descricao: 'Sem sinal de interesse ou parado há mais de duas semanas.',
    cor: 'var(--frio)',
    corTexto: 'var(--frio-texto)',
    corFundo: 'var(--frio-fundo)',
    ordem: 1,
  },
  morno: {
    valor: 'morno',
    rotulo: 'Morno',
    descricao: 'Respondeu e a conversa está viva, sem interesse declarado.',
    cor: 'var(--morno)',
    corTexto: 'var(--morno-texto)',
    corFundo: 'var(--morno-fundo)',
    ordem: 2,
  },
  quente: {
    valor: 'quente',
    rotulo: 'Quente',
    descricao: 'Interesse declarado ou proposta em andamento. Responder hoje.',
    cor: 'var(--quente)',
    corTexto: 'var(--quente-texto)',
    corFundo: 'var(--quente-fundo)',
    ordem: 3,
  },
  cliente: {
    valor: 'cliente',
    rotulo: 'Cliente',
    descricao: 'Fechou com a Komune e está em cadastro ou publicação.',
    cor: 'var(--cliente)',
    corTexto: 'var(--cliente-texto)',
    corFundo: 'var(--cliente-fundo)',
    ordem: 4,
  },
  cliente_ativo: {
    valor: 'cliente_ativo',
    rotulo: 'Cliente ativo',
    descricao: 'Publicado na plataforma e recebendo pedidos.',
    cor: 'var(--cliente-ativo)',
    corTexto: 'var(--cliente-ativo-texto)',
    corFundo: 'var(--cliente-ativo-fundo)',
    ordem: 5,
  },
};

/** As cinco temperaturas do mais frio ao mais quente (filtros, legendas, ordenação). */
export const TEMPERATURAS_EM_ORDEM: readonly DefinicaoTemperatura[] = Object.values(
  ESCALA_TERMICA,
).sort((a, b) => a.ordem - b.ordem);

/** Temperatura padrão de quem ainda não tem negócio: o banco também assume 'frio'. */
export const TEMPERATURA_PADRAO: Temperatura = 'frio';

/** Resolve a definição, aceitando nulo e valor desconhecido (cai em 'frio'). */
export function definicaoTemperatura(
  valor: Temperatura | string | null | undefined,
): DefinicaoTemperatura {
  if (valor && valor in ESCALA_TERMICA) {
    return ESCALA_TERMICA[valor as Temperatura];
  }
  return ESCALA_TERMICA[TEMPERATURA_PADRAO];
}

/** Comparador para ordenar listas por calor (use com `.sort`). */
export function compararPorTemperatura(a: Temperatura, b: Temperatura): number {
  return definicaoTemperatura(a).ordem - definicaoTemperatura(b).ordem;
}
