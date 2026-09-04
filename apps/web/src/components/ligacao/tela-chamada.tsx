'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, SkipForward } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useMontado } from '@/lib/usar-cliente';
import { DialogoConfirmar } from '@/components/admin/confirmar';
import { comQuemPadrao, perguntaComQuem, type ComQuem } from '@/components/registro/tipos';

import { ChamadaCabecalho, faltamAte } from './chamada-cabecalho';
import {
  EsqueletoDaChamada,
  ErroDaChamada,
  FilaAcabou,
  ForaDaJanela,
  SoSobraramOsPulados,
} from './chamada-estados';
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
  marcarNaoLigarMais,
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
  /** A folha ainda precisa colher a confirmação do opt-out (o nó `fim_optout`). */
  const [confirmarOptoutNaFolha, setConfirmarOptoutNaFolha] = useState(false);
  /**
   * "Ele pediu para não ser mais procurado", marcado na barra de tabulação e válido
   * de qualquer nó do roteiro (D6).
   *
   * A supressão é gravada NA HORA, por `marcar_nao_ligar_mais`, e não espera o commit:
   * o CLAUDE.md manda suprimir no instante do pedido, e quem pede para sair não pode
   * depender de a ligação chegar a ser tabulada — foi medido o contrário acontecendo
   * (marcar, sair pelo menu, e o contato voltar para a fila sem nenhum registro).
   *
   * O estado continua viajando no commit (`p_pediu_para_nao_ligar`) de propósito: são
   * duas portas para a mesma consequência, a RPC é idempotente por (organização,
   * pessoa), e assim a supressão vale mesmo se a chamada imediata não sair.
   */
  const [optoutMarcado, setOptoutMarcado] = useState(false);
  const [pedindoOptout, setPedindoOptout] = useState(false);

  /** Com quem ela falou, respondido ANTES do commit (D3, RF-MET-01). */
  const [comQuem, setComQuem] = useState<ComQuem | null>(null);
  const [cobrandoComQuem, setCobrandoComQuem] = useState(false);

  /**
   * Os contatos que ela pulou neste turno. Eles NÃO voltam para a fila na hora: a
   * reserva de 30 minutos que `proximo_da_fila` criou continua de pé, e é ela que
   * manda o pulado para o fim do turno em vez de devolvê-lo na mesma posição (D1).
   * Quem sai da tela devolve todos; quem fica vê a fila andar.
   */
  const puladosRef = useRef<string[]>([]);
  const [pulados, setPulados] = useState<string[]>([]);
  const [avisoDaFila, setAvisoDaFila] = useState<{ texto: string; tom: 'alerta' | 'nota' } | null>(
    null,
  );

  /** Guarda a lista dos pulados nos dois lugares: o `ref` decide, o estado desenha. */
  const anotarPulados = useCallback((ids: string[]) => {
    puladosRef.current = ids;
    setPulados(ids);
  }, []);

  const [recibo, setRecibo] = useState<{
    item: ItemDoLote;
    rotulo: string;
    desfecho: DesfechoDeLigacao | null;
    resultado: Extract<ResultadoTabulacao, { tabulado: true }>;
    comQuem: ComQuem;
  } | null>(null);
  const [restaMs, setRestaMs] = useState(ESPERA_ANTES_DO_PROXIMO_MS);
  const [reciboPausado, setReciboPausado] = useState(false);

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
    queryFn: async () => {
      const resposta = await puxarProximo(lote.id, {
        slug: roteiroConhecido?.slug ?? 'roteiro',
        nome: roteiroConhecido?.nome ?? 'Roteiro do lote',
      });
      // A reserva de um pulado vence em 30 minutos e a fila volta a oferecê-lo — o que
      // é certo, e é o "fim do turno" chegando. O que não pode é ele reaparecer em
      // silêncio, como contato novo: aqui ele deixa de ser pulado e a tela diz de onde
      // veio. É também o que impede que sair da tela devolva à fila um item já tabulado.
      if (resposta.ok && puladosRef.current.includes(resposta.item.id)) {
        anotarPulados(puladosRef.current.filter((x) => x !== resposta.item.id));
        setAvisoDaFila({
          tom: 'nota',
          texto: 'Este contato voltou para a fila: você já o tinha pulado neste turno.',
        });
      }
      return resposta;
    },
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
    setConfirmarOptoutNaFolha(false);
    setOptoutMarcado(false);
    setPedindoOptout(false);
    setComQuem(null);
    setCobrandoComQuem(false);
    setErroDaGravacao(null);
    setAvisoDaFila(null);
    setRecibo(null);
    setRestaMs(ESPERA_ANTES_DO_PROXIMO_MS);
    setReciboPausado(false);
    setCiclo((c) => c + 1);
  }, []);

  // O recibo some sozinho e traz o próximo contato: é o "encerrar-e-próxima" do
  // R13 §7.6, e é o ganho de produtividade real do módulo.
  //
  // A contagem NÃO corre enquanto a pessoa está mexendo no recibo (`reciboPausado`),
  // e uma vez parada não recomeça: quem começou a escrever uma anotação decide sozinha
  // quando vai para o próximo contato, no botão que já está na tela.
  useEffect(() => {
    if (!recibo || reciboPausado) return;
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
  }, [recibo, reciboPausado, irParaOProximo]);

  const pausarRecibo = useCallback(() => setReciboPausado(true), []);

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

  /**
   * "Não era esse": manda o contato para o FIM do turno e traz o próximo.
   *
   * O que ele NÃO faz mais é chamar `devolver_item_do_lote` na hora — e essa é a
   * correção. `devolver_item_do_lote` devolve o item à fila sem tocar em `position`,
   * `attempts` nem `scheduled_at`, e `proximo_da_fila` ordena por
   * `(scheduled_at is not null) desc, scheduled_at, position`: devolvido e repuxado, o
   * item volta EXATAMENTE na mesma posição, que é a primeira. Pular virava um laço —
   * medido: Conto de Fadas → Pular → Conto de Fadas.
   *
   * O que existe e resolve sem inventar regra nova é a reserva que `proximo_da_fila`
   * acabou de criar: enquanto o item está `em_andamento` ele não é candidato, e a
   * própria `proximo_da_fila` libera reservas vencidas do lote antes de escolher. Ou
   * seja: segurar a reserva manda o pulado para depois — 30 minutos, ou o momento em
   * que ela sai da tela, o que vier primeiro. Nada se perde: `app.expirar_reservas`
   * (pg_cron) devolve o que sobrar, e `restantes` continua contando o item.
   *
   * Fila de um item só não tem para onde pular, e a tela diz isso em vez de repetir o
   * mesmo contato em silêncio.
   */
  function pular() {
    if (!item) return;
    const outros = (emMaos?.restantes ?? 1) - 1 - pulados.length;
    if (outros <= 0) {
      setAvisoDaFila({
        tom: 'alerta',
        texto:
          pulados.length > 0
            ? `Não há para onde pular: ${item.nome} é o único que resta além dos ${pulados.length} que você já pulou. Ligue para ele, ou volte aos lotes.`
            : `Não há para onde pular: ${item.nome} é o último contato da fila deste lote.`,
      });
      return;
    }
    if (!puladosRef.current.includes(item.id)) {
      anotarPulados([...puladosRef.current, item.id]);
    }
    irParaOProximo();
  }

  /** Devolve à fila, de uma vez, tudo o que foi pulado neste turno. */
  const devolverOsPulados = useCallback(async () => {
    const ids = puladosRef.current;
    anotarPulados([]);
    await Promise.all(
      ids.map(async (id) => {
        try {
          await devolverItem(id, 'pulado na tela de ligar');
        } catch {
          // A reserva expira sozinha em 30 minutos: não há o que salvar aqui.
        }
      }),
    );
  }, [anotarPulados]);

  /** Sair devolve os pulados: ninguém fica reservado por causa de uma aba fechada. */
  function sair() {
    void devolverOsPulados();
    aoSair();
  }

  // E QUALQUER outra saída também devolve. O botão de voltar é uma das maneiras de
  // deixar esta tela; o item do menu lateral, o botão de voltar do navegador e um
  // link qualquer são as outras, e nenhuma delas passa por `sair()`. Sem isto, a
  // frase "eles voltam para a fila quando você sair desta tela" só valia para uma
  // saída em três, e cada pulado abandonado ficava 30 minutos reservado — tempo em
  // que a fila diz "acabou" com contatos dentro. Medido em 04/09/2026: sete pulados
  // presos em dez minutos de uso. `devolverOsPulados` zera a lista antes de soltar
  // as chamadas, então rodar junto com `sair()` não devolve nada duas vezes.
  useEffect(() => {
    return () => {
      void devolverOsPulados();
    };
  }, [devolverOsPulados]);

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

    // O que o toque grava no campo do nó: `saida.valor`, e só ele.
    //
    // Antes era o RÓTULO do botão, e o rótulo nem sempre é resposta: no nó do volume
    // ("Quantos eventos o [empresa] faz por mês?") os rótulos são instrução para quem
    // liga — "Ele respondeu quantos" —, e gravá-los enchia `eventos_por_mes` com uma
    // frase que não é número. Onde o rótulo É a resposta, a árvore declara `valor` e
    // um toque grava; onde não é, o campo guarda o que ela escreveu, ou fica vazio.
    // Campo vazio é honesto; campo com a frase errada, não.
    if (atual?.campo && saida.valor) {
      const campo = atual.campo;
      const valor = saida.valor;
      setCapturas((c) => (c[campo]?.trim() ? c : { ...c, [campo]: valor }));
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
        /**
         * Quem estava do outro lado (RF-MET-01). A regra tem duas metades e a ordem
         * importa: quando o NOME do desfecho já afirma o interlocutor, é ele que vale
         * (`lig_nao_atendeu` é sempre "ninguém", e deixar a pessoa contradizer isso
         * seria dado sujo); quando não afirma — e são exatamente os cinco desfechos
         * comerciais da ligação —, vale o que ela respondeu na barra ANTES de gravar.
         * O `nao_informado` continua existindo, mas só como resposta escolhida.
         */
        const comQuemGravado = desfecho
          ? perguntaComQuem(desfecho)
            ? (comQuem ?? 'nao_informado')
            : comQuemPadrao(desfecho)
          : 'ninguem';

        const pedido = tabularChamadaSchema.parse({
          clientKey,
          chamadaId: chamada.id,
          itemId: item.id,
          resultado,
          outcomeId: desfecho?.id ?? null,
          comQuem: comQuemGravado,
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
        setConfirmarOptoutNaFolha(false);
        setRecibo({
          item,
          rotulo: desfecho ? desfecho.name : ROTULOS_RESULTADO_TECNICO[resultado],
          desfecho,
          resultado: resposta,
          comQuem: comQuemGravado,
        });
        setRestaMs(ESPERA_ANTES_DO_PROXIMO_MS);
        setReciboPausado(false);
        void clienteDeConsultas.invalidateQueries({ queryKey: ['registro'] });
        // O "N falaram" do topo é `call_batches.talked`, materializado pelo gatilho
        // `app.call_batches_refresh_counts` na mesma transação da tabulação. Reler o
        // lote é o que faz o número andar no turno em vez de ficar no valor que a
        // página carregou (D9); a lista de lotes segue o mesmo caminho.
        void clienteDeConsultas.invalidateQueries({ queryKey: ['ligacao', 'lote', item.loteId] });
        void clienteDeConsultas.invalidateQueries({ queryKey: ['ligacao', 'lotes'] });
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
    [
      caminho,
      capturas,
      chamada,
      clienteDeConsultas,
      clientKey,
      comQuem,
      gravando,
      item,
      provedor,
      segundos,
    ],
  );

  function tabularTecnico(resultado: ResultadoTecnico) {
    void gravar(resultado, null, EXTRAS_DA_CHAMADA_VAZIOS, optoutMarcado);
  }

  function tabularComercial(desfecho: DesfechoDeLigacao, fimEhOptout: boolean) {
    // A pergunta que muda a métrica de porta aberta é feita ANTES do commit: sem
    // resposta, o toque no desfecho cobra a resposta em vez de gravar `nao_informado`
    // por conta própria (D3, RF-MET-01).
    if (perguntaComQuem(desfecho) && comQuem === null) {
      setCobrandoComQuem(true);
      return;
    }

    const optout = optoutMarcado || fimEhOptout;
    // Quem marcou na barra já confirmou no diálogo; pedir de novo na folha seria
    // cobrar duas vezes a mesma decisão. Quem chegou pelo nó `fim_optout` confirma ali.
    const confirmar = optout && !optoutMarcado;

    if (precisaDeExtras(desfecho, confirmar)) {
      setConfirmarOptoutNaFolha(confirmar);
      setPendente(desfecho);
      return;
    }
    void gravar('atendida_humano', desfecho, EXTRAS_DA_CHAMADA_VAZIOS, optout);
  }

  function escolherComQuem(valor: ComQuem) {
    setComQuem(valor);
    setCobrandoComQuem(false);
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
        <Topo lote={lote} restantes={null} fechaEm={null} aoSair={sair} />
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
        <Topo lote={lote} restantes={null} fechaEm={null} aoSair={sair} />
        <ErroDaChamada
          frase={frase}
          aoTentarDeNovo={() => void proximo.refetch()}
          aoVoltar={sair}
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
          aoSair={sair}
        />
        <ChamadaRecibo
          item={recibo.item}
          rotulo={recibo.rotulo}
          desfecho={recibo.desfecho}
          resultado={recibo.resultado}
          comQuemGravado={recibo.comQuem}
          restaMs={restaMs}
          pausado={reciboPausado}
          aoPausar={pausarRecibo}
          aoProximo={irParaOProximo}
        />
      </div>
    );
  }

  if (proximo.data && !proximo.data.ok) {
    const recusa = proximo.data;
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Topo lote={lote} restantes={null} fechaEm={null} aoSair={sair} />
        {recusa.motivo === 'fila_vazia' && pulados.length > 0 ? (
          // A fila só "acabou" porque os pulados estão reservados com ela. Dizer
          // "acabou" aqui seria mentira, e mandar montar outro lote seria pior ainda.
          <SoSobraramOsPulados
            pulados={pulados.length}
            aoRetomar={() => {
              void devolverOsPulados().then(() => proximo.refetch());
            }}
            aoVoltar={sair}
          />
        ) : recusa.motivo === 'fila_vazia' ? (
          <FilaAcabou falados={lote.falados} total={lote.total} aoMontarOutro={aoMontarOutro} />
        ) : recusa.motivo === 'fora_da_janela' && !janela.aberta ? (
          <ForaDaJanela janela={janela} aoTentarDeNovo={() => void proximo.refetch()} />
        ) : (
          <ErroDaChamada
            frase={MENSAGENS_DE_RECUSA_DA_FILA[recusa.motivo]}
            aoTentarDeNovo={() => void proximo.refetch()}
            aoVoltar={sair}
          />
        )}
      </div>
    );
  }

  if (!item || !roteiro) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Topo lote={lote} restantes={null} fechaEm={null} aoSair={sair} />
        <ErroDaChamada
          frase="O servidor não devolveu o roteiro deste lote. Recarregue a página."
          aoTentarDeNovo={null}
          aoVoltar={sair}
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
        aoSair={sair}
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
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="ghost"
                className="h-10 self-start text-muted-foreground"
                onClick={pular}
              >
                <SkipForward aria-hidden="true" />
                Pular este contato
              </Button>
              {avisoDaFila ? (
                <p
                  aria-live="polite"
                  className={
                    avisoDaFila.tom === 'alerta'
                      ? 'text-sm text-destructive-texto'
                      : 'text-sm text-muted-foreground'
                  }
                >
                  {avisoDaFila.texto}
                </p>
              ) : pulados.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  <span className="numerico">{pulados.length}</span>
                  {pulados.length === 1
                    ? ' pulado neste turno: ele volta para a fila quando você sair desta tela.'
                    : ' pulados neste turno: eles voltam para a fila quando você sair desta tela.'}
                </p>
              ) : null}
            </div>
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
                comQuem={comQuem}
                cobrandoComQuem={cobrandoComQuem}
                aoComQuem={escolherComQuem}
                optoutMarcado={optoutMarcado || fimEhOptout}
                aoPedirOptout={() => setPedindoOptout(true)}
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
        pediuParaNaoLigar={confirmarOptoutNaFolha}
        motivosPerda={contexto.motivosPerda}
        formatosDaEtapa={contexto.formatosDeReuniao[lote.pipelineId] ?? []}
        sugestaoDeData={combinadoEm ?? sugestaoDeData}
        aoConfirmar={(extras) => {
          if (pendente) {
            void gravar('atendida_humano', pendente, extras, optoutMarcado || fimEhOptout);
          }
        }}
        aoCancelar={() => {
          setPendente(null);
          setConfirmarOptoutNaFolha(false);
        }}
      />

      {/* O pedido de não ser mais procurado, de qualquer nó do roteiro (D6, RF-CON-18).
          A confirmação conta a consequência inteira porque ela não tem volta: o número
          entra na `suppression_list` e nenhum canal fala com ele de novo. */}
      <DialogoConfirmar
        aberto={pedindoOptout}
        aoFechar={() => setPedindoOptout(false)}
        titulo="Ele pediu para não ser mais procurado?"
        perigo
        rotuloConfirmar="Sim, ele pediu"
        descricao={
          <>
            <p>
              {item.nome} entra na lista de supressão: ninguém liga, manda WhatsApp ou DM
              para este contato de novo, em nenhum modo, e as tarefas abertas dele são
              canceladas.
            </p>
            <p>Isto não tem volta, e vale a partir de agora — não depende de gravar o resultado.</p>
          </>
        }
        aoConfirmar={() => {
          // Vale JÁ. O guardrail do produto é suprimir no instante do pedido, e quem
          // pede para sair não pode depender de a ligação chegar a ser tabulada: se ela
          // cair, ou se a pessoa sair pelo menu, o pedido tem de ter valido do mesmo
          // jeito. Foi medido acontecendo o contrário.
          setOptoutMarcado(true);
          setPedindoOptout(false);
          void marcarNaoLigarMais({
            itemId: item.id,
            organizationId: item.organizationId,
            contactId: item.contatoId ?? null,
            evidencia: 'Pedido na ligação, marcado na barra de tabulação.',
          }).catch((erro) => {
            // A supressão continua garantida pelo commit (`p_pediu_para_nao_ligar`), que
            // é a segunda porta. Mas a pessoa precisa saber que a primeira não pegou,
            // senão ela sai da tela achando que o pedido já valeu.
            console.error('[ligacao] opt-out imediato falhou', erro);
            setErroDaGravacao(
              'O pedido de não ligar mais ainda não foi gravado. Grave o resultado desta ligação para ele valer.',
            );
          });
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
