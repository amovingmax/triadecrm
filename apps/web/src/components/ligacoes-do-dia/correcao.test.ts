import { describe, expect, it } from 'vitest';

import { avisoDaCorrecao, chaveAtual, podeCorrigir, recadoDaCorrecao } from './correcao';

describe('podeCorrigir', () => {
  it('oferece o botão para ligação com resultado, a quem pode corrigir', () => {
    expect(podeCorrigir({ resultado: 'nao_atendeu', desfecho: null }, true)).toBe(true);
    expect(podeCorrigir({ resultado: 'atendida_humano', desfecho: 'lig_interessado' }, true)).toBe(
      true,
    );
  });

  it('não oferece a quem não corrige (quem ligou, olhando um dia que já passou)', () => {
    expect(podeCorrigir({ resultado: 'nao_atendeu', desfecho: null }, false)).toBe(false);
  });

  it('ligação sem resultado não tem o que corrigir: tabula-se na tela de ligar', () => {
    expect(podeCorrigir({ resultado: null, desfecho: null }, true)).toBe(false);
  });

  it('reunião marcada se desfaz pela Agenda, não por aqui', () => {
    expect(
      podeCorrigir({ resultado: 'atendida_humano', desfecho: 'lig_reuniao_marcada' }, true),
    ).toBe(false);
  });
});

describe('chaveAtual', () => {
  it('é o desfecho quando atendeu, e o resultado da linha quando não', () => {
    expect(chaveAtual({ resultado: 'atendida_humano', desfecho: 'lig_agora_nao' })).toBe(
      'lig_agora_nao',
    );
    expect(chaveAtual({ resultado: 'caixa_postal', desfecho: null })).toBe('caixa_postal');
    expect(chaveAtual({ resultado: null, desfecho: null })).toBeNull();
  });
});

describe('avisoDaCorrecao', () => {
  const base = {
    ok: true as const,
    era: 'Não atendeu',
    ficou: 'Interessado',
    etapaDepois: 'Respondeu',
  };

  it('diz o que era e o que ficou, e onde o negócio está', () => {
    expect(avisoDaCorrecao({ ...base, etapa: 'voltou' })).toEqual({
      titulo: 'Resultado corrigido: era "Não atendeu", ficou "Interessado".',
      detalhe: 'O negócio está em Respondeu.',
    });
  });

  it('avisa quando a etapa não foi mexida porque o negócio já tinha andado', () => {
    expect(avisoDaCorrecao({ ...base, etapa: 'ja_tinha_andado' }).detalhe).toMatch(
      /Confira na ficha/,
    );
  });

  it('avisa quando a etapa não pôde voltar sozinha', () => {
    expect(avisoDaCorrecao({ ...base, etapa: 'nao_voltou' }).detalhe).toMatch(/ajuste na ficha/);
  });
});

describe('recadoDaCorrecao', () => {
  it('toda recusa do banco tem frase, e a desconhecida não vaza código', () => {
    for (const motivo of [
      'sem_permissao',
      'ligacao_inexistente',
      'de_outra_pessoa',
      'de_outro_dia',
      'sem_resultado',
      'motivo_obrigatorio',
      'resultado_invalido',
      'mesmo_resultado',
      'reuniao_pela_agenda',
      'tem_reuniao',
      'motivo_de_perda_obrigatorio',
    ]) {
      expect(recadoDaCorrecao(motivo)).not.toMatch(/servidor/);
    }
    expect(recadoDaCorrecao('qualquer_coisa')).toBe(
      'Não deu para falar com o servidor. Tente de novo.',
    );
  });
});
