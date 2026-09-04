import { describe, expect, it } from 'vitest';

import {
  diaDaSemana,
  diferencas,
  formatarDataPura,
  hojeEmNatal,
  intervaloDoDia,
  mensagemDoErro,
  rotuloDaAcao,
  rotuloDaTabela,
  rotuloDoSilencio,
} from './formatos';
import { abaDaUrl, catalogoDaUrl, lgpdDaUrl } from './tipos';

describe('datas do fuso de Natal', () => {
  it('não empurra a data pura para o dia anterior', () => {
    // `new Date('2026-09-07')` seria 21:00 de 06/09 em Fortaleza: o feriado da
    // Independência apareceria com a data errada no calendário do time.
    expect(formatarDataPura('2026-09-07')).toBe('07/09/2026');
    expect(diaDaSemana('2026-09-07')).toBe('segunda');
  });

  it('recorta o dia em UTC-03, que é o fuso de Natal o ano inteiro', () => {
    const { de, ate } = intervaloDoDia('2026-09-04');
    expect(de).toBe('2026-09-04T03:00:00.000Z');
    expect(ate).toBe('2026-09-05T03:00:00.000Z');
  });

  it('devolve hoje em Natal no formato do campo de data', () => {
    // 01:00 UTC do dia 5 ainda é dia 4 em Natal.
    expect(hojeEmNatal(new Date('2026-09-05T01:00:00Z'))).toBe('2026-09-04');
  });
});

describe('auditoria', () => {
  it('traduz ação e tabela para o vocabulário do time', () => {
    expect(rotuloDaAcao('UPDATE')).toBe('Alterou');
    expect(rotuloDaTabela('organizations')).toBe('Parceiro');
    expect(rotuloDaTabela('tabela_que_nao_existe')).toBe('tabela_que_nao_existe');
  });

  it('nunca expõe o valor de campo sensível', () => {
    const mudancas = diferencas(
      { phone_e164: '+5584999990000', temperature: 'frio', updated_at: 'a' },
      { phone_e164: '+5584988887777', temperature: 'morno', updated_at: 'b' },
    );

    const telefone = mudancas.find((m) => m.campo === 'phone_e164');
    expect(telefone?.oculto).toBe(true);
    expect(telefone?.de).toBeNull();
    expect(telefone?.para).toBeNull();

    const temperatura = mudancas.find((m) => m.campo === 'temperature');
    expect(temperatura).toEqual({ campo: 'temperature', de: 'frio', para: 'morno', oculto: false });

    // `updated_at` muda em toda escrita e não diz nada a quem lê.
    expect(mudancas.some((m) => m.campo === 'updated_at')).toBe(false);
  });

  it('ignora campos que não mudaram e booleanos viram sim/não', () => {
    const mudancas = diferencas(
      { name: 'Buffet', do_not_contact: false },
      { name: 'Buffet', do_not_contact: true },
    );
    expect(mudancas).toEqual([{ campo: 'do_not_contact', de: 'não', para: 'sim', oculto: false }]);
  });
});

describe('janela de silêncio do desfecho', () => {
  it('lê 36500 dias como "para sempre"', () => {
    expect(rotuloDoSilencio(36500)).toBe('Para sempre');
    expect(rotuloDoSilencio(0)).toBe('Sem espera');
    expect(rotuloDoSilencio(1)).toBe('1 dia');
    expect(rotuloDoSilencio(30)).toBe('30 dias');
  });
});

describe('erros em português', () => {
  it('traduz a política de RLS em vez de mostrar o texto do Postgres', () => {
    const frase = mensagemDoErro(new Error('new row violates row-level security policy'));
    expect(frase).toContain('Seu acesso não alcança');
    expect(frase).not.toContain('row-level');
  });

  it('separa sessão expirada de queda de rede', () => {
    expect(mensagemDoErro(new Error('JWT expired'))).toContain('sessão expirou');
    expect(mensagemDoErro(new Error('Failed to fetch'))).toContain('não alcançou o servidor');
  });
});

describe('aba e seção vindas da URL', () => {
  it('aceita só valores conhecidos', () => {
    expect(abaDaUrl('lgpd')).toBe('lgpd');
    expect(abaDaUrl('inventada')).toBe('pessoas');
    expect(abaDaUrl(undefined)).toBe('pessoas');
  });

  it('só lê a seção quando ela pertence à aba', () => {
    expect(catalogoDaUrl('catalogos', 'desfechos')).toBe('desfechos');
    expect(catalogoDaUrl('lgpd', 'desfechos')).toBe('categorias');
    expect(lgpdDaUrl('lgpd', 'auditoria')).toBe('auditoria');
    expect(lgpdDaUrl('catalogos', 'auditoria')).toBe('supressao');
  });
});
