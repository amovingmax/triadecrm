/**
 * O caminho até o primeiro lead dos portais (11/11/2026), só na Imova: a regra
 * que decide cada passo, sem React e sem banco, para o Vitest. Quem desenha é
 * `caminho-do-lead.tsx`; quem junta o estado é `public.anuncios_caminho_do_lead`
 * (migrações 20261111203000 e 20261113131000).
 *
 * O gargalo era "entra pouco lead": a produção tinha 0 leads dos portais, o
 * Canal Pro lia o arquivo do sistema que publicava antes do CRM (a Arbo, que a
 * tela chama de "sistema atual"), os 7 anúncios do CRM
 * estavam em rascunho, 2 das 10 vagas do plano tinham anúncios repetidos e
 * ninguém tinha feito um lead de teste. A troca da URL, a exclusão dos repetidos
 * e o lead de teste são passos de quem tem o login do Canal Pro: a lista diz o
 * que falta, com a ação ao lado, e some quando tudo está feito.
 *
 * A ORDEM (12/11/2026):
 *   1. Os leads vêm para o CRM. É o primeiro porque é o que traz lead, e porque
 *      não depende de nenhum outro: a homologação (10/11) só cadastrou o CRM no
 *      Grupo OLX; cada anunciante aponta a entrega no Canal Pro, em Integrações
 *      → aba Leads → "Receber leads no CRM", um campo SEPARADO do arquivo de
 *      anúncios. Os leads de um anúncio que veio da Arbo chegam ao CRM do mesmo
 *      jeito. Até 12/11 o Grupo OLX nunca tinha chamado a função de leads, e o
 *      caminho não falava desse campo: quem o seguia nunca ligava os leads.
 *      Olha SÓ o webhook (o que a função `grupozap-lead` anotou e os leads que
 *      ela gravou), para não ser dado como feito por um lead que chegou pelo
 *      WhatsApp com o texto do portal.
 *   2. Anúncios no ar pelo CRM, antes de colar a URL do arquivo: o arquivo do
 *      CRM só leva o que está no ar aqui, e o Grupo OLX tira do portal o que não
 *      está no arquivo que ele lê (decisão de 06/11/2026, "Antes de colar").
 *      Enquanto o Canal Pro ler o arquivo do sistema atual, pôr no ar pelo CRM
 *      não muda nada no portal.
 *   3. O Grupo OLX lê o arquivo do CRM.
 *   4. Sem repetidos ocupando vaga.
 *   5. O primeiro lead chega ao CRM: o lead de teste, que só serve depois do
 *      passo 1 (antes, ele vai para onde o Canal Pro manda hoje).
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

/** Quantas chamadas, e a última, nos últimos 7 dias. */
export type Contagem = { quantas: number; ultimaEm: string | null };

export type EstadoDoCaminho = {
  /** O que a função de leads (`grupozap-lead`) anotou, e o último lead dela (12/11/2026). */
  entrega: {
    /** A última chamada autenticada que não foi teste (lead recebido ou repetido). */
    ultimaChamadaReal: { em: string; doGrupoOlx: boolean } | null;
    /** O último lead gravado pelo webhook (os que chegam pelo WhatsApp ficam de fora). */
    ultimoLeadDoWebhook: string | null;
    /** A última chamada de teste (o validador do Grupo OLX), que não grava. */
    ultimoTeste: string | null;
    /** As recusas de credencial (401) de hoje e dos 6 dias antes. */
    recusas7Dias: { doGrupoOlx: Contagem; outras: Contagem };
    /** Os erros (400, 405, 413, 500, 503) de hoje e dos 6 dias antes. */
    erros7Dias: { doGrupoOlx: Contagem; outros: Contagem };
  };
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

export type PassoDaEntrega = Base & {
  id: 'entrega';
  /** Mostrar a URL de leads, o caminho no Canal Pro e os avisos. */
  ligar: boolean;
  /** O que mais as chamadas dizem (outro programa com a chave errada, o validador). */
  notas: string[];
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

export type PassoDoCaminho =
  PassoDaEntrega | PassoDosAnuncios | PassoDoArquivo | PassoDosRepetidos | PassoDosLeads;

const HORA = 3_600_000;
/** Mais que isso sem leitura do robô é leitura perdida: ele lê pelo menos uma vez por dia. */
export const HORAS_SEM_LEITURA = 48;
/** O relatório do Canal Pro, o ideal é importar uma vez por semana. */
export const DIAS_DO_RELATORIO = 7;
/**
 * Mais que isso sem lead entregue, com anúncios no portal, pede um olhar. Com
 * os 10 anúncios do plano da Imova, duas semanas sem nenhum contato é raro; e é
 * o prazo em que o Grupo OLX guarda um lead que não conseguiu entregar.
 */
export const DIAS_SEM_LEAD = 14;

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

/** A URL de leads vai em Integrações → aba Leads, no Canal Pro; os passos curtos. */
export const LIGAR_NO_CANAL_PRO = [
  'Entre no Canal Pro com o login da Imova e abra ☰ → Configurações → Integrações, aba Leads.',
  'Em “Receber leads no CRM”, clique em Configurar.',
  'Escolha o CRM “Desenvolvedor Próprio” (ou “Imova CRM”, se aparecer na lista), cole a URL de leads e salve.',
] as const;

/** Os três avisos de quem vai trocar o campo. */
export const AVISOS_AO_LIGAR = [
  'Se o campo mostrar a URL da Arbo (…execute-api.sa-east-1.amazonaws.com/arbo), é para lá que os leads vão hoje: troque pela do CRM. A Arbo deixa de receber os leads dos portais.',
  'Se a tela não deixar trocar, abra um chamado no suporte do Canal Pro pedindo para ligar a conta à integração de leads do CRM homologado em 10/11/2026 (Imova CRM).',
  'Mantenha o e-mail da Imova em “Receber leads no e-mail”: ele fica como cópia.',
] as const;

/** O que entrou por último pelo webhook: a chamada anotada ou o lead gravado. */
export function ultimaEntrega(e: EstadoDoCaminho): string | null {
  const datas = [e.entrega.ultimaChamadaReal?.em, e.entrega.ultimoLeadDoWebhook].filter(
    (d): d is string => typeof d === 'string' && !Number.isNaN(Date.parse(d)),
  );
  if (datas.length === 0) return null;
  return datas.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
}

/**
 * A última entrega é uma chamada real SEM o user-agent do Grupo OLX, e nenhum
 * lead do webhook é mais novo que ela? O lead que essa chamada gravou é dela
 * (o lead é gravado antes de a chamada ser anotada), então não conta.
 */
export function entregaDeOutro(e: EstadoDoCaminho): boolean {
  const chamada = e.entrega.ultimaChamadaReal;
  if (chamada === null || chamada.doGrupoOlx || Number.isNaN(Date.parse(chamada.em))) return false;
  const lead = e.entrega.ultimoLeadDoWebhook;
  return (
    lead === null || Number.isNaN(Date.parse(lead)) || Date.parse(lead) <= Date.parse(chamada.em)
  );
}

/** A contagem tem chamada mais nova que a última entrega (ou não houve entrega)? */
function depoisDaEntrega(c: Contagem, entrega: string | null): boolean {
  if (c.quantas <= 0) return false;
  if (entrega === null) return true;
  return c.ultimaEm !== null && Date.parse(c.ultimaEm) > Date.parse(entrega);
}

function vezes(n: number): string {
  return `${n} ${plural(n, 'vez', 'vezes')}`;
}

/**
 * 1. Os leads vêm para o CRM (12/11/2026). Só o webhook conta.
 *
 *   * falta: o Grupo OLX nunca entregou um lead pela função. Mostra a URL de
 *     leads, o caminho no Canal Pro e os avisos — a não ser que o Grupo OLX já
 *     esteja batendo e sendo recusado (a URL está lá; a chave é que não
 *     confere) ou que o CRM esteja falhando: aí diz isso, sem a URL;
 *   * pede um olhar: depois da última entrega, o Grupo OLX foi recusado pela
 *     chave (401 com o user-agent dele, nos últimos 7 dias) ou recebeu erro; ou
 *     a última entrega não veio com o user-agent do Grupo OLX (alguém com a
 *     chave de verdade, num teste: não prova que o Canal Pro entrega); ou a
 *     última entrega tem mais de 14 dias e há anúncios no portal;
 *   * feito: "O Grupo OLX entregou o último lead há X h", só com a última
 *     chamada vinda do Grupo OLX, ou com lead do webhook mais novo que ela (o
 *     lead gravado antes de a função anotar as chamadas).
 */
export function passoDaEntrega(e: EstadoDoCaminho, agora: Date): PassoDaEntrega {
  const nome = 'Os leads vêm para o CRM';
  const base = { id: 'entrega' as const, nome };
  const entrega = ultimaEntrega(e);
  const { recusas7Dias, erros7Dias, ultimoTeste } = e.entrega;

  const recusas = recusas7Dias.doGrupoOlx;
  if (depoisDaEntrega(recusas, entrega)) {
    return {
      ...base,
      situacao: entrega === null ? 'falta' : 'atencao',
      resumo: `O Grupo OLX tentou entregar leads ${vezes(recusas.quantas)} nos últimos 7 dias e a chave não conferiu${recusas.ultimaEm ? `: a última ${haQuanto(recusas.ultimaEm, agora)}` : ''}`,
      detalhe:
        'A URL de leads está certa no Canal Pro, mas a chave (SECRET_KEY) que o Grupo OLX manda não é a gravada no CRM. Peça a quem cuida do CRM para conferir o segredo GRUPOZAP_LEAD_SECRET da função de leads. Enquanto isso, os leads só aparecem no Canal Pro (e no e-mail, se estiver ligado).',
      ligar: false,
      notas: [],
    };
  }
  const erros = erros7Dias.doGrupoOlx;
  if (depoisDaEntrega(erros, entrega)) {
    return {
      ...base,
      situacao: entrega === null ? 'falta' : 'atencao',
      resumo: `O Grupo OLX tentou entregar leads ${vezes(erros.quantas)} nos últimos 7 dias e o CRM falhou${erros.ultimaEm ? `: a última ${haQuanto(erros.ultimaEm, agora)}` : ''}`,
      detalhe:
        'O Grupo OLX tenta cada lead 3 vezes. Peça a quem cuida do CRM para olhar os registros da função de leads (grupozap-lead).',
      ligar: false,
      notas: [],
    };
  }

  if (entrega === null) {
    const notas: string[] = [];
    const outras = recusas7Dias.outras;
    if (outras.quantas > 0) {
      notas.push(
        `Nos últimos 7 dias, ${plural(outras.quantas, '1 chamada', `${outras.quantas} chamadas`)} com a chave errada ${plural(outras.quantas, 'veio', 'vieram')} de outro programa, não do Grupo OLX${outras.ultimaEm ? ` (a última ${haQuanto(outras.ultimaEm, agora)})` : ''}.`,
      );
    }
    if (ultimoTeste) {
      notas.push(
        `A URL de leads respondeu a um teste ${haQuanto(ultimoTeste, agora)} (o validador do Grupo OLX; teste não grava lead).`,
      );
    }
    return {
      ...base,
      situacao: 'falta',
      resumo: 'Ligue os leads no Canal Pro',
      detalhe:
        'O Grupo OLX ainda não entregou nenhum lead ao CRM. A homologação só cadastrou o CRM no Grupo OLX: falta apontar a entrega dos leads no Canal Pro, num campo separado do arquivo de anúncios. Não depende da troca do arquivo (passo 3): os leads vêm para o CRM mesmo com os anúncios ainda saindo pela Arbo.',
      ligar: true,
      notas,
    };
  }

  // A última entrega foi uma chamada sem o user-agent do Grupo OLX (um teste
  // com a chave de verdade, por exemplo): não prova que o Canal Pro entrega.
  if (entregaDeOutro(e)) {
    return {
      ...base,
      situacao: 'atencao',
      resumo: `Um lead chegou pela URL de leads ${haQuanto(entrega, agora)}, mas não veio do Grupo OLX`,
      detalhe:
        'A chamada não trouxe o user-agent do Grupo OLX: parece um teste feito com a chave de verdade, e não prova que o Canal Pro entrega os leads ao CRM. Confira no Canal Pro, em Integrações → aba Leads, se “Receber leads no CRM” está com a URL do CRM.',
      ligar: true,
      notas: [],
    };
  }

  const dias = Math.floor((agora.getTime() - Date.parse(entrega)) / (24 * HORA));
  const noPortal = e.plano.anunciosEmUso;
  if (dias > DIAS_SEM_LEAD && noPortal > 0) {
    return {
      ...base,
      situacao: 'atencao',
      resumo: `O Grupo OLX não entrega um lead há ${dias} dias`,
      detalhe: `Com ${noPortal} ${plural(noPortal, 'anúncio', 'anúncios')} no portal, é tempo demais. Confira no Canal Pro, em Integrações → aba Leads, se “Receber leads no CRM” continua com a URL do CRM.`,
      ligar: true,
      notas: [],
    };
  }

  return {
    ...base,
    situacao: 'feito',
    resumo: `O Grupo OLX entregou o último lead ${haQuanto(entrega, agora)}`,
    detalhe: null,
    ligar: false,
    notas: [],
  };
}

/**
 * 2. Os anúncios no ar pelo CRM. Os prontos entram na ordem do banco (primeiro
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
        'Exclua no Canal Pro os repetidos que ocupam vaga (passo 4), ou tire outro anúncio do ar.',
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
 * 3. O Grupo OLX lê o arquivo do CRM. Nunca leu: colar a URL (com o aviso de
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
          ? `Antes de colar, ponha no ar pelo CRM ${plural(n, 'o anúncio que está', `os ${n} anúncios que estão`)} no portal pelo sistema atual (passo 2). O arquivo do CRM só leva o que está no ar aqui: sem isso, a troca ${plural(n, 'o tira', 'os tira')} do portal.`
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
        'Com o arquivo vazio, o Grupo OLX tira do portal os anúncios da integração. Ponha os anúncios no ar pelo CRM (passo 2).',
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
 * 4. Os repetidos que ocupam vaga, no último relatório importado. O relatório é
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

/** Antes de ligar os leads, o teste não chega aqui (12/11/2026). */
export const TESTE_DEPOIS_DE_LIGAR =
  'Primeiro ligue os leads no Canal Pro (passo 1): antes disso, o lead de teste vai para onde o Canal Pro manda hoje e não aparece aqui.';

/**
 * 5. O primeiro lead: a prova de ponta a ponta. Conta qualquer lead dos portais
 * (também o que chega pelo WhatsApp com o texto do portal). O lead de teste só
 * serve depois do passo 1.
 */
export function passoDosLeads(e: EstadoDoCaminho, agora: Date): PassoDosLeads {
  const nome = 'O primeiro lead chega ao CRM';
  const u = e.leads.ultimo;
  if (!u) {
    return {
      id: 'leads',
      nome,
      situacao: 'falta',
      resumo: 'Nenhum lead chegou ainda',
      detalhe:
        ultimaEntrega(e) === null ? `${TESTE_DEPOIS_DE_LIGAR} ${LEAD_DE_TESTE}` : LEAD_DE_TESTE,
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
  passos: [PassoDaEntrega, PassoDosAnuncios, PassoDoArquivo, PassoDosRepetidos, PassoDosLeads];
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
    passoDaEntrega(e, agora),
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
