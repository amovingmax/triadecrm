'use client';

import { useMemo } from 'react';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { rotuloDiaCurto, type Dia } from '@/components/agenda/tipos';
import { baixarCsv, montarCsv } from '@/components/relatorios/csv';
import { formatarInteiro } from '@/components/relatorios/formatos';
import { TirasDeResumo } from '@/components/relatorios/painel';
import { TabelaRelatorio } from '@/components/relatorios/tabela';
import type { Coluna } from '@/components/relatorios/tipos';

import {
  comQuemFalou,
  duracao,
  duracaoDaLigacao,
  horaDe,
  jornada,
  resultadoDaLigacao,
  rotuloDoResultado,
  taxaDeAtendimento,
} from './formatos';
import type { LigacaoDoDia, PessoaDoDia } from './tipos';

/**
 * O dia de UMA pessoa que ligou: quatro números, como terminou, e a lista.
 *
 * É a mesma peça nas duas telas — o Meu dia de quem liga e o relatório da
 * gestão —, para ninguém ver um número diferente do que o outro vê.
 *
 * "Mais clean e menos poluído" foi o pedido (06/10/2026), e por isso a tela
 * para aqui: sem meta, sem funil, sem fila. O que a pessoa fez, na ordem em que
 * fez.
 */
export function DiaDaPessoa({ pessoa, dia }: { pessoa: PessoaDoDia; dia: Dia }) {
  const taxa = taxaDeAtendimento(pessoa);
  const periodo = jornada(pessoa);
  const lista = useMemo(() => pessoa.lista ?? [], [pessoa.lista]);

  const colunas = useMemo<Coluna<LigacaoDoDia>[]>(
    () => [
      {
        chave: 'hora',
        rotulo: 'Hora',
        fixa: true,
        texto: (l) => horaDe(l.iniciada_em) ?? '',
        celula: (l) => <span className="numerico">{horaDe(l.iniciada_em)}</span>,
      },
      { chave: 'quem', rotulo: 'Para quem', texto: (l) => l.organizacao ?? 'Sem nome' },
      { chave: 'resultado', rotulo: 'Como terminou', texto: resultadoDaLigacao },
      {
        chave: 'duracao',
        rotulo: 'Duração',
        numero: true,
        ajuda: 'Só quem atendeu tem duração.',
        texto: duracaoDaLigacao,
      },
      {
        chave: 'com_quem',
        rotulo: 'Falou com',
        classe: 'hidden md:table-cell',
        texto: (l) => comQuemFalou(l.com_quem) ?? '',
      },
      {
        chave: 'observacao',
        rotulo: 'Anotação',
        texto: (l) => l.observacao ?? '',
        celula: (l) =>
          l.observacao ? (
            <span className="block max-w-[44ch] whitespace-normal text-muted-foreground">
              {l.observacao}
            </span>
          ) : null,
      },
    ],
    [],
  );

  const resumo = [
    {
      chave: 'ligacoes',
      rotulo: 'Ligações',
      valor: formatarInteiro(pessoa.ligacoes),
      apoio: periodo
        ? `${periodo} · ${formatarInteiro(pessoa.contatos)} ${pessoa.contatos === 1 ? 'contato' : 'contatos'}`
        : 'nenhuma neste dia',
    },
    {
      chave: 'atendidas',
      rotulo: 'Atenderam',
      valor: formatarInteiro(pessoa.atendidas),
      apoio: taxa === null ? 'sem ligação para comparar' : `${taxa}% das ligações`,
    },
    {
      chave: 'tempo',
      rotulo: 'Tempo falado',
      valor: duracao(pessoa.tempo_falado_seg),
      apoio: 'somando quem atendeu',
    },
    {
      chave: 'reunioes',
      rotulo: 'Reuniões marcadas',
      valor: formatarInteiro(pessoa.reunioes_marcadas),
      apoio: 'nas ligações do dia',
    },
  ];

  // O que não cabe em número de destaque, e que um relatório exato não esconde.
  const avisos = [
    pessoa.sem_resultado > 0
      ? `${formatarInteiro(pessoa.sem_resultado)} ${
          pessoa.sem_resultado === 1
            ? 'ligação começou e ficou sem resultado'
            : 'ligações começaram e ficaram sem resultado'
        }`
      : null,
    pessoa.pediram_para_nao_ligar > 0
      ? `${formatarInteiro(pessoa.pediram_para_nao_ligar)} ${
          pessoa.pediram_para_nao_ligar === 1 ? 'pediu' : 'pediram'
        } para não ligar mais`
      : null,
    pessoa.outros_registros > 0
      ? `${formatarInteiro(pessoa.outros_registros)} ${
          pessoa.outros_registros === 1 ? 'contato registrado' : 'contatos registrados'
        } fora da tela de Ligar`
      : null,
  ].filter((a): a is string => a !== null);

  return (
    <div className="flex flex-col gap-4">
      <TirasDeResumo itens={resumo} colunas={4} />

      {pessoa.resultados.length > 0 ? (
        <section aria-label="Como terminou" className="flex flex-col gap-2">
          <h3 className="text-xs text-muted-foreground">Como terminou</h3>
          <ul className="flex flex-wrap gap-1.5">
            {pessoa.resultados.map((r) => (
              <li
                key={r.chave}
                className="flex items-baseline gap-1.5 rounded-full bg-muted px-3 py-1 text-sm"
              >
                <span>{rotuloDoResultado(r)}</span>
                <span className="numerico font-semibold">{formatarInteiro(r.quantas)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {avisos.length > 0 ? (
        <p className="text-sm text-muted-foreground">{avisos.join(' · ')}.</p>
      ) : null}

      {lista.length > 0 ? (
        <section aria-label="Ligações do dia" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs text-muted-foreground">
              As {formatarInteiro(lista.length)} ligações, na ordem em que foram feitas
            </h3>
            <Button
              variant="outline"
              className="toque h-11 md:h-8"
              aria-label="Baixar as ligações do dia em CSV"
              onClick={() =>
                baixarCsv(
                  `ligacoes-${(pessoa.nome ?? 'pessoa').toLowerCase().replace(/\s+/g, '-')}-${dia}.csv`,
                  montarCsv(colunas, lista),
                )
              }
            >
              <Download aria-hidden="true" />
              CSV
            </Button>
          </div>
          <TabelaRelatorio
            rotulo={`Ligações de ${pessoa.nome ?? 'pessoa'} em ${rotuloDiaCurto(dia)}`}
            colunas={colunas}
            linhas={lista}
            chaveDaLinha={(l) => l.id}
          />
        </section>
      ) : null}
    </div>
  );
}
