'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pin, Settings2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { iniciaisDe } from '@/lib/iniciais';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { chaveDoDia, hora, rotuloDoDia } from '@/components/conversas/formatos';
import { useRolagemNoFim } from '@/components/conversas/rolagem-no-fim';

import { CaixaDoGrupo } from './caixa-do-grupo';
import {
  CHAVE_DOS_GRUPOS,
  carregarAcoes,
  carregarFio,
  chaveDasAcoes,
  chaveDoFio,
  pedir,
  urlDoArquivo,
} from './dados';
import { BalaoDoGrupo, EventoDoGrupo } from './mensagem-do-grupo';
import { PainelDoGrupo } from './painel-do-grupo';
import {
  AVISO_DA_CONTA_OFICIAL,
  JANELA_FECHADA,
  contarPessoas,
  fraseDaFila,
  janelaDoGrupo,
  montarFio,
  quemMandou,
  resumoDaMensagem,
  situacaoDasAcoes,
  temPedidoNaFila,
} from './regras';
import {
  TETO_DE_PESSOAS,
  type GrupoCru,
  type MensagemDoGrupoCrua,
  type PessoaDoTime,
} from './tipos';

/** Sem eco, o fio pergunta de 20 em 20 s. Com pedido na fila, a fila de 4 em 4. */
const RITMO_SEM_ECO_MS = 20_000;
/**
 * Com o painel aberto, o fio pergunta de 15 em 15 s mesmo com o eco de pé: os
 * pedidos para entrar (`wa_grupo_pedidos`) não estão no Realtime, e o webhook
 * que os grava não mexe em `wa_grupos`, então nenhum evento avisa que chegou um.
 */
const RITMO_DO_PAINEL_MS = 15_000;
const RITMO_DA_FILA_MS = 4_000;

/** Quando faltam menos de 3 h, a caixa diz a que horas a janela fecha. */
const AVISO_DA_JANELA_MS = 3 * 60 * 60 * 1000;

/**
 * O fio de um grupo: o cabeçalho (capa, nome, "x de 8"), as fixadas, as
 * mensagens com quem mandou cada uma, e a caixa de escrever — que só existe com
 * o grupo ativo e a janela de 24 h aberta. Abrir o grupo zera o "por ler"
 * (`grupo_marcar_lido`), e a confirmação de leitura vai para a Meta se estiver
 * ligada em Ajustes.
 */
export function FioDoGrupo({
  grupo,
  pessoas,
  escolhaExplicita,
  semEco,
  aoVoltar,
}: {
  grupo: GrupoCru;
  pessoas: readonly PessoaDoTime[];
  /** Alguém escolheu este grupo (e não só o computador abriu o primeiro da lista). */
  escolhaExplicita: boolean;
  semEco: boolean;
  aoVoltar: () => void;
}) {
  const clientes = useQueryClient();
  const [painel, setPainel] = useState(false);
  const [respondendoA, setRespondendoA] = useState<MensagemDoGrupoCrua | null>(null);

  const fio = useQuery({
    queryKey: chaveDoFio(grupo.id),
    queryFn: () => carregarFio(grupo.id),
    refetchInterval: semEco ? RITMO_SEM_ECO_MS : painel ? RITMO_DO_PAINEL_MS : false,
  });
  const acoes = useQuery({
    queryKey: chaveDasAcoes(grupo.id),
    queryFn: () => carregarAcoes(grupo.id),
    refetchInterval: (consulta) =>
      temPedidoNaFila(consulta.state.data ?? []) || grupo.estado === 'criando'
        ? RITMO_DA_FILA_MS
        : semEco
          ? RITMO_SEM_ECO_MS
          : false,
  });
  const capa = useQuery({
    queryKey: ['grupos', 'capa', grupo.id, grupo.foto_path],
    queryFn: () => urlDoArquivo({ grupoId: grupo.id }),
    enabled: Boolean(grupo.foto_path),
    staleTime: 4 * 60_000,
    retry: false,
  });

  // ABRIR É LER. Zera o "por ler" do grupo e, com a confirmação de leitura
  // ligada, pede à Meta os tiques azuis da última recebida. Roda de novo quando
  // chega mensagem com o grupo aberto (o número sobe e volta a zero). Só com
  // escolha: o primeiro da lista, aberto sozinho no computador, não conta.
  const porLer = grupo.unread_count;
  useEffect(() => {
    if (porLer <= 0 || !escolhaExplicita) return;
    let vivo = true;
    pedir('grupo_marcar_lido', { p_grupo_id: grupo.id })
      .then(() => {
        if (vivo) void clientes.invalidateQueries({ queryKey: CHAVE_DOS_GRUPOS });
      })
      .catch(() => {
        // Ler é detalhe: se falhar, o número continua na lista e nada mais quebra.
      });
    return () => {
      vivo = false;
    };
  }, [grupo.id, porLer, escolhaExplicita, clientes]);

  // O relógio da janela: a caixa some sozinha quando as 24 h passam.
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const mensagens = useMemo(() => fio.data?.mensagens ?? [], [fio.data]);
  const participantes = useMemo(() => fio.data?.participantes ?? [], [fio.data]);
  const { itens, fixadas } = useMemo(() => montarFio(mensagens, agora), [mensagens, agora]);
  const janela = janelaDoGrupo(grupo.last_inbound_at, agora);
  const situacao = situacaoDasAcoes(acoes.data ?? [], agora);
  const fila = fraseDaFila(situacao.pendentes);
  const { pessoas: quantas } = contarPessoas(participantes, grupo.participantes_total);
  const { rolagem, conteudo, aoRolar } = useRolagemNoFim(grupo.id, itens.length);

  const nomeDe = (m: MensagemDoGrupoCrua) => quemMandou(m, participantes, pessoas);
  const chaveDoAutor = (m: MensagemDoGrupoCrua) =>
    m.direction === 'in' ? `in:${m.de_wa_id ?? '?'}` : `out:${m.sent_by ?? '?'}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-1 border-b border-hairline pr-1.5 pl-1 md:pl-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={aoVoltar}
          className="toque size-11 shrink-0 md:hidden"
        >
          <ArrowLeft aria-hidden="true" />
          <span className="sr-only">Voltar para a lista de grupos</span>
        </Button>
        <button
          type="button"
          onClick={() => setPainel(true)}
          aria-haspopup="dialog"
          className="toque flex h-14 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Avatar className="size-10 shrink-0">
            {capa.data ? <AvatarImage src={capa.data} alt="" /> : null}
            <AvatarFallback className="bg-muted text-xs font-medium text-muted-foreground">
              {iniciaisDe(grupo.assunto)}
            </AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-heading text-[17px] leading-tight font-semibold tracking-tight">
              {grupo.assunto}
            </span>
            <span className="truncate text-[12.5px] text-muted-foreground">
              {grupo.estado === 'ativo'
                ? `${quantas} de ${TETO_DE_PESSOAS} pessoas`
                : grupo.estado === 'criando'
                  ? 'criando na Meta…'
                  : grupo.estado === 'falhou'
                    ? 'a Meta não criou'
                    : grupo.estado === 'suspenso'
                      ? 'suspenso pela Meta'
                      : 'apagado'}
            </span>
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setPainel(true)}
          className="toque size-11 shrink-0"
          aria-label="Grupo: link, pessoas e ajustes"
        >
          <Settings2 aria-hidden="true" />
        </Button>
      </header>

      {fixadas.length > 0 ? (
        <ul className="shrink-0 border-b border-hairline bg-muted/40 px-3 py-1.5">
          {fixadas.map((m) => (
            <li key={m.id} className="flex items-center gap-1.5 py-0.5 text-xs">
              <Pin className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="shrink-0 font-medium">{nomeDe(m)}:</span>
              <span className="truncate text-muted-foreground">{resumoDaMensagem(m)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {fila || situacao.falha ? (
        <p
          className={cn(
            'shrink-0 border-b border-hairline px-4 py-1.5 text-xs',
            situacao.falha && !fila ? 'text-destructive-texto' : 'text-muted-foreground',
          )}
        >
          {fila ?? `A Meta recusou ${situacao.falha?.rotulo}: ${situacao.falha?.erro}`}
        </p>
      ) : null}

      <div
        ref={rolagem}
        onScroll={aoRolar}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 md:px-5"
      >
        <div ref={conteudo}>
          {fio.isPending ? (
            <div className="flex flex-col gap-4" aria-busy="true">
              <Skeleton className="h-12 w-56 rounded-2xl" />
              <Skeleton className="ml-auto h-12 w-48 rounded-2xl" />
              <Skeleton className="h-16 w-64 rounded-2xl" />
            </div>
          ) : fio.isError ? (
            <p className="py-8 text-center text-sm text-destructive-texto">{fio.error.message}</p>
          ) : itens.length === 0 ? (
            <p className="mx-auto max-w-xs py-10 text-center text-sm leading-relaxed text-muted-foreground">
              {grupo.estado === 'ativo'
                ? 'Nenhuma mensagem ainda. Mande o link de convite para alguém entrar; a primeira mensagem livre sai depois que alguém do grupo escrever.'
                : 'Nenhuma mensagem neste grupo.'}
            </p>
          ) : (
            <>
              {fio.data?.cortado ? (
                <p className="pb-3 text-center text-[11px] text-muted-foreground">
                  Mostrando as mensagens mais recentes.
                </p>
              ) : null}
              {itens.map((item, i) => {
                const anterior = itens[i - 1];
                const proximo = itens[i + 1];
                const novoDia =
                  !anterior ||
                  chaveDoDia(anterior.mensagem.created_at) !== chaveDoDia(item.mensagem.created_at);
                const separador = novoDia ? (
                  <SeparadorDeDia iso={item.mensagem.created_at} />
                ) : null;
                if (item.tipo === 'evento') {
                  return (
                    <Fragment key={item.mensagem.id}>
                      {separador}
                      <EventoDoGrupo m={item.mensagem} participantes={participantes} />
                    </Fragment>
                  );
                }
                const autor = chaveDoAutor(item.mensagem);
                const mesmoQueAntes =
                  !novoDia &&
                  anterior?.tipo === 'mensagem' &&
                  chaveDoAutor(anterior.mensagem) === autor;
                const mesmoQueDepois =
                  proximo?.tipo === 'mensagem' &&
                  chaveDoAutor(proximo.mensagem) === autor &&
                  chaveDoDia(proximo.mensagem.created_at) === chaveDoDia(item.mensagem.created_at);
                return (
                  <Fragment key={item.mensagem.id}>
                    {separador}
                    <BalaoDoGrupo
                      item={item}
                      quem={nomeDe(item.mensagem)}
                      agrupada={mesmoQueAntes}
                      fechaGrupo={!mesmoQueDepois}
                      fixadasAgora={fixadas.length}
                      nomeDaCitada={item.citada ? nomeDe(item.citada) : null}
                      aoResponder={setRespondendoA}
                    />
                  </Fragment>
                );
              })}
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-hairline px-3 pt-2 pb-[calc(0.5rem+var(--folga-inferior,0px))] md:px-4 md:pb-3">
        {grupo.estado === 'ativo' ? (
          janela.aberta ? (
            <>
              {janela.restaMs < AVISO_DA_JANELA_MS && janela.fechaEm ? (
                <p className="px-2 pb-1 text-[11px] text-muted-foreground">
                  A janela do grupo fecha às{' '}
                  <span className="numerico">{hora(janela.fechaEm.toISOString())}</span>.
                </p>
              ) : null}
              <CaixaDoGrupo
                grupoId={grupo.id}
                respondendoA={respondendoA}
                nomeDaCitada={respondendoA ? nomeDe(respondendoA) : null}
                aoCancelarResposta={() => setRespondendoA(null)}
              />
            </>
          ) : (
            <p className="rounded-xl bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
              {JANELA_FECHADA}
            </p>
          )
        ) : (
          <p className="rounded-xl bg-muted px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
            {grupo.estado === 'criando'
              ? 'A Meta está criando o grupo. Leva alguns segundos.'
              : grupo.estado === 'falhou'
                ? `A Meta não criou o grupo${grupo.erro ? `: ${grupo.erro}` : '.'} ${AVISO_DA_CONTA_OFICIAL}`
                : grupo.estado === 'suspenso'
                  ? 'A Meta suspendeu este grupo. Ninguém manda mensagem até ela liberar.'
                  : 'Grupo apagado. O histórico continua aqui.'}
          </p>
        )}
      </div>

      <PainelDoGrupo
        grupo={grupo}
        fio={fio.data}
        acoes={acoes.data ?? []}
        aberto={painel}
        aoFechar={() => setPainel(false)}
      />
    </div>
  );
}

function SeparadorDeDia({ iso }: { iso: string }) {
  const dia = rotuloDoDia(iso);
  return (
    <p className="my-3 flex justify-center">
      <span
        className="rounded-full border border-hairline bg-background px-3 py-0.5 text-[11px] text-muted-foreground"
        title={dia.completo}
      >
        {dia.palavra}
        {dia.numero ? <span className="numerico">{dia.numero}</span> : null}
      </span>
    </p>
  );
}
