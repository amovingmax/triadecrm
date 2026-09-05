'use client';

import Link from 'next/link';
import { CalendarDays, CheckCheck, ListChecks, Route, Target } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChipTemperatura } from '@/components/temperatura';

import { atrasoEmTexto, dataCompleta, hora } from './formatos';
import { metasDefinidas, nomeDoCanal, type ResumoDoDia } from './tipos';

/**
 * A mensagem das 07:30: quem te espera hoje, e por quê.
 *
 * A ordem é a do R07 §8.1 — agenda, fila, meta —, com uma seção a mais que o anexo
 * não tinha porque a cadência ainda não existia quando ele foi escrito: os toques de
 * régua que vencem hoje. Eles aparecem separados da fila de propósito: são o trabalho
 * que a máquina agendou, e quem executa é gente.
 *
 * O "porquê" de cada item da fila vem pronto do banco (`public.meu_dia.motivo`). Nada
 * é reescrito aqui: o dia da Heloísa e o relatório de segunda contam a mesma história.
 */
export function BlocoDaManha({ resumo, nome }: { resumo: ResumoDoDia; nome: string }) {
  const comMeta = metasDefinidas(resumo.metas);
  const topo = resumo.fila.slice(0, 5);
  const resto = resumo.fila.length - topo.length;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        {nome ? `Bom dia, ${nome}.` : 'Bom dia.'}{' '}
        {resumo.fila.length === 0 && resumo.agenda.length === 0 ? (
          <span className="text-muted-foreground">
            Ninguém está te esperando hoje: nenhuma reunião, nenhuma visita e nada vencido na sua
            fila.
          </span>
        ) : (
          <span className="text-muted-foreground">
            Hoje{' '}
            {resumo.agenda.length > 0 ? (
              <>
                <span className="numerico">{resumo.agenda.length}</span>
                {resumo.agenda.length === 1 ? ' compromisso marcado' : ' compromissos marcados'} e{' '}
              </>
            ) : (
              'sem compromisso marcado e '
            )}
            <span className="numerico">{resumo.fila.length}</span>
            {resumo.fila.length === 1 ? ' item esperando' : ' itens esperando'} você.
          </span>
        )}
      </p>

      <Secao
        titulo="Agenda"
        icone={<CalendarDays className="size-4" aria-hidden="true" />}
        vazio="Nenhuma reunião e nenhuma visita marcada para hoje."
        quantos={resumo.agenda.length}
      >
        <ul className="flex flex-col">
          {resumo.agenda.map((item) => (
            <li
              key={item.task_id}
              className="flex items-baseline gap-3 border-b border-hairline py-2.5 last:border-b-0"
            >
              <span className="numerico shrink-0 text-sm font-medium" title={dataCompleta(item.quando)}>
                {hora(item.quando)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {item.organizacao ?? item.titulo}
                  {item.bairro ? (
                    <span className="text-muted-foreground"> · {item.bairro}</span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.tipo === 'visit' ? 'Visita' : 'Reunião'} · {item.titulo}
                </p>
              </div>
              {item.organization_id ? (
                <Button asChild variant="ghost" size="sm" className="toque h-11 shrink-0 md:h-8">
                  <Link href={`/parceiros/${item.organization_id}`}>Abrir</Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Secao>

      <Secao
        titulo="Sua fila"
        icone={<ListChecks className="size-4" aria-hidden="true" />}
        vazio="Nada vencido e nada marcado para hoje."
        quantos={resumo.fila.length}
      >
        <ol className="flex flex-col">
          {topo.map((item, i) => (
            <li
              key={`${item.task_id ?? item.deal_id ?? item.organization_id ?? 'item'}-${i}`}
              className="flex items-start gap-3 border-b border-hairline py-2.5 last:border-b-0"
            >
              <span className="numerico mt-0.5 shrink-0 text-sm text-muted-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {item.organizacao ?? item.titulo ?? 'Sem nome'}
                  {item.temperatura ? (
                    <ChipTemperatura temperatura={item.temperatura} className="ml-2 align-middle" />
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{item.motivo}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {atrasoEmTexto(item.atraso_horas) ?? hora(item.quando)}
              </span>
            </li>
          ))}
        </ol>
        {resto > 0 ? (
          <p className="pt-2 text-xs text-muted-foreground">
            E mais <span className="numerico">{resto}</span> no{' '}
            <Link href="/meu-dia" className="underline underline-offset-4 hover:text-foreground">
              Meu dia
            </Link>
            , na mesma ordem.
          </p>
        ) : null}
      </Secao>

      <Secao
        titulo="Toques de cadência para hoje"
        icone={<Route className="size-4" aria-hidden="true" />}
        vazio="Nenhum toque de régua vence hoje — nenhuma organização está em cadência."
        quantos={resumo.toques.length}
      >
        <ul className="flex flex-col">
          {resumo.toques.map((toque) => (
            <li
              key={toque.id}
              className="flex items-start gap-3 border-b border-hairline py-2.5 last:border-b-0"
            >
              <Badge variant="pilula" className="mt-0.5 shrink-0 font-normal">
                {nomeDoCanal(toque.canal)}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{toque.organizacao ?? 'Sem nome'}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {toque.cadencia}, passo <span className="numerico">{toque.passo}</span> ·{' '}
                  {toque.titulo}
                </p>
              </div>
              <span className="numerico shrink-0 text-xs text-muted-foreground">
                {hora(toque.quando)}
              </span>
            </li>
          ))}
        </ul>
      </Secao>

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 font-heading text-sm font-medium">
          <Target className="size-4 text-muted-foreground" aria-hidden="true" />
          Meta de hoje
        </h2>
        {comMeta.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma meta combinada para hoje. Ontem foram{' '}
            <span className="numerico">{resumo.ontem.portas_abertas}</span>
            {resumo.ontem.portas_abertas === 1 ? ' porta aberta' : ' portas abertas'} em{' '}
            <span className="numerico">{resumo.ontem.registros}</span>
            {resumo.ontem.registros === 1 ? ' registro' : ' registros'} — é a única referência que
            a base tem hoje.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {comMeta.map((meta) => (
              <li
                key={meta.metrica}
                className="flex items-baseline gap-1.5 rounded-lg border border-hairline bg-card px-3 py-2 text-sm"
              >
                <span className="numerico font-medium">{meta.realizado ?? 0}</span>
                <span className="text-muted-foreground">
                  de <span className="numerico">{meta.meta}</span> · {meta.rotulo}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Uma seção do resumo, com o vazio dizendo o que aconteceu — nunca uma lista em branco. */
export function Secao({
  titulo,
  icone,
  vazio,
  quantos,
  children,
}: {
  titulo: string;
  icone: React.ReactNode;
  vazio: string;
  quantos: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="flex items-center gap-2 font-heading text-sm font-medium">
        <span className="text-muted-foreground">{icone}</span>
        {titulo}
        {quantos > 0 ? <span className="numerico text-muted-foreground">{quantos}</span> : null}
      </h2>
      {quantos === 0 ? (
        <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
          <CheckCheck className="size-3.5 shrink-0" aria-hidden="true" />
          {vazio}
        </p>
      ) : (
        children
      )}
    </section>
  );
}
