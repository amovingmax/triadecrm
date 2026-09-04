import type {
  Announcements,
  KeyboardCoordinateGetter,
  ScreenReaderInstructions,
} from '@dnd-kit/core';

/**
 * Arrastar pelo teclado, e o que o leitor de tela ouve enquanto isso acontece.
 *
 * Por que este arquivo existe: o comportamento padrão do `KeyboardSensor` move o
 * cartão 25 pixels por seta. Numa lista isso funciona; num quadro de doze colunas de
 * 288px, chegar de "Prospectado" a "Perdido" custaria mais de cem toques na seta, e a
 * coluna certa só seria atingida por sorte. Aqui a seta anda de COLUNA em COLUNA: um
 * toque, uma etapa, na ordem em que elas aparecem na tela (`position` do banco, a
 * mesma que ordena o quadro). Sem isto o quadro é inacessível a quem não usa o mouse
 * — e a Heloísa, de pé na rua, também não usa.
 *
 * As setas para cima e para baixo não fazem nada de propósito: o alvo de soltar é a
 * COLUNA inteira, não uma posição dentro dela (o funil não tem ordem manual de
 * cartão — quem ordena é o banco, pelo semáforo da próxima ação). Mover na vertical
 * mudaria o pixel e não mudaria o destino, ou seja, prometeria um controle que não
 * existe.
 */

/** Dados que a coluna pendura no seu droppable, e que o teclado lê para se orientar. */
export type DadosDaColuna = {
  tipo: 'etapa';
  etapaId: number;
  /** `stages.position`: a ordem do quadro na tela. */
  posicao: number;
  nome: string;
};

/** Dados que o cartão pendura no seu draggable. */
export type DadosDoCartao = {
  tipo: 'cartao';
  dealId: string;
  deEtapaId: number;
  nome: string;
};

export function dadosDaColuna(valor: unknown): DadosDaColuna | null {
  const d = valor as Partial<DadosDaColuna> | undefined;
  return d && d.tipo === 'etapa' && typeof d.etapaId === 'number' ? (d as DadosDaColuna) : null;
}

export function dadosDoCartao(valor: unknown): DadosDoCartao | null {
  const d = valor as Partial<DadosDoCartao> | undefined;
  return d && d.tipo === 'cartao' && typeof d.dealId === 'string' ? (d as DadosDoCartao) : null;
}

/** Folga entre o topo da coluna e o cartão em voo, para o alvo cair dentro dela. */
const FOLGA = 12;

/**
 * Seta esquerda e direita saltam para a coluna vizinha.
 *
 * O retorno é o novo canto superior esquerdo do cartão em voo (é o que o
 * `KeyboardSensor` compara com `currentCoordinates` para calcular o deslocamento).
 */
export const coordenadasPorTeclado: KeyboardCoordinateGetter = (evento, { context }) => {
  const passo = evento.code === 'ArrowRight' ? 1 : evento.code === 'ArrowLeft' ? -1 : 0;
  if (passo === 0) return;

  const { active, collisionRect, droppableContainers, droppableRects, over } = context;
  if (!collisionRect) return;

  const colunas = droppableContainers
    .toArray()
    .map((container) => ({
      id: container.id,
      dados: dadosDaColuna(container.data.current),
      rect: droppableRects.get(container.id),
      desabilitada: container.disabled,
    }))
    .filter(
      (
        c,
      ): c is {
        id: (typeof c)['id'];
        dados: DadosDaColuna;
        rect: NonNullable<(typeof c)['rect']>;
        desabilitada: boolean;
      } => c.dados !== null && c.rect !== undefined && !c.desabilitada,
    )
    .sort((a, b) => a.dados.posicao - b.dados.posicao);

  if (colunas.length === 0) return;

  // Onde o cartão está AGORA é o alvo que o próprio dnd-kit já elegeu (`over`): a
  // mesma coluna que receberia o cartão se ele fosse solto neste instante. Na largada,
  // antes de existir `over`, é a coluna de origem, que vem nos dados do cartão.
  //
  // A primeira versão deduzia isso pela geometria (a coluna de centro mais próximo do
  // cartão em voo) e pulava DUAS colunas por tecla assim que o quadro começava a rolar
  // sozinho: a rolagem horizontal move as colunas debaixo do cartão entre um toque e
  // outro, e a conta passa a medir distância contra um quadro que já andou. Foi visto
  // em conferência: nove setas a partir de "Prospectado" caíam em "Opt-out", não em
  // "Nutrição". Perguntar ao `over` não tem geometria e não tem como escorregar.
  const daOrigem = dadosDoCartao(active?.data.current);
  const idAtual = over?.id ?? (daOrigem ? `etapa-${daOrigem.deEtapaId}` : null);
  const indice = colunas.findIndex((c) => c.id === idAtual);
  if (indice < 0) return;

  const alvo = colunas[indice + passo];
  if (!alvo) return;

  evento.preventDefault();
  // CENTRALIZA o cartão na coluna de destino em vez de encostá-lo na borda esquerda.
  // As etapas de saída ficam recolhidas em 48px e o cartão em voo tem 272px: alinhado
  // à esquerda ele cobria quatro colunas ao mesmo tempo, e a detecção de colisão
  // elegia a do meio — na conferência, a oitava seta pulava "Publicado" e "Nutrição" e
  // caía em "Perdido". Centralizado, a coluna de destino é a mais próxima por
  // construção, tenha ela 288px ou 48px.
  return {
    x: alvo.rect.left + alvo.rect.width / 2 - collisionRect.width / 2,
    y: alvo.rect.top + FOLGA,
  };
};

/** Instruções lidas ao focar um cartão. Sem elas, "botão" é tudo o que a pessoa ouve. */
export const instrucoesDeLeitor: ScreenReaderInstructions = {
  draggable:
    'Para mover este negócio de etapa, aperte espaço ou enter. ' +
    'Use as setas para a esquerda e para a direita para escolher a etapa. ' +
    'Aperte espaço ou enter de novo para soltar, ou esc para desistir.',
};

const nomeDoCartao = (dados: unknown): string => dadosDoCartao(dados)?.nome ?? 'o negócio';
const nomeDaColuna = (dados: unknown): string => dadosDaColuna(dados)?.nome ?? 'outra etapa';

/**
 * O que o leitor de tela fala durante o arraste. Em pt-BR e com nome próprio: "Buffet
 * Encanto solto em Reunião marcada" diz o que aconteceu; "item soltado" não diz nada.
 */
export const avisosDeArraste: Announcements = {
  onDragStart: ({ active }) =>
    `${nomeDoCartao(active.data.current)} levantado. Use as setas para escolher a etapa.`,
  onDragOver: ({ active, over }) =>
    over
      ? `${nomeDoCartao(active.data.current)} sobre a etapa ${nomeDaColuna(over.data.current)}.`
      : `${nomeDoCartao(active.data.current)} fora de qualquer etapa.`,
  onDragEnd: ({ active, over }) =>
    over
      ? `${nomeDoCartao(active.data.current)} solto na etapa ${nomeDaColuna(over.data.current)}.`
      : `${nomeDoCartao(active.data.current)} devolvido à etapa de origem.`,
  onDragCancel: ({ active }) =>
    `Movimento cancelado. ${nomeDoCartao(active.data.current)} continua onde estava.`,
};
