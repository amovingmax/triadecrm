'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import type { FaixaDePassagem, PainelProgressoIA } from '../dados-vende';
import {
  contagem,
  FAIXAS_DE_PASSAGEM,
  inteiro,
  lista,
  minutos,
  numero,
  parteDe,
  plural,
  rotuloDaFaixaDePassagem,
} from '../formatos-vende';
import { ALVO, Cartao, Dica, SemDado } from '../graficos-vende';

/**
 * Onde a IA depende da equipe (16/11/2026). Dono: o agente "passagem".
 *
 * Quando a IA passa a conversa para uma pessoa, quanto a equipe demora para responder
 * e o que aconteceu com esses leads. O desenho, de cima para baixo da leitura:
 *   1. a mediana em número grande, com o total passado e quantos passaram de 2 h;
 *   2. uma barra só, 100%, com as faixas lado a lado, do rápido ao lento: o pedaço
 *      quente é quem esperou demais, e faixa vazia não desenha nada;
 *   3. a tabela das faixas que TÊM lead, com quanto marcou visita e quanto esfriou;
 *      as vazias viram uma linha só, em cinza, embaixo.
 * A frase-conclusão sai do dado: com pelo menos `MINIMO_POR_LADO` leads respondidos
 * rápido e `MINIMO_POR_LADO` com mais de 2 h, ela compara os dois lados; abaixo disso
 * (a produção de hoje tem 4 leads) ela só diz os números e quando a comparação aparece.
 */

/**
 * Abaixo disto, um lead muda a taxa em 20 pontos ou mais: a comparação entre rápido e
 * lento seria sorte, e a tela mostra contagens ("1 de 2"), não porcentagem.
 */
const MINIMO_POR_LADO = 5;

/** "Ficaram mais de 2 h sem resposta": quem foi respondido depois de 2 h e quem não foi. */
const FAIXAS_LENTAS: readonly FaixaDePassagem[] = ['mais_2h', 'sem_resposta'];

/**
 * A rampa do tempo: divergente, com o corte nas 2 h (a mesma régua do título). Azul é
 * o lado de quem foi respondido em até 2 h, vermelho é o de quem passou disso; a ponta
 * (até 15 min, sem resposta) é o tom mais forte, e o tom fica mais perto do fundo do
 * cartão à medida que chega ao corte. No claro a ponta é a mais escura; no escuro, a
 * mais clara (passos próprios, não a inversão automática).
 *
 * Validada com a skill dataviz (`validate_palette.js`) contra o cartão da Imova
 * (#ffffff no claro, #152a28 no escuro): vizinhos com ΔE ≥ 14 sob protanopia e
 * deuteranopia e ≥ 15,6 na visão normal. Os passos perto do corte ficam entre 2:1 e
 * 3:1 do cartão: por isso cada bloco tem 2px de vão, o número escrito dentro quando
 * cabe, e a tabela embaixo repete tudo em texto (nada só por cor).
 *
 * O texto dentro do bloco é branco ou a tinta da Imova, pelo APCA de cada passo.
 */
const RAMPA_DO_TEMPO = [
  '[--passagem-1:#184f95] [--passagem-2:#3987e5] [--passagem-3:#86b6ef] [--passagem-4:#ef8f8e] [--passagem-5:#c73838]',
  'dark:[--passagem-1:#93bff2] dark:[--passagem-2:#4588dd] dark:[--passagem-3:#24539b] dark:[--passagem-4:#a8403f] dark:[--passagem-5:#ef7b7a]',
  '[--passagem-t1:#ffffff] [--passagem-t2:#ffffff] [--passagem-t3:#0e2826] [--passagem-t4:#0e2826] [--passagem-t5:#ffffff]',
  'dark:[--passagem-t1:#0e2826] dark:[--passagem-t2:#ffffff] dark:[--passagem-t3:#ffffff] dark:[--passagem-t4:#ffffff] dark:[--passagem-t5:#ffffff]',
].join(' ');

const TOM_DA_FAIXA: Record<FaixaDePassagem, { fundo: string; texto: string }> = {
  ate_15: { fundo: 'bg-(--passagem-1)', texto: 'text-(--passagem-t1)' },
  '15_60': { fundo: 'bg-(--passagem-2)', texto: 'text-(--passagem-t2)' },
  '1_2h': { fundo: 'bg-(--passagem-3)', texto: 'text-(--passagem-t3)' },
  mais_2h: { fundo: 'bg-(--passagem-4)', texto: 'text-(--passagem-t4)' },
  sem_resposta: { fundo: 'bg-(--passagem-5)', texto: 'text-(--passagem-t5)' },
};

type Linha = { faixa: FaixaDePassagem; leads: number; visitaram: number; esfriaram: number };

type Lado = { leads: number; visitaram: number; esfriaram: number };

/** Os dois lados da comparação, quando os dois têm lead bastante. */
type Comparacao = { rapido: Lado & { rotulo: string }; lento: Lado };

function somar(linhas: readonly Linha[], faixas: readonly FaixaDePassagem[]): Lado {
  return linhas
    .filter((l) => faixas.includes(l.faixa))
    .reduce((s, l) => ({ leads: s.leads + l.leads, visitaram: s.visitaram + l.visitaram, esfriaram: s.esfriaram + l.esfriaram }), {
      leads: 0,
      visitaram: 0,
      esfriaram: 0,
    });
}

/**
 * O lado rápido é "até 15 min" quando ele sozinho tem lead bastante; senão, "até 1 h"
 * (para a equipe que quase nunca responde em 15 min também ter a sua leitura).
 */
function compararOsLados(linhas: readonly Linha[]): Comparacao | null {
  const lento = somar(linhas, FAIXAS_LENTAS);
  if (lento.leads < MINIMO_POR_LADO) return null;
  const candidatos = [
    { rotulo: 'em até 15 min', ...somar(linhas, ['ate_15']) },
    { rotulo: 'em até 1 h', ...somar(linhas, ['ate_15', '15_60']) },
  ];
  const rapido = candidatos.find((c) => c.leads >= MINIMO_POR_LADO);
  return rapido ? { rapido, lento } : null;
}

const taxa = (parte: number, todo: number) => (todo > 0 ? parte / todo : 0);

/** O título-conclusão: a comparação quando o dado sustenta; senão, a contagem. */
function tituloDaPassagem(total: number, lentos: number, comparacao: Comparacao | null): string {
  if (total === 0) return 'A IA não passou conversa para a equipe nas últimas 4 semanas';
  if (comparacao) {
    const { rapido, lento } = comparacao;
    const visitaMais = taxa(rapido.visitaram, rapido.leads) > taxa(lento.visitaram, lento.leads);
    const esfriaMais = taxa(lento.esfriaram, lento.leads) > taxa(rapido.esfriaram, rapido.leads);
    if (visitaMais && esfriaMais) return 'Responder rápido marca visita; depois de 2 h, o lead esfria';
    if (visitaMais) return 'Quem a equipe responde rápido marca mais visita';
    if (esfriaMais) return 'Depois de 2 h sem resposta, o lead esfria mais';
  }
  if (lentos === 0) {
    return total === 1
      ? 'A equipe respondeu em até 2 h o único lead passado pela IA'
      : `A equipe respondeu em até 2 h os ${inteiro(total)} leads passados pela IA`;
  }
  if (total === 1) return 'O único lead passado pela IA ficou mais de 2 h sem resposta';
  return `${inteiro(lentos)} de ${inteiro(total)} leads passados pela IA ${plural(lentos, 'ficou', 'ficaram')} mais de 2 h sem resposta`;
}

/** Um número dentro da frase: em tinta e semibold, para o olho achar. */
function N({ children }: { children: ReactNode }) {
  return <strong className="numerico font-semibold">{children}</strong>;
}

/** "nenhum marcou visita", "1 marcou visita", "3 marcaram visita". */
function quantosVisitaram(n: number): ReactNode {
  if (n === 0) return 'nenhum marcou visita';
  return (
    <>
      <N>{inteiro(n)}</N> {plural(n, 'marcou', 'marcaram')} visita
    </>
  );
}

/** "nenhum esfriou", "1 esfriou", "2 esfriaram". */
function quantosEsfriaram(n: number): ReactNode {
  if (n === 0) return 'nenhum esfriou';
  return (
    <>
      <N>{inteiro(n)}</N> {plural(n, 'esfriou', 'esfriaram')}
    </>
  );
}

/**
 * A frase-conclusão, calculada do dado. Com os dois lados cheios, compara; com pouco
 * lead, diz só os números e quando a comparação aparece (nada de taxa de 1 lead).
 */
function Leitura({ linhas, total, comparacao }: { linhas: readonly Linha[]; total: number; comparacao: Comparacao | null }) {
  if (comparacao) {
    const { rapido, lento } = comparacao;
    return (
      <p className="text-[13px] leading-relaxed">
        Respondidos {rapido.rotulo},{' '}
        {rapido.visitaram === 0 ? (
          <>
            nenhum dos <N>{inteiro(rapido.leads)}</N> marcou visita
          </>
        ) : (
          <>
            <N>{inteiro(rapido.visitaram)}</N> de <N>{inteiro(rapido.leads)}</N>{' '}
            {plural(rapido.visitaram, 'marcou', 'marcaram')} visita
          </>
        )}
        . Com mais de 2 h ou sem resposta,{' '}
        {lento.visitaram === 0 ? (
          <>
            nenhum dos <N>{inteiro(lento.leads)}</N> marcou
          </>
        ) : (
          <>
            <N>{inteiro(lento.visitaram)}</N> de <N>{inteiro(lento.leads)}</N> {plural(lento.visitaram, 'marcou', 'marcaram')}
          </>
        )}
        {lento.esfriaram === 0 ? ', e nenhum esfriou' : <>, e {quantosEsfriaram(lento.esfriaram)}</>}.
      </p>
    );
  }

  const tudo = somar(linhas, FAIXAS_DE_PASSAGEM);
  const lentos = somar(linhas, FAIXAS_LENTAS).leads;
  const rapidos = somar(linhas, ['ate_15', '15_60']).leads;
  const resultado = (
    <>
      {quantosVisitaram(tudo.visitaram)} e {quantosEsfriaram(tudo.esfriaram)}
    </>
  );
  // Ninguém passou de 2 h: não há o que comparar, e é a boa notícia.
  if (lentos === 0) {
    return (
      <p className="text-[13px] leading-relaxed">
        Até agora, {resultado}.
      </p>
    );
  }
  const motivo =
    total < MINIMO_POR_LADO * 2 ? (
      total === 1 ? (
        <>É só 1 lead, pouco para comparar as faixas.</>
      ) : (
        <>
          São só <N>{inteiro(total)}</N> leads, poucos para comparar as faixas.
        </>
      )
    ) : lentos < MINIMO_POR_LADO ? (
      <>
        Só <N>{inteiro(lentos)}</N> {plural(lentos, 'ficou', 'ficaram')} mais de 2 h sem resposta, pouco para comparar.
      </>
    ) : (
      <>
        Só <N>{inteiro(rapidos)}</N> {plural(rapidos, 'foi respondido', 'foram respondidos')} em até 1 h, pouco para
        comparar.
      </>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] leading-relaxed">
        {motivo} Até agora, {resultado}.
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        A comparação aparece com {MINIMO_POR_LADO} leads respondidos em até 1 h e {MINIMO_POR_LADO} com mais de 2 h.
      </p>
    </div>
  );
}

/** A mediana em destaque, e embaixo o total passado e quantos passaram de 2 h. */
function Destaque({ mediana, total, lentos, comparavel }: { mediana: number | null; total: number; lentos: number; comparavel: boolean }) {
  const parteLenta = parteDe(lentos, total);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="numerico text-[30px] leading-none font-medium tracking-[-0.02em] md:text-[32px]">
          {mediana !== null ? minutos(mediana) : '—'}
        </span>
        <span className="text-xs text-muted-foreground">
          {mediana !== null ? 'para a equipe responder (mediana)' : 'ninguém da equipe respondeu ainda'}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 border-t border-hairline pt-3">
        <dt className="sr-only">Leads passados</dt>
        <dd className="numerico text-xl leading-none font-medium">{inteiro(total)}</dd>
        <dd className="text-xs text-muted-foreground">{plural(total, 'lead passado', 'leads passados')} pela IA</dd>
        <dt className="sr-only">Mais de 2 horas sem resposta</dt>
        <dd className="numerico text-xl leading-none font-medium">{inteiro(lentos)}</dd>
        <dd className="text-xs text-muted-foreground">
          {plural(lentos, 'ficou', 'ficaram')} mais de 2 h sem resposta
          {comparavel && parteLenta !== null ? <span className="numerico"> · {parteLenta}%</span> : null}
        </dd>
      </dl>
    </div>
  );
}

/** "a", "a e b", "a, b e c". */
function emLista(itens: readonly string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/**
 * A barra 100%: um bloco por faixa com lead, do rápido ao lento, 2px de vão entre eles
 * e 4px de canto em cada um. Dentro, a parte (ou a contagem, com pouco lead) quando
 * cabe; a dica de cada bloco abre no mouse e no foco.
 */
function BarraDasFaixas({ linhas, total, comparavel }: { linhas: readonly Linha[]; total: number; comparavel: boolean }) {
  const cheias = linhas.filter((l) => l.leads > 0);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-7 w-full gap-0.5">
        {cheias.map((l) => {
          const parte = parteDe(l.leads, total) ?? 0;
          const rotulo = comparavel ? `${parte}%` : inteiro(l.leads);
          // A largura mínima para o número caber com folga (a porcentagem é mais larga).
          const cabe = parte >= (comparavel ? 9 : 6);
          const resultado = `${inteiro(l.visitaram)} ${plural(l.visitaram, 'marcou', 'marcaram')} visita, ${inteiro(l.esfriaram)} ${plural(l.esfriaram, 'esfriou', 'esfriaram')}`;
          return (
            <Dica
              key={l.faixa}
              texto={
                <>
                  <span className="font-semibold">{rotuloDaFaixaDePassagem(l.faixa)}</span>: {inteiro(l.leads)} de{' '}
                  {inteiro(total)} leads ({parte}%)
                  <br />
                  {resultado}
                </>
              }
            >
              <button
                type="button"
                aria-label={`${rotuloDaFaixaDePassagem(l.faixa)}: ${inteiro(l.leads)} de ${inteiro(total)} leads, ${parte}%. ${resultado}.`}
                className={cn(
                  ALVO,
                  'flex h-full min-w-1 items-center overflow-visible rounded-[4px] px-2',
                  TOM_DA_FAIXA[l.faixa].fundo,
                )}
                style={{ flex: `${l.leads} 1 0` }}
              >
                {cabe ? (
                  <span aria-hidden="true" className={cn('numerico text-xs leading-none font-semibold', TOM_DA_FAIXA[l.faixa].texto)}>
                    {rotulo}
                  </span>
                ) : null}
              </button>
            </Dica>
          );
        })}
      </div>
      <div aria-hidden="true" className="flex justify-between text-[11px] text-muted-foreground">
        <span>← mais rápido</span>
        <span>mais lento →</span>
      </div>
    </div>
  );
}

/** Uma taxa da tabela: a porcentagem e o "x de n"; com pouco lead, só o "x de n". */
function Taxa({ parte, todo, comparavel }: { parte: number; todo: number; comparavel: boolean }) {
  const p = parteDe(parte, todo) ?? 0;
  if (!comparavel) {
    return (
      <span className="numerico">
        {inteiro(parte)} <span className="text-muted-foreground">de</span> {inteiro(todo)}
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      {/* No celular a coluna é estreita: o "x de n" desce inteiro para a linha de baixo. */}
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="numerico font-semibold sm:w-10">{p}%</span>
        <span className="numerico text-[11px] whitespace-nowrap text-muted-foreground">
          {inteiro(parte)} de {inteiro(todo)}
        </span>
      </span>
      {/* O medidor fino deixa o desenho da coluna aparecer descendo a tabela: a visita
          some e o esfriar cresce. Cinza, para não brigar com a rampa do tempo. */}
      <span aria-hidden="true" className="relative block h-1.5 w-full max-w-64 overflow-hidden rounded-full bg-muted">
        {p > 0 ? <span className="absolute inset-y-0 left-0 rounded-full bg-(--vende-traco)" style={{ width: `${p}%` }} /> : null}
      </span>
    </span>
  );
}

/** A tabela das faixas com lead; as vazias viram uma linha só embaixo. */
function TabelaDasFaixas({ linhas, comparavel }: { linhas: readonly Linha[]; comparavel: boolean }) {
  const cheias = linhas.filter((l) => l.leads > 0);
  const vazias = linhas.filter((l) => l.leads === 0).map((l) => rotuloDaFaixaDePassagem(l.faixa));
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full table-fixed border-collapse text-[13px]">
        <caption className="sr-only">Leads passados pela IA por tempo de resposta da equipe, e o que aconteceu com eles</caption>
        <thead>
          <tr className="text-left text-[11px] text-muted-foreground">
            <th scope="col" className="w-[7.25rem] pb-1.5 font-normal sm:w-48">
              Tempo de resposta
            </th>
            <th scope="col" className="w-10 pr-2.5 pb-1.5 text-right font-normal sm:w-16 sm:pr-5">
              Leads
            </th>
            <th scope="col" className="pb-1.5 font-normal">
              Marcou visita
            </th>
            <th scope="col" className="pb-1.5 font-normal">
              Esfriou
            </th>
          </tr>
        </thead>
        <tbody>
          {cheias.map((l) => (
            <tr key={l.faixa} className="border-t border-hairline">
              <th scope="row" className="py-2 pr-2 text-left font-normal">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-[3px]', TOM_DA_FAIXA[l.faixa].fundo)} />
                  <span className={cn(FAIXAS_LENTAS.includes(l.faixa) && 'font-semibold')}>{rotuloDaFaixaDePassagem(l.faixa)}</span>
                </span>
              </th>
              <td className="numerico py-2 pr-2.5 text-right font-medium sm:pr-5">{inteiro(l.leads)}</td>
              <td className="py-2 pr-2 sm:pr-8">
                <Taxa parte={l.visitaram} todo={l.leads} comparavel={comparavel} />
              </td>
              <td className="py-2 sm:pr-2">
                <Taxa parte={l.esfriaram} todo={l.leads} comparavel={comparavel} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {vazias.length > 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum lead em {emLista(vazias)}.</p>
      ) : null}
    </div>
  );
}

/** Quanto a equipe demora quando a IA passa a conversa. Dono: o agente "passagem". */
export function Passagem({ dados }: { dados: PainelProgressoIA }) {
  const porFaixa = new Map<FaixaDePassagem, Omit<Linha, 'faixa'>>(
    lista(dados.passagem).map((p) => [
      p.faixa,
      { leads: contagem(p.leads), visitaram: contagem(p.visitaram), esfriaram: contagem(p.esfriaram) },
    ]),
  );
  // As cinco faixas sempre na ordem do rápido ao lento; a que o banco não mandou é zero.
  const linhas: Linha[] = FAIXAS_DE_PASSAGEM.map((f) => ({ faixa: f, ...(porFaixa.get(f) ?? { leads: 0, visitaram: 0, esfriaram: 0 }) }));
  const total = linhas.reduce((s, l) => s + l.leads, 0);
  const lentos = somar(linhas, FAIXAS_LENTAS).leads;
  const comparacao = compararOsLados(linhas);
  const mediana = numero(dados.passagem_mediana_min);

  const ajuda = (
    <>
      Conta cada vez que a IA passou a conversa para a equipe nas últimas 4 semanas. O tempo vai da passagem até a
      primeira mensagem escrita por alguém da equipe naquela conversa, no relógio corrido (noite e fim de semana
      contam). &ldquo;Sem resposta&rdquo; é quando ninguém escreveu depois. A mediana é o tempo do meio entre os que
      tiveram resposta: metade foi respondida antes, metade depois. &ldquo;Marcou visita&rdquo;: a conversa ganhou uma
      visita depois da passagem. &ldquo;Esfriou&rdquo;: o lead foi marcado como esfriando ou sem resposta. A comparação
      só aparece com pelo menos {MINIMO_POR_LADO} leads respondidos rápido e {MINIMO_POR_LADO} com mais de 2 h.
    </>
  );

  if (total === 0) {
    return (
      <Cartao secao="passagem" titulo={tituloDaPassagem(0, 0, null)} ajuda={ajuda}>
        <SemDado>Quando ela passar, aqui aparece quanto a equipe demora para responder e o que acontece com o lead.</SemDado>
      </Cartao>
    );
  }

  const comparavel = comparacao !== null;
  return (
    <Cartao
      secao="passagem"
      className={RAMPA_DO_TEMPO}
      titulo={tituloDaPassagem(total, lentos, comparacao)}
      sub="Tempo até a equipe responder quando a IA passa a conversa, nas últimas 4 semanas."
      ajuda={ajuda}
    >
      <div className="grid gap-x-10 gap-y-5 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Destaque mediana={mediana} total={total} lentos={lentos} comparavel={comparavel} />
          <div className="border-t border-hairline pt-3">
            <Leitura linhas={linhas} total={total} comparacao={comparacao} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <BarraDasFaixas linhas={linhas} total={total} comparavel={comparavel} />
          <TabelaDasFaixas linhas={linhas} comparavel={comparavel} />
        </div>
      </div>
    </Cartao>
  );
}
