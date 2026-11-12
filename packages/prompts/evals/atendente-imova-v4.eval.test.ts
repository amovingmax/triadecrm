import { describe, expect, it } from 'vitest';

import { VIGENTES, obterPrompt, promptVigente } from '../src/catalogo';
import { varrerMontagem } from '../src/nucleo/auditoria-pii';
import { prepararChamada } from '../src/nucleo/chamada';
import { atendenteImovaV3 as v3 } from '../src/prompts/atendente-imova/v3';
import {
  atendenteImovaV4 as v4,
  sistemaComBaseV4,
  trocarUmaVez,
} from '../src/prompts/atendente-imova/v4';
import {
  CENARIOS_DO_ATENDENTE_V3,
  type CenarioDoAtendente,
  conferirCenario,
} from '../src/prompts/atendente-imova/cenarios-v3';
import {
  BASE_DO_ENSAIO_V4,
  CENARIOS_DO_ATENDENTE_V4,
} from '../src/prompts/atendente-imova/cenarios-v4';

/**
 * `atendente-imova@v4` (12/11/2026): A V3 COM O RASCUNHO RECEBENDO O LINK, SEM REDE.
 *
 * Decisão do usuário (12/11/2026): o imóvel em "rascunho" no CRM (quase toda a carteira
 * da Imova) recebe o link da visita; só o "pausado" continua com o corretor. Prova-se
 * aqui que a v4 é a v3 com só essa regra trocada, e que os cenários medem a troca.
 */

const CONTATO = {
  leadId: 'lead-1',
  nome: 'Janio Ramalho',
  empresa: null,
  telefones: ['+5584988776655'],
};

const comBase = { ...v4, sistema: sistemaComBaseV4(BASE_DO_ENSAIO_V4) };

describe('atendente-imova@v4: o contrato', () => {
  it('é a vigente, e a v3 continua no catálogo', () => {
    expect(VIGENTES['atendente-imova']).toBe(4);
    expect(promptVigente('atendente-imova')).toBe(v4);
    expect(obterPrompt('atendente-imova', 4)).toBe(v4);
    expect(obterPrompt('atendente-imova', 3)).toBe(v3);
    expect(v4.versao).toBe(4);
  });

  it('a entrada, a saída, o modelo e a montagem são os da v3', () => {
    expect(v4.entrada).toBe(v3.entrada);
    expect(v4.saida).toBe(v3.saida);
    expect(v4.modelo).toBe(v3.modelo);
    expect(v4.proposito).toBe(v3.proposito);
    expect(v4.montarMensagem).toBe(v3.montarMensagem);
    expect(v4.camposDoTriade).toEqual(v3.camposDoTriade);
    expect(v4.exemplos).toBe(v3.exemplos);
  });

  it('o texto só muda na regra do rascunho', () => {
    expect(v3.sistema).toContain('Imóvel "rascunho" ou "pausado", ou mais de um imóvel');
    expect(v4.sistema).not.toContain('Imóvel "rascunho" ou "pausado", ou mais de um imóvel');
    expect(v4.sistema).toContain('Imóvel "no_ar" ou "rascunho": mande o link.');
    expect(v4.sistema).toContain('Imóvel "pausado", ou mais de um imóvel para visitar');
    expect(v4.sistema).toContain('2. Imóvel "no_ar" ou "rascunho" está disponível.');
    // Fora dos dois trechos, as linhas são as mesmas e na mesma ordem.
    const linhasV3 = v3.sistema.split('\n');
    const linhasV4 = v4.sistema.split('\n');
    const soNaV3 = linhasV3.filter((l) => !linhasV4.includes(l));
    const soNaV4 = linhasV4.filter((l) => !linhasV3.includes(l));
    expect(soNaV3).toHaveLength(3);
    expect(soNaV4).toHaveLength(5);
    expect(soNaV3.every((l) => /rascunho|pausado|corretor|disponibilidade/.test(l))).toBe(true);
    expect(soNaV4.every((l) => /rascunho|pausado|corretor|disponibilidade|CRM/.test(l))).toBe(true);
  });

  it('a troca recusa um trecho que não está lá, ou que aparece duas vezes', () => {
    expect(trocarUmaVez('a b c', 'b', 'x')).toBe('a x c');
    expect(() => trocarUmaVez('a b c', 'z', 'x')).toThrow(/0 vez/);
    expect(() => trocarUmaVez('b b', 'b', 'x')).toThrow(/2 vez/);
  });

  it('o bloco de sistema com a base não tem dado pessoal e mostra o pausado', () => {
    const texto = sistemaComBaseV4(BASE_DO_ENSAIO_V4);
    expect(varrerMontagem(texto)).toEqual([]);
    expect(texto).toContain('IM0009');
  });
});

describe('atendente-imova@v4: os cenários do ensaio', () => {
  it('são os da v3, com o rascunho trocado e o pausado a mais', () => {
    expect(CENARIOS_DO_ATENDENTE_V4).toHaveLength(CENARIOS_DO_ATENDENTE_V3.length + 1);
    const nomes = CENARIOS_DO_ATENDENTE_V4.map((c) => c.nome);
    expect(nomes.filter((n) => /rascunho/.test(n))).toEqual([
      'imóvel em rascunho: manda o link da visita (v4)',
    ]);
    expect(nomes.filter((n) => /pausado/.test(n))).toHaveLength(1);
  });

  it('toda conversa passa pelo schema e pela auditoria, com a base do ensaio da v4', () => {
    for (const cenario of CENARIOS_DO_ATENDENTE_V4) {
      expect(() => prepararChamada(comBase, cenario.entrada, CONTATO), cenario.nome).not.toThrow();
    }
  });

  it('a resposta boa de cada cenário passa pelo schema e pelo conferidor', () => {
    for (const cenario of CENARIOS_DO_ATENDENTE_V4) {
      expect(() => v4.saida.parse(cenario.respostaBoa), cenario.nome).not.toThrow();
      expect(conferirCenario(cenario, cenario.respostaBoa), cenario.nome).toEqual([]);
    }
  });

  const cenario = (trecho: RegExp): CenarioDoAtendente => {
    const achado = CENARIOS_DO_ATENDENTE_V4.find((c) => trecho.test(c.nome));
    if (achado === undefined) throw new Error(`sem o cenário ${trecho.source}`);
    return achado;
  };

  it('no rascunho, passar para o corretor agora é erro; no pausado, mandar o link é erro', () => {
    const rascunho = cenario(/^imóvel em rascunho/);
    expect(
      conferirCenario(rascunho, {
        ...rascunho.respostaBoa,
        acao: 'passar_para_corretor',
        agenda: null,
      }),
    ).not.toEqual([]);

    const pausado = cenario(/^imóvel pausado/);
    expect(
      conferirCenario(pausado, {
        ...pausado.respostaBoa,
        acao: 'enviar_link_da_agenda',
        agenda: { tipo: 'visita', imovelCodigo: 'IM0009' },
        mensagem: 'Vou te mandar o link da agenda para você escolher o horário da visita.',
      }),
    ).not.toEqual([]);
  });
});
