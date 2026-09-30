'use client';

import Link from 'next/link';
import {
  CalendarDays,
  ChevronRight,
  CircleCheck,
  CircleMinus,
  CircleX,
  ClipboardCheck,
  Info,
  MessageCircle,
  SquarePen,
  Trophy,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { RevelarLista, useRevelarLinha } from '@/components/movimento';
import { horaEmNatal } from '@/components/agenda/tipos';

import { EsqueletoDaFila, ErroDaFila, Moldura } from './estados';
import type { CategoriaPreenchida, ComoFoi, PessoaDoDia } from './feito';

/**
 * A aba "Feito hoje": quem teve resultado registrado hoje, em quatro blocos pela cor
 * do que aconteceu — verde deu certo, âmbar a conversa está andando, cinza nada mudou,
 * vermelho não deu.
 *
 * As cores são as mesmas do cartão da Agenda, pelo mesmo motivo: o mesmo resultado
 * não pode ser verde numa tela e cinza na outra. O âmbar é o da temperatura morna, e
 * não por acaso — é exatamente o que os desfechos de "Em contato" fazem com o
 * parceiro. E cor nunca vai sozinha: cada bloco tem ícone e nome próprios, e cada
 * linha diz o resultado por extenso.
 *
 * No topo, as quatro contagens lado a lado respondem "como foi o meu dia" antes da
 * rolagem. Cada uma leva ao seu bloco.
 *
 * NO DESENHO DE 29/09/2026 (Tríade Design System), como o resto do Meu dia: a página
 * é cinza e todo conteúdo mora num cartão branco com `sombra-base`. A contagem é um
 * cartão por categoria, como os números do resumo lá em cima; cada categoria é um
 * cartão com as pessoas dentro, como os blocos de "Para fazer"; e cada pessoa é uma
 * SUPERFÍCIE dentro do cartão, como a linha da fila. A diferença é que aqui a
 * superfície veste o tom da categoria — é a cor que responde "como foi" de relance,
 * e é ela que tem de bater com o cartão da Agenda.
 */

type EstiloDaCategoria = {
  /** A superfície da linha dentro do cartão, no tom da categoria. */
  linha: string;
  /** O fundo da linha no toque e no hover, um degrau acima da superfície. */
  realce: string;
  /** O texto que carrega a cor: o resultado e o número da contagem. */
  texto: string;
  /** O disco do ícone dentro da linha. */
  circulo: string;
  /**
   * O disco do ícone direto sobre o cartão (contagem e título da categoria). Só
   * difere no mediano: lá a linha é cinza e o disco é branco para recortar, e o
   * mesmo disco branco sobre o cartão branco sumia.
   */
  discoNoCartao: string;
  Icone: React.ComponentType<{ className?: string }>;
};

const ESTILO: Record<ComoFoi, EstiloDaCategoria> = {
  positivo: {
    linha: 'bg-cliente-fundo',
    realce: 'active:bg-cliente/20 focus-visible:bg-cliente/20 md:hover:bg-cliente/20',
    texto: 'text-cliente-texto',
    circulo: 'bg-cliente/15 text-cliente-texto',
    discoNoCartao: 'bg-cliente/15 text-cliente-texto',
    Icone: CircleCheck,
  },
  em_contato: {
    linha: 'bg-morno-fundo',
    realce: 'active:bg-morno/25 focus-visible:bg-morno/25 md:hover:bg-morno/25',
    texto: 'text-morno-texto',
    circulo: 'bg-morno/20 text-morno-texto',
    discoNoCartao: 'bg-morno/20 text-morno-texto',
    Icone: MessageCircle,
  },
  mediano: {
    // A superfície neutra da fila (`item-da-fila.tsx`): "nada mudou" não tem cor.
    linha: 'bg-muted/45',
    realce: 'active:bg-muted focus-visible:bg-muted md:hover:bg-muted',
    texto: 'text-foreground',
    // `bg-card` e não `bg-muted`: disco muted sobre linha muted é disco invisível.
    circulo: 'bg-card text-muted-foreground',
    discoNoCartao: 'bg-muted text-foreground',
    Icone: CircleMinus,
  },
  negativo: {
    linha: 'bg-destructive/10',
    realce: 'active:bg-destructive/20 focus-visible:bg-destructive/20 md:hover:bg-destructive/20',
    texto: 'text-destructive-texto',
    circulo: 'bg-destructive/15 text-destructive-texto',
    discoNoCartao: 'bg-destructive/15 text-destructive-texto',
    Icone: CircleX,
  },
};

const idDaSecao = (categoria: ComoFoi) => `feito-${categoria}`;

export function FeitoHoje({
  quem,
  categorias,
  portasBatidas,
  carregando,
  erro,
  aoTentar,
}: {
  /** O nome de quem é o dia, quando não é de quem entrou; `null` no próprio dia. */
  quem: string | null;
  /**
   * O realizado de "Portas batidas" do resumo lá em cima (`goal_progress`), para a
   * nota que explica por que ele e o total daqui podem ser diferentes. `null`
   * enquanto o resumo não chegou ou quando ele falhou: aí a nota não aparece.
   */
  portasBatidas: number | null;
  categorias: readonly CategoriaPreenchida[];
  carregando: boolean;
  /** A frase em português, já traduzida; `null` quando não falhou. */
  erro: string | null;
  aoTentar: () => void;
}) {
  if (carregando) return <EsqueletoDaFila />;
  if (erro) return <ErroDaFila causa={erro} aoTentar={aoTentar} />;

  const total = categorias.reduce((soma, categoria) => soma + categoria.pessoas.length, 0);
  if (total === 0) return <FeitoVazio quem={quem} />;

  const preenchidas = categorias.filter((categoria) => categoria.pessoas.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <ResumoDoFeito categorias={categorias} quem={quem} />
        <NotaDasPortas parceiros={total} portasBatidas={portasBatidas} />
      </div>

      <RevelarLista>
        {preenchidas.map((categoria, ordem) => (
          <BlocoDaCategoria
            key={categoria.id}
            categoria={categoria}
            deslocamento={preenchidas
              .slice(0, ordem)
              .reduce((soma, anterior) => soma + anterior.pessoas.length, 0)}
          />
        ))}
      </RevelarLista>
    </div>
  );
}

/**
 * As quatro contagens, um cartão por categoria como os números do resumo do dia.
 * Categoria vazia continua no resumo, esmaecida: sumir com o "Negativos 0"
 * esconderia justamente a boa notícia do dia.
 */
function ResumoDoFeito({
  categorias,
  quem,
}: {
  categorias: readonly CategoriaPreenchida[];
  quem: string | null;
}) {
  return (
    <ul
      aria-label={quem ? `Como foi o dia de ${quem}` : 'Como foi o seu dia'}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {categorias.map((categoria) => {
        const quantos = categoria.pessoas.length;
        const estilo = ESTILO[categoria.id];
        const { Icone } = estilo;
        const miolo = (
          <>
            <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
              {/* O ícone num DISCO, como todo ícone do sistema; o disco é que leva a
                  cor, e só quando há alguém na categoria. */}
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full',
                  quantos > 0 ? estilo.discoNoCartao : 'bg-muted text-muted-foreground',
                )}
              >
                <Icone className="size-3.5" />
              </span>
              <span className="truncate">{categoria.titulo}</span>
            </span>
            <span
              className={cn(
                'numerico text-[32px] leading-none font-medium tracking-[-0.03em]',
                quantos > 0 ? estilo.texto : 'text-muted-foreground',
              )}
            >
              {quantos}
            </span>
          </>
        );
        const molde = 'sombra-base flex flex-col gap-2 rounded-xl bg-card p-4 sm:p-5';

        return (
          <li key={categoria.id}>
            {quantos > 0 ? (
              <a
                href={`#${idDaSecao(categoria.id)}`}
                aria-label={`${categoria.titulo}: ${quantos} ${quantos === 1 ? 'parceiro' : 'parceiros'}. Ir para o bloco.`}
                className={cn(
                  molde,
                  'toque h-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                )}
              >
                {miolo}
              </a>
            ) : (
              <div aria-label={`${categoria.titulo}: nenhum`} className={cn(molde, 'h-full')}>
                {miolo}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Por que "Feito hoje" e "Portas batidas" podem não bater, dito na tela.
 *
 * São duas perguntas: aqui, com quantos parceiros houve resultado hoje; lá em cima,
 * quantas portas contam para a meta (RF-MET-01, `app.portas_contadas`), que vale uma
 * por parceiro por dia e fica com quem registrou primeiro — o parceiro que a SDR
 * atendeu às 14:05 e o gestor às 14:41 é porta da SDR. Sem esta linha, 9 embaixo e
 * 7 em cima pareciam um erro de conta.
 */
function NotaDasPortas({
  parceiros,
  portasBatidas,
}: {
  parceiros: number;
  portasBatidas: number | null;
}) {
  if (portasBatidas === null) return null;
  const regra = 'a meta conta uma porta por parceiro por dia, para quem registrou primeiro';
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>
        <span className="numerico">{parceiros}</span>{' '}
        {parceiros === 1 ? 'parceiro com resultado hoje' : 'parceiros com resultado hoje'}
        {portasBatidas === parceiros ? (
          <>, todos como porta batida ({regra}).</>
        ) : (
          <>
            ; <span className="numerico">{portasBatidas}</span>{' '}
            {portasBatidas === 1 ? 'conta' : 'contam'} como porta batida, porque {regra}.
          </>
        )}
      </span>
    </p>
  );
}

/**
 * Uma categoria: o mesmo cartão dos blocos de "Para fazer" (título, contagem e as
 * linhas dentro), com a explicação à vista embaixo do título — aqui ela não é regra
 * lida uma vez, é o critério que separa "Em contato" de "Medianos", e sem ela as duas
 * palavras não dizem por que alguém caiu numa e não na outra.
 */
function BlocoDaCategoria({
  categoria,
  deslocamento,
}: {
  categoria: CategoriaPreenchida;
  deslocamento: number;
}) {
  const estilo = ESTILO[categoria.id];
  const { Icone } = estilo;
  const idDoTitulo = `titulo-${idDaSecao(categoria.id)}`;

  return (
    <section
      id={idDaSecao(categoria.id)}
      aria-labelledby={idDoTitulo}
      // O cabeçalho do app é fixo: sem a margem, o salto do resumo esconde o título.
      className="sombra-base flex scroll-mt-24 flex-col gap-3 rounded-xl bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={idDoTitulo} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-6 items-center justify-center rounded-full',
              estilo.discoNoCartao,
            )}
          >
            <Icone className="size-3.5" />
          </span>
          <span className="font-heading text-sm font-semibold tracking-tight">
            {categoria.titulo}
          </span>
          <span className="numerico rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {categoria.pessoas.length}
          </span>
        </h2>
        <p className="pl-8 text-xs text-muted-foreground">{categoria.explicacao}</p>
      </div>

      {/* 8px entre as linhas, como na fila: superfície colada em superfície vira
          um bloco só. */}
      <ul className="flex flex-col gap-2">
        {categoria.pessoas.map((pessoa, ordem) => (
          <LinhaDoFeito
            key={pessoa.chave}
            pessoa={pessoa}
            estilo={estilo}
            indice={deslocamento + ordem}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Uma pessoa do dia: com QUEM, COMO FOI e QUANDO. O resultado vai na cor do bloco e
 * por extenso ("Realizada, interessado"); quem autorizou ganha o troféu ao lado dele,
 * como no cartão da Agenda.
 */
function LinhaDoFeito({
  pessoa,
  estilo,
  indice,
}: {
  pessoa: PessoaDoDia;
  estilo: EstiloDaCategoria;
  indice: number;
}) {
  const revelar = useRevelarLinha(indice);
  const { Icone } = estilo;

  const contexto = [
    pessoa.canal,
    pessoa.categoriaDoParceiro,
    pessoa.bairro,
    pessoa.anterioresHoje > 0
      ? `+${pessoa.anterioresHoje} ${pessoa.anterioresHoje === 1 ? 'registro antes' : 'registros antes'}`
      : null,
  ].filter(Boolean);

  const miolo = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full',
          estilo.circulo,
        )}
      >
        <Icone className="size-4.5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{pessoa.organizacao}</p>
        <p className={cn('flex items-center gap-1.5 text-[0.8125rem] font-medium', estilo.texto)}>
          <span className="truncate">{pessoa.resultado}</span>
          {pessoa.trofeu ? (
            <Trophy className="size-4 shrink-0" aria-label="Autorizou" role="img" />
          ) : null}
        </p>
        {contexto.length > 0 ? (
          <p className="truncate text-xs text-muted-foreground">{contexto.join(' · ')}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 pt-1">
        <span className="numerico text-xs text-muted-foreground">
          <span className="sr-only">Registrado às </span>
          {horaEmNatal(pessoa.quando)}
        </span>
        {pessoa.naCarteira ? (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
      </div>
    </>
  );

  // A mesma superfície da linha da fila (raio 16px dentro do cartão de 24px), com o
  // tom da categoria no lugar do cinza.
  const molde = cn(
    'flex min-h-[72px] items-start gap-3 rounded-lg py-3 pr-3 pl-3.5 transition-colors',
    estilo.linha,
  );

  return (
    <li {...revelar} className={revelar.className}>
      {pessoa.naCarteira && pessoa.organizacaoId ? (
        <Link
          href={`/parceiros/${pessoa.organizacaoId}`}
          className={cn(molde, 'outline-none', estilo.realce)}
        >
          {miolo}
          <span className="sr-only">Abrir a ficha do parceiro.</span>
        </Link>
      ) : (
        <div className={molde}>{miolo}</div>
      )}
    </li>
  );
}

/** Nada registrado ainda: diz onde se registra, em vez de só dizer que está vazio. */
function FeitoVazio({ quem }: { quem: string | null }) {
  const icone = <ClipboardCheck className="size-5" aria-hidden="true" />;
  if (quem) {
    return (
      <Moldura
        icone={icone}
        titulo={`${quem} não registrou resultado hoje`}
        texto={`Os resultados que ${quem} registrar na Agenda, no Registrar contato ou numa ligação aparecem aqui, separados por como foi.`}
      />
    );
  }
  return (
    <Moldura
      icone={icone}
      titulo="Nenhum resultado registrado hoje"
      texto="Quando você registrar como foi uma reunião, visita, ligação ou conversa, o parceiro aparece aqui, separado por como foi."
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild className="toque h-11 md:h-9">
          <Link href="/agenda">
            <CalendarDays aria-hidden="true" />
            Abrir a agenda
          </Link>
        </Button>
        <Button asChild variant="outline" className="toque h-11 md:h-9">
          <Link href="/registrar">
            <SquarePen aria-hidden="true" />
            Registrar contato
          </Link>
        </Button>
      </div>
    </Moldura>
  );
}
