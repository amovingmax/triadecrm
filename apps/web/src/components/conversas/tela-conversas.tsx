'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';
import { useAcoesDosAvisos } from '@/components/avisos/provedor-avisos';
import { SeletorDeAba } from '@/components/ui/abas';
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';

import { FeedAutomaticas } from './automaticas';
import { carregarAutomaticas, carregarMarcoZero, CHAVE_AUTOMATICAS } from './automaticas-dados';
import { Conversa } from './conversa';
import { carregarConversas, CHAVE_CONVERSAS, mensagemDoErro, TETO_ORGANIZACOES } from './dados';
import { useEcoDasConversas, type EstadoDoEco } from './eco-do-banco';
import {
  ErroDaTela,
  EsqueletoLista,
  NenhumaEscolhida,
  SemConversasMinhas,
  VazioDeVerdade,
  VazioPorFiltro,
} from './estados';
import { contarFila, FilaDeAprovacao, FilaVazia, tempoDoMaisUrgente } from './fila-aprovacao';
import { FiltrosDaConversa } from './filtros-conversas';
import { numero } from './formatos';
import { ConversaForaDaBase, ListaForaDaBase } from './fora-da-base';
import { conversasForaDaBase } from './fora-da-base-dados';
import { ListaConversas } from './lista-conversas';
import {
  aplicarFiltros,
  filaDeQuemRespondeu,
  filtrarClientes,
  juntarNaLista,
  montarConversas,
  type CatalogosConversas,
} from './montagem';
import {
  contarFiltros,
  ESCOPOS,
  FILTROS_VAZIOS,
  ROTULO_CANAL,
  ROTULO_JANELA,
  temRecorte,
  urlDoEstado,
  type AbaDaEsquerda,
  type EscopoDaLista,
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
 *
 * ===========================================================================
 * QUEM NÃO É PARCEIRO APARECE EM "TODAS" (01/10/2026)
 * ===========================================================================
 * A lista da aba "Conversas" era só de parceiros, e quem escrevia sem ser ficha
 * ficava apenas na aba "Clientes". Janio: "essa mensagem deve chegar para a aba
 * de conversas em 'todos'". Agora os clientes entram na mesma lista, na mesma
 * ordem (por ler primeiro, depois o mais recente), e a conversa deles abre ao
 * lado como abre na aba "Clientes" — que continua existindo, como o recorte só
 * deles. `foraId` é a conversa de cliente aberta nas duas abas.
 *
 * O aviso de quem respondeu saiu daqui: quem avisa é a casca
 * (`components/avisos`), em qualquer tela e só a quem atende. Esta tela só conta
 * a ela qual conversa está aberta e como abrir outra sem navegar.
 */
export function TelaConversas({
  catalogos,
  filtrosIniciais,
  organizacaoInicial,
  clienteInicial,
  abaInicial,
  escopoInicial,
}: {
  catalogos: CatalogosConversas;
  filtrosIniciais: FiltrosConversas;
  /**
   * O recorte com que a tela abre para esta pessoa ("Minhas" para quem atende).
   * O endereço omite o padrão: `/conversas` sozinho é "Minhas", e só a escolha
   * diferente aparece (`?ver=todas`).
   */
  escopoInicial: EscopoDaLista;
  /** Veio de `?org=<id>`: abre esta conversa já na entrada. */
  organizacaoInicial: string | null;
  /** Veio de `?cliente=<id da conversa>`: abre a conversa de quem não é ficha. */
  clienteInicial: string | null;
  /** Veio de `?aba=aprovar`: entra direto na fila do ADR-05. */
  abaInicial: AbaDaEsquerda;
}) {
  const ehCelular = useEhCelular();
  const [filtros, setFiltros] = useState<FiltrosConversas>(filtrosIniciais);
  const [escolhidoId, setEscolhidoId] = useState<string | null>(organizacaoInicial);
  const [aba, setAba] = useState<AbaDaEsquerda>(abaInicial);
  /**
   * A conversa de cliente aberta (id da conversa, não da ficha). Vale na aba
   * "Clientes" e, desde 01/10/2026, na aba "Conversas", onde o cliente também
   * aparece.
   */
  const [foraId, setForaId] = useState<string | null>(clienteInicial);

  const consulta = useQuery({ queryKey: CHAVE_CONVERSAS, queryFn: carregarConversas });

  // O feed do que saiu sozinho é uma RPC própria, por MENSAGEM, e só é buscada
  // quando a aba está aberta: ela lê `public.messages` num intervalo de sete
  // dias, e pagar isso em toda abertura da tela de Conversas seria cobrar de
  // todo mundo uma pergunta que quase ninguém está fazendo naquele momento.
  const automaticas = useQuery({
    queryKey: CHAVE_AUTOMATICAS,
    queryFn: carregarAutomaticas,
    enabled: aba === 'automaticas',
  });
  // A data de corte do feed, para a tela poder DIZER de onde ela conta. Consulta
  // separada e barata (uma linha de `app_settings`), e o feed não espera por ela.
  const marcoZero = useQuery({
    queryKey: ['conversas', 'automaticas', 'marco-zero'],
    queryFn: carregarMarcoZero,
    enabled: aba === 'automaticas',
    staleTime: 5 * 60 * 1000,
  });

  const todos = useMemo<ItemConversa[]>(() => {
    if (!consulta.data) return [];
    return montarConversas({
      organizacoes: consulta.data.organizacoes,
      atividades: consulta.data.atividades,
      negocios: consulta.data.negocios,
      fios: consulta.data.fios,
      rascunhos: consulta.data.rascunhosPendentes,
      leituras: consulta.data.leituras,
      etiquetas: consulta.data.etiquetas,
      etiquetasDoParceiro: consulta.data.etiquetasDoParceiro,
      catalogos,
    });
  }, [consulta.data, catalogos]);

  // Quem está olhando: é o que "Minhas" e "Meu setor" perguntam (Fase 1).
  const quem = useMemo(
    () => ({
      euId: consulta.data?.euId ?? null,
      meusSetores: consulta.data?.meusSetores ?? [],
    }),
    [consulta.data],
  );
  const itens = useMemo(() => aplicarFiltros(todos, filtros, quem), [todos, filtros, quem]);
  // Quem escreveu e não é ficha: a aba "Clientes" inteira, e parte da lista de Conversas.
  const foraDaBase = useMemo(() => conversasForaDaBase(consulta.data?.fios ?? []), [consulta.data]);
  const porEscopo = useMemo(
    () =>
      // "Todas" não leva número: é a lista inteira, e o número dela já está no
      // cabeçalho. Sem ele, os três rótulos cabem na coluna de 20rem.
      ESCOPOS.map((e) => ({
        ...e,
        contagem:
          e.id === 'todas'
            ? null
            : aplicarFiltros(todos, { ...filtros, escopo: e.id }, quem).length +
              filtrarClientes(foraDaBase, { ...filtros, escopo: e.id }, quem).length,
      })),
    [todos, foraDaBase, filtros, quem],
  );

  // A fila de aprovação NÃO passa pelo recorte da lista: ela é a fila do ADR-05
  // inteira. Um rascunho escondido por um filtro de canal que alguém deixou
  // ligado é um rascunho que expira sem ninguém ver — e o filtro é da OUTRA
  // pergunta ("com quem eu falo agora?").
  const paraAprovar = useMemo(() => todos.filter((i) => i.rascunhoPendente !== null), [todos]);
  const fila = useMemo(() => contarFila(paraAprovar), [paraAprovar]);
  const maisUrgente = useMemo(() => tempoDoMaisUrgente(paraAprovar), [paraAprovar]);

  /**
   * A FILA DE QUEM RESPONDEU (28/09/2026, ADR-16). Como a de aprovação, ela NÃO
   * passa pelo recorte da lista: é a pergunta "quem está esperando há mais
   * tempo?", e um filtro de canal esquecido ligado esconderia justamente o
   * fornecedor que respondeu por outro caminho.
   *
   * Limite honesto, e igual ao das outras abas: `todos` é montado no cliente a
   * partir de leituras com teto (`conversas/dados.ts`), então esta contagem é a
   * contagem DO QUE FOI CARREGADO, como a de "Aprovar" e a de "Fora da base".
   */
  const responderam = useMemo(() => filaDeQuemRespondeu(todos), [todos]);

  const daAba = aba === 'aprovar' ? paraAprovar : aba === 'responderam' ? responderam : itens;
  // Os clientes que cabem no recorte da lista de Conversas ("Minhas", busca...).
  const clientesNaLista = useMemo(
    () => filtrarClientes(foraDaBase, filtros, quem),
    [foraDaBase, filtros, quem],
  );

  // O cliente escolhido é procurado em TODOS os clientes, não no recorte — a
  // mesma regra da conversa de parceiro, logo abaixo.
  const clienteEscolhido = foraId ? (foraDaBase.find((f) => f.id === foraId) ?? null) : null;
  // Sem escolha nenhuma, o desktop abre a primeira linha da lista. Na aba
  // "Conversas" ela pode ser um cliente: é quem acabou de escrever.
  const primeiraLinha =
    aba === 'conversas' ? (juntarNaLista(itens, clientesNaLista)[0] ?? null) : null;
  const semEscolha = escolhidoId === null && clienteEscolhido === null && !ehCelular;
  const foraAberta =
    aba === 'fora'
      ? (clienteEscolhido ?? (ehCelular ? null : (foraDaBase[0] ?? null)))
      : aba === 'conversas'
        ? (clienteEscolhido ??
          (semEscolha && primeiraLinha?.tipo === 'cliente' ? primeiraLinha.fio : null))
        : null;

  // Sem escolha explícita, o desktop abre a primeira da lista. É derivação, não efeito:
  // um `setState` dentro de `useEffect` aqui reordenaria a tela depois de pintá-la.
  // Com um cliente aberto, nenhuma conversa de parceiro está aberta.
  const abertaId = foraAberta ? null : (escolhidoId ?? (ehCelular ? null : (daAba[0]?.id ?? null)));

  // A conversa aberta é procurada em TODOS, não no recorte: mudar o filtro não pode
  // fechar na cara da pessoa a conversa que ela está lendo.
  const aberta = abertaId ? (todos.find((i) => i.id === abertaId) ?? null) : null;

  // Parceiro e cliente não ficam abertos ao mesmo tempo: escolher um fecha o outro.
  const escolherParceiro = useCallback((organizacaoId: string) => {
    setForaId(null);
    setEscolhidoId(organizacaoId);
  }, []);
  const escolherCliente = useCallback((conversaId: string) => {
    setEscolhidoId(null);
    setForaId(conversaId);
  }, []);

  useEffect(() => {
    const alvo = `${window.location.pathname}${urlDoEstado(filtros, escolhidoId, aba, foraId, escopoInicial)}`;
    if (alvo !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', alvo);
    }
  }, [filtros, escolhidoId, aba, foraId, escopoInicial]);

  // O AVISO DE QUEM RESPONDEU SAIU DAQUI (01/10/2026). Quem avisa é a casca
  // (`components/avisos`): em qualquer tela, só a quem atende, com o cartão
  // "Nova mensagem". Esta tela conta a ela duas coisas — qual conversa está
  // aberta, para o cartão não anunciar o que a pessoa está lendo, e como abrir
  // outra sem navegar, porque o estado daqui mora no cliente.
  //
  // Abrir NÃO tira a marca "Nova" nem o número do menu (05/10/2026): só a
  // resposta de alguém do time tira. Ver `semResposta`, em `avisos/regra.ts`.
  // O "por ler" é outra coisa e sai ao abrir (06/10/2026, `leitura-do-fio.ts`).
  const { olharConversa, registrarAbridor } = useAcoesDosAvisos();
  const conversaAbertaId = foraAberta?.id ?? aberta?.fio?.id ?? null;
  useEffect(() => {
    olharConversa(conversaAbertaId);
    return () => olharConversa(null);
  }, [conversaAbertaId, olharConversa]);
  useEffect(() => {
    registrarAbridor(({ conversaId, organizacaoId }) => {
      setAba('conversas');
      if (organizacaoId) escolherParceiro(organizacaoId);
      else escolherCliente(conversaId);
    });
    return () => registrarAbridor(null);
  }, [registrarAbridor, escolherParceiro, escolherCliente]);

  const eco = useEcoDasConversas({ organizacaoAberta: aberta?.id ?? null });

  const mudar = useCallback((parcial: Partial<FiltrosConversas>) => {
    setFiltros((atual) => ({ ...atual, ...parcial }));
  }, []);

  const limpar = useCallback(() => setFiltros(FILTROS_VAZIOS), []);
  const voltar = useCallback(() => setEscolhidoId(null), []);

  // MEXER NA CONVERSA É ESCOLHÊ-LA (06/10/2026).
  //
  // O desktop abre a primeira da lista sem ninguém pedir, e essa abertura não
  // zera o "por ler" (ver `leitura-do-fio.ts`): o contador é do time, e zerar
  // ali faria cada pessoa que entra na tela apagar o sinal da conversa do topo.
  // Só que a linha dela já aparece marcada na lista, e ninguém clica no que
  // parece escolhido. Clicar, rolar ou digitar dentro da conversa passa a valer
  // como a escolha — e a prende no lugar, em vez de a tela trocar de conversa
  // quando outra pessoa escreve e sobe para o topo.
  const abertaAgoraId = aberta?.id ?? null;
  const escolherAberta = useCallback(() => {
    if (abertaAgoraId !== null && abertaAgoraId !== escolhidoId) escolherParceiro(abertaAgoraId);
  }, [abertaAgoraId, escolhidoId, escolherParceiro]);
  const foraAbertaId = foraAberta?.id ?? null;
  const escolherForaAberta = useCallback(() => {
    if (foraAbertaId !== null && foraAbertaId !== foraId) escolherCliente(foraAbertaId);
  }, [foraAbertaId, foraId, escolherCliente]);
  const nadaNaLista = itens.length + clientesNaLista.length === 0;

  const recorte = temRecorte(filtros);
  const soBusca = recorte && contarFiltros(filtros) === 0;
  // "Minhas" e mais nada: nem busca, nem filtro, nem arquivadas.
  const soMinhas = filtros.escopo === 'minhas' && !temRecorte({ ...filtros, escopo: 'todas' });
  const comContato = todos.filter((i) => i.ultimaEm !== null).length;
  const porLer =
    todos.reduce((soma, i) => soma + i.naoLidas, 0) +
    foraDaBase.reduce((soma, f) => soma + f.unread_count, 0);
  const meta = consulta.data?.meta ?? null;
  const temFio = todos.some((i) => i.fio !== null);

  // No celular, conversa aberta é tela cheia: cabeçalho e filtros saem de cena.
  const telaCheia = ehCelular && (foraAberta !== null || aberta !== null);

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
          <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h1 className="flex items-baseline gap-2 font-heading text-lg font-semibold tracking-tight">
              Conversas
              <EstadoAoVivo estado={eco} />
            </h1>
            <p className="text-xs text-muted-foreground">
              {consulta.isPending ? (
                'Carregando o histórico...'
              ) : recorte ? (
                <>
                  <span className="numerico">{numero(itens.length + clientesNaLista.length)}</span>
                  {itens.length + clientesNaLista.length === 1 ? ' conversa' : ' conversas'} com
                  esse filtro
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

          {/* Abas e busca dividem a MESMA faixa no desktop. Empilhadas, elas e o
              título somavam 200 px antes da primeira conversa — numa tela em que o
              conteúdo é a lista. No celular continuam uma embaixo da outra, porque
              lá a busca precisa da largura inteira. */}
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
            <Abas
              aba={aba}
              aoTrocar={setAba}
              naFila={fila.total}
              esperando={responderam.length}
              foraDaBase={foraDaBase.length}
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
                className="md:w-[26rem]"
              />
            ) : null}
          </div>

          {consulta.data?.cortada ? (
            // Uma frase para quem usa, e não o recado de engenharia que estava aqui
            // ("o histórico precisa virar consulta paginada no banco"): quem lê
            // precisa saber que a lista não é tudo e como achar o resto. A busca
            // DESTA tela filtra só o que já foi lido; quem busca na base inteira é
            // a tela de Parceiros, e a ficha abre a conversa com `?org=`.
            <p className="text-xs text-muted-foreground">
              A lista mostra os primeiros {TETO_ORGANIZACOES} parceiros. Para abrir outro, procure
              em{' '}
              <Link
                href="/parceiros"
                className="underline underline-offset-4 hover:text-foreground"
              >
                Parceiros
              </Link>{' '}
              e use &ldquo;Abrir a conversa&rdquo; na ficha.
            </p>
          ) : null}
        </>
      )}

      <div
        className={cn(
          // DOIS CARTÕES SOBRE A TELA CINZA (29/09/2026, Design System), e não
          // duas colunas de uma grade com filete entre elas. A lista e o fio são
          // duas coisas, e cada uma mora no seu branco — é o que o protótipo
          // desenha e o que separa "painel" de "tabela de duas colunas".
          'grid min-h-0 flex-1 gap-3 md:gap-4',
          // A lista era 20rem em qualquer tela: o nome do parceiro truncava no
          // meio e a prévia da conversa cabia em cinco palavras. Numa tela de
          // 1440 sobrava largura de sobra do outro lado — a conversa não fica
          // melhor com 1.100 px do que com 900. Então a lista cresce com a tela.
          'md:grid-cols-[minmax(0,23rem)_minmax(0,1fr)] md:overflow-hidden',
          'xl:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]',
          telaCheia && 'overflow-hidden',
        )}
      >
        {/* Lista. No celular ela some quando uma conversa está aberta (não é `hidden`:
            é não renderizar, para os cartões não trafegarem à toa no 4G da rua). */}
        {/* A aba "Automáticas" ocupa a LARGURA TODA, e isso não é uma classe:
            a coluna da esquerda é renderizada sempre que não é `telaCheia`, então
            é a condição que muda. O feed é por mensagem e não por parceiro — uma
            lista de parceiros ao lado dele não responderia pergunta nenhuma, e
            roubaria 20rem do texto que saiu. */}
        {telaCheia || aba === 'automaticas' ? null : (
          <section
            aria-label={
              aba === 'aprovar'
                ? 'Rascunhos esperando aprovação'
                : 'Parceiros por interação mais recente'
            }
            // `min-w-0`: sem ele o item de grade assume `min-width: auto` e cresce até o
            // conteúdo, e em 390px a lista nascia com 484px de largura (o "hoje" e o
            // chevron caíam fora da tela). É a mesma armadilha do flex.
            // `min-w-0`: sem ele o item de grade assume `min-width: auto` e
            // cresce até o conteúdo, e em 390px a lista nascia com 484px.
            className="sombra-base min-h-0 min-w-0 rounded-xl bg-card md:overflow-y-auto"
          >
            {aba === 'conversas' && !consulta.isPending ? (
              <div className="sticky top-0 z-10 border-b border-hairline bg-background px-3 py-2">
                <SeletorDeAba
                  itens={porEscopo}
                  ativo={filtros.escopo}
                  aoTrocar={(escopo) => mudar({ escopo })}
                  rotulo="De quem são as conversas"
                />
              </div>
            ) : null}
            {consulta.isPending ? (
              <EsqueletoLista />
            ) : consulta.isError ? (
              <ErroDaTela
                causa={mensagemDoErro(consulta.error)}
                aoTentar={() => void consulta.refetch()}
              />
            ) : aba === 'fora' ? (
              <ListaForaDaBase
                fios={foraDaBase}
                selecionadoId={foraAberta?.id ?? null}
                aoEscolher={setForaId}
              />
            ) : aba === 'responderam' ? (
              responderam.length === 0 ? (
                <p className="px-4 py-8 text-sm text-muted-foreground">
                  Ninguém está esperando resposta. Quando um fornecedor escrever, ele aparece aqui
                  primeiro.
                </p>
              ) : (
                <ListaConversas
                  itens={responderam}
                  selecionadoId={aberta?.id ?? null}
                  aoEscolher={escolherParceiro}
                />
              )
            ) : aba === 'aprovar' ? (
              paraAprovar.length === 0 ? (
                <FilaVazia temFio={temFio} />
              ) : (
                <FilaDeAprovacao
                  itens={paraAprovar}
                  selecionadoId={aberta?.id ?? null}
                  aoEscolher={escolherParceiro}
                />
              )
            ) : filtros.escopo === 'setor' && quem.meusSetores.length === 0 ? (
              <p className="px-4 py-8 text-sm text-muted-foreground">
                Você ainda não está em nenhum setor. Um gestor coloca você em Ajustes → Pessoas.
              </p>
            ) : nadaNaLista && soMinhas ? (
              // A tela abre em "Minhas", e quem ainda não atende ninguém cairia
              // em "nenhuma conversa com esses filtros" sem ter filtrado nada.
              <SemConversasMinhas aoVerTodas={() => mudar({ escopo: 'todas' })} />
            ) : nadaNaLista && recorte ? (
              <VazioPorFiltro
                descricao={descreverRecorte(filtros, catalogos)}
                soBusca={soBusca}
                aoLimpar={limpar}
              />
            ) : nadaNaLista ? (
              <VazioDeVerdade />
            ) : (
              <ListaConversas
                itens={itens}
                selecionadoId={aberta?.id ?? null}
                aoEscolher={escolherParceiro}
                clientes={clientesNaLista}
                clienteSelecionadoId={foraAberta?.id ?? null}
                aoEscolherCliente={escolherCliente}
              />
            )}
          </section>
        )}

        {/* Conversa. No celular só existe quando alguém escolheu. */}
        {aba === 'automaticas' ? (
          <section
            aria-label="O que o CRM mandou sozinho"
            className="sombra-base min-h-0 min-w-0 rounded-xl bg-card md:col-span-2 md:overflow-y-auto"
          >
            {automaticas.isPending ? (
              <EsqueletoLista />
            ) : automaticas.isError ? (
              <ErroDaTela
                causa={mensagemDoErro(automaticas.error)}
                aoTentar={() => void automaticas.refetch()}
              />
            ) : (
              <FeedAutomaticas
                linhas={automaticas.data ?? []}
                marcoZero={marcoZero.data ?? null}
                aoAbrir={({ organizacaoId, conversaId }) => {
                  // A ficha manda: a conversa dela abre na aba "Conversas", que é
                  // onde o fio inteiro está. Sem ficha, o destino é a aba "Fora da
                  // base", pelo id do FIO — o mesmo caminho que `fora-da-base.tsx`
                  // já usa, e o único que existe para quem não é parceiro.
                  if (organizacaoId) {
                    setAba('conversas');
                    escolherParceiro(organizacaoId);
                  } else if (conversaId) {
                    setAba('fora');
                    setForaId(conversaId);
                  }
                }}
              />
            )}
          </section>
        ) : aba === 'fora' || foraAberta ? (
          ehCelular && !foraAberta ? null : (
            <section
              aria-label="Conversa com cliente"
              className="sombra-base min-h-0 min-w-0 rounded-xl bg-card md:overflow-hidden"
              onPointerDownCapture={escolherForaAberta}
              onKeyDownCapture={escolherForaAberta}
              onWheelCapture={escolherForaAberta}
            >
              {foraAberta ? (
                <ConversaForaDaBase
                  key={foraAberta.id}
                  fio={foraAberta}
                  catalogos={catalogos}
                  escolhaExplicita={foraAberta.id === foraId}
                  aoVoltar={() => setForaId(null)}
                  aoLigar={(organizacaoId) => {
                    setAba('conversas');
                    escolherParceiro(organizacaoId);
                  }}
                />
              ) : consulta.isPending ? null : (
                <NenhumaEscolhida meta={meta} />
              )}
            </section>
          )
        ) : ehCelular && !aberta ? null : (
          <section
            aria-label="Conversa com o parceiro"
            className="sombra-base min-h-0 min-w-0 rounded-xl bg-card md:overflow-hidden"
            onPointerDownCapture={escolherAberta}
            onKeyDownCapture={escolherAberta}
            onWheelCapture={escolherAberta}
          >
            {consulta.isPending ? null : aberta ? (
              <Conversa
                key={aberta.id}
                item={aberta}
                catalogos={catalogos}
                setores={consulta.data?.setores ?? []}
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
/**
 * Em que modo a tela está se atualizando.
 *
 * Fala só quando há o que dizer. Ligada ao banco, um ponto e duas palavras —
 * discretos, mas presentes, porque "a tela atualiza sozinha" é uma promessa e
 * promessa sem sinal vira desconfiança no primeiro minuto de silêncio. Sem o
 * eco, diz o que passou a fazer no lugar: quem precisa saber é quem vai esperar
 * uma resposta olhando para a tela.
 *
 * `ligando` não mostra nada: um aviso que aparece por meio segundo em toda
 * abertura de tela é piscada, não informação. Sem cor nenhuma — nesta tela a
 * escala térmica é a única cor, e um ponto verde competiria com ela.
 */
function EstadoAoVivo({ estado }: { estado: EstadoDoEco }) {
  if (estado === 'ligando') return null;

  if (estado === 'sem_eco') {
    return (
      <span
        className="text-[0.6875rem] font-normal text-muted-foreground"
        title="A conexão ao vivo com o banco não subiu (rede ou proxy). A tela confere sozinha a cada 20 segundos."
      >
        atualizando a cada 20 s
      </span>
    );
  }

  return (
    <span
      className="flex items-baseline gap-1.5 text-[0.6875rem] font-normal text-muted-foreground"
      title="A tela recebe do banco e se atualiza sozinha quando o parceiro responde."
    >
      <span aria-hidden="true" className="size-1.5 self-center rounded-full bg-current" />
      ao vivo
    </span>
  );
}

function Abas({
  aba,
  aoTrocar,
  naFila,
  esperando,
  foraDaBase,
  comAviso,
  maisUrgente,
}: {
  aba: AbaDaEsquerda;
  aoTrocar: (aba: AbaDaEsquerda) => void;
  naFila: number;
  /** Quantos escreveram e estão esperando resposta — a contagem do que foi carregado. */
  esperando: number;
  /** Conversas de números que não são ficha. */
  foraDaBase: number;
  comAviso: number;
  maisUrgente: { numero: string; unidade: string } | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <SeletorDeAba
        rotulo="O que mostrar na lista"
        ativo={aba}
        aoTrocar={aoTrocar}
        // Em 390 px "Fora da base" quebrava em duas linhas e a faixa das abas
        // crescia; rolando de lado ela fica com a altura de uma linha só.
        rolavel
        itens={[
          { id: 'conversas', rotulo: 'Conversas' },
          { id: 'responderam', rotulo: 'Responderam', contagem: esperando },
          { id: 'aprovar', rotulo: 'Aprovar', contagem: naFila },
          // "Clientes", e não "Fora da base" (01/10/2026): é o nome do que chega
          // aqui na prática — gente que escreveu e não é lead.
          { id: 'fora', rotulo: 'Clientes', contagem: foraDaBase },
          // SEM CONTAGEM, de propósito: um número aqui diria "trabalho parado",
          // e o feed não é fila — a maior parte das automáticas não pede nada de
          // ninguém. Quem cobra ação é o Meu dia e a aba "Responderam".
          { id: 'automaticas', rotulo: 'Automáticas' },
        ]}
      />

      {aba === 'aprovar' && naFila > 0 ? (
        <p className="text-xs text-muted-foreground">
          Nada sai sem uma pessoa aprovar.
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

/** Diz em português o que a pessoa filtrou, para o vazio não ser genérico. */
function descreverRecorte(filtros: FiltrosConversas, catalogos: CatalogosConversas): string {
  const partes: string[] = [];
  if (filtros.q.trim()) partes.push(`busca "${filtros.q.trim()}"`);
  const pessoa = catalogos.pessoas.find((p) => p.id === filtros.responsavelId);
  if (pessoa) partes.push(`responsável ${pessoa.nome}`);
  const atende = catalogos.pessoas.find((p) => p.id === filtros.atendenteId);
  if (atende) partes.push(`atendido por ${atende.nome}`);
  if (filtros.escopo === 'minhas') partes.push('"Minhas"');
  if (filtros.escopo === 'setor') partes.push('"Meu setor"');
  if (filtros.canal) partes.push(`canal ${ROTULO_CANAL[filtros.canal]}`);
  if (filtros.janela !== 'qualquer') partes.push(`"${ROTULO_JANELA[filtros.janela]}"`);

  const quantos = partes.length;
  const lista = partes.join(', ');
  return quantos > 1
    ? `Nada bate com ${lista} ao mesmo tempo. Tire um filtro por vez.`
    : `Nada bate com ${lista}.`;
}
