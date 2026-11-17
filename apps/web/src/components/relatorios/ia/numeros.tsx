'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import type { PainelProgressoIA, SemanaDaIA } from '../dados-vende';
import {
  contagem,
  decimalFixo,
  deltaDe,
  dolares,
  fracao,
  inteiro,
  media,
  numero,
  pct,
  plural,
  type Delta,
} from '../formatos-vende';
import { FilaDeKpis, ReguaDaNota, Sparkline, TextoDoDelta } from '../graficos-vende';

import { notaMaisBaixa, tempoDaIA } from './resumo';

/**
 * Os cinco números do topo do Progresso da IA: as últimas 4 semanas (a janela de 28
 * dias do banco). Dono: o agente "topo da aba IA".
 *
 * Por que um número local e não o `TiraKpi` comum: aqui cada número precisa de três
 * coisas que a peça comum não tem — a unidade pequena ao lado ("/5"), o vazio dito em
 * palavras no lugar do número ("sem visita marcada ainda", e não um "—" solto) e uma
 * marca que muda com o tamanho do dado. O desenho (cartão, tipo, `Sparkline`,
 * `TextoDoDelta`) é o mesmo do `TiraKpi`.
 *
 * A marca de cada número:
 *   - 2 semanas fechadas ou mais com dado → a linha das semanas (`Sparkline`, a semana
 *     corrente fica de fora: está pela metade e puxaria a linha para baixo);
 *   - menos que isso → o valor na régua: a nota num trilho de 1 a 5, a porcentagem
 *     num medidor de 0 a 100 (trilho azul claro, enchimento azul: a IA);
 *   - o custo → o gasto do mês contra o teto, num medidor.
 * O delta só aparece quando a comparação com as 4 semanas anteriores vale (ver
 * `tempoDaIA`): nas primeiras semanas a IA nem estava ligada antes.
 */
export function NumerosDaIA({ dados }: { dados: PainelProgressoIA }) {
  const k = dados.kpis;
  const tempo = tempoDaIA(dados);
  const completas = tempo?.completas ?? [];
  const compara = tempo?.compara ?? false;

  /** O delta, só quando a comparação vale; "= igual" de zero contra zero não diz nada. */
  const delta = (agora: unknown, antes: unknown, jeito: Parameters<typeof deltaDe>[2], menorEMelhor = false) => {
    if (!compara) return null;
    if (numero(agora) === 0 && numero(antes) === 0) return null;
    return deltaDe(agora, antes, jeito, { menorEMelhor });
  };
  const era = (antes: unknown, formato: (v: unknown) => string, verbo = 'era') =>
    compara && numero(antes) !== null ? `${verbo} ${formato(antes)}` : null;

  const interesse = numero(k?.mais_interesse?.agora);
  const resolvidas = numero(k?.resolvidas?.agora);
  const nota = numero(k?.nota?.agora);
  const visitasAntes = numero(k?.visitas?.antes);
  const custoMes = numero(k?.custo_mes_usd) ?? 0;
  const teto = numero(k?.teto_mes_usd);
  const baixa = notaMaisBaixa(completas);

  const serie = (valor: (s: SemanaDaIA) => number | null) => {
    const valores = completas.map(valor);
    return valores.filter((v) => v !== null).length >= 2 ? valores : null;
  };
  const serieInteresse = serie((s) => numero(s.subiu_pct));
  const serieResolvidas = serie((s) => numero(s.resolvidas_pct));
  const serieVisitas = serie((s) => contagem(s.visitas));
  const serieNota = serie((s) => media([s.duvida, s.informacao, s.satisfacao]));

  return (
    <FilaDeKpis colunas={5}>
      <NumeroDaIA
        rotulo="Saem mais interessados"
        valor={interesse === null ? null : pct(interesse)}
        vazio="sem conversa avaliada ainda"
        delta={delta(interesse, k?.mais_interesse?.antes, 'pontos')}
        marca={serieInteresse ? <Sparkline valores={serieInteresse} /> : interesse !== null ? <Medidor parte={interesse / 100} /> : null}
        apoio={interesse === null ? undefined : juntar('das conversas avaliadas', era(k?.mais_interesse?.antes, pct))}
      />
      <NumeroDaIA
        rotulo="Resolvidas sem a equipe"
        valor={resolvidas === null ? null : pct(resolvidas)}
        vazio="sem conversa atendida ainda"
        delta={delta(resolvidas, k?.resolvidas?.antes, 'pontos')}
        marca={serieResolvidas ? <Sparkline valores={serieResolvidas} /> : resolvidas !== null ? <Medidor parte={resolvidas / 100} /> : null}
        apoio={resolvidas === null ? undefined : juntar('das conversas que a IA atendeu', era(k?.resolvidas?.antes, pct))}
      />
      <NumeroDaIA
        rotulo="Visitas marcadas pela IA"
        valor={inteiro(contagem(k?.visitas?.agora))}
        delta={delta(k?.visitas?.agora, visitasAntes, 'contagem')}
        marca={serieVisitas ? <Sparkline valores={serieVisitas} /> : null}
        apoio={juntar('na agenda, pela própria IA', era(visitasAntes, inteiro, plural(visitasAntes ?? 0, 'era', 'eram')))}
      />
      <NumeroDaIA
        rotulo="Nota média"
        valor={nota === null ? null : decimalFixo(nota)}
        unidade={{ curta: '/5', porExtenso: 'de 5' }}
        vazio="sem nota ainda"
        delta={delta(nota, k?.nota?.antes, 'nota')}
        marca={serieNota ? <Sparkline valores={serieNota} /> : nota !== null ? <ReguaDaNota nota={nota} /> : null}
        // Com comparação, o "era" é o contexto; sem ela, a mais baixa das três notas
        // (da última semana fechada) diz para onde olhar. Uma coisa só: cabe numa linha.
        apoio={
          nota === null
            ? undefined
            : (era(k?.nota?.antes, decimalFixo) ??
              (baixa ? `mais baixa: ${baixa.rotulo.charAt(0).toLowerCase()}${baixa.rotulo.slice(1)}, ${decimalFixo(baixa.valor)}` : undefined))
        }
      />
      <NumeroDaIA
        rotulo="Custo por visita marcada"
        valor={numero(k?.custo_por_visita_usd?.agora) === null ? null : dolares(k?.custo_por_visita_usd?.agora)}
        vazio="sem visita marcada ainda"
        delta={delta(k?.custo_por_visita_usd?.agora, k?.custo_por_visita_usd?.antes, 'dolar', true)}
        marca={teto !== null && teto > 0 ? <Medidor parte={fracao(custoMes, teto)} /> : null}
        // O medidor é o gasto do mês contra o teto (o delta já diz quanto o custo
        // por visita mudou; o "era" sairia em duas linhas).
        apoio={teto !== null && teto > 0 ? `gasto do mês: ${dolares(custoMes)} de ${dolares(teto)}` : `gasto do mês: ${dolares(custoMes)}`}
        // No celular (2 colunas) e no tablet (3), o último número ocupa o resto da
        // linha: nada de buraco no fim da fila.
        className="col-span-2 sm:col-span-2 lg:col-span-1"
      />
    </FilaDeKpis>
  );
}

function juntar(...partes: (string | null | undefined | false)[]): string | undefined {
  const texto = partes.filter(Boolean).join(' · ');
  return texto || undefined;
}

/** Um número do topo: o mesmo cartão do `TiraKpi`, com unidade, vazio em palavras e marca. */
function NumeroDaIA({
  rotulo,
  valor,
  unidade,
  vazio,
  delta,
  marca,
  apoio,
  className,
}: {
  rotulo: string;
  /** Nulo quando não há o que medir: aparece o `vazio`, em cinza, no lugar do número. */
  valor: string | null;
  unidade?: { curta: string; porExtenso: string };
  vazio?: string;
  delta?: Delta | null;
  marca?: ReactNode;
  apoio?: ReactNode;
  className?: string;
}) {
  return (
    // A mesma moldura do `TiraKpi` das outras abas: borda hairline (no escuro é ela que
    // desenha o contorno; a sombra some no petróleo), rótulo em peso médio e o delta em
    // pílula. Sem a borda, estes cinco eram os únicos cartões da tela sem contorno.
    <div className={cn('sombra-base flex min-w-0 flex-col gap-2 rounded-xl border border-hairline bg-card p-4', className)}>
      <dt className="text-xs leading-tight font-medium text-muted-foreground">{rotulo}</dt>
      <dd className="flex min-h-7 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {valor === null ? (
          <span className="text-[13px] leading-snug text-muted-foreground">{vazio ?? 'sem dado ainda'}</span>
        ) : (
          <span className="numerico min-w-0 text-[26px] leading-none font-medium tracking-[-0.02em] md:text-[28px]">
            {valor}
            {unidade ? (
              <>
                <span aria-hidden="true" className="ml-0.5 text-sm font-normal tracking-normal text-muted-foreground">
                  {unidade.curta}
                </span>
                <span className="sr-only"> {unidade.porExtenso}</span>
              </>
            ) : null}
          </span>
        )}
        <TextoDoDelta delta={delta ?? null} forma="pilula" />
      </dd>
      {/* A marca tem sempre a mesma altura, e o apoio desce para o pé do cartão: as
          marcas e os apoios da fila ficam na mesma linha, com ou sem marca. */}
      <dd aria-hidden="true" className="flex h-6 items-center">
        {marca ? <div className="w-full">{marca}</div> : null}
      </dd>
      {apoio ? <dd className="numerico mt-auto text-[11px] leading-snug text-muted-foreground">{apoio}</dd> : null}
    </div>
  );
}

/** O medidor de 0 a 1: trilho azul claro (o mesmo matiz) e o enchimento azul da IA. */
function Medidor({ parte }: { parte: number }) {
  const f = Math.max(0, Math.min(1, parte));
  return (
    <span aria-hidden="true" className="relative block h-1.5 w-full overflow-hidden rounded-full bg-(--vende-azul)/15 dark:bg-(--vende-azul)/25">
      {f > 0 ? (
        <span
          className="absolute inset-y-0 left-0 min-w-1.5 rounded-full bg-(--vende-azul)"
          style={{ width: `${(f * 100).toFixed(2)}%` }}
        />
      ) : null}
    </span>
  );
}
