'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Mic, MicOff, PhoneOff, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { iniciaisDe } from '@/lib/iniciais';
import { Button } from '@/components/ui/button';

import {
  avisoDaFalha,
  avisoDaRecusa,
  classificarFalha,
  codigoParaDiagnostico,
  estadoAoDesligar,
  juntarEstados,
  linhaFoiAtendida,
  linhaViva,
  relogioDaLigacao,
  ROTULO_DA_LINHA,
  segundosDeConversa,
  type AvisoDeVoz,
  type EstadoDaLinha,
} from './voz-logica';
import {
  abrirLigacaoDeVoz,
  encerrarLigacaoDeVoz,
  ErroDeCredencial,
  lerLinha,
  telefoniaLigada,
} from './voz-rpc';
import {
  conectar,
  descartarAparelho,
  pedirMicrofone,
  type LigacaoNoNavegador,
} from './voz-softphone';

/**
 * A ligação pelo navegador, para a casca inteira.
 *
 * Mora na casca (`AppShell`), e não na ficha, por um motivo só: a ligação tem de
 * sobreviver à navegação. Quem está numa ligação e vai olhar o funil no meio da conversa
 * continua falando, com o painel no alto da tela.
 *
 * UMA LIGAÇÃO POR VEZ, em três camadas — nenhuma confia na outra:
 *   1. `trava` (ref, síncrona): o segundo clique no mesmo instante nem começa;
 *   2. `ocupado`: enquanto houver painel aberto, os botões "Ligar" ficam desligados;
 *   3. o índice único de `voice_calls`: outra aba, outro aparelho, não passam.
 *
 * QUEM TABULA. Ninguém aqui. Toda ligação pelo navegador é de uma TENTATIVA do módulo
 * de ligação (`call_attempts`): a do lote de turno e a da ficha, que monta um lote de
 * um contato (`montar_lote_avulso`) e abre a mesma tela. Roteiro, respostas e resultado
 * ficam naquela tela; o painel só mostra a linha, silencia e desliga.
 */

export type AlvoDaLigacao = {
  organizationId: string;
  nome: string;
  /** A tentativa aberta por `iniciar_chamada`. O banco disca o número reservado para ela. */
  attemptId: string;
};

type LigacaoEmCurso = {
  /** `null` até o banco abrir a chamada. */
  id: string | null;
  alvo: AlvoDaLigacao;
  estado: EstadoDaLinha;
  atendidaEm: string | null;
  encerradaEm: string | null;
  mudo: boolean;
  reconectando: boolean;
  /** Título e frase prontos quando algo deu errado. */
  aviso: AvisoDeVoz | null;
  /**
   * Outra ligação desta pessoa que o banco ainda dá como em curso (outra aba, ou uma
   * que ficou para trás). Ela pode encerrá-la daqui, em vez de esperar a limpeza.
   */
  presa: string | null;
};

type Softphone = {
  /** A telefonia está ligada e o papel de quem está logado pode ligar. */
  disponivel: boolean;
  /** Há ligação em curso (ou um aviso de falha ainda na tela). */
  ocupado: boolean;
  /**
   * A última ligação feita por este navegador — em curso ou já encerrada. Fica depois
   * de o painel sair, porque a tela de ligar ainda precisa dela para mostrar o estado
   * da linha e gravar a duração da CONVERSA (do atendimento ao fim), e não a do clique.
   */
  ultima: {
    alvo: AlvoDaLigacao;
    estado: EstadoDaLinha;
    atendidaEm: string | null;
    encerradaEm: string | null;
  } | null;
  ligar(alvo: AlvoDaLigacao): Promise<boolean>;
  desligar(): void;
};

const Contexto = createContext<Softphone | null>(null);

/** Fora do provedor (tela pública, teste) a telefonia simplesmente não existe. */
const SEM_SOFTPHONE: Softphone = {
  disponivel: false,
  ocupado: false,
  ultima: null,
  ligar: async () => false,
  desligar: () => undefined,
};

export function useSoftphone(): Softphone {
  return useContext(Contexto) ?? SEM_SOFTPHONE;
}

/** De quanto em quanto tempo a tela pergunta ao banco o que o provedor já avisou. */
const INTERVALO_DA_LINHA_MS = 1500;
/** Depois de desligar, o tempo que o aviso final do provedor costuma levar. */
const ESPERA_DO_AVISO_FINAL_MS = 2000;
/**
 * Quanto a tela espera o provedor pedir o número ao banco. Passou disso, a chamada
 * não saiu do navegador (rede, credencial, provedor fora do ar) e não vai sair.
 */
const LIMITE_SEM_RESPOSTA_MS = 20_000;
/** Ligação encerrada sem erro: o painel sai sozinho. */
const PAINEL_SOME_EM_MS = 3000;

export function ProvedorDoSoftphone({
  podeLigar,
  children,
}: {
  /** O papel escreve no CRM (`app.can_write()`); o banco confere de novo. */
  podeLigar: boolean;
  children: React.ReactNode;
}) {
  const [ligada, setLigada] = useState(false);
  const [ligacao, setLigacao] = useState<LigacaoEmCurso | null>(null);
  /** O painel está na tela. O dado da ligação fica mesmo depois de ele sair. */
  const [painel, setPainel] = useState(false);
  const [, setTique] = useState(0);
  const trava = useRef(false);
  const noNavegador = useRef<LigacaoNoNavegador | null>(null);
  const falha = useRef<{ nome: string | null; codigo: number | null } | null>(null);
  /** A chamada que o painel está mostrando. `null` depois de dispensada. */
  const idNoPainel = useRef<string | null>(null);

  useEffect(() => {
    if (!podeLigar) return;
    let vivo = true;
    void telefoniaLigada().then((sim) => {
      if (vivo) setLigada(sim);
    });
    return () => {
      vivo = false;
    };
  }, [podeLigar]);

  const dispensar = useCallback(() => {
    noNavegador.current = null;
    falha.current = null;
    trava.current = false;
    idNoPainel.current = null;
    setPainel(false);
  }, []);

  const falhar = useCallback((aviso: AvisoDeVoz) => {
    setLigacao((atual) =>
      atual
        ? { ...atual, estado: estadoAoDesligar(atual.estado, true), aviso, reconectando: false }
        : atual,
    );
  }, []);

  const ligar = useCallback(
    async (alvo: AlvoDaLigacao): Promise<boolean> => {
      if (trava.current) return false;
      trava.current = true;
      falha.current = null;
      setPainel(true);
      setLigacao({
        id: null,
        alvo,
        estado: 'preparando',
        atendidaEm: null,
        encerradaEm: null,
        mudo: false,
        reconectando: false,
        aviso: null,
        presa: null,
      });

      // 1. O microfone, antes de qualquer coisa existir no banco.
      try {
        await pedirMicrofone();
      } catch (erro) {
        const e = erro as { name?: string };
        falhar(avisoDaFalha(classificarFalha({ nome: e?.name ?? null })));
        return false;
      }

      // 2. O banco abre a chamada — e é ele que aplica as travas.
      const abertura = await abrirLigacaoDeVoz({ attemptId: alvo.attemptId });
      if (!abertura.ok) {
        falhar(avisoDaRecusa(abertura.motivo));
        const presa = abertura.motivo === 'ja_em_ligacao' ? (abertura.ligacao_id ?? null) : null;
        if (presa) setLigacao((atual) => (atual ? { ...atual, presa } : atual));
        return false;
      }
      const id = abertura.ligacao.id;
      idNoPainel.current = id;
      setLigacao((atual) => (atual ? { ...atual, id } : atual));

      // 3. O navegador conecta ao provedor, que pergunta ao banco para quem discar.
      try {
        noNavegador.current = await conectar(id, {
          aoConectar: () =>
            setLigacao((atual) =>
              atual && atual.id === id
                ? { ...atual, estado: juntarEstados(atual.estado, 'chamando') }
                : atual,
            ),
          aoErro: (erro) => {
            falha.current = erro;
          },
          aoReconectar: (tentando) =>
            setLigacao((atual) =>
              atual && atual.id === id ? { ...atual, reconectando: tentando } : atual,
            ),
          aoDesligar: () => {
            const erro = falha.current;
            noNavegador.current = null;
            setLigacao((atual) =>
              atual && atual.id === id
                ? {
                    ...atual,
                    estado: estadoAoDesligar(atual.estado, erro !== null),
                    encerradaEm: atual.encerradaEm ?? new Date().toISOString(),
                    reconectando: false,
                    aviso: erro ? avisoDaFalha(classificarFalha(erro)) : atual.aviso,
                  }
                : atual,
            );
            void encerrarLigacaoDeVoz(id, {
              falha: erro !== null,
              codigo: erro ? codigoParaDiagnostico(erro) : null,
            });
            // O aviso final do provedor (duração medida, "não atendeu", "ocupado")
            // chega logo depois; uma leitura a mais acerta o que a tela mostrou.
            window.setTimeout(() => {
              void lerLinha(id).then((lida) => {
                if (!lida) return;
                setLigacao((atual) =>
                  atual && atual.id === id
                    ? {
                        ...atual,
                        estado: juntarEstados(atual.estado, lida.estado),
                        atendidaEm: lida.atendidaEm ?? atual.atendidaEm,
                        encerradaEm: lida.encerradaEm ?? atual.encerradaEm,
                      }
                    : atual,
                );
              });
            }, ESPERA_DO_AVISO_FINAL_MS);
          },
        });
        // Desligaram enquanto o navegador ainda conectava: a chamada não pode seguir muda.
        if (idNoPainel.current !== id) {
          noNavegador.current?.desligar();
          noNavegador.current = null;
          return false;
        }
        return true;
      } catch (erro) {
        const lido = erro as { name?: string; code?: number };
        const tecnico = { nome: lido?.name ?? null, codigo: lido?.code ?? null };
        await encerrarLigacaoDeVoz(id, { falha: true, codigo: codigoParaDiagnostico(tecnico) });
        descartarAparelho();
        falhar(
          erro instanceof ErroDeCredencial
            ? avisoDaRecusa(erro.motivo)
            : avisoDaFalha(classificarFalha(tecnico)),
        );
        return false;
      }
    },
    [falhar],
  );

  const desligar = useCallback(() => {
    if (noNavegador.current) {
      noNavegador.current.desligar();
      return;
    }
    // Ainda conectando: não há o que desligar no navegador, só a chamada no banco.
    setLigacao((atual) => {
      if (!atual || !linhaViva(atual.estado)) return atual;
      if (atual.id) void encerrarLigacaoDeVoz(atual.id);
      return { ...atual, estado: estadoAoDesligar(atual.estado, false) };
    });
    dispensar();
  }, [dispensar]);

  const alternarMudo = useCallback(() => {
    setLigacao((atual) => {
      if (!atual) return atual;
      noNavegador.current?.silenciar(!atual.mudo);
      return { ...atual, mudo: !atual.mudo };
    });
  }, []);

  // A linha, vista pelo provedor: tocou, atendeu, acabou.
  const idVivo = ligacao?.id && linhaViva(ligacao.estado) ? ligacao.id : null;
  useEffect(() => {
    if (!idVivo) return;
    const relogio = window.setInterval(() => {
      void lerLinha(idVivo).then((lida) => {
        if (!lida) return;
        // O provedor já encerrou e o navegador ainda não percebeu: desliga aqui.
        if (!linhaViva(lida.estado)) noNavegador.current?.desligar();
        setLigacao((atual) =>
          atual && atual.id === idVivo
            ? {
                ...atual,
                estado: juntarEstados(atual.estado, lida.estado),
                atendidaEm: lida.atendidaEm ?? atual.atendidaEm,
                encerradaEm: lida.encerradaEm ?? atual.encerradaEm,
              }
            : atual,
        );
      });
    }, INTERVALO_DA_LINHA_MS);
    return () => window.clearInterval(relogio);
  }, [idVivo]);

  // Sem resposta do provedor: a chamada não saiu do navegador.
  const idEsperando = ligacao?.id && ligacao.estado === 'preparando' ? ligacao.id : null;
  useEffect(() => {
    if (!idEsperando) return;
    const limite = window.setTimeout(() => {
      falha.current = falha.current ?? { nome: 'sem_resposta_do_provedor', codigo: 31005 };
      if (noNavegador.current) {
        noNavegador.current.desligar();
      } else {
        void encerrarLigacaoDeVoz(idEsperando, { falha: true, codigo: 'sem_resposta_do_provedor' });
        falhar(avisoDaFalha('sem_conexao'));
      }
    }, LIMITE_SEM_RESPOSTA_MS);
    return () => window.clearTimeout(limite);
  }, [idEsperando, falhar]);

  // O cronômetro só corre em conversa.
  const emConversa = ligacao?.estado === 'em_ligacao';
  useEffect(() => {
    if (!emConversa) return;
    const relogio = window.setInterval(() => setTique((t) => t + 1), 1000);
    return () => window.clearInterval(relogio);
  }, [emConversa]);

  // Terminou sem erro: o resultado é dado na tela de ligar, e o painel sai da frente.
  const someSozinho =
    painel && ligacao !== null && !linhaViva(ligacao.estado) && ligacao.aviso === null;
  useEffect(() => {
    if (!someSozinho) return;
    const espera = window.setTimeout(dispensar, PAINEL_SOME_EM_MS);
    return () => window.clearTimeout(espera);
  }, [someSozinho, dispensar]);

  const valor = useMemo<Softphone>(
    () => ({
      disponivel: podeLigar && ligada,
      ocupado: painel,
      ultima: ligacao
        ? {
            alvo: ligacao.alvo,
            estado: ligacao.estado,
            atendidaEm: ligacao.atendidaEm,
            encerradaEm: ligacao.encerradaEm,
          }
        : null,
      ligar,
      desligar,
    }),
    [podeLigar, ligada, ligacao, painel, ligar, desligar],
  );

  return (
    <Contexto.Provider value={valor}>
      {children}
      {painel && ligacao ? (
        <PainelDaLigacao
          ligacao={ligacao}
          aoDesligar={desligar}
          aoAlternarMudo={alternarMudo}
          aoDispensar={dispensar}
        />
      ) : null}
    </Contexto.Provider>
  );
}

/**
 * O painel é uma faixa no ALTO da tela, e não um cartão no canto de baixo: embaixo ficam
 * a barra de resultado da tela de ligar e a navegação do celular, e um cartão ali
 * cobria o último botão de resultado (medido em 1280×900). No desktop ela ocupa o meio
 * do cabeçalho, que é vazio; no celular fica logo abaixo dele.
 */
function PainelDaLigacao({
  ligacao,
  aoDesligar,
  aoAlternarMudo,
  aoDispensar,
}: {
  ligacao: LigacaoEmCurso;
  aoDesligar: () => void;
  aoAlternarMudo: () => void;
  aoDispensar: () => void;
}) {
  const viva = linhaViva(ligacao.estado);
  const segundos = segundosDeConversa(ligacao.atendidaEm, ligacao.encerradaEm, new Date());
  const atendida = linhaFoiAtendida(ligacao.estado, ligacao.atendidaEm);

  return (
    <section
      role="dialog"
      aria-label={`Ligação para ${ligacao.alvo.nome}`}
      className="sombra-base-forte fixed inset-x-3 top-[3.75rem] z-50 flex flex-col gap-2 rounded-xl border border-border bg-card px-3 py-2 text-card-foreground md:inset-x-auto md:top-2 md:left-1/2 md:w-[26rem] md:-translate-x-1/2"
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
        >
          {iniciaisDe(ligacao.alvo.nome)}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium">{ligacao.alvo.nome}</p>
          <p aria-live="polite" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                'size-2 rounded-full',
                ligacao.estado === 'em_ligacao'
                  ? 'bg-quente'
                  : viva
                    ? 'bg-morno'
                    : 'bg-muted-foreground',
              )}
            />
            {ligacao.reconectando ? 'Reconectando...' : ROTULO_DA_LINHA[ligacao.estado]}
          </p>
        </div>

        {atendida ? (
          <span className="numerico text-base" aria-label={`${segundos} segundos de conversa`}>
            {relogioDaLigacao(segundos)}
          </span>
        ) : null}

        {viva ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="toque h-9 shrink-0"
              onClick={aoAlternarMudo}
              disabled={ligacao.id === null}
              aria-pressed={ligacao.mudo}
            >
              {ligacao.mudo ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
              {ligacao.mudo ? 'Reativar som' : 'Silenciar'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="toque h-9 shrink-0"
              onClick={aoDesligar}
            >
              <PhoneOff aria-hidden="true" />
              Desligar
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="toque size-9 shrink-0"
            onClick={aoDispensar}
            aria-label="Fechar"
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>

      {ligacao.aviso ? (
        <div role="alert" className="flex flex-col gap-0.5 pb-1 text-sm">
          <p className="font-medium text-destructive-texto">{ligacao.aviso.titulo}</p>
          <p className="text-muted-foreground">{ligacao.aviso.frase}</p>
        </div>
      ) : null}

      {ligacao.presa ? (
        <Button
          type="button"
          variant="outline"
          className="toque mb-1 h-10"
          onClick={() => {
            const presa = ligacao.presa;
            if (presa) void encerrarLigacaoDeVoz(presa).then(aoDispensar);
          }}
        >
          <PhoneOff aria-hidden="true" />
          Encerrar a ligação anterior
        </Button>
      ) : null}
    </section>
  );
}
