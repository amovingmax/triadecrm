'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { carregarAlvo } from './alvos';
import { anotarNaAtividade, corrigirComQuem, remarcarProximaAcao } from './ajustes';
import type { ContextoDoRegistro } from './dados';
import {
  anotarFalha,
  atualizarPedidoGuardado,
  drenarFila,
  guardarPendente,
  lerFila,
  reativarEsgotados,
  removerDaFila,
} from './fila-offline';
import { FilaGuardada } from './fila-guardada';
import { EXTRAS_VAZIOS, FolhaExtra, precisaDeExtra, type ValoresExtras } from './folha-extra';
import { ErroDeRegistro, fraseDaRecusa, gravarRegistro, montarRegistro } from './gravar';
import { PassoOQue } from './passo-oque';
import { PassoQuem } from './passo-quem';
import { Recibo, type EstadoDoEnvio } from './recibo';
import {
  comQuemPadrao,
  ESPERA_DESFAZER_MS,
  INTERVALO_DRENO_MS,
  preverRegistro,
  valeParaQuemPediuParar,
  type AlvoDoRegistro,
  type ComQuem,
  type DesfechoCatalogo,
  type PrevisaoRegistro,
  type RegistroContato,
  type RegistroNaFila,
  type Superficie,
} from './tipos';
import { useUltimaSuperficie } from './usar-ultima-superficie';

/**
 * A tela de registrar contato: uma rota só, três toques que gravam.
 *
 * Parceiro → canal → desfecho. O toque no desfecho É o commit; o que vem depois é
 * recibo, não formulário. Doze dos 34 desfechos abrem uma folha com o campo que
 * falta (ver `folha-extra.tsx`), e os outros 22 vão direto do desfecho ao recibo.
 *
 * O envio é SEGURADO por `ESPERA_DESFAZER_MS`. Quem dispara o envio é o fim da
 * contagem, o botão "Registrar outro" ou a saída da tela — nunca um botão "Salvar",
 * que seria o quarto toque de todo registro, trinta vezes por dia.
 *
 * Nada aqui recalcula temperatura: `app.compute_temperature` continua sendo a regra
 * (PRD §5.6). A previsão que o recibo pinta é a temperatura que o próprio catálogo
 * declara, e ela é trocada pelo valor do banco assim que a resposta chega.
 */

/** O que está em cima da mesa entre o toque no desfecho e o envio. */
type Rascunho = {
  alvo: AlvoDoRegistro;
  desfecho: DesfechoCatalogo;
  superficie: Superficie;
  comQuem: ComQuem;
  observacao: string;
  ocorridoEm: Date;
  previsao: PrevisaoRegistro;
  extras: ValoresExtras;
  clientKey: string;
};

/**
 * O pedido que sai do rascunho. Levanta `ZodError` quando falta um campo do ramo.
 *
 * Existe como função de módulo porque agora é chamado em três momentos — no commit
 * (para guardar no aparelho), a cada correção do recibo (para o guardado ser o que ela
 * está vendo) e no envio —, e os três precisam montar exatamente o mesmo pedido, com a
 * mesma `clientKey`. É a `clientKey` que faz reenviar não duplicar.
 */
function pedidoDoRascunho(r: Rascunho): RegistroContato {
  return montarRegistro({
    alvo: r.alvo,
    desfecho: r.desfecho,
    superficie: r.superficie,
    comQuem: r.comQuem,
    ocorridoEm: r.ocorridoEm,
    previsao: r.previsao,
    observacao: r.observacao,
    lostReasonId: r.extras.lostReasonId,
    reuniaoEm: r.extras.reuniaoEm,
    reuniaoFormato: r.extras.reuniaoFormato,
    autorizacaoEvidencia: r.extras.autorizacaoEvidencia,
    confirmouOptout: r.extras.confirmouOptout,
    clientKey: r.clientKey,
  });
}

export function TelaRegistro({
  usuarioId,
  contexto,
  organizacaoInicial,
}: {
  usuarioId: string;
  contexto: ContextoDoRegistro;
  /** Veio de `/registrar?org=<id>`: a ficha e a fila do dia abrem já no passo 2. */
  organizacaoInicial: string | null;
}) {
  const router = useRouter();
  const clienteDeConsultas = useQueryClient();

  const [alvo, setAlvo] = useState<AlvoDoRegistro | null>(null);
  const [superficie, trocarSuperficie] = useUltimaSuperficie();
  const [pendente, setPendente] = useState<DesfechoCatalogo | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [fase, setFase] = useState<EstadoDoEnvio['fase'] | 'inativo'>('inativo');
  const [prazoEm, setPrazoEm] = useState(0);
  const [restaMs, setRestaMs] = useState(ESPERA_DESFAZER_MS);
  /**
   * A contagem do desfazer PAROU porque a pessoa tocou em alguma coisa no recibo.
   *
   * É a mesma regra do recibo da tela de ligação, e existe pelo mesmo motivo: os 5
   * segundos são o pagamento de quem não vai fazer nada, e para quem TOCOU eles eram
   * um sequestro — abrir "Anotar" e ver o "Desfazer" sumir no meio da frase, sem
   * aviso. Parou, não volta a andar: quem começou a escrever decide quando o registro
   * sobe, no botão que já está na tela (laudo §3.12k).
   */
  const [pausado, setPausado] = useState(false);
  const [resultado, setResultado] = useState<EstadoDoEnvio | null>(null);
  const [fila, setFila] = useState<readonly RegistroNaFila[]>([]);
  const [drenando, setDrenando] = useState(false);

  // `?org=` é resolvido aqui, e não no servidor, porque a hidratação do alvo (negócio,
  // etapa, janela de recontato) é a mesma consulta que a busca usa — um caminho só.
  const daUrl = useQuery({
    queryKey: ['registro', 'alvo', organizacaoInicial],
    queryFn: () => carregarAlvo(organizacaoInicial ?? ''),
    enabled: organizacaoInicial !== null,
    staleTime: 30_000,
  });
  // `?org=` vale UMA vez: depois que ela troca de parceiro (ou registra e começa
  // outro), o parâmetro na barra de endereço não pode arrastá-la de volta.
  const [urlValendo, setUrlValendo] = useState(organizacaoInicial !== null);
  const alvoAtual = alvo ?? (urlValendo ? (daUrl.data ?? null) : null);

  const rascunhoRef = useRef<Rascunho | null>(null);
  const faseRef = useRef<EstadoDoEnvio['fase'] | 'inativo'>('inativo');
  const pausadoRef = useRef(false);
  rascunhoRef.current = rascunho;
  faseRef.current = fase;
  pausadoRef.current = pausado;

  /**
   * A fila sobe sozinha: ao abrir a tela, quando a rede volta, quando ela traz o app
   * de volta para a frente e a cada `INTERVALO_DRENO_MS`.
   *
   * O relógio existe porque `online` mente: o Android dispara o evento quando associa
   * ao Wi-Fi do salão, muito antes de haver rota até a internet, e um celular que
   * atravessa a rua entre duas visitas pode não disparar evento nenhum. O item na
   * janela do desfazer é pulado dentro da fila (`enviarApos`), então nada disso
   * atropela o "Desfazer".
   */
  const prazoDaFila = useRef<number | null>(null);
  const subirFilaRef = useRef<() => Promise<void>>(async () => {});

  const subirFila = useCallback(async () => {
    setDrenando(true);
    try {
      /**
       * O registro que está na mão COM a contagem parada não sobe pelo dreno: o
       * "Desfazer" está na tela e ainda vale. Sem isto, parar a contagem só adiava o
       * envio até o próximo tique do relógio da fila, e o botão passava a mentir
       * (laudo §3.12k). Todo o resto sobe normalmente.
       */
      const segurado =
        pausadoRef.current && faseRef.current === 'segurando'
          ? (rascunhoRef.current?.clientKey ?? null)
          : null;
      const { enviados } = await drenarFila(undefined, segurado);
      if (enviados > 0) {
        toast.success(
          enviados === 1
            ? 'Um registro guardado subiu.'
            : `${enviados} registros guardados subiram.`,
        );
        void clienteDeConsultas.invalidateQueries({ queryKey: ['registro'] });
      }
    } finally {
      const restante = lerFila();
      setFila(restante);
      setDrenando(false);

      /**
       * Órfão de tombo: item cujo prazo do desfazer ainda não venceu e que NÃO é o
       * registro em curso — a aba que o criou morreu dentro dos 5 segundos. Sem este
       * despertador ele esperaria o próximo tique de `INTERVALO_DRENO_MS` (até 20 s
       * olhando para a caixa de "guardado"). Aqui ele sobe no segundo em que pode.
       */
      const daMao = rascunhoRef.current?.clientKey;
      const prazos = restante
        .filter((i) => !i.esgotado && i.clientKey !== daMao)
        .map((i) => Date.parse(i.enviarApos) - Date.now())
        .filter((ms) => ms > 0);
      if (prazoDaFila.current !== null) window.clearTimeout(prazoDaFila.current);
      prazoDaFila.current =
        prazos.length > 0
          ? window.setTimeout(() => void subirFilaRef.current(), Math.min(...prazos) + 50)
          : null;
    }
  }, [clienteDeConsultas]);
  subirFilaRef.current = subirFila;

  useEffect(() => {
    const subir = () => void subirFila();
    subir();
    const aoVoltarParaAFrente = () => {
      if (document.visibilityState === 'visible') subir();
    };
    window.addEventListener('online', subir);
    document.addEventListener('visibilitychange', aoVoltarParaAFrente);
    const relogio = window.setInterval(subir, INTERVALO_DRENO_MS);
    return () => {
      window.removeEventListener('online', subir);
      document.removeEventListener('visibilitychange', aoVoltarParaAFrente);
      window.clearInterval(relogio);
      if (prazoDaFila.current !== null) window.clearTimeout(prazoDaFila.current);
    };
  }, [subirFila]);

  function tentarDeNovo() {
    reativarEsgotados();
    setFila(lerFila());
    void subirFila();
  }

  function descartar(clientKey: string) {
    removerDaFila(clientKey);
    setFila(lerFila());
  }

  const enviar = useCallback(async () => {
    const atual = rascunhoRef.current;
    if (!atual || faseRef.current === 'enviando' || faseRef.current === 'gravado') return;

    /**
     * Só pinta a resposta se a tela ainda estiver mostrando ESTE registro.
     *
     * "Registrar outro" dispara o envio e limpa a tela no mesmo gesto: sem esta
     * guarda, a resposta que chega meio segundo depois traria de volta o recibo de
     * um parceiro que ela já deixou para trás, por cima do próximo registro. O
     * registro em si não se perde: ele já foi mandado.
     */
    const aindaNaTela = () => rascunhoRef.current?.clientKey === atual.clientKey;

    setFase('enviando');

    let pedido;
    try {
      pedido = pedidoDoRascunho(atual);
    } catch {
      removerDaFila(atual.clientKey);
      setFila(lerFila());
      if (aindaNaTela()) {
        setFase('recusado');
        setResultado({ fase: 'recusado', frase: 'Faltou um dado obrigatório deste resultado.' });
      }
      return;
    }

    try {
      const resposta = await gravarRegistro(pedido);
      if (resposta.registrado) {
        // Gravou: é o único caminho em que o item some da fila sem ninguém decidir.
        removerDaFila(pedido.clientKey);
        setFila(lerFila());
        if (aindaNaTela()) {
          setFase('gravado');
          setResultado({ fase: 'gravado', resultado: resposta });
        }
        void clienteDeConsultas.invalidateQueries({ queryKey: ['registro'] });
        router.refresh();
      } else {
        // Recusa prevista: o servidor decidiu e reenviar daria a mesma resposta. Sai
        // da fila porque ela ESTÁ VENDO o motivo agora — no recibo ou no aviso. O que
        // não pode sumir é o que ninguém viu, e disso cuida `drenarFila`, que em vez
        // de descartar marca o item e o deixa na tela.
        removerDaFila(pedido.clientKey);
        setFila(lerFila());
        const frase = fraseDaRecusa(resposta);
        if (aindaNaTela()) {
          setFase('recusado');
          setResultado({ fase: 'recusado', frase });
        } else {
          toast.error(frase, { description: atual.alvo.nome });
        }
      }
    } catch (erro) {
      const repetivel = erro instanceof ErroDeRegistro ? erro.podeTentarDeNovo : true;
      const frase =
        erro instanceof ErroDeRegistro
          ? erro.message
          : 'Não deu para falar com o servidor. Guardei aqui e mando quando a rede voltar.';
      // O pedido JÁ está guardado desde o toque no desfecho; aqui só se anota o que
      // aconteceu. Erro que não vale repetir sozinho (sessão vencida) fica marcado e
      // aparece na caixa de "não subiu", com o botão de tentar de novo depois do login.
      anotarFalha(pedido.clientKey, frase, !repetivel);
      setFila(lerFila());
      if (aindaNaTela() && repetivel) {
        setFase('guardado');
        setResultado({ fase: 'guardado', frase });
      } else if (aindaNaTela()) {
        setFase('recusado');
        setResultado({ fase: 'recusado', frase });
      } else {
        toast.error(frase, { description: atual.alvo.nome });
      }
    }
  }, [clienteDeConsultas, router]);

  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;

  // A contagem regressiva. Quem chega ao fim dispara o envio.
  useEffect(() => {
    if (fase !== 'segurando' || pausado) return;
    const id = window.setInterval(() => {
      const resta = prazoEm - Date.now();
      if (resta <= 0) {
        window.clearInterval(id);
        void enviarRef.current();
      } else {
        setRestaMs(resta);
      }
    }, 150);
    return () => window.clearInterval(id);
  }, [fase, prazoEm, pausado]);

  // Sair da tela com um registro segurado não pode perdê-lo: quem some, envia.
  useEffect(
    () => () => {
      if (faseRef.current === 'segurando') void enviarRef.current();
    },
    [],
  );

  function escolherAlvo(escolhido: AlvoDoRegistro) {
    setUrlValendo(false);
    setAlvo(escolhido);
    setResultado(null);
    setFase('inativo');
  }

  function escolherDesfecho(desfecho: DesfechoCatalogo) {
    if (precisaDeExtra(desfecho)) {
      setPendente(desfecho);
      return;
    }
    comprometer(desfecho, EXTRAS_VAZIOS);
  }

  /**
   * O commit: guarda o pedido no aparelho, pinta o recibo e começa a contagem.
   *
   * A ORDEM importa e é a resposta ao registro que sumia: primeiro `guardarPendente`,
   * depois o recibo, e só cinco segundos depois a rede. Antes, o pedido só existia na
   * memória da aba durante a janela do desfazer — aba fechada ali dentro, trabalho
   * perdido sem aviso.
   */
  function comprometer(desfecho: DesfechoCatalogo, extras: ValoresExtras) {
    const alvoDoRegistro = alvoAtual;
    if (!alvoDoRegistro) return;
    // Segunda barreira, junto da lista já filtrada do passo 2: nenhum caminho da tela
    // (link direto, catálogo recarregado, corrida entre telas) grava contato ativo em
    // cima de quem pediu para parar.
    if (alvoDoRegistro.naoContatar && !valeParaQuemPediuParar(desfecho)) {
      setPendente(null);
      toast.error('Este parceiro pediu para não ser contatado.', {
        description: `"${desfecho.name}" registraria um contato que não pode acontecer.`,
      });
      return;
    }
    const ocorridoEm = new Date();
    const comQuem = comQuemPadrao(desfecho);
    const base = preverRegistro(desfecho, {
      ocorridoEm,
      comQuem,
      temperaturaAtual: alvoDoRegistro.temperatura,
      etapasAlvo: contexto.etapasAlvo,
      pipelineId: alvoDoRegistro.pipelineId,
      feriados: contexto.feriados,
    });
    // A data que a pessoa acabou de dar vale mais do que a régua: é a data combinada
    // com o parceiro (`SLUGS_QUE_PEDEM_DATA`), e é por isso que a folha a pediu.
    const combinada = extras.proximaAcaoEm ?? extras.reuniaoEm;
    const previsao: PrevisaoRegistro = combinada ? { ...base, proximaAcaoEm: combinada } : base;

    const novo: Rascunho = {
      alvo: alvoDoRegistro,
      desfecho,
      superficie,
      comQuem,
      observacao: '',
      ocorridoEm,
      previsao,
      extras,
      clientKey: crypto.randomUUID(),
    };

    let guardou = false;
    try {
      guardou = guardarPendente(pedidoDoRascunho(novo), {
        parceiro: alvoDoRegistro.nome,
        desfecho: desfecho.name,
      });
    } catch {
      // Zod recusou o pedido: falta um campo do ramo, e a folha extra é que devia ter
      // pedido. Nada foi gravado e nada foi guardado; o envio vai dar a mesma coisa e
      // o recibo mostra a frase.
      guardou = false;
    }
    // Aparelho sem `localStorage` (aba privada, cota cheia): dá para registrar, mas o
    // registro depende desta aba até subir. Ela precisa saber, e é uma frase só.
    if (!guardou) {
      toast.warning('Este aparelho não deixou guardar o registro.', {
        description: 'Fique nesta tela até ele subir.',
      });
    }

    setPendente(null);
    setRascunho(novo);
    setFila(lerFila());
    setResultado(null);
    setRestaMs(ESPERA_DESFAZER_MS);
    setPrazoEm(Date.now() + ESPERA_DESFAZER_MS);
    setPausado(false);
    setFase('segurando');
  }

  function desfazer() {
    // Desfazer é uma das três saídas legítimas da fila; as outras duas são gravar e
    // descartar na mão.
    if (rascunhoRef.current) removerDaFila(rascunhoRef.current.clientKey);
    setFila(lerFila());
    setFase('inativo');
    setPausado(false);
    setRascunho(null);
    setResultado(null);
  }

  function registrarOutro() {
    // Segurando, com ou sem a contagem parada: sair daqui MANDA. É a saída que a
    // frase do recibo promete para quem parou a contagem por ter tocado em algo.
    if (faseRef.current === 'segurando') void enviarRef.current();
    setFase('inativo');
    setPausado(false);
    setRascunho(null);
    setResultado(null);
    setAlvo(null);
    setUrlValendo(false);
    void clienteDeConsultas.invalidateQueries({ queryKey: ['registro'] });
  }

  /**
   * As três correções do recibo: no rascunho enquanto está segurado, no banco depois.
   *
   * Enquanto está segurado a correção também vai para a fila: o pedido guardado tem de
   * ser o que ela está vendo, senão um tombo depois da correção subiria a versão de
   * antes dela.
   */
  function reescreverGuardado(r: Rascunho | null) {
    if (!r || faseRef.current !== 'segurando') return;
    try {
      atualizarPedidoGuardado(pedidoDoRascunho(r));
    } catch {
      // Correção que deixa o pedido inválido não apaga o que já está guardado.
    }
  }

  function ajustarComQuem(valor: ComQuem) {
    setRascunho((r) => {
      const novo = r ? { ...r, comQuem: valor } : r;
      reescreverGuardado(novo);
      return novo;
    });
    if (resultado?.fase === 'gravado') {
      void corrigirComQuem(resultado.resultado.activity_id, valor).catch((erro: unknown) =>
        toast.error(erro instanceof Error ? erro.message : 'Não deu para corrigir.'),
      );
    }
  }

  function ajustarObservacao(texto: string) {
    setRascunho((r) => {
      const novo = r ? { ...r, observacao: texto } : r;
      reescreverGuardado(novo);
      return novo;
    });
    if (resultado?.fase === 'gravado') {
      void anotarNaAtividade(resultado.resultado.activity_id, texto).catch((erro: unknown) =>
        toast.error(erro instanceof Error ? erro.message : 'Não deu para anotar.'),
      );
    }
  }

  function ajustarProximaAcao(iso: string) {
    setRascunho((r) => {
      const novo = r ? { ...r, previsao: { ...r.previsao, proximaAcaoEm: iso } } : r;
      reescreverGuardado(novo);
      return novo;
    });
    if (resultado?.fase === 'gravado' && resultado.resultado.task_id) {
      void remarcarProximaAcao(resultado.resultado.task_id, iso).catch((erro: unknown) =>
        toast.error(erro instanceof Error ? erro.message : 'Não deu para remarcar.'),
      );
    }
  }

  // A fase manda; `resultado` só carrega o que a fase final precisa mostrar.
  const estado: EstadoDoEnvio =
    fase === 'segurando' ? { fase: 'segurando', restaMs } : (resultado ?? { fase: 'enviando' });

  /**
   * A caixa da fila acompanha os três passos: o que não subiu tem de ser visível onde
   * quer que ela esteja. O registro que está na mão (segurado ou acabado de mandar)
   * fica de fora — ele já tem recibo, e apareceria duas vezes.
   */
  const guardados = fila.filter((item) => item.clientKey !== rascunho?.clientKey);
  const caixaDaFila = (
    <FilaGuardada
      itens={guardados}
      drenando={drenando}
      aoTentar={tentarDeNovo}
      aoDescartar={descartar}
    />
  );

  if (rascunho && fase !== 'inativo') {
    return (
      <>
        {caixaDaFila}
        <Recibo
          alvo={rascunho.alvo}
          desfecho={rascunho.desfecho}
          previsao={rascunho.previsao}
          estado={estado}
          comQuem={rascunho.comQuem}
          observacao={rascunho.observacao}
          pausado={pausado}
          aoPausar={() => setPausado(true)}
          aoDesfazer={desfazer}
          aoCorrigirComQuem={ajustarComQuem}
          aoAnotar={ajustarObservacao}
          aoRemarcar={ajustarProximaAcao}
          aoRegistrarOutro={registrarOutro}
        />
      </>
    );
  }

  if (!alvoAtual) {
    return (
      <>
        {caixaDaFila}
        <PassoQuem usuarioId={usuarioId} aoEscolher={escolherAlvo} />
      </>
    );
  }

  return (
    <>
      {caixaDaFila}
      <PassoOQue
        alvo={alvoAtual}
        superficie={superficie}
        aoTrocarSuperficie={trocarSuperficie}
        catalogo={contexto.catalogo}
        etapasAlvo={contexto.etapasAlvo}
        aoEscolher={escolherDesfecho}
        aoVoltar={() => {
          setUrlValendo(false);
          setAlvo(null);
        }}
      />
      <FolhaExtra
        desfecho={pendente}
        motivosPerda={contexto.motivosPerda}
        formatosDaEtapa={
          contexto.formatosDeReuniao[alvoAtual.pipelineId ?? 1] ??
          contexto.formatosDeReuniao[1] ??
          []
        }
        aoConfirmar={(valores) => {
          if (pendente) comprometer(pendente, valores);
        }}
        aoCancelar={() => setPendente(null)}
      />
    </>
  );
}
