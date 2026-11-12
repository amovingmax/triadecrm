import { describe, expect, it } from 'vitest';

import {
  AVISOS_AO_LIGAR,
  caminhoDoLead,
  DIAS_SEM_LEAD,
  diasDeCalendario,
  type EstadoDoCaminho,
  haQuanto,
  LEAD_DE_TESTE,
  LIGAR_NO_CANAL_PRO,
  entregaDeOutro,
  passoDaEntrega,
  passoDoArquivo,
  passoDosAnuncios,
  passoDosLeads,
  passoDosRepetidos,
  TESTE_DEPOIS_DE_LIGAR,
  ultimaEntrega,
} from './passos-do-caminho';

/** 11/11/2026, 10h em Natal (13h UTC). */
const AGORA = new Date('2026-11-11T13:00:00Z');
const horasAntes = (h: number) => new Date(AGORA.getTime() - h * 3_600_000).toISOString();

const pronto = (codigo: string, ocupaVaga: boolean) => ({
  id: `id-${codigo}`,
  codigo,
  titulo: `Terreno ${codigo}`,
  ocupaVaga,
});

const NADA = { quantas: 0, ultimaEm: null };

/** O Grupo OLX nunca chamou a função de leads (a produção em 12/11/2026). */
const SEM_ENTREGA: EstadoDoCaminho['entrega'] = {
  ultimaChamadaReal: null,
  ultimoLeadDoWebhook: null,
  ultimoTeste: null,
  recusas7Dias: { doGrupoOlx: NADA, outras: NADA },
  erros7Dias: { doGrupoOlx: NADA, outros: NADA },
};

/** A Imova em 11/11/2026: nada lido, 7 prontos da Arbo, 9 de 10 vagas, 2 repetidos, 0 leads. */
const HOJE: EstadoDoCaminho = {
  entrega: SEM_ENTREGA,
  arquivo: { leituraDoRobo: null, leiturasDoRobo7Dias: 0, outraLeitura: null },
  plano: { anuncios: 10, destaques: 2, anunciosEmUso: 9, destaquesEmUso: 2 },
  anuncios: {
    noAr: 0,
    noArquivo: 0,
    foraDoArquivo: [],
    prontos: [
      'PT0001_IMOVA',
      'SA0012_IMOVA',
      'TE0001_IMOVA',
      'TE0002_IMOVA',
      'TE0003_IMOVA',
      'TE0004_IMOVA',
      'TE0005_IMOVA',
    ].map((c) => pronto(c, true)),
    comPendencia: [
      {
        id: 'id-simone',
        codigo: 'Edifício Simone',
        titulo: 'Edifício Simone',
        pendencias: ['pelo menos 1 foto'],
      },
    ],
  },
  relatorio: {
    importadoEm: '2026-11-05T20:38:00Z',
    repetidosAtivos: [
      {
        id: 'r1',
        codigo: 'BONOR-ESQUINA-HERONIDES',
        titulo: 'Terreno BONOR',
        situacao: 'Ativo',
        copiaDe: 'TE0002_IMOVA',
        marcadoExcluidoEm: null,
      },
      {
        id: 'r2',
        codigo: 'Terreno - Pipa',
        titulo: 'Terreno Pipa',
        situacao: 'Ativo',
        copiaDe: 'TE0005_IMOVA',
        marcadoExcluidoEm: null,
      },
    ],
    repetidosInativos: 4,
  },
  leads: { ultimo: null, total: 0 },
};

/** Tudo feito: o Grupo OLX entregou há 2 h, 7 no ar, lido há 3 h, sem repetidos, relatório de ontem, um lead. */
const LIGADO: EstadoDoCaminho = {
  entrega: {
    ...SEM_ENTREGA,
    ultimaChamadaReal: { em: horasAntes(2), doGrupoOlx: true },
    ultimoLeadDoWebhook: horasAntes(2),
  },
  arquivo: {
    leituraDoRobo: { em: horasAntes(3), anuncios: 7 },
    leiturasDoRobo7Dias: 5,
    outraLeitura: null,
  },
  plano: { anuncios: 10, destaques: 2, anunciosEmUso: 7, destaquesEmUso: 0 },
  anuncios: { noAr: 7, noArquivo: 7, foraDoArquivo: [], prontos: [], comPendencia: [] },
  relatorio: { importadoEm: horasAntes(20), repetidosAtivos: [], repetidosInativos: 0 },
  leads: {
    ultimo: { id: 'lead-1', em: horasAntes(2), tipos: ['CONTACT_FORM'], anuncio: 'TE0002_IMOVA' },
    total: 1,
  },
};

describe('haQuanto e diasDeCalendario', () => {
  it('minutos, horas e dias', () => {
    expect(haQuanto(new Date(AGORA.getTime() - 20_000).toISOString(), AGORA)).toBe(
      'agora há pouco',
    );
    expect(haQuanto(new Date(AGORA.getTime() - 12 * 60_000).toISOString(), AGORA)).toBe(
      'há 12 min',
    );
    expect(haQuanto(horasAntes(5), AGORA)).toBe('há 5 h');
    expect(haQuanto(horasAntes(47), AGORA)).toBe('há 47 h');
    expect(haQuanto(horasAntes(72), AGORA)).toBe('há 3 dias');
  });

  it('dias de calendário no fuso de Natal', () => {
    // 10/11 às 23h em Natal (11/11 02h UTC) é ontem, mesmo com só 11 horas.
    expect(diasDeCalendario('2026-11-11T02:00:00Z', AGORA)).toBe(1);
    expect(diasDeCalendario('2026-11-11T10:00:00Z', AGORA)).toBe(0);
    expect(diasDeCalendario('2026-11-05T20:38:00Z', AGORA)).toBe(6);
  });
});

describe('1. Os leads vêm para o CRM', () => {
  it('nunca entregou: falta, com a URL de leads, o caminho no Canal Pro e os avisos', () => {
    const p = passoDaEntrega(HOJE, AGORA);
    expect(p.situacao).toBe('falta');
    expect(p.nome).toBe('Os leads vêm para o CRM');
    expect(p.resumo).toBe('Ligue os leads no Canal Pro');
    expect(p.ligar).toBe(true);
    expect(p.notas).toEqual([]);
    // Não depende da troca do arquivo de anúncios, e o texto diz isso.
    expect(p.detalhe).toMatch(/campo separado do arquivo de anúncios/);
    expect(p.detalhe).toMatch(/Não depende da troca do arquivo \(passo 3\)/);
  });

  it('o caminho no Canal Pro e os três avisos', () => {
    expect(LIGAR_NO_CANAL_PRO.join(' ')).toMatch(
      /☰ → Configurações → Integrações, aba Leads.*“Receber leads no CRM”.*Configurar.*“Desenvolvedor Próprio”.*salve/,
    );
    expect(AVISOS_AO_LIGAR).toHaveLength(3);
    expect(AVISOS_AO_LIGAR[0]).toMatch(/URL da Arbo.*troque pela do CRM.*A Arbo deixa de receber/);
    expect(AVISOS_AO_LIGAR[1]).toMatch(
      /suporte do Canal Pro.*integração de leads do CRM homologado em 10\/11\/2026/,
    );
    expect(AVISOS_AO_LIGAR[2]).toMatch(/“Receber leads no e-mail”.*cópia/);
  });

  it('nunca entregou, mas outro programa errou a chave e o validador testou: as notas dizem', () => {
    const e: EstadoDoCaminho = {
      ...HOJE,
      entrega: {
        ...SEM_ENTREGA,
        ultimoTeste: horasAntes(30),
        recusas7Dias: { doGrupoOlx: NADA, outras: { quantas: 3, ultimaEm: horasAntes(5) } },
      },
    };
    const p = passoDaEntrega(e, AGORA);
    expect(p.situacao).toBe('falta');
    expect(p.ligar).toBe(true);
    expect(p.notas).toEqual([
      'Nos últimos 7 dias, 3 chamadas com a chave errada vieram de outro programa, não do Grupo OLX (a última há 5 h).',
      'A URL de leads respondeu a um teste há 30 h (o validador do Grupo OLX; teste não grava lead).',
    ]);
  });

  it('o Grupo OLX bate e a chave não confere, sem nunca ter entregado: falta, sem a URL', () => {
    const e: EstadoDoCaminho = {
      ...HOJE,
      entrega: {
        ...SEM_ENTREGA,
        recusas7Dias: { doGrupoOlx: { quantas: 6, ultimaEm: horasAntes(1) }, outras: NADA },
      },
    };
    const p = passoDaEntrega(e, AGORA);
    expect(p.situacao).toBe('falta');
    expect(p.resumo).toBe(
      'O Grupo OLX tentou entregar leads 6 vezes nos últimos 7 dias e a chave não conferiu: a última há 1 h',
    );
    expect(p.detalhe).toMatch(/A URL de leads está certa.*GRUPOZAP_LEAD_SECRET/);
    expect(p.ligar).toBe(false);
  });

  it('recusa do Grupo OLX depois da última entrega: pede um olhar', () => {
    const e: EstadoDoCaminho = {
      ...LIGADO,
      entrega: {
        ...LIGADO.entrega,
        recusas7Dias: { doGrupoOlx: { quantas: 1, ultimaEm: horasAntes(1) }, outras: NADA },
      },
    };
    const p = passoDaEntrega(e, AGORA);
    expect(p.situacao).toBe('atencao');
    expect(p.resumo).toBe(
      'O Grupo OLX tentou entregar leads 1 vez nos últimos 7 dias e a chave não conferiu: a última há 1 h',
    );
  });

  it('recusa antes da última entrega já passou: feito (a chave voltou a conferir)', () => {
    const e: EstadoDoCaminho = {
      ...LIGADO,
      entrega: {
        ...LIGADO.entrega,
        recusas7Dias: { doGrupoOlx: { quantas: 3, ultimaEm: horasAntes(20) }, outras: NADA },
      },
    };
    expect(passoDaEntrega(e, AGORA).situacao).toBe('feito');
  });

  it('recusa de outro programa não pede olhar nenhum depois de ligado', () => {
    const e: EstadoDoCaminho = {
      ...LIGADO,
      entrega: {
        ...LIGADO.entrega,
        recusas7Dias: { doGrupoOlx: NADA, outras: { quantas: 1000, ultimaEm: horasAntes(1) } },
      },
    };
    expect(passoDaEntrega(e, AGORA).situacao).toBe('feito');
  });

  it('o CRM falhou com o Grupo OLX depois da última entrega: pede um olhar', () => {
    const e: EstadoDoCaminho = {
      ...LIGADO,
      entrega: {
        ...LIGADO.entrega,
        erros7Dias: { doGrupoOlx: { quantas: 3, ultimaEm: horasAntes(1) }, outros: NADA },
      },
    };
    const p = passoDaEntrega(e, AGORA);
    expect(p.situacao).toBe('atencao');
    expect(p.resumo).toBe(
      'O Grupo OLX tentou entregar leads 3 vezes nos últimos 7 dias e o CRM falhou: a última há 1 h',
    );
  });

  it(`mais de ${DIAS_SEM_LEAD} dias sem lead, com anúncios no portal: pede um olhar e mostra a URL`, () => {
    const e: EstadoDoCaminho = {
      ...LIGADO,
      entrega: {
        ...LIGADO.entrega,
        ultimaChamadaReal: { em: horasAntes(15 * 24), doGrupoOlx: true },
        ultimoLeadDoWebhook: horasAntes(16 * 24),
      },
    };
    const p = passoDaEntrega(e, AGORA);
    expect(p.situacao).toBe('atencao');
    expect(p.resumo).toBe('O Grupo OLX não entrega um lead há 15 dias');
    expect(p.detalhe).toMatch(/^Com 7 anúncios no portal, é tempo demais/);
    expect(p.ligar).toBe(true);
  });

  it(`${DIAS_SEM_LEAD} dias, ou sem anúncio no portal: continua feito`, () => {
    const quatorze: EstadoDoCaminho = {
      ...LIGADO,
      entrega: {
        ...LIGADO.entrega,
        ultimaChamadaReal: { em: horasAntes(14 * 24), doGrupoOlx: true },
        ultimoLeadDoWebhook: null,
      },
    };
    expect(passoDaEntrega(quatorze, AGORA).situacao).toBe('feito');
    const semAnuncio: EstadoDoCaminho = {
      ...LIGADO,
      plano: { ...LIGADO.plano, anunciosEmUso: 0 },
      entrega: {
        ...LIGADO.entrega,
        ultimaChamadaReal: { em: horasAntes(40 * 24), doGrupoOlx: true },
        ultimoLeadDoWebhook: null,
      },
    };
    expect(passoDaEntrega(semAnuncio, AGORA).situacao).toBe('feito');
  });

  it('feito: o Grupo OLX entregou o último lead há X h', () => {
    const p = passoDaEntrega(LIGADO, AGORA);
    expect(p.situacao).toBe('feito');
    expect(p.resumo).toBe('O Grupo OLX entregou o último lead há 2 h');
    expect(p.detalhe).toBeNull();
    expect(p.ligar).toBe(false);
  });

  it('a entrega é a mais nova entre a chamada anotada e o lead do webhook', () => {
    expect(ultimaEntrega(HOJE)).toBeNull();
    const soLead: EstadoDoCaminho = {
      ...HOJE,
      entrega: { ...SEM_ENTREGA, ultimoLeadDoWebhook: horasAntes(5) },
    };
    // O lead gravado antes de a função anotar as chamadas também conta.
    expect(ultimaEntrega(soLead)).toBe(horasAntes(5));
    expect(passoDaEntrega(soLead, AGORA).resumo).toBe('O Grupo OLX entregou o último lead há 5 h');
    const os2: EstadoDoCaminho = {
      ...HOJE,
      entrega: {
        ...SEM_ENTREGA,
        ultimaChamadaReal: { em: horasAntes(1), doGrupoOlx: true },
        ultimoLeadDoWebhook: horasAntes(5),
      },
    };
    expect(ultimaEntrega(os2)).toBe(horasAntes(1));
  });

  it('a chamada real sem o user-agent do Grupo OLX (um teste com a chave de verdade): pede um olhar', () => {
    // O lead que a chamada gravou vem junto, um pouco antes dela ser anotada.
    const e: EstadoDoCaminho = {
      ...HOJE,
      entrega: {
        ...SEM_ENTREGA,
        ultimaChamadaReal: { em: horasAntes(3), doGrupoOlx: false },
        ultimoLeadDoWebhook: horasAntes(3.001),
      },
    };
    expect(entregaDeOutro(e)).toBe(true);
    const p = passoDaEntrega(e, AGORA);
    expect(p.situacao).toBe('atencao');
    expect(p.resumo).toBe('Um lead chegou pela URL de leads há 3 h, mas não veio do Grupo OLX');
    expect(p.detalhe).toMatch(/user-agent do Grupo OLX.*não prova.*“Receber leads no CRM”/);
    expect(p.ligar).toBe(true);
  });

  it('feito só com a chamada do Grupo OLX, ou com lead do webhook mais novo que a outra chamada', () => {
    const doGrupo: EstadoDoCaminho = {
      ...HOJE,
      entrega: {
        ...SEM_ENTREGA,
        ultimaChamadaReal: { em: horasAntes(3), doGrupoOlx: true },
        ultimoLeadDoWebhook: horasAntes(3.001),
      },
    };
    expect(entregaDeOutro(doGrupo)).toBe(false);
    expect(passoDaEntrega(doGrupo, AGORA).situacao).toBe('feito');
    // Lead do webhook gravado depois da chamada de fora (ela não o explica).
    const leadDepois: EstadoDoCaminho = {
      ...HOJE,
      entrega: {
        ...SEM_ENTREGA,
        ultimaChamadaReal: { em: horasAntes(30), doGrupoOlx: false },
        ultimoLeadDoWebhook: horasAntes(2),
      },
    };
    expect(entregaDeOutro(leadDepois)).toBe(false);
    expect(passoDaEntrega(leadDepois, AGORA).situacao).toBe('feito');
  });

  it('o lead que chegou pelo WhatsApp não liga este passo (o banco o deixa fora do webhook)', () => {
    // O banco não conta o lead `whatsapp:…` em `ultimo_lead_do_webhook`; o passo
    // dos leads, sim. Este passo continua faltando.
    const e: EstadoDoCaminho = {
      ...HOJE,
      leads: {
        ultimo: { id: 'w1', em: horasAntes(1), tipos: ['CLICK_WHATSAPP'], anuncio: null },
        total: 1,
      },
    };
    expect(passoDaEntrega(e, AGORA).situacao).toBe('falta');
    expect(passoDosLeads(e, AGORA).situacao).toBe('feito');
  });
});

describe('2. Anúncios no ar pelo CRM', () => {
  it('hoje: os 7 da Arbo prontos cabem todos, porque o relatório já os conta', () => {
    const p = passoDosAnuncios(HOJE);
    expect(p.situacao).toBe('falta');
    expect(p.cabem.map((a) => a.codigo)).toHaveLength(7);
    expect(p.esperamVaga).toEqual([]);
    expect(p.resumo).toBe('7 anúncios prontos para pôr no ar · 9 de 10 vagas');
    expect(p.detalhe).toMatch(/não muda o portal/);
  });

  it('com o plano cheio, o que ocupa a própria vaga cabe; o novo espera', () => {
    const e: EstadoDoCaminho = {
      ...HOJE,
      plano: { ...HOJE.plano, anunciosEmUso: 10 },
      anuncios: {
        ...HOJE.anuncios,
        prontos: [pronto('TE0001_IMOVA', true), pronto('IM0001', false)],
      },
    };
    const p = passoDosAnuncios(e);
    expect(p.cabem.map((a) => a.codigo)).toEqual(['TE0001_IMOVA']);
    expect(p.esperamVaga.map((a) => a.codigo)).toEqual(['IM0001']);
    expect(p.situacao).toBe('falta');
  });

  it('os novos cabem até as vagas livres', () => {
    const e: EstadoDoCaminho = {
      ...HOJE,
      plano: { ...HOJE.plano, anunciosEmUso: 8 },
      anuncios: {
        ...HOJE.anuncios,
        prontos: [pronto('IM0001', false), pronto('IM0002', false), pronto('IM0003', false)],
      },
    };
    const p = passoDosAnuncios(e);
    expect(p.cabem.map((a) => a.codigo)).toEqual(['IM0001', 'IM0002']);
    expect(p.esperamVaga.map((a) => a.codigo)).toEqual(['IM0003']);
  });

  it('sem plano no CRM, todos cabem e não há conta de vagas', () => {
    const e: EstadoDoCaminho = {
      ...HOJE,
      plano: { anuncios: null, destaques: null, anunciosEmUso: 9, destaquesEmUso: 0 },
    };
    const p = passoDosAnuncios(e);
    expect(p.cabem).toHaveLength(7);
    expect(p.vagas).toBeNull();
    expect(p.resumo).toBe('7 anúncios prontos para pôr no ar');
  });

  it('no ar fora do arquivo é o primeiro que falta, e conta no resumo', () => {
    const e: EstadoDoCaminho = {
      ...LIGADO,
      anuncios: {
        ...LIGADO.anuncios,
        noArquivo: 6,
        foraDoArquivo: [
          {
            id: 'x',
            codigo: 'TE0004_IMOVA',
            titulo: 'T',
            pendencias: ['excluir o original (código X) no Canal Pro e marcar aqui como excluído'],
          },
        ],
      },
    };
    const p = passoDosAnuncios(e);
    expect(p.situacao).toBe('falta');
    expect(p.resumo).toBe('1 anúncio no ar no CRM, mas fora do arquivo · 7 de 10 vagas');
  });

  it('depois de lido, pôr no ar entra no portal na próxima leitura', () => {
    const e: EstadoDoCaminho = {
      ...LIGADO,
      anuncios: { ...LIGADO.anuncios, prontos: [pronto('IM0001', false)] },
    };
    const p = passoDosAnuncios(e);
    expect(p.resumo).toBe('1 anúncio pronto para pôr no ar · 7 de 10 vagas');
    expect(p.detalhe).toBe('Entram no portal na próxima leitura do Grupo OLX.');
  });

  it('plano cheio com anúncios no ar: pede um olhar, sem travar o caminho', () => {
    const e: EstadoDoCaminho = {
      ...LIGADO,
      plano: { ...LIGADO.plano, anunciosEmUso: 10 },
      anuncios: { ...LIGADO.anuncios, prontos: [pronto('IM0001', false)] },
    };
    const p = passoDosAnuncios(e);
    expect(p.situacao).toBe('atencao');
    expect(p.resumo).toBe('Plano cheio: 1 pronto espera vaga · 10 de 10 vagas');
  });

  it('nada no ar e nada pronto: falta completar um rascunho', () => {
    const e: EstadoDoCaminho = { ...HOJE, anuncios: { ...HOJE.anuncios, prontos: [] } };
    const p = passoDosAnuncios(e);
    expect(p.situacao).toBe('falta');
    expect(p.resumo).toBe('Nenhum anúncio no ar pelo CRM · 9 de 10 vagas');
    expect(p.detalhe).toMatch(/Complete um dos rascunhos/);
  });

  it('feito: todos no ar, com as vagas', () => {
    const p = passoDosAnuncios(LIGADO);
    expect(p.situacao).toBe('feito');
    expect(p.resumo).toBe('7 no ar · 7 de 10 vagas');
  });
});

describe('3. O Grupo OLX lê o arquivo do CRM', () => {
  it('nunca leu: colar a URL, com o aviso de pôr no ar antes', () => {
    const p = passoDoArquivo(HOJE, AGORA, 7);
    expect(p.situacao).toBe('falta');
    expect(p.resumo).toBe('Cole a URL do CRM no Canal Pro');
    expect(p.colar).toBe(true);
    expect(p.antesDeColar).toMatch(/^Antes de colar, ponha no ar pelo CRM os 7 anúncios que estão/);
    expect(p.outraLeitura).toBeNull();
  });

  it('nunca leu e nada a assumir: sem o aviso', () => {
    expect(passoDoArquivo(HOJE, AGORA, 0).antesDeColar).toBeNull();
  });

  it('nunca leu, mas outro programa abriu: diz quem e quando', () => {
    const e: EstadoDoCaminho = {
      ...HOJE,
      arquivo: { ...HOJE.arquivo, outraLeitura: { em: horasAntes(5), quem: 'curl/8.7.1' } },
    };
    expect(passoDoArquivo(e, AGORA, 0).outraLeitura).toBe(
      'O arquivo foi aberto há 5 h por “curl/8.7.1”, que não é o robô do Grupo OLX. Se a URL já está no Canal Pro, confira lá o Relatório de integração.',
    );
  });

  it('leu há pouco: feito, "Leu há X h"', () => {
    const p = passoDoArquivo(LIGADO, AGORA, 0);
    expect(p.situacao).toBe('feito');
    expect(p.resumo).toBe('Leu há 3 h, com 7 anúncios');
    expect(p.colar).toBe(false);
  });

  it('não lê há mais de 48 horas: pede um olhar e mostra a URL de novo', () => {
    const e: EstadoDoCaminho = {
      ...LIGADO,
      arquivo: { ...LIGADO.arquivo, leituraDoRobo: { em: horasAntes(72), anuncios: 7 } },
    };
    const p = passoDoArquivo(e, AGORA, 0);
    expect(p.situacao).toBe('atencao');
    expect(p.resumo).toBe('O Grupo OLX não lê o arquivo há 3 dias');
    expect(p.colar).toBe(true);
  });

  it('leu o arquivo vazio e ele continua vazio: falta, o portal tira tudo', () => {
    const e: EstadoDoCaminho = {
      ...HOJE,
      arquivo: { ...HOJE.arquivo, leituraDoRobo: { em: horasAntes(2), anuncios: 0 } },
    };
    const p = passoDoArquivo(e, AGORA, 7);
    expect(p.situacao).toBe('falta');
    expect(p.resumo).toBe('A última leitura, há 2 h, levou o arquivo vazio');
  });

  it('leu vazio, mas o arquivo já tem anúncios: a próxima leitura leva', () => {
    const e: EstadoDoCaminho = {
      ...LIGADO,
      arquivo: { ...LIGADO.arquivo, leituraDoRobo: { em: horasAntes(2), anuncios: 0 } },
    };
    expect(passoDoArquivo(e, AGORA, 0).situacao).toBe('feito');
  });
});

describe('4. Sem repetidos ocupando vaga', () => {
  it('hoje: 2 repetidos ocupam vaga, com a idade do relatório', () => {
    const p = passoDosRepetidos(HOJE, AGORA);
    expect(p.situacao).toBe('falta');
    expect(p.resumo).toBe('2 repetidos ocupam vaga · relatório importado há 6 dias');
    expect(p.relatorioVelho).toBe(false);
  });

  it('sem relatório: falta importar', () => {
    const e: EstadoDoCaminho = { ...HOJE, relatorio: { ...HOJE.relatorio, importadoEm: null } };
    const p = passoDosRepetidos(e, AGORA);
    expect(p.situacao).toBe('falta');
    expect(p.resumo).toBe('Nenhum relatório do Canal Pro importado');
    expect(p.relatorio).toBeNull();
  });

  it('sem repetidos e relatório de mais de 7 dias: pede para importar de novo', () => {
    const e: EstadoDoCaminho = {
      ...LIGADO,
      relatorio: { ...LIGADO.relatorio, importadoEm: '2026-11-02T15:00:00Z' },
    };
    const p = passoDosRepetidos(e, AGORA);
    expect(p.situacao).toBe('atencao');
    expect(p.resumo).toBe('Relatório importado há 9 dias: importe de novo');
    expect(p.relatorioVelho).toBe(true);
  });

  it('feito: nenhum repetido, relatório de ontem', () => {
    const p = passoDosRepetidos(LIGADO, AGORA);
    expect(p.situacao).toBe('feito');
    expect(p.resumo).toBe('Nenhum repetido ocupa vaga · relatório importado ontem');
  });
});

describe('5. O primeiro lead chega ao CRM', () => {
  it('nenhum lead e os leads ainda não ligados: primeiro o passo 1, depois o teste', () => {
    const p = passoDosLeads(HOJE, AGORA);
    expect(p.situacao).toBe('falta');
    expect(p.detalhe).toBe(`${TESTE_DEPOIS_DE_LIGAR} ${LEAD_DE_TESTE}`);
    expect(TESTE_DEPOIS_DE_LIGAR).toMatch(/^Primeiro ligue os leads no Canal Pro \(passo 1\)/);
    expect(LEAD_DE_TESTE).toBe(
      'Faça um teste: no celular, abra um anúncio seu no ZAP, preencha o formulário com seu nome e telefone e confira se ele aparece em Anúncios → Leads e se o aviso chega.',
    );
  });

  it('nenhum lead com os leads ligados: só o teste no celular', () => {
    const e: EstadoDoCaminho = {
      ...HOJE,
      entrega: { ...SEM_ENTREGA, ultimaChamadaReal: { em: horasAntes(1), doGrupoOlx: true } },
    };
    expect(passoDosLeads(e, AGORA).detalhe).toBe(LEAD_DE_TESTE);
  });

  it('com lead: o último, o que fez e de que anúncio', () => {
    const p = passoDosLeads(LIGADO, AGORA);
    expect(p.situacao).toBe('feito');
    expect(p.resumo).toBe('Último há 2 h: Formulário · TE0002_IMOVA (1 no total)');
  });
});

describe('caminhoDoLead', () => {
  it('hoje faltam os cinco passos, na ordem: ligar os leads, pôr no ar, colar, repetidos, lead', () => {
    const c = caminhoDoLead(HOJE, AGORA, 7);
    expect(c.passos.map((p) => p.id)).toEqual([
      'entrega',
      'anuncios',
      'arquivo',
      'repetidos',
      'leads',
    ]);
    expect(c.passos.every((p) => p.situacao === 'falta')).toBe(true);
    expect(c.ligado).toBe(false);
  });

  it('os leads ligados com o arquivo ainda da Arbo: o passo 1 fica feito sozinho', () => {
    const e: EstadoDoCaminho = { ...HOJE, entrega: LIGADO.entrega };
    const c = caminhoDoLead(e, AGORA, 7);
    expect(c.passos[0].situacao).toBe('feito');
    expect(c.passos[2].situacao).toBe('falta');
  });

  it('sem leads ligados, nada está ligado, mesmo com o resto feito', () => {
    const c = caminhoDoLead({ ...LIGADO, entrega: SEM_ENTREGA }, AGORA, 0);
    expect(c.passos[0].situacao).toBe('falta');
    expect(c.ligado).toBe(false);
  });

  it('tudo feito: "Portais ligados", sem avisos', () => {
    const c = caminhoDoLead(LIGADO, AGORA, 0);
    expect(c.ligado).toBe(true);
    expect(c.avisos).toEqual([]);
  });

  it('feito com um aviso: continua ligado, e o aviso vai na linha pequena', () => {
    const e: EstadoDoCaminho = {
      ...LIGADO,
      relatorio: { ...LIGADO.relatorio, importadoEm: '2026-11-02T15:00:00Z' },
    };
    const c = caminhoDoLead(e, AGORA, 0);
    expect(c.ligado).toBe(true);
    expect(c.avisos).toEqual(['Relatório importado há 9 dias: importe de novo']);
  });
});
