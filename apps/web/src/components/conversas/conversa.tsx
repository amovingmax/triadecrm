'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BotOff,
  EllipsisVertical,
  ExternalLink,
  MessageSquarePlus,
  PanelRight,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatarProximaAcao } from '@/components/parceiros/formatos';
import { TelefoneRevelavel } from '@/components/parceiros/telefone-revelavel';
import { DiasSemContato } from '@/components/temperatura';
import { definicaoTemperatura } from '@/components/temperatura/escala-termica';
import { BotaoLigar } from '@/components/ligacao/voz-botao-ligar';
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';
import { MudarEtapa } from '@/components/funis/mudar-etapa';
import {
  BotaoDeLigarNaConversa,
  FaixaDaLigacao,
} from '@/components/ligacao-whatsapp/botao-na-conversa';

import { arquivarConversa } from './acoes';
import { AssumirConversa, useEu } from './assumir-conversa';
import { CONCLUIR_NA_EMPRESA, ConcluirConversa, FaixaDeConcluida } from './concluir-conversa';
import { AvisoDeQuemAtende, TransferirConversa } from './transferir-conversa';
import { AtitudeDaConversaNoTopo } from './atitude';
import { EtiquetasDoParceiro } from './etiquetas-do-parceiro';
import { OrigemNoPortal } from './origem-no-portal';
import { origemCurta, useOrigemNoPortal } from './origem-no-portal-dados';
import { AvisoWhatsapp } from './aviso-whatsapp';
import { ProvedorDoFio } from './contexto-do-fio';
import { carregarLinhaDoParceiro, chaveDaLinha, CHAVE_CONVERSAS, mensagemDoErro } from './dados';
import { ErroDaTela, EsqueletoLinha } from './estados';
import { contagemDeInteracoes, local } from './formatos';
import { FichaAoLado, ROTULO_DA_SECAO, AreaDoFio, useAvisoDeNaoLidas } from './fio-wpp';
import { Janela24h, PilulaDaJanela, useJanela } from './janela-24h';
import { LeituraDaIa } from './leitura-da-ia';
import { useLeituraDoFio } from './leitura-do-fio';
import { LinhaDoTempo } from './linha-do-tempo';
import { JANELA_APERTADA_MIN, montarFio, podeEscreverLivre } from './mensagens';
import { BarraDeBuscaNoFio, BotaoDeBuscarNoFio, MenuDaConversa } from './menu-da-conversa';
import {
  agruparPorDia,
  escolherNegocio,
  montarLinhaDoTempo,
  type CatalogosConversas,
} from './montagem';
import { CaixaDeResposta } from './responder';
import { useRolagemNoFim } from './rolagem-no-fim';
import {
  ROTULO_ESTADO_DO_FIO,
  type DependenciasDaMeta,
  type FioDaConversa,
  type ItemConversa,
} from './tipos';
import { AvatarDaConversa, BotaoRedondo } from './wpp';

/**
 * A coluna da direita: quem é o parceiro, a conversa inteira, e o que dá para
 * fazer agora.
 *
 * ===========================================================================
 * TRÊS ANDARES, E A ORDEM IMPORTA
 * ===========================================================================
 * 1. **Cabeçalho** — a ficha ao lado da conversa que o RF-CON-05 pede: nome,
 *    temperatura, etapa, responsável (dono do negócio) e quem está atendendo o fio
 *    quando não é a mesma pessoa, telefone (revelado pela mesma RPC auditada da
 *    ficha) e a próxima ação combinada.
 * 2. **A conversa**, que rola — mensagens, ligações, visitas e mudanças de etapa
 *    na MESMA coluna cronológica.
 * 3. **O rodapé, que não rola** — o relógio da janela de 24 h e a caixa de
 *    resposta. O rascunho da IA saiu daqui em 06/10/2026 ("a IA não vai me dizer
 *    o que escreve"): quem escreve é quem atende.
 *
 * O rodapé é fixo de propósito. O relógio da janela decide o que pode sair, e
 * uma informação que decide não pode depender de a pessoa ter rolado até o fim:
 * em 390 px, com dez mensagens, ela ficaria fora da tela justamente quando há
 * mais o que ler.
 *
 * A ação de REGISTRAR CONTATO continua sendo um link para `/registrar?org=<id>`,
 * o passo 2 da tela de três toques. Duplicar aqui o formulário criaria uma
 * segunda porta para `registrar_contato`, com outra previsão de temperatura e
 * outra fila offline.
 */
export function Conversa({
  item,
  catalogos,
  setores,
  meta,
  aoVoltar,
  escolhaExplicita,
  mensagemAlvo = null,
  aoChegarNoAlvo,
  fichaAberta,
  aoAlternarFicha,
}: {
  item: ItemConversa;
  catalogos: CatalogosConversas;
  /** Os setores do atendimento (Fase 1): nome no cabeçalho e destino da transferência. */
  setores: readonly { id: number; nome: string }[];
  /** O que ainda depende da Meta, para o aviso não ser um parágrafo fixo. */
  meta: DependenciasDaMeta | null;
  /** Só o celular usa: lá a conversa OCUPA a tela e precisa devolver para a lista. */
  aoVoltar: () => void;
  /** A pessoa ESCOLHEU esta conversa; a que o desktop abre sozinho não conta como lida. */
  escolhaExplicita: boolean;
  /** Abrir já na mensagem que a busca da lista achou (27/10/2026). */
  mensagemAlvo?: string | null;
  aoChegarNoAlvo?: () => void;
  /** A coluna "Dados do contato" ao lado, no computador: vale para todas as conversas. */
  fichaAberta: boolean;
  aoAlternarFicha: () => void;
}) {
  const ehCelular = useEhCelular();
  // A coluna ao lado só cabe no computador e no tablet com o painel largo
  // (o contrário de `conversa-estreita`); onde não cabe, o nome abre a folha.
  const painel = useRef<HTMLDivElement>(null);
  const naoCabeAFicha = () =>
    window.matchMedia('(max-width: 767px)').matches ||
    (window.matchMedia('(pointer: coarse)').matches && (painel.current?.clientWidth ?? 0) < 672);
  const consulta = useQuery({
    queryKey: chaveDaLinha(item.id),
    queryFn: () => carregarLinhaDoParceiro(item.id),
  });

  const nomeDaPessoa = useMemo(
    () => new Map(catalogos.pessoas.map((p) => [p.id, p.nome])),
    [catalogos.pessoas],
  );

  // O fio em foco: o que teve mensagem mais recente. Enquanto a leitura da
  // conversa não volta, vale o que a lista já sabia — assim o relógio da janela
  // não pisca de "nunca" para "aberta" na frente de quem está lendo.
  const fio = useMemo(() => {
    const fios = consulta.data?.fios ?? [];
    if (fios.length === 0) return item.fio;
    const escolhido = [...fios].sort((a, b) =>
      (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''),
    )[0];
    return escolhido ? montarFio(escolhido, nomeDaPessoa) : item.fio;
  }, [consulta.data, item.fio, nomeDaPessoa]);

  const janela = useJanela(fio?.janelaExpiraEm ?? null);

  const dias = useMemo(() => {
    if (!consulta.data) return [];
    return agruparPorDia(
      montarLinhaDoTempo({
        atividades: consulta.data.atividades,
        historico: consulta.data.historico,
        mensagens: consulta.data.mensagens,
        catalogos,
      }),
    );
  }, [consulta.data, catalogos]);

  // O "por ler" zera ao abrir a conversa e a cada mensagem que chega com ela na
  // frente da pessoa (06/10/2026, ver `leitura-do-fio.ts`). A marca "Nova" e o
  // número do menu são outra pergunta — "alguém respondeu?" — e continuam saindo
  // só com a resposta do time (`semResposta`, em `avisos/regra.ts`). O fio é o
  // da LISTA (`item.fio`): é ele que pinta o número ao lado do nome.
  useLeituraDoFio({
    fioId: item.fio?.id ?? null,
    naoLidas: item.naoLidas,
    ultimaEntradaEm: item.fio?.ultimaEntradaEm ?? null,
    escolhida: escolhaExplicita,
  });

  // Abre no fim e acompanha o fim enquanto a pessoa estiver nele; quem subiu
  // para ler o histórico não é puxado (ver `rolagem-no-fim.ts`).
  const quantosEventos = dias.reduce((soma, dia) => soma + dia.eventos.length, 0);
  const { rolagem, conteudo, aoRolar, soltar, longe, irAoFim } = useRolagemNoFim(
    item.id,
    quantosEventos,
  );
  // O fio de mensagens, em ordem, para o menu de cada balão, a citação, a lupa e
  // as favoritas (27/10/2026). Sai da linha do tempo já montada.
  const mensagensDoFio = useMemo(
    () => dias.flatMap((d) => d.eventos.flatMap((e) => (e.mensagem ? [e.mensagem] : []))),
    [dias],
  );
  const chavesDaConversa = useMemo(() => [chaveDaLinha(item.id)], [item.id]);

  const negocio = consulta.data ? escolherNegocio(consulta.data.negocios) : null;
  const proxima = formatarProximaAcao(negocio?.next_action_at);
  const onde = local(item.bairro, item.cidade);
  const contagem = contagemDeInteracoes(item.interacoes);

  // DUAS COLUNAS, DUAS PALAVRAS.
  //
  // "Responsável" é o dono do NEGÓCIO (`deals.owner_id`) — é por ele que o kanban, a
  // ficha e o filtro da barra perguntam. "Atendendo" é quem cuida do FIO
  // (`conversations.assignee_id`), que é outra pessoa toda vez que alguém assume uma
  // conversa de um negócio que não é seu.
  //
  // Um campo só, mostrando ora um ora outro, dizia "Responsável: Heloísa" no
  // cabeçalho e escondia a mesma conversa quando a Heloísa filtrava "Responsável →
  // Heloísa": a tela afirmava uma coisa com a palavra que o filtro usava para outra.
  // Só aparece quando as duas pessoas são diferentes — repetir o mesmo nome em dois
  // rótulos gastaria uma linha da ficha, que cabe em uma, para não informar nada.
  //
  // Com o time inteiro no mesmo número (14/09/2026), "quem está falando com este
  // parceiro" é a pergunta de toda conversa, e não só quando difere do dono: o
  // campo aparece sempre que existe fio, e diz "você" quando é você.
  const eu = useEu();
  // A FOLHA DE DETALHES do desenho do celular (protótipo A, escolhido em
  // 20/10/2026): etapa, selos, etiquetas, ações e a ficha moram atrás do nome e
  // do "⋯", e a tela fica para a conversa.
  const [folha, setFolha] = useState(false);
  const atendendo = fio
    ? fio.responsavelId && fio.responsavelId === eu?.id
      ? 'você'
      : (fio.responsavel ?? 'sem nome na base')
    : null;
  const podeAssumir = Boolean(fio && eu?.podeEscrever && fio.responsavelId !== eu.id);
  const setorDoFio =
    fio?.setorId != null ? (setores.find((s) => s.id === fio.setorId)?.nome ?? null) : null;
  // A ETAPA É BOTÃO (14/10/2026): "deixe a opção de selecionar em que etapa do
  // funil o lead está na aba de conversas". Quem escreve muda a etapa daqui, pela
  // mesma folha do Funis; quem não escreve continua lendo a etapa na frase.
  const mudaEtapa = Boolean(eu?.podeEscrever && item.etapa);
  const clientes = useQueryClient();
  const aoMudarEtapa = () => void clientes.invalidateQueries({ queryKey: ['conversas'] });

  // A frase de contexto do cabeçalho do computador e do topo da folha.
  const contexto = [
    // A temperatura saiu desta linha em 28/09/2026 (ADR-16): a etapa, que já
    // estava ao lado dela, é o que passou a valer.
    mudaEtapa ? null : item.etapa,
    item.funil,
    setorDoFio,
    fio ? ROTULO_ESTADO_DO_FIO[fio.estado] : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // De qual anúncio dos portais o cliente veio (05/11/2026, só na Imova; na
  // KOMUNE não há consulta): o lead de quem mandou mensagem, achado pela conversa
  // em foco e, sem ela, pela ficha. Só lido e mostrado: nada disso toca no WhatsApp.
  const origemNoPortal = useOrigemNoPortal({ conversaId: fio?.id ?? null, organizacaoId: item.id });

  // O que o cabeçalho de UMA LINHA diz embaixo do nome: a etapa, o anúncio de
  // onde o cliente veio (é o que decide a primeira resposta) e só as exceções.
  // O resto está a um toque, na folha.
  const resumo =
    [
      item.etapa,
      origemCurta(origemNoPortal),
      item.naoContatar ? 'não contatar' : null,
      fio?.roboPausado ? 'robô pausado' : null,
      fio ? ROTULO_ESTADO_DO_FIO[fio.estado] : null,
    ]
      .filter(Boolean)
      .join(' · ') || item.funil;

  // E SÓ O QUE É EXCEÇÃO É PÍLULA: quem pediu para não ser contatado, o robô
  // calado, e as etiquetas — que não são rótulo, são o botão de etiquetar. Na
  // folha as pílulas são de dedo (36 px); no computador, de mouse.
  const selos = (naFolha: boolean) => (
    <>
      {mudaEtapa ? (
        <MudarEtapa
          organizacaoId={item.id}
          nome={item.nome}
          etapa={item.etapa}
          aoMudar={aoMudarEtapa}
          className={
            naFolha ? 'h-9 px-3 text-sm text-foreground' : 'h-5 text-[11px] text-foreground'
          }
        />
      ) : null}
      {item.naoContatar ? (
        <Badge
          variant="pilula"
          className={naFolha ? 'h-9 px-3 text-sm font-normal' : 'h-5 px-2 text-[11px] font-normal'}
        >
          não contatar
        </Badge>
      ) : null}
      {fio?.roboPausado ? (
        <Badge
          variant="pilula"
          className={
            naFolha
              ? 'h-9 gap-1.5 px-3 text-sm font-normal'
              : 'h-5 gap-1 px-2 text-[11px] font-normal'
          }
        >
          <BotOff className="size-3" aria-hidden="true" />
          robô pausado
        </Badge>
      ) : null}
      {/* A atitude do cliente (29/10/2026) é da CONVERSA: sem fio, não há. */}
      {fio ? (
        <AtitudeDaConversaNoTopo
          conversaId={fio.id}
          podeEscrever={Boolean(eu?.podeEscrever)}
          naFolha={naFolha}
        />
      ) : null}
      <EtiquetasDoParceiro organizacaoId={item.id} podeEditar={Boolean(eu?.podeEscrever)} />
      {/* O lead dos portais (05/11/2026, só na Imova), só leitura. */}
      <OrigemNoPortal conversaId={fio?.id ?? null} organizacaoId={item.id} naFolha={naFolha} />
    </>
  );

  // A ficha em campos: numa linha que quebra, no fio (a partir de 640 px); em
  // lista, na folha do celular. O telefone continua atrás da mesma RPC auditada.
  const campos = (variante: 'linha' | 'folha') => (
    <>
      <Campo variante={variante} rotulo="Onde">
        {onde || 'sem endereço na base'}
      </Campo>
      <Campo variante={variante} rotulo="Categoria">
        {item.categoria ?? 'sem categoria'}
      </Campo>
      <Campo variante={variante} rotulo="Responsável">
        {item.responsavel ?? 'sem dono'}
      </Campo>
      {atendendo ? (
        <Campo variante={variante} rotulo="Atendendo">
          {atendendo}
        </Campo>
      ) : null}
      <Campo variante={variante} rotulo="Último contato">
        <DiasSemContato dias={item.diasSemContato} atencao={item.precisaAtencao} />
        <span>
          (<span className="numerico">{contagem.numero}</span>
          {contagem.palavra})
        </span>
      </Campo>
      <Campo variante={variante} rotulo="Telefone">
        <TelefoneRevelavel
          organizationId={item.id}
          telefone={item.telefone}
          mascarado={item.telefoneMascarado}
          whatsapp={meta?.numeroConfigurado ? 'nenhum' : 'externo'}
        />
      </Campo>
      {negocio?.next_action || proxima ? (
        <Campo variante={variante} rotulo="Próxima ação">
          <span className={cn('truncate', proxima?.atrasada && 'font-medium')}>
            {negocio?.next_action ?? 'combinada'}
          </span>
          {proxima ? (
            <span className="shrink-0 text-muted-foreground" title={proxima.detalhe}>
              {proxima.prefixo.trim()}
              {proxima.numero ? (
                <>
                  {' '}
                  <span className="numerico">{proxima.numero}</span>
                </>
              ) : null}
              {proxima.sufixo}
            </span>
          ) : null}
        </Campo>
      ) : null}
    </>
  );

  const avisoDeNaoLidas = useAvisoDeNaoLidas(dias, item.naoLidas);
  const registrarHref = `/registrar?org=${item.id}`;
  const fichaHref = `/parceiros/${item.id}`;

  // O QUE A FICHA DIZ, num lugar só (03/11/2026): a folha do celular e a coluna
  // "Dados do contato" do computador mostram a mesma coisa — em que pé está, as
  // ações e a ficha. Até aqui o computador espalhava isso pelo cabeçalho e pelo
  // alto da conversa, e as mensagens começavam 200px mais embaixo.
  const ficha = (naFolha: boolean) => (
    <>
      <section aria-label="Em que pé está" className="flex flex-col gap-2">
        <h3 className={ROTULO_DA_SECAO}>Em que pé está</h3>
        <div className="flex flex-wrap items-center gap-1.5">{selos(true)}</div>
      </section>

      <section aria-label="Ações" className="flex flex-col gap-2">
        <h3 className={ROTULO_DA_SECAO}>Ações</h3>
        <div className={cn('grid gap-2', naFolha ? 'grid-cols-2' : 'grid-cols-1')}>
          {podeAssumir && fio ? (
            <AssumirConversa
              fioId={fio.id}
              organizacaoId={item.id}
              className={cn(ACAO_DA_FOLHA, 'col-span-2')}
            />
          ) : null}
          {fio && eu?.podeEscrever ? (
            <TransferirConversa
              fioId={fio.id}
              organizacaoId={item.id}
              pessoas={catalogos.pessoas}
              setores={setores}
              className={ACAO_DA_FOLHA}
            />
          ) : null}
          <Button asChild variant="outline" className={ACAO_DA_FOLHA}>
            <Link href={registrarHref}>
              <MessageSquarePlus aria-hidden="true" />
              Registrar contato
            </Link>
          </Button>
          {fio && eu?.podeEscrever ? (
            CONCLUIR_NA_EMPRESA ? (
              <ConcluirConversa
                fioId={fio.id}
                concluidaEm={fio.arquivadaEm}
                tamanho="bloco"
                className={ACAO_DA_FOLHA}
              />
            ) : (
              <Arquivar fio={fio} comNome className={ACAO_DA_FOLHA} />
            )
          ) : null}
          <Button asChild variant="outline" className={ACAO_DA_FOLHA}>
            <Link href={fichaHref}>
              <ExternalLink aria-hidden="true" />
              Abrir a ficha
            </Link>
          </Button>
        </div>
      </section>

      {/* No celular o "⋯" do cabeçalho é a própria folha: fixar, silenciar e
          bloquear moram aqui. No computador eles estão no "⋯" do cabeçalho. */}
      {naFolha && fio ? (
        <section aria-label="Conversa" className="flex flex-col gap-1">
          <h3 className={ROTULO_DA_SECAO}>Conversa</h3>
          <MenuDaConversa
            variante="folha"
            fioId={fio.id}
            bloqueada={fio.bloqueadaEm !== null}
            podeEscrever={Boolean(eu?.podeEscrever)}
            atualizar={chavesDaConversa}
            aoFecharConversa={aoVoltar}
            aoEscolher={() => setFolha(false)}
          />
        </section>
      ) : null}

      <section aria-label="Ficha" className="flex flex-col gap-1">
        <h3 className={ROTULO_DA_SECAO}>Ficha</h3>
        <dl className="flex flex-col">{campos('folha')}</dl>
      </section>

      {fio ? <LeituraDaIa fioId={fio.id} /> : null}
    </>
  );

  const temperatura = item.temperatura;
  const definicao = definicaoTemperatura(temperatura);

  const corpo = (
    <div className="flex h-full min-h-0">
      {/* `@container` no painel da conversa: no tablet, o desenho do celular vale
          quando o PAINEL é estreito, e não a tela (`conversa-estreita`, em
          `globals.css`). */}
      <div ref={painel} className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {/* O CABEÇALHO DO WHATSAPP (03/11/2026): o retrato com o ponto da
            temperatura, o nome e uma linha de contexto; tocar nele abre os dados
            do contato — a folha no celular, a coluna ao lado no computador. À
            direita, só o que se faz toda hora: buscar, ligar, concluir e o "⋯".

            No celular continua UMA LINHA, do protótipo A escolhido em 20/10/2026:
            em três andares sobravam ~300 px para as mensagens num iPhone; numa
            linha, o dobro. */}
        <header className="flex h-14 shrink-0 items-center gap-0.5 border-b md:h-16 border-wpp-linha bg-wpp-painel pr-2.5 pl-1 md:pl-3">
          <BotaoRedondo
            onClick={aoVoltar}
            className="text-foreground md:hidden"
            aria-label="Voltar para a lista de conversas"
          >
            <ArrowLeft aria-hidden="true" />
          </BotaoRedondo>
          <button
            type="button"
            onClick={() => (naoCabeAFicha() ? setFolha(true) : aoAlternarFicha())}
            aria-haspopup="dialog"
            className="toque flex h-[52px] min-w-0 flex-1 items-center gap-3 rounded-[14px] pr-2 pl-1 text-left outline-none hover:bg-foreground/[0.04] focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <AvatarDaConversa nome={item.nome} temperatura={temperatura} tamanho={40} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-base leading-tight font-semibold">{item.nome}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] whitespace-nowrap text-wpp-suave">
                <span
                  className="inline-flex h-[18px] shrink-0 items-center rounded-full px-2 text-[11.5px] font-semibold"
                  style={{ background: definicao.corFundo, color: definicao.corTexto }}
                >
                  {definicao.rotulo}
                </span>
                <span className="truncate">{resumo}</span>
              </span>
            </span>
            <span className="sr-only">: ver a etapa, as etiquetas, as ações e a ficha</span>
          </button>
          {fio ? <BotaoDeBuscarNoFio className="max-md:hidden" /> : null}
          {eu?.podeEscrever ? (
            <BotaoLigar
              organizationId={item.id}
              temTelefone={Boolean(item.telefone) || item.telefoneMascarado}
              className="h-10 flex-none rounded-full border-wpp-linha-forte bg-transparent px-3.5 text-[13.5px] max-md:hidden sm:flex-none md:h-10"
            />
          ) : null}
          {fio && eu?.podeEscrever ? (
            <BotaoDeLigarNaConversa conversaId={fio.id} nome={item.nome} compacto={ehCelular} />
          ) : null}
          {podeAssumir && fio ? (
            <AssumirConversa
              fioId={fio.id}
              organizacaoId={item.id}
              className="rounded-full max-md:hidden md:h-10"
            />
          ) : null}
          {fio && eu?.podeEscrever ? (
            CONCLUIR_NA_EMPRESA ? (
              <ConcluirConversa
                fioId={fio.id}
                concluidaEm={fio.arquivadaEm}
                rotuloPelaLargura
                className="mx-1 conversa-estreita:hidden"
              />
            ) : (
              <Arquivar fio={fio} className="conversa-estreita:hidden" />
            )
          ) : null}
          <BotaoRedondo
            onClick={aoAlternarFicha}
            aria-pressed={fichaAberta}
            aria-label={fichaAberta ? 'Fechar os dados do contato' : 'Ver os dados do contato'}
            className="max-md:hidden conversa-estreita:hidden"
          >
            <PanelRight aria-hidden="true" />
          </BotaoRedondo>
          {/* Computador: o menu "⋯". Celular: o "⋯" abre a folha, que tem tudo. */}
          {fio ? (
            <span className="contents conversa-estreita:hidden">
              <MenuDaConversa
                fioId={fio.id}
                bloqueada={fio.bloqueadaEm !== null}
                podeEscrever={Boolean(eu?.podeEscrever)}
                atualizar={chavesDaConversa}
                aoFecharConversa={aoVoltar}
                concluidaEm={fio.arquivadaEm}
                registrarHref={registrarHref}
                fichaHref={fichaHref}
              />
            </span>
          ) : null}
          <BotaoRedondo
            onClick={() => setFolha(true)}
            aria-label="Mais: etapa, etiquetas, ações e ficha"
            className={cn('hidden conversa-estreita:inline-flex', !fio && 'md:inline-flex')}
          >
            <EllipsisVertical aria-hidden="true" />
          </BotaoRedondo>
        </header>

        <BarraDeBuscaNoFio />

        {fio ? (
          <FaixaDeConcluida
            fioId={fio.id}
            concluidaEm={fio.arquivadaEm}
            concluidaPor={fio.arquivadaPor}
            podeReabrir={Boolean(eu?.podeEscrever)}
          />
        ) : null}
        {fio ? <FaixaDaLigacao conversaId={fio.id} className="border-b border-wpp-linha" /> : null}

        <Sheet open={folha} onOpenChange={setFolha}>
          <SheetContent
            side="bottom"
            className="@container max-h-[88svh] gap-5 overflow-y-auto rounded-t-2xl px-4 pt-4 pb-[calc(var(--area-segura-inferior)+1.25rem)]"
          >
            <SheetHeader className="flex-row items-center gap-3 p-0 pr-12 text-left">
              <AvatarDaConversa
                nome={item.nome}
                temperatura={temperatura}
                tamanho={48}
                anel="var(--background)"
              />
              <div className="min-w-0">
                <SheetTitle className="font-heading text-lg leading-tight">{item.nome}</SheetTitle>
                <SheetDescription className="text-[13px]">
                  {[item.funil, setorDoFio, fio ? ROTULO_ESTADO_DO_FIO[fio.estado] : null]
                    .filter(Boolean)
                    .join(' · ')}
                </SheetDescription>
              </div>
            </SheetHeader>
            {ficha(true)}
          </SheetContent>
        </Sheet>

        {/* A CONVERSA NO PAPEL DE PAREDE (03/11/2026): só as mensagens e o que
            aconteceu entre elas. Endereço, categoria e a leitura da IA foram para
            os dados do contato; o relógio da janela é a pílula grudada no alto. */}
        <AreaDoFio
          rolagem={rolagem}
          conteudo={conteudo}
          aoRolar={aoRolar}
          longe={longe}
          irAoFim={irAoFim}
          topo={fio ? <PilulaDaJanela estado={janela} /> : null}
        >
          <AvisoWhatsapp meta={meta} compacto className="mx-auto my-3 w-full max-w-xl" />

          {consulta.isPending ? (
            <EsqueletoLinha />
          ) : consulta.isError ? (
            <ErroDaTela
              causa={mensagemDoErro(consulta.error)}
              aoTentar={() => void consulta.refetch()}
            />
          ) : dias.length === 0 ? (
            <SemHistorico organizacaoId={item.id} />
          ) : (
            <LinhaDoTempo dias={dias} nomeDoParceiro={item.nome} naoLidas={avisoDeNaoLidas} />
          )}
        </AreaDoFio>

        {/* O rodapé não rola com a conversa: o relógio decide o que pode sair, e
            decisão não pode depender de a pessoa ter chegado ao fim da leitura.
            O teto é 42% DO PAINEL, não da tela (`dvh`) — com `dvh` ele cabia na
            janela e mesmo assim espremia a conversa contra o cabeçalho, porque o
            painel é menor que a janela. No celular o rodapé cresce até 60% (a
            caixa cresce para baixo, linha a linha) e respeita a barrinha do
            iPhone — zero com o teclado aberto. */}
        <div className="max-h-[42%] shrink-0 space-y-2 overflow-y-auto border-t border-wpp-linha bg-wpp-painel2 px-2 py-1.5 max-md:max-h-[60%] max-md:pb-[calc(0.375rem+var(--folga-inferior,0px))] md:px-3 md:py-2.5">
          {/* O cartão inteiro da janela só volta quando ela está APERTADA — aí a
              regra importa de novo, porque a decisão muda em minutos. */}
          {fio && janela.situacao === 'aberta' && janela.restanteMin <= JANELA_APERTADA_MIN ? (
            <Janela24h estado={janela} className="mx-1" />
          ) : null}
          {/* Quem atende, logo acima da caixa: quem vai responder precisa saber
              se está respondendo no lugar de alguém. */}
          {fio ? (
            <AvisoDeQuemAtende
              fioId={fio.id}
              atendente={fio.responsavel}
              paraMim={fio.responsavelId === eu?.id}
              nomeDaPessoa={nomeDaPessoa}
            />
          ) : null}
          {/* No celular o "Assumir" sai do cabeçalho (não cabe na linha) e vem
              para cá, onde a pessoa já está com o dedo. */}
          {podeAssumir && fio ? (
            <AssumirConversa fioId={fio.id} organizacaoId={item.id} className="w-full md:hidden" />
          ) : null}
          <CaixaDeResposta
            fio={fio}
            janela={janela}
            organizacaoId={item.id}
            naoContatar={item.naoContatar}
          />
        </div>
      </div>

      {fichaAberta ? (
        <FichaAoLado aoFechar={aoAlternarFicha}>
          <div className="flex flex-col items-center gap-2 text-center">
            <AvatarDaConversa nome={item.nome} temperatura={temperatura} tamanho={72} />
            <p className="text-lg leading-tight font-semibold">{item.nome}</p>
            <p className="text-[13px] text-wpp-suave">{contexto || item.funil}</p>
          </div>
          {ficha(false)}
        </FichaAoLado>
      ) : null}
    </div>
  );

  // Sem fio de WhatsApp não há mensagem a responder, reagir ou procurar.
  if (!fio) return corpo;
  return (
    <ProvedorDoFio
      fioId={fio.id}
      mensagens={mensagensDoFio}
      janelaAberta={podeEscreverLivre(janela)}
      bloqueada={fio.bloqueadaEm !== null}
      nomeDoParceiro={item.nome}
      atualizar={chavesDaConversa}
      soltarRolagem={soltar}
      mensagemAlvo={mensagemAlvo}
      aoChegarNoAlvo={aoChegarNoAlvo}
    >
      {corpo}
    </ProvedorDoFio>
  );
}

/**
 * Um campo da ficha, em linha: o rótulo miúdo, o valor no tom do texto, e o
 * ponto médio separando um do outro. Sem `<div>` entre `<dl>` e `<dt>` — a
 * marcação da lista de definições é o que faz um leitor de tela ler "Onde:
 * Capim Macio, Natal" em vez de duas frases soltas.
 */
/**
 * Arquivar e desarquivar — o "apagar o chat" que o Rafael pediu em 29/09/2026.
 *
 * É um ícone, e não um botão com texto, por uma razão de proporção: quem abre
 * uma conversa vai responder, não arrumar a lista. Arquivar acontece uma vez na
 * vida de cada fio, e um botão largo para isso empurraria "Assumir" — que é a
 * ação do dia — para fora da linha no celular.
 *
 * SEM CONFIRMAÇÃO, e isso é decisão: nada é destruído, o próprio botão desfaz,
 * e a conversa volta sozinha se o parceiro escrever. Diálogo de confirmação
 * para o que se desfaz num clique é imposto que ninguém lê.
 */
function Arquivar({
  fio,
  comNome = false,
  className,
}: {
  fio: FioDaConversa;
  /** Na folha do celular: botão inteiro, com o nome da ação. */
  comNome?: boolean;
  className?: string;
}) {
  const clientes = useQueryClient();
  const arquivada = fio.arquivadaEm !== null;
  const acao = useMutation({
    mutationFn: () => arquivarConversa(fio.id, !arquivada),
    onSuccess: () => {
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      toast.success(
        arquivada ? 'Conversa de volta na lista.' : 'Conversa arquivada.',
        arquivada
          ? undefined
          : {
              description: 'Ela volta sozinha se o parceiro escrever.',
              action: { label: 'Desfazer', onClick: () => acao.mutate() },
            },
      );
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  const rotulo = arquivada ? 'Desarquivar conversa' : 'Arquivar conversa';
  if (comNome) {
    return (
      <Button
        variant="outline"
        className={className}
        disabled={acao.isPending}
        onClick={() => acao.mutate()}
      >
        {arquivada ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
        {arquivada ? 'Desarquivar' : 'Arquivar'}
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('toque size-11 md:size-9', className)}
      disabled={acao.isPending}
      onClick={() => acao.mutate()}
      title={arquivada ? 'Trazer de volta para a lista' : 'Arquivar: tira da lista, não apaga nada'}
    >
      {arquivada ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
      <span className="sr-only">{rotulo}</span>
    </Button>
  );
}

/** Uma ação da folha do celular: bloco de 56 px, ícone e nome, em duas colunas. */
const ACAO_DA_FOLHA =
  'toque h-14 w-full justify-start gap-2.5 rounded-xl px-4 text-[15px] font-medium md:h-14';

function Campo({
  rotulo,
  children,
  variante = 'linha',
}: {
  rotulo: string;
  children: React.ReactNode;
  /** `folha`: um campo por linha, rótulo à esquerda e valor à direita, na folha do celular. */
  variante?: 'linha' | 'folha';
}) {
  if (variante === 'folha') {
    return (
      <div className="flex min-w-0 items-baseline justify-between gap-4 border-t border-hairline py-2.5 text-sm first:border-t-0">
        <dt className="shrink-0 text-muted-foreground">{rotulo}</dt>
        <dd className="flex min-w-0 flex-wrap items-baseline justify-end gap-1 text-right text-foreground">
          {children}
        </dd>
      </div>
    );
  }
  return (
    // `div` entre `dl` e o par é HTML5 válido e é o que mantém rótulo e valor
    // juntos quando a linha quebra: sem ele, em 390 px o "Categoria:" ficava no
    // fim de uma linha e o valor no começo da seguinte, colado no campo errado.
    <div className="flex min-w-0 items-baseline gap-1">
      <dt className="shrink-0 text-[11px] after:content-[':']">{rotulo}</dt>
      <dd className="flex min-w-0 items-baseline gap-1 text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Nem o import da lista-semente aparece: é o caso de um parceiro cadastrado à mão,
 * sem nenhuma atividade, sem negócio e sem mensagem. Raro na base atual, mas é o
 * estado que qualquer cadastro rápido produz no primeiro segundo de vida.
 */
function SemHistorico({ organizacaoId }: { organizacaoId: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-hairline px-4 py-6">
      <div className="space-y-1">
        <p className="font-heading font-medium">Nada aconteceu com este parceiro ainda</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          A linha do tempo começa no primeiro contato. Registre a ligação, a visita ou a mensagem e
          ela aparece aqui, com o desfecho e a etapa para onde o negócio foi.
        </p>
      </div>
      <Button asChild className="toque h-11 md:h-9">
        <Link href={`/registrar?org=${organizacaoId}`}>
          <MessageSquarePlus aria-hidden="true" />
          Registrar o primeiro contato
        </Link>
      </Button>
    </div>
  );
}
