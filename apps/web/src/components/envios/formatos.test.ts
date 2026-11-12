import { describe, expect, it } from 'vitest';

import { EMPRESA } from '@/lib/empresa';

import {
  acaoSugerida,
  acoesPara,
  aplicarQuantidade,
  avisoSemEmpresa,
  comecoDoEnvio,
  cpfValido,
  custoEstimado,
  detalheDoResumo,
  diaDaConversa,
  divisaoDoDia,
  duracaoEstimada,
  emPedacos,
  filtrosEscondidos,
  formatarNumero,
  formatarReais,
  fraseDaRecusa,
  fraseDeUmCadastro,
  fraseDoMotivo,
  fraseDoResumo,
  horaCurta,
  lerListaColada,
  nomeSugerido,
  pedacosConferidos,
  pedacosDaMensagem,
  pedacosNaSaida,
  progresso,
  proximaAbertura,
  quandoPorExtenso,
  regrasAoTrocar,
  regrasIncompletas,
  regrasPara,
  resumoDaListaColada,
  resumoDoCadastro,
  rotuloDaMensagem,
  rotuloDaVariavel,
  saudacaoDoMomento,
  telefoneDoBrasil,
  variaveisComRegra,
  variaveisDoCorpo,
} from './formatos';

describe('as variáveis de um corpo', () => {
  it('na ordem da primeira aparição, sem repetir, com ou sem espaço nas chaves', () => {
    expect(variaveisDoCorpo('Oi {{nome}}, da {{ empresa }}! {{nome}} de novo')).toEqual([
      'nome',
      'empresa',
    ]);
  });

  it('atendente e saudação não pedem regra: o banco preenche', () => {
    expect(variaveisComRegra('{{saudacao}}, {{nome}}! Aqui é {{atendente}}.')).toEqual(['nome']);
  });
});

describe('as regras sugeridas', () => {
  it('campo da ficha puxa da ficha, com uma reserva que ainda lê bem', () => {
    expect(regrasPara('Oi {{nome}}, da {{empresa}}, de {{categoria}}', {})).toEqual({
      nome: { campo: 'nome', reserva: 'pessoal' },
      empresa: { campo: 'empresa', reserva: '' },
      categoria: { campo: 'categoria', reserva: 'eventos' },
    });
  });

  it('variável que não é da ficha vira texto fixo, e fica incompleta até alguém escrever', () => {
    const regras = regrasPara('Convite para {{evento}}', {});
    expect(regras).toEqual({ evento: { fixo: '' } });
    expect(regrasIncompletas(regras)).toEqual(['evento']);
  });

  it('trocar de mensagem não herda o "texto fixo" de um campo da ficha', () => {
    const antes = {
      nome: { fixo: 'Mariana' },
      empresa: { campo: 'empresa' as const, reserva: 'sua empresa' },
      evento: { fixo: 'Feira de Noivas' },
    };
    expect(regrasAoTrocar('Oi {{nome}}, da {{empresa}}, na {{evento}}', antes)).toEqual({
      nome: { campo: 'nome', reserva: 'pessoal' },
      empresa: { campo: 'empresa', reserva: 'sua empresa' },
      evento: { fixo: 'Feira de Noivas' },
    });
  });

  it('trocar de modelo mantém o que a pessoa já tinha escrito', () => {
    const antes = { evento: { fixo: 'Feira de Noivas' } };
    expect(regrasPara('{{evento}} e {{nome}}', antes).evento).toEqual({ fixo: 'Feira de Noivas' });
  });
});

describe('os motivos em português', () => {
  it('motivo conhecido vira frase; desconhecido aparece como veio', () => {
    expect(fraseDoMotivo('contato_suprimido')).toMatch(/não receber/);
    expect(fraseDoMotivo('coisa_nova')).toBe('Recusado: coisa_nova.');
    expect(fraseDoMotivo(null)).toBe('');
  });

  it('a recusa do lote diz qual variável', () => {
    expect(fraseDaRecusa('variavel_sem_regra', 'evento')).toMatch(/\{\{evento\}\}/);
  });
});

describe('o tempo do lote', () => {
  it('poucas mensagens em ritmo alto: minutos', () => {
    expect(duracaoEstimada(10, 30, 45)).toBe('cerca de 20 min');
  });

  it('o teto de primeiros contatos pode mandar para vários dias', () => {
    expect(duracaoEstimada(120, 60, 35)).toBe('cerca de 4 dias úteis');
  });

  it('sem teto (quem já conversou), só o ritmo decide', () => {
    expect(duracaoEstimada(60, 20, null)).toBe('cerca de 3 h');
  });
});

describe('o progresso', () => {
  it('conta enviada, pulada e cancelada como decidida', () => {
    const c = {
      total: 10, pendentes: 4, enviadas: 4, puladas: 1, canceladas: 1,
      entregues: 3, lidas: 2, falharam: 0, responderam: 1, sairam: 0, tocaram: 0, clicaram: 0, cadastraram: 0,
    };
    expect(progresso(c)).toBeCloseTo(0.6);
  });
});

describe('a tela única da campanha', () => {
  it('o nome sai sozinho: a mensagem e o dia de Natal', () => {
    // 22h de 21/09 em Natal já é 22/09 em UTC: vale o dia de Natal.
    expect(nomeSugerido('Convite fundador', new Date('2026-09-22T01:00:00Z'))).toBe(
      'Convite fundador — 21/09',
    );
    expect(nomeSugerido(null)).toBe('');
    expect(nomeSugerido('   ')).toBe('');
  });

  it('marketing custa por mensagem; utilidade é grátis para quem está na janela', () => {
    expect(custoEstimado('marketing', 100, 30)).toBeCloseTo(34);
    expect(custoEstimado('utility', 100, 30)).toBeCloseTo(2.45);
    expect(custoEstimado(null, 100, 0)).toBeNull();
    expect(formatarReais(29.58).replace(/\s/g, ' ')).toBe('R$ 29,58');
  });

  it('conta os filtros escondidos em "Mais filtros", e só eles', () => {
    expect(filtrosEscondidos({ situacoes: ['nunca_contatado'], tags: [1], setores: [2] })).toBe(0);
    expect(
      filtrosEscondidos({ cidades: [1], tipos: [], busca: ' buffet ', sem_contato_ha_dias: 0 }),
    ).toBe(3);
  });

  it('os três cumprimentos aparecem como um só na lista de campanhas', () => {
    expect(rotuloDaMensagem('Boa tarde (cumprimento solto)')).toBe('Cumprimento');
    expect(rotuloDaMensagem(null)).toBe('Texto livre');
    expect(rotuloDaMensagem('Convite de fornecedor fundador (Komune)')).toBe(
      'Convite de fornecedor fundador (Komune)',
    );
  });
});

describe('a quantidade do disparo (12/11/2026)', () => {
  const marcados = ['a', 'b', 'c', 'd', 'e'];

  it('vazio manda para todos os marcados', () => {
    expect(aplicarQuantidade(marcados, null)).toEqual(marcados);
  });

  it('com um número, vão os primeiros da lista, nessa ordem — os 3 do teste', () => {
    expect(aplicarQuantidade(marcados, 3)).toEqual(['a', 'b', 'c']);
  });

  it('pedir mais do que há manda para todos, sem inventar ninguém', () => {
    expect(aplicarQuantidade(marcados, 50)).toEqual(marcados);
  });

  it('zero, negativo e fração não viram gente', () => {
    expect(aplicarQuantidade(marcados, 0)).toEqual([]);
    expect(aplicarQuantidade(marcados, -2)).toEqual([]);
    expect(aplicarQuantidade(marcados, 2.9)).toEqual(['a', 'b']);
    expect(aplicarQuantidade(marcados, Number.NaN)).toEqual(marcados);
  });
});

describe('o que cabe hoje no limite da Meta', () => {
  it('cabe tudo: nada fica para depois', () => {
    expect(divisaoDoDia(3, 1990, 0)).toEqual({ hoje: 3, depois: 0 });
  });

  it('desconta o que outros disparos já vão mandar', () => {
    expect(divisaoDoDia(500, 1000, 700)).toEqual({ hoje: 300, depois: 200 });
  });

  it('limite esgotado: tudo para o próximo dia útil', () => {
    expect(divisaoDoDia(10, 0, 0)).toEqual({ hoje: 0, depois: 10 });
  });

  it('sem saber o limite, não chuta', () => {
    expect(divisaoDoDia(10, null, 0)).toBeNull();
  });

  it('o número sai com ponto de milhar', () => {
    expect(formatarNumero(2000)).toBe('2.000');
  });
});

describe('os botões de um modelo', () => {
  it('"Agora não" tira da lista; o resto manda o link', () => {
    expect(acaoSugerida('Agora não')).toEqual({ acao: 'sair' });
    expect(acaoSugerida('Quero saber mais').acao).toBe('link');
  });

  it('só os de resposta ganham ação, e o que já foi editado fica', () => {
    const acoes = acoesPara(
      [
        { tipo: 'resposta', texto: 'Quero' },
        { tipo: 'resposta', texto: 'Agora não' },
        { tipo: 'link', texto: 'Criar meu perfil' },
      ],
      { Quero: { acao: 'nada' } },
    );
    expect(acoes).toEqual({ Quero: { acao: 'nada' }, 'Agora não': { acao: 'sair' } });
  });

  it('as recusas falam em disparo e no ritmo novo', () => {
    expect(fraseDaRecusa('ritmo_invalido')).toMatch(/300/);
    expect(fraseDaRecusa('sem_permissao')).toMatch(/SDR/);
  });
});

// ---------------------------------------------------------------------------
// O disparo numa página, com o celular ao lado (protótipo B, 12/11/2026)
// ---------------------------------------------------------------------------

/** O Intl põe espaço sem quebra no "R$ 1,02": o teste compara com espaço comum. */
const semNbsp = (s: string) => s.replace(/\s/g, ' ');

describe('o WhatsApp do Brasil, na conferência da tela', () => {
  it('aceita o número em qualquer formato e devolve E.164', () => {
    expect(telefoneDoBrasil('(84) 99999-0101')).toBe('+5584999990101');
    expect(telefoneDoBrasil('+55 84 99999-0101')).toBe('+5584999990101');
    expect(telefoneDoBrasil('0 84 99999 0101')).toBe('+5584999990101');
    expect(telefoneDoBrasil('0055 84 99999 0101')).toBe('+5584999990101');
  });

  it('sem DDD é de Natal (84); celular antigo de 8 dígitos ganha o 9', () => {
    expect(telefoneDoBrasil('99999-0101')).toBe('+5584999990101');
    expect(telefoneDoBrasil('(84) 9999-0101')).toBe('+5584999990101');
    expect(telefoneDoBrasil('(84) 3201-0101')).toBe('+558432010101');
  });

  it('recusa o que não é telefone', () => {
    expect(telefoneDoBrasil('')).toBeNull();
    expect(telefoneDoBrasil('Mariana')).toBeNull();
    expect(telefoneDoBrasil('123')).toBeNull();
    expect(telefoneDoBrasil('(84) 1999-0101')).toBeNull();
    // Número de fora do Brasil (EUA): não tem cara de celular daqui.
    expect(telefoneDoBrasil('+1 415 555 0101')).toBeNull();
  });
});

describe('a lista colada', () => {
  it('vírgula, ponto e vírgula e tabulação de planilha; a empresa é opcional', () => {
    const lida = lerListaColada(
      [
        'Mariana Souza, (84) 99999-0101',
        'Cláudia Lima; 84 99999-0102; Doces da Vovó',
        'Rafael Alves\t84999990103\tFoto Mar e Sol\trafael@foto.com',
      ].join('\n'),
    );
    expect(lida.recusadas).toEqual([]);
    expect(lida.validas).toEqual([
      { linha: 1, nome: 'Mariana Souza', telefone: '(84) 99999-0101', empresa: null },
      { linha: 2, nome: 'Cláudia Lima', telefone: '84 99999-0102', empresa: 'Doces da Vovó' },
      // Da planilha vale só a terceira coluna: a quarta é e-mail.
      { linha: 3, nome: 'Rafael Alves', telefone: '84999990103', empresa: 'Foto Mar e Sol' },
    ]);
  });

  it('coluna além de nome, telefone e empresa fica de fora (não se junta à empresa)', () => {
    const { validas } = lerListaColada('Ana, 84999990104, Buffet Sabor, ana@buffet.com, Natal');
    expect(validas[0]).toMatchObject({ nome: 'Ana', empresa: 'Buffet Sabor' });
  });

  it('coluna com cara de CPF nunca é telefone, e some da linha', () => {
    // CPF escrito como CPF: ignorado, mesmo antes do telefone.
    const { validas } = lerListaColada('Ana Lima; 529.982.247-25; 84 99999-0104; Doces da Ana');
    expect(validas).toEqual([
      { linha: 1, nome: 'Ana Lima', telefone: '84 99999-0104', empresa: 'Doces da Ana' },
    ]);
    // Só o CPF, sem telefone: a linha não vale.
    expect(lerListaColada('Ana Lima, 529.982.247-25').recusadas[0]?.motivo).toBe('sem_whatsapp');
  });

  it('11 dígitos que fecham como CPF perdem para outra coluna com cara de telefone', () => {
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('84999990104')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
    const { validas } = lerListaColada('Ana Lima\t52998224725\t84999990104\tDoces da Ana');
    expect(validas[0]).toMatchObject({ telefone: '84999990104', empresa: 'Doces da Ana' });
    // Sem outra coluna, os 11 dígitos ainda podem ser o telefone (o banco confere).
    expect(lerListaColada('Ana Lima, 52998224725').validas).toHaveLength(1);
  });

  it('passando do que cabe na lista do disparo, o resto fica de fora, e a tela diz', () => {
    const lida = lerListaColada('Ana, 84999990101\nBia, 84999990102\nCaio, 84999990103', 2);
    expect(lida.validas.map((v) => v.nome)).toEqual(['Ana', 'Bia']);
    expect(lida.recusadas).toEqual([
      { linha: 3, texto: 'Caio, 84999990103', motivo: 'acima_do_limite' },
    ]);
    expect(resumoDaListaColada(lida)).toBe(
      '2 pessoas prontas para entrar · 1 fica de fora: a lista do disparo vai até 2.000',
    );
  });

  it('o número na frente do nome, ou sem separador nenhum, também vale', () => {
    const { validas } = lerListaColada('84999990105, Lucas\nBeatriz Flores 84 99999-0106');
    expect(validas.map((v) => [v.nome, v.telefone])).toEqual([
      ['Lucas', '84999990105'],
      ['Beatriz Flores', '84 99999-0106'],
    ]);
  });

  it('pula o cabeçalho e as linhas vazias; diz a linha do que não vale', () => {
    const lida = lerListaColada(
      ['Nome, Telefone, Empresa', '', 'Paula, 123', ', 84999990107', 'Mariana, 84999990101', 'Mari, (84) 99999-0101'].join(
        '\n',
      ),
    );
    expect(lida.validas.map((v) => v.linha)).toEqual([5]);
    expect(lida.recusadas).toEqual([
      { linha: 3, texto: 'Paula, 123', motivo: 'sem_whatsapp' },
      { linha: 4, texto: ', 84999990107', motivo: 'sem_nome' },
      { linha: 6, texto: 'Mari, (84) 99999-0101', motivo: 'repetida' },
    ]);
    expect(resumoDaListaColada(lida)).toBe(
      '1 pessoa pronta para entrar · 1 linha sem WhatsApp válido (linha 3) · 1 linha sem nome (linha 4) · 1 WhatsApp repetido (linha 6)',
    );
  });

  it('lista vazia não tem ninguém pronto', () => {
    expect(resumoDaListaColada(lerListaColada('  \n '))).toBe('Nenhuma pessoa pronta ainda');
  });

  it('vai ao banco em partes de 500', () => {
    const lista = Array.from({ length: 1201 }, (_, i) => i);
    expect(emPedacos(lista, 500).map((p) => p.length)).toEqual([500, 500, 201]);
    expect(emPedacos([], 500)).toEqual([]);
  });
});

describe('o que o cadastro fez, em português', () => {
  it('conta novas, já da base, já da lista e recusadas', () => {
    const naLista = new Set(['org-3']);
    expect(
      resumoDoCadastro(
        [
          { status: 'novo', organization_id: 'org-1' },
          { status: 'novo', organization_id: 'org-2' },
          { status: 'ja_estava', organization_id: 'org-4' },
          { status: 'pediu_para_sair', organization_id: null },
        ],
        naLista,
      ),
    ).toBe('2 novas, 1 já estava na base, 1 pediu para não receber.');
    expect(
      resumoDoCadastro(
        [
          { status: 'ja_estava', organization_id: 'org-3' },
          { status: 'telefone_invalido', organization_id: null },
          { status: 'telefone_invalido', organization_id: null },
          { status: 'status_que_ainda_nao_existe', organization_id: null },
        ],
        naLista,
      ),
    ).toBe('1 já estava na lista, 2 com WhatsApp inválido, 1 não entrou.');
    expect(resumoDoCadastro([{ status: 'numero_de_outra_pessoa', organization_id: null }], naLista)).toBe(
      '1 é número de gente de outra ficha.',
    );
    expect(resumoDoCadastro([], naLista)).toBe('Ninguém entrou na lista.');
  });

  it('uma pessoa só: a frase usa o nome, e o erro não põe ninguém na lista', () => {
    expect(fraseDeUmCadastro({ status: 'novo', nome: 'Mariana Souza', organization_id: 'o' }, false)).toEqual({
      texto: 'Mariana entrou na lista e virou uma ficha nova em Prospectados.',
      entrou: true,
    });
    expect(fraseDeUmCadastro({ status: 'ja_estava', nome: 'Mariana', organization_id: 'o' }, true).texto).toBe(
      'Mariana já está na lista.',
    );
    expect(fraseDeUmCadastro({ status: 'pediu_para_sair', nome: 'Mariana', organization_id: null }, false).entrou).toBe(
      false,
    );
    expect(fraseDeUmCadastro({ status: 'telefone_invalido', nome: 'Mariana', organization_id: null }, false).texto).toMatch(
      /DDD/,
    );
    expect(
      fraseDeUmCadastro(
        { status: 'numero_de_outra_pessoa', nome: 'Mariana', organization_id: null, ficha: 'Buffet Sabor' },
        false,
      ),
    ).toEqual({
      texto: 'Esse WhatsApp é de uma pessoa da ficha (“Buffet Sabor”), que recebe por outro número. Não entra na lista.',
      entrou: false,
    });
    expect(
      fraseDeUmCadastro({ status: 'ja_estava', nome: 'Mariana', organization_id: 'o', ficha: 'Buffet Sabor' }, false).texto,
    ).toBe('Esse WhatsApp já tinha ficha (“Buffet Sabor”): entrou a ficha que já existe.');
  });

  it('7. sem empresa (a ficha tem o nome da pessoa) e a mensagem fala da empresa: avisa', () => {
    const semEmpresa = { nome: 'Mariana Souza', empresa: 'Mariana  Souza' };
    expect(avisoSemEmpresa(semEmpresa, true)).toBe(
      'Sem empresa: a mensagem vai dizer “Mariana Souza” no lugar da empresa.',
    );
    expect(avisoSemEmpresa(semEmpresa, false)).toBeNull();
    expect(avisoSemEmpresa({ nome: 'Mariana', empresa: 'Buffet Sabor' }, true)).toBeNull();
    expect(avisoSemEmpresa({ nome: null, empresa: 'Buffet Sabor' }, true)).toBeNull();
  });
});

describe('a mensagem em pedaços', () => {
  const corpo = 'Oi, {{nome}}! A {{ empresa }} pode estar na {{evento}}?';

  it('sem pessoa, cada campo vira etiqueta legível', () => {
    expect(pedacosDaMensagem(corpo)).toEqual([
      { tipo: 'texto', texto: 'Oi, ' },
      { tipo: 'campo', texto: '[Nome]', variavel: 'nome' },
      { tipo: 'texto', texto: '! A ' },
      { tipo: 'campo', texto: '[Empresa]', variavel: 'empresa' },
      { tipo: 'texto', texto: ' pode estar na ' },
      { tipo: 'campo', texto: '[Evento]', variavel: 'evento' },
      { tipo: 'texto', texto: '?' },
    ]);
  });

  it('com os valores, marca só o que muda por pessoa; o texto fixo some no texto', () => {
    const pedacos = pedacosDaMensagem(
      corpo,
      { nome: 'Mariana', empresa: ' Buffet  Sabor\nPotiguar ', evento: 'feira de noivas' },
      ['nome', 'empresa'],
    );
    expect(pedacos).toEqual([
      { tipo: 'texto', texto: 'Oi, ' },
      { tipo: 'valor', texto: 'Mariana', variavel: 'nome' },
      { tipo: 'texto', texto: '! A ' },
      { tipo: 'valor', texto: 'Buffet Sabor Potiguar', variavel: 'empresa' },
      { tipo: 'texto', texto: ' pode estar na feira de noivas?' },
    ]);
  });

  it('conferido contra o corpo do banco: igual, fica marcado; diferente, vale o do banco', () => {
    const pedacos = pedacosDaMensagem('Oi, {{nome}}!', { nome: 'Mariana' });
    expect(pedacosConferidos(pedacos, 'Oi, Mariana!')).toEqual(pedacos);
    expect(pedacosConferidos(pedacos, 'Oi, Mari!')).toEqual([{ tipo: 'texto', texto: 'Oi, Mari!' }]);
    // Campo sem valor nunca é "exatamente o que chega".
    expect(pedacosConferidos(pedacosDaMensagem('Oi, {{nome}}!'), 'Oi, [Nome]!')).toEqual([
      { tipo: 'texto', texto: 'Oi, [Nome]!' },
    ]);
    expect(pedacosConferidos([], '')).toEqual([]);
  });

  it('a saudação é a da hora em que sai, conferida contra o banco', () => {
    const base = {
      corpo: '{{saudacao}}, {{nome}}!',
      valores: { nome: 'Mariana' },
      marcadas: ['nome'],
      corpoDoBanco: 'Boa noite, Mariana!',
      saudacaoAgora: 'Boa noite',
    };
    expect(pedacosNaSaida({ ...base, saudacaoNaSaida: 'Bom dia' })).toEqual([
      { tipo: 'texto', texto: 'Bom dia, ' },
      { tipo: 'valor', texto: 'Mariana', variavel: 'nome' },
      { tipo: 'texto', texto: '!' },
    ]);
    // O banco disse outra coisa: vale o do banco, sem marcação.
    expect(pedacosNaSaida({ ...base, corpoDoBanco: 'Boa noite, Mari!', saudacaoNaSaida: 'Bom dia' })).toEqual([
      { tipo: 'texto', texto: 'Boa noite, Mari!' },
    ]);
  });

  it('o rótulo de cada campo, sem chaves', () => {
    expect(rotuloDaVariavel('nome')).toBe('Nome');
    expect(rotuloDaVariavel('saudacao')).toBe('Saudação');
    expect(rotuloDaVariavel('nome_do_evento')).toBe('Nome do evento');
  });
});

describe('a hora de Natal', () => {
  // 12/11/2026, 14h05 em Natal (UTC-3).
  const agora = new Date('2026-11-12T17:05:00Z');

  it('a saudação e a hora do balão seguem Natal, não o navegador', () => {
    expect(saudacaoDoMomento(new Date('2026-11-12T14:59:00Z'))).toBe('Bom dia');
    expect(saudacaoDoMomento(agora)).toBe('Boa tarde');
    expect(saudacaoDoMomento(new Date('2026-11-12T21:00:00Z'))).toBe('Boa noite');
    expect(horaCurta(agora)).toBe('14:05');
  });

  it('hoje, amanhã ou o dia', () => {
    expect(diaDaConversa(agora, agora)).toBe('Hoje');
    expect(diaDaConversa(new Date('2026-11-13T12:00:00Z'), agora)).toBe('Amanhã');
    expect(diaDaConversa(new Date('2026-11-20T12:00:00Z'), agora)).toBe('20/11');
    expect(quandoPorExtenso(new Date('2026-11-13T12:00:00Z'), agora)).toBe('amanhã às 9h');
    expect(quandoPorExtenso(new Date('2026-11-20T17:30:00Z'), agora)).toBe('em 20/11 às 14h30');
  });
});

describe('quando o disparo começa de verdade', () => {
  // Expediente da KOMUNE: seg–sex 8h às 17h45; sábado só para quem respondeu.
  const faixas = [1, 2, 3, 4, 5].map((dow) => ({ dow, de: 8, ate: 17.75 }));
  const semFeriado = new Set<string>();
  // Quinta, 12/11/2026, 14h05 em Natal.
  const quinta = new Date('2026-11-12T17:05:00Z');

  it('dentro da faixa é na hora; depois das 17h45 é amanhã às 8h; sexta à noite, segunda', () => {
    expect(proximaAbertura(quinta, faixas, semFeriado)).toEqual(quinta);
    expect(proximaAbertura(new Date('2026-11-12T21:30:00Z'), faixas, semFeriado)).toEqual(
      new Date('2026-11-13T11:00:00Z'),
    );
    expect(proximaAbertura(new Date('2026-11-13T22:00:00Z'), faixas, semFeriado)).toEqual(
      new Date('2026-11-16T11:00:00Z'),
    );
    // Feriado na segunda: terça.
    expect(proximaAbertura(new Date('2026-11-13T22:00:00Z'), faixas, new Set(['2026-11-16']))).toEqual(
      new Date('2026-11-17T11:00:00Z'),
    );
  });

  it('"agora" fora da janela vira a próxima abertura que o banco disse', () => {
    const noite = new Date('2026-11-12T21:30:00Z');
    const abreEm = new Date('2026-11-13T11:00:00Z');
    expect(
      comecoDoEnvio({ agora: noite, inicio: null, janelaAberta: false, abreEm, faixas: null, feriados: semFeriado }),
    ).toEqual({ quando: abreEm, tipo: 'abertura' });
    expect(
      comecoDoEnvio({ agora: quinta, inicio: null, janelaAberta: true, abreEm: null, faixas, feriados: semFeriado }),
    ).toEqual({ quando: quinta, tipo: 'agora' });
    // Banco antigo, sem a janela: a tela faz a conta pelas faixas.
    expect(
      comecoDoEnvio({ agora: noite, inicio: null, janelaAberta: null, abreEm: null, faixas, feriados: semFeriado }),
    ).toEqual({ quando: abreEm, tipo: 'abertura' });
  });

  it('agendado fora da faixa empurra para a abertura seguinte; dentro, fica', () => {
    const agendadoNoite = new Date('2026-11-13T23:00:00Z');
    expect(
      comecoDoEnvio({ agora: quinta, inicio: agendadoNoite, janelaAberta: true, abreEm: null, faixas, feriados: semFeriado }),
    ).toEqual({ quando: new Date('2026-11-16T11:00:00Z'), tipo: 'abertura' });
    const agendadoManha = new Date('2026-11-13T12:00:00Z');
    expect(
      comecoDoEnvio({ agora: quinta, inicio: agendadoManha, janelaAberta: true, abreEm: null, faixas, feriados: semFeriado }),
    ).toEqual({ quando: agendadoManha, tipo: 'agendado' });
  });
});

describe('a frase-resumo da barra de enviar', () => {
  const agora = new Date('2026-11-12T17:05:00Z');

  it('para quantos, em nome de quem e quando começa de verdade', () => {
    expect(fraseDoResumo({ pessoas: 3, comeco: { quando: agora, tipo: 'agora' }, assinatura: 'marca', agora })).toBe(
      `Vai para 3 pessoas, agora, em nome da ${EMPRESA.nome}.`,
    );
    expect(
      fraseDoResumo({
        pessoas: 1,
        comeco: { quando: new Date('2026-11-13T12:00:00Z'), tipo: 'agendado' },
        assinatura: 'eu',
        agora,
      }),
    ).toBe('Vai para 1 pessoa, assinada por você. Começa a sair amanhã às 9h.');
    expect(
      fraseDoResumo({
        pessoas: 2000,
        comeco: { quando: new Date('2026-11-13T11:00:00Z'), tipo: 'abertura' },
        assinatura: 'revezar',
        agora,
      }),
    ).toBe('Vai para 2.000 pessoas, dividida entre atendentes. Começa a sair amanhã às 8h, quando abre o horário de envio.');
    expect(fraseDoResumo({ pessoas: 0, comeco: { quando: agora, tipo: 'agora' }, assinatura: 'marca', agora })).toMatch(
      /^Ninguém/,
    );
  });

  it('8. o que cabe hoje desconta a fila dos outros disparos, igual ao "próximo dia útil"', () => {
    const limite = { teto: 2000, sobra: 1997, naFila: 0 };
    expect(
      semNbsp(
        detalheDoResumo({ custo: 1.02, duracao: 'cerca de 3 min', limite, abrem: 3, comecaHoje: true, deFora: 0 }),
      ),
    ).toBe('≈ R$ 1,02 na Meta · leva cerca de 3 min · hoje ainda cabem 1.997 de 2.000');
    // 1.000 sobram, 700 já na fila de outros disparos: cabem 300, e 200 dos 500 ficam para depois.
    expect(
      detalheDoResumo({
        custo: 0,
        duracao: '—',
        limite: { teto: 2000, sobra: 1000, naFila: 700 },
        abrem: 500,
        comecaHoje: true,
        deFora: 1,
      }),
    ).toBe('grátis na Meta · hoje ainda cabem 300 de 2.000 · 200 ficam para o próximo dia útil · 1 da lista fica de fora');
    // Começa amanhã: o "hoje" não vale; conta o limite cheio menos a fila.
    expect(
      detalheDoResumo({
        custo: null,
        duracao: null,
        limite: { teto: 2000, sobra: 0, naFila: 1500 },
        abrem: 600,
        comecaHoje: false,
        deFora: 0,
      }),
    ).toBe('100 ficam para o dia útil seguinte');
    expect(
      detalheDoResumo({ custo: null, duracao: null, limite: null, abrem: 0, comecaHoje: true, deFora: 0 }),
    ).toBe('');
  });

  it('os motivos novos da lista têm frase', () => {
    expect(fraseDoMotivo('numero_suprimido')).toMatch(/não receber/);
    expect(fraseDaRecusa('lista_invalida')).toMatch(/500/);
    expect(fraseDaRecusa('sem_origem')).toMatch(/origem/);
    expect(fraseDoMotivo('conversa_bloqueada')).toMatch(/bloqueada/);
  });
});
