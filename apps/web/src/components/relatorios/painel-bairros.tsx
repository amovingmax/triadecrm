'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { carregarBairros, chaveDoRelatorio } from './dados';
import { formatarInteiro, formatarPercentual } from './formatos';
import { QuadroPainel, TirasDeResumo } from './painel';
import type { Periodo } from './periodo';
import { NumeroComBarra, SemDado } from './tabela';
import type { Coluna, DefinicaoPainel, LinhaBairro } from './tipos';

/**
 * Cobertura por bairro: o corte de zona que decide a rota do dia.
 *
 * "Sem bairro" não é erro de leitura nem linha para esconder: é o alvo cujo endereço
 * a base não tem, e ele é justamente quem não entra em rota nenhuma. Deixá-lo visível
 * é a diferença entre "temos 42 alvos em Natal" e "temos 42 alvos, e de 58 deles nem
 * sabemos onde ficam".
 */
export function PainelBairros({ painel, periodo }: { painel: DefinicaoPainel; periodo: Periodo }) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('bairros', periodo),
    queryFn: () => carregarBairros(periodo),
  });

  const linhas = useMemo(() => consulta.data ?? [], [consulta.data]);
  const maiorBase = useMemo(
    () => linhas.reduce((maior, linha) => Math.max(maior, linha.organizacoes), 0),
    [linhas],
  );

  const resumo = useMemo(() => {
    const soma = (pega: (linha: LinhaBairro) => number) =>
      linhas.reduce((total, linha) => total + pega(linha), 0);
    const batidas = soma((l) => l.portas_batidas_periodo);
    const abertas = soma((l) => l.portas_abertas_periodo);
    const semBairro = linhas
      .filter((l) => l.bairro === 'Sem bairro')
      .reduce((total, linha) => total + linha.organizacoes, 0);

    return [
      {
        chave: 'bairros',
        rotulo: 'Bairros com alvo',
        valor: formatarInteiro(linhas.filter((l) => l.bairro !== 'Sem bairro').length),
        apoio: 'com pelo menos uma organização',
      },
      {
        chave: 'alvos',
        rotulo: 'Alvos na base',
        valor: formatarInteiro(soma((l) => l.organizacoes)),
        apoio: 'em todas as cidades',
      },
      {
        chave: 'sem_bairro',
        rotulo: 'Sem endereço',
        valor: formatarInteiro(semBairro),
        apoio: 'não entram em rota',
      },
      {
        chave: 'sem_toque',
        rotulo: 'Sem nenhum toque',
        valor: formatarInteiro(soma((l) => l.sem_contato)),
        apoio: 'nunca receberam contato',
      },
      {
        chave: 'batidas',
        rotulo: 'Portas batidas',
        valor: formatarInteiro(batidas),
        apoio: 'no período escolhido',
      },
      {
        chave: 'abertura',
        rotulo: 'Abertura',
        valor: batidas > 0 ? (formatarPercentual((abertas * 100) / batidas) ?? '0,0%') : 'n/d',
        apoio: `${formatarInteiro(abertas)} portas abertas`,
      },
    ];
  }, [linhas]);

  const colunas: readonly Coluna<LinhaBairro>[] = useMemo(
    () => [
      {
        chave: 'bairro',
        rotulo: 'Bairro',
        fixa: true,
        texto: (l) => l.bairro,
        celula: (l) => <span className="font-medium">{l.bairro}</span>,
      },
      // A cidade é a faixa que separa os blocos da tabela; na planilha ela precisa
      // estar em toda linha, senão a coluna de bairro sozinha não filtra nada.
      { chave: 'cidade', rotulo: 'Cidade', soNoCsv: true, texto: (l) => l.cidade },
      {
        chave: 'organizacoes',
        rotulo: 'Alvos',
        numero: true,
        texto: (l) => formatarInteiro(l.organizacoes),
        celula: (l) => (
          <NumeroComBarra
            texto={formatarInteiro(l.organizacoes)}
            valor={l.organizacoes}
            maximo={maiorBase}
          />
        ),
      },
      {
        chave: 'com_telefone',
        rotulo: 'Com telefone',
        ajuda: 'Alvos com telefone válido no bairro.',
        numero: true,
        texto: (l) => formatarInteiro(l.com_telefone),
      },
      {
        chave: 'sem_contato',
        rotulo: 'Sem toque',
        ajuda: 'Alvos do bairro que nunca receberam contato registrado.',
        numero: true,
        texto: (l) => formatarInteiro(l.sem_contato),
      },
      {
        chave: 'abertos',
        rotulo: 'Negócios abertos',
        numero: true,
        texto: (l) => formatarInteiro(l.negocios_abertos),
      },
      {
        chave: 'publicados',
        rotulo: 'Publicados',
        numero: true,
        texto: (l) => formatarInteiro(l.publicados),
      },
      {
        chave: 'batidas',
        rotulo: 'Batidas',
        numero: true,
        texto: (l) => formatarInteiro(l.portas_batidas_periodo),
      },
      {
        chave: 'abertas',
        rotulo: 'Abertas',
        numero: true,
        texto: (l) => formatarInteiro(l.portas_abertas_periodo),
      },
      {
        chave: 'taxa',
        rotulo: 'Abertura',
        ajuda: 'Portas abertas divididas por portas batidas, no período.',
        numero: true,
        texto: (l) => formatarPercentual(l.taxa_abertura) ?? '',
        celula: (l) =>
          formatarPercentual(l.taxa_abertura) ?? <SemDado motivo="ninguém bateu neste bairro" />,
      },
    ],
    [maiorBase],
  );

  return (
    <QuadroPainel
      painel={painel}
      periodo={periodo}
      consulta={consulta}
      colunas={colunas}
      linhas={linhas}
      chaveDaLinha={(linha) => `${linha.cidade}-${linha.bairro}`}
      grupoDaLinha={(linha) => linha.cidade}
      resumo={<TirasDeResumo itens={resumo} />}
      vazio={{
        titulo: 'Nenhum alvo com cidade',
        texto: 'A base não tem organização com cidade preenchida. Importe a planilha-ponte primeiro.',
      }}
      nota={
        <>
          O bairro vem do endereço que a base já tem; ninguém geocodifica nada aqui ainda. As
          linhas em <span className="font-medium">Sem bairro</span> só diminuem quando alguém
          completar o endereço na ficha ou quando o coletor do Radar trouxer o dado da fonte.
        </>
      }
    />
  );
}
