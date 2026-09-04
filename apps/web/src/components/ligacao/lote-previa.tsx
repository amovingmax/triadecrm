'use client';

/**
 * A prévia do lote: quantos entram, quem fica de fora e por quê (R13 §3.1).
 *
 * ---------------------------------------------------------------------------
 * Por que a prévia existe
 * ---------------------------------------------------------------------------
 * A montagem é a única decisão do dia que quem liga toma. Depois dela ninguém escolhe
 * mais nada — a fila vem congelada. Um recorte errado só aparece três horas depois, na
 * forma de "por que só ligaram para buffet?". A prévia é o que transforma essa
 * descoberta tardia num número que muda enquanto a pessoa mexe no filtro.
 *
 * E ela diz a verdade sobre o tamanho: "pedi 25, entram 18" é informação; "montado"
 * seguido de uma fila de 18 é uma surpresa. Os motivos da diferença estão todos
 * nomeados (`MENSAGENS_DE_EXCLUSAO`), porque "18" sem "4 estão sem telefone" não
 * ensina nada a quem monta o lote de amanhã.
 *
 * ---------------------------------------------------------------------------
 * O que é recorte e o que é lente
 * ---------------------------------------------------------------------------
 * Duas coisas diferentes moram nesta tela, e confundi-las seria mentir:
 *
 *  * **Recorte** (`RecorteDoLote`) — funil, temperatura de origem e categorias. É o
 *    que `public.montar_lote` recebe, e é o que o banco reserva. Mexer aqui muda o
 *    lote.
 *  * **Lente** (`LenteDaBase`) — cidade, bairro, telefone, tentativas já acumuladas e
 *    tempo sem contato. É leitura: serve para a pessoa entender QUEM está no recorte
 *    antes de montar. Mexer aqui não muda o lote, e a tela escreve isso.
 *
 * A separação não é preciosismo de arquitetura: `montar_lote` aceita funil,
 * temperatura e categorias, e nada mais. Oferecer um filtro de bairro que a montagem
 * ignora produziria um lote diferente do que a tela mostrou — que é exatamente o erro
 * que a prévia existe para evitar.
 */
import { CircleSlash, MapPin, PhoneOff, Repeat2, Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { ChipTemperatura } from '@/components/temperatura';

import { type CandidatoDaBase } from './consultas';
import { MENSAGENS_DE_EXCLUSAO, type MotivoDeExclusao } from './tipos';

// ---------------------------------------------------------------------------
// Recorte, lente e o resultado
// ---------------------------------------------------------------------------

/** As três temperaturas que podem ser origem de um lote (as outras duas são cliente). */
export const TEMPERATURAS_DE_ORIGEM = ['frio', 'morno', 'quente'] as const;
export type TemperaturaDeOrigem = (typeof TEMPERATURAS_DE_ORIGEM)[number];

/**
 * O recorte que vira lote.
 *
 * `temperaturas` é uma lista, e não um valor, DE PROPÓSITO: a regra dura do R13 §3.1 é
 * que um lote não mistura temperaturas, e uma regra que a tela torna impossível de
 * quebrar é uma regra que ninguém entende. Aqui a pessoa consegue marcar duas — e aí a
 * tela mostra o que aconteceria, explica por que a conversão do lote perderia o
 * sentido e não deixa montar até sobrar uma.
 */
export type RecorteDoLote = {
  temperaturas: TemperaturaDeOrigem[];
  categoriaIds: number[];
};

/** Filtro de leitura: muda o que a prévia mostra, nunca o que o banco reserva. */
export type LenteDaBase = {
  cidades: string[];
  bairros: string[];
  telefone: 'todos' | 'com' | 'sem';
  /** Só quem já levou no máximo tantas tentativas em lotes anteriores. */
  tentativasAte: number | null;
  /** Só quem está sem contato há pelo menos tantos dias (quem nunca teve contato entra sempre). */
  paradoHaDias: number | null;
};

export const LENTE_LIMPA: LenteDaBase = {
  cidades: [],
  bairros: [],
  telefone: 'todos',
  tentativasAte: null,
  paradoHaDias: null,
};

export function lenteEstaLimpa(lente: LenteDaBase): boolean {
  return (
    lente.cidades.length === 0 &&
    lente.bairros.length === 0 &&
    lente.telefone === 'todos' &&
    lente.tentativasAte === null &&
    lente.paradoHaDias === null
  );
}

export type PreviaDoLote = {
  /** Quantos estão no recorte, entrando ou não. */
  noRecorte: number;
  /** Quantos entrariam hoje. */
  elegiveis: number;
  /** Quantos vão para o lote de fato: o menor entre elegíveis e tamanho pedido. */
  entram: number;
  /** Quem fica de fora, por motivo, do maior para o menor. */
  excluidos: { motivo: MotivoDeExclusao; quantos: number }[];
  /** Quantos elegíveis por temperatura — é o número que denuncia a mistura. */
  porTemperatura: { temperatura: TemperaturaDeOrigem; quantos: number }[];
  /**
   * Quantos dos elegíveis a lente alcança. Igual a `elegiveis` com a lente limpa.
   *
   * É um número de LEITURA e nunca entra na conta do lote: a montagem não recebe
   * bairro nem tempo parado. Deixar a lente encolher `entram` seria mostrar na tela um
   * lote que o banco não vai montar.
   */
  naLente: number;
  /** Os bairros mais representados entre os elegíveis alcançados pela lente. */
  porBairro: { rotulo: string; quantos: number }[];
  /** As categorias mais representadas entre os elegíveis alcançados pela lente. */
  porCategoria: { rotulo: string; quantos: number }[];
  /** Alguns nomes reais, para a pessoa reconhecer a base que montou. */
  amostra: CandidatoDaBase[];
};

const TAMANHO_DA_AMOSTRA = 5;
const FATIAS_NA_COMPOSICAO = 4;

/** Aplica só a lente (leitura). Separada porque a composição também a usa. */
function passaNaLente(candidato: CandidatoDaBase, lente: LenteDaBase): boolean {
  if (lente.cidades.length > 0 && !(candidato.cidade && lente.cidades.includes(candidato.cidade))) {
    return false;
  }
  if (lente.bairros.length > 0 && !(candidato.bairro && lente.bairros.includes(candidato.bairro))) {
    return false;
  }
  if (lente.telefone === 'com' && !candidato.temTelefone) return false;
  if (lente.telefone === 'sem' && candidato.temTelefone) return false;
  if (lente.tentativasAte !== null && candidato.tentativas > lente.tentativasAte) return false;
  if (
    lente.paradoHaDias !== null &&
    candidato.diasSemContato !== null &&
    candidato.diasSemContato < lente.paradoHaDias
  ) {
    return false;
  }
  return true;
}

/**
 * A prévia, calculada em memória a partir da base já carregada.
 *
 * Pura de propósito: é a mesma conta na tela grande e no celular, ela roda a cada
 * toque no filtro e não pode custar uma ida à rede.
 *
 * A lente entra só depois da conta do lote: `entram` é o que a montagem vai reservar,
 * com lente ou sem ela.
 */
export function calcularPrevia(
  candidatos: readonly CandidatoDaBase[],
  recorte: RecorteDoLote,
  lente: LenteDaBase,
  tamanho: number,
): PreviaDoLote {
  const noRecorte = candidatos.filter((candidato) => {
    if (!ehTemperaturaDeOrigem(candidato.temperatura)) return false;
    if (recorte.temperaturas.length > 0 && !recorte.temperaturas.includes(candidato.temperatura)) {
      return false;
    }
    if (
      recorte.categoriaIds.length > 0 &&
      !candidato.categoriaIds.some((id) => recorte.categoriaIds.includes(id))
    ) {
      return false;
    }
    return true;
  });

  const elegiveis = noRecorte.filter((c) => c.motivo === null);
  const naLente = elegiveis.filter((c) => passaNaLente(c, lente));

  const porMotivo = new Map<MotivoDeExclusao, number>();
  for (const candidato of noRecorte) {
    if (!candidato.motivo) continue;
    porMotivo.set(candidato.motivo, (porMotivo.get(candidato.motivo) ?? 0) + 1);
  }

  return {
    noRecorte: noRecorte.length,
    elegiveis: elegiveis.length,
    entram: Math.min(elegiveis.length, tamanho),
    excluidos: [...porMotivo.entries()]
      .map(([motivo, quantos]) => ({ motivo, quantos }))
      .sort((a, b) => b.quantos - a.quantos),
    porTemperatura: TEMPERATURAS_DE_ORIGEM.map((temperatura) => ({
      temperatura,
      quantos: elegiveis.filter((c) => c.temperatura === temperatura).length,
    })).filter((linha) => linha.quantos > 0),
    naLente: naLente.length,
    porBairro: agrupar(naLente, (c) => c.bairro),
    porCategoria: agrupar(naLente, (c) => c.categoriaNome),
    amostra: [...naLente]
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .slice(0, TAMANHO_DA_AMOSTRA),
  };
}

function ehTemperaturaDeOrigem(temperatura: string): temperatura is TemperaturaDeOrigem {
  return (TEMPERATURAS_DE_ORIGEM as readonly string[]).includes(temperatura);
}

function agrupar(
  candidatos: readonly CandidatoDaBase[],
  campo: (candidato: CandidatoDaBase) => string | null,
): { rotulo: string; quantos: number }[] {
  const contagem = new Map<string, number>();
  for (const candidato of candidatos) {
    const rotulo = campo(candidato) ?? 'Sem informação';
    contagem.set(rotulo, (contagem.get(rotulo) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .map(([rotulo, quantos]) => ({ rotulo, quantos }))
    .sort((a, b) => b.quantos - a.quantos || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
    .slice(0, FATIAS_NA_COMPOSICAO);
}

// ---------------------------------------------------------------------------
// O painel
// ---------------------------------------------------------------------------

function Fatia({ rotulo, quantos, total }: { rotulo: string; quantos: number; total: number }) {
  const porcento = total > 0 ? Math.round((quantos / total) * 100) : 0;
  return (
    <li className="flex min-w-0 items-center gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{rotulo}</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span
          className="block h-full rounded-full bg-foreground/45"
          style={{ width: `${porcento}%` }}
        />
      </span>
      <span className="numerico w-6 text-right text-foreground">{quantos}</span>
    </li>
  );
}

/** Espera com a forma final: o número grande já ocupa o lugar do número grande. */
export function EsqueletoDaPrevia() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4 rounded-xl border p-4">
      <span className="sr-only">Lendo a base de parceiros para montar a prévia.</span>
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-10 w-28" />
      <Skeleton className="h-3.5 w-40" />
      <div className="space-y-2 pt-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}

const ICONES_DE_EXCLUSAO: Partial<Record<MotivoDeExclusao, React.ElementType>> = {
  sem_telefone: PhoneOff,
  nao_contatar: CircleSlash,
  suprimido: CircleSlash,
  reservado_em_outro_lote: Users,
  em_janela_de_recontato: Repeat2,
  sem_negocio_aberto: CircleSlash,
  temperatura_diferente: CircleSlash,
};

export function PainelDaPrevia({
  previa,
  tamanho,
  lenteLigada,
  className,
}: {
  previa: PreviaDoLote;
  tamanho: number;
  /** Quando a lente está ligada, o painel avisa que o número é de leitura. */
  lenteLigada: boolean;
  className?: string;
}) {
  const faltamParaOPedido = tamanho - previa.entram;

  return (
    <section
      aria-live="polite"
      className={cn('flex flex-col gap-4 rounded-xl border bg-card/50 p-4', className)}
    >
      <div>
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Prévia do lote
        </p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="numerico font-heading text-4xl leading-none font-semibold">
            {previa.entram}
          </span>
          <span className="text-sm text-muted-foreground">
            de <span className="numerico">{tamanho}</span> pedidos
          </span>
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          <span className="numerico">{previa.noRecorte}</span> no recorte ·{' '}
          <span className="numerico">{previa.elegiveis}</span>{' '}
          {previa.elegiveis === 1 ? 'pode entrar' : 'podem entrar'}
          {faltamParaOPedido > 0 && previa.elegiveis <= tamanho ? (
            <>
              {' '}
              · faltam <span className="numerico">{faltamParaOPedido}</span> para o tamanho pedido
            </>
          ) : null}
        </p>
      </div>

      {previa.porTemperatura.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          {previa.porTemperatura.map((linha) => (
            <span key={linha.temperatura} className="inline-flex items-center gap-1.5">
              <ChipTemperatura temperatura={linha.temperatura} />
              <span className="numerico text-xs text-muted-foreground">{linha.quantos}</span>
            </span>
          ))}
        </div>
      ) : null}

      {previa.excluidos.length > 0 ? (
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-xs font-medium text-foreground">Ficam de fora</p>
          <ul className="space-y-1">
            {previa.excluidos.map(({ motivo, quantos }) => {
              const Icone = ICONES_DE_EXCLUSAO[motivo] ?? CircleSlash;
              return (
                <li key={motivo} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Icone aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <span className="numerico text-foreground">{quantos}</span>{' '}
                    {MENSAGENS_DE_EXCLUSAO[motivo]}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {lenteLigada ? (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Na lente: <span className="numerico text-foreground">{previa.naLente}</span> dos{' '}
          <span className="numerico text-foreground">{previa.elegiveis}</span> que podem entrar.
          Cidade, bairro, telefone, tentativas e tempo parado são leitura — eles mudam o que você
          está vendo aqui embaixo, não o lote. O que o banco reserva é funil, temperatura e
          categoria.
        </p>
      ) : null}

      {previa.naLente > 0 ? (
        <div className="grid gap-4 border-t pt-3">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium text-foreground">Categorias</p>
            <ul className="space-y-1">
              {previa.porCategoria.map((fatia) => (
                <Fatia
                  key={fatia.rotulo}
                  rotulo={fatia.rotulo}
                  quantos={fatia.quantos}
                  total={previa.naLente}
                />
              ))}
            </ul>
          </div>
          <div className="min-w-0 space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <MapPin aria-hidden="true" className="size-3.5" />
              Bairros
            </p>
            <ul className="space-y-1">
              {previa.porBairro.map((fatia) => (
                <Fatia
                  key={fatia.rotulo}
                  rotulo={fatia.rotulo}
                  quantos={fatia.quantos}
                  total={previa.naLente}
                />
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {previa.amostra.length > 0 ? (
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-xs font-medium text-foreground">
            Quem está no recorte
            <span className="ml-1 font-normal text-muted-foreground">
              (a ordem quem decide é a montagem)
            </span>
          </p>
          <ul className="space-y-0.5">
            {previa.amostra.map((candidato) => (
              <li key={candidato.organizationId} className="text-xs">
                <span className="block truncate text-foreground">{candidato.nome}</span>
                <span className="block truncate text-muted-foreground">
                  {candidato.categoriaNome ?? 'sem categoria'}
                  {candidato.bairro ? ` · ${candidato.bairro}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
