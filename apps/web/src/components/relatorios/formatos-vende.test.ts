import { describe, expect, it } from 'vitest';

import type { LinhaImovel, LinhaPessoaVende, Previsao, SemanaDaIA } from './dados-vende';
import {
  comoCorrigirLacuna,
  oQueMudouNaVersao,
  contaDaMeta,
  decimalEnxuto,
  deltaDe,
  encurtar,
  dinheiroCurto,
  faixaDeNegocios,
  fimDoMes,
  gargaloDoFunil,
  haQuantoCurto,
  horas,
  impactoDaSugestao,
  indiceDaSemana,
  lerPremissas,
  lista,
  nomeDoMes,
  numero,
  ordenarFila,
  ordenarImoveis,
  pctDaChance,
  pontosDaLinha,
  precoCurto,
  premissasParaDigitar,
  rotuloDaFaixaDePassagem,
  rotuloDaFaixaDeResposta,
  rotuloDaLacuna,
  rotuloDaSituacao,
  rotuloDoCampo,
  rotuloDoNivel,
  tempoDaSituacao,
  tetoRedondo,
  textoDaTrava,
  textoDasPremissas,
  textoDoInteresse,
  tituloDaEquipe,
  tituloDaMesa,
  tituloDaNotaDaIA,
  tituloDaPassagem,
  tituloDaPrevisao,
  tituloDaPrevisaoPorEtapa,
  tituloDaVelocidade,
  tituloDasLacunas,
  tituloDasNotas,
  tituloDasObjecoes,
  tituloDasPerguntas,
  tituloDasSemanasDoImovel,
  tituloDasSituacoes,
  tituloDasVisitasDaIA,
  tituloDoFunilCurto,
  tituloDoFunilLongo,
  tituloDoInteresse,
  tituloDoMaisProcurado,
  tituloDoRanking,
  tituloDosCanais,
  tituloDosDonos,
  trechosDaLinha,
  versaoCurta,
} from './formatos-vende';

// 09/11/2026 10:00 em Natal (UTC-3).
const AGORA = new Date('2026-11-09T13:00:00Z');

function imovel(parcial: Partial<LinhaImovel> & { codigo: string }): LinhaImovel {
  return {
    titulo: `Imóvel ${parcial.codigo}`,
    tipo: 'apartamento',
    negocio: 'venda',
    bairro: null,
    preco_venda: null,
    preco_aluguel: null,
    dias_no_ar: null,
    muito: 0,
    interessado: 0,
    morno: 0,
    total: 0,
    lider: null,
    ...parcial,
  };
}

function previsao(parcial: Partial<Previsao> = {}): Previsao {
  return {
    mes: '2026-11',
    dias_restantes: 21,
    fechados: 1,
    esperado: 4.4,
    faixa_baixa: 3.6,
    faixa_alta: 5.2,
    meta: 6,
    por_etapa: [],
    ritmo: { visitas_por_negocio: 6, comparecimento: 0.74, visitas_marcadas_por_semana: 7 },
    ...parcial,
  };
}

function semana(parcial: Partial<SemanaDaIA> & { inicio: string }): SemanaDaIA {
  return {
    conversas: 10,
    duvida: null,
    informacao: null,
    satisfacao: null,
    subiu_pct: null,
    igual_pct: null,
    caiu_pct: null,
    resolvidas_pct: null,
    visitas: 0,
    ...parcial,
  };
}

describe('números e dinheiro', () => {
  it('dinheiro curto, como se fala na mesa', () => {
    expect(dinheiroCurto(74_000)).toBe('R$ 74 mil');
    expect(dinheiroCurto(27_200)).toBe('R$ 27,2 mil');
    expect(dinheiroCurto(1_100_000)).toBe('R$ 1,1 mi');
    expect(dinheiroCurto(999_960)).toBe('R$ 1 mi');
    expect(dinheiroCurto(950)).toBe('R$ 950');
    expect(dinheiroCurto(-5_000)).toBe('−R$ 5 mil');
    expect(dinheiroCurto(null)).toBe('—');
    expect(dinheiroCurto('12000')).toBe('R$ 12 mil');
  });

  it('decimal sem o ",0" e chance de 0 a 1', () => {
    expect(decimalEnxuto(4.4)).toBe('4,4');
    expect(decimalEnxuto(4)).toBe('4');
    expect(decimalEnxuto(null)).toBe('—');
    expect(pctDaChance(0.38)).toBe('38%');
    expect(pctDaChance(0.006)).toBe('0,6%');
    expect(pctDaChance(0)).toBe('0%');
  });

  it('preço da venda, do aluguel ou dos dois', () => {
    expect(precoCurto(690_000, null)).toBe('R$ 690 mil');
    expect(precoCurto(null, 2400)).toBe('R$ 2.400/mês');
    expect(precoCurto(1_100_000, 3200)).toBe('R$ 1,1 mi · R$ 3.200/mês');
    expect(precoCurto(null, null)).toBe('sem preço');
  });

  it('horas entre etapas', () => {
    expect(horas(0.1)).toBe('6 min');
    expect(horas(5)).toBe('5 h');
    expect(horas(84)).toBe('3,5 dias');
    expect(horas(24)).toBe('1 dia');
    expect(horas(null)).toBe('—');
  });

  it('encurta o título do anúncio dentro da frase', () => {
    expect(encurtar('Apto 3 quartos · Ponta Negra')).toBe('Apto 3 quartos · Ponta Negra');
    expect(
      encurtar('Terreno Comercial 3.500–5.000 m² na Área da BONOR, Esquina de Alto Fluxo no Centro de Parnamirim'),
    ).toBe('Terreno Comercial 3.500–5.000 m² na Área…');
    expect(encurtar(null)).toBe('');
  });

  it('defende do nulo onde a forma diz lista ou número', () => {
    expect(lista(null)).toEqual([]);
    expect(lista([1])).toEqual([1]);
    expect(numero('3,2')).toBeNull();
    expect(numero('3.2')).toBe(3.2);
    expect(numero(Number.NaN)).toBeNull();
  });

  it('teto redondo do eixo', () => {
    expect(tetoRedondo(34)).toBe(40);
    expect(tetoRedondo(0)).toBe(10);
    expect(tetoRedondo(40)).toBe(40);
  });
});

describe('o delta contra o período anterior', () => {
  it('contagem com base grande vira porcentagem', () => {
    expect(deltaDe(128, 104, 'contagem')).toEqual({
      texto: '▲ 23%',
      tom: 'bom',
      leitura: 'subiu 23%, melhor',
    });
  });

  it('contagem com base pequena vira diferença absoluta', () => {
    expect(deltaDe(9, 6, 'contagem')?.texto).toBe('▲ 3');
    expect(deltaDe(2, 4, 'contagem')?.tom).toBe('ruim');
  });

  it('menos é melhor inverte o bom e o ruim', () => {
    const d = deltaDe(6, 14, 'minutos', { menorEMelhor: true });
    expect(d?.texto).toBe('▼ 8 min');
    expect(d?.tom).toBe('bom');
    const parada = deltaDe(74_000, 69_000, 'dinheiro', { menorEMelhor: true });
    expect(parada?.texto).toBe('▲ R$ 5 mil');
    expect(parada?.tom).toBe('ruim');
  });

  it('pontos percentuais, com o estável perto de zero', () => {
    expect(deltaDe(24, 21, 'pontos')?.texto).toBe('▲ 3 p.p.');
    const estavel = deltaDe(39, 40, 'pontos');
    expect(estavel?.texto).toBe('▼ 1 p.p.');
    expect(estavel?.tom).toBe('neutro');
    expect(estavel?.leitura).toContain('estável');
  });

  it('igual e sem base', () => {
    expect(deltaDe(5, 5, 'contagem')?.texto).toBe('= igual');
    expect(deltaDe(5, null, 'contagem')).toBeNull();
    expect(deltaDe(4.2, 3.8, 'nota')?.texto).toBe('▲ 0,4');
    expect(deltaDe(0.67, 0.84, 'dolar', { menorEMelhor: true })?.texto).toBe('▼ US$ 0,17');
  });
});

describe('datas no fuso de Natal', () => {
  it('há quanto, com os minutos da fila', () => {
    expect(haQuantoCurto('2026-11-09T12:05:00Z', AGORA)).toBe('há 55 min');
    expect(haQuantoCurto('2026-11-09T11:20:00Z', AGORA)).toBe('há 1 h 40');
    expect(haQuantoCurto('2026-11-08T12:00:00Z', AGORA)).toBe('ontem');
    expect(haQuantoCurto('2026-11-05T12:00:00Z', AGORA)).toBe('há 4 dias');
    expect(haQuantoCurto(null, AGORA)).toBe('');
  });

  it('o tempo de cada situação', () => {
    expect(tempoDaSituacao('esperando', '2026-11-09T11:20:00Z', AGORA)).toBe('há 1 h 40');
    expect(tempoDaSituacao('promessa', '2026-11-08T12:00:00Z', AGORA)).toBe('venceu ontem');
    expect(tempoDaSituacao('esfriando', '2026-11-03T12:00:00Z', AGORA)).toBe('6 dias sem responder');
    expect(tempoDaSituacao('combina', '2026-11-02T12:00:00Z', AGORA)).toBe('desde 02/11');
    expect(tempoDaSituacao('visita', null, AGORA)).toBe('');
  });

  it('mês, fim do mês e semana de uma data', () => {
    expect(nomeDoMes('2026-11')).toBe('Novembro');
    expect(nomeDoMes(null)).toBe('Este mês');
    expect(fimDoMes('2026-11')).toBe('30/11');
    expect(fimDoMes('2028-02')).toBe('29/02');
    const inicios = ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'];
    expect(indiceDaSemana(inicios, '2026-11-04T15:00:00Z')).toBe(2);
    expect(indiceDaSemana(inicios, '2026-10-01')).toBe(-1);
    expect(indiceDaSemana(inicios, null)).toBe(-1);
  });
});

describe('rótulos', () => {
  it('situação, lacuna, faixa, campo e nível', () => {
    expect(rotuloDaSituacao('proposta')).toBe('Proposta parada');
    expect(rotuloDaSituacao('visita', 'longo')).toBe('Visitou e ninguém voltou a falar');
    expect(rotuloDaLacuna('condominio_iptu')).toBe('Não sabia o condomínio ou o IPTU');
    expect(rotuloDaFaixaDeResposta('mais_4h')).toBe('+ de 4 h');
    expect(rotuloDaFaixaDePassagem('sem_resposta')).toBe('sem resposta');
    expect(rotuloDoCampo('valor_maximo')).toBe('Orçamento');
    expect(rotuloDoCampo('forma_pagamento', 'naFrase')).toBe('a forma de pagamento');
    expect(rotuloDoNivel('muito')).toBe('muito interessado');
    expect(rotuloDoNivel(null)).toBe('sem leitura');
  });

  it('versão curta e o que travou', () => {
    expect(versaoCurta('atendente-imova@v2')).toBe('v2');
    expect(versaoCurta('v3')).toBe('v3');
    expect(
      textoDaTrava([
        { motivo: 'Sem orçamento', pct: 41 },
        { motivo: 'Imóvel do anúncio não servia', pct: 27 },
        { motivo: 'Outro', pct: 5 },
      ]),
    ).toBe('Sem orçamento (41%) · imóvel do anúncio não servia (27%)');
    expect(textoDaTrava(null)).toBe('');
  });

  it('a dica da barra de interesse', () => {
    expect(textoDoInteresse({ muito: 4, interessado: 9, morno: 1 })).toBe(
      '4 muito interessados · 9 interessados · 1 morno',
    );
  });

  it('impacto de cada sugestão', () => {
    expect(
      impactoDaSugestao({ impacto_valor: 16_000, impacto_tipo: 'reais', unidade: 'de comissão provável' }),
    ).toEqual({ numero: 'R$ 16 mil', unidade: 'de comissão provável' });
    expect(impactoDaSugestao({ impacto_valor: 8, impacto_tipo: 'leads', unidade: 'perguntaram' }).numero).toBe(
      '8 leads',
    );
    expect(impactoDaSugestao({ impacto_valor: 1, impacto_tipo: 'visitas', unidade: '' }).numero).toBe('1 visita');
  });
});

describe('ordem', () => {
  it('imóveis por mais leads ou mais quentes', () => {
    const lista = [
      imovel({ codigo: 'A', total: 23, muito: 4 }),
      imovel({ codigo: 'B', total: 14, muito: 5 }),
      imovel({ codigo: 'C', total: 23, muito: 6 }),
    ];
    expect(ordenarImoveis(lista, 'total').map((m) => m.codigo)).toEqual(['C', 'A', 'B']);
    expect(ordenarImoveis(lista, 'muito').map((m) => m.codigo)).toEqual(['C', 'B', 'A']);
  });

  it('a fila: quem espera primeiro (o mais antigo antes), depois o maior valor', () => {
    const fila = [
      { id: 'proposta', situacao: 'proposta' as const, desde: null, valor: 16_000 },
      { id: 'espera-nova', situacao: 'esperando' as const, desde: '2026-11-09T12:00:00Z', valor: 500 },
      { id: 'sem-valor', situacao: 'visita' as const, desde: null, valor: null },
      { id: 'espera-antiga', situacao: 'esperando' as const, desde: '2026-11-09T10:00:00Z', valor: 100 },
      { id: 'visita', situacao: 'visita' as const, desde: null, valor: 9_000 },
    ];
    expect(ordenarFila(fila).map((l) => l.id)).toEqual([
      'espera-antiga',
      'espera-nova',
      'proposta',
      'visita',
      'sem-valor',
    ]);
  });

  it('o gargalo do funil é a menor passagem', () => {
    const etapas = [
      { etapa: 'Leads novos', leads: 128 },
      { etapa: 'Conversaram', leads: 96 },
      { etapa: 'Visita marcada', leads: 31 },
      { etapa: 'Visita feita', leads: 23 },
      { etapa: 'Proposta', leads: 9 },
      { etapa: 'Fechado', leads: 4 },
    ];
    expect(gargaloDoFunil(etapas)).toEqual({ indice: 2, taxa: 32, perdidos: 65 });
    expect(gargaloDoFunil([{ etapa: 'Leads novos', leads: 0 }])).toBeNull();
    // 1 → 0 é 0%, mas é amostra pequena: o gargalo é 16 → 1.
    const pequeno = [
      { etapa: 'Leads novos', leads: 41 },
      { etapa: 'Conversaram', leads: 16 },
      { etapa: 'Visita marcada', leads: 1 },
      { etapa: 'Visita feita', leads: 0 },
    ];
    expect(gargaloDoFunil(pequeno)).toEqual({ indice: 2, taxa: 6, perdidos: 15 });
    // Sem nenhuma etapa com amostra, vale a que tiver gente.
    expect(gargaloDoFunil([{ etapa: 'A', leads: 2 }, { etapa: 'B', leads: 0 }])).toEqual({
      indice: 1,
      taxa: 0,
      perdidos: 2,
    });
    expect(tituloDoFunilCurto([{ etapa: 'A', leads: 2 }, { etapa: 'B', leads: 0 }])).toBe(
      'O funil perde mais de “A” para “B”: ninguém passou',
    );
    expect(tituloDoFunilCurto(etapas)).toBe(
      'O funil perde mais de “Conversaram” para “Visita marcada”: só 32% passam',
    );
    expect(tituloDoFunilLongo(etapas)).toBe('A maior perda é antes de “Visita marcada”: 65 leads pararam ali');
    expect(tituloDoFunilLongo([])).toBe('Nenhum lead passou pelo funil no período');
  });
});

describe('meta e previsão', () => {
  it('faixa de negócios', () => {
    expect(faixaDeNegocios(4.4)).toBe('4 ou 5');
    expect(faixaDeNegocios(4)).toBe('4');
    expect(faixaDeNegocios(null)).toBe('—');
  });

  it('a conta de trás para a frente', () => {
    expect(contaDaMeta(previsao(), 6)).toEqual({
      faltam: 2,
      visitasFeitas: 12,
      visitasMarcadas: 17,
      porSemana: 6,
      semanasRestantes: 3,
    });
    expect(contaDaMeta(previsao(), null)).toBeNull();
    expect(contaDaMeta(previsao({ esperado: 6.2 }), 6)).toBeNull();
    const semRitmo = contaDaMeta(
      previsao({ ritmo: { visitas_por_negocio: null, comparecimento: null, visitas_marcadas_por_semana: null } }),
      6,
    );
    expect(semRitmo?.visitasFeitas).toBeNull();
    expect(semRitmo?.visitasMarcadas).toBeNull();
  });

  it('a frase da previsão', () => {
    expect(tituloDaPrevisao(previsao(), 6)).toBe(
      'Novembro deve fechar 4 ou 5; faltam 2 negócios para a meta de 6',
    );
    expect(tituloDaPrevisao(previsao(), null)).toBe('Novembro deve fechar 4 ou 5 negócios');
    expect(tituloDaPrevisao(previsao({ esperado: 6.4 }), 6)).toBe(
      'Novembro deve passar da meta de 6: previsão de 6 ou 7 negócios',
    );
    expect(tituloDaPrevisao(previsao({ fechados: 7, esperado: 7.5 }), 6)).toBe('Novembro já bateu a meta de 6');
    expect(tituloDaPrevisao(previsao({ fechados: 0, esperado: 0 }), 6)).toBe(
      'Novembro ainda não tem negócio previsto',
    );
    expect(tituloDaPrevisao(null, 6)).toBe('A previsão do mês ainda não tem dado');
  });

  it('a etapa que mais pesa na previsão', () => {
    expect(
      tituloDaPrevisaoPorEtapa([
        { etapa: 'Proposta', abertos: 5, chance: 0.38, esperado: 1.9 },
        { etapa: 'Visita feita', abertos: 11, chance: 0.09, esperado: 1 },
        { etapa: 'Visita marcada', abertos: 8, chance: 0.04, esperado: 0.32 },
      ]),
    ).toBe('Os 5 negócios em “Proposta” são 59% da previsão');
    expect(tituloDaPrevisaoPorEtapa([])).toBe('Nenhum negócio aberto conta para a previsão');
  });
});

describe('frases-título', () => {
  it('imóveis', () => {
    const lista = [
      imovel({ codigo: 'IM-0429', titulo: 'Apto 3 quartos · Ponta Negra', total: 23, muito: 4 }),
      imovel({ codigo: 'IM-0412', total: 14, muito: 5 }),
    ];
    expect(tituloDoMaisProcurado(lista)).toBe('Apto 3 quartos · Ponta Negra (IM-0429) é o mais procurado: 23 leads');
    expect(tituloDoMaisProcurado([])).toBe('Nenhum imóvel teve lead interessado no período');
    expect(tituloDoRanking(lista, 'total')).toBe('O mais procurado é Apto 3 quartos · Ponta Negra: 23 leads');
    expect(tituloDoRanking(lista, 'muito')).toBe('Mais quentes: o IM-0412 tem 5 leads muito interessados');
    expect(tituloDoRanking([imovel({ codigo: 'X' })], 'muito')).toBe('Nenhum imóvel tem lead muito interessado');
  });

  it('dinheiro parado', () => {
    expect(tituloDaMesa(74_000, 38)).toBe('R$ 74 mil de comissão provável parada em 38 leads');
    expect(tituloDaMesa(0, 0)).toBe('Nenhum lead com chance de negócio está parado agora');
    const situacoes = [
      { situacao: 'proposta' as const, leads: 3, valor: 27_200, venda: 0, aluguel: 0, chance: 0.44 },
      { situacao: 'visita' as const, leads: 6, valor: 21_200, venda: 0, aluguel: 0, chance: 0.17 },
      { situacao: 'esfriando' as const, leads: 9, valor: 40_000, venda: 0, aluguel: 0, chance: 0.04 },
    ];
    expect(tituloDasSituacoes(situacoes)).toBe('76% do valor parado está em “Esfriando” e “Proposta parada”');
    expect(tituloDasSituacoes([situacoes[0]!])).toBe('100% do valor parado está em “Proposta parada”');
    expect(tituloDasSituacoes([])).toBe('Nada parado agora');
    expect(
      tituloDosDonos([
        { dono: 'Ana', leads: 11, valor: 29_800 },
        { dono: null, leads: 7, valor: 8_500 },
      ]),
    ).toBe('7 leads parados estão sem dono');
    expect(tituloDosDonos([{ dono: 'Ana', leads: 11, valor: 29_800 }])).toBe(
      'Ana tem o maior valor parado: R$ 29,8 mil',
    );
    expect(tituloDosDonos([])).toBe('Ninguém tem lead parado agora');
  });

  it('funil e equipe', () => {
    expect(
      tituloDaVelocidade([
        { faixa: 'ate_5', leads: 61, visitas: 20 },
        { faixa: 'mais_4h', leads: 8, visitas: 0 },
      ]),
    ).toBe('Respondido em até 5 minutos, 33% marcam visita; depois de 4 horas, nenhum');
    expect(
      tituloDaVelocidade([
        { faixa: 'ate_5', leads: 60, visitas: 20 },
        { faixa: 'mais_4h', leads: 15, visitas: 1 },
      ]),
    ).toBe('Respondido em até 5 minutos, o lead marca visita 5 vezes mais do que depois de 4 horas');
    expect(tituloDaVelocidade([])).toBe('Quanto marcou visita, pela demora da primeira resposta');

    expect(
      tituloDasPerguntas([
        { campo: 'valor_maximo', sabe_pct: 41, nao_sabe_pct: 12 },
        { campo: 'bairros', sabe_pct: 34, nao_sabe_pct: 18 },
      ]),
    ).toBe('Saber o orçamento multiplica por 3,4 a chance de visita');
    expect(tituloDasPerguntas([{ campo: 'decide_com', sabe_pct: 36, nao_sabe_pct: 12 }])).toBe(
      'Saber quem decide junto triplica a chance de visita',
    );
    expect(tituloDasPerguntas([])).toBe('Quanto marcou visita: quem já disse e quem ainda não disse');

    expect(
      tituloDasObjecoes([
        { objecao: 'Preço', leads: 38, visitaram_pct: 18 },
        { objecao: 'Financiamento', leads: 17, visitaram_pct: 41 },
      ]),
    ).toBe('Preço é a objeção que mais aparece; financiamento é a que mais se resolve');
    expect(tituloDasObjecoes([])).toBe('Nenhuma objeção no período');

    expect(
      tituloDosCanais([
        { canal: 'Portais', leads_pct: 58, vendas_pct: 42 },
        { canal: 'Indicação', leads_pct: 8, vendas_pct: 25 },
      ]),
    ).toBe('Indicação traz 8% dos leads e 25% das vendas');
    expect(tituloDosCanais(null)).toBe('De onde vêm os leads e as vendas');

    const pessoa = (nome: string, visitas: number, propostas: number, pctProposta: number): LinhaPessoaVende => ({
      pessoa_id: nome,
      nome,
      atendeu: 10,
      primeira_resposta_min: 5,
      visitas_marcadas: visitas,
      marca_visita_pct: 20,
      visitas_feitas: visitas,
      propostas,
      visita_proposta_pct: pctProposta,
      fechou: 0,
      promessas_em_dia_pct: 80,
      parado_valor: 0,
      dias_visita_proposta: null,
    });
    expect(tituloDaEquipe([pessoa('Ana', 8, 5, 63), pessoa('Bruno', 7, 2, 29), pessoa('Carla', 8, 1, 13)])).toBe(
      'Equipe: Ana faz proposta em 63% das visitas; a média é 35%',
    );
    expect(tituloDaEquipe([])).toBe('Equipe: os três passos que decidem a venda');
  });

  it('IA', () => {
    expect(tituloDaNotaDaIA([{ nota: 3.37 }, { nota: null }, { nota: 4.27 }])).toBe(
      'A nota da IA subiu de 3,4 para 4,3',
    );
    expect(tituloDaNotaDaIA([])).toBe('A IA ainda não tem nota da avaliação diária');

    const semanas = [
      semana({ inicio: '2026-09-01', duvida: 3.4, informacao: 3.1, satisfacao: 3.6, subiu_pct: 18 }),
      semana({ inicio: '2026-09-08', duvida: 4.3, informacao: 4.1, satisfacao: 4.4, subiu_pct: 31 }),
    ];
    expect(tituloDasNotas(semanas)).toBe('As três notas subiram; informação útil foi a que mais cresceu');
    expect(tituloDasNotas([])).toBe('A avaliação diária ainda não deu nota à IA');
    expect(tituloDoInteresse(semanas)).toBe(
      'O cliente sai da conversa mais interessado: 18% no começo, 31% agora',
    );

    const v = (n: number[]) => n.map((visitas, i) => semana({ inicio: `2026-10-${10 + i}`, visitas }));
    expect(tituloDasVisitasDaIA(v([1, 2, 4, 0]))).toBe('Marcou 4 visitas na última semana completa; começou com 1');
    expect(tituloDasVisitasDaIA(v([1, 0]))).toBe('Marcou 1 visita na primeira semana');
    expect(tituloDasVisitasDaIA(v([2]))).toBe('Marcou 2 visitas nesta semana');
    expect(tituloDasVisitasDaIA([])).toBe('Visitas marcadas pela IA');

    expect(
      tituloDasLacunas([
        { lacuna: 'financiamento', agora: 5 },
        { lacuna: 'condominio_iptu', agora: 7 },
      ]),
    ).toBe('O que ainda falta: “Não sabia o condomínio ou o IPTU” é a maior lacuna');
    expect(tituloDasLacunas([])).toBe('A avaliação diária não achou falha nas últimas 4 semanas');

    expect(
      tituloDaPassagem([
        { faixa: 'ate_15', leads: 7 },
        { faixa: '15_60', leads: 5 },
        { faixa: '1_2h', leads: 2 },
        { faixa: 'mais_2h', leads: 9 },
      ]),
    ).toBe('Onde a IA depende da equipe: 9 de 23 leads passados esperaram mais de 2 horas');
    expect(tituloDaPassagem([])).toBe('A IA não passou nenhuma conversa para a equipe nas últimas 4 semanas');
  });

  it('as 8 semanas do imóvel', () => {
    const inicios = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'];
    const s = (n: number[]) => inicios.map((inicio, i) => ({ inicio, novos: n[i] ?? 0 }));
    expect(tituloDasSemanasDoImovel(s([0, 0, 0, 0, 0, 0, 7, 9]), '2026-10-28T12:00:00Z')).toBe(
      'Entrou no ar em 28/10 e já tem 16 leads novos',
    );
    expect(tituloDasSemanasDoImovel(s([2, 2, 2, 2, 2, 2, 4, 5]), '2026-01-01')).toBe(
      'O interesse subiu nas últimas 2 semanas: 4,5 leads por semana, contra 2 antes',
    );
    expect(tituloDasSemanasDoImovel(s([1, 2, 2, 3, 2, 3, 2, 2]), null)).toBe(
      'Interesse estável: 1 a 3 leads novos por semana',
    );
    expect(tituloDasSemanasDoImovel([], null)).toBe('Nenhum lead novo nas últimas 8 semanas');
  });
});

describe('premissas', () => {
  const premissas = { comissao_venda_pct: 6, alugueis_na_locacao: 1, meta_mes: 6, pode_editar: true };

  it('a linha das premissas', () => {
    expect(textoDasPremissas(premissas)).toBe('Comissão: 6% na venda · 1 aluguel na locação · Meta: 6 negócios');
    expect(textoDasPremissas({ ...premissas, comissao_venda_pct: 5.5, alugueis_na_locacao: 2, meta_mes: null })).toBe(
      'Comissão: 5,5% na venda · 2 aluguéis na locação · Meta: sem meta',
    );
    expect(textoDasPremissas(null)).toBe('');
  });

  it('o que vai para os campos', () => {
    expect(premissasParaDigitar({ ...premissas, comissao_venda_pct: 5.5, meta_mes: null })).toEqual({
      comissao: '5,5',
      alugueis: '1',
      meta: '',
    });
  });

  it('confere os limites e aceita vírgula', () => {
    expect(lerPremissas({ comissao: '5,5', alugueis: '1', meta: '' })).toEqual({
      ok: true,
      valor: { comissao_venda_pct: 5.5, alugueis_na_locacao: 1, meta_mes: null },
    });
    expect(lerPremissas({ comissao: '6%', alugueis: '0', meta: '12' })).toEqual({
      ok: true,
      valor: { comissao_venda_pct: 6, alugueis_na_locacao: 0, meta_mes: 12 },
    });
    const ruim = lerPremissas({ comissao: '0,2', alugueis: '4', meta: '2,5' });
    expect(ruim.ok).toBe(false);
    if (!ruim.ok) expect(Object.keys(ruim.erros).sort()).toEqual(['alugueis', 'comissao', 'meta']);
    expect(lerPremissas({ comissao: 'abc', alugueis: '1', meta: '501' }).ok).toBe(false);
    expect(lerPremissas({ comissao: '20', alugueis: '3', meta: '500' }).ok).toBe(true);
  });
});

describe('a linha em SVG', () => {
  it('pontos de 0 a 100 e trechos sem os buracos', () => {
    const pontos = pontosDaLinha([3, null, 5, 4], [3, 5]);
    expect(pontos[0]).toEqual({ x: 0, y: 100 });
    expect(pontos[1]).toBeNull();
    expect(pontos[2]?.y).toBe(0);
    expect(trechosDaLinha(pontos)).toEqual(['0.00,100.00', '66.67,0.00 100.00,50.00']);
    expect(pontosDaLinha([4], [3, 5])[0]).toEqual({ x: 50, y: 50 });
  });
});

describe('o que mudou e o que corrigir', () => {
  it('conta o que cada versão conhecida mudou, e cala na desconhecida', () => {
    expect(oQueMudouNaVersao('atendente-imova@v2')).toMatch(/foto do anúncio/);
    expect(oQueMudouNaVersao('atendente-imova@v3')).toMatch(/link da agenda/);
    expect(oQueMudouNaVersao('atendente-imova@v9')).toBeNull();
    expect(oQueMudouNaVersao(null)).toBeNull();
  });
  it('toda lacuna tem um caminho para corrigir', () => {
    for (const l of ['condominio_iptu', 'financiamento', 'fotos', 'demorou_visita', 'passou_sem_precisar',
      'nao_sabia_do_imovel', 'tom', 'outra'] as const) {
      expect(comoCorrigirLacuna(l)).toBeTruthy();
    }
  });
});
