/**
 * O caminho até o primeiro lead dos portais (11/11/2026), só na Imova: a regra
 * que decide cada passo, sem React e sem banco, para o Vitest. Quem desenha é
 * `caminho-do-lead.tsx`; quem junta o estado é `public.anuncios_caminho_do_lead`
 * (migração 20261111203000).
 *
 * O gargalo era "entra pouco lead": a produção tinha 0 leads dos portais, o
 * Canal Pro lia o arquivo do sistema que publicava antes do CRM (a Arbo, que a
 * tela chama de "sistema atual"), os 7 anúncios do CRM
 * estavam em rascunho, 2 das 10 vagas do plano tinham anúncios repetidos e
 * ninguém tinha feito um lead de teste. A troca da URL, a exclusão dos repetidos
 * e o lead de teste são passos de quem tem o login do Canal Pro: a lista diz o
 * que falta, com a ação ao lado, e some quando tudo está feito.
 *
 * A ORDEM. Pôr os anúncios no ar pelo CRM vem antes de colar a URL: o arquivo do
 * CRM só leva o que está no ar aqui, e o Grupo OLX tira do portal o que não está
 * no arquivo que ele lê (decisão de 06/11/2026, "Antes de colar"). Enquanto o
 * Canal Pro ler o arquivo do sistema atual, pôr no ar pelo CRM não muda nada
 * no portal.
 */
import { diaEmNatal, recebidoHa, resumoDosTipos } from './leads/leads-rotulos';
import type { SituacaoDoCanalPro } from './tipos';

// ---------------------------------------------------------------------------
// O estado, como `anuncios_caminho_do_lead` devolve
// ---------------------------------------------------------------------------

export type AnuncioDoCaminho = { id: string; codigo: string; titulo: string };
/** Rascunho sem pendência. `ocupaVaga`: o último relatório já o conta (mesmo código, ativo lá). */
export type AnuncioPronto = AnuncioDoCaminho & { ocupaVaga: boolean };
export type AnuncioComPendencia = AnuncioDoCaminho & { pendencias: string[] };
/** A linha antiga do relatório que parece o mesmo imóvel de um anúncio do CRM. */
export type RepetidoNoRelatorio = {
  id: string;
  codigo: string;
  titulo: string | null;
  situacao: string | null;
  /** O código do anúncio do CRM de que ela é cópia. */
  copiaDe: string;
  /** Marcado como excluído, mas o relatório seguinte ainda a trouxe. */
  marcadoExcluidoEm: string | null;
};

export type EstadoDoCaminho = {
  arquivo: {
    /** A última leitura do robô do Grupo OLX (user-agent "VivaRealBot"). */
    leituraDoRobo: { em: string; anuncios: number } | null;
    leiturasDoRobo7Dias: number;
    /** A última leitura de outro programa (um teste no navegador, ou o robô com outro nome). */
    outraLeitura: { em: string; quem: string } | null;
  };
  plano: SituacaoDoCanalPro['plano'];
  anuncios: {
    noAr: number;
    /** No ar e sem pendência: o que o arquivo leva agora. */
    noArquivo: number;
    /** No ar no CRM com pendência: o arquivo os pula. */
    foraDoArquivo: AnuncioComPendencia[];
    prontos: AnuncioPronto[];
    comPendencia: AnuncioComPendencia[];
  };
  relatorio: {
    importadoEm: string | null;
    repetidosAtivos: RepetidoNoRelatorio[];
    repetidosInativos: number;
  };
  leads: {
    ultimo: { id: string; em: string; tipos: string[]; anuncio: string | null } | null;
    total: number;
  };
};

// ---------------------------------------------------------------------------
// Os passos
// ---------------------------------------------------------------------------

/** feito; falta (a pessoa precisa agir); atencao (feito, mas pede um olhar). */
export type SituacaoDoPasso = 'feito' | 'falta' | 'atencao';

type Base = {
  situacao: SituacaoDoPasso;
  /** O nome fixo do passo. */
  nome: string;
  /** A linha que diz como ele está. */
  resumo: string;
  /** O que fazer, quando há o que fazer. */
  detalhe: string | null;
};

export type PassoDosAnuncios = Base & {
  id: 'anuncios';
  /** "9 de 10 vagas"; null quando o plano não está no CRM. */
  vagas: string | null;
  /** Os prontos que cabem no plano agora, na ordem em que vão ao ar. */
  cabem: AnuncioPronto[];
  /** Os prontos que esperam vaga. */
  esperamVaga: AnuncioPronto[];
};

export type PassoDoArquivo = Base & {
  id: 'arquivo';
  /** Mostrar a URL para copiar e o caminho no Canal Pro. */
  colar: boolean;
  /** O aviso de pôr no ar antes de colar. */
  antesDeColar: string | null;
  /** A leitura de outro programa, quando o robô nunca leu. */
  outraLeitura: string | null;
};

export type PassoDosRepetidos = Base & {
  id: 'repetidos';
  /** "Relatório importado há 3 dias"; null quando nunca foi importado. */
  relatorio: string | null;
  /** Mais de 7 dias: o ideal é importar uma vez por semana. */
  relatorioVelho: boolean;
};

export type PassoDosLeads = Base & { id: 'leads' };

export type PassoDoCaminho = PassoDosAnuncios | PassoDoArquivo | PassoDosRepetidos | PassoDosLeads;

const HORA = 3_600_000;
/** Mais que isso sem leitura do robô é leitura perdida: ele lê pelo menos uma vez por dia. */
export const HORAS_SEM_LEITURA = 48;
/** O relatório do Canal Pro, o ideal é importar uma vez por semana. */
export const DIAS_DO_RELATORIO = 7;

function plural(n: number, um: string, varios: string): string {
  return n === 1 ? um : varios;
}

/** "há 12 min", "há 5 h", "há 3 dias". */
export function haQuanto(iso: string, agora: Date): string {
  const ms = Math.max(0, agora.getTime() - new Date(iso).getTime());
  const minutos = Math.floor(ms / 60_000);
  if (minutos < 1) return 'agora há pouco';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(ms / HORA);
  if (horas < HORAS_SEM_LEITURA) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} ${plural(dias, 'dia', 'dias')}`;
}

/** Quantos dias de calendário (de Natal) separam `iso` de `agora`. */
export function diasDeCalendario(iso: string, agora: Date): number {
  const meiaNoite = (d: Date) => Date.parse(`${diaEmNatal(d)}T00:00:00Z`);
  return Math.max(0, Math.round((meiaNoite(agora) - meiaNoite(new Date(iso))) / 86_400_000));
}

/** "hoje", "ontem", "há 9 dias". */
function quandoFoi(dias: number): string {
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias} dias`;
}

/**
 * 1. Os anúncios no ar pelo CRM. Os prontos entram na ordem do banco (primeiro
 * os que o relatório já conta, que não gastam vaga nova); os outros cabem até as
 * vagas livres do plano. No ar com pendência é o pior caso: o anúncio parece no
 * ar, e o arquivo o pula.
 */
export function passoDosAnuncios(e: EstadoDoCaminho): PassoDosAnuncios {
  const { plano, anuncios: a } = e;
  let livres =
    plano.anuncios == null ? Infinity : Math.max(0, plano.anuncios - plano.anunciosEmUso);
  const cabem: AnuncioPronto[] = [];
  const esperamVaga: AnuncioPronto[] = [];
  for (const p of a.prontos) {
    if (p.ocupaVaga) cabem.push(p);
    else if (livres > 0) {
      cabem.push(p);
      livres -= 1;
    } else esperamVaga.push(p);
  }
  const vagas = plano.anuncios == null ? null : `${plano.anunciosEmUso} de ${plano.anuncios} vagas`;
  const comVagas = (texto: string) => (vagas ? `${texto} · ${vagas}` : texto);
  const nome = 'Anúncios no ar pelo CRM';
  const base = { id: 'anuncios' as const, nome, vagas, cabem, esperamVaga };
  const n = a.foraDoArquivo.length;

  if (n > 0) {
    return {
      ...base,
      situacao: 'falta',
      resumo: comVagas(
        `${n} ${plural(n, 'anúncio no ar no CRM, mas fora', 'anúncios no ar no CRM, mas fora')} do arquivo`,
      ),
      detalhe:
        'O arquivo do Canal Pro só leva anúncio sem pendência. Complete o que falta, ou tire do ar.',
    };
  }
  if (cabem.length > 0) {
    const lido = e.arquivo.leituraDoRobo !== null;
    return {
      ...base,
      situacao: 'falta',
      resumo: comVagas(
        `${cabem.length} ${plural(cabem.length, 'anúncio pronto', 'anúncios prontos')} para pôr no ar`,
      ),
      detalhe: lido
        ? 'Entram no portal na próxima leitura do Grupo OLX.'
        : 'Enquanto o Canal Pro ler o arquivo do sistema atual, isto não muda o portal: deixa o arquivo do CRM pronto para a troca.',
    };
  }
  if (esperamVaga.length > 0) {
    const m = esperamVaga.length;
    return {
      ...base,
      situacao: a.noAr === 0 ? 'falta' : 'atencao',
      resumo: `Plano cheio: ${m} ${plural(m, 'pronto espera', 'prontos esperam')} vaga · ${vagas}`,
      detalhe:
        'Exclua no Canal Pro os repetidos que ocupam vaga (passo 3), ou tire outro anúncio do ar.',
    };
  }
  if (a.noAr === 0) {
    return {
      ...base,
      situacao: 'falta',
      resumo: comVagas('Nenhum anúncio no ar pelo CRM'),
      detalhe:
        a.comPendencia.length > 0
          ? 'Complete um dos rascunhos abaixo, ou crie um anúncio.'
          : 'Crie um anúncio, ou traga os do sistema atual em "Atualizar do sistema atual".',
    };
  }
  return {
    ...base,
    situacao: 'feito',
    resumo: comVagas(`${a.noAr} no ar`),
    detalhe: null,
  };
}

/**
 * 2. O Grupo OLX lê o arquivo do CRM. Nunca leu: colar a URL (com o aviso de
 * pôr no ar antes, se há anúncio no portal pelo sistema atual que é rascunho
 * aqui). Leu o arquivo vazio: o portal tira tudo. Leu há mais de 48 horas: a
 * URL pode ter saído do Canal Pro.
 *
 * `noPortalSoPeloSistemaAtual`: os anúncios que estão no portal pelo sistema
 * atual e não estão no ar no CRM (a mesma conta do "Antes de colar").
 */
export function passoDoArquivo(
  e: EstadoDoCaminho,
  agora: Date,
  noPortalSoPeloSistemaAtual: number,
): PassoDoArquivo {
  const nome = 'O Grupo OLX lê o arquivo do CRM';
  const l = e.arquivo.leituraDoRobo;
  const base = { id: 'arquivo' as const, nome, antesDeColar: null, outraLeitura: null };

  if (!l) {
    const n = noPortalSoPeloSistemaAtual;
    const outra = e.arquivo.outraLeitura;
    return {
      ...base,
      situacao: 'falta',
      resumo: 'Cole a URL do CRM no Canal Pro',
      detalhe:
        'O Grupo OLX ainda não leu o arquivo do CRM: o portal mostra o que o sistema atual (a Arbo) manda.',
      colar: true,
      antesDeColar:
        n > 0
          ? `Antes de colar, ponha no ar pelo CRM ${plural(n, 'o anúncio que está', `os ${n} anúncios que estão`)} no portal pelo sistema atual (passo 1). O arquivo do CRM só leva o que está no ar aqui: sem isso, a troca ${plural(n, 'o tira', 'os tira')} do portal.`
          : null,
      outraLeitura: outra
        ? `O arquivo foi aberto ${haQuanto(outra.em, agora)} por “${outra.quem}”, que não é o robô do Grupo OLX. Se a URL já está no Canal Pro, confira lá o Relatório de integração.`
        : null,
    };
  }
  if (l.anuncios === 0 && e.anuncios.noArquivo === 0) {
    return {
      ...base,
      situacao: 'falta',
      resumo: `A última leitura, ${haQuanto(l.em, agora)}, levou o arquivo vazio`,
      detalhe:
        'Com o arquivo vazio, o Grupo OLX tira do portal os anúncios da integração. Ponha os anúncios no ar pelo CRM (passo 1).',
      colar: false,
    };
  }
  const horas = (agora.getTime() - new Date(l.em).getTime()) / HORA;
  if (horas > HORAS_SEM_LEITURA) {
    return {
      ...base,
      situacao: 'atencao',
      resumo: `O Grupo OLX não lê o arquivo ${haQuanto(l.em, agora)}`,
      detalhe:
        'Ele lê pelo menos uma vez por dia. Confira no Canal Pro, em Integração de anúncios, se a URL do CRM continua lá.',
      colar: true,
    };
  }
  return {
    ...base,
    situacao: 'feito',
    resumo: `Leu ${haQuanto(l.em, agora)}, com ${l.anuncios} ${plural(l.anuncios, 'anúncio', 'anúncios')}`,
    detalhe: null,
    colar: false,
  };
}

/**
 * 3. Os repetidos que ocupam vaga, no último relatório importado. O relatório é
 * uma foto do dia: velho, ele não confere as vagas nem as exclusões feitas no
 * Canal Pro (o ideal é uma vez por semana).
 */
export function passoDosRepetidos(e: EstadoDoCaminho, agora: Date): PassoDosRepetidos {
  const nome = 'Sem repetidos ocupando vaga';
  const { importadoEm, repetidosAtivos } = e.relatorio;
  if (!importadoEm) {
    return {
      id: 'repetidos',
      nome,
      situacao: 'falta',
      resumo: 'Nenhum relatório do Canal Pro importado',
      detalhe:
        'O relatório diz o que está ativo no Canal Pro e quais anúncios são repetidos. Exporte lá (Anúncios → Exportar relatório; chega por e-mail) e importe aqui.',
      relatorio: null,
      relatorioVelho: true,
    };
  }
  const dias = diasDeCalendario(importadoEm, agora);
  const relatorio = `Relatório importado ${quandoFoi(dias)}`;
  const relatorioVelho = dias > DIAS_DO_RELATORIO;
  const base = { id: 'repetidos' as const, nome, relatorio, relatorioVelho };
  const n = repetidosAtivos.length;
  if (n > 0) {
    return {
      ...base,
      situacao: 'falta',
      resumo: `${n} ${plural(n, 'repetido ocupa', 'repetidos ocupam')} vaga · ${relatorio.toLowerCase()}`,
      detalhe:
        'O Grupo OLX não deixa o CRM excluir no Canal Pro: o botão copia o código e abre o Canal Pro, a exclusão é um clique lá, e o próximo relatório confere.',
    };
  }
  if (relatorioVelho) {
    return {
      ...base,
      situacao: 'atencao',
      resumo: `${relatorio}: importe de novo`,
      detalhe:
        'O ideal é uma vez por semana: é o relatório que confere as vagas, os repetidos e as exclusões feitas no Canal Pro.',
    };
  }
  return {
    ...base,
    situacao: 'feito',
    resumo: `Nenhum repetido ocupa vaga · ${relatorio.toLowerCase()}`,
    detalhe: null,
  };
}

/** O texto do lead de teste (pedido de 11/11/2026). */
export const LEAD_DE_TESTE =
  'Faça um teste: no celular, abra um anúncio seu no ZAP, preencha o formulário com seu nome e telefone e confira se ele aparece em Anúncios → Leads e se o aviso chega.';

/** 4. O primeiro lead: prova que o Grupo OLX manda os leads da Imova para o CRM. */
export function passoDosLeads(e: EstadoDoCaminho, agora: Date): PassoDosLeads {
  const nome = 'O primeiro lead chega ao CRM';
  const u = e.leads.ultimo;
  if (!u) {
    return {
      id: 'leads',
      nome,
      situacao: 'falta',
      resumo: 'Nenhum lead chegou ainda',
      detalhe: LEAD_DE_TESTE,
    };
  }
  const total = e.leads.total;
  return {
    id: 'leads',
    nome,
    situacao: 'feito',
    resumo: `Último ${recebidoHa(u.em, agora)}: ${resumoDosTipos(u.tipos)}${u.anuncio ? ` · ${u.anuncio}` : ''} (${total} no total)`,
    detalhe: null,
  };
}

export type Caminho = {
  passos: [PassoDosAnuncios, PassoDoArquivo, PassoDosRepetidos, PassoDosLeads];
  /** Nenhum passo com "falta": a lista vira a linha "Portais ligados". */
  ligado: boolean;
  /** O que pede um olhar mesmo com tudo feito (vai na linha pequena). */
  avisos: string[];
};

export function caminhoDoLead(
  e: EstadoDoCaminho,
  agora: Date,
  noPortalSoPeloSistemaAtual: number,
): Caminho {
  const passos: Caminho['passos'] = [
    passoDosAnuncios(e),
    passoDoArquivo(e, agora, noPortalSoPeloSistemaAtual),
    passoDosRepetidos(e, agora),
    passoDosLeads(e, agora),
  ];
  return {
    passos,
    ligado: passos.every((p) => p.situacao !== 'falta'),
    avisos: passos.filter((p) => p.situacao === 'atencao').map((p) => p.resumo),
  };
}
