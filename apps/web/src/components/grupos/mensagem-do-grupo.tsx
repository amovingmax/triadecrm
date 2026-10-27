'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Copy,
  EllipsisVertical,
  FileText,
  Film,
  Hourglass,
  ImageIcon,
  Pin,
  PinOff,
  Reply,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { iniciaisDe } from '@/lib/iniciais';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DialogoExcluir } from '@/components/exclusao/dialogo-excluir';
import { dataHoraCompleta, hora } from '@/components/conversas/formatos';

import { chaveDasAcoes, chaveDoFio, pedir, urlDoArquivo } from './dados';
import {
  entregaNoGrupo,
  estaFixada,
  fraseDoEvento,
  podeFixar,
  resumoDaMensagem,
  semAssinatura,
  type ItemDoFio,
} from './regras';
import { DIAS_PARA_FIXAR, type MensagemDoGrupoCrua, type ParticipanteCru } from './tipos';

/**
 * Uma mensagem do grupo: a mesma gramática do fio 1:1 (recebida à esquerda, no
 * cartão; a nossa à direita, em verde sólido), com duas diferenças que o grupo
 * pede. O nome de quem escreveu vai em cima de todo bloco recebido, porque são
 * até sete pessoas do outro lado; e o menu da mensagem tem o que o grupo tem:
 * responder citando, copiar, fixar (até 3, de 1 a 30 dias) e apagar.
 *
 * APAGAR É SÓ NO CRM. A Meta não apaga mensagem de empresa: quem está no grupo
 * continua vendo. O diálogo diz isso antes, e o fio mostra "apagada no CRM" no
 * lugar dela.
 */
export function BalaoDoGrupo({
  item,
  quem,
  agrupada,
  fechaGrupo,
  fixadasAgora,
  nomeDaCitada,
  aoResponder,
}: {
  item: Extract<ItemDoFio, { tipo: 'mensagem' }>;
  /** Quem mandou: o participante ou a pessoa do time. */
  quem: string;
  /** Vem logo depois de outra do mesmo autor: sem nome em cima. */
  agrupada: boolean;
  /** Última do bloco: só ela mostra hora e entrega. */
  fechaGrupo: boolean;
  fixadasAgora: number;
  /** O nome de quem escreveu a mensagem citada. */
  nomeDaCitada: string | null;
  aoResponder: (m: MensagemDoGrupoCrua) => void;
}) {
  const m = item.mensagem;
  const entrada = m.direction === 'in';
  const apagada = m.apagada_em !== null;
  const entrega = entregaNoGrupo(m);
  const fixada = estaFixada(m);

  return (
    <div
      className={cn(
        'group flex w-full items-end gap-2',
        entrada ? 'flex-row' : 'flex-row-reverse',
        fechaGrupo ? 'pb-4' : 'pb-1',
      )}
    >
      {fechaGrupo ? (
        <Avatar className="size-8 shrink-0" title={quem}>
          <AvatarFallback
            className={cn(
              'text-[11px] font-medium',
              entrada ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary',
            )}
          >
            {iniciaisDe(quem)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <span className="size-8 shrink-0" aria-hidden="true" />
      )}

      <div className={cn('flex min-w-0 flex-1 flex-col', entrada ? 'items-start' : 'items-end')}>
        {agrupada ? null : <p className="mb-1 px-1 text-xs font-medium text-foreground">{quem}</p>}

        <div
          className={cn(
            'flex max-w-full items-start gap-1',
            entrada ? 'flex-row' : 'flex-row-reverse',
          )}
        >
          <div
            className={cn(
              'min-w-0 max-w-[85%] space-y-2 rounded-2xl px-4 py-3 text-base leading-relaxed md:max-w-[36rem]',
              apagada
                ? 'border border-dashed border-hairline bg-transparent text-muted-foreground'
                : entrada
                  ? cn(
                      'border border-hairline bg-card text-foreground',
                      fechaGrupo && 'rounded-bl-md',
                    )
                  : cn('bg-primary text-primary-foreground', fechaGrupo && 'rounded-br-md'),
            )}
          >
            {apagada ? (
              <p className="flex items-center gap-1.5 text-sm italic">
                <Ban className="size-3.5 shrink-0" aria-hidden="true" />
                Apagada no CRM. Quem está no grupo continua vendo.
              </p>
            ) : (
              <>
                {item.citada ? (
                  <Citacao citada={item.citada} nome={nomeDaCitada} entrada={entrada} />
                ) : null}
                {m.type === 'image' ? <Foto m={m} /> : null}
                {m.type === 'video' ? <Video m={m} /> : null}
                {m.type === 'audio' ? <Audio m={m} /> : null}
                {m.type === 'document' ? <Documento m={m} entrada={entrada} /> : null}
                {m.body ? <Texto texto={m.body} /> : null}
                {!m.body && !['image', 'video', 'audio', 'document'].includes(m.type) ? (
                  <p className="text-sm text-muted-foreground">
                    {m.tipo_na_meta
                      ? `Mensagem do tipo “${m.tipo_na_meta}”, que o CRM ainda não mostra. Abra no WhatsApp.`
                      : 'Mensagem sem texto.'}
                  </p>
                ) : null}
              </>
            )}
          </div>

          {apagada || m.type === 'system' ? null : (
            <MenuDaMensagem
              m={m}
              fixada={fixada}
              fixadasAgora={fixadasAgora}
              aoResponder={() => aoResponder(m)}
            />
          )}
        </div>

        {item.reacoes.length > 0 && !apagada ? (
          <p className={cn('-mt-1.5 flex gap-1 px-2', entrada ? 'justify-start' : 'justify-end')}>
            {item.reacoes.map((r) => (
              <span
                key={r.emoji}
                className="rounded-full border border-hairline bg-card px-1.5 py-px text-sm shadow-sm"
                title={r.quantas === 1 ? '1 pessoa' : `${r.quantas} pessoas`}
              >
                {r.emoji}
                {r.quantas > 1 ? (
                  <span className="numerico ml-0.5 text-[11px]">{r.quantas}</span>
                ) : null}
              </span>
            ))}
          </p>
        ) : null}

        {fechaGrupo || fixada || entrega?.tom === 'falha' ? (
          <p
            className={cn(
              'mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-xs text-muted-foreground',
              entrada ? 'justify-start' : 'flex-row-reverse',
            )}
          >
            <time
              dateTime={m.created_at}
              title={dataHoraCompleta(m.created_at)}
              className="numerico"
            >
              {hora(m.created_at)}
            </time>
            {entrega ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  entrega.tom === 'falha' && 'text-destructive-texto',
                  entrega.tom === 'espera' && 'text-foreground',
                )}
              >
                {entrega.tom === 'espera' ? (
                  <Hourglass className="size-3" aria-hidden="true" />
                ) : null}
                {entrega.tom === 'falha' ? <Ban className="size-3" aria-hidden="true" /> : null}
                {entrega.rotulo}
              </span>
            ) : null}
            {fixada ? (
              <span className="inline-flex items-center gap-1">
                <Pin className="size-3" aria-hidden="true" />
                fixada
              </span>
            ) : null}
            {entrega?.tom === 'falha' && (m.error_detail || m.error_code) ? (
              <span className="w-full text-destructive-texto">
                {m.error_detail?.trim() || `A Meta recusou (${m.error_code}).`}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** "Maria entrou": uma linha no meio do fio, sem balão. */
export function EventoDoGrupo({
  m,
  participantes,
}: {
  m: MensagemDoGrupoCrua;
  participantes: readonly ParticipanteCru[];
}) {
  return (
    <p className="my-3 flex justify-center">
      <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        {fraseDoEvento(m, participantes)} ·{' '}
        <time dateTime={m.created_at} className="numerico">
          {hora(m.created_at)}
        </time>
      </span>
    </p>
  );
}

function Citacao({
  citada,
  nome,
  entrada,
}: {
  citada: MensagemDoGrupoCrua;
  nome: string | null;
  entrada: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border-l-4 px-2.5 py-1.5 text-sm',
        entrada
          ? 'border-primary/60 bg-muted/60'
          : 'border-primary-foreground/60 bg-primary-foreground/10',
      )}
    >
      {nome ? <p className="text-xs font-medium">{nome}</p> : null}
      <p className="line-clamp-2 opacity-90">{resumoDaMensagem(citada)}</p>
    </div>
  );
}

/** O texto, sem a assinatura "*Ana:*": quem escreveu já está em cima do balão. */
function Texto({ texto }: { texto: string }) {
  return <p className="break-words whitespace-pre-line">{semAssinatura(texto)}</p>;
}

// ---------------------------------------------------------------------------
// O menu da mensagem
// ---------------------------------------------------------------------------

function MenuDaMensagem({
  m,
  fixada,
  fixadasAgora,
  aoResponder,
}: {
  m: MensagemDoGrupoCrua;
  fixada: boolean;
  fixadasAgora: number;
  aoResponder: () => void;
}) {
  const clientes = useQueryClient();
  const [apagando, setApagando] = useState(false);
  const fixar = podeFixar(m, fixadasAgora);

  const recarregar = () => {
    void clientes.invalidateQueries({ queryKey: chaveDoFio(m.grupo_id) });
    void clientes.invalidateQueries({ queryKey: chaveDasAcoes(m.grupo_id) });
  };

  const fixarPor = useMutation({
    // `p_dias` nulo desafixa (a função tem 7 como padrão, então o nulo vai escrito).
    mutationFn: (dias: number | null) =>
      pedir('grupo_fixar_mensagem', { p_mensagem_id: m.id, p_dias: dias }),
    onSuccess: (_r, dias) => {
      toast.success(dias === null ? 'Pedido para desafixar.' : 'Pedido para fixar.', {
        description: 'O WhatsApp atualiza em alguns segundos.',
      });
      recarregar();
    },
    onError: (e: Error) => toast.error('Não deu.', { description: e.message }),
  });

  const apagar = useMutation({
    mutationFn: () => pedir('grupo_apagar_mensagem', { p_mensagem_id: m.id }),
    onSuccess: () => {
      setApagando(false);
      toast.success('Apagada do CRM.');
      recarregar();
    },
    onError: (e: Error) => toast.error('Não apagou.', { description: e.message }),
  });

  const copiar = async () => {
    const texto = semAssinatura(m.body).trim();
    if (!texto) {
      toast.message('Esta mensagem não tem texto para copiar.');
      return;
    }
    try {
      await navigator.clipboard.writeText(texto);
      toast.success('Copiado.');
    } catch {
      toast.error('O navegador não deixou copiar.');
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="toque mt-1 size-9 shrink-0 text-muted-foreground opacity-100 md:size-7 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:aria-expanded:opacity-100"
          >
            <EllipsisVertical aria-hidden="true" />
            <span className="sr-only">O que fazer com esta mensagem</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={m.direction === 'in' ? 'start' : 'end'} className="w-52">
          <DropdownMenuItem onSelect={aoResponder}>
            <Reply aria-hidden="true" />
            Responder
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copiar()}>
            <Copy aria-hidden="true" />
            Copiar
          </DropdownMenuItem>
          {fixada ? (
            <DropdownMenuItem onSelect={() => fixarPor.mutate(null)}>
              <PinOff aria-hidden="true" />
              Desafixar
            </DropdownMenuItem>
          ) : fixar.ok ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Pin aria-hidden="true" />
                Fixar
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {DIAS_PARA_FIXAR.map((dias) => (
                  <DropdownMenuItem key={dias} onSelect={() => fixarPor.mutate(dias)}>
                    {dias === 1 ? 'Por 1 dia' : `Por ${dias} dias`}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem disabled>
              <Pin aria-hidden="true" />
              <span className="flex flex-col">
                Fixar
                <span className="text-[11px] text-muted-foreground">{fixar.porque}</span>
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setApagando(true)}>
            <Trash2 aria-hidden="true" />
            Apagar do CRM
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DialogoExcluir
        aberto={apagando}
        aoFechar={() => setApagando(false)}
        titulo="Apagar do CRM"
        descricao={
          <>
            <p>A mensagem some daqui do CRM. Fica registrado quem apagou e quando.</p>
            <p>
              <strong>Quem está no grupo continua vendo:</strong> a Meta não deixa empresa apagar
              mensagem no WhatsApp.
            </p>
          </>
        }
        rotuloConfirmar="Apagar do CRM"
        ocupado={apagar.isPending}
        aoConfirmar={() => apagar.mutate()}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// O arquivo no balão
// ---------------------------------------------------------------------------

/** A URL assinada vale cinco minutos; quatro de cache deixam um de folga. */
const VALIDADE_DA_ASSINATURA_MS = 4 * 60_000;

function useArquivo(m: MensagemDoGrupoCrua) {
  const [vez, setVez] = useState(0);
  const assinatura = useQuery({
    queryKey: ['grupos', 'arquivo', m.id, m.media_path, vez],
    queryFn: () => urlDoArquivo({ mensagemId: m.id }),
    enabled: Boolean(m.media_path),
    staleTime: VALIDADE_DA_ASSINATURA_MS,
    gcTime: VALIDADE_DA_ASSINATURA_MS,
    retry: false,
  });
  const estado: 'procurando' | 'pronto' | 'ausente' = !m.media_path
    ? 'ausente'
    : assinatura.data === undefined
      ? 'procurando'
      : assinatura.data
        ? 'pronto'
        : 'ausente';
  return {
    estado,
    url: assinatura.data ?? null,
    renovar: () => setVez((v) => (v < 2 ? v + 1 : v)),
  };
}

/** Sem arquivo ainda: o worker busca na Meta o que chegou sem arquivo, e o balão troca sozinho. */
function SemArquivo({ rotulo, icone }: { rotulo: string; icone: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed opacity-80">
      <span className="mt-0.5 shrink-0">{icone}</span>
      <span>{rotulo} ainda sem arquivo no CRM. Aparece aqui sozinho quando chegar.</span>
    </p>
  );
}

async function abrirNumaAba(mensagemId: string) {
  const aba = window.open('', '_blank');
  const url = await urlDoArquivo({ mensagemId });
  if (aba === null) return;
  if (url) {
    aba.opener = null;
    aba.location.href = url;
  } else {
    aba.close();
  }
}

function Foto({ m }: { m: MensagemDoGrupoCrua }) {
  const { estado, url, renovar } = useArquivo(m);
  if (estado === 'ausente') {
    return (
      <SemArquivo rotulo="Foto" icone={<ImageIcon className="size-3.5" aria-hidden="true" />} />
    );
  }
  if (!url) {
    return (
      <div
        className="h-48 w-64 max-w-full animate-pulse rounded-xl bg-muted"
        aria-label="Carregando a foto"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => void abrirNumaAba(m.id)}
      className="block overflow-hidden rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      title="Abrir a foto em tamanho real"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária do Storage: o otimizador do Next guardaria uma cópia de algo que tem de expirar. */}
      <img
        src={url}
        alt="Foto"
        loading="lazy"
        onError={renovar}
        className="max-h-80 w-auto max-w-full object-cover"
      />
    </button>
  );
}

function Video({ m }: { m: MensagemDoGrupoCrua }) {
  const { estado, url, renovar } = useArquivo(m);
  if (estado === 'ausente') {
    return <SemArquivo rotulo="Vídeo" icone={<Film className="size-3.5" aria-hidden="true" />} />;
  }
  if (!url) {
    return (
      <div
        className="h-48 w-72 max-w-full animate-pulse rounded-xl bg-muted"
        aria-label="Carregando o vídeo"
      />
    );
  }
  return (
    <video
      controls
      preload="metadata"
      playsInline
      src={url}
      onError={renovar}
      className="max-h-80 w-full max-w-md rounded-xl bg-black"
      aria-label="Vídeo"
    />
  );
}

function Audio({ m }: { m: MensagemDoGrupoCrua }) {
  const { estado, url } = useArquivo(m);
  if (estado === 'pronto' && url) {
    return (
      <audio
        controls
        preload="none"
        src={url}
        className="h-11 w-64 max-w-full"
        aria-label="Áudio"
      />
    );
  }
  return (
    <p className="text-xs opacity-80">
      {estado === 'procurando'
        ? 'Procurando o áudio…'
        : 'Áudio ainda sem arquivo no CRM. Aparece aqui sozinho quando chegar.'}
    </p>
  );
}

function Documento({ m, entrada }: { m: MensagemDoGrupoCrua; entrada: boolean }) {
  const { estado } = useArquivo(m);
  if (estado === 'ausente') {
    return (
      <SemArquivo rotulo="Documento" icone={<FileText className="size-3.5" aria-hidden="true" />} />
    );
  }
  return (
    <button
      type="button"
      disabled={estado === 'procurando'}
      onClick={() => void abrirNumaAba(m.id)}
      className={cn(
        'flex min-h-11 max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors',
        entrada
          ? 'border-hairline bg-muted/50 hover:bg-muted'
          : 'border-primary-foreground/20 bg-primary-foreground/10 hover:bg-primary-foreground/20',
      )}
    >
      <FileText className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{m.media_nome ?? 'Abrir o documento'}</span>
    </button>
  );
}
