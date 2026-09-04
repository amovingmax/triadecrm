'use client';

import { useCallback, useState } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';

import { CabecaDaFaixaDeSaida, Coluna, ColunaRecolhida } from './coluna';
import { AvisoDoMovimento } from './quadro-avisos';
import { CartaoArrastavel, CartaoEmVoo } from './quadro-cartao';
import {
  avisosDeArraste,
  coordenadasPorTeclado,
  dadosDaColuna,
  dadosDoCartao,
  instrucoesDeLeitor,
} from './quadro-teclado';
import { TrilhaDeEtapas } from './quadro-trilha';
import { useCarregarMais, useMoverCartao } from './use-quadro';
import {
  etapaEhDeSaida,
  etapaExigeProximaAcao,
  type CartaoQuadro,
  type EtapaQuadro,
  type FiltrosQuadro,
  type Quadro as QuadroDoBanco,
} from './tipos';

/**
 * O quadro kanban do funil: colunas por etapa e arrastar-e-soltar (RF-FUN-01/02/09).
 *
 * Recebe o quadro já carregado — quem consulta é a tela, com `useQuadro` — e cuida de
 * uma coisa só: a **forma** do quadro e o caminho do movimento. Quatro decisões que
 * sustentam o resto do arquivo:
 *
 * 1. **A coluna é o alvo de soltar, e o único.** O funil não tem ordem manual dentro
 *    da etapa (quem ordena é o banco, pelo semáforo da próxima ação), então soltar
 *    "entre o terceiro e o quarto cartão" prometeria um controle que não existe. Por
 *    isso `useDraggable` + `useDroppable`, e não a lista ordenável do
 *    `@dnd-kit/sortable`.
 *
 * 2. **Arrastar tem de funcionar sem mouse.** O `KeyboardSensor` entra com um
 *    `coordinateGetter` que anda de coluna em coluna (quadro-teclado.ts) e com avisos
 *    de leitor de tela em pt-BR. O padrão do dnd-kit anda 25px por seta: num quadro de
 *    doze colunas de 288px, chegar de "Prospectado" a "Perdido" custaria mais de cem
 *    toques. Sem isso a tela principal do produto é inacessível.
 *
 * 3. **Soltar numa etapa que exige dados NÃO tenta mover.** Se a etapa de destino pede
 *    próxima ação (RF-FUN-03) ou campo obrigatório (RF-FUN-04), o quadro entrega o
 *    pedido à folha de mover, já com o destino escolhido pelo arraste. Só as etapas
 *    que não exigem nada (publicado, nutrição, opt-out) movem na hora, com atualização
 *    otimista. Em qualquer caminho o banco revalida tudo: se ele recusar, o cartão
 *    volta sozinho para a coluna de origem e a recusa aparece escrita em pt-BR.
 *
 * 4. **Abaixo de 768px não existe quadro.** Doze e catorze colunas não cabem em 390px,
 *    e arrastar dentro de uma lista que rola verticalmente disputa o gesto de rolagem
 *    de quem está de pé, na rua, com uma mão só. A tela vira trilha de etapas mais a
 *    lista da etapa aberta, e mover é um botão no cartão (RF-FUN-09). O `DndContext`
 *    nem é montado: sensor de ponteiro ativo numa lista que rola é atrito puro.
 */

/**
 * O que o quadro entrega à tela para abrir a folha de mover.
 *
 * `etapaDestinoId` é o presente do arraste: quem soltou o cartão em "Reunião marcada"
 * já disse para onde quer ir, e a folha abre com o destino escolhido em vez de
 * perguntar de novo. Nulo quando o pedido veio do botão do celular, onde a escolha do
 * destino é justamente o que a folha faz.
 */
export type PedidoDeAbrirMover = {
  cartao: CartaoQuadro;
  etapaAtualId: number;
  etapaDestinoId?: number | null;
};

/**
 * Quem está debaixo do cartão.
 *
 * Com o mouse, quem manda é o PONTEIRO: a pessoa mira a coluna com a ponta do dedo, e
 * a coluna mirada é a que recebe, mesmo com o cartão de 272px cobrindo três colunas ao
 * lado. Com o teclado não existe ponteiro (`pointerWithin` volta vazio), e aí vale o
 * centro do cartão contra o centro das colunas — que é exatamente onde o
 * `coordinateGetter` o coloca a cada seta.
 *
 * `closestCorners`, o padrão dos exemplos de kanban, media distância de canto a canto e
 * errava a coluna estreita da faixa de encerramento: os cantos de um cartão de 272px
 * ficam a mais de 100px de uma coluna de 48px, e o vizinho ganhava. Foi visto em
 * conferência — a oitava seta pulava "Publicado" e "Nutrição" e caía em "Perdido".
 */
const quemRecebeOCartao: CollisionDetection = (argumentos) => {
  const pelaPonta = pointerWithin(argumentos);
  return pelaPonta.length > 0 ? pelaPonta : closestCenter(argumentos);
};

/**
 * Etapa que só recebe cartão pela folha de mover.
 *
 * Três casos: pede próxima ação (RF-FUN-03), pede campo obrigatório (RF-FUN-04) ou é o
 * opt-out. O opt-out não exige campo nenhum no banco, mas soltar um cartão nele grava
 * `consent_events(contact_optout)`, que liga `do_not_contact` e põe o número na
 * `suppression_list` — nenhum envio chega mais àquela pessoa, em modo nenhum, e a tela
 * não desfaz isso. Um gesto de arrastar não pode ser a única coisa entre a Heloísa e
 * essa consequência: aqui ele vira o pedido, e a folha é a confirmação.
 */
function etapaExigeFormulario(etapa: EtapaQuadro): boolean {
  return etapaExigeProximaAcao(etapa) || etapa.required_fields.length > 0 || etapa.is_optout;
}

export function Quadro({
  quadro,
  filtros,
  funilId,
  pequena,
  aoAbrirMover,
  aoTrocarEtapa,
}: {
  quadro: QuadroDoBanco;
  /** O mesmo recorte que a tela usou em `useQuadro`: é a chave de cache do movimento. */
  filtros: FiltrosQuadro;
  funilId: number;
  /** Abaixo de `md`: trilha de etapas mais lista, em vez de colunas. */
  pequena: boolean;
  aoAbrirMover: (pedido: PedidoDeAbrirMover) => void;
  /** No celular, trocar a etapa aberta (vai para a URL e para a RPC). */
  aoTrocarEtapa: (etapaId: number) => void;
}) {
  const etapas = quadro.stages;
  const movimento = useMoverCartao(filtros);
  const paginacao = useCarregarMais(filtros, funilId);

  const [cartaoArrastado, setCartaoArrastado] = useState<CartaoQuadro | null>(null);
  const [etapasAbertas, setEtapasAbertas] = useState<ReadonlySet<number>>(new Set());

  const sensores = useSensors(
    // 6px antes de virar arraste: sem essa folga, tocar no nome do parceiro levantaria
    // o cartão e o link da ficha nunca abriria.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: coordenadasPorTeclado }),
  );

  /** O caminho único de todo movimento do quadro: arraste do desktop e botão do celular. */
  const pedirMovimento = useCallback(
    (cartao: CartaoQuadro, deEtapaId: number, destino: EtapaQuadro) => {
      if (etapaExigeFormulario(destino)) {
        aoAbrirMover({ cartao, etapaAtualId: deEtapaId, etapaDestinoId: destino.id });
        return;
      }
      movimento.mover({ cartao, deEtapaId, paraEtapaId: destino.id });
    },
    [aoAbrirMover, movimento],
  );

  function aoComecarArraste(evento: DragStartEvent) {
    const dados = dadosDoCartao(evento.active.data.current);
    const achado = dados
      ? etapas.find((e) => e.id === dados.deEtapaId)?.cards.find((c) => c.deal_id === dados.dealId)
      : null;
    setCartaoArrastado(achado ?? null);
  }

  function aoTerminarArraste(evento: DragEndEvent) {
    setCartaoArrastado(null);
    const doCartao = dadosDoCartao(evento.active.data.current);
    const daColuna = evento.over ? dadosDaColuna(evento.over.data.current) : null;
    // Soltar na coluna de onde saiu não é movimento: o banco chamaria de `etapa_igual`
    // e a pessoa levaria um aviso por não ter feito nada.
    if (!doCartao || !daColuna || daColuna.etapaId === doCartao.deEtapaId) return;

    const origem = etapas.find((e) => e.id === doCartao.deEtapaId);
    const cartao = origem?.cards.find((c) => c.deal_id === doCartao.dealId);
    const destino = etapas.find((e) => e.id === daColuna.etapaId);
    if (cartao && destino) pedirMovimento(cartao, doCartao.deEtapaId, destino);
  }

  const avisos = (
    <>
      {movimento.aviso ? (
        <AvisoDoMovimento aviso={movimento.aviso} aoFechar={movimento.limparAviso} />
      ) : null}
      {paginacao.aviso ? (
        <AvisoDoMovimento aviso={paginacao.aviso} aoFechar={paginacao.limparAviso} />
      ) : null}
    </>
  );

  // -------------------------------------------------------------------------
  // Celular: trilha de etapas mais a lista da etapa aberta (RF-FUN-09)
  // -------------------------------------------------------------------------
  if (pequena) {
    const aberta = etapas.find((e) => e.id === filtros.etapaId) ?? etapas[0];
    if (!aberta) return null;

    return (
      <div className="flex flex-col gap-3">
        {avisos}
        <TrilhaDeEtapas etapas={etapas} etapaAtivaId={aberta.id} aoEscolher={aoTrocarEtapa} />
        <ListaDaEtapa
          etapa={aberta}
          emVoo={movimento.cartaoEmVoo}
          carregando={paginacao.etapaCarregando === aberta.id}
          aoCarregarMais={() =>
            paginacao.carregarMais({ etapaId: aberta.id, carregados: aberta.cards.length })
          }
          aoAbrirMover={aoAbrirMover}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Desktop: o quadro
  // -------------------------------------------------------------------------
  const deTrabalho = etapas.filter((e) => !etapaEhDeSaida(e));
  const deSaida = etapas.filter(etapaEhDeSaida);
  const haRecolhida = deSaida.some((e) => !etapasAbertas.has(e.id));

  const colunaCheia = (etapa: EtapaQuadro) => (
    <Coluna
      key={etapa.id}
      etapa={etapa}
      arrastando={cartaoArrastado !== null}
      carregandoMais={paginacao.etapaCarregando === etapa.id}
      aoCarregarMais={() =>
        paginacao.carregarMais({ etapaId: etapa.id, carregados: etapa.cards.length })
      }
    >
      {etapa.cards.map((cartao) => (
        <CartaoArrastavel
          key={cartao.deal_id}
          cartao={cartao}
          etapaId={etapa.id}
          emVoo={movimento.cartaoEmVoo === cartao.deal_id}
          aoMover={() => aoAbrirMover({ cartao, etapaAtualId: etapa.id })}
        />
      ))}
    </Coluna>
  );

  return (
    <div className="flex flex-col gap-3">
      {avisos}

      <DndContext
        sensors={sensores}
        collisionDetection={quemRecebeOCartao}
        accessibility={{
          announcements: avisosDeArraste,
          screenReaderInstructions: instrucoesDeLeitor,
        }}
        onDragStart={aoComecarArraste}
        onDragEnd={aoTerminarArraste}
        onDragCancel={() => setCartaoArrastado(null)}
      >
        <div className="flex gap-3 overflow-x-auto pb-3">
          {deTrabalho.map(colunaCheia)}

          {deSaida.length > 0 ? (
            <div className="flex shrink-0 gap-2 border-l border-hairline pl-3">
              {haRecolhida ? (
                <CabecaDaFaixaDeSaida
                  aoAbrirTudo={() => setEtapasAbertas(new Set(deSaida.map((e) => e.id)))}
                />
              ) : null}
              {deSaida.map((etapa) =>
                etapasAbertas.has(etapa.id) ? (
                  colunaCheia(etapa)
                ) : (
                  <ColunaRecolhida
                    key={etapa.id}
                    etapa={etapa}
                    arrastando={cartaoArrastado !== null}
                    aoAbrir={() => setEtapasAbertas((atual) => new Set(atual).add(etapa.id))}
                  />
                ),
              )}
            </div>
          ) : null}
        </div>

        <DragOverlay modifiers={[restrictToWindowEdges]} dropAnimation={null}>
          {cartaoArrastado ? <CartaoEmVoo cartao={cartaoArrastado} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/** Lista vertical da etapa aberta no celular, em largura cheia. */
function ListaDaEtapa({
  etapa,
  emVoo,
  carregando,
  aoCarregarMais,
  aoAbrirMover,
}: {
  etapa: EtapaQuadro;
  emVoo: string | null;
  carregando: boolean;
  aoCarregarMais: () => void;
  aoAbrirMover: (pedido: PedidoDeAbrirMover) => void;
}) {
  const faltam = etapa.total - etapa.cards.length;

  return (
    <div className="flex flex-col gap-2">
      {etapa.cards.map((cartao) => (
        <CartaoArrastavel
          key={cartao.deal_id}
          cartao={cartao}
          etapaId={etapa.id}
          emVoo={emVoo === cartao.deal_id}
          aoMover={() => aoAbrirMover({ cartao, etapaAtualId: etapa.id })}
        />
      ))}

      {etapa.total === 0 ? (
        <p className="px-1 py-10 text-center text-sm text-muted-foreground">
          Nenhum negócio em {etapa.name}. Escolha outra etapa na trilha acima, ou traga um cartão
          para cá pelo botão &ldquo;Mover de etapa&rdquo;.
        </p>
      ) : null}

      {faltam > 0 ? (
        <button
          type="button"
          onClick={aoCarregarMais}
          disabled={carregando}
          className="toque mt-1 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-hairline text-sm font-medium text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
        >
          {carregando ? (
            'Carregando'
          ) : (
            <>
              Carregar mais <span className="numerico">{faltam}</span>
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
