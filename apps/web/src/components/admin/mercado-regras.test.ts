import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CONSEQUENCIA_DE_DESLIGAR,
  CONSEQUENCIA_DE_LIGAR,
  GRUPOS,
  POR_QUE_RECONFERIR,
  ROTULO_DO_VEREDITO,
  avisoDaSaude,
  botaoDaFonte,
  citaPortal,
  coletaLigada,
  condicoesNaTela,
  consequenciaDaFonte,
  fontesPorGrupo,
  fraseDaRecusaDoMercado,
  horaCurta,
  limparTexto,
  motivoSugerido,
  motivoSugeridoDaColeta,
  nomeNaTela,
  porqueDaProibida,
  problemaDoMotivo,
  proximaColeta,
  quandoFoi,
  resumoDaUltimaColeta,
  resumoDasFontes,
  rotuloDaFrequencia,
  situacaoDaFonte,
  type Coleta,
  type FonteDeMercado,
} from './mercado-regras';

function fonte(extra: Partial<FonteDeMercado> = {}): FonteDeMercado {
  return {
    id: 'lopes',
    nome: 'Lopes (rede de imobiliárias), páginas públicas',
    grupo: 'anuncios',
    tipo_de_dado: 'anúncios de venda (preço, área, bairro, tipo)',
    veredito: 'CONDICIONAL',
    condicoes: ['Só páginas HTML públicas de busca e de imóvel de Natal e Parnamirim.'],
    reconferir: false,
    liberada: false,
    liberada_por: null,
    liberada_em: null,
    liberada_motivo: null,
    pode_coletar: false,
    frequencia: 'rodada',
    coletor: 'anuncios/lopes',
    ...extra,
  };
}

const nomes = new Map([['p1', 'Rafael']]);
const nomeDe = (id: string) => nomes.get(id) ?? null;

// Os textos da auditoria de 18/11 que citam portal, como estão no banco
// (migração 20261119160000).
const GRUPO_OLX = fonte({
  id: 'grupo-olx',
  nome: 'ZAP Imóveis, VivaReal, OLX, Canal Pro e DataZAP (Grupo OLX)',
  veredito: 'PROIBIDA',
  frequencia: 'nunca',
  coletor: null,
  tipo_de_dado: 'anúncios, contatos, relatórios',
  condicoes: [
    'Zero acesso: nenhuma página, API, PDF ou domínio (zapimoveis.com.br, vivareal.com.br, olx.com.br, canalpro, datazap.com.br, imoveis.grupoolx.com.br).',
    'Nenhum login, conta ou credencial da Imova; nada com o nome da Imova.',
    'Os informes do FipeZAP também aparecem em datazap.com.br: baixar só de downloads.fipe.org.br.',
  ],
});
const PORTAIS = fonte({
  id: 'portais-nacionais',
  nome: 'Grandes portais e agregadores nacionais (Imovelweb, Wimoveis, Casa Mineira, QuintoAndar, Loft, Netimóveis, ImovelGuide, DFimóveis, Nestoria, Trovit)',
  veredito: 'PROIBIDA',
  coletor: null,
  condicoes: [
    "Decisão do dono em 18/11: nenhuma associação com ZAP, VivaReal, OLX 'ou parecidos'. Estes são portais nacionais do mesmo tipo.",
  ],
});
const REDECASAS = fonte({
  id: 'redecasas',
  nome: 'RedeCasas (portal nacional)',
  veredito: 'PROIBIDA',
  coletor: null,
  condicoes: [
    'Termos proíbem robôs sem autorização expressa. Também é portal nacional (regra do dono: nada de portais parecidos com ZAP).',
  ],
});
const FIPE = fonte({
  id: 'fipezap-planilha',
  nome: 'Índice FipeZAP, planilha e informes da Fipe',
  grupo: 'oficiais',
  veredito: 'CONDICIONAL',
  liberada: true,
  pode_coletar: true,
  frequencia: 'mensal',
  coletor: 'fipezap',
  liberada_em: '2026-11-19T19:00:00Z',
  liberada_motivo:
    'Decisão do dono (entrevista de 18/11/2026): o índice FipeZAP, planilha pública da Fipe, pode continuar.',
  condicoes: [
    'Liberado pelo dono (entrevista de 18/11).',
    'Baixar só de downloads.fipe.org.br; nunca de datazap.com.br ou de domínio do Grupo OLX.',
    "Citar 'índice FipeZAP (Fipe)'; não redistribuir a planilha.",
    'A página da Fipe não traz termos de reuso: tratar como citação com fonte.',
  ],
});

describe('nenhum nome de portal na tela', () => {
  it('reconhece os nomes em qualquer grafia, até dentro de endereço', () => {
    for (const texto of [
      'ZAP Imóveis',
      'zapimoveis.com.br',
      'VivaReal',
      'Viva Real',
      'OLX',
      'imoveis.grupoolx.com.br',
      'Canal Pro',
      'canalpro',
      'FipeZAP',
    ]) {
      expect(citaPortal(texto), texto).toBe(true);
    }
    expect(citaPortal('Chaves na Mão, servidor MCP oficial')).toBe(false);
    expect(citaPortal(null)).toBe(false);
  });

  it('o nome e as condições das fontes que citam portal saem sem o nome', () => {
    for (const f of [GRUPO_OLX, PORTAIS, REDECASAS, FIPE]) {
      expect(citaPortal(nomeNaTela(f)), f.id).toBe(false);
      expect(nomeNaTela(f)).not.toBe('Fonte de dados');
      const condicoes = condicoesNaTela(f);
      expect(condicoes.length, f.id).toBeGreaterThan(0);
      for (const c of condicoes) expect(citaPortal(c), c).toBe(false);
      expect(citaPortal(porqueDaProibida(f))).toBe(false);
    }
    expect(nomeNaTela(GRUPO_OLX)).toBe(
      'Os grandes portais de anúncios do país e as empresas do grupo deles',
    );
    expect(nomeNaTela(FIPE)).toBe('Índice de preços de imóveis da Fipe (planilha pública)');
  });

  it('o índice da Fipe continua explicado, sem o nome do portal', () => {
    expect(condicoesNaTela(FIPE)).toEqual([
      'Liberado pelo dono (entrevista de 18/11).',
      'Baixar só de downloads.fipe.org.br.',
      "Citar 'o índice de preços da Fipe'; não redistribuir a planilha.",
      'A página da Fipe não traz termos de reuso: tratar como citação com fonte.',
    ]);
    expect(limparTexto(FIPE.liberada_motivo)).toBe(
      'Decisão do dono (entrevista de 18/11/2026): o índice de preços da Fipe pode continuar.',
    );
  });

  it('texto desconhecido com nome de portal some inteiro, em vez de sair pela metade', () => {
    expect(limparTexto('Igual ao que a OLX faz')).toBeNull();
    expect(condicoesNaTela(fonte({ condicoes: ['Ok.', 'Como no Canal Pro.'] }))).toEqual(['Ok.']);
    expect(nomeNaTela(fonte({ id: 'nova', nome: 'VivaReal' }))).toBe('Fonte de dados');
  });

  it('os textos escritos pela tela também não citam', () => {
    const textos = [
      CONSEQUENCIA_DE_LIGAR,
      CONSEQUENCIA_DE_DESLIGAR,
      POR_QUE_RECONFERIR,
      motivoSugeridoDaColeta(true),
      motivoSugeridoDaColeta(false),
      ...GRUPOS.flatMap((g) => [g.rotulo, g.descricao]),
      ...Object.values(ROTULO_DO_VEREDITO),
      ...['airbnb', 'deztop', 'peres-e-peres', 'jj-assessoria', 'qualquer'].map((id) =>
        porqueDaProibida({ id }),
      ),
    ];
    for (const t of textos) expect(citaPortal(t), t).toBe(false);
  });

  it('nem o código das telas (painel e diálogo)', () => {
    for (const arquivo of ['painel-mercado.tsx', 'dialogo-com-motivo.tsx']) {
      const codigo = readFileSync(fileURLToPath(new URL(arquivo, import.meta.url)), 'utf8');
      expect(citaPortal(codigo), arquivo).toBe(false);
    }
  });
});

describe('veredito, situação e botão', () => {
  it('o veredito em palavras simples', () => {
    expect(ROTULO_DO_VEREDITO).toEqual({
      PERMITIDA: 'Permitida',
      CONDICIONAL: 'Com condições',
      PROIBIDA: 'Proibida',
    });
  });

  it('liberada por alguém, com a data de Natal', () => {
    // 01:30 de 20/11 em UTC ainda é 19/11 em Natal.
    const f = fonte({ liberada: true, liberada_por: 'p1', liberada_em: '2026-11-20T01:30:00Z' });
    expect(situacaoDaFonte(f, nomeDe)).toEqual({
      texto: 'Liberada por Rafael em 19/11',
      tom: 'liberada',
    });
    expect(
      situacaoDaFonte(fonte({ liberada: true, liberada_em: '2026-11-18T15:00:00Z' }), nomeDe),
    ).toMatchObject({ texto: 'Liberada em 18/11' });
  });

  it('não liberada, recolhida e reconferir', () => {
    expect(situacaoDaFonte(fonte(), nomeDe).texto).toBe('Não liberada');
    expect(
      situacaoDaFonte(fonte({ liberada_por: 'p1', liberada_em: '2026-11-19T15:00:00Z' }), nomeDe)
        .texto,
    ).toBe('Recolhida por Rafael em 19/11');
    expect(situacaoDaFonte(fonte({ reconferir: true, liberada: true }), nomeDe).texto).toBe(
      'Reconferir antes',
    );
    expect(situacaoDaFonte(GRUPO_OLX, nomeDe).tom).toBe('proibida');
  });

  it('a proibida tem cadeado e nenhum botão', () => {
    expect(botaoDaFonte(GRUPO_OLX)).toEqual({ tipo: 'cadeado' });
    expect(porqueDaProibida({ id: 'peres-e-peres' })).toMatch(/fecha a porta para robôs/);
    expect(porqueDaProibida({ id: 'fonte-nova' })).toMatch(/auditoria/);
  });

  it('liberar, recolher e o botão desligado de quem precisa reconferir', () => {
    expect(botaoDaFonte(fonte())).toEqual({
      tipo: 'liberar',
      desabilitado: false,
      explicacao: null,
    });
    expect(botaoDaFonte(fonte({ liberada: true }))).toEqual({
      tipo: 'recolher',
      desabilitado: false,
      explicacao: null,
    });
    expect(botaoDaFonte(fonte({ reconferir: true }))).toEqual({
      tipo: 'liberar',
      desabilitado: true,
      explicacao: POR_QUE_RECONFERIR,
    });
  });

  it('a frequência em português', () => {
    expect(rotuloDaFrequencia('rodada')).toBe('a cada coleta (segunda e quinta)');
    expect(rotuloDaFrequencia('mensal')).toBe('uma vez por mês');
  });

  it('o aviso da saúde só para quarentena e alerta', () => {
    expect(avisoDaSaude('quarentena')).toMatch(/^Em quarentena/);
    expect(avisoDaSaude('alerta')).toMatch(/^Em alerta/);
    expect(avisoDaSaude('saudavel')).toBeNull();
    expect(avisoDaSaude(null)).toBeNull();
  });
});

describe('os grupos', () => {
  it('na ordem pedida, com as liberadas antes e as proibidas no fim', () => {
    expect(GRUPOS.map((g) => g.id)).toEqual([
      'anuncios',
      'oficiais',
      'obras',
      'proximidades',
      'temporada',
      'lai',
    ]);
    const lista = fontesPorGrupo([
      GRUPO_OLX,
      fonte({ id: 'b', nome: 'B' }),
      fonte({ id: 'a', nome: 'A', liberada: true }),
      fonte({ id: 'c', nome: 'C', reconferir: true }),
      FIPE,
    ]);
    expect(lista.map((g) => g.grupo.id)).toEqual(['anuncios', 'oficiais']);
    expect(lista[0]?.fontes.map((f) => f.id)).toEqual(['a', 'b', 'c', 'grupo-olx']);
  });
});

describe('o diálogo', () => {
  it('o motivo sugerido muda com a decisão e o veredito', () => {
    expect(motivoSugerido(fonte(), true)).toMatch(/condições/);
    expect(motivoSugerido(fonte({ veredito: 'PERMITIDA' }), true)).toMatch(/dado público/);
    expect(motivoSugerido(fonte({ liberada: true }), false)).toMatch(/não usar/);
    for (const m of [
      motivoSugerido(fonte(), true),
      motivoSugerido(fonte(), false),
      motivoSugeridoDaColeta(true),
      motivoSugeridoDaColeta(false),
    ]) {
      expect(problemaDoMotivo(m), m).toBeNull();
    }
  });

  it('o motivo precisa de 5 letras, como no banco', () => {
    expect(problemaDoMotivo('liga')).toMatch(/pelo menos 5/);
    expect(problemaDoMotivo('     ')).toMatch(/pelo menos 5/);
    expect(problemaDoMotivo('Pode ligar')).toBeNull();
  });

  it('a consequência de liberar conta o que falta: o robô e a chave', () => {
    const semRobo = consequenciaDaFonte(fonte({ coletor: null }), true, false);
    expect(semRobo[0]).toMatch(/Na próxima coleta, o robô passa a ler/);
    expect(semRobo.join(' ')).toMatch(/ainda não sabe ler/);
    expect(semRobo.join(' ')).toMatch(/A coleta está desligada/);
    expect(consequenciaDaFonte(fonte(), true, true)).toHaveLength(1);
    expect(consequenciaDaFonte(fonte({ liberada: true }), false, true)[0]).toMatch(
      /deixa de ler.*fica para consulta/,
    );
  });

  it('os textos de ligar e desligar são os que o dono pediu', () => {
    expect(CONSEQUENCIA_DE_LIGAR).toBe(
      'A partir da próxima segunda ou quinta às 6h, o robô lê as fontes liberadas abaixo, devagar e respeitando o robots.txt de cada uma. Nenhum portal proibido é acessado.',
    );
    expect(CONSEQUENCIA_DE_DESLIGAR).toBe(
      'A coleta para na hora; o que já foi gravado fica para consulta.',
    );
  });

  it('as recusas do banco viram frases', () => {
    expect(fraseDaRecusaDoMercado('so_imova')).toMatch(/só da Imova/);
    expect(fraseDaRecusaDoMercado('motivo_obrigatorio')).toMatch(/5 letras/);
    expect(fraseDaRecusaDoMercado('fonte_proibida')).toMatch(/nunca pode ser liberada/);
    expect(fraseDaRecusaDoMercado('sem_permissao')).toMatch(/admin e gestor/);
    expect(fraseDaRecusaDoMercado('coisa_nova')).toMatch(/Atualize a tela/);
    expect(fraseDaRecusaDoMercado(null)).toMatch(/Atualize a tela/);
  });
});

describe('a coleta', () => {
  it('só o texto "true" liga, como no banco', () => {
    expect(coletaLigada({ ligado: true })).toBe(true);
    expect(coletaLigada({ ligado: 'true' })).toBe(true);
    expect(coletaLigada({ ligado: false })).toBe(false);
    expect(coletaLigada({ ligado: 1 })).toBe(false);
    expect(coletaLigada(null)).toBe(false);
  });

  it('a próxima rodada é segunda ou quinta às 6h de Natal', () => {
    // Quinta, 19/11/2026, 16h40 em Natal → segunda, 23/11, 6h (09:00 UTC).
    expect(proximaColeta(new Date('2026-11-19T19:40:00Z')).toISOString()).toBe(
      '2026-11-23T09:00:00.000Z',
    );
    // Quinta às 6h em ponto já passou → segunda.
    expect(proximaColeta(new Date('2026-11-19T09:00:00Z')).toISOString()).toBe(
      '2026-11-23T09:00:00.000Z',
    );
    // Quinta às 5h59 → a mesma quinta.
    expect(proximaColeta(new Date('2026-11-19T08:59:00Z')).toISOString()).toBe(
      '2026-11-19T09:00:00.000Z',
    );
    // Domingo, 23h30 em Natal (segunda 02:30 UTC) → segunda, 6h.
    expect(proximaColeta(new Date('2026-11-23T02:30:00Z')).toISOString()).toBe(
      '2026-11-23T09:00:00.000Z',
    );
    // Segunda às 7h → quinta.
    expect(proximaColeta(new Date('2026-11-23T10:00:00Z')).toISOString()).toBe(
      '2026-11-26T09:00:00.000Z',
    );
    expect(quandoFoi('2026-11-23T09:00:00.000Z')).toBe('segunda, 23/11, às 6h');
    expect(horaCurta('2026-11-17T09:02:00Z')).toBe('6h02');
  });

  it('a última rodada junta as fontes do mesmo dia', () => {
    const coletas: Coleta[] = [
      { fonte: 'bcb', inicio: '2026-11-16T09:20:00Z', fim: null, situacao: 'rodando' },
      {
        fonte: 'lopes',
        inicio: '2026-11-16T09:10:00Z',
        fim: '2026-11-16T09:15:00Z',
        situacao: 'erro',
      },
      {
        fonte: 'ibeda',
        inicio: '2026-11-16T09:02:00Z',
        fim: '2026-11-16T09:05:00Z',
        situacao: 'ok',
      },
      {
        fonte: 'ibeda',
        inicio: '2026-11-12T09:02:00Z',
        fim: '2026-11-12T09:05:00Z',
        situacao: 'ok',
      },
    ];
    expect(resumoDaUltimaColeta(coletas)).toEqual({
      tipo: 'feita',
      quando: 'segunda, 16/11, às 6h02',
      fontes: 3,
      comErro: 1,
      rodando: 1,
    });
    expect(resumoDaUltimaColeta([])).toEqual({ tipo: 'nenhuma' });
  });

  it('o resumo das fontes liberadas conta quem o robô já sabe ler', () => {
    expect(resumoDasFontes([fonte()])).toBe('Nenhuma fonte liberada ainda.');
    expect(resumoDasFontes([fonte({ pode_coletar: true })])).toBe(
      '1 fonte liberada; o robô sabe ler esta.',
    );
    expect(
      resumoDasFontes([
        fonte({ id: 'a', pode_coletar: true }),
        fonte({ id: 'b', pode_coletar: true, coletor: null }),
        fonte({ id: 'c', pode_coletar: true, coletor: null }),
      ]),
    ).toBe('3 fontes liberadas; o robô já sabe ler uma delas.');
  });
});
