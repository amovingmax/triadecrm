'use client';

import { Plus, UsersRound } from 'lucide-react';

import { cn } from '@/lib/utils';
import { iniciaisDe } from '@/lib/iniciais';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { hora, rotuloDoDia } from '@/components/conversas/formatos';

import { ROTULO_DO_ESTADO } from './regras';
import type { GrupoCru } from './tipos';

/**
 * A lista de grupos: nome, quando mexeu por último, quantas por ler e, quando o
 * grupo não está no normal, o selo do estado (criando, não criado, suspenso,
 * apagado). Em cima, o "Criar grupo".
 */
export function ListaGrupos({
  grupos,
  selecionadoId,
  aoEscolher,
  aoCriar,
}: {
  grupos: readonly GrupoCru[];
  selecionadoId: string | null;
  aoEscolher: (id: string) => void;
  aoCriar: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-hairline bg-background px-3 py-2">
        <p className="text-xs text-muted-foreground">Até 8 pessoas, entrada por link</p>
        <Button size="sm" onClick={aoCriar} className="toque h-10 md:h-8">
          <Plus aria-hidden="true" />
          Criar grupo
        </Button>
      </div>

      {grupos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UsersRound className="size-5" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium">Nenhum grupo ainda</p>
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
            Crie o grupo aqui e mande o link de convite numa conversa. Quem tocar no link entra.
          </p>
        </div>
      ) : (
        <ul>
          {grupos.map((g) => (
            <li key={g.id}>
              <LinhaDoGrupo
                grupo={g}
                selecionado={g.id === selecionadoId}
                aoEscolher={() => aoEscolher(g.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinhaDoGrupo({
  grupo,
  selecionado,
  aoEscolher,
}: {
  grupo: GrupoCru;
  selecionado: boolean;
  aoEscolher: () => void;
}) {
  const selo = ROTULO_DO_ESTADO[grupo.estado];
  const quando = grupo.last_message_at ?? grupo.criado_em;
  const dia = rotuloDoDia(quando);
  const porLer = grupo.unread_count;

  return (
    <button
      type="button"
      onClick={aoEscolher}
      aria-current={selecionado ? 'true' : undefined}
      className={cn(
        'toque flex min-h-[4.25rem] w-full items-center gap-3 border-b border-hairline px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40',
        selecionado && 'bg-muted/60',
        grupo.estado === 'apagado' && 'opacity-60',
      )}
    >
      <Avatar className="size-10 shrink-0">
        <AvatarFallback className="bg-muted text-xs font-medium text-muted-foreground">
          {iniciaisDe(grupo.assunto)}
        </AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn('truncate text-[15px]', porLer > 0 ? 'font-semibold' : 'font-medium')}
          >
            {grupo.assunto}
          </span>
          {selo ? (
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-px text-[10px]',
                grupo.estado === 'falhou' || grupo.estado === 'suspenso'
                  ? 'bg-destructive/10 text-destructive-texto'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {selo}
            </span>
          ) : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {grupo.descricao?.trim() ||
            (grupo.last_message_at ? 'Sem descrição' : 'Nenhuma mensagem ainda')}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <time dateTime={quando} className="text-[11px] text-muted-foreground" title={dia.completo}>
          {/* Curto de propósito: "sexta-feira, 04/09" não cabe ao lado do nome. */}
          {dia.palavra === 'hoje' ? (
            <span className="numerico">{hora(quando)}</span>
          ) : dia.palavra === 'ontem' ? (
            'ontem'
          ) : (
            <span className="numerico">{dia.numero ?? dia.completo}</span>
          )}
        </time>
        {porLer > 0 ? (
          <span className="numerico flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
            {porLer}
            <span className="sr-only"> por ler</span>
          </span>
        ) : null}
      </span>
    </button>
  );
}
