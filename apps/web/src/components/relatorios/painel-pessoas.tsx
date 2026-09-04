'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ROTULO_PAPEL } from '@/lib/auth/role';

import { carregarPessoas, chaveDoRelatorio } from './dados';
import { formatarDecimal, formatarInteiro, formatarPercentual } from './formatos';
import { QuadroPainel, TirasDeResumo } from './painel';
import type { Periodo } from './periodo';
import { NumeroComBarra, SemDado } from './tabela';
import type { Coluna, DefinicaoPainel, LinhaPessoa } from './tipos';

/**
 * Atividade por responsável (RF-REL-06) e prazo das próximas ações (RF-REL-10).
 *
 * O RF-MET-09 e o RF-AST-06 proíbem ranking público entre pessoas, então a tabela
 * sai na ordem que o banco devolve e não há pódio, medalha nem destaque de "melhor":
 * é leitura de carga e de prazo, para redistribuir trabalho, não placar.
 *
 * A definição do prazo é a do RF-REL-10, e é uma só no sistema inteiro: tarefa
 * concluída dentro do `due_at` conta como no prazo; tarefa ainda aberta e vencida
 * conta como atrasada até a data do relatório.
 */
export function PainelPessoas({ painel, periodo }: { painel: DefinicaoPainel; periodo: Periodo }) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('pessoas', periodo),
    queryFn: () => carregarPessoas(periodo),
  });

  const linhas = useMemo(() => consulta.data ?? [], [consulta.data]);
  const maiorBatidas = useMemo(
    () => linhas.reduce((maior, linha) => Math.max(maior, linha.portas_batidas), 0),
    [linhas],
  );

  const resumo = useMemo(() => {
    const soma = (pega: (linha: LinhaPessoa) => number) =>
      linhas.reduce((total, linha) => total + pega(linha), 0);
    const batidas = soma((l) => l.portas_batidas);
    const abertas = soma((l) => l.portas_abertas);
    const comPrazo = soma((l) => l.tarefas_com_prazo);
    const noPrazo = soma((l) => l.tarefas_no_prazo);

    return [
      {
        chave: 'pessoas',
        rotulo: 'Pessoas com carteira',
        valor: formatarInteiro(linhas.length),
        apoio: 'papéis que aparecem no relatório',
      },
      {
        chave: 'batidas',
        rotulo: 'Portas batidas',
        valor: formatarInteiro(batidas),
        apoio: 'tentativas que contam no período',
      },
      {
        chave: 'abertas',
        rotulo: 'Portas abertas',
        valor: formatarInteiro(abertas),
        apoio: batidas > 0 ? `${formatarPercentual((abertas * 100) / batidas)} de abertura` : 'ninguém bateu ainda',
      },
      {
        chave: 'ligacoes',
        rotulo: 'Ligações',
        valor: formatarInteiro(soma((l) => l.ligacoes)),
        apoio: 'registradas no período',
      },
      {
        chave: 'visitas',
        rotulo: 'Visitas',
        valor: formatarInteiro(soma((l) => l.visitas)),
        apoio: 'registradas no período',
      },
      {
        chave: 'prazo',
        rotulo: 'Próximas ações no prazo',
        valor: comPrazo > 0 ? (formatarPercentual((noPrazo * 100) / comPrazo) ?? '0,0%') : 'n/d',
        apoio: `${formatarInteiro(noPrazo)} de ${formatarInteiro(comPrazo)} tarefas`,
      },
    ];
  }, [linhas]);

  const colunas: readonly Coluna<LinhaPessoa>[] = useMemo(
    () => [
      {
        chave: 'pessoa',
        rotulo: 'Pessoa',
        fixa: true,
        texto: (l) => l.pessoa_nome,
        celula: (l) => <span className="font-medium">{l.pessoa_nome}</span>,
      },
      { chave: 'papel', rotulo: 'Papel', texto: (l) => ROTULO_PAPEL[l.papel] ?? l.papel },
      {
        chave: 'batidas',
        rotulo: 'Portas batidas',
        ajuda: 'Tentativas de contato que contam como porta batida no período.',
        numero: true,
        texto: (l) => formatarInteiro(l.portas_batidas),
        celula: (l) => (
          <NumeroComBarra
            texto={formatarInteiro(l.portas_batidas)}
            valor={l.portas_batidas}
            maximo={maiorBatidas}
          />
        ),
      },
      {
        chave: 'abertas',
        rotulo: 'Portas abertas',
        ajuda: 'Das batidas, quantas viraram conversa de verdade.',
        numero: true,
        texto: (l) => formatarInteiro(l.portas_abertas),
      },
      {
        chave: 'abertura',
        rotulo: 'Abertura',
        ajuda: 'Portas abertas divididas por portas batidas desta pessoa, no período.',
        numero: true,
        texto: (l) =>
          l.portas_batidas > 0
            ? (formatarPercentual((l.portas_abertas * 100) / l.portas_batidas) ?? '')
            : '',
        celula: (l) =>
          l.portas_batidas > 0 ? (
            formatarPercentual((l.portas_abertas * 100) / l.portas_batidas)
          ) : (
            <SemDado motivo="não bateu nenhuma porta no período" />
          ),
      },
      { chave: 'ligacoes', rotulo: 'Ligações', numero: true, texto: (l) => formatarInteiro(l.ligacoes) },
      { chave: 'visitas', rotulo: 'Visitas', numero: true, texto: (l) => formatarInteiro(l.visitas) },
      {
        chave: 'mensagens',
        rotulo: 'Mensagens',
        ajuda: 'WhatsApp e DM registrados como interação.',
        numero: true,
        texto: (l) => formatarInteiro(l.mensagens),
      },
      {
        chave: 'reunioes_marcadas',
        rotulo: 'Reuniões marcadas',
        numero: true,
        texto: (l) => formatarInteiro(l.reunioes_marcadas),
      },
      {
        chave: 'reunioes_realizadas',
        rotulo: 'Reuniões feitas',
        numero: true,
        texto: (l) => formatarInteiro(l.reunioes_realizadas),
      },
      {
        chave: 'cadastros',
        rotulo: 'Cadastros iniciados',
        numero: true,
        texto: (l) => formatarInteiro(l.cadastros_iniciados),
      },
      { chave: 'publicados', rotulo: 'Publicados', numero: true, texto: (l) => formatarInteiro(l.publicados) },
      {
        chave: 'alvos_novos',
        rotulo: 'Alvos novos',
        ajuda: 'Organizações que esta pessoa trouxe para a base no período.',
        numero: true,
        texto: (l) => formatarInteiro(l.alvos_novos),
      },
      {
        chave: 'abertos',
        rotulo: 'Negócios abertos',
        numero: true,
        texto: (l) => formatarInteiro(l.negocios_abertos),
      },
      { chave: 'ganhos', rotulo: 'Ganhos', numero: true, texto: (l) => formatarInteiro(l.negocios_ganhos) },
      { chave: 'perdidos', rotulo: 'Perdidos', numero: true, texto: (l) => formatarInteiro(l.negocios_perdidos) },
      {
        chave: 'sem_proxima',
        rotulo: 'Sem próxima ação',
        ajuda: 'Negócios abertos sem nenhuma tarefa marcada: são os que somem.',
        numero: true,
        texto: (l) => formatarInteiro(l.negocios_sem_proxima_acao),
      },
      {
        chave: 'parados',
        rotulo: 'Parados',
        ajuda: 'Negócios abertos que passaram do SLA da etapa sem toque.',
        numero: true,
        texto: (l) => formatarInteiro(l.negocios_parados),
      },
      {
        chave: 'tarefas',
        rotulo: 'Tarefas com prazo',
        numero: true,
        texto: (l) => formatarInteiro(l.tarefas_com_prazo),
      },
      {
        chave: 'no_prazo',
        rotulo: 'No prazo',
        ajuda: 'RF-REL-10: concluídas dentro do prazo, sobre o total de tarefas com prazo.',
        numero: true,
        texto: (l) => formatarPercentual(l.percentual_no_prazo) ?? '',
        celula: (l) =>
          formatarPercentual(l.percentual_no_prazo) ?? (
            <SemDado motivo="nenhuma tarefa com prazo no período" />
          ),
      },
      {
        chave: 'vencidas',
        rotulo: 'Vencidas abertas',
        ajuda: 'Tarefas que passaram do prazo e ninguém concluiu.',
        numero: true,
        texto: (l) => formatarInteiro(l.tarefas_vencidas_abertas),
      },
      {
        chave: 'atraso',
        rotulo: 'Atraso mediano (h)',
        ajuda: 'Mediana de horas entre o prazo e a conclusão, entre as concluídas fora do prazo.',
        numero: true,
        texto: (l) => formatarDecimal(l.mediana_atraso_horas) ?? '',
        celula: (l) =>
          formatarDecimal(l.mediana_atraso_horas) ?? <SemDado motivo="nada concluído fora do prazo" />,
      },
    ],
    [maiorBatidas],
  );

  return (
    <QuadroPainel
      painel={painel}
      periodo={periodo}
      consulta={consulta}
      colunas={colunas}
      linhas={linhas}
      chaveDaLinha={(linha) => linha.pessoa_id}
      resumo={<TirasDeResumo itens={resumo} />}
      vazio={{
        titulo: 'Nenhuma pessoa no relatório',
        texto: 'Ninguém com papel de campo está cadastrado. Cadastre o time em Administração.',
      }}
      nota={
        <>
          Linha zerada aqui não é defeito: é quem ainda não registrou nada no período. Quatro
          números do RF-REL-06 continuam de fora porque dependem do que ainda não está ligado:
          no-show de reunião, check-in de visita por GPS, comparecimento robô contra pessoa e o
          A/B da abertura, todos presos ao WhatsApp oficial e ao modo automático, que está
          desligado por decisão (ADR-05).
        </>
      }
    />
  );
}
