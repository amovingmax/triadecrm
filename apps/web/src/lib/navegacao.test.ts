import { describe, expect, it } from 'vitest';

import {
  barraDoCelular,
  estaAtivo,
  GRUPOS,
  HREF_IMPORTAR,
  HREF_NOVO_PARCEIRO,
  leTelefoneCompleto,
  NAVEGACAO,
  navegacaoAgrupada,
  navegacaoPara,
  podeCriarParceiro,
  podeImportarPlanilha,
} from '@/lib/navegacao';

describe('NAVEGACAO', () => {
  it('tem os 5 módulos de uso diário na barra do celular, com Registrar entre eles', () => {
    // Registrar entrou em 09/09/2026: é a tela onde o trabalho vira dado — cria a
    // temperatura, a próxima ação e a meta — e era a única do produto fora da
    // navegação, alcançável só por link de outra tela. Cinco fatias mais "Mais"
    // cabem em 390px com o alvo de toque de 44px; a sexta não caberia.
    //
    // A ORDEM é a do polegar, e é por isso que ela está escrita num campo próprio:
    // agrupar a lateral por natureza do trabalho teria empurrado Conversas para a
    // terceira fatia e Parceiros para a quarta, mudando de lugar o botão que a mão
    // já sabe achar. Este teste é o que trava as duas ordens em critérios separados.
    expect(barraDoCelular('admin').fatias.map((item) => item.rotulo)).toEqual([
      'Meu dia',
      'Registrar',
      'Parceiros',
      'Funis',
      'Conversas',
    ]);
  });

  it('não repete posição na barra, e nenhuma passa de cinco', () => {
    const posicoes = NAVEGACAO.map((item) => item.posicaoNaBarra).filter(
      (p): p is NonNullable<typeof p> => p !== undefined,
    );
    expect(new Set(posicoes).size).toBe(posicoes.length);
    expect(Math.max(...posicoes)).toBeLessThanOrEqual(5);
  });

  it('não usa travessão em nenhum rótulo nem descrição', () => {
    for (const item of NAVEGACAO) {
      expect(item.rotulo).not.toMatch(/[—–]/u);
      expect(item.descricao).not.toMatch(/[—–]/u);
    }
  });

  it('põe cada item em um dos três grupos, e nenhum grupo fica vazio', () => {
    const chaves = new Set(GRUPOS.map((g) => g.chave));
    for (const item of NAVEGACAO) expect(chaves.has(item.grupo)).toBe(true);
    for (const grupo of GRUPOS) {
      expect(NAVEGACAO.some((item) => item.grupo === grupo.chave)).toBe(true);
    }
  });

  it('lista os itens de cada grupo em blocos contíguos', () => {
    // A ordem do array É a ordem da tela, e `navegacaoAgrupada` filtra por grupo.
    // Se um item de "Controle" estivesse no meio de "Todo dia", o código continuaria
    // funcionando e a leitura do arquivo passaria a mentir sobre a tela.
    const ordem = NAVEGACAO.map((item) => item.grupo);
    const primeiraDe = new Map<string, number>();
    const ultimaDe = new Map<string, number>();
    ordem.forEach((grupo, i) => {
      if (!primeiraDe.has(grupo)) primeiraDe.set(grupo, i);
      ultimaDe.set(grupo, i);
    });
    for (const [grupo, primeira] of primeiraDe) {
      const ultima = ultimaDe.get(grupo) ?? primeira;
      const dentro = ordem.slice(primeira, ultima + 1);
      expect(dentro.every((g) => g === grupo)).toBe(true);
    }
  });

  it('só deixa contar quem tem trabalho parado esperando uma pessoa', () => {
    // A regra que faz o número significar alguma coisa: um numeral na lateral diz
    // "tem coisa parada aqui". Configuração e leitura não contam NUNCA — um número
    // em Ajustes ensinaria a pessoa a ignorar os números que importam.
    const contam = NAVEGACAO.filter((item) => item.fila).map((item) => item.rotulo);
    expect(contam.sort()).toEqual(['Conversas', 'Radar']);

    const controle = NAVEGACAO.filter((item) => item.grupo === 'controle');
    for (const item of controle) expect(item.fila).toBeUndefined();
  });

  it('não oferece Ligar a quem o banco vai recusar', () => {
    // Era uma ejeção: leitura e financeiro viam o item, entravam, montavam o lote
    // e só descobriam a recusa quando `registrar_contato` devolvia sem_permissao.
    const ligar = NAVEGACAO.find((item) => item.href === '/ligar');
    expect(ligar?.papeis).toEqual(['admin', 'gestor', 'sdr', 'embaixador']);
  });

  it('tirou Importar do menu sem tirar a rota do produto', () => {
    expect(NAVEGACAO.some((item) => item.href === HREF_IMPORTAR)).toBe(false);
    expect(HREF_IMPORTAR).toBe('/importar');
    // A palavra continua achável na paleta ⌘K, que indexa a descrição — agora pela
    // linha de Parceiros, que é quem tem o botão.
    const parceiros = NAVEGACAO.find((item) => item.href === '/parceiros');
    expect(parceiros?.descricao).toMatch(/importar planilha/i);
  });
});

describe('navegacaoPara', () => {
  it('esconde a administração de quem não é admin nem gestor (RF-ADM-01)', () => {
    const rotulos = (papel: Parameters<typeof navegacaoPara>[0]) =>
      navegacaoPara(papel).map((item) => item.rotulo);

    expect(rotulos('admin')).toContain('Ajustes');
    expect(rotulos('gestor')).toContain('Ajustes');
    expect(rotulos('sdr')).not.toContain('Ajustes');
    expect(rotulos('leitura')).not.toContain('Ajustes');
  });
});

describe('navegacaoAgrupada', () => {
  it('devolve os três grupos na ordem da tela para quem vê tudo', () => {
    expect(navegacaoAgrupada('admin').map((b) => b.grupo.chave)).toEqual([
      'todo_dia',
      'a_base',
      'controle',
    ]);
  });

  it('não devolve grupo que ficaria vazio para o papel', () => {
    for (const papel of ['admin', 'gestor', 'sdr', 'embaixador', 'leitura', 'financeiro'] as const) {
      for (const bloco of navegacaoAgrupada(papel)) {
        expect(bloco.itens.length).toBeGreaterThan(0);
      }
    }
  });

  it('nunca oferece a leitura e ao financeiro um item que a rota ejetaria', () => {
    // O embaixador é o caso que mais perde: sem Relatórios (requireRole no
    // servidor) e sem Ajustes. Ainda assim sobra grupo para ele em "Controle".
    const embaixador = navegacaoAgrupada('embaixador');
    const rotulos = embaixador.flatMap((b) => b.itens.map((i) => i.rotulo));
    expect(rotulos).not.toContain('Relatórios');
    expect(rotulos).not.toContain('Ajustes');
    expect(embaixador.map((b) => b.grupo.chave)).toContain('controle');

    for (const papel of ['leitura', 'financeiro'] as const) {
      const deles = navegacaoPara(papel).map((i) => i.href);
      expect(deles).not.toContain('/ligar');
      expect(deles).not.toContain('/registrar');
      expect(deles).not.toContain('/radar');
    }
  });
});

describe('estaAtivo', () => {
  it('marca a própria rota e as sub-rotas dela', () => {
    expect(estaAtivo('/parceiros', '/parceiros')).toBe(true);
    expect(estaAtivo('/parceiros/8f2', '/parceiros')).toBe(true);
    expect(estaAtivo('/parceiros-antigos', '/parceiros')).toBe(false);
    expect(estaAtivo('/funis', '/parceiros')).toBe(false);
  });

  it('não acende nada em /importar, que saiu do menu', () => {
    for (const item of NAVEGACAO) expect(estaAtivo('/importar', item.href)).toBe(false);
  });
});

describe('podeCriarParceiro e podeImportarPlanilha', () => {
  it('oferecem a ação a quem escreve e escondem de quem só lê', () => {
    for (const pode of [podeCriarParceiro, podeImportarPlanilha]) {
      expect(pode('sdr')).toBe(true);
      expect(pode('embaixador')).toBe(true);
      expect(pode('leitura')).toBe(false);
      expect(pode('financeiro')).toBe(false);
      expect(pode('bot')).toBe(false);
    }
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
