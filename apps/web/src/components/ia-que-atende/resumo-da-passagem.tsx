'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, ClipboardList, Hourglass, TriangleAlert } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useFio } from '@/components/conversas/contexto-do-fio';
import { ChipTemperatura } from '@/components/temperatura';

import { CHAVE_DA_IA } from './dados';
import { IA_QUE_ATENDE } from './na-conversa';
import {
  ancoraDaPassagem,
  camposDoResumo,
  equipeRespondeuDepois,
  fraseDaSituacao,
  fraseDoMotivo,
  lerPassagens,
  manchete,
  type PassagemDaIa,
  type PassagensDaConversa,
} from './resumo-da-passagem-formatos';

/**
 * O resumo da passagem (Imova, 11/11/2026).
 *
 * Pedido do usuário: quando a IA que atende passa a conversa para a equipe, "deixar um
 * resumo para o corretor não precisar ler a conversa inteira". Ele aparece em dois
 * lugares da conversa, e no aviso (o título da tarefa "A IA passou o cliente para você",
 * que o banco atualiza):
 *
 *   * NO PONTO DA PASSAGEM, embaixo do "já vou te passar" da IA (ou, quando o aviso não
 *     saiu, embaixo da última mensagem até a passagem): o resumo inteiro, para sempre,
 *     como registro do que o corretor recebeu;
 *   * NO TOPO, em destaque, enquanto ninguém da equipe respondeu depois da passagem (e a
 *     IA continua parada ali): a linha do que ele quer, a temperatura e o próximo passo,
 *     com o resto a um toque.
 *
 * O que o cliente não disse aparece como "não disse". Quem decide o que vale e o que fica
 * em destaque é o banco (`public.ia_passagens_da_conversa`); nada aqui escreve.
 *
 * Só existe com o módulo da IA que atende ligado; na KOMUNE nada disto aparece.
 */

export function chaveDasPassagens(fioId: string) {
  return [...CHAVE_DA_IA, 'passagens', fioId] as const;
}

async function carregarPassagens(fioId: string): Promise<PassagensDaConversa | null> {
  const { data, error } = await createClient().rpc(
    'ia_passagens_da_conversa' as never,
    { p_conversation_id: fioId } as never,
  );
  if (error) throw new Error(error.message);
  return lerPassagens(data);
}

function usePassagens(fioId: string) {
  return useQuery({
    queryKey: chaveDasPassagens(fioId),
    queryFn: () => carregarPassagens(fioId),
    enabled: IA_QUE_ATENDE,
    staleTime: 15_000,
    // Enquanto o resumo está sendo escrito (segundos depois da passagem), olha de novo
    // a cada 10 s; com uma passagem em destaque, a cada 30 s.
    refetchInterval: (consulta) => {
      const d = consulta.state.data;
      if (!d) return false;
      if (d.passagens.some((p) => p.situacao === 'escrevendo')) return 10_000;
      return d.destaque ? 30_000 : false;
    },
  });
}

/** "às 09:20" no fuso de Natal. */
function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Fortaleza',
  });
}

/** Os campos do resumo, o porquê e o próximo passo. */
function CamposDoResumo({ passagem }: { passagem: PassagemDaIa }) {
  const r = passagem.resumo;
  if (!r || passagem.situacao !== 'pronto') return null;
  const porque = r.porquePassou ?? fraseDoMotivo(passagem.motivo);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px] leading-snug">
      {camposDoResumo(r).map((c) => (
        <div key={c.rotulo} className="contents">
          <dt className="text-wpp-suave">{c.rotulo}</dt>
          <dd
            className={cn(
              'min-w-0 break-words',
              c.disse ? 'text-foreground' : 'text-wpp-suave italic',
            )}
          >
            {c.valor}
          </dd>
        </div>
      ))}
      <div className="contents">
        <dt className="text-wpp-suave">Temperatura</dt>
        <dd className="min-w-0 break-words text-foreground">
          {r.temperatura ? (
            <ChipTemperatura temperatura={r.temperatura} className="mr-1.5 align-middle" />
          ) : (
            <span className="text-wpp-suave italic">não deu para saber</span>
          )}
          {r.temperaturaPorque ? (
            <span className="text-wpp-suave"> {r.temperaturaPorque}</span>
          ) : null}
        </dd>
      </div>
      {porque ? (
        <div className="contents">
          <dt className="text-wpp-suave">Por que passou</dt>
          <dd className="min-w-0 break-words text-foreground">{porque}</dd>
        </div>
      ) : null}
      {r.proximoPasso ? (
        <div className="contents">
          <dt className="font-medium text-foreground">Próximo passo</dt>
          <dd className="min-w-0 font-medium break-words text-foreground">{r.proximoPasso}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/** O resumo ainda não chegou, ou não vai chegar: diz qual, e o que fazer. */
function SemResumoAinda({ passagem }: { passagem: PassagemDaIa }) {
  const motivo = fraseDoMotivo(passagem.motivo);
  const frase = fraseDaSituacao(passagem);
  if (frase === null) return null;
  const Icone = passagem.situacao === 'escrevendo' ? Hourglass : TriangleAlert;
  return (
    <p className="flex items-start gap-1.5 text-[13px] text-wpp-suave">
      <Icone className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {frase}
        {motivo ? ` ${motivo}` : ''}
      </span>
    </p>
  );
}

/**
 * Embaixo do "já vou te passar" da IA: o resumo inteiro, no ponto da passagem. Fica para
 * sempre, como registro do que o corretor recebeu. Quando o aviso não saiu (a porteira o
 * recusou), o cartão vai embaixo da última mensagem até a hora da passagem. A passagem de
 * antes desta funcionalidade não ganha cartão: a conversa antiga continua como era.
 */
export function ResumoNaMensagem({ fioId, mensagemId }: { fioId: string; mensagemId: string }) {
  const { data } = usePassagens(fioId);
  const fio = useFio();
  const daqui = useMemo(() => {
    const mensagens = fio?.mensagens ?? [];
    return (data?.passagens ?? []).filter(
      (p) =>
        p.situacao !== 'antes' &&
        (p.messageId === mensagemId ||
          (p.messageId === null && ancoraDaPassagem(mensagens, p.criadaEm) === mensagemId)),
    );
  }, [data, fio?.mensagens, mensagemId]);
  if (!IA_QUE_ATENDE || daqui.length === 0) return null;
  return (
    <>
      {[...daqui].reverse().map((passagem) => (
        <section
          key={passagem.respostaId}
          aria-label="Resumo da passagem para o corretor"
          className="flex w-full max-w-prose flex-col gap-2 rounded-lg bg-wpp-sis px-3 py-2.5 text-left text-wpp-sis-texto shadow-wpp"
        >
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
            <ClipboardList className="size-3.5 shrink-0" aria-hidden="true" />
            {passagem.simulada
              ? 'Resumo para o corretor (simulação: a IA continuou aqui)'
              : passagem.messageId === null
                ? 'Resumo para o corretor (o aviso de que ia passar não saiu)'
                : 'Resumo para o corretor'}
          </p>
          {passagem.situacao === 'pronto' ? (
            <CamposDoResumo passagem={passagem} />
          ) : (
            <SemResumoAinda passagem={passagem} />
          )}
        </section>
      ))}
    </>
  );
}

/**
 * A faixa do topo: a passagem em destaque enquanto ninguém da equipe respondeu. Mostra a
 * linha do que ele quer, a temperatura e o próximo passo; "Ver o resumo" abre o resto.
 * Some quando alguém da equipe escreve (na hora, pelo fio carregado; e pelo banco, na
 * leitura seguinte).
 */
export function FaixaDoResumoDaPassagem({
  fioId,
  className,
}: {
  fioId: string;
  className?: string;
}) {
  const { data } = usePassagens(fioId);
  const fio = useFio();
  const [aberta, setAberta] = useState(false);
  const idDoResumo = useId();
  const clientes = useQueryClient();

  // Mensagem nova da IA na conversa aberta (o "já vou te passar"): lê as passagens de
  // novo na hora, sem esperar a janela voltar ao foco nem a próxima volta do relógio.
  const ultimaDaIa = useMemo(() => {
    const mensagens = fio?.mensagens ?? [];
    for (let i = mensagens.length - 1; i >= 0; i -= 1) {
      const m = mensagens[i];
      if (m !== undefined && !m.entrada && m.autorTipo === 'bot_ai') return m.id;
    }
    return null;
  }, [fio?.mensagens]);
  const vista = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!IA_QUE_ATENDE) return;
    if (vista.current !== undefined && vista.current !== ultimaDaIa) {
      void clientes.invalidateQueries({ queryKey: chaveDasPassagens(fioId) });
    }
    vista.current = ultimaDaIa;
  }, [clientes, fioId, ultimaDaIa]);

  const passagem = data?.destaque ?? null;
  if (!IA_QUE_ATENDE || !data || !passagem) return null;
  if (fio && equipeRespondeuDepois(fio.mensagens, passagem.criadaEm)) return null;

  const r = passagem.situacao === 'pronto' ? passagem.resumo : null;
  const linha = r ? manchete(r) : null;
  const para = data.passadaPara ? ` para ${data.passadaPara}` : '';

  return (
    <section
      aria-label="A IA passou este cliente para a equipe"
      className={cn(
        'flex shrink-0 flex-col gap-1.5 border-b border-l-4 border-wpp-linha border-l-menta bg-wpp-painel2 py-2 pr-3 pl-3 text-[13px] leading-snug',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-menta text-menta-tinta">
          <ClipboardList className="size-3.5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-wpp-suave">
            <span className="font-medium text-foreground">
              A IA passou este cliente{para} às {hora(passagem.criadaEm)}.
            </span>{' '}
            Ninguém da equipe respondeu ainda.
          </p>
          {r ? (
            <>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-foreground">
                {r.temperatura ? <ChipTemperatura temperatura={r.temperatura} /> : null}
                <span className={cn('min-w-0 break-words', !linha && 'text-wpp-suave italic')}>
                  {linha ?? 'O cliente não disse o que procura nem o orçamento.'}
                </span>
              </p>
              {r.proximoPasso ? (
                <p className="min-w-0 break-words text-foreground">
                  <span className="font-medium">Próximo passo:</span> {r.proximoPasso}
                </p>
              ) : null}
            </>
          ) : (
            <SemResumoAinda passagem={passagem} />
          )}
        </div>
        {r ? (
          <button
            type="button"
            aria-expanded={aberta}
            aria-controls={idDoResumo}
            onClick={() => setAberta((v) => !v)}
            className="toque inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-wpp-linha-forte px-3 text-[13px] text-foreground hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {aberta ? (
              <ChevronUp className="size-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-4" aria-hidden="true" />
            )}
            <span className="max-sm:sr-only">{aberta ? 'Esconder' : 'Ver o resumo'}</span>
          </button>
        ) : null}
      </div>
      {r && aberta ? (
        <div id={idDoResumo} className="pl-8.5">
          <CamposDoResumo passagem={passagem} />
        </div>
      ) : null}
    </section>
  );
}
