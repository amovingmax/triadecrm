'use client';

import Link from 'next/link';
import {
  CalendarDays,
  CheckCheck,
  ListChecks,
  PhoneOutgoing,
  RotateCw,
  SquareKanban,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Os jeitos de a fila não ter linhas para mostrar, mais a espera.
 *
 * "Não tem nada para hoje" e "não deu para carregar" são situações opostas e a saída
 * de cada uma é diferente: a primeira é uma boa notícia e pede a próxima ação útil; a
 * segunda é uma falha e pede o que tentar. Nenhuma delas é uma tela em branco.
 */

/** Espera no formato final: a mesma altura de linha e a mesma barra à esquerda. */
export function EsqueletoDaFila() {
  const larguras = ['w-44', 'w-56', 'w-36', 'w-48', 'w-40', 'w-52'];

  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando a fila do dia.</span>
      <Skeleton className="mb-3 h-4 w-24" />
      <ul>
        {Array.from({ length: 6 }, (_, i) => (
          <li
            key={i}
            className="relative flex min-h-[76px] items-start gap-3 border-b border-hairline py-3 pr-3 pl-4 last:border-b-0"
          >
            <Skeleton className="absolute top-3 left-0 h-12 w-[3px] rounded-none" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className={`h-4 ${larguras[i % larguras.length]}`} />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-3 w-10" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Um destino do vazio, com o rótulo dizendo o que se faz lá — não onde se chega. */
type Caminho = { href: string; rotulo: string; Icone: LucideIcon };

const FUNIL: Caminho = { href: '/funis', rotulo: 'Abrir o funil', Icone: SquareKanban };
const REVISAO: Caminho = { href: '/revisao', rotulo: 'Ir para a Revisão', Icone: ListChecks };
const REGISTRAR: Caminho = {
  href: '/registrar',
  rotulo: 'Registrar um contato',
  Icone: PhoneOutgoing,
};

/**
 * A fila zerou. É a única tela do produto em que não ter nada é o resultado certo,
 * então ela comemora e já oferece o passo seguinte — em vez de um vazio triste que
 * deixa a pessoa sem saber se quebrou.
 *
 * Com duas ressalvas que hoje são a regra, não a exceção:
 *
 *   * os 100 negócios da lista-semente entraram sem responsável ("a triagem
 *     distribui depois"), e a fila só enxerga o que tem dono;
 *   * a Revisão acumula candidato esperando decisão, e candidato não entra na fila do
 *     dia porque candidato ainda não é alvo — só vira depois que alguém aprova.
 *
 * Comemorar em cima de qualquer uma das duas é mentir por omissão, e a mentira sai
 * cara justamente aqui: esta é a tela que abre o CRM, e quem lê "fila zerada" fecha
 * o aplicativo. Havendo pilha, a tela diz o número e leva até ela.
 */
export function FilaVazia({
  nome,
  semResponsavel,
  aguardandoRevisao,
}: {
  nome: string;
  /** Negócios abertos sem dono na base inteira. `null` quando a contagem falhou. */
  semResponsavel: number | null;
  /** Candidatos na Revisão em "novo". `null` quando a contagem falhou ou o papel não os vê. */
  aguardandoRevisao: number | null;
}) {
  const temSemDono = semResponsavel !== null && semResponsavel > 0;
  const temParaRevisar = aguardandoRevisao !== null && aguardandoRevisao > 0;
  const haTrabalho = temSemDono || temParaRevisar;

  // Os caminhos em ordem de proveito, e só os dois primeiros viram botão: três
  // botões lado a lado voltam a quebrar linha em 390px, e o terceiro nunca é o que
  // a pessoa veio fazer. Sem trabalho represado, a ordem é a de sempre — registrar
  // um contato primeiro, funil depois.
  const caminhos = [
    ...(temSemDono ? [FUNIL] : []),
    ...(temParaRevisar ? [REVISAO] : []),
    REGISTRAR,
    ...(temSemDono ? [] : [FUNIL]),
  ].slice(0, 2);

  const Destaque = (haTrabalho ? caminhos[0]?.Icone : undefined) ?? CheckCheck;

  // Cada pilha pede uma coisa diferente, então o fecho da frase muda com ela:
  // negócio sem dono pede que alguém assuma; candidato pede uma decisão.
  const fecho =
    temSemDono && temParaRevisar
      ? '. Comece por onde preferir.'
      : temSemDono
        ? '. Assuma um no funil e ele passa a aparecer aqui.'
        : '. Aprovado, o candidato vira parceiro e entra no funil.';

  return (
    <Moldura
      icone={<Destaque className="size-5" aria-hidden="true" />}
      titulo={
        haTrabalho ? 'A sua fila está vazia.' : nome ? `Fila zerada, ${nome}.` : 'Fila zerada.'
      }
      texto={
        haTrabalho ? (
          <>
            Nada vencido e nada marcado para você. Mas o trabalho existe:{' '}
            {temSemDono ? (
              <>
                <span className="numerico">{semResponsavel}</span>
                {semResponsavel === 1
                  ? ' negócio aberto ainda sem responsável'
                  : ' negócios abertos ainda sem responsável'}
              </>
            ) : null}
            {temSemDono && temParaRevisar ? ' e ' : null}
            {temParaRevisar ? (
              <>
                <span className="numerico">{aguardandoRevisao}</span>
                {aguardandoRevisao === 1
                  ? ' candidato esperando revisão'
                  : ' candidatos esperando revisão'}
              </>
            ) : null}
            {fecho}
          </>
        ) : (
          'Nada vencido, nada marcado para hoje e nenhum negócio seu sem próximo passo. Dá para puxar trabalho novo.'
        )
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        {caminhos.map((caminho, ordem) => (
          <Button
            key={caminho.href}
            asChild
            variant={ordem === 0 ? 'default' : 'outline'}
            className="toque h-11 md:h-9"
          >
            <Link href={caminho.href}>
              <caminho.Icone aria-hidden="true" />
              {caminho.rotulo}
            </Link>
          </Button>
        ))}
      </div>
    </Moldura>
  );
}

/**
 * Existe fila, mas tudo o que sobrou tem data à frente: hoje está limpo. Vale o
 * mesmo alívio, em tom menor, e sem esconder o que vem depois.
 *
 * Desde que o futuro ganhou aba própria ("Próximos dias"), "logo abaixo" deixou de
 * ser verdade: o que vem depois está na outra aba. O botão leva até lá, e some
 * quando não há nada marcado à frente — um botão para uma aba vazia é um convite
 * para um lugar onde não há nada.
 */
export function NadaParaHoje({
  quantosDepois,
  aoVerProximos,
}: {
  quantosDepois: number;
  aoVerProximos: () => void;
}) {
  return (
    <div className="sombra-base flex items-start gap-3 rounded-xl bg-card p-4">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-menta-fundo text-menta-texto">
        <CheckCheck className="size-4" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col items-start gap-2">
        <div>
          <p className="font-medium">Hoje está limpo.</p>
          <p className="text-sm text-muted-foreground">
            Nada vencido e nada marcado para hoje.
            {quantosDepois > 0 ? (
              <>
                {' '}
                Há <span className="numerico">{quantosDepois}</span>
                {quantosDepois === 1
                  ? ' compromisso com data à frente.'
                  : ' compromissos com data à frente.'}
              </>
            ) : null}
          </p>
        </div>
        {quantosDepois > 0 ? (
          <Button variant="outline" onClick={aoVerProximos} className="toque h-11 md:h-8">
            <CalendarDays aria-hidden="true" />
            Ver os próximos dias
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A aba "Próximos dias" sem nada marcado. Quando a fila veio cheia, o vazio pode ser
 * só o futuro que não coube — aí quem fala é o aviso do corte (`FuturoCortado`), e
 * não este.
 */
export function SemProximos() {
  return (
    <Moldura
      icone={<CalendarDays className="size-5" aria-hidden="true" />}
      titulo="Nada marcado para os próximos dias"
      texto="O que for combinado com data à frente aparece aqui, separado por dia."
    />
  );
}

/**
 * A fila de outra pessoa (gestor ou admin pelo seletor "De quem é o dia") voltou
 * vazia. Sem os caminhos de `FilaVazia`: eles são para quem está com a fila vazia
 * puxar trabalho, e quem está olhando não é essa pessoa.
 */
export function FilaVaziaDeOutraPessoa({ nome }: { nome: string | null }) {
  return (
    <Moldura
      icone={<CalendarDays className="size-5" aria-hidden="true" />}
      titulo={nome ? `A fila de ${nome} está vazia` : 'A fila está vazia'}
      texto="Nada vencido, nada para hoje e nada com data à frente."
    />
  );
}

/** Falhou: diz em português o que houve e o que fazer, nunca o texto cru do Postgres. */
export function ErroDaFila({ causa, aoTentar }: { causa: string; aoTentar: () => void }) {
  return (
    <Moldura
      icone={<RotateCw className="size-5" aria-hidden="true" />}
      titulo="Não deu para carregar a fila"
      texto={`${causa} Tente de novo; se continuar, avise no grupo do time.`}
    >
      <Button variant="outline" onClick={aoTentar} className="toque h-11 md:h-9">
        <RotateCw aria-hidden="true" />
        Tentar de novo
      </Button>
    </Moldura>
  );
}

/**
 * O cartão de todo estado vazio e de erro do Meu dia, exportado para o "Feito hoje"
 * (`feito-hoje.tsx`) falar com a mesma voz e a mesma forma das outras duas abas.
 */
export function Moldura({
  icone,
  titulo,
  texto,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  /** Nó, e não string: o número de negócios sem dono precisa da IBM Plex Mono. */
  texto: React.ReactNode;
  /** A saída do estado, quando há uma; o vazio de outra pessoa não tem. */
  children?: React.ReactNode;
}) {
  return (
    // Em CARTÃO (29/09/2026), como o vazio de todas as outras telas: solto no
    // cinza, a fila vazia parecia um buraco no meio do Meu dia.
    <div className="sombra-base flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
        {icone}
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">{titulo}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{texto}</p>
      </div>
      {children}
    </div>
  );
}
