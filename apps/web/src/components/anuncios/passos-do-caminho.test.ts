import { describe, expect, it } from 'vitest';

import {
  caminhoDoLead,
  diasDeCalendario,
  type EstadoDoCaminho,
  haQuanto,
  LEAD_DE_TESTE,
  passoDoArquivo,
  passoDosAnuncios,
  passoDosLeads,
  passoDosRepetidos,
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

/** A Imova em 11/11/2026: nada lido, 7 prontos da Arbo, 9 de 10 vagas, 2 repetidos, 0 leads. */
const HOJE: EstadoDoCaminho = {
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

/** Tudo feito: 7 no ar, lido há 3 h, sem repetidos, relatório de ontem, um lead. */
const LIGADO: EstadoDoCaminho = {
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

describe('1. Anúncios no ar pelo CRM', () => {
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

describe('2. O Grupo OLX lê o arquivo do CRM', () => {
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

describe('3. Sem repetidos ocupando vaga', () => {
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

describe('4. O primeiro lead chega ao CRM', () => {
  it('nenhum lead: o teste no celular', () => {
    const p = passoDosLeads(HOJE, AGORA);
    expect(p.situacao).toBe('falta');
    expect(p.detalhe).toBe(LEAD_DE_TESTE);
    expect(LEAD_DE_TESTE).toBe(
      'Faça um teste: no celular, abra um anúncio seu no ZAP, preencha o formulário com seu nome e telefone e confira se ele aparece em Anúncios → Leads e se o aviso chega.',
    );
  });

  it('com lead: o último, o que fez e de que anúncio', () => {
    const p = passoDosLeads(LIGADO, AGORA);
    expect(p.situacao).toBe('feito');
    expect(p.resumo).toBe('Último há 2 h: Formulário · TE0002_IMOVA (1 no total)');
  });
});

describe('caminhoDoLead', () => {
  it('hoje faltam os quatro passos, na ordem: pôr no ar, colar, repetidos, lead', () => {
    const c = caminhoDoLead(HOJE, AGORA, 7);
    expect(c.passos.map((p) => p.id)).toEqual(['anuncios', 'arquivo', 'repetidos', 'leads']);
    expect(c.passos.every((p) => p.situacao === 'falta')).toBe(true);
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
