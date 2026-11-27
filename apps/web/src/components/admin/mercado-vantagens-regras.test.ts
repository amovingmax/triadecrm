import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { FonteDeMercado } from './mercado-regras';
import {
  avisoDePortalNoTexto,
  baseDaConta,
  consequenciaDeAprovar,
  consequenciaDeReprovar,
  dataCurta,
  deOndeVeio,
  detalheDaSituacao,
  fraseDaRecusaDaVantagem,
  hojeEmNatal,
  iaUsaComClientes,
  lerParaIa,
  marcasNaTela,
  momentosNaTela,
  motivosDaVolta,
  numerosNaTela,
  oQueMudou,
  porImovel,
  propostasTravadas,
  quandoAIaRecebe,
  quandoAIaUsa,
  quemMudouAChaveDaIa,
  resumoDaAprovacao,
  resumoDoImovel,
  resumoDoQueAIaRecebe,
  rotuloDeAprovar,
  situacaoDaVantagem,
  temConferencia,
  textoDoVazio,
  tituloCurto,
  totalParaAprovar,
  validadeNaTela,
  type ExecucaoDoMotor,
  type VantagemDoMercado,
  paraQuemServe,
} from './mercado-vantagens-regras';

const HOJE = '2026-11-19';

function vantagem(extra: Partial<VantagemDoMercado> = {}): VantagemDoMercado {
  return {
    id: 'v1',
    imovel_codigo: 'TE0003',
    chave: 'T1.area',
    regra: 'T1',
    eixo: 'tamanho',
    forca: 'B',
    texto:
      'Dos 92 terrenos fora de condomínio à venda em Parnamirim, fora das praias, que acompanhamos em novembro, 81 tinham menos de 10.000 m².',
    fonte_texto: 'pelos anúncios da região que acompanhamos neste mês',
    numeros: { nosso: 10000, comparados: 92, menores: 81, referencia: 750 },
    prova: {
      anuncios: Array.from({ length: 92 }, (_, i) => `a-${i}`),
      itens: [],
      conjunto: 'terrenos avulsos à venda em Parnamirim urbano, sem condomínio, sem repetidos',
    },
    fontes: ['chavesnamao-mcp', 'lopes'],
    data_dado: '2026-11-17',
    coletado_em: '2026-11-19T12:00:00Z',
    valido_ate: '2026-12-03',
    momentos: ['apresentacao', 'retomada'],
    objecoes: ['tamanho'],
    explica_preco: false,
    so_com_preco_dito: false,
    aviso: null,
    marcas: [],
    status: 'proposto',
    motivo_status: null,
    aprovado_por: null,
    aprovado_em: null,
    aprovado_numeros: null,
    aprovado_texto: null,
    renovacoes: 0,
    renovado_em: null,
    ultima_versao_em: null,
    recusado_por: null,
    recusado_em: null,
    criado_em: '2026-11-19T12:00:00Z',
    atualizado_em: '2026-11-19T12:00:00Z',
    ...extra,
  };
}

function fonte(id: string, grupo: FonteDeMercado['grupo'], nome: string): FonteDeMercado {
  return {
    id,
    nome,
    grupo,
    tipo_de_dado: null,
    veredito: 'PERMITIDA',
    condicoes: [],
    reconferir: false,
    liberada: true,
    liberada_por: null,
    liberada_em: null,
    liberada_motivo: null,
    pode_coletar: true,
    frequencia: 'rodada',
    coletor: 'x',
  };
}

const FONTES: FonteDeMercado[] = [
  fonte('chavesnamao-mcp', 'anuncios', 'Chaves na Mão, servidor MCP oficial'),
  fonte('lopes', 'anuncios', 'Lopes (rede de imobiliárias), páginas públicas'),
  fonte('ibge', 'oficiais', 'IBGE (Censo 2022, malha de setores, CNEFE, APIs)'),
  fonte('fipezap-planilha', 'oficiais', 'Índice FipeZAP, planilha e informes da Fipe'),
];

const nomes = new Map([['p1', 'Rafael']]);
const nomeDe = (id: string) => nomes.get(id) ?? null;

describe('a situação de cada vantagem', () => {
  it('proposta, aprovada, renovada sozinha, vencida e reprovada', () => {
    expect(situacaoDaVantagem(vantagem(), HOJE)).toBe('proposta');
    expect(situacaoDaVantagem(vantagem({ status: 'aprovado' }), HOJE)).toBe('aprovada');
    expect(situacaoDaVantagem(vantagem({ status: 'aprovado', renovacoes: 2 }), HOJE)).toBe(
      'renovada',
    );
    expect(situacaoDaVantagem(vantagem({ status: 'vencido' }), HOJE)).toBe('vencida');
    expect(situacaoDaVantagem(vantagem({ status: 'recusado' }), HOJE)).toBe('reprovada');
  });

  it('passou da validade é vencida antes mesmo da rotina da madrugada', () => {
    expect(
      situacaoDaVantagem(vantagem({ status: 'aprovado', valido_ate: '2026-11-18' }), HOJE),
    ).toBe('vencida');
    // O último dia ainda vale (a IA lê `valido_ate >= hoje`).
    expect(situacaoDaVantagem(vantagem({ status: 'aprovado', valido_ate: HOJE }), HOJE)).toBe(
      'aprovada',
    );
    // Reprovada continua reprovada, mesmo vencida.
    expect(
      situacaoDaVantagem(vantagem({ status: 'recusado', valido_ate: '2026-11-01' }), HOJE),
    ).toBe('reprovada');
  });

  it('a frase diz quem aprovou, por que voltou, por que venceu e o motivo da reprovação', () => {
    const aprovada = vantagem({
      status: 'aprovado',
      aprovado_por: 'p1',
      aprovado_em: '2026-11-19T15:00:00Z',
    });
    expect(detalheDaSituacao(aprovada, 'aprovada', HOJE, nomeDe)).toBe(
      'Aprovada por Rafael em 19/11. A IA já pode usar.',
    );

    const renovada = vantagem({
      status: 'aprovado',
      aprovado_por: 'p9',
      aprovado_em: '2026-11-19T15:00:00Z',
      renovacoes: 1,
      ultima_versao_em: '2026-11-23T10:00:00Z',
    });
    expect(detalheDaSituacao(renovada, 'renovada', HOJE, nomeDe)).toBe(
      'Aprovada por alguém da equipe em 19/11 e renovada sozinha em 23/11: só os números mudaram, até 10%.',
    );
    expect(detalheDaSituacao({ ...renovada, renovacoes: 3 }, 'renovada', HOJE, nomeDe)).toContain(
      'renovada sozinha 3 vezes, a última em 23/11',
    );

    const voltou = vantagem({
      aprovado_em: '2026-11-19T15:00:00Z',
      motivo_status: 'renovacao_negada: numero_mudou_mais_de_10%, ficha_do_imovel_mudou',
      atualizado_em: '2026-11-23T10:00:00Z',
    });
    expect(detalheDaSituacao(voltou, 'proposta', HOJE, nomeDe)).toBe(
      'Voltou para aprovação em 23/11: um número mudou mais de 10% desde a última versão e a ficha do imóvel mudou (preço, área ou bairro).',
    );

    expect(detalheDaSituacao(vantagem(), 'proposta', HOJE, nomeDe)).toBe(
      'O motor propôs em 19/11. Só vai para a IA depois da aprovação.',
    );

    const saiu = vantagem({
      status: 'vencido',
      motivo_status: 'saiu_do_motor',
      atualizado_em: '2026-11-23T10:00:00Z',
    });
    expect(detalheDaSituacao(saiu, 'vencida', HOJE, nomeDe)).toBe(
      'Saiu da IA em 23/11: na última coleta ela não passou mais nas regras.',
    );
    expect(
      detalheDaSituacao(
        vantagem({ status: 'vencido', valido_ate: '2026-11-15' }),
        'vencida',
        HOJE,
        nomeDe,
      ),
    ).toBe('Venceu em 15/11 e não vai mais para a IA. A próxima coleta refaz a conta.');

    const reprovada = vantagem({
      status: 'recusado',
      recusado_por: 'p1',
      recusado_em: '2026-11-19T16:00:00Z',
      motivo_status: 'Prefiro não falar de estrangeiros.',
    });
    expect(detalheDaSituacao(reprovada, 'reprovada', HOJE, nomeDe)).toBe(
      'Reprovada por Rafael em 19/11: “Prefiro não falar de estrangeiros.”',
    );
  });

  it('cada motivo de volta vira frase; o desconhecido não aparece cru', () => {
    expect(motivosDaVolta(null)).toEqual([]);
    expect(motivosDaVolta('devolvida pela gestão')).toEqual([]);
    expect(
      motivosDaVolta(
        'renovacao_negada: texto_mudou, numero_mudou_mais_de_20%_desde_a_aprovacao, coisa_nova',
      ),
    ).toEqual([
      'a frase mudou além dos números',
      'um número mudou mais de 20% desde a aprovação',
      'os dados mudaram',
    ]);
  });
});

describe('a prova', () => {
  it('os números vêm em ordem, com rótulo simples e número em português', () => {
    expect(numerosNaTela(vantagem().numeros)).toEqual([
      { chave: 'comparados', rotulo: 'Comparados', valor: '92' },
      { chave: 'menores', rotulo: 'Menores que este', valor: '81' },
      { chave: 'nosso', rotulo: 'Deste imóvel', valor: '10.000' },
      { chave: 'referencia', rotulo: 'Referência', valor: '750' },
    ]);
    // Chave desconhecida ganha rótulo legível; o que não é número fica de fora.
    expect(numerosNaTela({ renda_media_bairro: 8234.5, nome: 'x', vazio: null })).toEqual([
      { chave: 'renda_media_bairro', rotulo: 'Renda media bairro', valor: '8.234,5' },
    ]);
    expect(numerosNaTela({ numero_2: 12 })).toEqual([
      { chave: 'numero_2', rotulo: 'Número 2', valor: '12' },
    ]);
    expect(numerosNaTela(null)).toEqual([]);
  });

  it('de onde veio: os sites de anúncio são contados, nunca nomeados', () => {
    const frase = deOndeVeio(vantagem(), FONTES);
    expect(frase).toBe('92 anúncios à venda de 2 sites liberados');
    expect(frase).not.toMatch(/chaves|lopes/i);
    expect(deOndeVeio(vantagem({ fontes: ['ibge'], prova: {} }), FONTES)).toBe('IBGE');
    expect(deOndeVeio(vantagem({ fontes: ['fipezap-planilha'], prova: {} }), FONTES)).toBe(
      'Índice de preços de imóveis da Fipe',
    );
    expect(deOndeVeio(vantagem({ fontes: [], prova: {} }), FONTES)).toBe('a ficha do imóvel');
    expect(
      deOndeVeio(
        vantagem({ fontes: ['chavesnamao-mcp', 'ibge'], prova: { anuncios: ['a'] } }),
        FONTES,
      ),
    ).toBe('1 anúncio à venda de 1 site liberado e IBGE');
  });

  it('a base da conta passa pela limpeza de nome de portal', () => {
    expect(baseDaConta(vantagem())).toBe(
      'terrenos avulsos à venda em Parnamirim urbano, sem condomínio, sem repetidos',
    );
    expect(
      baseDaConta(vantagem({ prova: { conjunto: 'confirmado pelo informe FipeZAP de outubro' } })),
    ).toBe('confirmado pelo informe índice de preços da Fipe de outubro');
    expect(baseDaConta(vantagem({ prova: { conjunto: 'anúncios do ZAP' } }))).toBeNull();
    expect(baseDaConta(vantagem({ prova: null }))).toBeNull();
  });

  it('a validade e as datas puras não escorregam de dia', () => {
    expect(validadeNaTela('2026-12-03', HOJE)).toBe('Vale até 03/12');
    expect(validadeNaTela('2027-11-17', HOJE)).toBe('Vale até 17/11/2027');
    expect(validadeNaTela(HOJE, HOJE)).toBe('Vale até hoje');
    expect(validadeNaTela('2026-11-15', HOJE)).toBe('Venceu em 15/11');
    expect(dataCurta('2022-08-01', HOJE)).toBe('01/08/2022');
    // 23h de Natal do dia 19 já é dia 20 em UTC: o "hoje" é o de Natal.
    expect(hojeEmNatal(new Date('2026-11-20T02:00:00Z'))).toBe('2026-11-19');
  });

  it('marca que trava a aprovação é dita, e conferir não trava', () => {
    expect(
      marcasNaTela(['conferir', 'salto', 'marca_desconhecida']).map((m) => [m.marca, m.trava]),
    ).toEqual([
      ['conferir', false],
      ['salto', false],
    ]);
    expect(
      marcasNaTela(['contestado', 'quarentena', 'possivel_mesmo_imovel']).every((m) => m.trava),
    ).toBe(true);
  });

  it('texto com nome ligado a portal ganha aviso, sem repetir o nome', () => {
    const fipe = vantagem({
      texto: 'Como fato do passado, pelo índice FipeZAP de Natal, o preço subiu 7,7%.',
    });
    const aviso = avisoDePortalNoTexto(fipe);
    expect(aviso).toContain('portal de anúncios');
    expect(aviso).not.toMatch(/zap/i);
    expect(avisoDePortalNoTexto(vantagem())).toBeNull();
  });
});

describe('o que mudou desde a última aprovação', () => {
  const voltou = vantagem({
    aprovado_em: '2026-11-19T15:00:00Z',
    aprovado_numeros: { nosso: 10000, comparados: 92, menores: 81, referencia: 750 },
    aprovado_texto:
      'Dos 92 terrenos fora de condomínio à venda em Parnamirim, fora das praias, que acompanhamos em novembro, 81 tinham menos de 10.000 m².',
    numeros: { nosso: 10000, comparados: 104, menores: 95, referencia: 750 },
    texto:
      'Dos 104 terrenos fora de condomínio à venda em Parnamirim, fora das praias, que acompanhamos em novembro, 95 tinham menos de 10.000 m².',
    motivo_status: 'renovacao_negada: numero_mudou_mais_de_10%',
  });

  it('mostra cada número que mudou, com a variação, e a frase aprovada', () => {
    const m = oQueMudou(voltou, 'proposta');
    expect(m?.desde).toBe('19/11');
    expect(m?.numeros).toEqual([
      { rotulo: 'Comparados', antes: '92', agora: '104', variacao: '+13%' },
      { rotulo: 'Menores que este', antes: '81', agora: '95', variacao: '+17%' },
    ]);
    expect(m?.textoAntes).toContain('Dos 92 terrenos');
  });

  it('número que some ou aparece também conta', () => {
    const m = oQueMudou(
      vantagem({
        status: 'aprovado',
        renovacoes: 1,
        aprovado_em: '2026-11-19T15:00:00Z',
        aprovado_numeros: { comparados: 30, antigo: 4 },
        aprovado_texto: vantagem().texto,
        numeros: { comparados: 31, novo: 2 },
      }),
      'renovada',
    );
    expect(m?.numeros).toEqual([
      { rotulo: 'Comparados', antes: '30', agora: '31', variacao: '+3%' },
      { rotulo: 'Antigo', antes: '4', agora: null, variacao: null },
      { rotulo: 'Novo', antes: null, agora: '2', variacao: null },
    ]);
    expect(m?.textoAntes).toBeNull();
  });

  it('nada a mostrar: nunca aprovada, aprovada sem mudança, ou reprovada', () => {
    expect(oQueMudou(vantagem(), 'proposta')).toBeNull();
    expect(
      oQueMudou(
        vantagem({
          status: 'aprovado',
          aprovado_em: '2026-11-19T15:00:00Z',
          aprovado_numeros: vantagem().numeros,
          aprovado_texto: vantagem().texto,
        }),
        'aprovada',
      ),
    ).toBeNull();
    expect(oQueMudou(voltou, 'reprovada')).toBeNull();
  });
});

describe('quando a IA usa', () => {
  it('momentos e deixas do cliente viram rótulos curtos, na ordem do banco', () => {
    expect(momentosNaTela(vantagem())).toEqual([
      'Ao apresentar o imóvel',
      'Retomada de 24 h',
      'Pergunta do tamanho',
    ]);
    expect(
      momentosNaTela(vantagem({ momentos: [], objecoes: ['caro'], so_com_preco_dito: true })),
    ).toEqual(['Acha caro', 'Só depois de dizer o preço']);
    expect(quandoAIaUsa(vantagem({ momentos: [], objecoes: [] }))).toBe(
      'Se o assunto aparecer na conversa',
    );
    expect(quandoAIaUsa(vantagem({ momentos: ['desconhecido'], objecoes: [] }))).toBe(
      'Se o assunto aparecer na conversa',
    );
    expect(quandoAIaUsa(vantagem())).toBe(
      'Ao apresentar o imóvel · Retomada de 24 h · Pergunta do tamanho',
    );
  });

  it('a chave "IA usa as vantagens com clientes" nasce desligada', () => {
    expect(iaUsaComClientes(null)).toBe(false);
    expect(iaUsaComClientes({ ligado: true })).toBe(false);
    expect(iaUsaComClientes({ ia_clientes: 'false' })).toBe(false);
    expect(iaUsaComClientes({ ia_clientes: true })).toBe(true);
    expect(iaUsaComClientes({ ia_clientes: 'true' })).toBe(true);
  });

  it('diz quem ligou ou desligou a chave da IA, quando e por quê', () => {
    expect(quemMudouAChaveDaIa({ ia_clientes: false }, nomeDe)).toBeNull();
    expect(
      quemMudouAChaveDaIa(
        {
          ia_clientes: true,
          ia_clientes_mudou_por: 'p1',
          ia_clientes_mudou_em: '2026-11-25T13:00:00Z',
          ia_clientes_motivo: 'Testei no treino e aprovei.',
        },
        nomeDe,
      ),
    ).toBe('Ligada por Rafael em 25/11: “Testei no treino e aprovei.”');
    expect(
      quemMudouAChaveDaIa(
        {
          ia_clientes: 'false',
          ia_clientes_mudou_por: 'p9',
          ia_clientes_mudou_em: '2026-11-26T13:00:00Z',
        },
        nomeDe,
      ),
    ).toBe('Desligada por alguém da equipe em 26/11.');
  });

  it('o aviso diz se é só no treino, com clientes, ou nada', () => {
    expect(quandoAIaRecebe({ coletaLigada: true, iaClientes: false }).titulo).toBe(
      'Por enquanto, só nas conversas de treino',
    );
    expect(quandoAIaRecebe({ coletaLigada: true, iaClientes: false }).texto).toContain(
      '“IA usa as vantagens com clientes”',
    );
    expect(quandoAIaRecebe({ coletaLigada: true, iaClientes: true }).titulo).toBe(
      'A IA usa as vantagens com os clientes',
    );
    expect(quandoAIaRecebe({ coletaLigada: false, iaClientes: true }).titulo).toBe(
      'Hoje a IA não recebe nenhuma vantagem',
    );
  });
});

describe('por imóvel', () => {
  const execucoes: ExecucaoDoMotor[] = [
    { imovel_codigo: 'TE0003', executado_em: '2026-11-19T12:00:00Z', nao_use: ['m² comparado'] },
    { imovel_codigo: 'TE0003', executado_em: '2026-11-16T12:00:00Z', nao_use: ['velho'] },
    { imovel_codigo: 'CA0002', executado_em: '2026-11-19T12:00:00Z', nao_use: ['financiamento'] },
  ];
  const lista = [
    vantagem({ id: 'a', imovel_codigo: 'TE0005', chave: 'D1.parque', status: 'aprovado' }),
    vantagem({ id: 'b', imovel_codigo: 'TE0005', chave: 'C2.estrangeiros', status: 'recusado' }),
    vantagem({ id: 'c', imovel_codigo: 'TE0003', chave: 'T1.area' }),
    vantagem({ id: 'd', imovel_codigo: 'TE0003', chave: 'A0.forte', forca: 'A' }),
    vantagem({ id: 'e', imovel_codigo: 'TE0003', chave: 'C1.velha', status: 'vencido' }),
  ];
  const imoveis = porImovel(
    lista,
    execucoes,
    [{ codigo: 'TE0003', titulo: 'Terreno de 10.000 m² na BONOR' }],
    HOJE,
  );

  it('quem tem proposta vem primeiro; o imóvel sem vantagem também aparece', () => {
    expect(imoveis.map((i) => i.codigo)).toEqual(['TE0003', 'TE0005', 'CA0002']);
    expect(imoveis[0]?.titulo).toBe('Terreno de 10.000 m² na BONOR');
    expect(imoveis[1]?.titulo).toBe('Imóvel sem título no CRM');
    expect(totalParaAprovar(imoveis)).toBe(2);
  });

  it('separa propostas (a mais forte antes), em uso e fora; o "não diga" é o da última conta', () => {
    const te3 = imoveis[0]!;
    expect(te3.propostas.map((x) => x.v.id)).toEqual(['d', 'c']);
    expect(te3.fora.map((x) => x.v.id)).toEqual(['e']);
    expect(te3.naoDiga).toEqual(['m² comparado']);
    expect(te3.ultimaConta).toBe('2026-11-19T12:00:00Z');
    expect(resumoDoImovel(te3)).toBe('2 para aprovar');
    expect(resumoDoImovel(imoveis[1]!)).toBe('1 aprovada');
    expect(resumoDoImovel(imoveis[2]!)).toBe('Nenhuma vantagem nesta conta');
    expect(rotuloDeAprovar(te3)).toBe('Aprovar as vantagens deste imóvel');
  });

  it('o título longo é cortado no espaço', () => {
    expect(
      tituloCurto(
        'Repasse da loja de plantas na Av. Praia de Pirangi (Ponta Negra), com estoque e clientela',
        40,
      ),
    ).toBe('Repasse da loja de plantas na Av. Praia…');
    expect(tituloCurto('  Casa  de 2 quartos ')).toBe('Casa de 2 quartos');
  });
});

describe('aprovar e reprovar', () => {
  const base = porImovel(
    [
      vantagem({ id: 'a', chave: 'T1.area', valido_ate: '2026-12-03' }),
      vantagem({ id: 'b', chave: 'P3.preco', valido_ate: '2026-12-01', marcas: ['conferir'] }),
      vantagem({ id: 'c', chave: 'R1.raro', marcas: ['contestado'] }),
    ],
    [],
    [],
    HOJE,
  )[0]!;

  it('a consequência conta para onde vai, quando sai e a renovação de até 10%', () => {
    const treino = consequenciaDeAprovar(base, {
      coletaLigada: true,
      iaClientes: false,
      hoje: HOJE,
    });
    expect(treino[0]).toBe(
      'As 2 vantagens propostas deste imóvel passam a ir para a IA, por enquanto só nas conversas de treino.',
    );
    expect(treino[1]).toBe('Cada uma sai sozinha da IA quando vence; a primeira vence em 01/12.');
    expect(treino[2]).toContain('até 10%');
    expect(
      consequenciaDeAprovar(base, { coletaLigada: true, iaClientes: true, hoje: HOJE })[0],
    ).toContain('já na próxima mensagem aos clientes');
    expect(
      consequenciaDeAprovar(base, { coletaLigada: false, iaClientes: false, hoje: HOJE })[0],
    ).toContain('assim que a coleta for ligada');
  });

  it('a travada é avisada antes, e a de conferir pede a caixa', () => {
    expect(propostasTravadas(base)).toHaveLength(1);
    expect(propostasTravadas(base)[0]?.porque).toContain('marcou como errado');
    expect(temConferencia(base)).toBe(true);
  });

  it('reprovar conta que sai da IA na hora quando estava em uso', () => {
    expect(consequenciaDeReprovar('aprovada')[0]).toBe('A IA deixa de usar esta frase na hora.');
    expect(consequenciaDeReprovar('proposta')[0]).toBe('Esta frase não vai para a IA.');
  });

  it('as recusas do banco viram frases claras', () => {
    for (const motivo of [
      'vantagem_desconhecida',
      'so_proposta_se_aprova',
      'vencida',
      'ficha_do_imovel_mudou',
      'marca_bloqueia',
      'preco_bloqueado_par_sem_decisao',
      'precisa_confirmar_que_conferiu',
      'nada_a_recusar',
      'nada_a_voltar',
      'sem_permissao',
    ]) {
      const frase = fraseDaRecusaDaVantagem(motivo);
      expect(frase).not.toContain('_');
      expect(frase).not.toBe(fraseDaRecusaDaVantagem('outra_coisa'));
    }
    expect(fraseDaRecusaDaVantagem(null)).toBe(
      'O CRM recusou o pedido. Atualize a tela e tente de novo.',
    );
  });

  it('o resumo da aprovação diz quantas e quais ficaram esperando', () => {
    const r = resumoDaAprovacao(
      {
        ok: true,
        aprovadas: 1,
        naoAprovadas: [{ id: 'b', chave: 'P3.preco', motivo: 'precisa_confirmar_que_conferiu' }],
      },
      (id) => (id === 'b' ? 'Dos 43 apartamentos...' : null),
    );
    expect(r.titulo).toBe('1 vantagem aprovada');
    expect(r.foraDela).toEqual([
      {
        texto: 'Dos 43 apartamentos...',
        porque: fraseDaRecusaDaVantagem('precisa_confirmar_que_conferiu'),
      },
    ]);
    expect(resumoDaAprovacao({ ok: true, aprovadas: 0, naoAprovadas: [] }, () => null).titulo).toBe(
      'Nenhuma vantagem foi aprovada',
    );
  });
});

describe('o vazio e o que a IA recebe', () => {
  it('o vazio diz quando as vantagens aparecem', () => {
    expect(
      textoDoVazio({ coletaLigada: true, coletas: [], agora: new Date('2026-11-19T20:00:00Z') }),
    ).toBe(
      'Ainda não há vantagens propostas: a primeira coleta é segunda, 23/11, às 6h; as vantagens aparecem aqui depois dela.',
    );
    expect(
      textoDoVazio({
        coletaLigada: true,
        coletas: [{ fonte: 'lopes', inicio: '2026-11-23T09:01:00Z', fim: null, situacao: 'ok' }],
        agora: new Date('2026-11-23T12:00:00Z'),
      }),
    ).toContain('A última coleta foi segunda, 23/11, às 6h01');
    expect(textoDoVazio({ coletaLigada: false, coletas: [], agora: new Date() })).toContain(
      'a coleta está desligada',
    );
  });

  it('lê o JSON da IA sem confiar no formato', () => {
    const lista = lerParaIa({
      TE0005: {
        diferenciais: [
          {
            id: 'D1.parque',
            texto: 'O vizinho é o Parque Estadual Mata da Pipa.',
            fonte: 'pela ficha do imóvel',
            forca: 'B',
            valido_ate: '2027-11-19',
            momentos: ['apresentacao'],
            objecoes: ['regiao', 7],
            so_com_preco_dito: false,
          },
          { id: 'sem-texto' },
        ],
        nao_use: ['renda de quem mora lá', null],
        dados_de: '2022-08-01',
      },
      CA0003: { diferenciais: [] },
      lixo: 'x',
    });
    expect(lista).toEqual([
      {
        codigo: 'TE0005',
        diferenciais: [
          {
            id: 'D1.parque',
            texto: 'O vizinho é o Parque Estadual Mata da Pipa.',
            fonte: 'pela ficha do imóvel',
            forca: 'B',
            valido_ate: '2027-11-19',
            momentos: ['apresentacao'],
            objecoes: ['regiao'],
            so_com_preco_dito: false,
          },
        ],
        naoUse: ['renda de quem mora lá'],
        dadosDe: '2022-08-01',
      },
    ]);
    expect(resumoDoQueAIaRecebe(lista)).toBe('1 imóvel · 1 vantagem');
    expect(lerParaIa(null)).toEqual([]);
    expect(lerParaIa([])).toEqual([]);
  });
});

describe('nenhum nome de portal', () => {
  it('nenhum texto da tela de vantagens cita portal', () => {
    for (const arquivo of ['./mercado-vantagens-regras.ts', './painel-mercado-vantagens.tsx']) {
      const fonteDoArquivo = readFileSync(fileURLToPath(new URL(arquivo, import.meta.url)), 'utf8');
      // Os comentários podem explicar a regra; o que vai para a tela, não.
      const semComentarios = fonteDoArquivo
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      expect(semComentarios, arquivo).not.toMatch(/zap|olx|viva\s*-?\s*real|canal\s*-?\s*pro/i);
    }
  });
});

describe('para quem serve (regra 3 do dono, 27/11/2026)', () => {
  it('a mesma tabela que a IA lê; o preço serve a qualquer cliente', () => {
    expect(paraQuemServe({ chave: 'R1.vagas' })).toEqual(['Filhos e família', 'Morar']);
    expect(paraQuemServe({ chave: 'V1.valorizacao' })).toEqual(['Investimento']);
    expect(paraQuemServe({ chave: 'C1.veraneio' })).toEqual(['Casa de praia']);
    expect(paraQuemServe({ chave: 'P1.m2' })).toEqual([]);
  });
});
