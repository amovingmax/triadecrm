'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

import { PERIODOS, type Periodo } from './periodo';

/**
 * Dia, semana e mês (RF-MET-02), mais o passo para trás e para a frente.
 *
 * Segmentado feito com botões e `aria-pressed`, e não com abas: não há painel por
 * aba, o que muda é o recorte da mesma tela. O desenho é o do `SeletorDeAba`
 * (pílula branca, a escolha em MENTA) desde 29/09/2026 — era o último segmentado
 * do CRM ainda em cinza sobre cinza.
 *
 * UMA BARRA SÓ, em qualquer largura (24/11/2026): no celular o período e as setas
 * caíam em duas linhas, com alturas diferentes. Agora as setas ficam numa pílula
 * irmã, que não encolhe, e o segmentado ocupa o resto da linha, apertando o
 * próprio respiro. Em 360px "Esta semana" não cabe ao lado dos três períodos: até
 * `sm` o botão do meio diz só "Hoje" (o passo é o mesmo, voltar ao período de
 * hoje), e o nome inteiro volta onde cabe.
 */
export function SeletorPeriodo({
  periodo,
  aoTrocarPeriodo,
  aoAndar,
  aoVoltarParaAgora,
  ehAtual,
}: {
  periodo: Periodo;
  aoTrocarPeriodo: (periodo: Periodo) => void;
  aoAndar: (passos: number) => void;
  aoVoltarParaAgora: () => void;
  ehAtual: boolean;
}) {
  const nomeDoPasso = periodo === 'day' ? 'dia' : periodo === 'week' ? 'semana' : 'mês';
  const nomeDoAgora = periodo === 'day' ? 'Hoje' : periodo === 'week' ? 'Esta semana' : 'Este mês';
  const seta =
    'toque grid size-10 shrink-0 place-items-center rounded-full transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 md:size-9 [&_svg]:size-4';

  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label="Período da meta"
        className="sombra-base flex min-w-0 flex-1 items-center gap-0.5 rounded-full bg-card p-1 sm:flex-none"
      >
        {PERIODOS.map((opcao) => {
          const ativo = opcao.valor === periodo;
          return (
            <button
              key={opcao.valor}
              type="button"
              aria-pressed={ativo}
              onClick={() => aoTrocarPeriodo(opcao.valor)}
              className={cn(
                // 40px no celular, dentro da pílula de 48; 36px no computador. No
                // celular cada um cresce a partir da largura do próprio nome: em
                // partes iguais, "Semana" não cabia nos 54px de 360.
                'toque h-10 flex-auto rounded-full px-2 text-sm font-medium whitespace-nowrap transition-colors outline-none sm:flex-none sm:px-4 md:h-9',
                'focus-visible:ring-3 focus-visible:ring-ring/50',
                ativo
                  ? 'bg-menta text-menta-tinta'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {opcao.rotulo}
            </button>
          );
        })}
      </div>

      <div className="sombra-base flex shrink-0 items-center gap-0.5 rounded-full bg-card p-1">
        <button
          type="button"
          aria-label={`${nomeDoPasso} anterior`}
          onClick={() => aoAndar(-1)}
          className={seta}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={ehAtual}
          onClick={aoVoltarParaAgora}
          title={`Voltar para ${nomeDoAgora.toLowerCase()}`}
          className="toque h-10 rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:bg-transparent disabled:text-muted-foreground disabled:opacity-70 md:h-9"
        >
          <span className="sm:hidden">Hoje</span>
          <span className="max-sm:hidden">{nomeDoAgora}</span>
        </button>
        <button
          type="button"
          aria-label={periodo === 'week' ? 'próxima semana' : `próximo ${nomeDoPasso}`}
          onClick={() => aoAndar(1)}
          className={seta}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
