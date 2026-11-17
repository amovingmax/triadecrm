'use client';

import { CircleAlert, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import type { FaixaDePassagem, PainelProgressoIA, SemanaDaIA } from '../dados-vende';
import {
  comoCorrigirLacuna,
  contagem,
  contar,
  decimalFixo,
  deltaDe,
  diaCivil,
  diaMes,
  dolares,
  inteiro,
  lista,
  minutos,
  numero,
  pct,
  plural,
  rotuloDaLacuna,
  versaoCurta,
  type JeitoDoDelta,
} from '../formatos-vende';
import { Cartao } from '../graficos-vende';

/**
 * O resumo do topo do Progresso da IA (16/11/2026): o que o dono lê nos primeiros
 * cinco segundos. Uma linha de situação (em que semana a IA está, qual versão está no
 * ar, quantas conversas ela atendeu) e de 2 a 3 leituras tiradas SÓ do JSON de
 * `relatorio_imova_painel_ia()`: o que vai bem e o que pede atenção. Nenhuma frase
 * daqui afirma o que o dado não diz; sem dado, o resumo diz que ainda não há medida.
 *
 * Dono: o agente "topo da aba IA".
 */

// ---------------------------------------------------------------------------
// A linha do tempo da IA (também usada pelos números do topo e pela moldura)
// ---------------------------------------------------------------------------

/**
 * A comparação "últimas 4 semanas × as 4 anteriores" (a janela de 28 dias do banco)
 * só é justa quando a IA já estava ligada nas 8 semanas inteiras: antes disso a
 * janela "anterior" é parte ou toda de um tempo em que a IA nem existia (as visitas
 * "eram 0" porque ela não atendia, não porque piorou). Da 9ª semana em diante, compara.
 */
const SEMANA_EM_QUE_COMPARA = 9;

const UM_DIA = 86_400_000;
const emDias = (dia: string) => Math.round(Date.parse(`${dia}T00:00:00Z`) / UM_DIA);
const doDia = (n: number) => new Date(n * UM_DIA).toISOString().slice(0, 10);
/** A segunda-feira da semana de um dia civil (a semana do banco é a ISO: começa na segunda). */
const segundaDaSemana = (dia: string) => {
  const n = emDias(dia);
  return doDia(n - ((new Date(n * UM_DIA).getUTCDay() + 6) % 7));
};

export type TempoDaIA = {
  /** 1 na semana em que a IA começou; a semana corrente é a última da lista. */
  semana: number;
  /** As semanas fechadas (sem a corrente, que está pela metade). */
  completas: readonly SemanaDaIA[];
  corrente: SemanaDaIA;
  /** Se os números do topo já podem ser comparados com as 4 semanas anteriores. */
  compara: boolean;
  /** A segunda-feira (AAAA-MM-DD) em que a comparação começa a valer. */
  comparaEm: string;
};

/**
 * Em que ponto da vida da IA o painel está. Lê só o dado (`desde` e a última semana da
 * lista), nunca o relógio: o mesmo JSON dá sempre a mesma frase.
 */
export function tempoDaIA(dados: PainelProgressoIA): TempoDaIA | null {
  const semanas = lista(dados.semanas);
  const corrente = semanas[semanas.length - 1];
  const comeco = diaCivil(dados.desde);
  const atual = diaCivil(corrente?.inicio);
  if (!corrente || !comeco || !atual) return null;
  const primeiraSegunda = segundaDaSemana(comeco);
  const semana = Math.max(1, Math.floor((emDias(atual) - emDias(primeiraSegunda)) / 7) + 1);
  return {
    semana,
    completas: semanas.slice(0, -1),
    corrente,
    compara: semana >= SEMANA_EM_QUE_COMPARA,
    comparaEm: doDia(emDias(primeiraSegunda) + (SEMANA_EM_QUE_COMPARA - 1) * 7),
  };
}

// ---------------------------------------------------------------------------
// As leituras
// ---------------------------------------------------------------------------

type TomDaLeitura = 'bem' | 'atencao';

type Leitura = {
  chave: string;
  tom: TomDaLeitura;
  frase: ReactNode;
  detalhe?: ReactNode;
  /** O "→ o que fazer", quando o CRM tem o caminho. */
  acao?: string | null;
};

const LENTAS: readonly FaixaDePassagem[] = ['mais_2h', 'sem_resposta'];

type Medida = {
  chave: string;
  agora: unknown;
  antes: unknown;
  jeito: JeitoDoDelta;
  menorEMelhor?: boolean;
  /** A frase da mudança, com os dois valores já formatados. */
  frase: (subiu: boolean, antes: string, agora: string) => string;
  formato: (v: unknown) => string;
};

/** Os cinco números do topo, na ordem em que uma melhora ou piora vira leitura. */
function medidas(dados: PainelProgressoIA): Medida[] {
  const k = dados.kpis;
  return [
    {
      chave: 'nota',
      agora: k?.nota?.agora,
      antes: k?.nota?.antes,
      jeito: 'nota',
      formato: decimalFixo,
      frase: (subiu, a, d) => `A nota média ${subiu ? 'subiu' : 'caiu'} de ${a} para ${d}`,
    },
    {
      chave: 'interesse',
      agora: k?.mais_interesse?.agora,
      antes: k?.mais_interesse?.antes,
      jeito: 'pontos',
      formato: pct,
      frase: (subiu, a, d) => `Os que saem mais interessados ${subiu ? 'subiram' : 'caíram'}: ${a} → ${d}`,
    },
    {
      chave: 'resolvidas',
      agora: k?.resolvidas?.agora,
      antes: k?.resolvidas?.antes,
      jeito: 'pontos',
      formato: pct,
      frase: (subiu, a, d) => `Resolve ${subiu ? 'mais' : 'menos'} conversas sozinha: ${a} → ${d}`,
    },
    {
      chave: 'visitas',
      agora: k?.visitas?.agora,
      antes: k?.visitas?.antes,
      jeito: 'contagem',
      formato: inteiro,
      frase: (subiu, a, d) => `Marcou ${subiu ? 'mais' : 'menos'} visitas: ${d}, eram ${a}`,
    },
    {
      chave: 'custo',
      agora: k?.custo_por_visita_usd?.agora,
      antes: k?.custo_por_visita_usd?.antes,
      jeito: 'dolar',
      menorEMelhor: true,
      formato: dolares,
      frase: (subiu, a, d) => `A visita marcada saiu mais ${subiu ? 'cara' : 'barata'}: ${a} → ${d}`,
    },
  ];
}

/** "desde 10/11" nas primeiras semanas (a janela de 28 dias é a vida toda da IA). */
function janela(tempo: TempoDaIA, desde: string | null): string {
  return tempo.semana <= 4 && desde ? `desde ${diaMes(desde)}` : 'nas últimas 4 semanas';
}

/** A nota mais baixa das três na última semana fechada com nota (com empate, as duas). */
export function notaMaisBaixa(completas: readonly SemanaDaIA[]): { rotulo: string; valor: number } | null {
  const semana = [...completas].reverse().find((s) => [s.duvida, s.informacao, s.satisfacao].some((v) => numero(v) !== null));
  if (!semana) return null;
  const notas = [
    { rotulo: 'Tirou a dúvida', valor: numero(semana.duvida) },
    { rotulo: 'Informação útil', valor: numero(semana.informacao) },
    { rotulo: 'Cliente satisfeito', valor: numero(semana.satisfacao) },
  ].filter((n): n is { rotulo: string; valor: number } => n.valor !== null);
  const menor = Math.min(...notas.map((n) => Math.round(n.valor * 10)));
  const empatadas = notas.filter((n) => Math.round(n.valor * 10) === menor);
  const primeira = empatadas[0];
  if (!primeira) return null;
  const rotulo = empatadas
    .map((n, i) => (i === 0 ? n.rotulo : n.rotulo.charAt(0).toLowerCase() + n.rotulo.slice(1)))
    .join(' e ');
  return { rotulo, valor: primeira.valor };
}

/**
 * As leituras candidatas, cada lista na ordem de prioridade, e a escolha: a melhor
 * coisa que vai bem (se houver) e as que pedem atenção, até 3 no total.
 *   - vai bem: um número que melhorou contra as 4 semanas anteriores (só quando a
 *     comparação vale), uma falha que diminuiu, ou, nas primeiras semanas, o que já
 *     está bom por si (resolve sozinha metade ou mais; nota 4 ou mais);
 *   - pede atenção: um número que piorou, leads passados que esperaram mais de 2 h
 *     (um quarto ou mais), a falha mais anotada (com o que fazer), ninguém saindo mais
 *     interessado, a nota mais baixa abaixo de 3,5.
 */
function leiturasDoResumo(dados: PainelProgressoIA, tempo: TempoDaIA): Leitura[] {
  const k = dados.kpis;
  const bem: Leitura[] = [];
  const atencao: Leitura[] = [];
  const quando = janela(tempo, dados.desde);

  // 1. O que mudou contra as 4 semanas anteriores.
  if (tempo.compara) {
    const mudancas = medidas(dados)
      .map((m) => ({ m, delta: deltaDe(m.agora, m.antes, m.jeito, { menorEMelhor: m.menorEMelhor }) }))
      .filter((x) => x.delta && x.delta.tom !== 'neutro');
    const melhoras = mudancas.filter((x) => x.delta?.tom === 'bom');
    const pioras = mudancas.filter((x) => x.delta?.tom === 'ruim');
    const primeira = melhoras[0];
    if (primeira) {
      const subiu = (numero(primeira.m.agora) ?? 0) > (numero(primeira.m.antes) ?? 0);
      const outras = melhoras.length - 1;
      bem.push({
        chave: `melhorou-${primeira.m.chave}`,
        tom: 'bem',
        frase: primeira.m.frase(subiu, primeira.m.formato(primeira.m.antes), primeira.m.formato(primeira.m.agora)),
        detalhe: `contra as 4 semanas anteriores${
          outras > 0 ? ` · ${plural(outras, 'outro número também melhorou', `outros ${inteiro(outras)} números também melhoraram`)}` : ''
        }`,
      });
    }
    for (const x of pioras) {
      const subiu = (numero(x.m.agora) ?? 0) > (numero(x.m.antes) ?? 0);
      atencao.push({
        chave: `piorou-${x.m.chave}`,
        tom: 'atencao',
        frase: x.m.frase(subiu, x.m.formato(x.m.antes), x.m.formato(x.m.agora)),
        detalhe: 'contra as 4 semanas anteriores',
      });
    }
    // Uma falha que diminuiu bem (contagem: só com as duas janelas inteiras).
    const caiu = [...lista(dados.lacunas)]
      .map((l) => ({ ...l, queda: contagem(l.antes) - contagem(l.agora) }))
      .filter((l) => l.queda >= 2)
      .sort((a, b) => b.queda - a.queda)[0];
    if (caiu) {
      bem.push({
        chave: `lacuna-caiu-${caiu.lacuna}`,
        tom: 'bem',
        frase: `“${rotuloDaLacuna(caiu.lacuna)}” caiu de ${inteiro(caiu.antes)} para ${inteiro(caiu.agora)}`,
        detalhe: 'vezes na avaliação diária, contra as 4 semanas anteriores',
      });
    }
  }

  // 2. O que já está bom por si (vale também nas primeiras semanas).
  const resolvidas = numero(k?.resolvidas?.agora);
  if (resolvidas !== null && resolvidas >= 50) {
    bem.push({
      chave: 'resolve-sozinha',
      tom: 'bem',
      frase: `Resolve sozinha ${pct(resolvidas)} das conversas`,
      detalhe: `sem passar para a equipe, ${quando}`,
    });
  }
  const nota = numero(k?.nota?.agora);
  if (nota !== null && nota >= 4) {
    bem.push({
      chave: 'nota-alta',
      tom: 'bem',
      frase: `Nota média ${decimalFixo(nota)} de 5 na avaliação diária`,
      detalhe: quando,
    });
  }

  // 3. Onde a IA depende da equipe: os leads passados que esperaram.
  const passagem = lista(dados.passagem);
  const total = passagem.reduce((s, p) => s + contagem(p.leads), 0);
  const lentas = passagem.filter((p) => LENTAS.includes(p.faixa));
  const lentos = lentas.reduce((s, p) => s + contagem(p.leads), 0);
  if (lentos > 0 && lentos / total >= 0.25) {
    const esfriaram = lentas.reduce((s, p) => s + contagem(p.esfriaram), 0);
    const mediana = numero(dados.passagem_mediana_min);
    atencao.push({
      chave: 'passagem',
      tom: 'atencao',
      frase: `${inteiro(lentos)} de ${contar(total, 'lead passado', 'leads passados')} pela IA ${plural(lentos, 'ficou', 'ficaram')} mais de 2 h sem resposta`,
      detalhe: [
        esfriaram > 0 ? `${inteiro(esfriaram)} ${plural(esfriaram, 'deles esfriou', 'deles esfriaram')}` : null,
        mediana !== null ? `a equipe responde em ${minutos(mediana)} (mediana)` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }

  // 4. A falha mais anotada pela avaliação diária, com o que fazer.
  const topo = [...lista(dados.lacunas)].sort((a, b) => contagem(b.agora) - contagem(a.agora))[0];
  if (topo && contagem(topo.agora) > 0) {
    const vezes = contagem(topo.agora);
    atencao.push({
      chave: `lacuna-${topo.lacuna}`,
      tom: 'atencao',
      frase: `“${rotuloDaLacuna(topo.lacuna)}” é a falha mais anotada`,
      detalhe: `${contar(vezes, 'vez', 'vezes')} ${quando}${tempo.compara ? `, ${plural(contagem(topo.antes), 'era', 'eram')} ${inteiro(topo.antes)}` : ''}`,
      acao: comoCorrigirLacuna(topo.lacuna),
    });
  }

  // 5. Ninguém saindo mais interessado; a nota mais baixa das três.
  if (numero(k?.mais_interesse?.agora) === 0) {
    atencao.push({
      chave: 'interesse-zero',
      tom: 'atencao',
      frase: 'Nenhum cliente avaliado saiu da conversa mais interessado',
      detalhe: quando,
    });
  }
  const baixa = notaMaisBaixa(tempo.completas);
  if (baixa && baixa.valor < 3.5) {
    atencao.push({
      chave: 'nota-baixa',
      tom: 'atencao',
      frase: `${baixa.rotulo} é a nota mais baixa: ${decimalFixo(baixa.valor)} de 5`,
      detalhe: 'na última semana fechada',
    });
  }

  const escolhidas: Leitura[] = bem.slice(0, 1);
  escolhidas.push(...atencao.slice(0, 3 - escolhidas.length));
  escolhidas.push(...bem.slice(1, 1 + Math.max(0, 3 - escolhidas.length)));
  return [...escolhidas.filter((l) => l.tom === 'bem'), ...escolhidas.filter((l) => l.tom === 'atencao')];
}

// ---------------------------------------------------------------------------
// O desenho
// ---------------------------------------------------------------------------

const ROTULO_DO_TOM: Record<TomDaLeitura, { texto: string; classe: string; Icone: typeof CircleCheck }> = {
  bem: { texto: 'Vai bem', classe: 'text-cliente-texto', Icone: CircleCheck },
  atencao: { texto: 'Pede atenção', classe: 'text-quente-texto', Icone: CircleAlert },
};

/** As colunas das leituras: uma por leitura no computador, empilhadas no celular. */
const COLUNAS: Record<number, string> = { 1: '', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3' };

/** O resumo do topo. Fica acima dos cinco números. */
export function ResumoDaIA({ dados }: { dados: PainelProgressoIA }) {
  const tempo = tempoDaIA(dados);

  if (!tempo) {
    return (
      <Cartao
        grande
        secao="resumo"
        titulo="A IA ainda não respondeu nenhuma conversa"
        sub="As notas e os números começam a aparecer com as primeiras conversas que ela atender."
      >
        {null}
      </Cartao>
    );
  }

  const versoes = lista(dados.versoes);
  const atual = versoes[versoes.length - 1];
  const titulo = [
    `Semana ${inteiro(tempo.semana)} da IA`,
    atual ? `${versaoCurta(atual.versao)} no ar desde ${diaMes(atual.desde)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const passada = tempo.completas[tempo.completas.length - 1];
  const sub = passada
    ? `${contar(contagem(passada.conversas), 'conversa atendida', 'conversas atendidas')} na semana passada (${diaMes(passada.inicio)} a ${diaMes(doDia(emDias(passada.inicio) + 6))})`
    : `${contar(contagem(tempo.corrente.conversas), 'conversa atendida', 'conversas atendidas')} nesta semana, que ainda está pela metade`;

  const leituras = leiturasDoResumo(dados, tempo);
  const temNota = numero(dados.kpis?.nota?.agora) !== null;

  return (
    <Cartao grande secao="resumo" titulo={titulo} sub={sub}>
      {leituras.length === 0 ? (
        <p className="border-t border-hairline pt-3.5 text-sm text-muted-foreground">
          {temNota
            ? 'Nenhum alerta nas últimas 4 semanas: nada piorou e nenhuma falha se repetiu.'
            : 'Ainda não há medida: as primeiras notas chegam com a avaliação diária das conversas.'}
        </p>
      ) : (
        <ul className={cn('grid border-t border-hairline pt-4', COLUNAS[leituras.length])}>
          {leituras.map((l) => (
            <LinhaDaLeitura key={l.chave} leitura={l} />
          ))}
        </ul>
      )}
    </Cartao>
  );
}

function LinhaDaLeitura({ leitura }: { leitura: Leitura }) {
  const { texto, classe, Icone } = ROTULO_DO_TOM[leitura.tom];
  return (
    <li
      className={cn(
        'flex min-w-0 flex-col gap-1 border-t border-hairline py-3 first:border-t-0 first:pt-0 last:pb-0',
        'md:border-t-0 md:border-l md:px-5 md:py-0 md:first:border-l-0 md:first:pl-0 md:last:pr-0',
      )}
    >
      {/* O tom vem com ícone E palavra: nunca só pela cor. */}
      <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold', classe)}>
        <Icone className="size-3.5 shrink-0" aria-hidden="true" />
        {texto}
      </span>
      <span className="numerico text-sm leading-snug font-semibold text-pretty">{leitura.frase}</span>
      {leitura.detalhe ? (
        <span className="numerico text-xs leading-relaxed text-muted-foreground">{leitura.detalhe}</span>
      ) : null}
      {leitura.acao ? <span className="text-xs leading-relaxed">→ {leitura.acao}</span> : null}
    </li>
  );
}
