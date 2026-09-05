'use client';

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BotOff, ExternalLink, MessageSquarePlus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarProximaAcao } from '@/components/parceiros/formatos';
import { TelefoneRevelavel } from '@/components/parceiros/telefone-revelavel';
import { ChipTemperatura, DiasSemContato } from '@/components/temperatura';

import { marcarComoLida } from './acoes';
import { AvisoWhatsapp } from './aviso-whatsapp';
import { CartaoDeAprovacao } from './aprovacao';
import { carregarLinhaDoParceiro, chaveDaLinha, CHAVE_CONVERSAS, mensagemDoErro } from './dados';
import { ErroDaTela, EsqueletoLinha } from './estados';
import { contagemDeInteracoes, local } from './formatos';
import { Janela24h, useJanela } from './janela-24h';
import { LinhaDoTempo } from './linha-do-tempo';
import { montarFio, montarRascunho, ordenarFila } from './mensagens';
import { agruparPorDia, escolherNegocio, montarLinhaDoTempo, type CatalogosConversas } from './montagem';
import { CaixaDeResposta } from './responder';
import { ROTULO_ESTADO_DO_FIO, type DependenciasDaMeta, type ItemConversa } from './tipos';

/**
 * A coluna da direita: quem é o parceiro, a conversa inteira, e o que dá para
 * fazer agora.
 *
 * ===========================================================================
 * TRÊS ANDARES, E A ORDEM IMPORTA
 * ===========================================================================
 * 1. **Cabeçalho** — a ficha ao lado da conversa que o RF-CON-05 pede: nome,
 *    temperatura, etapa, responsável, telefone (revelado pela mesma RPC auditada
 *    da ficha) e a próxima ação combinada.
 * 2. **A conversa**, que rola — mensagens, ligações, visitas e mudanças de etapa
 *    na MESMA coluna cronológica.
 * 3. **O rodapé, que não rola** — o relógio da janela de 24 h e, embaixo dele, o
 *    rascunho esperando aprovação OU a caixa de resposta.
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
  meta,
  aoVoltar,
  escolhaExplicita,
}: {
  item: ItemConversa;
  catalogos: CatalogosConversas;
  /** O que ainda depende da Meta, para o aviso não ser um parágrafo fixo. */
  meta: DependenciasDaMeta | null;
  /** Só o celular usa: lá a conversa OCUPA a tela e precisa devolver para a lista. */
  aoVoltar: () => void;
  /**
   * A pessoa ESCOLHEU esta conversa (ou o desktop a abriu sozinho, na primeira
   * da lista). Só a escolha zera o "por ler": limpar o contador de uma conversa
   * que ninguém pediu para ver seria apagar o único sinal de que ela existe.
   */
  escolhaExplicita: boolean;
}) {
  const clientes = useQueryClient();
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

  const rascunho = useMemo(() => {
    const crus = (consulta.data?.rascunhos ?? []).filter((r) => r.status === 'pendente');
    if (crus.length === 0) return item.rascunhoPendente;
    return ordenarFila(crus.map(montarRascunho))[0] ?? null;
  }, [consulta.data, item.rascunhoPendente]);

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

  // Zera o "por ler" uma vez por fio. O `ref` é o que impede o efeito de
  // disparar de novo a cada repintura (e no modo estrito do React, duas vezes
  // seguidas na montagem).
  const jaMarcado = useRef<string | null>(null);
  const fioId = fio?.id ?? null;
  const naoLidas = fio?.naoLidas ?? 0;
  useEffect(() => {
    if (!escolhaExplicita || !fioId || naoLidas === 0) return;
    if (jaMarcado.current === fioId) return;
    jaMarcado.current = fioId;
    void marcarComoLida(fioId)
      .then(() => {
        void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      })
      // Falhar aqui não atrapalha ninguém: o contador continua como estava e a
      // pessoa lê a conversa do mesmo jeito. Barulho por isso seria ruído.
      .catch(() => undefined);
  }, [escolhaExplicita, fioId, naoLidas, clientes]);

  // ONDE A CONVERSA ABRE.
  //
  // No fim, onde está a mensagem de agora: a coluna é cronológica ascendente, e
  // abrir no topo faria rolar cinco meses de histórico toda vez que alguém
  // escrevesse. Com um rascunho esperando, abre no COMEÇO DO RASCUNHO — porque
  // aí o que a pessoa precisa ler primeiro é o que a IA entendeu e o que o
  // validador disse, não os três botões no pé do cartão. Em 390 px a diferença
  // é entre ver a decisão e ver só o "Aprovar".
  const rolagem = useRef<HTMLDivElement>(null);
  const alvoDoRascunho = useRef<HTMLDivElement>(null);
  const quantosEventos = dias.reduce((soma, dia) => soma + dia.eventos.length, 0);
  const rascunhoId = rascunho?.id ?? null;
  useEffect(() => {
    const caixa = rolagem.current;
    if (!caixa) return;
    const cartao = alvoDoRascunho.current;
    if (cartao) {
      caixa.scrollTop = Math.max(0, cartao.offsetTop - caixa.offsetTop - 12);
      return;
    }
    if (quantosEventos > 0) caixa.scrollTop = caixa.scrollHeight;
  }, [item.id, quantosEventos, rascunhoId]);

  const negocio = consulta.data ? escolherNegocio(consulta.data.negocios) : null;
  const proxima = formatarProximaAcao(negocio?.next_action_at);
  const onde = local(item.bairro, item.cidade);
  const contagem = contagemDeInteracoes(item.interacoes);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-3 border-b border-hairline p-4 md:p-5">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={aoVoltar}
            className="toque -ml-2 size-11 shrink-0 md:hidden"
          >
            <ArrowLeft aria-hidden="true" />
            <span className="sr-only">Voltar para a lista de conversas</span>
          </Button>

          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-lg leading-tight font-semibold tracking-tight">
              {item.nome}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <ChipTemperatura
                temperatura={item.temperatura}
                esfriando={item.precisaAtencao}
                className="text-[11px]"
              />
              {item.etapa ? (
                <Badge variant="pilula" className="h-5 px-2 text-[11px] font-normal">
                  {item.etapa}
                  {item.funil ? <span className="text-muted-foreground"> · {item.funil}</span> : null}
                </Badge>
              ) : null}
              {item.naoContatar ? (
                <Badge variant="pilula" className="h-5 px-2 text-[11px] font-normal">
                  não contatar
                </Badge>
              ) : null}
              {fio ? (
                <Badge variant="pilula" className="h-5 px-2 text-[11px] font-normal">
                  {ROTULO_ESTADO_DO_FIO[fio.estado]}
                </Badge>
              ) : null}
              {fio?.roboPausado ? (
                <Badge variant="pilula" className="h-5 gap-1 px-2 text-[11px] font-normal">
                  <BotOff className="size-3" aria-hidden="true" />
                  robô pausado
                </Badge>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild className="toque h-11 md:h-9">
            <Link href={`/registrar?org=${item.id}`}>
              <MessageSquarePlus aria-hidden="true" />
              Registrar contato
            </Link>
          </Button>
          <Button asChild variant="outline" className="toque h-11 md:h-9">
            <Link href={`/parceiros/${item.id}`}>
              <ExternalLink aria-hidden="true" />
              Abrir ficha
            </Link>
          </Button>
        </div>
      </header>

      {/* A coluna de leitura fica em 48rem: numa tela de 1440 o painel tem mais de
          1.100px, e uma nota de visita esticada nessa largura vira uma linha de 200
          caracteres, que ninguém lê.

          A FICHA ROLA JUNTO, e o cabeçalho ficou só com o nome e as ações. Ela
          estava fixa; com o rodapé do inbox embaixo (relógio + rascunho), os dois
          blocos fixos somavam mais que a altura do painel e a conversa — a razão
          da tela — sobrava com trinta pixels. Endereço e categoria são consulta,
          não decisão: podem sair de vista quando a pessoa desce para ler. */}
      <div ref={rolagem} className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
        {/* A ficha em UMA LINHA que quebra, e não numa grade de seis campos.
            A grade custava 200 px do painel; com o rodapé do inbox embaixo, esses
            200 px eram a conversa inteira. Onde, categoria, dono e último contato
            são consulta de canto de olho — quem precisa do resto abre a ficha. O
            telefone continua atrás da mesma RPC auditada (RF-BAS-14). */}
        <dl className="flex max-w-3xl flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Campo rotulo="Onde">{onde || 'sem endereço na base'}</Campo>
          <Campo rotulo="Categoria">{item.categoria ?? 'sem categoria'}</Campo>
          <Campo rotulo="Responsável">
            {fio?.responsavel ?? item.responsavel ?? 'sem dono'}
          </Campo>
          <Campo rotulo="Último contato">
            <DiasSemContato dias={item.diasSemContato} atencao={item.precisaAtencao} />
            <span>
              (<span className="numerico">{contagem.numero}</span>
              {contagem.palavra})
            </span>
          </Campo>
          <Campo rotulo="Telefone">
            <TelefoneRevelavel
              organizationId={item.id}
              telefone={item.telefone}
              mascarado={item.telefoneMascarado}
            />
          </Campo>
          {negocio?.next_action || proxima ? (
            <Campo rotulo="Próxima ação">
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
        </dl>

        <AvisoWhatsapp meta={meta} compacto className="my-5 max-w-3xl" />

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
          <div className="max-w-3xl">
            <LinhaDoTempo dias={dias} />
          </div>
        )}

        {/* O rascunho fica no FIM DA CONVERSA, não num painel fixo embaixo.
            Duas razões, e a segunda só apareceu depois de medir: (1) é onde ele
            está de verdade — a IA escreveu isto em resposta à mensagem logo
            acima, e lê-lo colado nela é o que deixa julgar se a resposta serve;
            (2) preso no rodapé, o cartão comia metade do painel e a conversa —
            a razão da tela — ficava com duzentos pixels. Como a conversa abre
            no fim, o cartão aparece sem ninguém rolar. */}
        {rascunho ? (
          <div ref={alvoDoRascunho}>
            <CartaoDeAprovacao
              rascunho={rascunho}
              fio={fio}
              organizacaoId={item.id}
              className="mt-4 max-w-3xl"
            />
          </div>
        ) : null}
      </div>

      {/* O rodapé não rola com a conversa: o relógio decide o que pode sair, e
          decisão não pode depender de a pessoa ter chegado ao fim da leitura.
          O teto é 45% DO PAINEL, não da tela (`dvh`) — com `dvh` ele cabia na
          janela e mesmo assim espremia a conversa contra o cabeçalho, porque o
          painel é menor que a janela. */}
      <div className="max-h-[45%] shrink-0 space-y-3 overflow-y-auto border-t border-hairline bg-background/80 p-4 md:p-5">
        <div className="max-w-3xl space-y-3">
          <Janela24h estado={janela} />
          <CaixaDeResposta
            fio={fio}
            janela={janela}
            organizacaoId={item.id}
            recolhida={rascunho !== null}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Um campo da ficha, em linha: o rótulo miúdo, o valor no tom do texto, e o
 * ponto médio separando um do outro. Sem `<div>` entre `<dl>` e `<dt>` — a
 * marcação da lista de definições é o que faz um leitor de tela ler "Onde:
 * Capim Macio, Natal" em vez de duas frases soltas.
 */
function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
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
          A linha do tempo começa no primeiro contato. Registre a ligação, a visita ou a
          mensagem e ela aparece aqui, com o desfecho e a etapa para onde o negócio foi.
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
