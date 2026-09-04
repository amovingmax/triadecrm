'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ChipTemperatura,
  definicaoTemperatura,
  TEMPERATURAS_EM_ORDEM,
} from '@/components/temperatura';

import { baixarCsv, montarCsv, nomeDoArquivo } from './csv';
import {
  carregarBasePorTemperatura,
  carregarCategorias,
  carregarFunil,
  carregarHistoricoDeEtapas,
  chaveDoRelatorio,
  mensagemDoErro,
  temperaturaPorEtapa,
  TETO_DO_HISTORICO,
} from './dados';
import { ErroDoRelatorio, EsqueletoRelatorio, NotaDeAlcance } from './estados';
import { formatarInteiro, formatarPercentual } from './formatos';
import { TirasDeResumo } from './painel';
import { diasDoPeriodo, formatarDia, type Periodo } from './periodo';
import { montarSerie, primeiroDiaComHistorico } from './serie-temperatura';
import { TabelaRelatorio } from './tabela';
import type { Coluna, DefinicaoPainel, FatiaTermica } from './tipos';

/**
 * A base por temperatura: como os alvos estão divididos entre frio, morno, quente e
 * cliente neste momento, e como essa divisão chegou aqui.
 *
 * Duas leituras, e a tela diz qual é qual em vez de fundir as duas num número só:
 *
 * 1. AGORA, por organização: é `organizations.temperature`, que o banco calcula da
 *    etapa, da última intenção declarada e dos dias sem contato (PRD §5.6). É o
 *    número canônico, o mesmo que pinta a barra térmica em toda lista do produto.
 * 2. DIA A DIA, por negócio: reconstruído do histórico de etapas, onde cada negócio
 *    carrega a temperatura da ETAPA em que estava no fim de cada dia. Serve para ver
 *    o movimento; não bate exatamente com o número de agora, porque não tem como
 *    saber, olhando para trás, quantos dias sem contato cada negócio tinha naquele
 *    dia. A tela avisa isso onde a série aparece, e não onde ninguém vai ler.
 */
export function PainelBase({ painel, periodo }: { painel: DefinicaoPainel; periodo: Periodo }) {
  const composicao = useQuery({
    queryKey: ['relatorios', 'base-temperatura'],
    queryFn: carregarBasePorTemperatura,
  });

  // Mesma chave do painel de Categorias: o cache do TanStack Query serve as duas
  // telas com uma ida só ao banco.
  const categorias = useQuery({
    queryKey: chaveDoRelatorio('categorias', periodo),
    queryFn: () => carregarCategorias(periodo),
  });

  const funil = useQuery({
    queryKey: chaveDoRelatorio('funil', periodo),
    queryFn: () => carregarFunil(periodo),
  });

  const historico = useQuery({
    queryKey: ['relatorios', 'historico-de-etapas'],
    queryFn: carregarHistoricoDeEtapas,
  });

  const fatias = useMemo(() => composicao.data ?? [], [composicao.data]);
  const total = useMemo(
    () => fatias.reduce((soma, fatia) => soma + fatia.organizacoes, 0),
    [fatias],
  );

  const resumo = useMemo(() => {
    const linhas = categorias.data ?? [];
    const soma = (pega: (linha: (typeof linhas)[number]) => number) =>
      linhas.reduce((acumulado, linha) => acumulado + pega(linha), 0);
    const comTelefone = soma((l) => l.com_telefone);
    const semToque = soma((l) => l.sem_contato);

    const quentes = fatias.find((f) => f.temperatura === 'quente')?.organizacoes ?? 0;
    const clientes =
      (fatias.find((f) => f.temperatura === 'cliente')?.organizacoes ?? 0) +
      (fatias.find((f) => f.temperatura === 'cliente_ativo')?.organizacoes ?? 0);

    return [
      {
        chave: 'total',
        rotulo: 'Alvos na base',
        valor: formatarInteiro(total),
        apoio: 'organizações que você pode ver',
      },
      {
        chave: 'telefone',
        rotulo: 'Com telefone',
        valor: formatarInteiro(comTelefone),
        apoio: total > 0 ? `${formatarPercentual((comTelefone * 100) / total)} da base` : undefined,
      },
      {
        chave: 'sem_toque',
        rotulo: 'Sem nenhum toque',
        valor: formatarInteiro(semToque),
        apoio: 'nunca receberam contato',
      },
      {
        chave: 'quentes',
        rotulo: 'Quentes',
        valor: formatarInteiro(quentes),
        apoio: 'interesse declarado, responder hoje',
      },
      {
        chave: 'clientes',
        rotulo: 'Clientes',
        valor: formatarInteiro(clientes),
        apoio: 'fecharam com a Komune',
      },
      {
        chave: 'quentes_negocios',
        rotulo: 'Negócios quentes',
        valor: formatarInteiro(soma((l) => l.negocios_quentes)),
        apoio: 'negócios abertos em temperatura quente',
      },
    ];
  }, [categorias.data, fatias, total]);

  const colunas: readonly Coluna<FatiaTermica>[] = useMemo(
    () => [
      {
        chave: 'temperatura',
        rotulo: 'Temperatura',
        fixa: true,
        texto: (l) => definicaoTemperatura(l.temperatura).rotulo,
        celula: (l) => <ChipTemperatura temperatura={l.temperatura} />,
      },
      {
        chave: 'significado',
        rotulo: 'O que quer dizer',
        // No celular a frase inteira empurraria a tabela para fora da tela por causa
        // de uma coluna que é explicação, não número. Ela continua no CSV.
        classe: 'hidden md:table-cell',
        texto: (l) => definicaoTemperatura(l.temperatura).descricao,
        celula: (l) => (
          <span className="text-muted-foreground">{definicaoTemperatura(l.temperatura).descricao}</span>
        ),
      },
      {
        chave: 'organizacoes',
        rotulo: 'Organizações',
        numero: true,
        texto: (l) => formatarInteiro(l.organizacoes),
      },
      {
        chave: 'parcela',
        rotulo: '% da base',
        numero: true,
        texto: (l) => (total > 0 ? (formatarPercentual((l.organizacoes * 100) / total) ?? '') : ''),
      },
    ],
    [total],
  );

  const serie = useMemo(() => {
    const mudancas = historico.data?.mudancas ?? [];
    const linhasDoFunil = funil.data ?? [];
    if (mudancas.length === 0 || linhasDoFunil.length === 0) return [];
    const inicio = primeiroDiaComHistorico(mudancas);
    const dias = diasDoPeriodo(periodo).filter((dia) => inicio === null || dia >= inicio);
    if (dias.length === 0) return [];
    return montarSerie(mudancas, temperaturaPorEtapa(linhasDoFunil), dias);
  }, [funil.data, historico.data, periodo]);

  return (
    <section className="flex w-full flex-col gap-4" aria-label={painel.titulo}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-lg font-semibold tracking-tight">{painel.titulo}</h2>
            <Badge variant="pilula" className="h-6 px-2.5 text-[11px] font-normal">
              {painel.requisitos}
            </Badge>
          </div>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {painel.descricao}
          </p>
        </div>

        {fatias.length > 0 ? (
          <Button
            variant="outline"
            className="toque h-11 md:h-8"
            onClick={() => baixarCsv(nomeDoArquivo('base', periodo), montarCsv(colunas, fatias))}
          >
            <Download aria-hidden="true" />
            Baixar CSV
          </Button>
        ) : null}
      </header>

      <TirasDeResumo itens={resumo} />

      {composicao.isPending ? (
        <EsqueletoRelatorio colunas={4} linhas={5} />
      ) : composicao.isError ? (
        <ErroDoRelatorio
          causa={mensagemDoErro(composicao.error)}
          aoTentar={() => composicao.refetch()}
        />
      ) : (
        <>
          <FaixaDaBase fatias={fatias} total={total} />
          <TabelaRelatorio
            rotulo="A base por temperatura"
            colunas={colunas}
            linhas={fatias}
            chaveDaLinha={(linha) => linha.temperatura}
          />
        </>
      )}

      <SerieDaBase
        serie={serie}
        carregando={historico.isPending || funil.isPending}
        erro={historico.isError ? historico.error : funil.isError ? funil.error : null}
        truncado={historico.data?.truncado ?? false}
      />

      <NotaDeAlcance>
        A leitura de agora é a temperatura da organização, calculada pelo banco a partir da
        etapa, da última intenção declarada e dos dias sem contato (PRD §5.6): é a mesma que
        pinta a barra térmica em Parceiros e nos funis. Ela muda sozinha com o tempo, sem
        ninguém tocar em nada: alvo parado esfria.
      </NotaDeAlcance>
    </section>
  );
}

/** A base inteira numa faixa só, na proporção de cada temperatura. */
function FaixaDaBase({ fatias, total }: { fatias: readonly FatiaTermica[]; total: number }) {
  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        A base está vazia: nenhuma organização visível para o seu acesso.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`Divisão da base: ${fatias
          .map(
            (fatia) =>
              `${definicaoTemperatura(fatia.temperatura).rotulo}, ${fatia.organizacoes} de ${total}`,
          )
          .join('; ')}.`}
      >
        {fatias.map((fatia) => {
          const definicao = definicaoTemperatura(fatia.temperatura);
          const parcela = (fatia.organizacoes / total) * 100;
          if (parcela === 0) return null;
          return (
            <span
              key={fatia.temperatura}
              className="h-full"
              style={{ width: `${parcela.toFixed(2)}%`, backgroundColor: definicao.cor }}
            />
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {fatias.map((fatia) => (
          <li key={fatia.temperatura} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ backgroundColor: definicaoTemperatura(fatia.temperatura).cor }}
            />
            <span className="text-muted-foreground">
              {definicaoTemperatura(fatia.temperatura).rotulo}
            </span>
            <span className="numerico font-medium">{formatarInteiro(fatia.organizacoes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A evolução dia a dia, reconstruída do histórico de etapas.
 *
 * Com menos de dois dias de histórico não há evolução para mostrar, e a tela diz
 * isso em vez de desenhar uma linha reta que pareceria estabilidade.
 */
function SerieDaBase({
  serie,
  carregando,
  erro,
  truncado,
}: {
  serie: ReturnType<typeof montarSerie>;
  carregando: boolean;
  erro: unknown;
  truncado: boolean;
}) {
  const maior = serie.reduce((maximo, ponto) => Math.max(maximo, ponto.total), 0);
  const primeiro = serie[0];
  const ultimo = serie[serie.length - 1];

  return (
    <section className="flex flex-col gap-2 border-t border-hairline pt-4">
      <h3 className="font-heading text-sm font-semibold tracking-tight">
        Como a base chegou aqui
      </h3>

      {carregando ? (
        <div className="h-32 w-full animate-none rounded-lg bg-muted" aria-busy="true">
          <span className="sr-only">Carregando o histórico de etapas.</span>
        </div>
      ) : erro ? (
        <p className="max-w-prose text-sm text-muted-foreground">{mensagemDoErro(erro)}</p>
      ) : truncado ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          O histórico já passou de{' '}
          <span className="numerico">{formatarInteiro(TETO_DO_HISTORICO)}</span> mudanças de etapa.
          A partir daqui esta série precisa virar uma consulta do Postgres, como as outras desta
          tela: o navegador não é lugar de refazer a conta toda vez.
        </p>
      ) : serie.length < 2 || !primeiro || !ultimo ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          Ainda não há dois dias de histórico de etapas dentro do período escolhido. A base
          inteira entrou de uma vez, na importação, então a divisão por temperatura só começa a
          se mexer a partir do segundo dia de trabalho registrado. Nada a corrigir: é o produto
          novo, não é falha de dado.
        </p>
      ) : (
        <>
          <div className="flex h-32 items-end gap-px" role="img" aria-label={resumirSerie(serie)}>
            {serie.map((ponto) => (
              <div
                key={ponto.dia}
                className="flex h-full flex-1 flex-col justify-end"
                title={`${formatarDia(ponto.dia)}: ${TEMPERATURAS_EM_ORDEM.filter(
                  (definicao) => ponto.porTemperatura[definicao.valor] > 0,
                )
                  .map(
                    (definicao) =>
                      `${definicao.rotulo} ${ponto.porTemperatura[definicao.valor]}`,
                  )
                  .join(', ')}`}
              >
                {[...TEMPERATURAS_EM_ORDEM].reverse().map((definicao) => {
                  const quantidade = ponto.porTemperatura[definicao.valor];
                  if (quantidade === 0 || maior === 0) return null;
                  return (
                    <span
                      key={definicao.valor}
                      className="w-full"
                      style={{
                        height: `${((quantidade / maior) * 100).toFixed(2)}%`,
                        backgroundColor: definicao.cor,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <p className="flex justify-between text-xs text-muted-foreground">
            <span className="numerico">{formatarDia(primeiro.dia)}</span>
            <span>
              pico de <span className="numerico">{formatarInteiro(maior)}</span> negócios
            </span>
            <span className="numerico">{formatarDia(ultimo.dia)}</span>
          </p>
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
            Esta série é por NEGÓCIO e sai da etapa em que cada um estava no fim de cada dia; a
            tabela de cima é por ORGANIZAÇÃO e usa a temperatura calculada do jeito completo. Os
            dois números não têm de bater, e por isso aparecem separados. Enquanto o banco não
            tiver uma função própria de série temporal, a conta é refeita aqui no navegador a
            partir do histórico de etapas.
          </p>
        </>
      )}

    </section>
  );
}

function resumirSerie(serie: ReturnType<typeof montarSerie>): string {
  const primeiro = serie[0];
  const ultimo = serie[serie.length - 1];
  if (!primeiro || !ultimo) return 'Sem série.';
  return `Evolução dos negócios por temperatura, de ${formatarDia(primeiro.dia)} a ${formatarDia(
    ultimo.dia,
  )}. No último dia: ${TEMPERATURAS_EM_ORDEM.filter(
    (definicao) => ultimo.porTemperatura[definicao.valor] > 0,
  )
    .map((definicao) => `${definicao.rotulo}, ${ultimo.porTemperatura[definicao.valor]}`)
    .join('; ')}.`;
}
