'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  Bot,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Funnel,
  HandCoins,
  Inbox,
  LayoutDashboard,
  MapPin,
  MessageCircle,
  Newspaper,
  PhoneCall,
  Shapes,
  Signpost,
  Thermometer,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

import {
  faixaDoPeriodo,
  hojeEmNatal,
  periodoDe,
  periodoValido,
  PERIODOS_EM_ORDEM,
  ROTULO_PERIODO,
  type ChavePeriodo,
  type Periodo,
} from './periodo';
import { PAINEIS, type ChavePainel, type DefinicaoPainel } from './tipos';

/**
 * O recorte da tela: qual leitura e de qual período.
 *
 * Os dois seletores são fila de botões, e não `select`: com seis a dez leituras e
 * cinco períodos, um menu escondido custa dois toques a mais em toda troca, e esta é
 * a tela em que se troca de recorte o tempo inteiro. Quando a fila não cabe, ela rola
 * na horizontal (a página nunca rola de lado) e todo botão tem 44px de altura no
 * celular.
 */

/**
 * O ícone de cada leitura. Os que já existem no menu lateral são os MESMOS de lá
 * (o prédio dos Anúncios nos Imóveis, o robô da IA que atende no Progresso da IA, o
 * telefone dos Lotes nas Ligações do dia): quem reconhece o desenho no menu
 * reconhece aqui. `Record` fechado: leitura nova sem ícone não compila.
 */
const ICONE_DO_PAINEL: Record<ChavePainel, LucideIcon> = {
  visao: LayoutDashboard,
  imoveis: Building2,
  oportunidades: HandCoins,
  funil_equipe: Funnel,
  progresso_ia: Bot,
  canais: Signpost,
  ligacoes: PhoneCall,
  atendimento: MessageCircle,
  semana: Newspaper,
  funil: Funnel,
  categorias: Shapes,
  bairros: MapPin,
  pessoas: Users,
  horarios: Clock,
  fontes: Inbox,
  base: Thermometer,
};

/** O `id` da aba de uma leitura, para o painel dizer por qual aba ele é rotulado. */
export function idDaAba(prefixo: string, chave: ChavePainel): string {
  return `${prefixo}-aba-${chave}`;
}

/**
 * Quanto ainda há para rolar de cada lado de uma fila que rola na horizontal. É o
 * que acende o esmaecido (e a seta, no computador) só do lado em que há mais coisa:
 * a máscara fixa à direita de antes continuava lá depois de a pessoa chegar ao fim, e
 * no começo não avisava nada à esquerda.
 *
 * A primeira medida vem do próprio `ResizeObserver`, que dispara ao começar a
 * observar; e ele continua medindo quando a tela gira ou a fonte termina de carregar.
 */
function useRolagemLateral<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [lados, setLados] = useState({ esquerda: false, direita: false });

  useEffect(() => {
    const fila = ref.current;
    if (!fila) return;
    const medir = () => {
      const esquerda = fila.scrollLeft > 1;
      const direita = fila.scrollLeft + fila.clientWidth < fila.scrollWidth - 1;
      setLados((antes) =>
        antes.esquerda === esquerda && antes.direita === direita ? antes : { esquerda, direita },
      );
    };
    fila.addEventListener('scroll', medir, { passive: true });
    const observador = new ResizeObserver(medir);
    observador.observe(fila);
    if (fila.firstElementChild) observador.observe(fila.firstElementChild);
    return () => {
      fila.removeEventListener('scroll', medir);
      observador.disconnect();
    };
  }, []);

  return [ref, lados] as const;
}

/** A máscara que esmaece só a borda em que ainda há o que rolar. */
function mascaraDasBordas(lados: { esquerda: boolean; direita: boolean }) {
  if (!lados.esquerda && !lados.direita) return undefined;
  const inicio = lados.esquerda ? 'transparent, black 2.5rem' : 'black';
  const fim = lados.direita ? 'black calc(100% - 2.5rem), transparent' : 'black';
  const mascara = `linear-gradient(to right, ${inicio}, ${fim})`;
  return { maskImage: mascara, WebkitMaskImage: mascara };
}

function movimentoReduzido() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A barra de abas das leituras (16/11/2026).
 *
 * ABAS COM SUBLINHADO, e não pílula: até aqui a aba ativa era uma pílula laranja
 * cheia dentro de um cartão, o elemento mais forte da tela antes do primeiro
 * número. Esta barra é a navegação da página (a mesma pergunta das abas de um
 * produto de análise: "qual relatório estou vendo"), então ela fala baixo: o nome
 * ativo em tinta e semibold, os outros em cinza, e a marca (o laranja na Imova, a
 * menta na KOMUNE) só no traço de 2px embaixo. O traço usa `--menta-texto`, o tom da
 * marca que passa como texto sobre o fundo: no claro, a menta cheia some sobre o
 * branco. E a aba ativa nunca é dita só pela cor: o peso e a tinta do nome mudam
 * junto.
 *
 * É uma lista de abas de verdade (`tablist` / `tab`, `aria-selected`) com o painel
 * em `tabpanel` (em `tela-relatorios.tsx`). Teclado como o da WAI-ARIA, com
 * ATIVAÇÃO MANUAL: Tab entra na aba ativa e sai da barra; as setas, Home e End só
 * movem o foco; Enter ou espaço abre. Abrir na seta faria uma consulta ao banco a
 * cada tecla, e cada leitura demora a chegar.
 *
 * Quando as abas não cabem (as dez da KOMUNE num computador estreito, as seis da
 * Imova no celular), a fila rola de lado: a borda esmaece do lado em que há mais aba
 * e, no computador, aparece uma seta para rolar com o mouse. A aba ativa é trazida
 * para dentro da faixa ao abrir e a cada troca (um link com `?painel=base` abre com
 * "Base" à vista).
 */
export function SeletorDePainel({
  painel,
  aoTrocar,
  prefixo,
  paineis = PAINEIS,
}: {
  painel: ChavePainel;
  aoTrocar: (chave: ChavePainel) => void;
  /** Base dos `id` das abas e do painel (`useId` da tela), para o `aria-controls`. */
  prefixo: string;
  /**
   * As leituras da barra; o padrão é a lista desta empresa. Outra lista serve para
   * conferir a barra comprida da KOMUNE (`paineisDaEmpresa(false)`) de dentro da Imova.
   */
  paineis?: readonly DefinicaoPainel[];
}) {
  const [fila, lados] = useRolagemLateral<HTMLDivElement>();
  const abas = useRef(new Map<ChavePainel, HTMLButtonElement>());

  // Traz a aba ativa para dentro da faixa, com folga para ela não ficar debaixo do
  // esmaecido. `scrollTo` na própria fila, e não `scrollIntoView`, que também rolaria
  // a página na vertical.
  useEffect(() => {
    const faixa = fila.current;
    const aba = abas.current.get(painel);
    if (!faixa || !aba) return;
    const folga = 48;
    const esquerda = aba.offsetLeft - folga;
    const direita = aba.offsetLeft + aba.offsetWidth + folga - faixa.clientWidth;
    const comportamento = movimentoReduzido() ? 'auto' : 'smooth';
    if (faixa.scrollLeft > esquerda) faixa.scrollTo({ left: Math.max(0, esquerda), behavior: comportamento });
    else if (faixa.scrollLeft < direita) faixa.scrollTo({ left: direita, behavior: comportamento });
  }, [painel, fila]);

  const rolar = useCallback(
    (sentido: -1 | 1) => {
      const faixa = fila.current;
      if (!faixa) return;
      faixa.scrollBy({
        left: sentido * faixa.clientWidth * 0.7,
        behavior: movimentoReduzido() ? 'auto' : 'smooth',
      });
    },
    [fila],
  );

  const aoTeclar = (evento: KeyboardEvent<HTMLDivElement>) => {
    const ordem = paineis.map((p) => p.chave);
    const atual = ordem.findIndex((chave) => abas.current.get(chave) === document.activeElement);
    if (atual < 0) return;
    const destino =
      evento.key === 'ArrowRight'
        ? (atual + 1) % ordem.length
        : evento.key === 'ArrowLeft'
          ? (atual - 1 + ordem.length) % ordem.length
          : evento.key === 'Home'
            ? 0
            : evento.key === 'End'
              ? ordem.length - 1
              : null;
    if (destino === null) return;
    evento.preventDefault();
    const chave = ordem[destino];
    if (chave) abas.current.get(chave)?.focus();
  };

  return (
    // `-ml-3.5`: o ícone da primeira aba alinha com o título da página, e não com a
    // borda da pastilha de passar o mouse (os 14px de folga dela ficam na margem).
    <div className="relative -ml-3.5">
      <div
        ref={fila}
        role="tablist"
        aria-label="Leituras do relatório"
        aria-orientation="horizontal"
        onKeyDown={aoTeclar}
        style={mascaraDasBordas(lados)}
        // `relative`: é a referência do `offsetLeft` das abas. Sem barra de rolagem
        // à vista: o esmaecido e as setas dizem que rola, e a barra cinza do sistema
        // por cima do traço da aba ativa parecia um segundo sublinhado.
        className="relative flex overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {paineis.map((definicao) => {
          const ativo = definicao.chave === painel;
          const Icone = ICONE_DO_PAINEL[definicao.chave];
          return (
            <button
              key={definicao.chave}
              ref={(no) => {
                if (no) abas.current.set(definicao.chave, no);
                else abas.current.delete(definicao.chave);
              }}
              type="button"
              role="tab"
              id={idDaAba(prefixo, definicao.chave)}
              aria-selected={ativo}
              aria-controls={`${prefixo}-painel`}
              tabIndex={ativo ? 0 : -1}
              onClick={() => aoTrocar(definicao.chave)}
              // A área do clique é a altura inteira da barra (44px, o alvo de toque);
              // o realce de passar o mouse e o anel do foco ficam na pastilha de
              // dentro, para não encostar no traço.
              className="group/aba toque relative flex h-11 shrink-0 items-center px-1 outline-none md:h-12"
            >
              <span
                className={cn(
                  'flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm whitespace-nowrap transition-colors',
                  'group-hover/aba:bg-muted group-hover/aba:text-foreground dark:group-hover/aba:bg-muted/60',
                  'group-focus-visible/aba:ring-3 group-focus-visible/aba:ring-ring/50',
                  ativo ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
                )}
              >
                {/* Sem ícone no celular: lá a fila rola, e sem os 24px de cada ícone a
                    aba seguinte aparece cortada na borda, que é o sinal mais claro de
                    que há mais para o lado. */}
                <Icone
                  aria-hidden="true"
                  className={cn('hidden size-4 shrink-0 sm:block', ativo ? 'opacity-100' : 'opacity-70')}
                  strokeWidth={ativo ? 2.25 : 2}
                />
                {definicao.rotulo}
              </span>
              {ativo ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3.5 bottom-0 h-0.5 rounded-full bg-menta-texto"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* As setas só no computador, e só do lado em que há o que rolar: no celular
          arrastar com o dedo é o natural, e o esmaecido já avisa. Fora do teclado e
          do leitor de tela (`aria-hidden`, `tabIndex -1`): lá as setas do teclado
          movem o foco e a faixa acompanha sozinha. */}
      <SetaDeRolar lado="esquerda" visivel={lados.esquerda} aoRolar={() => rolar(-1)} />
      <SetaDeRolar lado="direita" visivel={lados.direita} aoRolar={() => rolar(1)} />
    </div>
  );
}

function SetaDeRolar({
  lado,
  visivel,
  aoRolar,
}: {
  lado: 'esquerda' | 'direita';
  visivel: boolean;
  aoRolar: () => void;
}) {
  if (!visivel) return null;
  const Icone = lado === 'esquerda' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-hidden="true"
      tabIndex={-1}
      onClick={aoRolar}
      className={cn(
        'absolute inset-y-0 my-auto hidden size-8 items-center justify-center rounded-full border border-hairline bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground md:flex',
        lado === 'esquerda' ? 'left-2.5' : '-right-1',
      )}
    >
      <Icone className="size-4" />
    </button>
  );
}

/**
 * O período (16/11/2026): um controle segmentado discreto numa linha só, com a faixa
 * de datas ao lado. Era uma fila de botões soltos e, embaixo, uma linha inteira para
 * "Período: …, no fuso de Natal.": duas linhas para dizer uma coisa.
 *
 * Segmentado e cinza, e não sublinhado e laranja como as abas, de propósito: a aba é
 * o LUGAR (qual relatório), o período é o FILTRO (de quando). Se os dois falassem
 * igual, as duas escolhas não se distinguiriam, que foi o problema de 29/09/2026.
 */
export function BarraDePeriodo({
  periodo,
  aoTrocar,
}: {
  periodo: Periodo;
  aoTrocar: (novo: Periodo) => void;
}) {
  const idDe = useId();
  const idAte = useId();
  const hoje = hojeEmNatal();
  const valido = periodoValido(periodo);
  const [fila, lados] = useRolagemLateral<HTMLDivElement>();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* No celular os cinco não cabem em 390px: a fila rola de lado, com a borda
            esmaecida do lado em que há mais. */}
        <div ref={fila} className="-mx-1 max-w-full overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={mascaraDasBordas(lados)}>
          <div
            className="flex w-max items-center gap-0.5 rounded-xl bg-muted p-0.5 dark:bg-muted/70"
            role="group"
            aria-label="Período"
          >
            {PERIODOS_EM_ORDEM.map((chave: ChavePeriodo) => {
              const ativo = periodo.chave === chave;
              return (
                <button
                  key={chave}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => aoTrocar(periodoDe(chave, hoje, periodo))}
                  className={cn(
                    'toque h-11 rounded-[10px] px-3 text-[13px] whitespace-nowrap transition-colors outline-none md:h-7',
                    'focus-visible:ring-3 focus-visible:ring-ring/50',
                    ativo
                      ? 'bg-card font-semibold text-foreground shadow-sm dark:bg-secondary'
                      : 'font-medium text-muted-foreground hover:text-foreground',
                  )}
                >
                  {ROTULO_PERIODO[chave]}
                </button>
              );
            })}
          </div>
        </div>

        {periodo.chave === 'personalizado' ? (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={idDe} className="text-xs text-muted-foreground">
              De
            </label>
            <Input
              id={idDe}
              type="date"
              value={periodo.de}
              max={periodo.ate}
              onChange={(evento) => aoTrocar({ ...periodo, de: evento.target.value })}
              className="numerico h-11 w-40 md:h-8"
            />
            <label htmlFor={idAte} className="text-xs text-muted-foreground">
              até
            </label>
            <Input
              id={idAte}
              type="date"
              value={periodo.ate}
              min={periodo.de}
              max={hoje}
              onChange={(evento) => aoTrocar({ ...periodo, ate: evento.target.value })}
              className="numerico h-11 w-40 md:h-8"
            />
          </div>
        ) : (
          // A frase da regra continua no `title`: ela vale para a tela toda e ninguém
          // a relê depois da primeira vez. O que muda — as datas — fica escrito.
          <p
            className="text-xs text-muted-foreground"
            title="Todo número desta tela obedece a este período, menos onde a tabela avisar o contrário."
          >
            <span className="numerico text-foreground/80">{faixaDoPeriodo(periodo)}</span>
            <span> · fuso de Natal</span>
          </p>
        )}
      </div>

      {periodo.chave === 'personalizado' && !valido ? (
        <p className="text-xs text-muted-foreground">
          A data inicial precisa vir antes da final. Enquanto isso, o relatório continua
          mostrando o último período válido.
        </p>
      ) : null}
    </div>
  );
}
