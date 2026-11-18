import Link from 'next/link';
import { UserPlus } from 'lucide-react';

import { APARENCIA_DO_CANAL } from '@/components/conversas/canal-de-chegada-regra';
import { CANAIS_DE_CHEGADA, type CanalDeChegada } from '@komune/schema';

import type { LeadDoPainel, PeriodoDoPainel } from './dados';
import { codigoCurto, haQuanto, iniciais, rotuloDaOrigem, SELO_DA_SITUACAO } from './formatos';
import { Avatar, Bloco, LinkDoBloco, Selo } from './pecas';

const VAZIO: Record<PeriodoDoPainel, string> = {
  hoje: 'Nenhum lead novo hoje até agora.',
  semana: 'Nenhum lead novo nos últimos 7 dias.',
  mes: 'Nenhum lead novo neste mês.',
};

function corDoCanal(canal: string | null): string {
  return canal && (CANAIS_DE_CHEGADA as readonly string[]).includes(canal)
    ? APARENCIA_DO_CANAL[canal as CanalDeChegada].cor
    : 'var(--muted-foreground)';
}

/**
 * Os leads novos do período (17/11/2026): quem é, de onde veio (o canal de
 * chegada), em que pé está (IA atendendo, visita marcada, com a equipe) e quando
 * chegou. Tabela no computador, lista no celular; cada linha abre a conversa.
 */
export function LeadsNovos({
  leads,
  total,
  periodo,
  agora,
}: {
  leads: readonly LeadDoPainel[];
  total: number;
  periodo: PeriodoDoPainel;
  agora: number;
}) {
  return (
    <Bloco
      rotulo="painel-leads"
      titulo="Leads novos"
      contagem={total}
      acao={
        <LinkDoBloco href="/conversas?ver=todas">
          {total > leads.length ? `Ver todos` : 'Conversas'}
        </LinkDoBloco>
      }
    >
      {leads.length === 0 ? (
        <div className="flex items-center gap-3 px-4 pb-5 sm:px-5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <UserPlus className="size-5" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">{VAZIO[periodo]}</p>
        </div>
      ) : (
        <>
          <table className="hidden w-full border-collapse text-sm md:table">
            <thead>
              <tr className="border-b border-border/60 text-left text-[11.5px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
                <th className="px-5 pb-2 font-semibold">Cliente</th>
                <th className="px-3 pb-2 font-semibold">De onde veio</th>
                <th className="px-3 pb-2 font-semibold">Situação</th>
                <th className="px-5 pb-2 text-right font-semibold">Chegou</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const selo = SELO_DA_SITUACAO[l.situacao];
                return (
                  <tr
                    key={l.conversationId}
                    className="border-b border-border/60 last:border-b-0 hover:bg-muted/40"
                  >
                    <td className="px-5 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar nome={l.nome} iniciais={iniciais(l.nome)} />
                        <div className="min-w-0">
                          {l.caminho ? (
                            <Link
                              href={l.caminho}
                              className="block truncate font-semibold hover:underline"
                            >
                              {l.nome}
                            </Link>
                          ) : (
                            <span className="block truncate font-semibold">{l.nome}</span>
                          )}
                          {l.interesse || l.codigo ? (
                            <span className="block truncate text-[12.5px] text-muted-foreground">
                              {[l.interesse, l.codigo ? codigoCurto(l.codigo.toUpperCase()) : null]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                        <span
                          aria-hidden="true"
                          className="size-2 rounded-[3px]"
                          style={{ backgroundColor: corDoCanal(l.canal) }}
                        />
                        {rotuloDaOrigem(l.canal, l.subcanal)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Selo tom={selo.tom}>{selo.rotulo}</Selo>
                    </td>
                    <td className="px-5 py-2.5 text-right text-[13px] whitespace-nowrap text-muted-foreground">
                      {haQuanto(l.chegou, agora)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul className="px-2 pb-2 md:hidden">
            {leads.map((l) => {
              const selo = SELO_DA_SITUACAO[l.situacao];
              const corpo = (
                <>
                  <Avatar nome={l.nome} iniciais={iniciais(l.nome)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{l.nome}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {rotuloDaOrigem(l.canal, l.subcanal)} · {haQuanto(l.chegou, agora)}
                    </span>
                  </span>
                  <Selo tom={selo.tom}>{selo.rotulo}</Selo>
                </>
              );
              return (
                <li key={l.conversationId} className="border-t border-border/60 first:border-t-0">
                  {l.caminho ? (
                    <Link
                      href={l.caminho}
                      className="toque flex min-h-14 items-center gap-3 px-2 py-2"
                    >
                      {corpo}
                    </Link>
                  ) : (
                    <div className="flex min-h-14 items-center gap-3 px-2 py-2">{corpo}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Bloco>
  );
}
