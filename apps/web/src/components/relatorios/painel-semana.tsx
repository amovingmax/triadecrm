'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Copy, RotateCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChipTemperatura, definicaoTemperatura } from '@/components/temperatura';

import { mensagemDoErro } from './dados';
import { ErroDoRelatorio, EsqueletoRelatorio, NotaDeAlcance } from './estados';
import { formatarInteiro } from './formatos';
import { QuadroPainel } from './painel';
import {
  carregarRelatorioDaSemana,
  carregarSemanas,
  chaveDaSemana,
  CHAVE_DAS_SEMANAS,
  gerarRelatorioDaSemana,
  periodoDaSemana,
  variacaoNaTela,
  type NumeroSemanal,
  type RelatorioDaSemana,
  type SemanaDisponivel,
} from './semana';
import type { Coluna, DefinicaoPainel } from './tipos';

/**
 * O relatório de segunda (RF-REL-09).
 *
 * As outras sete leituras desta tela respondem quando alguém pergunta. Esta é a
 * única que chega pronta: o `pg_cron` roda às 08:00 de segunda, em Natal, monta os
 * fatos da semana que acabou e guarda o texto. Aqui a tela só mostra o que foi
 * guardado.
 *
 * O QUE ESTA TELA NÃO ESCONDE
 *   · A ENTREGA não existe. O R07 pede o resumo no WhatsApp do grupo de growth e o
 *     arquivo anexado; o CRM não tem canal de grupo nem de e-mail. Então o texto
 *     fica aqui, com um botão de copiar, e a tela diz por escrito o que falta.
 *   · Publicado e cadastro são PROXY do funil, não da plataforma Komune. Cada
 *     linha marcada assim carrega o distintivo, como nas outras telas.
 *   · Com 100 alvos e poucas semanas de operação, quase todo número é zero ou um.
 *     A linha zerada FICA na tabela e a variação diz "sem base para comparar" em
 *     vez de inventar percentual sobre dois pontos.
 */
export function PainelSemana({
  painel,
  semana: semanaEscolhida,
  aoTrocarSemana: setSemanaEscolhida,
}: {
  painel: DefinicaoPainel;
  /** A semana pedida na URL. Nulo abre na semana fechada mais recente. */
  semana: string | null;
  aoTrocarSemana: (semana: string) => void;
}) {
  const clienteDeConsultas = useQueryClient();

  const semanas = useQuery({ queryKey: CHAVE_DAS_SEMANAS, queryFn: () => carregarSemanas(8) });

  const consulta = useQuery({
    queryKey: chaveDaSemana(semanaEscolhida),
    queryFn: () => carregarRelatorioDaSemana(semanaEscolhida),
  });

  const geracao = useMutation({
    mutationFn: (semana: string | null) => gerarRelatorioDaSemana(semana),
    onSuccess: async (semana) => {
      setSemanaEscolhida(semana);
      await Promise.all([
        clienteDeConsultas.invalidateQueries({ queryKey: ['relatorios', 'semana'] }),
        clienteDeConsultas.invalidateQueries({ queryKey: CHAVE_DAS_SEMANAS }),
      ]);
    },
  });

  const relatorio = consulta.data ?? null;
  const linhas = useMemo(() => relatorio?.fatos.numeros ?? [], [relatorio]);

  const colunas: readonly Coluna<NumeroSemanal>[] = useMemo(
    () => [
      {
        chave: 'rotulo',
        rotulo: 'O número',
        fixa: true,
        texto: (l) => l.rotulo,
        celula: (l) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium" title={l.ajuda}>
              {l.rotulo}
            </span>
            {l.proxy ? (
              <Badge
                variant="pilula"
                className="h-5 shrink-0 px-2 text-[10px] font-normal"
                title="Sai do funil do CRM, não da plataforma Komune: a integração ainda não está ligada."
              >
                proxy
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        chave: 'semana',
        rotulo: 'Esta semana',
        ajuda: 'O que aconteceu na semana do relatório.',
        numero: true,
        texto: (l) => formatarInteiro(l.semana),
      },
      {
        chave: 'anterior',
        rotulo: 'Semana anterior',
        ajuda: 'O mesmo número na semana de antes, calculado pela mesma definição.',
        numero: true,
        texto: (l) => formatarInteiro(l.anterior),
      },
      {
        chave: 'variacao',
        rotulo: 'Diferença',
        ajuda:
          'A diferença só é apresentada como diferença quando as duas semanas têm base. Abaixo disso a tela diz que não dá para comparar.',
        texto: (l) => variacaoNaTela(l),
        celula: (l) => (
          <span
            className={cn(
              'text-xs',
              l.comparavel && l.delta !== 0
                ? 'numerico text-sm text-foreground'
                : 'text-muted-foreground',
            )}
          >
            {variacaoNaTela(l)}
          </span>
        ),
      },
      {
        chave: 'proxy',
        rotulo: 'Origem',
        soNoCsv: true,
        texto: (l) => (l.proxy ? 'proxy do funil' : 'dado do CRM'),
      },
      {
        chave: 'ajuda',
        rotulo: 'O que quer dizer',
        classe: 'hidden lg:table-cell',
        texto: (l) => l.ajuda,
        celula: (l) => (
          <span className="block max-w-[34rem] text-xs leading-relaxed whitespace-normal text-muted-foreground">
            {l.ajuda}
          </span>
        ),
      },
    ],
    [],
  );

  // O seletor e o cabeçalho aparecem em qualquer estado: sem eles, a tela sem
  // relatório vira uma página vazia sem saída.
  const seletor = (
    <SeletorDeSemana
      semanas={semanas.data ?? []}
      carregando={semanas.isPending}
      escolhida={relatorio?.semanaInicio ?? semanaEscolhida}
      aoEscolher={setSemanaEscolhida}
    />
  );

  if (consulta.isPending) {
    return (
      <section className="flex w-full flex-col gap-4" aria-label={painel.titulo}>
        {seletor}
        <EsqueletoRelatorio colunas={4} linhas={8} />
      </section>
    );
  }

  if (consulta.isError) {
    return (
      <section className="flex w-full flex-col gap-4" aria-label={painel.titulo}>
        {seletor}
        <ErroDoRelatorio
          causa={mensagemDoErro(consulta.error)}
          aoTentar={() => consulta.refetch()}
        />
      </section>
    );
  }

  if (!relatorio) {
    return (
      <section className="flex w-full flex-col gap-4" aria-label={painel.titulo}>
        {seletor}
        <SemRelatorio
          semana={semanaEscolhida}
          gerando={geracao.isPending}
          erro={geracao.isError ? mensagemDoErro(geracao.error) : null}
          aoGerar={() => geracao.mutate(semanaEscolhida)}
        />
      </section>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {seletor}
      <QuadroPainel
        painel={{ ...painel, titulo: `A semana de ${relatorio.rotulo}` }}
        periodo={periodoDaSemana(relatorio)}
        consulta={{
          isPending: false,
          isError: false,
          error: null,
          refetch: () => void consulta.refetch(),
        }}
        colunas={colunas}
        linhas={linhas}
        chaveDaLinha={(linha) => linha.chave}
        destaqueDaLinha={(linha) =>
          linha.chave === 'portas_batidas' || linha.chave === 'portas_abertas'
        }
        colunasNoEsqueleto={4}
        resumo={
          <div className="flex flex-col gap-4">
            <Procedencia
              relatorio={relatorio}
              gerando={geracao.isPending}
              aoRegerar={() => geracao.mutate(relatorio.semanaInicio)}
            />
            {/* Na tela larga o texto fica à esquerda, no seu comprimento de prosa,
                e as três coisas que merecem atenção ficam ao lado, na altura dele:
                sozinho, o texto deixava metade do 1440 vazia, e o que a semana pede
                de resposta acabava abaixo da dobra. No celular voltam a ser pilha. */}
            <div className="grid gap-5 lg:grid-cols-[minmax(0,65ch)_1fr]">
              <TextoDoRelatorio texto={relatorio.texto} />
              <Atencao relatorio={relatorio} />
            </div>
            <Movimento relatorio={relatorio} />
            <BaseDeHoje relatorio={relatorio} />
          </div>
        }
        nota={
          <>
            Os arquivos levam a tabela de números desta semana, do jeito que ela está aqui: o CSV
            para conferir, o XLSX para somar. O texto acima não entra neles porque texto corrido em
            planilha não serve para nada; para mandar o texto, use o botão de copiar. O que este
            relatório ainda não sabe está escrito no fim do próprio texto, e vai junto quando alguém
            o copiar.
          </>
        }
      />
    </div>
  );
}

/** A fila de semanas. Cada botão diz se aquela segunda já foi gerada. */
function SeletorDeSemana({
  semanas,
  carregando,
  escolhida,
  aoEscolher,
}: {
  semanas: readonly SemanaDisponivel[];
  carregando: boolean;
  escolhida: string | null;
  aoEscolher: (semana: string) => void;
}) {
  if (carregando) {
    return (
      <div className="h-11 w-full animate-pulse rounded-lg bg-muted/50 md:h-8" aria-hidden="true" />
    );
  }

  return (
    <nav
      aria-label="Semanas do relatório"
      className="-mx-1 overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)] md:[mask-image:none]"
    >
      <ul className="flex w-max gap-1.5">
        {semanas.map((semana) => {
          const ativa = semana.semanaInicio === escolhida;
          return (
            <li key={semana.semanaInicio}>
              <Button
                variant={ativa ? 'secondary' : 'ghost'}
                aria-pressed={ativa}
                onClick={() => aoEscolher(semana.semanaInicio)}
                title={
                  semana.gerado
                    ? 'Relatório gerado'
                    : 'Esta segunda ainda não foi gerada. Abra e peça para gerar.'
                }
                className={cn('toque numerico h-11 gap-2 px-3 md:h-8', ativa && 'font-semibold')}
              >
                {semana.rotulo}
                {semana.parcial ? (
                  <span className="text-[10px] text-muted-foreground">em curso</span>
                ) : !semana.gerado ? (
                  <span className="text-[10px] text-muted-foreground">não gerada</span>
                ) : null}
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** De onde veio este relatório e por que ele ainda não chega sozinho. */
function Procedencia({
  relatorio,
  gerando,
  aoRegerar,
}: {
  relatorio: RelatorioDaSemana;
  gerando: boolean;
  aoRegerar: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-y border-hairline py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm text-muted-foreground">
          {relatorio.geradoPor === 'cron'
            ? 'Gerado sozinho pelo robô da segunda'
            : `Gerado a pedido${relatorio.geradoPorNome ? ` de ${relatorio.geradoPorNome}` : ''}`}
          , em <span className="numerico">{relatorio.fatos.gerado_em}</span>.
        </p>
        <Button
          variant="ghost"
          onClick={aoRegerar}
          disabled={gerando}
          className="toque h-11 md:h-8"
        >
          <RotateCw aria-hidden="true" className={cn(gerando && 'animate-spin')} />
          {gerando ? 'Refazendo…' : 'Refazer com os dados de agora'}
        </Button>
      </div>

      {relatorio.parcial ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Esta semana ainda não acabou. Meia semana comparada com uma semana inteira dá diferença
          que não existe.
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        A entrega automática ainda não existe: o CRM não tem canal de grupo no WhatsApp nem de
        e-mail. Enquanto ela não existir, o robô gera e guarda, e quem manda para o grupo é gente,
        com o botão de copiar aqui embaixo.
      </p>
    </div>
  );
}

/** O texto pronto para ler, e o botão que o põe na área de transferência. */
function TextoDoRelatorio({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = useCallback(() => {
    // `navigator.clipboard` não existe fora de origem segura (http em rede local,
    // que é como a Heloísa às vezes abre). Sem ele o botão some em vez de mentir.
    void navigator.clipboard.writeText(texto).then(() => {
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2500);
    });
  }, [texto]);

  const podeCopiar = typeof navigator !== 'undefined' && Boolean(navigator.clipboard);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-heading text-base font-semibold tracking-tight">
          O relatório, para ler ou mandar
        </h3>
        {podeCopiar ? (
          <Button variant="outline" onClick={copiar} className="toque h-11 md:h-8">
            {copiado ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copiado ? 'Copiado' : 'Copiar'}
          </Button>
        ) : null}
      </div>
      {/* `whitespace-pre-wrap` mantém as quebras que o banco escreveu: o texto foi
          montado para ser lido de cima a baixo no celular, e reflui-lo estragaria o
          ritmo de leitura. A largura fica presa em prosa por isso mesmo. */}
      <pre className="overflow-x-auto rounded-lg border border-hairline bg-card p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap">
        {texto}
      </pre>
    </div>
  );
}

/** As até três coisas que merecem atenção nesta semana. */
function Atencao({ relatorio }: { relatorio: RelatorioDaSemana }) {
  const itens = relatorio.fatos.atencao;

  return (
    <section className="flex flex-col gap-2" aria-label="O que merece atenção">
      <h3 className="font-heading text-base font-semibold tracking-tight">O que merece atenção</h3>
      {itens.length === 0 ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          Nenhuma regra de alerta disparou nesta semana. Com uma base deste tamanho isso quer dizer
          pouco movimento, e não operação saudável.
        </p>
      ) : (
        <ol className="grid gap-px overflow-hidden rounded-xl bg-hairline md:grid-cols-3 lg:grid-cols-1">
          {itens.map((item, indice) => (
            <li key={item.chave} className="flex flex-col gap-1 bg-card px-3 py-3">
              <span className="numerico text-xs text-muted-foreground">{indice + 1}</span>
              <h4 className="text-sm font-medium">{item.titulo}</h4>
              <p className="text-xs leading-relaxed text-muted-foreground">{item.texto}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** O que avançou e o que esfriou, por etapa. */
function Movimento({ relatorio }: { relatorio: RelatorioDaSemana }) {
  const { avancos, esfriaram } = relatorio.fatos;

  return (
    <section className="grid gap-4 md:grid-cols-2" aria-label="Movimento do funil na semana">
      <ListaDeEtapas
        titulo="O que avançou"
        vazio="Nenhum negócio subiu de etapa nesta semana."
        itens={avancos}
      />
      <ListaDeEtapas
        titulo="O que esfriou"
        vazio="Nada foi para perdido, opt-out ou nutrição nesta semana."
        itens={esfriaram}
      />
    </section>
  );
}

function ListaDeEtapas({
  titulo,
  vazio,
  itens,
}: {
  titulo: string;
  vazio: string;
  itens: readonly { etapa: string; funil: string; n: number }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-heading text-base font-semibold tracking-tight">{titulo}</h3>
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="flex flex-col">
          {itens.map((item) => (
            <li
              key={`${item.funil}-${item.etapa}`}
              className="flex items-baseline justify-between gap-3 border-b border-hairline py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="truncate">{item.etapa}</span>{' '}
                <span className="text-xs text-muted-foreground">{item.funil}</span>
              </span>
              <span className="numerico shrink-0 font-medium">{formatarInteiro(item.n)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A base de hoje por temperatura. Foto de agora, e a tela diz isso. */
function BaseDeHoje({ relatorio }: { relatorio: RelatorioDaSemana }) {
  const fatias = relatorio.fatos.base;
  const total = fatias.reduce((soma, fatia) => soma + fatia.organizacoes, 0);

  return (
    <section className="flex flex-col gap-2" aria-label="A base por temperatura">
      <h3 className="font-heading text-base font-semibold tracking-tight">
        A base hoje{' '}
        <span className="text-sm font-normal text-muted-foreground">
          (foto de agora, não da semana)
        </span>
      </h3>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-hairline sm:grid-cols-3 lg:grid-cols-5">
        {fatias.map((fatia) => {
          const definicao = definicaoTemperatura(fatia.temperatura);
          return (
            <div key={fatia.temperatura} className="flex flex-col gap-1.5 bg-card px-3 py-2.5">
              <dt>
                <ChipTemperatura temperatura={definicao.valor} />
              </dt>
              <dd className="numerico text-xl leading-tight font-medium">
                {formatarInteiro(fatia.organizacoes)}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="text-xs text-muted-foreground">
        <span className="numerico">{formatarInteiro(total)}</span> organizações na base, sem as
        apagadas. É a mesma contagem do painel Base.
      </p>
    </section>
  );
}

/** A semana que ninguém gerou ainda: diz o que é e oferece gerar. */
function SemRelatorio({
  semana,
  gerando,
  erro,
  aoGerar,
}: {
  semana: string | null;
  gerando: boolean;
  erro: string | null;
  aoGerar: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 px-1 py-10">
      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <CircleAlert className="size-5" aria-hidden="true" />
      </span>
      <h3 className="font-heading text-base font-semibold tracking-tight">
        Esta semana ainda não foi gerada
      </h3>
      <p className="max-w-prose text-sm text-muted-foreground">
        {semana === null
          ? 'Nenhum relatório foi guardado ainda. O robô gera o primeiro na segunda de manhã, às 08:00 de Natal, e daí em diante toda segunda. Até lá, dá para gerar aqui e ver como ele fica.'
          : 'A segunda desta semana passou sem o relatório ser gerado, ou ela é anterior ao dia em que o job foi ligado. Gerar agora usa os dados que existem hoje.'}
      </p>
      {erro ? <p className="max-w-prose text-sm text-muted-foreground">{erro}</p> : null}
      <Button variant="outline" onClick={aoGerar} disabled={gerando} className="toque h-11 md:h-9">
        <RotateCw aria-hidden="true" className={cn(gerando && 'animate-spin')} />
        {gerando ? 'Gerando…' : 'Gerar agora'}
      </Button>
      <NotaDeAlcance>
        Gerar aqui grava o mesmo relatório que o job da segunda gravaria, com os dados de agora.
        Nada é enviado a ninguém: a entrega automática depende de um canal que o CRM ainda não tem.
      </NotaDeAlcance>
    </div>
  );
}
