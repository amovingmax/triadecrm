'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, SkipForward } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useMontado } from '@/lib/usar-cliente';
import { comQuemPadrao } from '@/components/registro/tipos';

import { ChamadaCabecalho, faltamAte } from './chamada-cabecalho';
import { EsqueletoDaChamada, ErroDaChamada, FilaAcabou, ForaDaJanela } from './chamada-estados';
import {
  ChamadaExtras,
  EXTRAS_DA_CHAMADA_VAZIOS,
  precisaDeExtras,
  type ExtrasDaChamada,
} from './chamada-extras';
import { ChamadaRecibo } from './chamada-recibo';
import { criarProvedorManual } from './chamada-provedor';
import {
  devolverItem,
  ErroDaLigacao,
  fraseDaRecusaDaChamada,
  MENSAGENS_DE_RECUSA_DA_FILA,
  puxarProximo,
  tabularChamada,
} from './chamada-rpc';
import { ChamadaTabulacao } from './chamada-tabulacao';
import {
  type ContextoDaLigacao,
  type LoteResumido,
  type RoteiroPublicado,
} from './chamada-contexto';
import { ObjecoesEmGaveta, ObjecoesLaterais } from './roteiro-objecoes';
import { RoteiroNo } from './roteiro-no';
import {
  ESPERA_ANTES_DO_PROXIMO_MS,
  INTERVALO_RELOGIO_MS,
  janelaDeLigacao,
  NO_DE_ABERTURA,
  noPorId,
  proximaAbertura,
  ROTULOS_RESULTADO_TECNICO,
  tabularChamadaSchema,
  type ChamadaEmCurso,
  type DesfechoDeLigacao,
  type ItemDoLote,
  type NoRoteiro,
  type ResultadoTabulacao,
  type ResultadoTecnico,
  type SaidaDoNo,
} from './tipos';

/**
 * A tela de ligar: um contato de cada vez, e nunca uma lista.
 *
 * Não há busca aqui, e não há "escolher outro" — o lote foi montado antes e a ordem
 * foi congelada na montagem (R13 §3.1: quem liga não escolhe para quem ligar e não
 * decide o que fazer depois). O que a tela faz é o ciclo:
 *
 *   discar (1 toque) → falar (1 toque por nó) → tabular (1 toque) → próximo (0 toques)
 *
 * Um contato que não atendeu custa 2 toques; um que atendeu, de 6 a 8.
 *
 * O que a tela NÃO decide, e é o ponto do módulo: o eixo técnico vem do provedor de
 * telefonia (hoje o adaptador manual), o eixo comercial vem do catálogo
 * `interaction_outcomes`, a consequência (etapa, temperatura, próxima ação, cooldown,
 * supressão) vem de `public.registrar_contato`, e a janela de horário vem do banco.
 */
export function TelaChamada({
  lote,
  roteiroConhecido,
  contexto,
  quemLiga,
  aoSair,
  aoMontarOutro,
}: {
  lote: LoteResumido;
  roteiroConhecido: RoteiroPublicado | null;
  contexto: ContextoDaLigacao;
  /** Nome de quem está ligando: entra no `[eu]` da fala de abertura. */
  quemLiga: string;
  aoSair: () => void;
  aoMontarOutro: () => void;
}) {
  const clienteDeConsultas = useQueryClient();
  const montado = useMontado();

  const [ciclo, setCiclo] = useState(0);
  const [chamada, setChamada] = useState<ChamadaEmCurso | null>(null);
  const [clientKey, setClientKey] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [noAtual, setNoAtual] = useState<string>(NO_DE_ABERTURA);
  const [caminho, setCaminho] = useState<string[]>([]);
  const [capturas, setCapturas] = useState<Record<string, string>>({});
  const [combinadoEm, setCombinadoEm] = useState<string | null>(null);
  const [atendeu, setAtendeu] = useState(false);
  const [abrindo, setAbrindo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erroDaGravacao, setErroDaGravacao] = useState<string | null>(null);

  const [pendente, setPendente] = useState<DesfechoDeLigacao | null>(null);
  const [pediuParaNaoLigar, setPediuParaNaoLigar] = useState(false);

  const [recibo, setRecibo] = useState<{
    item: ItemDoLote;
    rotulo: string;
    desfecho: DesfechoDeLigacao | null;
    resultado: Extract<ResultadoTabulacao, { tabulado: true }>;
  } | null>(null);
  const [restaMs, setRestaMs] = useState(ESPERA_ANTES_DO_PROXIMO_MS);

  // Relógio da janela de horário: um tique a cada 15 s repinta a contagem regressiva.
  // O valor NÃO é semeado no primeiro passe do servidor (`montado`), para o HTML do
  // servidor e o do cliente serem iguais.
  const [, setTique] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTique((t) => t + 1), INTERVALO_RELOGIO_MS);
    return () => window.clearInterval(id);
  }, []);
  const janela = montado ? janelaDeLigacao(new Date(), contexto.feriados) : null;

  const provedor = useMemo(() => criarProvedorManual(), []);

  /**
   * A data que a tela propõe enquanto nada foi combinado: a próxima abertura da janela
   * (R13 §6). Serve à fala do roteiro e à folha de extras, e nunca é gravada sozinha —
   * quem confirma é a folha, que é onde a data vira tarefa ou reunião.
   */
  const sugestaoDeData = useMemo(
    () => proximaAbertura(hojeCivil(), contexto.feriados),
    [contexto.feriados],
  );

  const proximo = useQuery({
    queryKey: ['ligacao', 'proximo', lote.id, ciclo],
    queryFn: () =>
      puxarProximo(lote.id, {
        slug: roteiroConhecido?.slug ?? 'roteiro',
        nome: roteiroConhecido?.nome ?? 'Roteiro do lote',
      }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const emMaos = proximo.data?.ok ? proximo.data : null;
  const item = emMaos?.item ?? null;
  const roteiro = emMaos?.roteiro ?? null;
  const variante = emMaos?.variante ?? 'fornecedor';

  // Cronômetro da chamada: começa no toque de "Ligar" / "Liguei" / "Copiar".
  const iniciadaEm = chamada ? Date.parse(chamada.iniciadaEm) : null;
  useEffect(() => {
    if (iniciadaEm === null) return;
    const id = window.setInterval(
      () => setSegundos(Math.max(0, Math.round((Date.now() - iniciadaEm) / 1000))),
      1000,
    );
    return () => window.clearInterval(id);
  }, [iniciadaEm]);

  /** Limpa tudo que pertence à ligação anterior e puxa o próximo da fila. */
  const irParaOProximo = useCallback(() => {
    setChamada(null);
    setClientKey(null);
    setSegundos(0);
    setNoAtual(NO_DE_ABERTURA);
    setCaminho([]);
    setCapturas({});
    setCombinadoEm(null);
    setAtendeu(false);
    setPendente(null);
    setPediuParaNaoLigar(false);
    setErroDaGravacao(null);
    setRecibo(null);
    setRestaMs(ESPERA_ANTES_DO_PROXIMO_MS);
    setCiclo((c) => c + 1);
  }, []);

  // O recibo some sozinho e traz o próximo contato: é o "encerrar-e-próxima" do
  // R13 §7.6, e é o ganho de produtividade real do módulo.
  useEffect(() => {
    if (!recibo) return;
    const prazo = Date.now() + ESPERA_ANTES_DO_PROXIMO_MS;
    const id = window.setInterval(() => {
      const resta = prazo - Date.now();
      if (resta <= 0) {
        window.clearInterval(id);
        irParaOProximo();
      } else {
        setRestaMs(resta);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [recibo, irParaOProximo]);

  // ---------------------------------------------------------------------------
  // Discar
  // ---------------------------------------------------------------------------
  async function ligar() {
    if (!item || chamada || abrindo) return;
    setAbrindo(true);
    try {
      const aberta = await provedor.iniciarChamada({ telefone: item.telefone, itemId: item.id });
      setChamada(aberta);
      setClientKey(crypto.randomUUID());
      setNoAtual(NO_DE_ABERTURA);
      setCaminho([NO_DE_ABERTURA]);
      setSegundos(0);
    } catch (erro) {
      toast.error(
        erro instanceof ErroDaLigacao
          ? erro.message
          : 'Não deu para abrir esta ligação. Puxe o próximo da fila.',
      );
    } finally {
      setAbrindo(false);
    }
  }

  /** "Não era esse": devolve o contato à fila sem tabular e puxa o próximo. */
  async function pular() {
    if (!item) return;
    await devolverItem(item.id, 'pulado na tela de ligar');
    irParaOProximo();
  }

  // ---------------------------------------------------------------------------
  // Percorrer a árvore
  // ---------------------------------------------------------------------------
  function responder(saida: SaidaDoNo) {
    if (!roteiro) return;
    const atual = noPorId(roteiro, noAtual);

    // O primeiro toque numa resposta É a afirmação de que alguém atendeu: no
    // adaptador manual não há AMD, e a única coisa honesta que se pode dizer é que
    // ela só lê a segunda fala se tem alguém do outro lado (R13 §3.3).
    if (!atendeu) {
      setAtendeu(true);
      provedor.marcarAtendida();
    }

    // Nó de captura: sem anotação escrita, o que fica gravado é a resposta tocada.
    if (atual?.tipo === 'captura' && atual.campo) {
      const campo = atual.campo;
      setCapturas((c) => (c[campo]?.trim() ? c : { ...c, [campo]: saida.rotulo }));
    }

    setNoAtual(saida.destino);
    setCaminho((c) => [...c, saida.destino]);
  }

  /** Uma objeção é alcançável de qualquer nó e devolve ao fluxo pelas saídas dela. */
  function irParaObjecao(no: NoRoteiro) {
    if (!atendeu) {
      setAtendeu(true);
      provedor.marcarAtendida();
    }
    setNoAtual(no.id);
    setCaminho((c) => [...c, no.id]);
  }

  // ---------------------------------------------------------------------------
  // Tabular
  // ---------------------------------------------------------------------------
  const gravar = useCallback(
    async (
      resultado: ResultadoTecnico,
      desfecho: DesfechoDeLigacao | null,
      extras: ExtrasDaChamada,
      optout: boolean,
    ) => {
      if (!item || !chamada || !clientKey || gravando) return;
      setGravando(true);
      setErroDaGravacao(null);
      try {
        const pedido = tabularChamadaSchema.parse({
          clientKey,
          chamadaId: chamada.id,
          itemId: item.id,
          resultado,
          outcomeId: desfecho?.id ?? null,
          comQuem: desfecho ? comQuemPadrao(desfecho) : 'ninguem',
          caminhoScript: caminho,
          duracaoSeg: segundos,
          observacao: null,
          capturas,
          /**
           * Reunião marcada não tem "próxima ação" separada da reunião: a data
           * combinada é a próxima ação. Sem isto, `registrar_contato` cairia na régua
           * padrão do catálogo e criaria "Reunião na data" para o dia seguinte útil,
           * enquanto a reunião está marcada para outro dia — duas datas para o mesmo
           * compromisso, na agenda de quem vai à reunião. É o mesmo que a `/registrar`
           * faz ao mandar a data combinada junto do pedido.
           */
          agendarPara: extras.agendarPara ?? extras.reuniaoEm,
          lostReasonId: extras.lostReasonId,
          reuniaoEm: extras.reuniaoEm,
          reuniaoFormato: extras.reuniaoFormato,
          pediuParaNaoLigar: optout,
        });

        await provedor.encerrar(chamada.id, resultado);
        const resposta = await tabularChamada(pedido);

        if (!resposta.tabulado) {
          setErroDaGravacao(fraseDaRecusaDaChamada(resposta));
          return;
        }

        setPendente(null);
        setRecibo({
          item,
          rotulo: desfecho ? desfecho.name : ROTULOS_RESULTADO_TECNICO[resultado],
          desfecho,
          resultado: resposta,
        });
        setRestaMs(ESPERA_ANTES_DO_PROXIMO_MS);
        void clienteDeConsultas.invalidateQueries({ queryKey: ['registro'] });
      } catch (erro) {
        setErroDaGravacao(
          erro instanceof ErroDaLigacao
            ? erro.message
            : 'Não deu para gravar o resultado. Tente de novo.',
        );
      } finally {
        setGravando(false);
      }
    },
    [caminho, capturas, chamada, clienteDeConsultas, clientKey, gravando, item, provedor, segundos],
  );

  function tabularTecnico(resultado: ResultadoTecnico) {
    void gravar(resultado, null, EXTRAS_DA_CHAMADA_VAZIOS, false);
  }

  function tabularComercial(desfecho: DesfechoDeLigacao, optout: boolean) {
    if (precisaDeExtras(desfecho, optout)) {
      setPediuParaNaoLigar(optout);
      setPendente(desfecho);
      return;
    }
    void gravar('atendida_humano', desfecho, EXTRAS_DA_CHAMADA_VAZIOS, optout);
  }

  // ---------------------------------------------------------------------------
  // O que a árvore diz sobre o fim
  // ---------------------------------------------------------------------------
  const noCorrente = roteiro ? noPorId(roteiro, noAtual) : null;
  const desfechoDoFim =
    noCorrente?.tipo === 'fim' && noCorrente.desfecho
      ? (contexto.catalogo.find((d) => d.slug === noCorrente.desfecho) ?? null)
      : null;
  const tecnicoDoFim =
    noCorrente?.tipo === 'fim' && noCorrente.resultadoTecnico ? noCorrente.resultadoTecnico : null;
  // `fim_optout` é o nó em que ele pede para não ser mais procurado: além do desfecho,
  // grava `consent_events.contact_optout`, e aí não tem volta (RF-CON-18).
  const fimEhOptout = noCorrente?.id === 'fim_optout';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (proximo.isPending || janela === null) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Topo lote={lote} restantes={null} fechaEm={null} aoSair={aoSair} />
        <EsqueletoDaChamada />
      </div>
    );
  }

  if (proximo.isError) {
    const frase =
      proximo.error instanceof ErroDaLigacao
        ? proximo.error.message
        : 'Não deu para falar com o servidor. Verifique a conexão e tente de novo.';
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Topo lote={lote} restantes={null} fechaEm={null} aoSair={aoSair} />
        <ErroDaChamada
          frase={frase}
          aoTentarDeNovo={() => void proximo.refetch()}
          aoVoltar={aoSair}
        />
      </div>
    );
  }

  if (recibo) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Topo
          lote={lote}
          restantes={recibo.resultado.restantes}
          fechaEm={janela.aberta ? janela.fechaEm : null}
          aoSair={aoSair}
        />
        <ChamadaRecibo
          item={recibo.item}
          rotulo={recibo.rotulo}
          desfecho={recibo.desfecho}
          resultado={recibo.resultado}
          restaMs={restaMs}
          aoProximo={irParaOProximo}
        />
      </div>
    );
  }

  if (proximo.data && !proximo.data.ok) {
    const recusa = proximo.data;
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Topo lote={lote} restantes={null} fechaEm={null} aoSair={aoSair} />
        {recusa.motivo === 'fila_vazia' ? (
          <FilaAcabou falados={lote.falados} total={lote.total} aoMontarOutro={aoMontarOutro} />
        ) : recusa.motivo === 'fora_da_janela' && !janela.aberta ? (
          <ForaDaJanela janela={janela} aoTentarDeNovo={() => void proximo.refetch()} />
        ) : (
          <ErroDaChamada
            frase={MENSAGENS_DE_RECUSA_DA_FILA[recusa.motivo]}
            aoTentarDeNovo={() => void proximo.refetch()}
            aoVoltar={aoSair}
          />
        )}
      </div>
    );
  }

  if (!item || !roteiro) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Topo lote={lote} restantes={null} fechaEm={null} aoSair={aoSair} />
        <ErroDaChamada
          frase="O servidor não devolveu o roteiro deste lote. Recarregue a página."
          aoTentarDeNovo={null}
          aoVoltar={aoSair}
        />
      </div>
    );
  }

  const noParaLer = noCorrente ?? noPorId(roteiro, NO_DE_ABERTURA);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Topo
        lote={lote}
        restantes={emMaos?.restantes ?? null}
        fechaEm={janela.aberta ? janela.fechaEm : null}
        aoSair={aoSair}
      />

      <div className="flex flex-col gap-6">
        <ChamadaCabecalho
          item={item}
          maxTentativas={lote.maxTentativas}
          janela={janela}
          chamada={chamada}
          segundos={segundos}
          abrindo={abrindo}
          aoLigar={() => void ligar()}
        />

        {chamada === null ? (
          <>
            {noParaLer ? (
              <div className="rounded-xl border border-dashed border-hairline p-4 sm:p-5">
                <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  A primeira fala
                </p>
                <RoteiroNo
                  roteiro={roteiro}
                  no={noParaLer}
                  variante={variante}
                  item={item}
                  quemLiga={quemLiga}
                  combinadoEm={combinadoEm}
                  sugestaoDeData={sugestaoDeData}
                  aoCombinar={setCombinadoEm}
                  captura=""
                  aoCapturar={() => {}}
                  aoResponder={() => void ligar()}
                  somenteLeitura
                />
              </div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="h-10 self-start text-muted-foreground"
              onClick={() => void pular()}
            >
              <SkipForward aria-hidden="true" />
              Pular este contato
            </Button>
          </>
        ) : (
          <div className="flex gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-6">
              {noParaLer ? (
                <RoteiroNo
                  roteiro={roteiro}
                  no={noParaLer}
                  variante={variante}
                  item={item}
                  quemLiga={quemLiga}
                  combinadoEm={combinadoEm}
                  sugestaoDeData={sugestaoDeData}
                  aoCombinar={setCombinadoEm}
                  captura={(noParaLer.campo ? capturas[noParaLer.campo] : '') ?? ''}
                  aoCapturar={(valor) => {
                    const campo = noParaLer.campo;
                    if (campo) setCapturas((c) => ({ ...c, [campo]: valor }));
                  }}
                  aoResponder={responder}
                />
              ) : null}

              <ObjecoesEmGaveta roteiro={roteiro} variante={variante} aoEscolher={irParaObjecao} />

              {erroDaGravacao ? (
                <p className="text-sm text-destructive-texto">{erroDaGravacao}</p>
              ) : null}

              <ChamadaTabulacao
                catalogo={contexto.catalogo}
                atendeu={atendeu}
                gravando={gravando}
                desfechoDoFim={desfechoDoFim}
                fimTecnico={tecnicoDoFim}
                aoResultadoTecnico={tabularTecnico}
                aoDesfecho={(d) => tabularComercial(d, fimEhOptout)}
              />
            </div>

            <ObjecoesLaterais roteiro={roteiro} variante={variante} aoEscolher={irParaObjecao} />
          </div>
        )}
      </div>

      <ChamadaExtras
        desfecho={pendente}
        pediuParaNaoLigar={pediuParaNaoLigar}
        motivosPerda={contexto.motivosPerda}
        formatosDaEtapa={contexto.formatosDeReuniao[lote.pipelineId] ?? []}
        sugestaoDeData={combinadoEm ?? sugestaoDeData}
        aoConfirmar={(extras) => {
          if (pendente) void gravar('atendida_humano', pendente, extras, pediuParaNaoLigar);
        }}
        aoCancelar={() => {
          setPendente(null);
          setPediuParaNaoLigar(false);
        }}
      />
    </div>
  );
}

/** O único número da tela, e é o que faz a pessoa fazer mais uma ligação. */
function Topo({
  lote,
  restantes,
  fechaEm,
  aoSair,
}: {
  lote: LoteResumido;
  restantes: number | null;
  fechaEm: string | null;
  aoSair: () => void;
}) {
  const feitos = restantes === null ? null : Math.max(0, lote.total - restantes);

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <Button
        type="button"
        variant="ghost"
        className="h-9 -ml-2 text-muted-foreground"
        onClick={aoSair}
      >
        <ChevronLeft aria-hidden="true" />
        {lote.nome}
      </Button>

      <p className="text-sm text-muted-foreground">
        {feitos === null ? (
          <span className="numerico">{lote.total} no lote</span>
        ) : (
          <>
            <span className="numerico text-foreground">{feitos}</span>
            <span className="numerico"> de {lote.total}</span>
          </>
        )}
        {' · '}
        <span className="numerico">{lote.falados}</span> falaram
        {fechaEm ? (
          <>
            {' · '}fecha em <span className="numerico">{faltamAte(fechaEm)}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

/** O dia civil de hoje em Fortaleza, para a sugestão de data da folha de extras. */
function hojeCivil(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
