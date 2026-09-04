'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

import { carregarCategorias, chaveDoRelatorio } from './dados';
import { formatarInteiro, formatarPercentual, rotuloDoGrupo } from './formatos';
import { QuadroPainel, TirasDeResumo } from './painel';
import type { Periodo } from './periodo';
import { NumeroComBarra, SemDado } from './tabela';
import type { Coluna, DefinicaoPainel, LinhaCategoria } from './tipos';

/**
 * Densidade por categoria (RF-REL-03), a leitura que monta a lista de prospecção da
 * semana: onde ainda há alvo para bater e onde a categoria já secou sem publicar.
 *
 * A etiqueta vem pronta do banco, com a meta de 5 publicados por categoria:
 * `fechada` (chegou aos 5), `em_risco` (não sobrou alvo sem toque e ainda faltam
 * publicações), `sem_alvos` (a categoria existe e a base não tem ninguém nela) e
 * `no_ritmo` (ainda há alvo para trabalhar).
 */

const ETIQUETAS: Record<string, { rotulo: string; explicacao: string; forte: boolean }> = {
  fechada: {
    rotulo: 'Fechada',
    explicacao: 'Já tem 5 fornecedores publicados: a meta da categoria está cumprida.',
    forte: false,
  },
  no_ritmo: {
    rotulo: 'No ritmo',
    explicacao: 'Ainda há alvo sem nenhum toque para trabalhar nesta categoria.',
    forte: false,
  },
  em_risco: {
    rotulo: 'Em risco',
    explicacao:
      'Todo alvo da categoria já foi tocado e ela ainda não tem 5 publicados: sem alvo novo, ela não fecha.',
    forte: true,
  },
  sem_alvos: {
    rotulo: 'Sem alvos',
    explicacao: 'A categoria existe no catálogo e a base não tem nenhuma organização nela.',
    forte: true,
  },
};

export function PainelCategorias({
  painel,
  periodo,
}: {
  painel: DefinicaoPainel;
  periodo: Periodo;
}) {
  const consulta = useQuery({
    queryKey: chaveDoRelatorio('categorias', periodo),
    queryFn: () => carregarCategorias(periodo),
  });

  const linhas = useMemo(() => consulta.data ?? [], [consulta.data]);
  const maiorBase = useMemo(
    () => linhas.reduce((maior, linha) => Math.max(maior, linha.organizacoes), 0),
    [linhas],
  );

  const resumo = useMemo(() => {
    const soma = (pega: (linha: LinhaCategoria) => number) =>
      linhas.reduce((total, linha) => total + pega(linha), 0);

    const alvos = soma((l) => l.organizacoes);
    const comTelefone = soma((l) => l.com_telefone);
    const batidas = soma((l) => l.portas_batidas_periodo);
    const abertas = soma((l) => l.portas_abertas_periodo);
    const fechadas = linhas.filter((l) => l.etiqueta === 'fechada').length;

    return [
      {
        chave: 'alvos',
        rotulo: 'Alvos com categoria',
        valor: formatarInteiro(alvos),
        apoio: `em ${formatarInteiro(linhas.length)} categorias ativas`,
      },
      {
        chave: 'telefone',
        rotulo: 'Com telefone',
        valor: formatarInteiro(comTelefone),
        apoio: alvos > 0 ? `${formatarPercentual((comTelefone * 100) / alvos)} da base` : undefined,
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
        chave: 'abertas',
        rotulo: 'Portas abertas',
        valor: formatarInteiro(abertas),
        apoio: batidas > 0 ? `${formatarPercentual((abertas * 100) / batidas)} de abertura` : 'ninguém bateu ainda',
      },
      {
        chave: 'fechadas',
        rotulo: 'Categorias fechadas',
        valor: `${formatarInteiro(fechadas)}/${formatarInteiro(linhas.length)}`,
        apoio: 'com 5 publicados ou mais',
      },
    ];
  }, [linhas]);

  const colunas: readonly Coluna<LinhaCategoria>[] = useMemo(
    () => [
      {
        chave: 'categoria',
        rotulo: 'Categoria',
        fixa: true,
        texto: (l) => l.categoria_nome,
        celula: (l) => <span className="font-medium">{l.categoria_nome}</span>,
      },
      {
        chave: 'grupo',
        rotulo: 'Grupo',
        // No celular o grupo empurraria os números para fora da tela logo depois do
        // nome da categoria, que é justamente o que a pessoa veio ver. Ele fica no
        // desktop e no CSV.
        classe: 'hidden md:table-cell',
        texto: (l) => rotuloDoGrupo(l.grupo),
      },
      {
        chave: 'organizacoes',
        rotulo: 'Alvos',
        ajuda: 'Organizações cuja categoria principal é esta.',
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
        ajuda: 'Alvos com telefone válido: são os únicos que dá para tentar hoje.',
        numero: true,
        texto: (l) => formatarInteiro(l.com_telefone),
      },
      {
        chave: 'sem_contato',
        rotulo: 'Sem toque',
        ajuda: 'Alvos que nunca receberam nenhum contato registrado.',
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
        chave: 'quentes',
        rotulo: 'Quentes',
        ajuda: 'Negócios abertos com temperatura quente: interesse declarado.',
        numero: true,
        texto: (l) => formatarInteiro(l.negocios_quentes),
      },
      {
        chave: 'publicados',
        rotulo: 'Publicados',
        ajuda: 'Negócios ganhos. A meta do RF-REL-03 é 5 por categoria.',
        numero: true,
        texto: (l) => formatarInteiro(l.publicados),
      },
      {
        chave: 'perdidos',
        rotulo: 'Perdidos',
        numero: true,
        texto: (l) => formatarInteiro(l.perdidos),
      },
      {
        chave: 'batidas',
        rotulo: 'Batidas',
        ajuda: 'Portas batidas no período: tentativas de contato que contam.',
        numero: true,
        texto: (l) => formatarInteiro(l.portas_batidas_periodo),
      },
      {
        chave: 'abertas',
        rotulo: 'Abertas',
        ajuda: 'Portas abertas no período: a pessoa respondeu.',
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
          formatarPercentual(l.taxa_abertura) ?? <SemDado motivo="ninguém bateu nesta categoria" />,
      },
      {
        chave: 'etiqueta',
        rotulo: 'Situação',
        texto: (l) => ETIQUETAS[l.etiqueta]?.rotulo ?? l.etiqueta,
        celula: (l) => {
          const etiqueta = ETIQUETAS[l.etiqueta];
          if (!etiqueta) return l.etiqueta;
          return (
            <Badge
              variant="pilula"
              title={etiqueta.explicacao}
              className={cn('h-6 px-2.5 text-[11px]', etiqueta.forte ? 'font-medium' : 'font-normal text-muted-foreground')}
            >
              {etiqueta.rotulo}
            </Badge>
          );
        },
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
      chaveDaLinha={(linha) => String(linha.categoria_id)}
      resumo={<TirasDeResumo itens={resumo} />}
      vazio={{
        titulo: 'Nenhuma categoria ativa',
        texto: 'O catálogo de categorias está vazio. Ele vem do seed; fale com quem cuida do banco.',
      }}
      nota={
        <>
          A linha <span className="font-medium">quase lá</span> do RF-REL-03 (interessados mais em
          cadastro) ainda não tem coluna
          própria: o mais perto que o banco devolve hoje é a contagem de negócios quentes. As
          categorias em <span className="font-medium">Sem alvos</span> só saem do zero quando o
          coletor do Radar estiver ligado ou alguém importar uma lista nova.
        </>
      }
    />
  );
}
