'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';

import { Conversa } from './conversa';
import { carregarConversas, CHAVE_CONVERSAS, mensagemDoErro } from './dados';
import {
  ErroDaTela,
  EsqueletoLista,
  NenhumaEscolhida,
  VazioDeVerdade,
  VazioPorFiltro,
} from './estados';
import { contarFila, FilaDeAprovacao, FilaVazia, tempoDoMaisUrgente } from './fila-aprovacao';
import { FiltrosDaConversa } from './filtros-conversas';
import { numero } from './formatos';
import { ListaConversas } from './lista-conversas';
import { aplicarFiltros, montarConversas, type CatalogosConversas } from './montagem';
import {
  contarFiltros,
  FILTROS_VAZIOS,
  ROTULO_CANAL,
  ROTULO_JANELA,
  temRecorte,
  urlDoEstado,
  type AbaDaEsquerda,
  type FiltrosConversas,
  type ItemConversa,
} from './tipos';

/**
 * Conversas: a lista de parceiros à esquerda, a linha do tempo à direita.
 *
 * ===========================================================================
 * O QUE ESTA TELA ENTREGA HOJE
 * ===========================================================================
 * O inbox de WhatsApp do RF-CON-05 não pode existir antes de a Meta verificar o CNPJ
 * da Komune e aprovar os modelos de mensagem (RF-CON-02) — semanas, e nada disso é
 * código. O que dá para entregar com o dado que existe é a metade que o RF-CON-06
 * pede e que já tem valor sozinha: o histórico do relacionamento, parceiro por
 * parceiro, no formato exato em que as mensagens vão entrar depois.
 *
 * A tela diz isso em português, no lugar onde a pessoa procuraria as mensagens
 * (`AvisoWhatsapp`), em vez de fingir uma caixa de entrada.
 *
 * ===========================================================================
 * COMO ELA SE COMPORTA
 * ===========================================================================
 * - Desktop: duas colunas com rolagem própria, ocupando a altura da janela. Sem
 *   nenhuma escolha, a coluna da direita já mostra a primeira conversa da lista: abrir
 *   o módulo e ver uma coluna vazia é gastar um clique para chegar onde a pessoa ia
 *   de todo jeito.
 * - Celular: uma coisa por vez. A lista ocupa a tela; ao tocar num parceiro ela dá
 *   lugar à conversa, com um "voltar" de 44px. O cabeçalho e os filtros saem junto,
 *   porque em 390px eles comeriam metade da linha do tempo.
 *
 * O recorte e a conversa aberta vivem na URL por `replaceState` (sem entrada nova no
 * histórico, sem volta ao servidor): um link de "olha a conversa da Neuma Leão" pode
 * ser mandado no grupo, e voltar da tela de registro traz a mesma conversa aberta.
 */
export function TelaConversas({
  catalogos,
  filtrosIniciais,
  organizacaoInicial,
  abaInicial,
}: {
  catalogos: CatalogosConversas;
  filtrosIniciais: FiltrosConversas;
  /** Veio de `?org=<id>`: abre esta conversa já na entrada. */
  organizacaoInicial: string | null;
  /** Veio de `?aba=aprovar`: entra direto na fila do ADR-05. */
  abaInicial: AbaDaEsquerda;
}) {
  const ehCelular = useEhCelular();
  const [filtros, setFiltros] = useState<FiltrosConversas>(filtrosIniciais);
  const [escolhidoId, setEscolhidoId] = useState<string | null>(organizacaoInicial);
  const [aba, setAba] = useState<AbaDaEsquerda>(abaInicial);

  const consulta = useQuery({ queryKey: CHAVE_CONVERSAS, queryFn: carregarConversas });

  const todos = useMemo<ItemConversa[]>(() => {
    if (!consulta.data) return [];
    return montarConversas({
      organizacoes: consulta.data.organizacoes,
      atividades: consulta.data.atividades,
      negocios: consulta.data.negocios,
      fios: consulta.data.fios,
      rascunhos: consulta.data.rascunhosPendentes,
      catalogos,
    });
  }, [consulta.data, catalogos]);

  const itens = useMemo(() => aplicarFiltros(todos, filtros), [todos, filtros]);

  // A fila de aprovação NÃO passa pelo recorte da lista: ela é a fila do ADR-05
  // inteira. Um rascunho escondido por um filtro de canal que alguém deixou
  // ligado é um rascunho que expira sem ninguém ver — e o filtro é da OUTRA
  // pergunta ("com quem eu falo agora?").
  const paraAprovar = useMemo(() => todos.filter((i) => i.rascunhoPendente !== null), [todos]);
  const fila = useMemo(() => contarFila(paraAprovar), [paraAprovar]);
  const maisUrgente = useMemo(() => tempoDoMaisUrgente(paraAprovar), [paraAprovar]);

  const daAba = aba === 'aprovar' ? paraAprovar : itens;

  // Sem escolha explícita, o desktop abre a primeira da lista. É derivação, não efeito:
  // um `setState` dentro de `useEffect` aqui reordenaria a tela depois de pintá-la.
  const abertaId = escolhidoId ?? (ehCelular ? null : (daAba[0]?.id ?? null));

  // A conversa aberta é procurada em TODOS, não no recorte: mudar o filtro não pode
  // fechar na cara da pessoa a conversa que ela está lendo.
  const aberta = abertaId ? (todos.find((i) => i.id === abertaId) ?? null) : null;

  useEffect(() => {
    const alvo = `${window.location.pathname}${urlDoEstado(filtros, escolhidoId, aba)}`;
    if (alvo !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', alvo);
    }
  }, [filtros, escolhidoId, aba]);

  const mudar = useCallback((parcial: Partial<FiltrosConversas>) => {
    setFiltros((atual) => ({ ...atual, ...parcial }));
  }, []);

  const limpar = useCallback(() => setFiltros(FILTROS_VAZIOS), []);
  const voltar = useCallback(() => setEscolhidoId(null), []);

  const recorte = temRecorte(filtros);
  const soBusca = recorte && contarFiltros(filtros) === 0;
  const comContato = todos.filter((i) => i.ultimaEm !== null).length;
  const porLer = todos.reduce((soma, i) => soma + i.naoLidas, 0);
  const meta = consulta.data?.meta ?? null;
  const temFio = todos.some((i) => i.fio !== null);

  // No celular, conversa aberta é tela cheia: cabeçalho e filtros saem de cena.
  const telaCheia = ehCelular && aberta !== null;

  return (
    <div
      className={cn(
        'flex w-full flex-col gap-4 md:h-[calc(100dvh-7.5rem)]',
        // No celular, conversa aberta é tela cheia DE VERDADE: altura fixa,
        // rolagem por dentro, caixa de resposta encostada na barra inferior. Sem
        // isto a página inteira é que rola, a caixa de resposta fica no fim de
        // uma página de três metros e a conversa não abre na última mensagem —
        // que é o único lugar onde ela deveria abrir. A conta é a casca:
        // cabeçalho de 3,5rem + 1,5rem de respiro em cima + 5rem da barra
        // inferior com o respiro de baixo.
        telaCheia && 'h-[calc(100dvh-10rem-var(--area-segura-inferior))]',
      )}
    >
      {telaCheia ? null : (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Conversas</h1>
            <p className="text-sm text-muted-foreground">
              {consulta.isPending ? (
                'Carregando o histórico...'
              ) : recorte ? (
                <>
                  <span className="numerico">{numero(itens.length)}</span>
                  {itens.length === 1 ? ' parceiro' : ' parceiros'} com esse filtro
                </>
              ) : porLer > 0 || fila.total > 0 ? (
                <>
                  <span className="numerico">{numero(porLer)}</span>
                  {porLer === 1 ? ' mensagem por ler' : ' mensagens por ler'},{' '}
                  <span className="numerico">{numero(fila.total)}</span>
                  {fila.total === 1 ? ' rascunho esperando você' : ' rascunhos esperando você'}
                </>
              ) : (
                <>
                  <span className="numerico">{numero(comContato)}</span> com contato registrado,{' '}
                  <span className="numerico">{numero(todos.length - comContato)}</span> ainda sem
                  nenhum
                </>
              )}
            </p>
          </header>

          <Abas
            aba={aba}
            aoTrocar={setAba}
            naFila={fila.total}
            comAviso={fila.comAviso}
            maisUrgente={maisUrgente}
          />

          {/* O recorte é da lista de conversas. Na fila de aprovação ele não
              aparece porque não se aplica: lá a lista já é curta e é inteira. */}
          {aba === 'conversas' ? (
            <FiltrosDaConversa
              filtros={filtros}
              pessoas={catalogos.pessoas}
              aoMudar={mudar}
              aoLimpar={limpar}
            />
          ) : null}

          {consulta.data?.cortada ? (
            <p className="text-xs text-muted-foreground">
              A base passou do que esta tela lê de uma vez, então a lista está cortada.
              Avise no grupo do time: o histórico precisa virar consulta paginada no banco.
            </p>
          ) : null}
        </>
      )}

      <div
        className={cn(
          'grid min-h-0 flex-1 border-t border-hairline',
          'md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:overflow-hidden',
          telaCheia && 'overflow-hidden',
        )}
      >
        {/* Lista. No celular ela some quando uma conversa está aberta (não é `hidden`:
            é não renderizar, para os cartões não trafegarem à toa no 4G da rua). */}
        {telaCheia ? null : (
          <section
            aria-label={aba === "aprovar" ? "Rascunhos esperando aprovação" : "Parceiros por interação mais recente"}
            // `min-w-0`: sem ele o item de grade assume `min-width: auto` e cresce até o
            // conteúdo, e em 390px a lista nascia com 484px de largura (o "hoje" e o
            // chevron caíam fora da tela). É a mesma armadilha do flex.
            className="min-h-0 min-w-0 md:overflow-y-auto md:border-r md:border-hairline"
          >
            {consulta.isPending ? (
              <EsqueletoLista />
            ) : consulta.isError ? (
              <ErroDaTela
                causa={mensagemDoErro(consulta.error)}
                aoTentar={() => void consulta.refetch()}
              />
            ) : aba === 'aprovar' ? (
              paraAprovar.length === 0 ? (
                <FilaVazia temFio={temFio} />
              ) : (
                <FilaDeAprovacao
                  itens={paraAprovar}
                  selecionadoId={aberta?.id ?? null}
                  aoEscolher={setEscolhidoId}
                />
              )
            ) : itens.length === 0 && recorte ? (
              <VazioPorFiltro
                descricao={descreverRecorte(filtros, catalogos)}
                soBusca={soBusca}
                aoLimpar={limpar}
              />
            ) : itens.length === 0 ? (
              <VazioDeVerdade />
            ) : (
              <ListaConversas itens={itens} selecionadoId={aberta?.id ?? null} aoEscolher={setEscolhidoId} />
            )}
          </section>
        )}

        {/* Conversa. No celular só existe quando alguém escolheu. */}
        {ehCelular && !aberta ? null : (
          <section
            aria-label="Conversa com o parceiro"
            className="min-h-0 min-w-0 md:overflow-hidden"
          >
            {consulta.isPending ? null : aberta ? (
              <Conversa
                key={aberta.id}
                item={aberta}
                catalogos={catalogos}
                meta={meta}
                aoVoltar={voltar}
                escolhaExplicita={escolhidoId !== null}
              />
            ) : (
              <NenhumaEscolhida meta={meta} />
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * As duas listas da esquerda, num par de abas.
 *
 * A aba de aprovação carrega o número, e o número é o ponto: uma fila de
 * aprovação sem contador é uma fila que ninguém sabe que existe. Quando o
 * validador de promessas apitou em algum rascunho, isso também aparece aqui —
 * antes de abrir, e não depois de ler o texto inteiro.
 *
 * O tempo até o mais urgente sumir fecha a linha. Rascunho vive três dias; sem
 * essa conta, "5 esperando" parece uma pilha parada, quando às vezes é uma pilha
 * que some hoje à noite.
 */
function Abas({
  aba,
  aoTrocar,
  naFila,
  comAviso,
  maisUrgente,
}: {
  aba: AbaDaEsquerda;
  aoTrocar: (aba: AbaDaEsquerda) => void;
  naFila: number;
  comAviso: number;
  maisUrgente: { numero: string; unidade: string } | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="tablist"
        aria-label="O que mostrar na lista"
        className="inline-flex w-fit gap-1 rounded-full border border-hairline p-0.5"
      >
        <Aba
          ativa={aba === 'conversas'}
          aoClicar={() => aoTrocar('conversas')}
          rotulo="Conversas"
        />
        <Aba ativa={aba === 'aprovar'} aoClicar={() => aoTrocar('aprovar')} rotulo="Aprovar">
          {naFila > 0 ? (
            <span
              className={cn(
                'numerico inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]',
                aba === 'aprovar'
                  ? 'bg-background text-foreground'
                  : 'bg-foreground text-background',
              )}
            >
              {naFila}
            </span>
          ) : null}
        </Aba>
      </div>

      {aba === 'aprovar' && naFila > 0 ? (
        <p className="text-xs text-muted-foreground">
          Nada sai sem uma pessoa aprovar (ADR-05).
          {comAviso > 0 ? (
            <>
              {' '}
              O validador de promessas apitou em{' '}
              <span className="numerico">{numero(comAviso)}</span>
              {comAviso === 1 ? ' deles' : ' deles'}.
            </>
          ) : null}
          {maisUrgente ? (
            <>
              {' '}
              O primeiro some em <span className="numerico">{maisUrgente.numero}</span>
              {maisUrgente.unidade}.
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function Aba({
  ativa,
  aoClicar,
  rotulo,
  children,
}: {
  ativa: boolean;
  aoClicar: () => void;
  rotulo: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={aoClicar}
      className={cn(
        'toque inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm outline-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
        ativa ? 'bg-foreground font-medium text-background' : 'text-muted-foreground hover:bg-muted',
      )}
    >
      {rotulo}
      {children}
    </button>
  );
}

/** Diz em português o que a pessoa filtrou, para o vazio não ser genérico. */
function descreverRecorte(filtros: FiltrosConversas, catalogos: CatalogosConversas): string {
  const partes: string[] = [];
  if (filtros.q.trim()) partes.push(`busca "${filtros.q.trim()}"`);
  const pessoa = catalogos.pessoas.find((p) => p.id === filtros.responsavelId);
  if (pessoa) partes.push(`responsável ${pessoa.nome}`);
  if (filtros.canal) partes.push(`canal ${ROTULO_CANAL[filtros.canal]}`);
  if (filtros.janela !== 'qualquer') partes.push(`"${ROTULO_JANELA[filtros.janela]}"`);

  const quantos = partes.length;
  const lista = partes.join(', ');
  return quantos > 1
    ? `Nada bate com ${lista} ao mesmo tempo. Tire um filtro por vez.`
    : `Nada bate com ${lista}.`;
}
