'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { hojeEmNatal, rotuloDiaCurto, type Dia } from '@/components/agenda/tipos';
import { baixarCsv, montarCsv } from '@/components/relatorios/csv';
import {
  ErroDoRelatorio,
  EsqueletoRelatorio,
  VazioDoRelatorio,
} from '@/components/relatorios/estados';
import { formatarInteiro } from '@/components/relatorios/formatos';
import { TirasDeResumo } from '@/components/relatorios/painel';
import { TabelaRelatorio } from '@/components/relatorios/tabela';
import type { Coluna, DefinicaoPainel } from '@/components/relatorios/tipos';

import { carregarLigacoesDoDia, chaveDasLigacoesDoDia, mensagemDoErro } from './dados';
import { DiaDaPessoa } from './dia-da-pessoa';
import { duracao, jornada, somarOTime, taxaDeAtendimento } from './formatos';
import { PassoDoDia } from './passo-do-dia';
import type { PessoaDoDia } from './tipos';

/**
 * O relatório da gestão: quem ligou num dia, e o que cada um fez.
 *
 * Pedido de 06/10/2026: "um relatório exato e bem usual sobre tudo que ocorreu
 * para cada pessoa que ligou nesse dia". Uma linha por pessoa; tocar no nome
 * abre o dia dela embaixo, ligação a ligação — a mesma peça que ela vê no
 * próprio Meu dia (`DiaDaPessoa`).
 *
 * O recorte é UM DIA, e não a barra de período dos outros painéis: é o dia que
 * se confere com quem veio trabalhar.
 */
export function PainelLigacoesDoDia({ painel }: { painel: DefinicaoPainel }) {
  const [hoje] = useState<Dia>(() => hojeEmNatal());
  const [dia, setDia] = useState<Dia>(hoje);
  const [pessoaId, setPessoaId] = useState<string | null>(null);

  const time = useQuery({
    queryKey: chaveDasLigacoesDoDia(dia, null),
    queryFn: () => carregarLigacoesDoDia(dia, null),
  });
  const detalhe = useQuery({
    queryKey: chaveDasLigacoesDoDia(dia, pessoaId),
    queryFn: () => carregarLigacoesDoDia(dia, pessoaId),
    enabled: pessoaId !== null,
  });

  const pessoas = useMemo(() => time.data?.pessoas ?? [], [time.data]);
  const soma = useMemo(() => somarOTime(pessoas), [pessoas]);
  const aberta = detalhe.data?.pessoas.find((p) => p.pessoa_id === pessoaId) ?? null;

  const colunas = useMemo<Coluna<PessoaDoDia>[]>(
    () => [
      {
        chave: 'pessoa',
        rotulo: 'Pessoa',
        fixa: true,
        texto: (p) => p.nome ?? 'Sem nome',
        celula: (p) => (
          <button
            type="button"
            onClick={() => setPessoaId(p.pessoa_id)}
            aria-pressed={p.pessoa_id === pessoaId}
            className="rounded text-left font-medium underline decoration-muted-foreground/50 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {p.nome ?? 'Sem nome'}
          </button>
        ),
      },
      { chave: 'periodo', rotulo: 'Ligou', texto: (p) => jornada(p) ?? '—' },
      {
        chave: 'ligacoes',
        rotulo: 'Ligações',
        numero: true,
        texto: (p) => formatarInteiro(p.ligacoes),
      },
      {
        chave: 'atendidas',
        rotulo: 'Atenderam',
        numero: true,
        texto: (p) => formatarInteiro(p.atendidas),
      },
      {
        chave: 'taxa',
        rotulo: '% atendeu',
        numero: true,
        ajuda: 'De cada 100 ligações, quantas alguém atendeu.',
        texto: (p) => {
          const taxa = taxaDeAtendimento(p);
          return taxa === null ? '—' : `${taxa}%`;
        },
      },
      {
        chave: 'tempo',
        rotulo: 'Tempo falado',
        numero: true,
        ajuda: 'Soma da duração das ligações atendidas.',
        texto: (p) => duracao(p.tempo_falado_seg),
      },
      {
        chave: 'reunioes',
        rotulo: 'Reuniões',
        numero: true,
        texto: (p) => formatarInteiro(p.reunioes_marcadas),
      },
      {
        chave: 'sem_resultado',
        rotulo: 'Sem resultado',
        numero: true,
        ajuda: 'Ligações que começaram e não foram tabuladas.',
        classe: 'hidden md:table-cell',
        texto: (p) => formatarInteiro(p.sem_resultado),
      },
      {
        chave: 'nao_ligar',
        rotulo: 'Não ligar mais',
        numero: true,
        ajuda: 'Quantos pediram para não receber mais ligação.',
        classe: 'hidden md:table-cell',
        texto: (p) => formatarInteiro(p.pediram_para_nao_ligar),
      },
    ],
    [pessoaId],
  );

  const taxaDoTime = soma.ligacoes > 0 ? Math.round((soma.atendidas * 100) / soma.ligacoes) : null;

  return (
    <section className="flex w-full flex-col gap-4" aria-label={painel.titulo}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-lg font-semibold tracking-tight">{painel.titulo}</h2>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {painel.descricao}
          </p>
        </div>
        {pessoas.length > 0 ? (
          <Button
            variant="outline"
            className="toque h-11 md:h-8"
            aria-label="Baixar o resumo do dia em CSV"
            onClick={() => baixarCsv(`ligacoes-do-dia-${dia}.csv`, montarCsv(colunas, pessoas))}
          >
            <Download aria-hidden="true" />
            CSV
          </Button>
        ) : null}
      </header>

      <div className="sombra-base rounded-xl bg-card p-4">
        <PassoDoDia
          dia={dia}
          hoje={hoje}
          aoTrocar={(novo) => {
            setDia(novo);
          }}
        />
      </div>

      {time.isPending ? (
        <EsqueletoRelatorio colunas={7} linhas={4} />
      ) : time.isError ? (
        <ErroDoRelatorio causa={mensagemDoErro(time.error)} aoTentar={() => void time.refetch()} />
      ) : pessoas.length === 0 ? (
        <VazioDoRelatorio
          titulo="Ninguém ligou neste dia"
          texto="Toda ligação feita pela tela de Ligar aparece aqui, por pessoa, no dia em que foi feita."
        />
      ) : (
        <>
          <TirasDeResumo
            colunas={4}
            itens={[
              {
                chave: 'pessoas',
                rotulo: 'Quem ligou',
                valor: formatarInteiro(soma.pessoas),
                apoio: soma.pessoas === 1 ? 'pessoa no dia' : 'pessoas no dia',
              },
              {
                chave: 'ligacoes',
                rotulo: 'Ligações',
                valor: formatarInteiro(soma.ligacoes),
                apoio: 'somando todo mundo',
              },
              {
                chave: 'atendidas',
                rotulo: 'Atenderam',
                valor: formatarInteiro(soma.atendidas),
                apoio: taxaDoTime === null ? undefined : `${taxaDoTime}% das ligações`,
              },
              {
                chave: 'reunioes',
                rotulo: 'Reuniões marcadas',
                valor: formatarInteiro(soma.reunioesMarcadas),
                apoio: `${duracao(soma.tempoFaladoSeg)} falados`,
              },
            ]}
          />
          <TabelaRelatorio
            rotulo={`Quem ligou em ${rotuloDiaCurto(dia)}`}
            colunas={colunas}
            linhas={pessoas}
            chaveDaLinha={(p) => p.pessoa_id}
            destaqueDaLinha={(p) => p.pessoa_id === pessoaId}
          />
          {pessoaId === null ? (
            <p className="text-sm text-muted-foreground">
              Toque no nome de alguém para ver o dia dela, ligação a ligação.
            </p>
          ) : null}
        </>
      )}

      {pessoaId !== null ? (
        <section
          aria-label="O dia da pessoa escolhida"
          className="flex flex-col gap-4 border-t border-hairline pt-5"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold tracking-tight">
              {aberta?.nome ? `O dia de ${aberta.nome}` : 'O dia da pessoa'}
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="toque size-11 md:size-9"
              onClick={() => setPessoaId(null)}
            >
              <X aria-hidden="true" />
              <span className="sr-only">Fechar o dia desta pessoa</span>
            </Button>
          </div>
          {detalhe.isPending ? (
            <EsqueletoRelatorio colunas={5} linhas={5} />
          ) : detalhe.isError ? (
            <ErroDoRelatorio
              causa={mensagemDoErro(detalhe.error)}
              aoTentar={() => void detalhe.refetch()}
            />
          ) : aberta ? (
            <DiaDaPessoa pessoa={aberta} dia={dia} />
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
