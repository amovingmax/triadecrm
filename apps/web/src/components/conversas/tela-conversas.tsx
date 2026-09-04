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
}: {
  catalogos: CatalogosConversas;
  filtrosIniciais: FiltrosConversas;
  /** Veio de `?org=<id>`: abre esta conversa já na entrada. */
  organizacaoInicial: string | null;
}) {
  const ehCelular = useEhCelular();
  const [filtros, setFiltros] = useState<FiltrosConversas>(filtrosIniciais);
  const [escolhidoId, setEscolhidoId] = useState<string | null>(organizacaoInicial);

  const consulta = useQuery({ queryKey: CHAVE_CONVERSAS, queryFn: carregarConversas });

  const todos = useMemo<ItemConversa[]>(() => {
    if (!consulta.data) return [];
    return montarConversas({
      organizacoes: consulta.data.organizacoes,
      atividades: consulta.data.atividades,
      negocios: consulta.data.negocios,
      catalogos,
    });
  }, [consulta.data, catalogos]);

  const itens = useMemo(() => aplicarFiltros(todos, filtros), [todos, filtros]);

  // Sem escolha explícita, o desktop abre a primeira da lista. É derivação, não efeito:
  // um `setState` dentro de `useEffect` aqui reordenaria a tela depois de pintá-la.
  const abertaId = escolhidoId ?? (ehCelular ? null : (itens[0]?.id ?? null));

  // A conversa aberta é procurada em TODOS, não no recorte: mudar o filtro não pode
  // fechar na cara da pessoa a conversa que ela está lendo.
  const aberta = abertaId ? (todos.find((i) => i.id === abertaId) ?? null) : null;

  useEffect(() => {
    const alvo = `${window.location.pathname}${urlDoEstado(filtros, escolhidoId)}`;
    if (alvo !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', alvo);
    }
  }, [filtros, escolhidoId]);

  const mudar = useCallback((parcial: Partial<FiltrosConversas>) => {
    setFiltros((atual) => ({ ...atual, ...parcial }));
  }, []);

  const limpar = useCallback(() => setFiltros(FILTROS_VAZIOS), []);
  const voltar = useCallback(() => setEscolhidoId(null), []);

  const recorte = temRecorte(filtros);
  const soBusca = recorte && contarFiltros(filtros) === 0;
  const comContato = todos.filter((i) => i.ultimaEm !== null).length;

  // No celular, conversa aberta é tela cheia: cabeçalho e filtros saem de cena.
  const telaCheia = ehCelular && aberta !== null;

  return (
    <div className="flex w-full flex-col gap-4 md:h-[calc(100dvh-7.5rem)]">
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
              ) : (
                <>
                  <span className="numerico">{numero(comContato)}</span> com contato registrado,{' '}
                  <span className="numerico">{numero(todos.length - comContato)}</span> ainda sem
                  nenhum
                </>
              )}
            </p>
          </header>

          <FiltrosDaConversa
            filtros={filtros}
            pessoas={catalogos.pessoas}
            aoMudar={mudar}
            aoLimpar={limpar}
          />

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
        )}
      >
        {/* Lista. No celular ela some quando uma conversa está aberta (não é `hidden`:
            é não renderizar, para os cartões não trafegarem à toa no 4G da rua). */}
        {telaCheia ? null : (
          <section
            aria-label="Parceiros por interação mais recente"
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
            aria-label="Linha do tempo do parceiro"
            className="min-h-0 min-w-0 md:overflow-hidden"
          >
            {consulta.isPending ? null : aberta ? (
              <Conversa key={aberta.id} item={aberta} catalogos={catalogos} aoVoltar={voltar} />
            ) : (
              <NenhumaEscolhida />
            )}
          </section>
        )}
      </div>
    </div>
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
