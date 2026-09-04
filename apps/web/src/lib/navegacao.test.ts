import { describe, expect, it } from 'vitest';

import {
  estaAtivo,
  HREF_NOVO_PARCEIRO,
  leTelefoneCompleto,
  NAVEGACAO,
  navegacaoPara,
  podeCriarParceiro,
} from '@/lib/navegacao';

describe('NAVEGACAO', () => {
  it('tem exatamente os 4 módulos de uso diário na barra do celular', () => {
    const principais = NAVEGACAO.filter((item) => item.principal).map((item) => item.rotulo);
    expect(principais).toEqual(['Meu dia', 'Parceiros', 'Funis', 'Conversas']);
  });

  it('não usa travessão em nenhum rótulo nem descrição', () => {
    for (const item of NAVEGACAO) {
      expect(item.rotulo).not.toMatch(/[—–]/u);
      expect(item.descricao).not.toMatch(/[—–]/u);
    }
  });
});

describe('navegacaoPara', () => {
  it('esconde a administração de quem não é admin nem gestor (RF-ADM-01)', () => {
    const rotulos = (papel: Parameters<typeof navegacaoPara>[0]) =>
      navegacaoPara(papel).map((item) => item.rotulo);

    expect(rotulos('admin')).toContain('Admin');
    expect(rotulos('gestor')).toContain('Admin');
    expect(rotulos('sdr')).not.toContain('Admin');
    expect(rotulos('leitura')).not.toContain('Admin');
  });
});

describe('estaAtivo', () => {
  it('marca a própria rota e as sub-rotas dela', () => {
    expect(estaAtivo('/parceiros', '/parceiros')).toBe(true);
    expect(estaAtivo('/parceiros/8f2', '/parceiros')).toBe(true);
    expect(estaAtivo('/parceiros-antigos', '/parceiros')).toBe(false);
    expect(estaAtivo('/funis', '/parceiros')).toBe(false);
  });
});

describe('podeCriarParceiro', () => {
  it('oferece a ação a quem escreve e esconde de quem só lê', () => {
    expect(podeCriarParceiro('sdr')).toBe(true);
    expect(podeCriarParceiro('embaixador')).toBe(true);
    expect(podeCriarParceiro('leitura')).toBe(false);
    expect(podeCriarParceiro('financeiro')).toBe(false);
    expect(podeCriarParceiro('bot')).toBe(false);
  });

  it('aponta para a tela de parceiros com o pedido de cadastro rápido', () => {
    expect(HREF_NOVO_PARCEIRO).toBe('/parceiros?novo=1');
  });
});

describe('leTelefoneCompleto', () => {
  it('espelha app.reads_base_pii, que não é o mesmo conjunto de quem cria', () => {
    expect(leTelefoneCompleto('admin')).toBe(true);
    expect(leTelefoneCompleto('gestor')).toBe(true);
    expect(leTelefoneCompleto('leitura')).toBe(true);
    expect(leTelefoneCompleto('financeiro')).toBe(true);
    // Criam parceiro e veem o telefone mascarado: é para eles que o vazio explica
    // por que buscar por um trecho do número não acha nada (RF-BAS-14).
    expect(leTelefoneCompleto('sdr')).toBe(false);
    expect(leTelefoneCompleto('embaixador')).toBe(false);
    expect(leTelefoneCompleto('bot')).toBe(false);
  });
});
