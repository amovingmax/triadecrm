'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronRight,
  CircleCheck,
  Handshake,
  Search,
  SquarePen,
  Store,
  UserRound,
  Users,
} from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { ROTULO_DO_CANAL as ROTULO_DA_CHEGADA } from '@komune/schema';

import { EMPRESA } from '@/lib/empresa';
import { cn } from '@/lib/utils';
import { Chip } from '@/components/ui/chip';
import { FaixaDeslizante } from '@/components/ui/faixa-deslizante';
import { useAcoesDosAvisos, useAvisos } from '@/components/avisos/provedor-avisos';
import { TelaGrupos } from '@/components/grupos/tela-grupos';
import { juntarAsPerdidas } from '@/components/ligacao-whatsapp/logica';
import { useLigacoesPerdidas } from '@/components/ligacao-whatsapp/perdidas';

import { useAreaVisivel } from './area-visivel';
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';

import { useAtitudes } from './atitude-dados';
import { useCanais } from './canal-de-chegada-dados';
import { FeedAutomaticas } from './automaticas';
import { carregarAutomaticas, carregarMarcoZero, CHAVE_AUTOMATICAS } from './automaticas-dados';
import { CONCLUIR_NA_EMPRESA } from './concluir-conversa';
import { Conversa } from './conversa';
import { carregarConversas, CHAVE_CONVERSAS, mensagemDoErro, TETO_ORGANIZACOES } from './dados';
import { BuscaDeMensagens } from './busca-de-mensagens';
import { usePreferencias } from './menu-da-conversa';
import { useEcoDasConversas, type EstadoDoEco } from './eco-do-banco';
import {
  ErroDaTela,
  EsqueletoLista,
  SemConcluidas,
  SemConversasMinhas,
  TelaDeEntrada,
  VazioDeVerdade,
  VazioPorFiltro,
} from './estados';
import { BotaoDeFiltros, BuscaDaLista } from './filtros-conversas';
import { local } from './formatos';
import { ConversaForaDaBase, ListaForaDaBase } from './fora-da-base';
import { conversasForaDaBase, nomeDoCliente } from './fora-da-base-dados';
import { ListaConversas } from './lista-conversas';
import { FiltroDaParceria } from './perfil-da-conversa';
import {
  CLIENTES_E_PARCEIROS,
  contarPorTipo,
  esperamPorCaixa,
  filtrarParceiros,
  mapaDosParceiros,
  RECORTE_INICIAL,
  type RecorteDosParceiros,
} from './perfil-regra';
import {
  aplicarFiltros,
  clientesComFicha,
  contatosDeConsultoria,
  emCaptacao,
  filtrarClientes,
  montarConversas,
  normalizar,
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
import { AvatarDaConversa, BotaoRedondo } from './wpp';

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
 *   nenhuma escolha, a coluna da direita mostra a tela de entrada com a marca da
 *   empresa, como o WhatsApp do computador (04/11/2026). Até aqui ela abria sozinha
 *   a primeira conversa da lista.
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
/**
 * AS DUAS CAIXAS (13/11/2026, só onde `caixasDeConversa` está ligado: a KOMUNE).
 * "Hoje as conversas estão bastante confusas, pois os clientes e prospectados
 * entram na mesma aba de conversa." Desde então a tela tem duas caixas no alto
 * da lista, cada uma com o seu número de conversas esperando resposta:
 * - Fornecedores: quem tem ficha em Prospectados. Abas Conversas, Consultoria,
 *   Automáticas e Grupos, como antes; a lista de Conversas não leva mais cliente.
 * - Clientes: quem escreve sem ficha (quase sempre usuário do app). É a aba
 *   `fora` de sempre, com busca e a gaveta das concluídas.
 * Quem escreveu sem ficha mas escolheu "Quero ser fornecedor" no robô leva o selo
 * "parece fornecedor", e "Mover para Fornecedores" é o "Virar parceiro" de antes.
 * Desligado, vale o que diz a seção "QUEM NÃO É PARCEIRO APARECE EM 'TODAS'".
 */
const CAIXAS = EMPRESA.modulos.caixasDeConversa;

/**
 * CLIENTES E PARCEIROS (23/11/2026, só onde `clientesEParceiros` está ligado: a
 * Imova). "Todos os que entram em contato pela primeira vez com a Imova devem
 * entrar como Cliente e devem permanecer por lá até que seja mudado o perfil
 * dele para Parceiro." O formato é o das caixas da KOMUNE, com outro corte:
 * - Clientes: a lista de Conversas de sempre (com ficha ou sem), com Minhas,
 *   Meu setor, a ordem, os filtros e as pílulas Automáticas e Grupos.
 * - Parceiros: quem tem a marca (`public.consultoria`, com o tipo e o imóvel).
 *   É a aba `consultoria` de antes, agora com busca, as pílulas do tipo e a
 *   gaveta das concluídas. Negócio ganho não põe ninguém aqui sozinho.
 * As pílulas Consultoria e Clientes saem: viraram as duas caixas. O número de
 * cada caixa é o do menu, dividido pela marca (`esperamPorCaixa`).
 */
const PERFIS = CLIENTES_E_PARCEIROS;

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
  /** Veio de `?aba=`: `consultoria`, `fora` ou `automaticas` abrem direto nela. */
  abaInicial: AbaDaEsquerda;
}) {
  const ehCelular = useEhCelular();
  const [filtros, setFiltros] = useState<FiltrosConversas>(filtrosIniciais);
  const [escolhidoId, setEscolhidoId] = useState<string | null>(organizacaoInicial);
  // Na Imova, desde Clientes e Parceiros, a aba "Clientes" é a própria lista de
  // Conversas: um link antigo com `?aba=fora` cai nela.
  const [aba, setAba] = useState<AbaDaEsquerda>(
    PERFIS && abaInicial === 'fora' ? 'conversas' : abaInicial,
  );
  /**
   * A conversa de cliente aberta (id da conversa, não da ficha). Vale na aba
   * "Clientes" e, desde 01/10/2026, na aba "Conversas", onde o cliente também
   * aparece.
   */
  const [foraId, setForaId] = useState<string | null>(clienteInicial);
  /** A busca e a gaveta das concluídas da caixa Clientes (13/11/2026). */
  const [buscaClientes, setBuscaClientes] = useState('');
  const [clientesConcluidos, setClientesConcluidos] = useState(false);
  const { respostasNovas, respostasDosClientes, fichasDasRespostas } = useAvisos();
  /** A busca, o tipo e a gaveta das concluídas da caixa Parceiros (Imova). */
  const [recorteParceiros, setRecorteParceiros] = useState<RecorteDosParceiros>(RECORTE_INICIAL);

  const consulta = useQuery({ queryKey: CHAVE_CONVERSAS, queryFn: carregarConversas });
  // Fixar e silenciar, de quem está olhando (27/10/2026): a lista sobe as
  // fixadas e marca as silenciadas.
  const preferencias = usePreferencias();
  /**
   * A mensagem até onde a conversa aberta deve rolar: veio da busca pelo texto
   * das mensagens (`BuscaDeMensagens`). Some quando a conversa chega nela.
   */
  const [mensagemAlvo, setMensagemAlvo] = useState<string | null>(null);
  const chegouNoAlvo = useCallback(() => setMensagemAlvo(null), []);

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

  // Quem é Parceiro, e como (Imova). `null` na KOMUNE: vale a Consultoria de sempre.
  const mapaParceiros = useMemo(
    () => (PERFIS ? mapaDosParceiros(consulta.data?.parceiros ?? []) : null),
    [consulta.data],
  );
  // O abridor dos avisos lê o mapa da hora, sem se registrar de novo a cada leitura.
  const parceirosAgora = useRef(mapaParceiros);
  useEffect(() => {
    parceirosAgora.current = mapaParceiros;
  }, [mapaParceiros]);

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
      emConsultoria: consulta.data.emConsultoria,
      parceiros: mapaParceiros,
      catalogos,
    });
  }, [consulta.data, catalogos, mapaParceiros]);

  // Quem está olhando: é o que "Minhas" e "Meu setor" perguntam (Fase 1).
  const quem = useMemo(
    () => ({
      euId: consulta.data?.euId ?? null,
      meusSetores: consulta.data?.meusSetores ?? [],
    }),
    [consulta.data],
  );
  // Quem fechou saiu da lista de captação e mora na aba "Consultoria" (06/10/2026).
  const captacao = useMemo(() => emCaptacao(todos), [todos]);
  const consultoria = useMemo(() => contatosDeConsultoria(todos), [todos]);
  // A ligação perdida (03/11/2026): quem ligou e não foi atendido sobe para o topo das
  // listas e entra em "Minhas" para todos, até alguém retornar. Fora da Imova o mapa é
  // sempre vazio.
  const perdidas = useLigacoesPerdidas();
  // O canal de chegada (06/11/2026, só Imova): o chip nas linhas e o filtro
  // "Canal de chegada". Uma leitura só para a tela; desligado, o mapa é vazio e
  // o filtro nem aparece.
  const canais = useCanais();
  const chegadas = canais.porConversa;
  const itens = useMemo(() => {
    const recorte = aplicarFiltros(captacao, filtros, quem, chegadas);
    if (perdidas.size === 0 || filtros.escopo === 'todas') return recorte;
    return juntarAsPerdidas(
      recorte,
      aplicarFiltros(captacao, { ...filtros, escopo: 'todas' }, quem, chegadas),
      (i) => i.fio?.id ?? null,
      (i) => i.id,
      perdidas,
    );
  }, [captacao, filtros, quem, perdidas, chegadas]);
  // Quem escreveu e não é ficha: a aba "Clientes" inteira, e parte da lista de Conversas.
  const foraDaBase = useMemo(() => conversasForaDaBase(consulta.data?.fios ?? []), [consulta.data]);
  // TODO CLIENTE TEM FICHA (Imova, 03/11/2026): quem escreve ganha ficha de
  // Cliente no minuto seguinte, e a conversa dele continua na aba Clientes —
  // agora como conversa de ficha, com etapa e próxima ação. Os que ainda não
  // ganharam (o minuto do robô, quem pediu para sair) seguem como sempre.
  const comFicha = EMPRESA.modulos.fichaDoCliente;
  const clientesFichados = useMemo(
    () => (comFicha ? clientesComFicha(captacao) : []),
    [comFicha, captacao],
  );
  const clientesNaAba = aba === 'fora' && comFicha;
  // Os clientes que a lista de Conversas alcança. Na Imova entram também os
  // concluídos (03/11/2026): é a gaveta de "Concluídas" que os mostra, e a
  // conversa concluída continua aberta na tela de quem acabou de concluir, como a
  // de parceiro. Na KOMUNE é a mesma lista da aba Clientes, como sempre foi.
  const clientes = useMemo(
    () => (CONCLUIR_NA_EMPRESA ? conversasForaDaBase(consulta.data?.fios ?? [], true) : foraDaBase),
    [consulta.data, foraDaBase],
  );
  // A atitude do cliente (29/10/2026): a etiqueta nas linhas e, com "Mais
  // interessados", a ordem. Desligada (a KOMUNE), nada disso muda a tela.
  const atitudes = useAtitudes();
  const interesse = atitudes.ligada && filtros.ordem === 'interesse' ? atitudes.porConversa : null;
  const porEscopo = useMemo(
    () =>
      // "Todas" não leva número: é a lista inteira, e o número dela já está no
      // cabeçalho. Sem ele, os três rótulos cabem na coluna de 20rem.
      ESCOPOS.map((e) => ({
        ...e,
        contagem:
          e.id === 'todas'
            ? null
            : aplicarFiltros(captacao, { ...filtros, escopo: e.id }, quem, chegadas).length +
              (CAIXAS
                ? 0
                : filtrarClientes(clientes, { ...filtros, escopo: e.id }, quem, chegadas).length),
      })),
    [captacao, clientes, filtros, quem, chegadas],
  );

  // Os clientes que cabem no recorte da lista de Conversas ("Minhas", busca...).
  const clientesNaLista = useMemo(() => {
    // Com as caixas, cliente mora só na caixa Clientes.
    if (CAIXAS) return [];
    const recorte = filtrarClientes(clientes, filtros, quem, chegadas);
    if (perdidas.size === 0 || filtros.escopo === 'todas') return recorte;
    return juntarAsPerdidas(
      recorte,
      filtrarClientes(clientes, { ...filtros, escopo: 'todas' }, quem, chegadas),
      (f) => f.id,
      (f) => f.id,
      perdidas,
    );
  }, [clientes, filtros, quem, perdidas, chegadas]);

  // O cliente escolhido é procurado em TODOS os clientes, não no recorte — a
  // mesma regra da conversa de parceiro, logo abaixo.
  const clienteEscolhido = foraId ? (clientes.find((f) => f.id === foraId) ?? null) : null;
  // Só abre o que a pessoa escolheu, também no computador (04/11/2026): sem
  // escolha, a direita mostra a tela de entrada com a marca da empresa, como o
  // WhatsApp do computador (`TelaDeEntrada`). Até aqui o desktop abria sozinho a
  // primeira linha da lista.
  const foraAberta = aba === 'fora' || (!CAIXAS && aba === 'conversas') ? clienteEscolhido : null;

  // A lista da caixa Clientes: as abertas ou, na gaveta, as concluídas; e a busca
  // por nome, telefone (a partir de 3 dígitos) ou, embaixo, pelo texto.
  const clientesConcluidosTodos = useMemo(
    () => (CAIXAS && CONCLUIR_NA_EMPRESA ? clientes.filter((f) => f.arquivada_em !== null) : []),
    [clientes],
  );
  const clientesDaCaixa = useMemo(() => {
    if (!CAIXAS) return foraDaBase;
    const base = clientesConcluidos ? clientesConcluidosTodos : foraDaBase;
    const termo = normalizar(buscaClientes);
    if (!termo) return base;
    const digitos = buscaClientes.replace(/\D/g, '');
    return base.filter(
      (f) =>
        normalizar(nomeDoCliente(f)).includes(termo) ||
        (digitos.length >= 3 && f.peer_phone_e164.includes(digitos)),
    );
  }, [foraDaBase, clientesConcluidos, clientesConcluidosTodos, buscaClientes]);
  const fiosComFicha = useMemo(
    () => (consulta.data?.fios ?? []).filter((f) => f.organization_id !== null),
    [consulta.data],
  );
  const fiosSemFicha = useMemo(
    () => (consulta.data?.fios ?? []).filter((f) => f.organization_id === null),
    [consulta.data],
  );

  // Com um cliente aberto, nenhuma conversa de parceiro está aberta.
  // Na aba Grupos nenhuma conversa está aberta: o aviso de resposta tem de chegar.
  const abertaId = foraAberta || aba === 'grupos' ? null : escolhidoId;

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
      // Com as caixas, o aviso de quem não tem ficha abre na caixa Clientes. Com
      // Clientes e Parceiros (Imova), o de Parceiro abre na caixa Parceiros.
      setAba(
        PERFIS
          ? organizacaoId && parceirosAgora.current?.has(organizacaoId)
            ? 'consultoria'
            : 'conversas'
          : organizacaoId || !CAIXAS
            ? 'conversas'
            : 'fora',
      );
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
  const mudarBusca = useCallback((q: string) => mudar({ q }), [mudar]);
  const voltar = useCallback(() => setEscolhidoId(null), []);
  const nadaNaLista = itens.length + clientesNaLista.length === 0;

  const recorte = temRecorte(filtros);
  const soBusca = recorte && contarFiltros(filtros) === 0;
  // "Minhas" e mais nada: nem busca, nem filtro, nem arquivadas.
  const soMinhas = filtros.escopo === 'minhas' && !temRecorte({ ...filtros, escopo: 'todas' });
  const meta = consulta.data?.meta ?? null;

  // No celular, conversa aberta é tela cheia: cabeçalho e filtros saem de cena.
  const telaCheia = ehCelular && (foraAberta !== null || aberta !== null);
  useAreaVisivel(telaCheia);
  // A conversa aberta no celular é uma camada da área visível inteira, por cima
  // do cabeçalho do CRM e da barra de baixo (ver `area-visivel.ts`). `h-dvh` é só
  // o primeiro quadro, antes de a área visível ser medida.
  const camadaDoCelular = telaCheia
    ? 'fixed inset-x-0 top-0 z-40 h-dvh rounded-none bg-wpp-painel pt-[env(safe-area-inset-top)] shadow-none'
    : null;

  // A GAVETA DAS CONCLUÍDAS (03/11/2026), no lugar das "Arquivadas" do WhatsApp:
  // uma linha no alto da lista com quantas são, e ela abre a lista só delas. O
  // número respeita o recorte ("Minhas", a busca), para bater com o que a gaveta
  // mostra quando abre.
  const verConcluidas = aba === 'conversas' && filtros.concluidas;
  const quantasConcluidas = useMemo(() => {
    if (!CONCLUIR_NA_EMPRESA || aba !== 'conversas') return 0;
    const so = { ...filtros, concluidas: true };
    return (
      aplicarFiltros(captacao, so, quem, chegadas).length +
      (CAIXAS ? 0 : filtrarClientes(clientes, so, quem, chegadas).length)
    );
  }, [aba, filtros, captacao, clientes, quem, chegadas]);

  // A CAIXA PARCEIROS (Imova, 23/11/2026): a busca, o tipo e a gaveta das
  // concluídas. As pílulas contam as abertas (ou as concluídas, na gaveta).
  const parceirosDaCaixa = useMemo(
    () => (PERFIS ? filtrarParceiros(consultoria, recorteParceiros, chegadas) : consultoria),
    [consultoria, recorteParceiros, chegadas],
  );
  const parceirosPorTipo = useMemo(
    () =>
      contarPorTipo(
        PERFIS
          ? filtrarParceiros(
              consultoria,
              { ...RECORTE_INICIAL, concluidas: recorteParceiros.concluidas },
              chegadas,
            )
          : [],
      ),
    [consultoria, recorteParceiros.concluidas, chegadas],
  );
  const quantosParceiros = [...parceirosPorTipo.values()].reduce((a, n) => a + n, 0);
  const parceirosConcluidos = useMemo(
    () =>
      PERFIS && CONCLUIR_NA_EMPRESA
        ? filtrarParceiros(consultoria, { ...recorteParceiros, concluidas: true }, chegadas).length
        : 0,
    [consultoria, recorteParceiros, chegadas],
  );
  const verParceirosConcluidos = PERFIS && aba === 'consultoria' && recorteParceiros.concluidas;

  // A ficha ao lado da conversa (computador): aberta ou fechada vale para todas as
  // conversas, como no WhatsApp, e não volta a fechar a cada troca.
  const [fichaAberta, setFichaAberta] = useState(false);
  const alternarFicha = useCallback(() => setFichaAberta((v) => !v), []);

  // O ALTO DA LISTA EM TRÊS FAIXAS (protótipo responsivo da Imova, 24/11/2026):
  // a busca, as caixas e UMA linha que desliza com as abas (Conversas ·
  // Automáticas · Grupos) e, na aba Conversas, "Minhas · Meu setor · Todas". Eram
  // cinco faixas (a ordem tinha a sua), uns 260 px antes da primeira conversa no
  // celular; a ordem foi para a folha de filtros. Com as caixas, o seletor vem
  // antes, e as abas são só as da caixa Fornecedores.
  const caixa: Caixa = aba === 'fora' ? 'clientes' : 'fornecedores';
  const esperamClientes = respostasDosClientes;
  const esperamFornecedores =
    respostasNovas === null || respostasDosClientes === null
      ? null
      : Math.max(0, respostasNovas - respostasDosClientes);
  // Clientes e Parceiros (Imova): a caixa é a aba `consultoria` ou o resto.
  const caixaDaImova: 'clientes' | 'parceiros' = aba === 'consultoria' ? 'parceiros' : 'clientes';
  const esperamNaImova = PERFIS
    ? esperamPorCaixa(fichasDasRespostas, mapaParceiros ?? new Map())
    : null;
  const caixas = PERFIS ? (
    <SeletorDeCaixas
      ativa={caixaDaImova}
      aoTrocar={(c) => {
        setAba(c === 'parceiros' ? 'consultoria' : 'conversas');
        setRecorteParceiros(RECORTE_INICIAL);
      }}
      opcoes={[
        {
          id: 'clientes',
          rotulo: 'Clientes',
          Icone: UserRound,
          esperam: esperamNaImova?.clientes ?? null,
          tinta: 'bg-wpp-chip-ativo text-wpp-chip-ativo-texto',
          ponto: 'bg-wpp-cita-barra',
        },
        {
          id: 'parceiros',
          rotulo: 'Parceiros',
          Icone: Handshake,
          esperam: esperamNaImova?.parceiros ?? null,
          tinta: 'bg-wpp-cliente-fundo text-wpp-cliente-texto',
          ponto: 'bg-wpp-cliente',
        },
      ]}
    />
  ) : CAIXAS ? (
    <SeletorDeCaixas
      ativa={caixa}
      aoTrocar={(c) => {
        setAba(c === 'clientes' ? 'fora' : 'conversas');
        setClientesConcluidos(false);
      }}
      opcoes={[
        {
          id: 'fornecedores',
          rotulo: 'Fornecedores',
          Icone: Store,
          esperam: esperamFornecedores,
          tinta: 'bg-wpp-chip-ativo text-wpp-chip-ativo-texto',
          ponto: 'bg-wpp-cita-barra',
        },
        {
          id: 'clientes',
          rotulo: 'Clientes',
          Icone: UserRound,
          esperam: esperamClientes,
          tinta: 'bg-wpp-cliente-fundo text-wpp-cliente-texto',
          ponto: 'bg-wpp-cliente',
        },
      ]}
    />
  ) : null;
  const faixa =
    PERFIS && caixaDaImova === 'parceiros' ? (
      <FiltroDaParceria
        tipo={recorteParceiros.tipo}
        total={quantosParceiros}
        porTipo={parceirosPorTipo}
        aoTrocar={(tipo) => setRecorteParceiros((r) => ({ ...r, tipo }))}
      />
    ) : CAIXAS && caixa === 'clientes' ? null : (
      <FaixaDoTopo
        aba={aba}
        aoTrocar={setAba}
        consultoria={PERFIS ? null : consultoria.length}
        foraDaBase={PERFIS || CAIXAS ? null : foraDaBase.length + clientesFichados.length}
        escopo={
          aba === 'conversas' && !consulta.isPending
            ? { itens: porEscopo, ativo: filtros.escopo, aoTrocar: (escopo) => mudar({ escopo }) }
            : null
        }
      />
    );
  const chips = (
    <>
      {caixas}
      {faixa}
    </>
  );
  // A folha de filtros: os recortes na aba Conversas e, onde a atitude existe, a
  // ordem por interesse (que a lista de clientes da aba `fora` também usa).
  const temFolha = aba === 'conversas' || (aba === 'fora' && atitudes.ligada);

  return (
    <div
      // A casca tira as margens e o teto de largura desta tela (`app-shell.tsx`).
      data-tela-cheia=""
      className={cn(
        // 72px do cabeçalho do CRM no computador e os 12px de baixo da casca.
        'flex w-full flex-col md:h-[calc(100dvh-72px-0.75rem)]',
        // Piso de altura para o celular DEITADO (844x390), que já cai no layout
        // de tela larga: sem ele o painel ficava com 270px, o cabeçalho da
        // conversa e a caixa de resposta comiam tudo e a área das mensagens
        // tinha altura zero (20/10/2026). Com o piso, quem rola é a página.
        'md:min-h-[30rem]',
      )}
    >
      <div
        className={cn(
          // UM CARTÃO SÓ, como a janela do WhatsApp (03/11/2026): a lista e a
          // conversa dividem o mesmo branco, separadas por um filete. Até aqui
          // eram dois cartões sobre a tela cinza, com o título e as abas por cima,
          // e a conversa perdia quase 200px de altura para eles.
          'grid min-h-0 flex-1 bg-wpp-painel md:overflow-hidden md:rounded-[20px] md:border md:border-wpp-linha md:shadow-wpp-caixa',
          // A lista tem 320 px no tablet e 380 px do 1024 para cima (protótipo
          // responsivo, 24/11/2026); a conversa fica com o resto.
          'md:grid-cols-[20rem_minmax(0,1fr)] lg:grid-cols-[23.75rem_minmax(0,1fr)]',
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
        {telaCheia || aba === 'automaticas' || aba === 'grupos' ? null : (
          <section
            aria-label={
              aba === 'consultoria'
                ? PERFIS
                  ? 'Parceiros por interação mais recente'
                  : 'Quem fechou, por interação mais recente'
                : aba === 'fora'
                  ? 'Clientes por mensagem mais recente'
                  : 'Parceiros por interação mais recente'
            }
            // `min-w-0`: sem ele o item de grade assume `min-width: auto` e
            // cresce até o conteúdo, e em 390px a lista nascia com 484px.
            className="flex min-h-0 min-w-0 flex-col md:border-r md:border-wpp-linha"
          >
            {verConcluidas ? (
              <CabecalhoDasConcluidas aoVoltar={() => mudar({ concluidas: false })} />
            ) : verParceirosConcluidos ? (
              <CabecalhoDasConcluidas
                aoVoltar={() => setRecorteParceiros((r) => ({ ...r, concluidas: false }))}
              />
            ) : CAIXAS && aba === 'fora' && clientesConcluidos ? (
              <CabecalhoDasConcluidas aoVoltar={() => setClientesConcluidos(false)} />
            ) : (
              <div className="flex shrink-0 flex-col gap-2.5 px-4 pt-3.5 pb-2 md:px-5">
                <div className="flex items-center gap-1">
                  <h1 className="font-heading text-2xl font-bold tracking-tight md:max-lg:text-[21px]">
                    Conversas
                  </h1>
                  <EstadoAoVivo estado={eco} />
                  <span className="flex-1" />
                  <NovaConversa
                    itens={captacao}
                    aoEscolher={(organizacaoId) => {
                      setAba('conversas');
                      escolherParceiro(organizacaoId);
                    }}
                  />
                  {temFolha ? (
                    <BotaoDeFiltros
                      filtros={filtros}
                      pessoas={catalogos.pessoas}
                      aoMudar={mudar}
                      aoLimpar={limpar}
                      comRecortes={aba === 'conversas'}
                      comOrdem={atitudes.ligada}
                    />
                  ) : null}
                </div>
                {/* O recorte é da lista de conversas. Nas outras abas ele não aparece
                    porque não se aplica: lá a lista já é curta e é inteira. */}
                {aba === 'conversas' ? (
                  <BuscaDaLista valor={filtros.q} aoMudar={mudarBusca} />
                ) : CAIXAS && aba === 'fora' ? (
                  <BuscaDaLista
                    valor={buscaClientes}
                    aoMudar={setBuscaClientes}
                    placeholder="Buscar nome, telefone ou mensagem"
                  />
                ) : PERFIS && aba === 'consultoria' ? (
                  <BuscaDaLista
                    valor={recorteParceiros.busca}
                    aoMudar={(busca) => setRecorteParceiros((r) => ({ ...r, busca }))}
                    placeholder="Buscar nome, bairro ou imóvel"
                  />
                ) : null}
                {chips}
              </div>
            )}

            <div className="min-h-0 flex-1 md:overflow-y-auto">
              {aba === 'conversas' && !verConcluidas && quantasConcluidas > 0 ? (
                <LinhaDasConcluidas
                  quantas={quantasConcluidas}
                  aoAbrir={() => mudar({ concluidas: true })}
                />
              ) : null}
              {PERFIS &&
              aba === 'consultoria' &&
              !recorteParceiros.concluidas &&
              parceirosConcluidos > 0 &&
              !consulta.isPending ? (
                <LinhaDasConcluidas
                  quantas={parceirosConcluidos}
                  aoAbrir={() => setRecorteParceiros((r) => ({ ...r, concluidas: true }))}
                />
              ) : null}
              {CAIXAS &&
              aba === 'fora' &&
              !clientesConcluidos &&
              clientesConcluidosTodos.length > 0 &&
              !consulta.isPending ? (
                <LinhaDasConcluidas
                  quantas={clientesConcluidosTodos.length}
                  aoAbrir={() => setClientesConcluidos(true)}
                />
              ) : null}
              {consulta.isPending ? (
                <EsqueletoLista />
              ) : consulta.isError ? (
                <ErroDaTela
                  causa={mensagemDoErro(consulta.error)}
                  aoTentar={() => void consulta.refetch()}
                />
              ) : clientesNaAba && clientesFichados.length > 0 ? (
                // A mesma lista da aba Conversas, só com os clientes: a ficha abre a
                // conversa de ficha; quem ainda não tem, a de sempre.
                <ListaConversas
                  itens={clientesFichados}
                  selecionadoId={aberta?.id ?? null}
                  aoEscolher={escolherParceiro}
                  clientes={foraDaBase}
                  clienteSelecionadoId={foraAberta?.id ?? null}
                  aoEscolherCliente={escolherCliente}
                  preferencias={preferencias.data}
                  atitudes={atitudes}
                  canais={canais}
                  porInteresse={interesse !== null}
                />
              ) : CAIXAS &&
                aba === 'fora' &&
                clientesDaCaixa.length === 0 &&
                buscaClientes.trim() ? (
                <p className="px-4 py-8 text-sm text-wpp-suave">
                  Nenhum cliente com &ldquo;{buscaClientes.trim()}&rdquo; no nome ou no telefone.
                  {/* A busca pelo texto das mensagens aparece logo abaixo. */}
                </p>
              ) : CAIXAS && aba === 'fora' && clientesConcluidos && clientesDaCaixa.length === 0 ? (
                <p className="px-4 py-8 text-sm text-wpp-suave">Nenhum atendimento concluído.</p>
              ) : aba === 'fora' ? (
                <ListaForaDaBase
                  fios={clientesDaCaixa}
                  selecionadoId={foraAberta?.id ?? null}
                  aoEscolher={setForaId}
                  atitudes={atitudes}
                  canais={canais}
                  perdidas={perdidas}
                  preferencias={preferencias.data}
                  porInteresse={interesse !== null}
                />
              ) : aba === 'consultoria' && PERFIS ? (
                parceirosDaCaixa.length > 0 ? (
                  <ListaConversas
                    itens={parceirosDaCaixa}
                    selecionadoId={aberta?.id ?? null}
                    aoEscolher={escolherParceiro}
                    preferencias={preferencias.data}
                    atitudes={atitudes}
                    canais={canais}
                    perdidas={perdidas}
                  />
                ) : (
                  <p className="px-4 py-8 text-sm text-wpp-suave">
                    {recorteParceiros.concluidas
                      ? 'Nenhuma conversa de Parceiro concluída.'
                      : recorteParceiros.busca.trim() || recorteParceiros.tipo !== 'todos'
                        ? 'Nenhum Parceiro com esse filtro.'
                        : 'Nenhum Parceiro ainda. Na conversa de quem já fechou com a Imova, use “Mudar para Parceiro” e escolha a tag (Proprietário, Colaborador ou Inquilino): ela passa a ficar aqui.'}
                  </p>
                )
              ) : aba === 'consultoria' ? (
                consultoria.length === 0 ? (
                  <p className="px-4 py-8 text-sm text-wpp-suave">
                    Ninguém fechou ainda. Quando um negócio for ganho, a conversa desse parceiro sai
                    da lista de Conversas e passa a aparecer aqui.
                  </p>
                ) : (
                  <ListaConversas
                    itens={consultoria}
                    selecionadoId={aberta?.id ?? null}
                    aoEscolher={escolherParceiro}
                    preferencias={preferencias.data}
                    atitudes={atitudes}
                    canais={canais}
                  />
                )
              ) : filtros.escopo === 'setor' && quem.meusSetores.length === 0 ? (
                <p className="px-4 py-8 text-sm text-wpp-suave">
                  Você ainda não está em nenhum setor. Um gestor coloca você em Ajustes → Pessoas.
                </p>
              ) : nadaNaLista && filtros.concluidas && !filtros.q.trim() ? (
                <SemConcluidas
                  soMinhas={filtros.escopo === 'minhas'}
                  aoVoltar={() => mudar({ concluidas: false })}
                />
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
                  preferencias={preferencias.data}
                  atitudes={atitudes}
                  canais={canais}
                  porInteresse={interesse !== null}
                  perdidas={perdidas}
                />
              )}
              {/* A LUPA NAS MENSAGENS (27/10/2026): embaixo do que o nome achou, o
                  que o TEXTO das mensagens acha. Só na aba Conversas, que é onde
                  a busca mora. */}
              {aba === 'conversas' && !consulta.isPending && !consulta.isError ? (
                <BuscaDeMensagens
                  texto={filtros.q}
                  fios={CAIXAS ? fiosComFicha : (consulta.data?.fios ?? [])}
                  organizacoes={consulta.data?.organizacoes ?? []}
                  aoAbrir={({ conversaId, organizacaoId, mensagemId }) => {
                    setMensagemAlvo(mensagemId);
                    if (organizacaoId) escolherParceiro(organizacaoId);
                    else escolherCliente(conversaId);
                  }}
                />
              ) : CAIXAS && aba === 'fora' && !consulta.isPending && !consulta.isError ? (
                <BuscaDeMensagens
                  texto={buscaClientes}
                  fios={fiosSemFicha}
                  organizacoes={[]}
                  aoAbrir={({ conversaId, mensagemId }) => {
                    setMensagemAlvo(mensagemId);
                    escolherCliente(conversaId);
                  }}
                />
              ) : null}
              {consulta.data?.cortada && aba === 'conversas' ? (
                // Uma frase para quem usa: a lista não é tudo, e como achar o resto.
                // A busca DESTA tela filtra só o que já foi lido; quem busca na base
                // inteira é a tela de Parceiros, e a ficha abre a conversa com `?org=`.
                <p className="px-4 py-3 text-xs text-wpp-suave">
                  A lista mostra os primeiros {TETO_ORGANIZACOES} parceiros. Para abrir outro,
                  procure em{' '}
                  <Link
                    href="/parceiros"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    Parceiros
                  </Link>{' '}
                  e use &ldquo;Abrir a conversa&rdquo; na ficha.
                </p>
              ) : null}
            </div>
          </section>
        )}

        {/* Conversa. No celular só existe quando alguém escolheu. */}
        {/* A aba Grupos põe as duas colunas dela nesta mesma grade (27/10/2026). */}
        {aba === 'grupos' ? (
          <TelaGrupos pessoas={catalogos.pessoas} cabecalho={chips} />
        ) : aba === 'automaticas' ? (
          <section
            aria-label="O que o CRM mandou sozinho"
            className="flex min-h-0 min-w-0 flex-col md:col-span-2"
          >
            <div className="flex shrink-0 flex-col gap-2.5 border-b border-wpp-linha px-4 pt-3.5 pb-3 md:px-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="font-heading text-2xl font-bold tracking-tight md:max-lg:text-[21px]">
                  Conversas
                </h1>
                <span className="text-[13px] text-wpp-suave">
                  Automáticas: o que o CRM mandou sozinho.
                </span>
              </div>
              {chips}
            </div>
            <div className="min-h-0 flex-1 md:overflow-y-auto">
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
                      setAba(
                        PERFIS && mapaParceiros?.has(organizacaoId) ? 'consultoria' : 'conversas',
                      );
                      escolherParceiro(organizacaoId);
                    } else if (conversaId) {
                      // Na Imova quem não tem ficha está na própria lista de Conversas.
                      setAba(PERFIS ? 'conversas' : 'fora');
                      setForaId(conversaId);
                    }
                  }}
                />
              )}
            </div>
          </section>
        ) : (aba === 'fora' && !(clientesNaAba && aberta)) || foraAberta ? (
          ehCelular && !foraAberta ? null : (
            <section
              aria-label="Conversa com cliente"
              className={cn('min-h-0 min-w-0 md:overflow-hidden', camadaDoCelular)}
              data-area-visivel={telaCheia ? '' : undefined}
            >
              {foraAberta ? (
                <ConversaForaDaBase
                  key={foraAberta.id}
                  fio={foraAberta}
                  catalogos={catalogos}
                  mensagemAlvo={mensagemAlvo}
                  aoChegarNoAlvo={chegouNoAlvo}
                  escolhaExplicita={foraAberta.id === foraId}
                  aoVoltar={() => setForaId(null)}
                  aoLigar={(organizacaoId) => {
                    setAba('conversas');
                    escolherParceiro(organizacaoId);
                  }}
                  fichaAberta={fichaAberta}
                  aoAlternarFicha={alternarFicha}
                />
              ) : consulta.isPending && foraId !== null ? null : (
                <TelaDeEntrada />
              )}
            </section>
          )
        ) : ehCelular && !aberta ? null : (
          <section
            aria-label="Conversa com o parceiro"
            className={cn('min-h-0 min-w-0 md:overflow-hidden', camadaDoCelular)}
            data-area-visivel={telaCheia ? '' : undefined}
          >
            {/* A tela de entrada já aparece enquanto a lista carrega; só a
                conversa pedida pelo endereço (`?org=`) espera, sem piscar o logo. */}
            {consulta.isPending && escolhidoId !== null ? null : aberta ? (
              <Conversa
                key={aberta.id}
                item={aberta}
                catalogos={catalogos}
                setores={consulta.data?.setores ?? []}
                meta={meta}
                aoVoltar={voltar}
                escolhaExplicita={escolhidoId !== null}
                mensagemAlvo={mensagemAlvo}
                aoChegarNoAlvo={chegouNoAlvo}
                fichaAberta={fichaAberta}
                aoAlternarFicha={alternarFicha}
              />
            ) : (
              <TelaDeEntrada />
            )}
          </section>
        )}
      </div>
    </div>
  );
}

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
 * abertura de tela é piscada, não informação. O ponto ganhou cor no protótipo
 * responsivo (24/11/2026), e no tablet as palavras saem: fica só o ponto, com
 * a frase no `title` e para o leitor de tela.
 */
function EstadoAoVivo({ estado }: { estado: EstadoDoEco }) {
  if (estado === 'ligando') return null;

  if (estado === 'sem_eco') {
    return (
      <span
        className="ml-2 text-[11.5px] font-normal text-wpp-suave"
        title="A conexão ao vivo com o banco não subiu (rede ou proxy). A tela confere sozinha a cada 20 segundos."
      >
        a cada 20 s
      </span>
    );
  }

  return (
    <span
      className="ml-2 flex items-center gap-1.5 text-xs font-normal whitespace-nowrap text-wpp-suave"
      title="A tela recebe do banco e se atualiza sozinha quando o parceiro responde."
    >
      <span
        aria-hidden="true"
        className="size-[7px] shrink-0 rounded-full bg-cliente-texto shadow-[0_0_0_3px_var(--cliente-fundo)] motion-safe:animate-pulse"
      />
      <span className="md:max-lg:sr-only">ao vivo</span>
    </span>
  );
}

/** "Minhas · Meu setor · Todas", com quantas conversas cada uma tem. */
type EscopoNaFaixa = {
  itens: readonly { id: EscopoDaLista; rotulo: string; contagem: number | null }[];
  ativo: EscopoDaLista;
  aoTrocar: (escopo: EscopoDaLista) => void;
};

/**
 * A linha que desliza no alto da lista (protótipo responsivo, 24/11/2026): as
 * abas da tela e, na aba Conversas, depois de um separador, de quem são as
 * conversas. Em 390 px ela não cabe e rola de lado, com a aba aberta sempre à
 * vista (`FaixaDeslizante`). As fichas têm 44 px no celular e 40 px no
 * computador; eram pílulas de 24 a 32 px.
 */
function FaixaDoTopo({
  aba,
  aoTrocar,
  consultoria,
  foraDaBase,
  escopo,
}: {
  aba: AbaDaEsquerda;
  aoTrocar: (aba: AbaDaEsquerda) => void;
  /**
   * Parceiros que já fecharam — a contagem do que foi carregado. `null` = a
   * ficha não existe (Clientes e Parceiros, na Imova: virou a caixa Parceiros).
   */
  consultoria: number | null;
  /** Conversas de números que não são ficha. `null` = a ficha não existe (as caixas). */
  foraDaBase: number | null;
  /** Só na aba Conversas, e só depois de a lista carregar. */
  escopo: EscopoNaFaixa | null;
}) {
  const todas: readonly { id: AbaDaEsquerda; rotulo: string; contagem?: number }[] = [
    { id: 'conversas', rotulo: 'Conversas' },
    // Pós-venda (06/10/2026): quem fechou com a gente sai da lista de
    // Conversas e vem para cá.
    { id: 'consultoria', rotulo: 'Consultoria', contagem: consultoria ?? undefined },
    // "Clientes", e não "Fora da base" (01/10/2026): é o nome do que chega
    // aqui na prática — gente que escreveu e não é lead.
    { id: 'fora', rotulo: 'Clientes', contagem: foraDaBase ?? undefined },
    // SEM CONTAGEM, de propósito: um número aqui diria "trabalho parado",
    // e o feed não é fila — a maior parte das automáticas não pede nada de
    // ninguém.
    { id: 'automaticas', rotulo: 'Automáticas' },
    // Os grupos de WhatsApp (27/10/2026): até 8 pessoas, entrada por link.
    { id: 'grupos', rotulo: 'Grupos' },
  ];
  // Com as caixas (13/11/2026), Clientes é a outra caixa, não uma ficha; com
  // Clientes e Parceiros (Imova, 23/11/2026), a Consultoria também.
  const itens = todas.filter(
    (i) =>
      !(i.id === 'fora' && foraDaBase === null) &&
      !(i.id === 'consultoria' && consultoria === null),
  );
  return (
    <FaixaDeslizante rotulo="O que mostrar na lista" ativo={aba} sangria>
      {itens.map((item) => (
        <Chip
          key={item.id}
          ativo={aba === item.id}
          contagem={item.contagem || null}
          onClick={() => aoTrocar(item.id)}
          className="md:h-10"
        >
          {item.rotulo}
        </Chip>
      ))}
      {escopo ? (
        <>
          <span aria-hidden="true" className="my-1.5 w-px self-stretch bg-border" />
          {/* "Todas" não leva número: é a lista inteira. */}
          <span role="group" aria-label="De quem são as conversas" className="contents">
            {escopo.itens.map((e) => (
              <Chip
                key={e.id}
                ativo={e.id === escopo.ativo}
                contagem={e.contagem || null}
                onClick={() => escopo.aoTrocar(e.id)}
                className="md:h-10"
              >
                {e.rotulo}
              </Chip>
            ))}
          </span>
        </>
      ) : null}
    </FaixaDeslizante>
  );
}

type Caixa = 'fornecedores' | 'clientes';

/** Uma caixa do seletor: o nome, o ícone, quantas esperam e as cores dela. */
type OpcaoDeCaixa<Id extends string> = {
  id: Id;
  rotulo: string;
  Icone: typeof Store;
  esperam: number | null;
  /** O fundo e a tinta do ícone quando a caixa está aberta. */
  tinta: string;
  /** A cor do ponto de "N esperando". */
  ponto: string;
};

/**
 * As duas caixas no alto da lista (13/11/2026), cada uma com quantas conversas
 * esperam resposta desta pessoa. O número é o do menu (`components/avisos`),
 * dividido por caixa. Na KOMUNE: Fornecedores, na menta da casa, e Clientes, em
 * azul. Na Imova (23/11/2026): Clientes, no petróleo, e Parceiros, em azul.
 */
function SeletorDeCaixas<Id extends string>({
  opcoes,
  ativa,
  aoTrocar,
}: {
  opcoes: readonly OpcaoDeCaixa<Id>[];
  ativa: Id;
  aoTrocar: (caixa: Id) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Caixas de conversa"
      className="grid w-full max-w-md grid-cols-2 gap-1 rounded-2xl bg-wpp-busca p-1"
    >
      {opcoes.map(({ id, rotulo, Icone, esperam, tinta, ponto }) => {
        const aberta = ativa === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aberta}
            onClick={() => aoTrocar(id)}
            className={cn(
              'toque flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none transition-colors',
              'focus-visible:ring-3 focus-visible:ring-ring/50',
              aberta
                ? 'bg-wpp-painel text-foreground shadow-wpp-caixa ring-1 ring-wpp-linha'
                : 'text-wpp-suave hover:text-foreground',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-[10px]',
                aberta ? tinta : 'bg-transparent',
              )}
            >
              <Icone className="size-[18px]" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm leading-tight font-semibold">{rotulo}</span>
              {esperam ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap text-foreground">
                  <span
                    aria-hidden="true"
                    className={cn('size-[7px] shrink-0 rounded-full', ponto)}
                  />
                  {esperam} esperando
                </span>
              ) : (
                <span className="text-xs whitespace-nowrap text-wpp-suave">
                  {esperam === 0 ? 'em dia' : '\u00a0'}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A linha "Concluídas" no alto da lista, no lugar das "Arquivadas" do WhatsApp. */
function LinhaDasConcluidas({ quantas, aoAbrir }: { quantas: number; aoAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={aoAbrir}
      className="flex w-full items-center gap-3 px-4 text-left outline-none hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.06] md:px-5"
    >
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center text-wpp-autor"
      >
        <CircleCheck className="size-[22px]" />
      </span>
      <span className="flex flex-1 items-center gap-2 border-b border-wpp-linha py-[15px]">
        <span className="flex-1 text-[15px] font-semibold">Concluídas</span>
        <span className="numerico text-[13px] font-medium text-wpp-suave">{quantas}</span>
        <ChevronRight className="size-4 shrink-0 text-wpp-suave" aria-hidden="true" />
      </span>
    </button>
  );
}

/** O alto da gaveta das concluídas: a seta de volta e o que ela guarda. */
function CabecalhoDasConcluidas({ aoVoltar }: { aoVoltar: () => void }) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-wpp-linha pt-3 pr-3.5 pb-3.5 pl-1.5">
      <div className="flex items-center gap-1">
        <BotaoRedondo
          onClick={aoVoltar}
          aria-label="Voltar para as conversas abertas"
          className="text-foreground"
        >
          <ArrowLeft aria-hidden="true" />
        </BotaoRedondo>
        <h1 className="font-heading text-[19px] font-semibold">Concluídas</h1>
      </div>
      <p className="ml-3 text-[13px] leading-normal text-wpp-suave">
        Saíram da lista sem perder o histórico. Voltam sozinhas quando a pessoa escrever ou quando
        alguém do time mandar mensagem.
      </p>
    </div>
  );
}

/**
 * "Nova conversa" (03/11/2026): o lápis do WhatsApp. Lista quem ainda não tem
 * conversa no WhatsApp, e escolher abre a conversa dele, onde a primeira mensagem
 * é o modelo aprovado (fora da janela de 24 h é só ele que sai). Quem não está
 * na lista mora em Prospectados.
 *
 * Desde o protótipo responsivo (24/11/2026) é o ícone ao lado do título em toda
 * largura; no celular era o botão verde do canto, que cobria a última conversa.
 */
function NovaConversa({
  itens,
  aoEscolher,
}: {
  itens: readonly ItemConversa[];
  aoEscolher: (organizacaoId: string) => void;
}) {
  const [aberta, setAberta] = useState(false);
  const [q, setQ] = useState('');
  const sem = useMemo(() => {
    const termo = normalizar(q);
    return itens
      .filter((i) => i.fio === null && !i.naoContatar)
      .filter((i) => !termo || normalizar(i.nome).includes(termo))
      .slice(0, 30);
  }, [itens, q]);
  return (
    <PopoverPrimitive.Root
      open={aberta}
      onOpenChange={(v) => {
        setAberta(v);
        if (!v) setQ('');
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <BotaoRedondo aria-label="Nova conversa" className="text-foreground md:size-10">
          <SquarePen aria-hidden="true" />
        </BotaoRedondo>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 flex max-h-[min(30rem,var(--radix-popover-content-available-height))] w-[20rem] flex-col rounded-2xl border border-wpp-linha bg-popover p-1.5 text-popover-foreground shadow-wpp-pop outline-none"
        >
          {/* Só a lista encolhe (`min-h-0`): o título, a busca e o "Ver todos" ficam
              com a altura deles (`shrink-0`). Sem isso, num celular baixo (375x667) o
              teto da altura disponível espremia a busca e o link para 19 px. */}
          <p className="mx-2.5 mt-1.5 mb-2 shrink-0 text-xs font-medium text-wpp-suave">
            Prospectados ainda sem conversa
          </p>
          <label className="mx-1 mb-1 flex h-9 shrink-0 items-center gap-2 rounded-full bg-wpp-busca px-3 text-wpp-suave">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <span className="sr-only">Procurar prospectado</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Procurar pelo nome"
              className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-wpp-suave md:text-sm"
            />
          </label>
          <div className="min-h-0 overflow-y-auto">
            {sem.length === 0 ? (
              <p className="mx-3 my-2.5 text-[13px] text-wpp-suave">
                {q ? 'Ninguém com esse nome sem conversa.' : 'Todos desta lista já têm conversa.'}
              </p>
            ) : (
              sem.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => {
                    setAberta(false);
                    aoEscolher(i.id);
                  }}
                  className="flex min-h-[54px] w-full items-center gap-2.5 rounded-xl px-2.5 text-left outline-none hover:bg-wpp-sel focus-visible:bg-wpp-sel"
                >
                  <AvatarDaConversa nome={i.nome} tamanho={36} anel="var(--popover)" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{i.nome}</span>
                    <span className="truncate text-xs text-wpp-suave">
                      {[i.categoria, local(i.bairro, i.cidade)].filter(Boolean).join(' · ') ||
                        'sem categoria'}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          <span className="mx-1 my-1.5 h-px shrink-0 bg-wpp-linha" />
          <Link
            href="/parceiros"
            className="flex h-10 shrink-0 items-center gap-2.5 rounded-xl px-3 text-sm hover:bg-wpp-sel"
          >
            <Users className="size-4 text-wpp-suave" aria-hidden="true" />
            Ver todos em Prospectados
          </Link>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
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
  if (filtros.chegada) partes.push(`chegada por "${ROTULO_DA_CHEGADA[filtros.chegada]}"`);
  if (filtros.janela !== 'qualquer') partes.push(`"${ROTULO_JANELA[filtros.janela]}"`);
  if (filtros.concluidas) partes.push('"Concluídas"');

  const quantos = partes.length;
  const lista = partes.join(', ');
  return quantos > 1
    ? `Nada bate com ${lista} ao mesmo tempo. Tire um filtro por vez.`
    : `Nada bate com ${lista}.`;
}
