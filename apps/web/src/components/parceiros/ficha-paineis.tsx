import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  FileText,
  ListChecks,
  MapPin,
  NotebookPen,
  Sparkles,
  SquareKanban,
  Video,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import {
  arcoDaNota,
  contagemDosPassos,
  quando,
  type Atividade,
  type ItemDeAtividade,
  type LeituraDaFicha,
  type Passo,
  type ProximosPassos,
  type Quando,
  type TipoDeAtividade,
} from './paineis-da-ficha';

/**
 * Os três painéis da ficha do parceiro: a leitura da IA, a atividade e os
 * próximos passos (entrega 2 da ficha nova, 02/10/2026).
 *
 * São componentes de servidor e só desenham: o que cada um diz já chega decidido
 * de `paineis-da-ficha.ts`, que tem teste. Nenhum deles tem botão que grave — as
 * saídas são links para onde a ação mora (Conversas, a sala da reunião).
 *
 * A MENTA aparece em três lugares, e nos três ela marca "isto pede você": o arco
 * da nota, a sugestão e o que chegou do parceiro. Não é a escala térmica: a
 * temperatura continua sendo a do chip do cabeçalho, e a nota da IA não é ela.
 */

const CARTAO = 'sombra-base flex min-w-0 flex-col gap-4 rounded-xl bg-card p-5 md:p-6';
const TITULO = 'text-[15px] font-semibold tracking-[-0.01em]';
const AO_LADO = 'text-[12.5px] leading-snug text-muted-foreground';

/** O ladrilho do ícone, o mesmo das linhas do cartão de contato. */
function Ladrilho({
  icone: Icone,
  destaque = false,
  redondo = false,
}: {
  icone: LucideIcon;
  destaque?: boolean;
  redondo?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-[38px] shrink-0 items-center justify-center',
        redondo ? 'rounded-full' : 'rounded-lg',
        destaque ? 'bg-menta-fundo text-menta-texto' : 'bg-foreground/[0.07] text-muted-foreground',
      )}
    >
      <Icone className="size-[17px]" strokeWidth={1.75} />
    </span>
  );
}

/** A data em pedaços: só os dígitos em `numerico`. */
function Data({ quando: q }: { quando: Quando }) {
  return (
    <span title={q.texto}>
      {q.palavra}
      {q.data ? <span className="numerico">{q.data}</span> : null}
      {q.hora ? (
        <>
          {q.palavra === '' ? ' ' : ' às '}
          <span className="numerico">{q.hora}</span>
        </>
      ) : null}
    </span>
  );
}

function NaoCarregou({ titulo }: { titulo: string }) {
  return (
    <section className={CARTAO}>
      <h2 className={TITULO}>{titulo}</h2>
      <p className="text-sm text-muted-foreground">
        Não deu para carregar agora. Recarregue a página para tentar de novo.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// A leitura da IA
// ---------------------------------------------------------------------------

/**
 * A leitura da IA sobre a conversa do parceiro: a nota de 0 a 100, o resumo, as
 * etiquetas e a sugestão do próximo passo.
 *
 * A ficha não pede leitura nenhuma à IA: mostra a que o worker já gravou. Sem
 * leitura, o cartão encolhe para uma frase — e a frase diz POR QUE não há, para
 * ninguém ficar esperando um número que não vem.
 */
export function LeituraDaIaNaFicha({
  dados,
  temConversa,
  className,
}: {
  dados: { leitura: LeituraDaFicha | null; moduloLigado: boolean | null } | null;
  temConversa: boolean;
  className?: string;
}) {
  if (dados === null) return <NaoCarregou titulo="Leitura da IA" />;
  const { leitura, moduloLigado } = dados;

  const cabecalho = (aoLado?: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3">
      <h2 className={cn(TITULO, 'flex items-center gap-2')}>
        <Sparkles className="size-4" aria-hidden="true" strokeWidth={1.75} />
        Leitura da IA
      </h2>
      {aoLado}
    </div>
  );

  if (leitura === null || leitura.curtaDemais) {
    return (
      <section className={cn(CARTAO, 'gap-2.5', className)} aria-label="Leitura da IA">
        {cabecalho()}
        <p className="max-w-prose text-sm text-muted-foreground">
          {leitura?.curtaDemais
            ? 'A conversa ainda é curta demais para uma leitura.'
            : !temConversa
              ? 'Ainda não há conversa com este parceiro para a IA ler.'
              : moduloLigado === false
                ? 'A leitura da IA está desligada. Quando for ligada, a nota de 0 a 100, o resumo e a sugestão desta conversa aparecem aqui.'
                : 'Ainda sem leitura desta conversa. Ela aparece alguns minutos depois de o parceiro escrever.'}
        </p>
      </section>
    );
  }

  const agora = new Date();

  return (
    <section className={cn(CARTAO, className)} aria-label="Leitura da IA">
      {cabecalho(
        leitura.analisadaEm ? (
          <span className={cn(AO_LADO, 'text-right')}>
            atualizada <Data quando={quando(leitura.analisadaEm, agora, true)} />
          </span>
        ) : null,
      )}

      <div className="flex items-start gap-4 md:items-center md:gap-[22px]">
        {leitura.nota !== null ? <Nota nota={leitura.nota} faixa={leitura.faixa} /> : null}
        <div className="flex min-w-0 flex-col gap-2.5">
          {leitura.resumo ? (
            <p className="text-[14.5px] leading-normal md:text-[15px]">{leitura.resumo}</p>
          ) : null}
          {leitura.etiquetas.length > 0 ? (
            <ul className="flex flex-wrap gap-[7px]">
              {leitura.etiquetas.map((e, i) => (
                <li
                  key={`${e.rotulo}-${i}`}
                  className="inline-flex min-h-[26px] items-center gap-1.5 rounded-full bg-foreground/[0.07] px-2.5 py-0.5 text-[12.5px] text-muted-foreground"
                >
                  {e.rotulo}
                  <span className="font-medium text-foreground">{e.valor}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {leitura.sugestao ? (
        <p className="flex items-start gap-2.5 rounded-lg bg-menta-fundo px-3.5 py-3 text-sm leading-snug">
          <ArrowRight
            className="mt-0.5 size-4 shrink-0 text-menta-texto"
            aria-hidden="true"
            strokeWidth={2}
          />
          <span>
            <span className="font-semibold">Sugestão:</span> {leitura.sugestao}
          </span>
        </p>
      ) : null}

      {leitura.desatualizada ? (
        <p className="text-[12.5px] text-muted-foreground">
          O parceiro escreveu depois desta leitura: ela ainda não considera as últimas mensagens.
        </p>
      ) : null}
    </section>
  );
}

/**
 * O medidor: um arco que a nota preenche, com o número no centro. O número é o
 * que se lê (72 e 76 decidem coisas diferentes); o arco dá a faixa de relance.
 */
function Nota({ nota, faixa }: { nota: number; faixa: string | null }) {
  const RAIO = 38;
  const { perimetro, preenchido } = arcoDaNota(nota, RAIO);

  return (
    <div
      role="img"
      aria-label={`Intenção de fechar: ${nota} de 100${faixa ? `, ${faixa}` : ''}`}
      title="Quanto a conversa indica intenção de fechar, de 0 a 100. Não é a temperatura: essa continua sendo a do CRM."
      className="relative size-[68px] shrink-0 md:size-[84px]"
    >
      <svg viewBox="0 0 84 84" className="size-full -rotate-90" aria-hidden="true">
        <circle
          cx="42"
          cy="42"
          r={RAIO}
          fill="none"
          strokeWidth="7"
          className="stroke-foreground/10"
        />
        <circle
          cx="42"
          cy="42"
          r={RAIO}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${preenchido} ${perimetro}`}
          className="stroke-menta"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="numerico text-[22px] font-semibold tracking-[-0.03em] md:text-[27px]">
          {nota}
        </span>
        <span className="mt-[3px] text-[10px] text-muted-foreground">
          de <span className="numerico">100</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atividade
// ---------------------------------------------------------------------------

const ICONE_DA_ATIVIDADE: Record<TipoDeAtividade, LucideIcon> = {
  recebida: ArrowDown,
  enviada: ArrowUp,
  interacao: NotebookPen,
  etapa: SquareKanban,
  origem: FileText,
};

/**
 * O que aconteceu por último com o parceiro: mensagens, registros de contato e
 * mudanças de etapa, do mais novo para o mais antigo. As últimas cinco; a
 * conversa inteira está a um toque.
 */
export function AtividadeDaFicha({
  atividade,
  organizationId,
  className,
}: {
  atividade: Atividade | null;
  organizationId: string;
  className?: string;
}) {
  if (atividade === null) return <NaoCarregou titulo="Atividade" />;
  const agora = new Date();

  return (
    <section className={cn(CARTAO, className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={TITULO}>Atividade</h2>
        <Link
          href={`/conversas?org=${organizationId}`}
          className="toque inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline md:min-h-0"
        >
          Abrir a conversa
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {atividade.itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada registrado com este parceiro ainda.</p>
      ) : (
        <ol className="flex flex-col">
          {atividade.itens.map((item, i) => (
            <LinhaDeAtividade
              key={item.id}
              item={item}
              agora={agora}
              ultima={i === atividade.itens.length - 1}
            />
          ))}
        </ol>
      )}

      {atividade.haMais ? (
        <p className="border-t border-hairline pt-3.5 text-[13px] text-muted-foreground">
          Estas são as últimas. O histórico inteiro está na conversa.
        </p>
      ) : null}
    </section>
  );
}

function LinhaDeAtividade({
  item,
  agora,
  ultima,
}: {
  item: ItemDeAtividade;
  agora: Date;
  ultima: boolean;
}) {
  return (
    <li className={cn('relative flex min-w-0 gap-3.5', !ultima && 'pb-5')}>
      {/* O fio que liga uma linha à seguinte: é ele que faz a lista ser lida
          como sequência, e não como cinco avisos soltos. */}
      {!ultima ? (
        <span
          aria-hidden="true"
          className="absolute top-10 bottom-0.5 left-[18.5px] w-px bg-hairline"
        />
      ) : null}
      <Ladrilho icone={ICONE_DA_ATIVIDADE[item.tipo]} destaque={item.tipo === 'recebida'} redondo />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 text-[14.5px] leading-snug font-medium">{item.titulo}</p>
          <time dateTime={item.em} className="shrink-0 text-[12.5px] text-muted-foreground">
            <Data quando={quando(item.em, agora, true)} />
          </time>
        </div>
        {item.detalhe ? (
          <p className="line-clamp-2 text-[13.5px] leading-snug break-words text-muted-foreground">
            {item.citacao ? `“${item.detalhe}”` : item.detalhe}
          </p>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Próximos passos
// ---------------------------------------------------------------------------

/**
 * O que está marcado com o parceiro: reuniões de pé e tarefas abertas.
 *
 * SÓ LISTA. A única ação é abrir a sala da reunião, que é um link. Concluir
 * tarefa e registrar o resultado da reunião continuam na Agenda e no Meu dia.
 */
export function ProximosPassosDaFicha({
  passos,
  className,
}: {
  passos: ProximosPassos | null;
  className?: string;
}) {
  if (passos === null) return <NaoCarregou titulo="Próximos passos" />;
  const contagem = contagemDosPassos(passos);

  return (
    <section className={cn(CARTAO, className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={TITULO}>Próximos passos</h2>
        {contagem ? <span className={cn(AO_LADO, 'numerico')}>{contagem}</span> : null}
      </div>

      {passos.passos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma reunião ou tarefa aberta com este parceiro.
        </p>
      ) : (
        <ul className="flex flex-col">
          {passos.passos.map((passo) => (
            <LinhaDePasso key={passo.id} passo={passo} />
          ))}
        </ul>
      )}

      {passos.ocultos > 0 ? (
        <p className="border-t border-hairline pt-3.5 text-[13px] text-muted-foreground">
          E mais <span className="numerico">{passos.ocultos}</span> na{' '}
          <Link href="/agenda" className="text-foreground underline underline-offset-4">
            Agenda
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}

function LinhaDePasso({ passo }: { passo: Passo }) {
  const reuniao = passo.tipo === 'reuniao';
  // Na reunião a hora é a informação; na tarefa o prazo fica à direita, onde o
  // olho procura "para quando".
  const prazoADireita = !reuniao && passo.quando !== null;

  return (
    <li className="flex min-w-0 items-center gap-3.5 border-t border-hairline py-3 first:border-t-0 first:pt-0 last:pb-0">
      <Ladrilho
        icone={reuniao ? (passo.presencial ? MapPin : Video) : ListChecks}
        destaque={reuniao && passo.selo !== 'aguarda resultado'}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[15px] leading-snug font-medium break-words">{passo.titulo}</p>
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          {reuniao && passo.quando ? (
            <>
              <Data quando={passo.quando} />
              {passo.apoio ? ` · ${passo.apoio}` : null}
            </>
          ) : (
            passo.apoio
          )}
        </p>
      </div>

      {passo.sala ? (
        <Button
          asChild
          variant="outline"
          className="toque h-11 shrink-0 px-3.5 text-[13.5px] md:h-[34px]"
        >
          <a href={passo.sala} target="_blank" rel="noopener noreferrer">
            Abrir a sala
          </a>
        </Button>
      ) : passo.selo ? (
        <span
          className="shrink-0 rounded-full bg-foreground/10 px-2.5 py-0.5 text-[12.5px] font-medium whitespace-nowrap"
          title={prazoADireita && passo.quando ? passo.quando.texto : undefined}
        >
          {passo.selo}
        </span>
      ) : prazoADireita && passo.quando ? (
        <span className="shrink-0 text-[12.5px] whitespace-nowrap text-muted-foreground">
          <Data quando={passo.quando} />
        </span>
      ) : null}
    </li>
  );
}
