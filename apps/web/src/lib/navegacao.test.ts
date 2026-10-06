import { describe, expect, it } from 'vitest';

import {
  barraDoCelular,
  contagemDoItem,
  estaAtivo,
  GRUPOS,
  HREF_IMPORTAR,
  HREF_NOVO_PARCEIRO,
  leTelefoneCompleto,
  NAVEGACAO,
  navegacaoAgrupada,
  navegacaoDaLateral,
  navegacaoPara,
  podeCriarParceiro,
  podeImportarPlanilha,
} from '@/lib/navegacao';

describe('NAVEGACAO', () => {
  it('tem os 5 módulos de uso diário na barra do celular, com Lotes onde era o Registrar', () => {
    // Registrar saiu do menu no pivô de 06/10/2026 (a tela continua, pelo botão
    // "Registrar contato"); a fatia dele ficou com Ligar, que virou metade do
    // trabalho do SDR. Cinco fatias mais "Mais" cabem em 390px com o alvo de
    // toque de 44px; a sexta não caberia.
    //
    // A ORDEM é a do polegar, e é por isso que ela está escrita num campo próprio:
    // agrupar a lateral por natureza do trabalho teria empurrado Conversas para a
    // terceira fatia e Parceiros para a quarta, mudando de lugar o botão que a mão
    // já sabe achar. Este teste é o que trava as duas ordens em critérios separados.
    expect(barraDoCelular('admin').fatias.map((item) => item.rotulo)).toEqual([
      'Meu dia',
      'Lotes',
      'Prospectados',
      'Funis',
      'Conversas',
    ]);
  });

  it('quem liga fica com duas fatias, e nada em "Mais"', () => {
    const barra = barraDoCelular('sdr');
    expect(barra.fatias.map((item) => item.rotulo)).toEqual(['Meu dia', 'Lotes']);
    expect(barra.emMais).toEqual([]);
  });

  it('Campanhas e Cadências deixaram de existir, e Registrar saiu do menu (pivô de 06/10/2026)', () => {
    const hrefs = NAVEGACAO.map((item) => item.href);
    expect(hrefs).not.toContain('/envios');
    expect(hrefs).not.toContain('/cadencias');
    expect(hrefs).not.toContain('/registrar');
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
    expect(contam.sort()).toEqual(['Conversas', 'Revisão']);

    const controle = NAVEGACAO.filter((item) => item.grupo === 'controle');
    for (const item of controle) expect(item.fila).toBeUndefined();
  });

  it('o número de Conversas é o de respostas novas, e o da Revisão vem do servidor', () => {
    // Desde 01/10/2026 Conversas não conta mais rascunho da IA: conta resposta
    // nova para esta pessoa, que o aviso de resposta mantém vivo no navegador. O
    // servidor nunca preenche essa fila — se preenchesse, o número só mudaria na
    // recarga da página.
    const conversas = NAVEGACAO.find((item) => item.href === '/conversas');
    const revisao = NAVEGACAO.find((item) => item.href === '/revisao');
    const metas = NAVEGACAO.find((item) => item.href === '/metas');
    if (!conversas || !revisao || !metas) throw new Error('item de menu sumiu');

    expect(conversas.fila).toBe('respostas');
    expect(contagemDoItem(conversas, { candidatos: 12 }, 3)).toBe(3);
    expect(contagemDoItem(conversas, { candidatos: 12 }, null)).toBeNull();
    expect(contagemDoItem(revisao, { candidatos: 12 }, 3)).toBe(12);
    expect(contagemDoItem(revisao, {}, 3)).toBeNull();
    expect(contagemDoItem(metas, { candidatos: 12 }, 3)).toBeNull();
  });

  it('a Revisão saiu de "A base" e foi para "Todo dia"', () => {
    // A régua está no próprio arquivo: "A base" é "para achar alguém e para
    // organizar, não para produzir contato". Depois da Fase 1 é na Revisão que o
    // contato nasce — cada linha do CSV do Maps passa por lá antes de existir
    // ficha. Continua FORA dos seis principais.
    const revisao = NAVEGACAO.find((item) => item.href === '/revisao');
    expect(revisao?.grupo).toBe('todo_dia');
    expect(revisao?.principal).toBeUndefined();
  });

  it('não oferece Ligar a quem o banco vai recusar', () => {
    // Era uma ejeção: leitura e financeiro viam o item, entravam, montavam o lote
    // e só descobriam a recusa quando `registrar_contato` devolvia sem_permissao.
    const ligar = NAVEGACAO.find((item) => item.href === '/ligar');
    expect(ligar?.papeis).toEqual(['admin', 'gestor', 'sdr']);
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

  it('quem liga vê duas telas: Meu dia e Ligar (pivô de 06/10/2026)', () => {
    expect(navegacaoPara('sdr').map((item) => item.rotulo)).toEqual(['Meu dia', 'Lotes']);
  });

  it('admin e gestor veem tudo o que sobrou', () => {
    for (const papel of ['admin', 'gestor'] as const) {
      expect(navegacaoPara(papel).map((item) => item.rotulo)).toEqual([
        'Meu dia',
        'Lotes',
        'Conversas',
        'Agenda',
        'Revisão',
        'Prospectados',
        'Funis',
        'Metas',
        'Relatórios',
        'Ajustes',
      ]);
    }
  });

  it('papel que não existe mais não vê menu nenhum', () => {
    for (const papel of ['embaixador', 'leitura', 'financeiro', 'bot'] as const) {
      expect(navegacaoPara(papel)).toEqual([]);
    }
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
    for (const papel of [
      'admin',
      'gestor',
      'sdr',
      'embaixador',
      'leitura',
      'financeiro',
    ] as const) {
      for (const bloco of navegacaoAgrupada(papel)) {
        expect(bloco.itens.length).toBeGreaterThan(0);
      }
    }
  });

  it('nunca oferece a quem liga um item que a rota ejetaria', () => {
    // Tudo o que é da gestão tem `requireRole` de admin e gestor no servidor:
    // Conversas, Agenda, Funis, Metas, a lista de Parceiros, Revisão, Relatórios
    // e Ajustes. Sobra um grupo só, e os outros dois nem aparecem.
    const sdr = navegacaoAgrupada('sdr');
    const rotulos = sdr.flatMap((b) => b.itens.map((i) => i.rotulo));
    for (const fechado of [
      'Conversas',
      'Agenda',
      'Funis',
      'Metas',
      'Prospectados',
      'Revisão',
      'Relatórios',
      'Ajustes',
    ]) {
      expect(rotulos).not.toContain(fechado);
    }
    expect(sdr.map((b) => b.grupo.chave)).toEqual(['todo_dia']);
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
  it('só admin e gestor põem gente na base; o SDR não adiciona lead', () => {
    for (const pode of [podeCriarParceiro, podeImportarPlanilha]) {
      expect(pode('admin')).toBe(true);
      expect(pode('gestor')).toBe(true);
      expect(pode('sdr')).toBe(false);
      expect(pode('embaixador')).toBe(false);
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
  it('só admin e gestor leem o telefone inteiro; o SDR revela pelo botão', () => {
    expect(leTelefoneCompleto('admin')).toBe(true);
    expect(leTelefoneCompleto('gestor')).toBe(true);
    // Vê o telefone mascarado: é para ele que o vazio explica por que buscar por
    // um trecho do número não acha nada (RF-BAS-14).
    expect(leTelefoneCompleto('sdr')).toBe(false);
    for (const papel of ['embaixador', 'leitura', 'financeiro', 'bot'] as const) {
      expect(leTelefoneCompleto(papel)).toBe(false);
    }
  });
});

describe('navegacaoDaLateral (Fase 1)', () => {
  it('deixa 6 itens à vista para quem vê tudo, na ordem do dia', () => {
    expect(navegacaoDaLateral('admin').principais.map((i) => i.href)).toEqual([
      '/meu-dia',
      '/conversas',
      '/ligar',
      '/funis',
      '/parceiros',
      '/relatorios',
    ]);
  });

  it('guarda o resto em "Mais", sem perder nenhum item', () => {
    const { principais, mais } = navegacaoDaLateral('admin');
    expect(principais.length + mais.length).toBe(navegacaoPara('admin').length);
    expect(mais.map((i) => i.href)).toContain('/revisao');
  });

  it('quem não vê um principal fica com menos à vista, e o "Mais" não ganha nada', () => {
    const sdr = navegacaoDaLateral('sdr');
    expect(sdr.principais.map((i) => i.href)).toEqual(['/meu-dia', '/ligar']);
    expect(sdr.mais).toEqual([]);
  });
});
