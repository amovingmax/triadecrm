import { describe, expect, it } from 'vitest';

import {
  alcancesDaNota,
  apareceNoCanto,
  caminhoDaConversa,
  fraseDoMotivoDaNota,
  lerNotaSugerida,
  ondeEntra,
  problemaDaNota,
  rotuloDoAlcance,
} from './notas-sugeridas';

/**
 * A IA aprende com as respostas (27/11/2026): a trava é a mesma do banco
 * (`app.ia_nota_problema`), o cartão diz onde a nota entra, e o canto só mostra a sugestão a
 * quem respondeu, logo depois da resposta.
 */
const BRUTA = {
  id: 'n1',
  decisao_id: 'd1',
  conversation_id: 'c1',
  organization_id: 'o1',
  pergunta: 'Aceita FGTS?',
  resposta: 'Para terreno, não conseguimos utilizar o FGTS na compra.',
  texto_imovel: 'FGTS: não dá para usar o FGTS na compra deste terreno.',
  texto_geral: 'FGTS: não dá para usar o FGTS na compra de terreno.',
  escopo_sugerido: 'geral',
  imovel: 'o terreno em Camurupim',
  codigo: 'TE0004_IMOVA',
  onde_imovel: 'FICHA 5. TERRENO FRENTE-MAR EM TABATINGA E CAMURUPIM, NÍSIA FLORESTA',
  ficha_nova: false,
  onde_geral: '8. A IMOVA E A DOCUMENTAÇÃO',
  respondida_por: 'Rafael',
  respondida_por_mim: true,
  respondida_em: '2026-11-26T14:14:00-03:00',
  criado_em: '2026-11-26T14:14:10-03:00',
};

describe('a trava (a mesma do banco)', () => {
  it('deixa passar o fato com valor, data e medida', () => {
    expect(problemaDaNota('Energia: a sala tem energia individualizada.')).toBeNull();
    expect(problemaDaNota('O valor é R$ 520.000 (equipe, 23/11). Medidas: 12 m por 68 m.')).toBeNull();
  });

  it('segura telefone, o "1.338,99, 2.021" de 19/11, código, arroba, link e tamanho', () => {
    expect(problemaDaNota('Para visitar, ligue 84 98820-9001.')).toMatch(/telefone/);
    expect(problemaDaNota('A área é 1.338,99, 2.021 m² no total.')).toMatch(/telefone/);
    expect(problemaDaNota('É o terreno TE0004, de frente para o mar.')).toMatch(/código/);
    expect(problemaDaNota('Mande para contato@imova.com.br.')).toMatch(/e-mail/);
    expect(problemaDaNota('Veja em https://imova.com.br o mapa.')).toMatch(/link/);
    expect(problemaDaNota('Sim.')).not.toBeNull();
    expect(problemaDaNota('a '.repeat(160))).toMatch(/300/);
  });
});

describe('o cartão', () => {
  const nota = lerNotaSugerida(BRUTA)!;

  it('lê a sugestão do banco, com o alcance que a IA sugeriu', () => {
    expect(nota).toMatchObject({ id: 'n1', alcanceSugerido: 'geral', caminho: '/conversas?org=o1' });
    expect(alcancesDaNota(nota)).toEqual(['imovel', 'geral']);
  });

  it('diz onde a nota entra em cada alcance', () => {
    expect(ondeEntra(nota, 'imovel')).toBe(
      'Entra na FICHA 5. TERRENO FRENTE-MAR EM TABATINGA E CAMURUPIM, NÍSIA FLORESTA',
    );
    expect(ondeEntra(nota, 'geral')).toBe(
      'Entra na nota 8. A IMOVA E A DOCUMENTAÇÃO (vale para todos os imóveis)',
    );
    const nova = { ...nota, fichaNova: true, ondeNoImovel: 'SALA DE 19 M² NO BRISA MALL' };
    expect(ondeEntra(nova, 'imovel')).toBe('Entra numa ficha nova: SALA DE 19 M² NO BRISA MALL');
    expect(ondeEntra({ ...nota, ondeNoGeral: null }, 'geral')).toMatch(/nota nova/);
    expect(rotuloDoAlcance(nota, 'imovel')).toBe('Só o terreno em Camurupim');
  });

  it('sem imóvel, só "todos"; sem texto nenhum, não há sugestão', () => {
    const semImovel = lerNotaSugerida({ ...BRUTA, texto_imovel: null, onde_imovel: null, escopo_sugerido: 'imovel' })!;
    expect(alcancesDaNota(semImovel)).toEqual(['geral']);
    expect(semImovel.alcanceSugerido).toBe('geral');
    expect(lerNotaSugerida({ ...BRUTA, texto_imovel: null, texto_geral: null })).toBeNull();
  });

  it('o canto mostra só a quem respondeu, nas 2 horas seguintes', () => {
    const quando = Date.parse(BRUTA.respondida_em);
    expect(apareceNoCanto(nota, quando + 60_000)).toBe(true);
    expect(apareceNoCanto(nota, quando + 3 * 60 * 60_000)).toBe(false);
    expect(apareceNoCanto({ ...nota, respondidaPorMim: false }, quando + 60_000)).toBe(false);
  });

  it('as recusas dizem o que houve', () => {
    expect(fraseDoMotivoDaNota('ja_decidida', 'Gil')).toBe('Gil já decidiu essa sugestão.');
    expect(fraseDoMotivoDaNota('texto_telefone')).toMatch(/telefone/);
    expect(fraseDoMotivoDaNota('qualquer_coisa')).toBe('Não deu certo. Tente de novo.');
    expect(caminhoDaConversa('c1', null)).toBe('/conversas?cliente=c1');
  });
});
