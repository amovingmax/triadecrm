'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Clock } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { PainelProgressoIA } from '../dados-vende';
import {
  decimalFixo,
  deltaDe,
  diaCivil,
  diaMes,
  lista,
  numero,
  oQueMudouNaVersao,
  pct,
  plural,
  versaoCurta,
  type Delta,
  type JeitoDoDelta,
} from '../formatos-vende';
import { Cartao, FUNDO_DA_IA, SemDado, TextoDoDelta } from '../graficos-vende';

/**
 * O efeito de cada versão da IA que atende (16/11/2026). Dono: o agente "versões".
 *
 * Uma linha do tempo vertical, da versão no ar (em cima, com o selo) para as
 * anteriores (mais discretas). Cada versão diz o que mudou e o efeito em dois chips:
 * a nota e quem sai mais interessado, 2 semanas depois × 2 semanas antes.
 *
 * Por que assim:
 *   - o banco mede as 2 semanas depois de cada versão a partir do `desde`; enquanto
 *     elas não fecham, o número é PARCIAL (borda tracejada, delta em cinza e o dia em
 *     que fecha), porque de meia janela não se tira conclusão;
 *   - lado que falta vira palavra, nunca "— →": a primeira versão é o começo da IA
 *     (não tem antes), e a versão sem nenhuma avaliação depois está "medindo";
 *   - fica em meia largura, ao lado das Lacunas: com mais de 4 versões, as mais
 *     antigas ficam atrás de "ver as anteriores", e o texto do que mudou das
 *     anteriores corta em 2 linhas com "mais" (o da versão no ar vai inteiro).
 *
 * Mesmo dado de sempre (`relatorio_imova_painel_ia().versoes`); só o desenho mudou.
 */

const DIA_MS = 86_400_000;
/** A janela do banco: 2 semanas antes e 2 depois do `desde` de cada versão. */
const JANELA_DIAS = 14;
/**
 * Quantas versões aparecem antes do "ver as anteriores". Quatro cabem na altura das
 * Lacunas cheias (5 falhas e o "ver todas"); a partir da 5ª, as mais antigas esperam
 * o clique, para o cartão não crescer sem fim a cada versão nova.
 */
const VISIVEIS = 4;

type Medida = { antes: number | null; depois: number | null };

/** Uma versão já lida: o que a tela precisa, sem conta no meio do JSX. */
type Leitura = {
  chave: string;
  nome: string;
  desde: string;
  oQueMudou: string | null;
  /** Dias de calendário (Natal) no ar: até a próxima versão, ou até hoje na atual. */
  diasNoAr: number;
  atual: boolean;
  primeira: boolean;
  /** As 2 semanas depois já passaram: o "depois" é definitivo. */
  janelaFechada: boolean;
  /** O dia em que a janela fecha ("30/11"). */
  fimDaJanela: string;
  nota: Medida;
  subiu: Medida;
};

export function Versoes({ dados }: { dados: PainelProgressoIA }) {
  // O dado chega pelo navegador (useQuery), então "agora" é o relógio de quem olha.
  const [agora] = useState(() => new Date());
  const [verAnteriores, setVerAnteriores] = useState(false);
  const idDaLista = useId();

  const itens = lerVersoes(dados.versoes, agora);
  const ajuda =
    'Para cada versão: a nota média da avaliação diária (de 1 a 5) e a parte das conversas em que o cliente saiu mais interessado, nas 2 semanas depois de ela entrar no ar, contra as 2 semanas antes. Enquanto essas 2 semanas não fecham, o número é parcial e ainda não dá para tirar conclusão. Se a versão seguinte entrou antes de 2 semanas, o “depois” também conta um pouco dela.';
  const sub = 'Nota e quem sai mais interessado: 2 semanas depois de cada versão × 2 antes.';

  if (itens.length === 0) {
    return (
      <Cartao titulo="Nenhuma versão medida ainda" sub={sub} ajuda={ajuda} secao="versoes">
        <SemDado>A primeira versão aparece aqui quando a IA responder o primeiro cliente.</SemDado>
      </Cartao>
    );
  }

  // Da mais nova para a mais antiga: a que está no ar abre a linha do tempo.
  const ordem = [...itens].reverse();
  const escondidas = ordem.length > VISIVEIS ? ordem.slice(VISIVEIS) : [];
  const mostradas = verAnteriores ? ordem : ordem.slice(0, VISIVEIS);

  return (
    <Cartao titulo={tituloDasVersoes(itens)} sub={sub} ajuda={ajuda} secao="versoes">
      <ol id={idDaLista} aria-label="Versões da IA, da mais nova para a mais antiga" className="flex flex-col">
        {mostradas.map((v, i) => (
          <ItemDaVersao key={v.chave} v={v} ultimo={i === mostradas.length - 1} />
        ))}
      </ol>
      {escondidas.length > 0 ? (
        <button
          type="button"
          aria-expanded={verAnteriores}
          aria-controls={idDaLista}
          onClick={() => setVerAnteriores((x) => !x)}
          className="toque -mt-1 inline-flex min-h-11 items-center gap-1 self-start rounded-md text-[13px] font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-9"
        >
          {verAnteriores
            ? 'Esconder as anteriores'
            : escondidas.length === 1
              ? `Ver a anterior (${escondidas[0]?.nome ?? ''})`
              : `Ver as ${escondidas.length} anteriores (${escondidas
                  .map((e) => e.nome)
                  .reverse()
                  .join(', ')})`}
          <ChevronDown className={cn('size-4 transition-transform', verAnteriores && 'rotate-180')} aria-hidden="true" />
        </button>
      ) : null}
    </Cartao>
  );
}

// ---------------------------------------------------------------------------
// Leitura do dado
// ---------------------------------------------------------------------------

function lerVersoes(bruto: PainelProgressoIA['versoes'] | null | undefined, agora: Date): Leitura[] {
  const ordenadas = lista(bruto)
    .filter((v) => v && typeof v.desde === 'string' && Number.isFinite(Date.parse(v.desde)))
    .slice()
    .sort((a, b) => Date.parse(a.desde) - Date.parse(b.desde));
  const hoje = agora.toISOString();

  return ordenadas.map((v, i) => {
    const proxima = ordenadas[i + 1];
    const inicio = Date.parse(v.desde);
    const fim = inicio + JANELA_DIAS * DIA_MS;
    return {
      chave: `${v.versao}-${v.desde}`,
      nome: versaoCurta(v.versao) || 'versão',
      desde: v.desde,
      oQueMudou: oQueMudouNaVersao(v.versao),
      diasNoAr: diasEntre(v.desde, proxima?.desde ?? hoje),
      atual: i === ordenadas.length - 1,
      primeira: i === 0,
      janelaFechada: fim <= agora.getTime(),
      fimDaJanela: diaMes(new Date(fim).toISOString()),
      nota: { antes: numero(v.nota_antes), depois: numero(v.nota_depois) },
      subiu: { antes: numero(v.subiu_antes), depois: numero(v.subiu_depois) },
    };
  });
}

/** Dias de calendário em Natal entre dois instantes (13/11 → 16/11 = 3). */
function diasEntre(de: string, ate: string): number {
  const a = diaCivil(de);
  const b = diaCivil(ate);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA_MS));
}

/** "3 dias", "3 semanas": a semana entra quando a conta em dias cansa. */
function tempoNoAr(dias: number): string {
  if (dias < JANELA_DIAS) return `${dias} ${plural(dias, 'dia', 'dias')}`;
  const semanas = Math.round(dias / 7);
  return `${semanas} ${plural(semanas, 'semana', 'semanas')}`;
}

/**
 * O título-conclusão: a versão no ar e, se já dá para dizer, a que mais subiu a nota.
 * Só conta versão com as 2 semanas depois fechadas (meia janela não vira manchete).
 */
function tituloDasVersoes(itens: readonly Leitura[]): string {
  const atual = itens[itens.length - 1];
  if (!atual) return 'Nenhuma versão medida ainda';
  const base = `${atual.nome} no ar desde ${diaMes(atual.desde)}`;
  const comparaveis = itens.filter((v) => v.janelaFechada && v.nota.antes !== null && v.nota.depois !== null);

  let melhor: Leitura | null = null;
  let maior = 0;
  for (const v of comparaveis) {
    const d = Math.round(((v.nota.depois ?? 0) - (v.nota.antes ?? 0)) * 10);
    if (d > maior) {
      maior = d;
      melhor = v;
    }
  }

  if (melhor) {
    return melhor === atual
      ? `${atual.nome}, no ar desde ${diaMes(atual.desde)}, foi a que mais subiu a nota`
      : `${base}; a ${melhor.nome} foi a que mais subiu a nota`;
  }
  if (!atual.janelaFechada) return `${base}; o efeito sai em ${atual.fimDaJanela}`;
  if (comparaveis.length === 0) return `${base}; ainda sem antes e depois para comparar`;
  return `${base}; nenhuma versão subiu a nota`;
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

function ItemDaVersao({ v, ultimo }: { v: Leitura; ultimo: boolean }) {
  const semNadaDepois = v.nota.depois === null && v.subiu.depois === null;
  const semNada = semNadaDepois && v.nota.antes === null && v.subiu.antes === null;
  const medindo = semNadaDepois && !v.janelaFechada;
  const parcial = !v.janelaFechada;

  // As observações da linha, em palavras: o lado que falta e a janela aberta.
  const notas: string[] = [];
  if (!medindo && !semNada) {
    const semAntes = v.nota.antes === null && v.subiu.antes === null;
    if (semAntes) notas.push(v.primeira ? 'começo da IA, sem antes para comparar' : 'sem avaliação nas 2 semanas antes');
    if (semNadaDepois) notas.push('sem avaliação nas 2 semanas depois');
    else if (parcial) notas.push(`parcial até ${v.fimDaJanela}`);
  }

  return (
    <li className={cn('relative grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-3', !ultimo && 'pb-5')}>
      {/* O trilho: do ponto desta versão até o da próxima (mais antiga). */}
      {!ultimo ? (
        <span aria-hidden="true" className="absolute top-3 left-[5.5px] h-full w-px bg-(--vende-resto)" />
      ) : null}
      <span aria-hidden="true" className={cn('relative flex items-center justify-center', v.atual ? 'h-6' : 'h-5')}>
        {v.atual ? (
          <span className="size-3 rounded-full bg-(--vende-azul) ring-4 ring-(--vende-azul)/20" />
        ) : (
          <span className="size-2.5 rounded-full border-2 border-(--vende-resto) bg-card" />
        )}
      </span>

      <div className="flex min-w-0 flex-col gap-2">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={cn('numerico leading-6 font-semibold', v.atual ? 'text-[17px]' : 'text-[14px] leading-5')}>
            {v.nome}
          </span>
          {v.atual ? (
            <span
              className={cn(
                'inline-flex h-5 items-center gap-1 self-center rounded-full px-2 text-[11px] font-semibold',
                FUNDO_DA_IA,
              )}
            >
              <span className="size-1.5 rounded-full bg-(--vende-azul)" aria-hidden="true" />
              no ar
            </span>
          ) : null}
          <span className="numerico text-xs text-muted-foreground">
            desde {diaMes(v.desde)}
            {v.atual
              ? v.diasNoAr === 0
                ? ' · entrou hoje'
                : ` · há ${tempoNoAr(v.diasNoAr)}`
              : ` · ficou ${tempoNoAr(v.diasNoAr)} no ar`}
          </span>
        </p>

        {v.oQueMudou ? <OQueMudou texto={v.oQueMudou} cortar={!v.atual} /> : null}

        {medindo ? (
          <p className="inline-flex items-start gap-1.5 self-start rounded-md border border-dashed border-(--vende-traco)/60 px-2.5 py-1.5 text-xs leading-snug text-muted-foreground">
            <Clock className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Medindo: precisa de 2 semanas no ar · resultado em <span className="numerico">{v.fimDaJanela}</span>
            </span>
          </p>
        ) : semNada ? (
          <p className="text-xs text-muted-foreground">Sem avaliação nas semanas em volta.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <ChipDoEfeito
              rotulo="Nota"
              medida={v.nota}
              formato={decimalFixo}
              jeito="nota"
              parcial={parcial}
              grande={v.atual}
            />
            <ChipDoEfeito
              rotulo="Mais interessados"
              medida={v.subiu}
              formato={pct}
              jeito="pontos"
              parcial={parcial}
              grande={v.atual}
            />
            {notas.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {/* Cada observação inteira numa linha: no celular, a quebra cai no " · ". */}
                {notas.map((n, i) => (
                  <span key={n}>
                    {i > 0 ? ' · ' : null}
                    <span className="whitespace-nowrap">{n}</span>
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Um chip do efeito: "Nota 3,8 → 4,1 ▲ 0,3". O "depois" em tinta (é o que importa),
 * o "antes" em cinza. Na janela aberta, borda tracejada e o delta perde a cor: a seta
 * e o texto continuam, o verde/vermelho espera as 2 semanas fecharem.
 */
function ChipDoEfeito({
  rotulo,
  medida,
  formato,
  jeito,
  parcial,
  grande,
}: {
  rotulo: string;
  medida: Medida;
  formato: (v: number) => string;
  jeito: JeitoDoDelta;
  parcial: boolean;
  grande: boolean;
}) {
  const { antes, depois } = medida;
  const valor = cn('numerico font-semibold text-foreground', grande ? 'text-[15px]' : 'text-[13px]');
  const caixa = cn(
    'inline-flex items-baseline gap-x-1.5 rounded-md border bg-muted/60 px-2.5 py-1 text-xs',
    parcial ? 'border-dashed border-(--vende-traco)/60' : 'border-transparent',
  );

  if (depois === null) {
    return (
      <span className={caixa}>
        <span className="text-muted-foreground">{rotulo}</span>
        <span className="text-muted-foreground">sem avaliação depois</span>
      </span>
    );
  }

  if (antes === null) {
    return (
      <span className={caixa}>
        <span className="text-muted-foreground">{rotulo}</span>
        <span className={valor}>{formato(depois)}</span>
      </span>
    );
  }

  const bruto = deltaDe(depois, antes, jeito);
  const delta: Delta | null =
    bruto && parcial ? { ...bruto, tom: 'neutro', leitura: `${bruto.leitura}, parcial` } : bruto;

  return (
    <span className={caixa}>
      <span className="text-muted-foreground">{rotulo}</span>
      <span aria-hidden="true" className="flex items-baseline gap-x-1">
        <span className="numerico text-muted-foreground">{formato(antes)}</span>
        <span className="text-muted-foreground">→</span>
        <span className={valor}>{formato(depois)}</span>
      </span>
      <span className="sr-only">
        : {formato(antes)} nas 2 semanas antes, {formato(depois)} nas 2 semanas depois
      </span>
      <TextoDoDelta delta={delta} />
    </span>
  );
}

/**
 * O que a versão mudou. Nas anteriores, corta em 2 linhas e mostra "mais" só quando
 * cortou de verdade (medido no navegador, porque depende da largura). O texto inteiro
 * continua no DOM: o leitor de tela lê tudo, com ou sem o corte.
 */
function OQueMudou({ texto, cortar }: { texto: string; cortar: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [cortado, setCortado] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !cortar || aberto || typeof ResizeObserver === 'undefined') return;
    const medir = () => setCortado(el.scrollHeight > el.clientHeight + 1);
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [cortar, aberto]);

  return (
    <div className="flex flex-col items-start gap-0.5">
      <p
        ref={ref}
        id={id}
        className={cn(
          'text-[13px] leading-snug',
          cortar ? 'text-muted-foreground' : 'text-foreground',
          cortar && !aberto && 'line-clamp-2',
        )}
      >
        {texto}
      </p>
      {cortar && (cortado || aberto) ? (
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={id}
          onClick={() => setAberto((x) => !x)}
          className="relative rounded-sm text-xs font-semibold underline-offset-4 after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-[''] hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {aberto ? 'menos' : 'mais'}
        </button>
      ) : null}
    </div>
  );
}
