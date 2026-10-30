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
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Mic, MicOff, Phone, PhoneOff, X } from 'lucide-react';
import { toast } from 'sonner';

import { EMPRESA } from '@/lib/empresa';
import { iniciaisDe } from '@/lib/iniciais';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { relogioDaLigacao, segundosDeConversa } from '@/components/ligacao/voz-logica';

import {
  aindaTocando,
  chamadaViva,
  fraseDoMicrofone,
  fraseDoMotivo,
  ROTULO_DA_CHAMADA,
  TOQUE_VALE_MS,
  type EstadoDaChamada,
} from './logica';
import {
  abrirChamada,
  ErroDaLigacao,
  lerChamada,
  lerTocando,
  pedirAoServidor,
  reservarChamada,
  soltarChamada,
  type ChamadaNoBanco,
} from './rpc';
import { iniciarToque } from './toque';
import { abrirMicrofone, criarOferta, responderOferta, type ConexaoDeVoz } from './webrtc';

/**
 * A ligação pelo WhatsApp, para a casca inteira.
 *
 * Mora na casca pelo mesmo motivo da Twilio (`ligacao/voz-provedor.tsx`): tem de tocar em
 * qualquer tela e sobreviver à navegação. Fora da Imova não desenha nada nem assina nada:
 * a KOMUNE continua só com a Twilio, e as duas não se tocam.
 *
 * TOCA PARA TODOS QUE ESTÃO COM O CRM ABERTO (decisão de 29/10/2026). O banco escolhe o
 * primeiro que atendeu (`wa_chamada_atender`), e o Realtime faz os outros pararem.
 * O Realtime é o caminho; a leitura de tempos em tempos é a reserva, porque ligação que
 * não toca é cliente sem resposta, e a Meta pode esconder o botão de quem não atende.
 */

export const chaveDaLigacaoNaConversa = (conversaId: string) =>
  ['ligacao-whatsapp', conversaId] as const;

type LinhaAtual = {
  id: string;
  conversaId: string;
  quem: string;
  direcao: 'recebida' | 'feita';
  estado: EstadoDaChamada;
  atendidaEm: string | null;
  encerradaEm: string | null;
  mudo: boolean;
  aviso: string | null;
};

type LigacaoWhatsapp = {
  disponivel: boolean;
  /** Esta pessoa está numa ligação pelo WhatsApp neste navegador. */
  ocupado: boolean;
  ligar(conversaId: string, nome: string): Promise<void>;
};

const SEM_LIGACAO: LigacaoWhatsapp = {
  disponivel: false,
  ocupado: false,
  ligar: async () => undefined,
};

const Contexto = createContext<LigacaoWhatsapp | null>(null);

export function useLigacaoWhatsapp(): LigacaoWhatsapp {
  return useContext(Contexto) ?? SEM_LIGACAO;
}

/** A reserva do Realtime: de quanto em quanto tempo se pergunta se algo está tocando. */
const LEITURA_DO_TOQUE_MS = 8000;
/** Durante a ligação, a reserva dos avisos da Meta. */
const LEITURA_DA_LINHA_MS = 2000;
/** Quanto a conexão de áudio tem para subir antes de atender. */
const CONEXAO_ANTES_DE_ATENDER_MS = 4000;
/** Ligação encerrada: o painel sai sozinho. */
const PAINEL_SOME_EM_MS = 3000;

export function ProvedorDaLigacaoWhatsapp({
  podeLigar,
  children,
}: {
  podeLigar: boolean;
  children: React.ReactNode;
}) {
  if (!EMPRESA.modulos.ligacaoWhatsapp || !podeLigar) return <>{children}</>;
  return <ProvedorLigado>{children}</ProvedorLigado>;
}

function ProvedorLigado({ children }: { children: React.ReactNode }) {
  const clientes = useQueryClient();
  const [tocando, setTocando] = useState<ChamadaNoBanco[]>([]);
  const [linha, setLinha] = useState<LinhaAtual | null>(null);
  const [atendendo, setAtendendo] = useState(false);
  const [, setRelogio] = useState(0);

  const conexao = useRef<ConexaoDeVoz | null>(null);
  const respostaAplicada = useRef(false);
  const trava = useRef(false);
  const dispensadas = useRef(new Set<string>());
  const linhaAtual = useRef<LinhaAtual | null>(null);
  useEffect(() => {
    linhaAtual.current = linha;
  }, [linha]);

  const atualizarConversa = useCallback(
    (conversaId: string) => {
      void clientes.invalidateQueries({ queryKey: chaveDaLigacaoNaConversa(conversaId) });
    },
    [clientes],
  );

  const fecharMidia = useCallback(() => {
    conexao.current?.fechar();
    conexao.current = null;
    respostaAplicada.current = false;
  }, []);

  /** O que o banco diz sobre a ligação que está neste navegador. */
  const aplicarNaLinha = useCallback(
    (row: ChamadaNoBanco) => {
      const atual = linhaAtual.current;
      if (!atual || atual.id !== row.id) return;
      if (row.resposta_sdp && !respostaAplicada.current && conexao.current) {
        respostaAplicada.current = true;
        void conexao.current.aplicarResposta(row.resposta_sdp).catch((e) => {
          console.error('[ligacao-whatsapp] resposta da Meta', e);
        });
      }
      if (!chamadaViva(row.estado)) fecharMidia();
      setLinha((l) =>
        l && l.id === row.id
          ? {
              ...l,
              estado: row.estado,
              atendidaEm: row.atendida_em,
              encerradaEm: row.encerrada_em,
            }
          : l,
      );
      atualizarConversa(row.conversation_id);
    },
    [atualizarConversa, fecharMidia],
  );

  const receberNoToque = useCallback((row: ChamadaNoBanco) => {
    const toca =
      row.direcao === 'recebida' &&
      row.estado === 'tocando' &&
      !dispensadas.current.has(row.id) &&
      aindaTocando(row.tocou_em, new Date());
    setTocando((lista) => {
      const sem = lista.filter((c) => c.id !== row.id);
      return toca ? [...sem, row] : sem;
    });
  }, []);

  // O Realtime: a RLS de `wa_chamadas` diz quem recebe.
  useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel(`ligacao-whatsapp-${crypto.randomUUID().slice(0, 8)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wa_chamadas' },
        (payload: { new?: unknown }) => {
          const row = payload.new as ChamadaNoBanco | undefined;
          if (!row?.id) return;
          receberNoToque(row);
          aplicarNaLinha(row);
          atualizarConversa(row.conversation_id);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wa_permissoes_de_ligar' },
        (payload: { new?: { conversation_id?: string } }) => {
          const id = payload.new?.conversation_id;
          if (id) atualizarConversa(id);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [aplicarNaLinha, atualizarConversa, receberNoToque]);

  // A reserva: o toque.
  useEffect(() => {
    const ler = () => {
      void lerTocando(new Date(Date.now() - TOQUE_VALE_MS)).then((lista) => {
        const validas = lista.filter((c) => !dispensadas.current.has(c.id));
        setTocando((antes) => {
          const iguais =
            antes.length === validas.length && antes.every((c) => validas.some((v) => v.id === c.id));
          return iguais ? antes : validas;
        });
      });
    };
    ler();
    const id = setInterval(ler, LEITURA_DO_TOQUE_MS);
    return () => clearInterval(id);
  }, []);

  // A reserva: os avisos da ligação em curso.
  const idDaLinhaViva = linha && chamadaViva(linha.estado) ? linha.id : null;
  useEffect(() => {
    if (!idDaLinhaViva) return;
    const id = setInterval(() => {
      void lerChamada(idDaLinhaViva).then((row) => {
        if (row) aplicarNaLinha(row);
      });
    }, LEITURA_DA_LINHA_MS);
    return () => clearInterval(id);
  }, [aplicarNaLinha, idDaLinhaViva]);

  // O relógio do painel, e o fim do toque que passou do prazo.
  useEffect(() => {
    if (!idDaLinhaViva && tocando.length === 0) return;
    const id = setInterval(() => {
      setRelogio((n) => n + 1);
      setTocando((lista) => {
        const validas = lista.filter((c) => aindaTocando(c.tocou_em, new Date()));
        return validas.length === lista.length ? lista : validas;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [idDaLinhaViva, tocando.length]);

  // Ligação encerrada: o painel sai sozinho, menos quando há um aviso para ler.
  const encerrouSemAviso = linha !== null && !chamadaViva(linha.estado) && linha.aviso === null;
  useEffect(() => {
    if (!encerrouSemAviso) return;
    const id = setTimeout(() => setLinha(null), PAINEL_SOME_EM_MS);
    return () => clearTimeout(id);
  }, [encerrouSemAviso]);

  // Fechar a aba no meio da ligação pede confirmação, como na Twilio.
  useEffect(() => {
    if (!idDaLinhaViva) return;
    const aoSair = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Há uma ligação em andamento. Sair desta página encerra a chamada.';
    };
    window.addEventListener('beforeunload', aoSair);
    return () => window.removeEventListener('beforeunload', aoSair);
  }, [idDaLinhaViva]);

  // O toque, com som e com o aviso do sistema quando a aba está escondida.
  const paraTocar = idDaLinhaViva === null ? tocando[0] : undefined;
  const idParaTocar = paraTocar?.id ?? null;
  const quemToca = paraTocar?.quem ?? null;
  useEffect(() => {
    if (!idParaTocar) return;
    const parar = iniciarToque();
    let aviso: Notification | null = null;
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      document.visibilityState !== 'visible'
    ) {
      aviso = new Notification(`${EMPRESA.nome}: ${quemToca} está ligando`, {
        body: 'Ligação pelo WhatsApp. Volte ao CRM para atender.',
        tag: `ligacao-${idParaTocar}`,
        requireInteraction: true,
      });
      aviso.onclick = () => window.focus();
    }
    return () => {
      parar();
      aviso?.close();
    };
  }, [idParaTocar, quemToca]);

  const caiuAConexao = useCallback(() => {
    const atual = linhaAtual.current;
    if (!atual || !chamadaViva(atual.estado)) return;
    fecharMidia();
    void pedirAoServidor('encerrar', atual.id).catch(() => undefined);
    setLinha((l) => (l ? { ...l, aviso: 'A conexão de áudio caiu. A ligação foi encerrada.' } : l));
  }, [fecharMidia]);

  const atender = useCallback(
    async (chamada: ChamadaNoBanco) => {
      if (trava.current) return;
      trava.current = true;
      setAtendendo(true);
      let reservou = false;
      try {
        const oferta = await reservarChamada(chamada.id);
        reservou = true;
        setTocando((l) => l.filter((c) => c.id !== chamada.id));
        let fluxo: MediaStream;
        try {
          fluxo = await abrirMicrofone();
        } catch (e) {
          await soltarChamada(chamada.id);
          reservou = false;
          toast.error(fraseDoMicrofone((e as { name?: string }).name));
          return;
        }
        setLinha({
          id: chamada.id,
          conversaId: chamada.conversation_id,
          quem: chamada.quem,
          direcao: 'recebida',
          estado: 'atendendo',
          atendidaEm: null,
          encerradaEm: null,
          mudo: false,
          aviso: null,
        });
        const { conexao: nova, sdp } = await responderOferta(oferta, fluxo, caiuAConexao);
        conexao.current = nova;
        // `pre_accept` sobe a conexão antes de atender, e o cliente não perde as primeiras
        // palavras. É recomendado, não obrigatório: se falhar, o `accept` ainda tenta.
        await pedirAoServidor('pre_aceitar', chamada.id, sdp).catch((e) => {
          console.warn('[ligacao-whatsapp] pre_accept', e);
        });
        await nova.esperarConectar(CONEXAO_ANTES_DE_ATENDER_MS);
        await pedirAoServidor('aceitar', chamada.id, sdp);
        // Só depois do 200 o áudio pode correr.
        nova.liberarMicrofone();
        setLinha((l) =>
          l && l.id === chamada.id
            ? { ...l, estado: 'em_curso', atendidaEm: l.atendidaEm ?? new Date().toISOString() }
            : l,
        );
      } catch (e) {
        fecharMidia();
        const erro = e instanceof ErroDaLigacao ? e : null;
        const frase = erro?.frase ?? fraseDoMotivo(erro?.motivo);
        if (reservou) {
          setLinha((l) =>
            l && l.id === chamada.id ? { ...l, estado: 'falhou', aviso: frase } : l,
          );
          void pedirAoServidor('encerrar', chamada.id).catch(() => undefined);
        } else {
          setTocando((l) => l.filter((c) => c.id !== chamada.id));
          toast.error(frase);
        }
      } finally {
        trava.current = false;
        setAtendendo(false);
      }
    },
    [caiuAConexao, fecharMidia],
  );

  const ligar = useCallback(
    async (conversaId: string, nome: string) => {
      if (trava.current || linhaAtual.current !== null) return;
      trava.current = true;
      try {
        let fluxo: MediaStream;
        try {
          fluxo = await abrirMicrofone();
        } catch (e) {
          toast.error(fraseDoMicrofone((e as { name?: string }).name));
          return;
        }
        let id: string;
        try {
          id = await abrirChamada(conversaId);
        } catch (e) {
          for (const t of fluxo.getTracks()) t.stop();
          const erro = e instanceof ErroDaLigacao ? e : null;
          toast.error(erro?.frase ?? fraseDoMotivo(erro?.motivo));
          atualizarConversa(conversaId);
          return;
        }
        setLinha({
          id,
          conversaId,
          quem: nome,
          direcao: 'feita',
          estado: 'discando',
          atendidaEm: null,
          encerradaEm: null,
          mudo: false,
          aviso: null,
        });
        try {
          const { conexao: nova, sdp } = await criarOferta(fluxo, caiuAConexao);
          conexao.current = nova;
          await pedirAoServidor('ligar', id, sdp);
        } catch (e) {
          fecharMidia();
          const erro = e instanceof ErroDaLigacao ? e : null;
          const frase = erro?.frase ?? fraseDoMotivo(erro?.motivo);
          setLinha((l) => (l && l.id === id ? { ...l, estado: 'falhou', aviso: frase } : l));
          atualizarConversa(conversaId);
        }
      } finally {
        trava.current = false;
      }
    },
    [atualizarConversa, caiuAConexao, fecharMidia],
  );

  const desligar = useCallback(() => {
    const atual = linhaAtual.current;
    if (!atual) return;
    fecharMidia();
    setLinha((l) => (l ? { ...l, estado: 'encerrada', encerradaEm: new Date().toISOString() } : l));
    void pedirAoServidor('encerrar', atual.id).catch((e) => {
      console.error('[ligacao-whatsapp] encerrar', e);
    });
  }, [fecharMidia]);

  const alternarMudo = useCallback(() => {
    setLinha((l) => {
      if (!l) return l;
      conexao.current?.silenciar(!l.mudo);
      return { ...l, mudo: !l.mudo };
    });
  }, []);

  const ignorar = useCallback((id: string) => {
    dispensadas.current.add(id);
    setTocando((l) => l.filter((c) => c.id !== id));
  }, []);

  const valor = useMemo<LigacaoWhatsapp>(
    () => ({ disponivel: true, ocupado: idDaLinhaViva !== null, ligar }),
    [idDaLinhaViva, ligar],
  );

  return (
    <Contexto.Provider value={valor}>
      {children}
      {linha ? (
        <PainelDaLinha
          linha={linha}
          aoDesligar={desligar}
          aoAlternarMudo={alternarMudo}
          aoDispensar={() => setLinha(null)}
        />
      ) : paraTocar ? (
        <PainelDoToque
          chamada={paraTocar}
          outras={tocando.length - 1}
          atendendo={atendendo}
          aoAtender={() => void atender(paraTocar)}
          aoIgnorar={() => ignorar(paraTocar.id)}
        />
      ) : null}
    </Contexto.Provider>
  );
}

const CLASSE_DO_PAINEL =
  'sombra-base-forte fixed inset-x-3 top-[3.75rem] z-50 flex flex-col gap-2 rounded-xl border border-border bg-card px-3 py-2 text-card-foreground md:inset-x-auto md:top-2 md:left-1/2 md:w-[26rem] md:-translate-x-1/2';

function PainelDoToque({
  chamada,
  outras,
  atendendo,
  aoAtender,
  aoIgnorar,
}: {
  chamada: ChamadaNoBanco;
  outras: number;
  atendendo: boolean;
  aoAtender: () => void;
  aoIgnorar: () => void;
}) {
  return (
    <section role="alertdialog" aria-label={`${chamada.quem} está ligando`} className={CLASSE_DO_PAINEL}>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
        >
          {iniciaisDe(chamada.quem)}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium">{chamada.quem}</p>
          <p aria-live="assertive" className="text-xs text-muted-foreground">
            Ligando pelo WhatsApp{outras > 0 ? ` · mais ${outras} tocando` : ''}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="toque h-9 shrink-0" onClick={aoIgnorar}>
          Ignorar
        </Button>
        <Button type="button" size="sm" className="toque h-9 shrink-0" onClick={aoAtender} disabled={atendendo}>
          <Phone aria-hidden="true" />
          {atendendo ? 'Atendendo...' : 'Atender'}
        </Button>
      </div>
    </section>
  );
}

function PainelDaLinha({
  linha,
  aoDesligar,
  aoAlternarMudo,
  aoDispensar,
}: {
  linha: LinhaAtual;
  aoDesligar: () => void;
  aoAlternarMudo: () => void;
  aoDispensar: () => void;
}) {
  const router = useRouter();
  const viva = chamadaViva(linha.estado);
  const segundos = segundosDeConversa(linha.atendidaEm, linha.encerradaEm, new Date());

  async function abrirConversa() {
    const { data } = await createClient()
      .from('conversations')
      .select('organization_id')
      .eq('id', linha.conversaId)
      .maybeSingle();
    router.push(
      data?.organization_id
        ? `/conversas?org=${data.organization_id}`
        : `/conversas?cliente=${linha.conversaId}`,
    );
  }

  return (
    <section role="dialog" aria-label={`Ligação com ${linha.quem}`} className={CLASSE_DO_PAINEL}>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
        >
          {iniciaisDe(linha.quem)}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium">{linha.quem}</p>
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {ROTULO_DA_CHAMADA[linha.estado]}
          </p>
        </div>
        {linha.atendidaEm ? (
          <span className="numerico text-base" aria-label={`${segundos} segundos de conversa`}>
            {relogioDaLigacao(segundos)}
          </span>
        ) : null}
        {viva ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="toque size-9 shrink-0"
              onClick={() => void abrirConversa()}
              aria-label="Abrir a conversa"
              title="Abrir a conversa"
            >
              <MessageCircle aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="toque size-9 shrink-0"
              onClick={aoAlternarMudo}
              aria-pressed={linha.mudo}
              aria-label={linha.mudo ? 'Reativar o microfone' : 'Silenciar o microfone'}
              title={linha.mudo ? 'Reativar o microfone' : 'Silenciar o microfone'}
            >
              {linha.mudo ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
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
      {linha.aviso ? (
        <p role="alert" className="pb-1 text-sm text-destructive-texto">
          {linha.aviso}
        </p>
      ) : null}
    </section>
  );
}
