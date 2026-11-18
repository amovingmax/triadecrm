import { ROTULO_DO_SUBCANAL } from '@komune/schema';

import type {
  GrupoDeOrigem,
  LinhaDoAnuncio,
  LinhaDoGrupo,
  MesDaOrigem,
  PainelOrigem,
} from './dados-vende';
import { contagem, contar, decimalEnxuto, encurtar, inteiro, numero, parteDe, plural } from './formatos-vende';

/**
 * As contas e os textos da aba Origem e interesse (18/11/2026). Nada aqui soma o
 * que o banco já somou (ADR-03): são rótulos, frases e a escolha do que destacar.
 */

export const GRUPOS_DE_ORIGEM: readonly GrupoDeOrigem[] = [
  'placa',
  'meta',
  'portais',
  'redes_sociais',
  'outros',
  'nao_identificado',
];

/** O nome do grupo na tabela. */
export const ROTULO_DO_GRUPO: Readonly<Record<GrupoDeOrigem, string>> = {
  placa: 'Placa',
  meta: 'Anúncio no Instagram ou Facebook',
  portais: 'Portais (ZAP, Viva Real, OLX)',
  redes_sociais: 'Redes sociais, sem anúncio',
  outros: 'Indicação, site, Google',
  nao_identificado: 'Não identificado',
};

/** O nome curto, para legenda e frase. */
export const ROTULO_CURTO_DO_GRUPO: Readonly<Record<GrupoDeOrigem, string>> = {
  placa: 'Placa',
  meta: 'Anúncio no Instagram',
  portais: 'Portais',
  redes_sociais: 'Redes sociais',
  outros: 'Outros',
  nao_identificado: 'Não identificado',
};

/** Onde os botões dos achados levam. */
export type AlvoDaOrigem = 'origem' | 'anuncios' | 'interesse' | 'meses' | 'sistema';

/** O detalhe do grupo, dito como a equipe fala. */
export function rotuloDoSubcanal(subcanal: string): string {
  switch (subcanal) {
    case 'foto_da_placa':
      return 'Mandou foto da placa';
    case 'foto_do_banner':
      return 'Mandou foto do banner';
    case 'texto_da_placa':
      return 'Falou da placa';
    case 'anuncio_outro':
      return 'Falou de um anúncio';
    case 'desconhecido':
      return 'Sem pista';
    default:
      return (ROTULO_DO_SUBCANAL as Record<string, string>)[subcanal] ?? subcanal;
  }
}

/**
 * Tempo de resposta curto: "menos de 1 min", "8 min", "2 h 42", "20 h 57" e, de
 * dois dias em diante, "3,5 dias". Até 48 h fica em horas: "36 h" diz mais que
 * "2 dias" para quem esperou uma resposta.
 */
export function tempoCurto(valor: unknown): string {
  const n = numero(valor);
  if (n === null) return '—';
  if (n < 1) return 'menos de 1 min';
  const m = Math.round(n);
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) {
    const h = Math.floor(m / 60);
    const resto = m % 60;
    return resto === 0 ? `${h} h` : `${h} h ${String(resto).padStart(2, '0')}`;
  }
  return `${decimalEnxuto(m / (60 * 24))} dias`;
}

/** "nov.", de `2026-11`. */
export function mesCurto(mes: string | null | undefined): string {
  const m = mes && /^\d{4}-\d{2}/.test(mes) ? Number(mes.slice(5, 7)) : NaN;
  return MESES_CURTOS[m - 1] ?? '';
}

const MESES_CURTOS = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];

/** Um número por dia: "1,3". Sem dias, "—". */
export function porDia(valor: unknown, dias: unknown): string {
  const v = numero(valor);
  const d = numero(dias);
  if (v === null || d === null || d <= 0) return '—';
  return decimalEnxuto(v / d);
}

/**
 * O mesmo número nos dois últimos meses, do mais novo para o mais velho:
 * "nov. 23 · out. 2". Com um mês só, nulo (não há o que comparar).
 */
export function divisaoDosMeses(
  meses: readonly MesDaOrigem[] | null | undefined,
  campo: (mes: MesDaOrigem) => number,
): string | null {
  const lista = Array.isArray(meses) ? meses : [];
  if (lista.length < 2) return null;
  const ultimo = lista[lista.length - 1]!;
  const anterior = lista[lista.length - 2]!;
  return `${mesCurto(ultimo.mes)} ${inteiro(campo(ultimo))} · ${mesCurto(anterior.mes)} ${inteiro(campo(anterior))}`;
}

// ---------------------------------------------------------------------------
// De onde vieram
// ---------------------------------------------------------------------------

/** O grupo que mais trouxe gente, sem contar o "não identificado". */
export function grupoQueMaisTrouxe(grupos: readonly LinhaDoGrupo[]): LinhaDoGrupo | null {
  let melhor: LinhaDoGrupo | null = null;
  for (const g of grupos) {
    if (g.grupo === 'nao_identificado' || contagem(g.chegadas) === 0) continue;
    if (!melhor || contagem(g.chegadas) > contagem(melhor.chegadas)) melhor = g;
  }
  return melhor;
}

/** A frase de apoio de cada grupo, quando os números dizem algo além da tabela. */
export function notaDoGrupo(g: LinhaDoGrupo, dados: PainelOrigem): string | null {
  const chegadas = contagem(g.chegadas);
  switch (g.grupo) {
    case 'placa': {
      const fotos = contagem(dados.placa?.fotos);
      const comCodigo = contagem(dados.placa?.fotos_com_codigo);
      if (fotos === 0) return null;
      if (comCodigo === 0) {
        return `Nenhuma das ${inteiro(fotos)} ${plural(fotos, 'foto', 'fotos')} mostrou o código do imóvel, então não dá para saber qual placa funciona. Com um QR code em cada placa (o cliente cai no WhatsApp com “Vi a placa do TE0004”), esta linha passa a se abrir por imóvel.`;
      }
      return `${inteiro(comCodigo)} das ${inteiro(fotos)} fotos mostraram o código do imóvel.`;
    }
    case 'meta': {
      if (chegadas === 0) return null;
      const anuncios = Array.isArray(g.anuncios) ? g.anuncios : [];
      const deFora = anuncios.some((a) => a.da_imova === false && contagem(a.chegadas) > 0);
      const partes: string[] = [];
      if (anuncios.length === 1 && chegadas > 1) partes.push(`As ${inteiro(chegadas)} vieram do mesmo anúncio.`);
      if (deFora) {
        partes.push('Há anúncio que não é da Imova levando gente para o WhatsApp: vale ver na Meta quem é o dono dele.');
      } else {
        partes.push('Cada anúncio aparece pelo nome que a Meta manda no clique.');
      }
      return partes.join(' ');
    }
    case 'portais': {
      const olx = contagem(dados.sistema?.grupo_olx?.contatos);
      if (chegadas === 0 && olx === 0) return null;
      const base = 'Chegadas pelo WhatsApp com o texto pronto do portal.';
      return olx > 0
        ? `${base} Fora delas, o Grupo OLX mandou mais ${contar(olx, 'contato', 'contatos')} direto ao CRM (veja em “Como o sistema está lidando”).`
        : base;
    }
    case 'nao_identificado':
      return chegadas > 0
        ? 'A IA leu a conversa e não achou pista. Perguntar “como você conheceu a Imova?” na primeira resposta diminuiria esta linha.'
        : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Os achados do topo
// ---------------------------------------------------------------------------

export type TomDoAchado = 'neutro' | 'alerta' | 'atencao';

export type Achado = {
  chave: string;
  selo: string;
  tom: TomDoAchado;
  titulo: string;
  texto: string;
  acao: { rotulo: string; alvo: AlvoDaOrigem } | null;
};

/**
 * Até três coisas que pedem ação, tiradas dos números da aba: o caminho que mais
 * traz gente, o que precisa ser conferido e o atendimento. Sem chegada, nada.
 */
export function achadosDaOrigem(dados: PainelOrigem): Achado[] {
  const total = contagem(dados.kpis?.chegadas);
  if (total === 0) return [];
  const grupos = Array.isArray(dados.grupos) ? dados.grupos : [];
  const achados: Achado[] = [];

  // 1. Origem.
  const topo = grupoQueMaisTrouxe(grupos);
  if (topo) {
    const n = contagem(topo.chegadas);
    const fotos = contagem(dados.placa?.fotos);
    if (topo.grupo === 'placa' && fotos > 0 && contagem(dados.placa?.fotos_com_codigo) === 0) {
      achados.push({
        chave: 'origem',
        selo: 'Origem',
        tom: 'neutro',
        titulo: 'A placa traz mais gente que qualquer anúncio, mas não diz de qual imóvel é',
        texto: `${inteiro(n)} das ${inteiro(total)} chegadas vieram de placa, ${inteiro(fotos)} com foto. Em nenhuma das fotos a IA achou o código do imóvel, então o relatório não sabe qual placa funciona.`,
        acao: { rotulo: 'Ideia: QR code com o código em cada placa', alvo: 'origem' },
      });
    } else {
      achados.push({
        chave: 'origem',
        selo: 'Origem',
        tom: 'neutro',
        titulo: `${ROTULO_DO_GRUPO[topo.grupo]} foi o caminho que mais trouxe gente`,
        texto: `${inteiro(n)} das ${inteiro(total)} chegadas (${parteDe(n, total) ?? 0}%).`,
        acao: { rotulo: 'Ver de onde vieram', alvo: 'origem' },
      });
    }
  }

  // 2. O que conferir.
  const meta = grupos.find((g) => g.grupo === 'meta');
  const deFora = (Array.isArray(meta?.anuncios) ? meta!.anuncios : [])
    .filter((a) => a.da_imova === false && contagem(a.chegadas) > 0)
    .sort((a, b) => contagem(b.chegadas) - contagem(a.chegadas))[0];
  const naoIdentificado = contagem(grupos.find((g) => g.grupo === 'nao_identificado')?.chegadas);
  const parado = anuncioVistoSemNinguem(dados.anuncios);
  if (deFora) {
    const n = contagem(deFora.chegadas);
    const sem = contagem(deFora.sem_resposta);
    achados.push({
      chave: 'confira',
      selo: 'Confira',
      tom: 'alerta',
      titulo: 'Um anúncio da Meta que não é da Imova manda gente para o nosso WhatsApp',
      texto:
        `${contar(n, 'chegada veio', 'chegadas vieram')} do anúncio “${encurtar(deFora.titulo ?? 'sem nome', 48)}”.` +
        (sem > 0 ? ` ${inteiro(sem)} ${plural(sem, 'ficou', 'ficaram')} sem resposta.` : ''),
      acao: { rotulo: `Ver ${plural(n, 'a chegada', `as ${inteiro(n)} chegadas`)}`, alvo: 'origem' },
    });
  } else if (total >= 4 && naoIdentificado * 5 >= total) {
    // Um quinto ou mais sem origem: vale perguntar como a pessoa conheceu a Imova.
    achados.push({
      chave: 'confira',
      selo: 'Confira',
      tom: 'atencao',
      titulo: `${contar(naoIdentificado, 'chegada', 'chegadas')} sem origem descoberta`,
      texto: `${parteDe(naoIdentificado, total) ?? 0}% de quem chegou não disse por onde conheceu a Imova, e a IA não achou pista na conversa.`,
      acao: { rotulo: 'Ver de onde vieram', alvo: 'origem' },
    });
  } else if (parado) {
    achados.push({
      chave: 'confira',
      selo: 'Confira',
      tom: 'atencao',
      titulo: `“${encurtar(parado.titulo, 40)}” é visto e não traz ninguém`,
      texto: `${inteiro(parado.vistos)} vistos no portal e nenhum contato chegou ao CRM.`,
      acao: { rotulo: 'Ver anúncio a anúncio', alvo: 'anuncios' },
    });
  }

  // 3. Atendimento.
  const p = dados.sistema?.primeiro;
  const ia = contagem(p?.ia);
  const equipe = contagem(p?.equipe);
  const ninguem = contagem(p?.ninguem);
  const iaMin = numero(p?.ia_mediana_min);
  const equipeMin = numero(p?.equipe_mediana_min);
  if (ia > 0 && equipe > 0 && iaMin !== null && equipeMin !== null && iaMin < equipeMin) {
    achados.push({
      chave: 'atendimento',
      selo: 'Atendimento',
      tom: ninguem > 0 ? 'atencao' : 'neutro',
      titulo: `Quando a IA responde primeiro, o cliente espera ${tempoCurto(iaMin)}. Quando é a equipe, ${tempoCurto(equipeMin)}.`,
      texto:
        `Mediana de quem respondeu primeiro: a IA em ${contar(ia, 'chegada', 'chegadas')}, a equipe em ${inteiro(equipe)}.` +
        (ninguem > 0 ? ` Outras ${inteiro(ninguem)} ficaram sem resposta nenhuma.` : ''),
      acao: {
        rotulo: ninguem > 0 ? `Abrir ${plural(ninguem, 'a sem resposta', `as ${inteiro(ninguem)} sem resposta`)}` : 'Ver o atendimento',
        alvo: 'sistema',
      },
    });
  } else if (ninguem > 0) {
    achados.push({
      chave: 'atendimento',
      selo: 'Atendimento',
      tom: 'atencao',
      titulo: `${contar(ninguem, 'chegada ficou', 'chegadas ficaram')} sem resposta`,
      texto: `Ninguém da equipe nem a IA respondeu ${plural(ninguem, 'essa pessoa', 'essas pessoas')} até agora.`,
      acao: { rotulo: 'Abrir a lista', alvo: 'sistema' },
    });
  } else {
    const rapidas = contagem(dados.kpis?.rapidas);
    achados.push({
      chave: 'atendimento',
      selo: 'Atendimento',
      tom: 'neutro',
      titulo: `${parteDe(rapidas, total) ?? 0}% das chegadas foram respondidas em até 5 min`,
      texto: `Todas as ${inteiro(total)} chegadas do período tiveram resposta.`,
      acao: { rotulo: 'Ver o atendimento', alvo: 'sistema' },
    });
  }

  return achados;
}

// ---------------------------------------------------------------------------
// Anúncio a anúncio
// ---------------------------------------------------------------------------

export type OrdemDosAnuncios = 'interesse' | 'vistos' | 'contatos';

/** Os vistos que a linha mostra: os do período, quando a foto diária já cobre; senão, o acumulado. */
export function vistosDaLinha(a: LinhaDoAnuncio): { valor: number | null; doPeriodo: boolean } {
  const periodo = numero(a.vistos_periodo);
  return periodo !== null ? { valor: periodo, doPeriodo: true } : { valor: numero(a.vistos), doPeriodo: false };
}

export function contatosDaLinha(a: LinhaDoAnuncio): { valor: number | null; doPeriodo: boolean } {
  const periodo = numero(a.contatos_periodo);
  return periodo !== null ? { valor: periodo, doPeriodo: true } : { valor: numero(a.contatos), doPeriodo: false };
}

/** Os anúncios do quadro (no ar, ou só no CRM com gente) e os que estão fora do ar no portal. */
export function separarAnuncios(lista: readonly LinhaDoAnuncio[] | null | undefined): {
  noAr: LinhaDoAnuncio[];
  fora: LinhaDoAnuncio[];
} {
  const todos = Array.isArray(lista) ? lista : [];
  return {
    noAr: todos.filter(
      (a) =>
        a.situacao === 'no_ar' ||
        (a.situacao === 'so_no_crm' && (contagem(a.interessados) > 0 || contagem(a.chegaram) > 0)),
    ),
    fora: todos.filter((a) => a.situacao === 'fora_do_ar'),
  };
}

export function ordenarAnuncios(lista: readonly LinhaDoAnuncio[], ordem: OrdemDosAnuncios): LinhaDoAnuncio[] {
  const chave = (a: LinhaDoAnuncio): number[] => {
    if (ordem === 'vistos') return [vistosDaLinha(a).valor ?? -1, contagem(a.interessados)];
    if (ordem === 'contatos') return [contatosDaLinha(a).valor ?? -1, contagem(a.chegaram)];
    return [contagem(a.muito), contagem(a.interessados), contagem(a.chegaram), vistosDaLinha(a).valor ?? -1];
  };
  return [...lista].sort((x, y) => {
    const a = chave(x);
    const b = chave(y);
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return b[i]! - a[i]!;
    }
    return x.codigo.localeCompare(y.codigo);
  });
}

/** O anúncio no ar mais visto que não trouxe ninguém (para o achado "visto e não traz ninguém"). */
function anuncioVistoSemNinguem(lista: readonly LinhaDoAnuncio[] | null | undefined): LinhaDoAnuncio | null {
  const candidatos = (Array.isArray(lista) ? lista : []).filter(
    (a) =>
      a.situacao === 'no_ar' &&
      (vistosDaLinha(a).valor ?? 0) >= 100 &&
      contagem(a.chegaram) === 0 &&
      contagem(a.interessados) === 0,
  );
  return ordenarAnuncios(candidatos, 'vistos')[0] ?? null;
}

/**
 * A leitura de uma linha, em até duas frases: o que ela tem de notável (o que
 * mais interessa, o mais visto, visto sem ninguém), os anúncios antigos somados e
 * os contatos do portal que ainda não viraram conversa.
 */
export function leituraDoAnuncio(
  a: LinhaDoAnuncio,
  contexto: { maisInteresse: string | null; maisVisto: string | null },
): string {
  const frases: string[] = [];
  const vistos = vistosDaLinha(a).valor ?? 0;
  const muito = contagem(a.muito);
  if (a.codigo === contexto.maisInteresse && contagem(a.interessados) > 0) {
    frases.push(
      muito > 0
        ? `O que mais interessa: ${contar(muito, 'muito interessado', 'muito interessados')}.`
        : 'O que mais interessa.',
    );
  } else if (a.situacao === 'so_no_crm') {
    frases.push(muito > 0 ? 'Fora do portal, e mesmo assim com gente muito interessada.' : 'Fora do portal.');
  } else if (a.codigo === contexto.maisVisto && vistos > 0) {
    frases.push('O mais visto no ar.');
  } else if (a.situacao === 'no_ar' && vistos >= 100 && contagem(a.chegaram) === 0 && contagem(a.interessados) === 0) {
    frases.push(`${inteiro(vistos)} vistos e ninguém no CRM.`);
  } else if (a.situacao === 'fora_do_ar' && contagem(a.chegaram) > 0) {
    frases.push('Ainda traz gente mesmo fora do ar.');
  }
  const juntou = Array.isArray(a.juntou) ? a.juntou : [];
  if (juntou.length > 0) {
    frases.push(`Soma ${plural(juntou.length, 'o anúncio antigo', 'os anúncios antigos')} (${juntou.join(', ')}).`);
  }
  const semConversa = contagem(a.sem_conversa);
  if (semConversa > 0) {
    frases.push(`${contar(semConversa, 'contato do portal ainda sem conversa', 'contatos do portal ainda sem conversa')}.`);
  }
  return frases.slice(0, 2).join(' ');
}
