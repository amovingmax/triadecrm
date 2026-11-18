import Link from 'next/link';
import { CalendarCheck, MapPin, MessageCircle, Navigation } from 'lucide-react';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

import type { VisitaDeHoje } from './dados';
import {
  codigoCurto,
  faltaPara,
  horaDe,
  linkDoMapa,
  nomeDoImovel,
  proximaVisita,
  seloDaVisita,
} from './formatos';
import { Bloco, FotoDoImovel, LinkDoBloco, Selo } from './pecas';

/**
 * A agenda de hoje (17/11/2026): as visitas e reuniões da pessoa, com a foto do
 * imóvel, a confirmação do cliente e "Como chegar". A feita fica apagada, e a
 * próxima ganha o botão cheio.
 */
export function AgendaDeHoje({
  agenda,
  agora,
  deOutraPessoa,
}: {
  agenda: readonly VisitaDeHoje[];
  agora: number;
  deOutraPessoa: boolean;
}) {
  const proxima = proximaVisita(agenda, agora);
  return (
    <Bloco
      rotulo="painel-agenda"
      titulo="Agenda de hoje"
      contagem={agenda.length}
      acao={<LinkDoBloco href="/agenda">Abrir agenda</LinkDoBloco>}
    >
      {agenda.length === 0 ? (
        <div className="flex items-center gap-3 px-4 pb-5 sm:px-5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <CalendarCheck className="size-5" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">
            {deOutraPessoa
              ? 'Nenhuma visita ou reunião marcada para hoje nesta agenda.'
              : 'Nenhuma visita ou reunião marcada para hoje.'}
          </p>
        </div>
      ) : (
        <ul className="px-2 pb-2 sm:px-3">
          {agenda.map((v) => (
            <LinhaDaVisita
              key={v.taskId}
              visita={v}
              agora={agora}
              principal={v.taskId === proxima}
            />
          ))}
        </ul>
      )}
    </Bloco>
  );
}

function LinhaDaVisita({
  visita: v,
  agora,
  principal,
}: {
  visita: VisitaDeHoje;
  agora: number;
  principal: boolean;
}) {
  const selo = seloDaVisita(v);
  const endereco = v.imovel?.endereco ?? v.local;
  const mapa = linkDoMapa(endereco);
  const imovel = v.imovel;
  return (
    <li className="flex items-center gap-3 border-t border-border/60 px-2 py-3 first:border-t-0 sm:gap-4">
      <div className="w-12 shrink-0 text-center sm:w-14">
        <p
          className={cn(
            'numerico font-heading text-[17px] font-semibold sm:text-lg',
            v.feito && 'text-muted-foreground',
          )}
        >
          {horaDe(v.quando)}
        </p>
        <p className="text-[11px] leading-tight text-muted-foreground">
          {v.feito ? 'feita' : faltaPara(v.quando, agora)}
        </p>
      </div>
      <FotoDoImovel
        caminho={imovel?.foto ?? null}
        apagada={v.feito}
        className="h-16 w-21 sm:h-[88px] sm:w-[132px]"
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {v.caminho ? (
            <Link
              href={v.caminho}
              className={cn(
                'truncate text-[15px] font-semibold hover:underline',
                v.feito && 'text-muted-foreground',
              )}
            >
              {v.cliente}
            </Link>
          ) : (
            <span
              className={cn(
                'truncate text-[15px] font-semibold',
                v.feito && 'text-muted-foreground',
              )}
            >
              {v.cliente}
            </span>
          )}
          {selo ? <Selo tom={selo.tom}>{selo.rotulo}</Selo> : null}
        </p>
        <p className="mt-0.5 truncate text-[13.5px] text-muted-foreground">
          {imovel ? (
            <>
              <span className="font-semibold text-foreground/80">{codigoCurto(imovel.codigo)}</span>
              {' · '}
              {nomeDoImovel(imovel.titulo, imovel.tipo)}
            </>
          ) : v.tipo === 'meeting' ? (
            'Reunião'
          ) : (
            'Visita sem imóvel definido'
          )}
        </p>
        {endereco ? (
          <p className="mt-1 flex min-w-0 items-center gap-1 text-[12.5px] text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{endereco}</span>
          </p>
        ) : null}
      </div>
      <div className="hidden shrink-0 items-center gap-2 md:flex">
        {v.caminho ? (
          <Link
            href={v.caminho}
            className={buttonVariants({ variant: 'outline', size: 'icon' })}
            aria-label={`Conversa com ${v.cliente}`}
            title="Abrir a conversa"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
        {mapa && !v.feito ? (
          <a
            href={mapa}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: principal ? 'default' : 'outline' })}
          >
            <Navigation className="size-4" aria-hidden="true" />
            Como chegar
          </a>
        ) : null}
      </div>
    </li>
  );
}
