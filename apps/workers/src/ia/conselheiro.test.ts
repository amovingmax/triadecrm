import { describe, expect, it } from 'vitest';

import { bancoFalso, type TabelasFalsas } from './banco-de-teste';
import { ErroDoModelo, RespostaIlegivelError, type PedidoAoModelo } from './cliente';
import {
  aconselharVendas,
  montarEntradaDoImovel,
  montarEntradaDoLead,
  semDadoPessoal,
  type EntradaDoLeadNoBanco,
} from './conselheiro';
import { clienteDuble, type OpcoesDoDuble } from './duble';
import { OrcamentoEsgotadoError, type ContextoDaIa } from './execucao';
import { ErroDeterministico, eDeterministico, tratarTrabalho } from './tarefas';

import type { LogFields, Logger } from '../lib/log';

/**
 * O CONSELHEIRO DE VENDAS DA IMOVA (09/11/2026), SEM REDE.
 *
 * O caminho inteiro com o banco de mentira e o dublê do modelo, nos dois alvos: a porta
 * de leitura, a pseudonimização na ida, o código fora da carteira descartado, o nome que
 * sai da situação e fica só o primeiro no falar, a gravação com o `ai_run` que pagou o
 * conselho — e o que não pode virar chamada paga.
 */

function loggerDeTeste(): {
  logger: Logger;
  linhas: { nivel: string; msg: string; campos: LogFields }[];
} {
  const linhas: { nivel: string; msg: string; campos: LogFields }[] = [];
  const escrever =
    (nivel: string) =>
    (msg: string, campos?: LogFields): void => {
      linhas.push({ nivel, msg, campos: campos ?? {} });
    };
  return {
    linhas,
    logger: {
      debug: escrever('debug'),
      info: escrever('info'),
      warn: escrever('warn'),
      error: escrever('error'),
    },
  };
}

const ORG = '11111111-1111-4111-8111-111111111111';
const CONTATO = '22222222-2222-4222-8222-222222222222';
const CONVERSA = '33333333-3333-4333-8333-333333333333';
const PERFIL = '99999999-9999-4999-8999-999999999999';

const DO_LEAD = {
  purpose: 'aconselhar_vendas',
  alvo: 'lead',
  conversation_id: CONVERSA,
  chave: `lead:${CONVERSA}:2026-11-09`,
};

const DO_IMOVEL = {
  purpose: 'aconselhar_vendas',
  alvo: 'imovel',
  codigo: 'TE0002_IMOVA',
  chave: 'imovel:TE0002_IMOVA:2026-11-09',
};

function tabelas(): TabelasFalsas {
  return {
    ai_runs: [],
    tasks: [],
    organizations: [
      { id: ORG, owner_id: PERFIL, name: 'Janio Ramalho', phone_e164: '+5584988776655' },
    ],
    contacts: [
      {
        id: CONTATO,
        full_name: 'Janio Ramalho',
        first_name: 'Janio',
        phone_e164: '+5584988776655',
        email: 'janio@exemplo.com.br',
        instagram_handle: null,
      },
    ],
    conversations: [
      {
        id: CONVERSA,
        organization_id: ORG,
        contact_id: CONTATO,
        peer_phone_e164: '+5584988776655',
        ai_summary: null,
        ai_intent: null,
        ai_confidence: null,
        bot_paused: false,
        assignee_id: PERFIL,
      },
    ],
    profiles: [{ id: PERFIL, is_active: true, role: 'admin', created_at: '2026-01-01' }],
  };
}

const CARTEIRA = [
  {
    codigo: 'TE0002_IMOVA',
    titulo: 'Apartamento de 3 quartos no Tirol',
    tipo: 'apartamento',
    negocio: 'venda',
    bairro: 'Tirol',
    quartos: 3,
    area: 98,
    preco_venda: 480000,
    preco_aluguel: null,
    condominio: 650,
  },
  {
    codigo: 'TE0005_IMOVA',
    titulo: 'Casa com piscina em Capim Macio',
    tipo: 'casa',
    negocio: 'venda_aluguel',
    bairro: 'Capim Macio',
    quartos: 4,
    area: 220,
    preco_venda: 890000,
    preco_aluguel: 6500,
    condominio: null,
  },
];

/** A entrada como `public.ia_conselheiro_lead_entrada` a devolve — o contrato que o worker consome. */
function entradaDoLead(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agora: '2026-11-09 10:00',
    organization_id: ORG,
    contact_id: CONTATO,
    conversa: {
      quem: 'Cliente',
      atitude: 'muito_interessado',
      antes_de_esfriar: null,
      etapa: 'Em atendimento',
      visita_marcada: null,
      dono: 'Ana Souza',
    },
    ficha: {
      resumo: 'Janio procura apartamento de 3 quartos no Tirol.',
      intencao: 'PEDIU_VISITA',
      score: 74,
      motivo: 'Pediu para ver o apartamento.',
      objecoes: [],
      perfil: { finalidade: 'compra', bairros: ['Tirol', 'Petrópolis'], quartos: 3 },
      proxima_acao: 'Combinar a visita',
    },
    sinais: [{ codigo: 'TE0002_IMOVA', origem: 'codigo_na_mensagem' }],
    carteira: CARTEIRA,
    compromissos_abertos: [
      { quem: 'equipe', o_que: 'Mandar as fotos da varanda', prazo: '08/11 18:00' },
    ],
    mensagens: [
      {
        de: 'cliente',
        quando: '08/11 18:40',
        texto:
          'Boa noite! Aqui é o Janio Ramalho, meu número é 84 98877-6655. Vi o TE0002_IMOVA, qual é o condomínio? Dá para visitar no sábado?',
      },
      {
        de: 'ia',
        quando: '08/11 18:41',
        texto: 'Boa noite, Janio! O condomínio é R$ 650. Vou te passar os horários de sábado.',
      },
    ],
    ...extras,
  };
}

/** A entrada como `public.ia_conselheiro_imovel_entrada` a devolve. */
function entradaDoImovel(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agora: '2026-11-09 07:00',
    imovel: {
      ...CARTEIRA[0],
      condominio: null,
      iptu: null,
      dias_no_ar: 46,
      descricao: 'Apartamento nascente, perto do Midway. Agende pelo (84) 99405-8888.',
    },
    numeros: {
      visualizacoes: 1840,
      contatos: 31,
      interessados: 5,
      muito: 2,
      visitas: 1,
      propostas: 0,
    },
    leads: [
      {
        nivel: 'muito',
        situacao: 'Visitou no sábado.',
        perguntas: ['condomínio'],
        objecoes: ['preco'],
        valor_max: 450000,
        pagamento: 'financiamento',
      },
      {
        nivel: 'interessado',
        situacao: 'Perguntou condomínio e vaga.',
        perguntas: ['condomínio', 'vaga de garagem'],
        objecoes: [],
        valor_max: null,
        pagamento: null,
      },
      {
        nivel: 'nivel_novo_do_banco',
        situacao: 'Fica de fora.',
        perguntas: [],
        objecoes: [],
        valor_max: null,
        pagamento: null,
      },
    ],
    perguntas_top: [
      { tema: 'condomínio', leads: 4 },
      { tema: 'vaga de garagem', leads: 2 },
    ],
    objecoes_top: [{ objecao: 'preco', leads: 3 }],
    ...extras,
  };
}

interface Montagem {
  entradaLead?: unknown;
  entradaImovel?: unknown;
  empresa?: string | null;
  duble?: OpcoesDoDuble;
  gravar?: (argumentos: Record<string, unknown>) => unknown;
  rpcs?: Record<string, (argumentos: Record<string, unknown>) => unknown>;
}

function montar(opcoes: Montagem = {}) {
  const leituras: { nome: string; argumentos: Record<string, unknown> }[] = [];
  const gravacoes: { nome: string; argumentos: Record<string, unknown> }[] = [];
  const gravar = opcoes.gravar ?? (() => ({ ok: true }));
  const banco = bancoFalso(tabelas(), {
    rpcs: {
      ia_conselheiro_lead_entrada: (argumentos) => {
        leituras.push({ nome: 'lead', argumentos });
        return 'entradaLead' in opcoes ? opcoes.entradaLead : entradaDoLead();
      },
      ia_conselheiro_imovel_entrada: (argumentos) => {
        leituras.push({ nome: 'imovel', argumentos });
        return 'entradaImovel' in opcoes ? opcoes.entradaImovel : entradaDoImovel();
      },
      ia_conselheiro_lead_gravar: (argumentos) => {
        gravacoes.push({ nome: 'lead', argumentos });
        return gravar(argumentos);
      },
      ia_conselheiro_imovel_gravar: (argumentos) => {
        gravacoes.push({ nome: 'imovel', argumentos });
        return gravar(argumentos);
      },
      ...opcoes.rpcs,
    },
  });
  const { logger, linhas } = loggerDeTeste();
  const duble = clienteDuble(opcoes.duble ?? {});
  const pedidos: PedidoAoModelo[] = [];
  const contexto: ContextoDaIa = {
    cliente: banco.cliente,
    modelo: {
      conversar: (pedido) => {
        pedidos.push(pedido);
        return duble.conversar(pedido);
      },
    },
    logger,
    empresa: opcoes.empresa === undefined ? 'imova' : opcoes.empresa,
  };
  return { banco, contexto, duble, leituras, gravacoes, pedidos, linhas };
}

type SaidaGravadaDoLead = {
  imoveis: { codigo: string; nivel: string; perguntas: string[] }[];
  perfil: Record<string, unknown>;
  situacao: string;
  falar: string;
  dadosInsuficientes: boolean;
};

describe('o conselheiro do cliente: o caminho feliz', () => {
  it('lê a porta, chama o Haiku 5.5 e grava o conselho com o ai_run que o pagou', async () => {
    const { banco, contexto, duble, leituras, gravacoes } = montar();

    const resultado = await tratarTrabalho(contexto, DO_LEAD);

    expect(resultado).toMatchObject({ proposito: 'aconselhar_vendas', feito: true });
    expect(duble.chamadas).toEqual(['conselheiro_lead']);
    expect(leituras).toEqual([{ nome: 'lead', argumentos: { p_conversation_id: CONVERSA } }]);

    const run = banco.tabelas.ai_runs?.[0] as Record<string, unknown> | undefined;
    expect(run?.purpose).toBe('aconselhar_vendas');
    expect(run?.model).toBe('claude-haiku-5-5');
    expect(run?.prompt_version).toBe('conselheiro-do-lead@v1');
    expect(run?.conversation_id).toBe(CONVERSA);
    expect(run?.organization_id).toBe(ORG);
    expect(run?.status).toBe('ok');
    expect(resultado.aiRunId).toBe(run?.id);

    expect(gravacoes).toHaveLength(1);
    const { nome, argumentos } = gravacoes[0]!;
    expect(nome).toBe('lead');
    expect(Object.keys(argumentos).sort()).toEqual(
      ['p_ai_run_id', 'p_conversation_id', 'p_prompt_version', 'p_saida'].sort(),
    );
    expect(argumentos.p_conversation_id).toBe(CONVERSA);
    expect(argumentos.p_ai_run_id).toBe(run?.id);
    expect(argumentos.p_prompt_version).toBe('conselheiro-do-lead@v1');

    const saida = argumentos.p_saida as SaidaGravadaDoLead;
    // Exatamente as chaves que a porta de escrita lê.
    expect(Object.keys(saida).sort()).toEqual(
      ['dadosInsuficientes', 'falar', 'imoveis', 'perfil', 'situacao'].sort(),
    );
    expect(Object.keys(saida.perfil).sort()).toEqual(
      ['bairros', 'finalidade', 'pagamento', 'quartos_min', 'tipos', 'valor_max'].sort(),
    );
    expect(saida.imoveis).toEqual([
      { codigo: 'TE0002_IMOVA', nivel: 'muito', perguntas: ['condomínio'] },
    ]);
    expect(saida.dadosInsuficientes).toBe(false);
    // O compromisso de 08/11 18:00 venceu antes de "agora": o falar começa por ele.
    expect(saida.falar).toMatch(/^Simulação: cumprir o compromisso vencido/);
  });

  it('a situação sai sem nome; o falar leva só o primeiro; ai_runs guarda os marcadores', async () => {
    const { banco, contexto, gravacoes } = montar();
    await tratarTrabalho(contexto, DO_LEAD);

    const saida = gravacoes[0]!.argumentos.p_saida as SaidaGravadaDoLead;
    expect(saida.situacao).not.toMatch(/Janio|Ramalho|\[\[/);
    expect(saida.situacao).toContain('o cliente disse');
    expect(saida.falar).toContain('responder Janio sobre TE0002_IMOVA');
    expect(saida.falar).not.toMatch(/Ramalho|\[\[/);
    expect(JSON.stringify(saida)).not.toMatch(/98877|6655|janio@/);
    // `ai_runs.output` guarda a saída como o modelo a viu (ADR-09).
    const output = JSON.stringify((banco.tabelas.ai_runs?.[0] as { output?: unknown }).output);
    expect(output).not.toContain('Janio');
    expect(output).toContain('[[NOME_');
  });

  it('ao modelo chegam a carteira e a conversa, sem nome, telefone nem o nome de quem assumiu', async () => {
    const { contexto, pedidos } = montar();
    await tratarTrabalho(contexto, DO_LEAD);

    const pedido = pedidos[0]!;
    expect(pedido.modelo).toBe('claude-haiku-5-5');
    expect(pedido.maxTokens).toBe(3000);
    expect(pedido.mensagem).toContain('agora: 09/11/2026 às 10:00');
    expect(pedido.mensagem).toContain(
      '- TE0002_IMOVA: Apartamento de 3 quartos no Tirol | apartamento',
    );
    // O `venda_aluguel` do Canal Pro chega ao prompt como o negócio dos dois.
    expect(pedido.mensagem).toContain('casa | à venda e para alugar | bairro Capim Macio');
    expect(pedido.mensagem).toContain(
      '- perfil: finalidade = compra; bairros = Tirol, Petrópolis; quartos = 3',
    );
    expect(pedido.mensagem).toContain('(prazo 08/11 às 18:00) — VENCIDO');
    expect(pedido.mensagem).toContain('- responsável: alguém da equipe assumiu a conversa');
    expect(pedido.mensagem).toContain('em 08/11 às 18:40 — cliente: Boa noite!');
    expect(pedido.mensagem).not.toMatch(/Janio|Ramalho|Ana Souza/);
    expect(pedido.mensagem).not.toMatch(/98877[-\s]?6655/);
  });

  it('código fora da carteira é descartado; caixa e repetição são acertadas', async () => {
    const { contexto, gravacoes, linhas } = montar({
      duble: {
        forcar: {
          conselheiro_lead: {
            imoveis: [
              { codigo: 'TE0002_IMOVA', nivel: 'muito', perguntas: ['condomínio', 'Condomínio'] },
              { codigo: 'XX9999_INVENTADO', nivel: 'interessado', perguntas: [] },
              { codigo: ' te0005_imova ', nivel: 'morno', perguntas: ['[[TELEFONE_1]]'] },
            ],
            perfil: {
              finalidade: 'compra',
              tipos: ['apartamento', 'apartamento'],
              bairros: ['Tirol', 'tirol'],
              quartos_min: 3,
              valor_max: 500000,
              pagamento: null,
            },
            situacao: '[[NOME_1]] pediu visita ao TE0002_IMOVA.',
            falar: 'Ligar para [[NOME_1]] no [[TELEFONE_1]] e mandar para [[EMAIL_1]].',
            dadosInsuficientes: false,
          },
        },
      },
    });
    const resultado = await tratarTrabalho(contexto, DO_LEAD);

    const saida = gravacoes[0]!.argumentos.p_saida as SaidaGravadaDoLead;
    expect(saida.imoveis.map((i) => i.codigo)).toEqual(['TE0002_IMOVA', 'TE0005_IMOVA']);
    expect(saida.imoveis[0]!.perguntas).toEqual(['condomínio']);
    expect(saida.imoveis[1]!.perguntas).toEqual(['O telefone']);
    expect(saida.perfil.tipos).toEqual(['apartamento']);
    expect(saida.perfil.bairros).toEqual(['Tirol']);
    expect(saida.situacao).toBe('O cliente pediu visita ao TE0002_IMOVA.');
    expect(saida.falar).toBe('Ligar para Janio no o telefone e mandar para o e-mail.');
    expect(resultado.detalhes).toMatchObject({ imoveis: 2, descartados: 1 });
    expect(linhas.some((l) => l.nivel === 'warn' && l.msg.includes('fora da carteira'))).toBe(true);
  });

  it('o log diz os números, mas não a situação nem o falar', async () => {
    const { contexto, linhas } = montar();
    await tratarTrabalho(contexto, DO_LEAD);
    const linha = linhas.find((l) => l.msg === 'o conselheiro aconselhou sobre o cliente');
    expect(linha?.campos).toMatchObject({ conversation_id: CONVERSA, imoveis: 1, alvo: 'lead' });
    expect(JSON.stringify(linhas)).not.toContain('Janio');
  });

  it('sem os ids na porta, a ficha e o telefone vêm da própria conversa', async () => {
    const semIds = entradaDoLead();
    delete semIds.organization_id;
    delete semIds.contact_id;
    const { banco, contexto, pedidos } = montar({ entradaLead: semIds });
    await tratarTrabalho(contexto, DO_LEAD);

    const run = banco.tabelas.ai_runs?.[0] as Record<string, unknown>;
    expect(run.organization_id).toBe(ORG);
    expect(pedidos[0]!.mensagem).not.toMatch(/Janio|98877[-\s]?6655/);
  });
});

describe('o conselheiro do imóvel: o caminho feliz', () => {
  it('lê a porta pelo código, chama o modelo e grava as sugestões', async () => {
    const { banco, contexto, duble, leituras, gravacoes, pedidos } = montar();

    const resultado = await tratarTrabalho(contexto, DO_IMOVEL);

    expect(resultado).toMatchObject({ proposito: 'aconselhar_vendas', feito: true });
    expect(duble.chamadas).toEqual(['conselheiro_imovel']);
    expect(leituras).toEqual([{ nome: 'imovel', argumentos: { p_codigo: 'TE0002_IMOVA' } }]);

    const run = banco.tabelas.ai_runs?.[0] as Record<string, unknown>;
    expect(run.purpose).toBe('aconselhar_vendas');
    expect(run.prompt_version).toBe('conselheiro-do-imovel@v1');
    expect(run.conversation_id).toBeNull();

    const { nome, argumentos } = gravacoes[0]!;
    expect(nome).toBe('imovel');
    expect(Object.keys(argumentos).sort()).toEqual(
      ['p_ai_run_id', 'p_codigo', 'p_prompt_version', 'p_saida'].sort(),
    );
    expect(argumentos.p_codigo).toBe('TE0002_IMOVA');
    expect(argumentos.p_ai_run_id).toBe(run.id);
    const saida = argumentos.p_saida as {
      sugestoes: { tipo: string; acao: string; porque: string }[];
      dadosInsuficientes: boolean;
    };
    expect(Object.keys(saida).sort()).toEqual(['dadosInsuficientes', 'sugestoes']);
    expect(saida.sugestoes).toHaveLength(3);
    expect(saida.sugestoes[0]).toMatchObject({
      tipo: 'fazer',
      porque: 'É a pergunta nº 1 (4 leads).',
    });
    expect(saida.sugestoes[1]!.acao).toContain('proprietário sobre o preço');

    // O telefone da descrição não vai ao modelo; o nível desconhecido fica de fora.
    const mensagem = pedidos[0]!.mensagem;
    expect(mensagem).not.toMatch(/99405[-\s]?8888/);
    expect(mensagem).not.toContain('Fica de fora');
    expect(mensagem).toContain('- visualizações no portal: 1.840');
  });
});

describe('o conselheiro: o que não vira chamada paga', () => {
  it('a porta que recusa termina o trabalho, com o motivo dela', async () => {
    for (const [payload, chave] of [
      [DO_LEAD, 'entradaLead'],
      [DO_IMOVEL, 'entradaImovel'],
    ] as const) {
      const { banco, contexto, duble, gravacoes } = montar({
        [chave]: { ok: false, motivo: 'sem_mensagem_nova' },
      });
      const resultado = await tratarTrabalho(contexto, payload);
      expect(resultado).toMatchObject({ feito: false, motivo: 'sem_mensagem_nova' });
      expect(duble.chamadas).toEqual([]);
      expect(banco.tabelas.ai_runs).toHaveLength(0);
      expect(gravacoes).toEqual([]);
    }
  });

  it('porta que devolve nada, ou recusa sem motivo, também termina', async () => {
    const nula = montar({ entradaLead: null });
    expect(await tratarTrabalho(nula.contexto, DO_LEAD)).toMatchObject({
      feito: false,
      motivo: 'sem_entrada',
    });
    const semMotivo = montar({ entradaImovel: { ok: false } });
    expect(await tratarTrabalho(semMotivo.contexto, DO_IMOVEL)).toMatchObject({
      feito: false,
      motivo: 'porta_recusou',
    });
    expect([...nula.duble.chamadas, ...semMotivo.duble.chamadas]).toEqual([]);
  });

  it('conversa sem mensagem e imóvel sem cliente conhecido não chamam o modelo', async () => {
    const semMensagem = montar({ entradaLead: entradaDoLead({ mensagens: [] }) });
    expect(await tratarTrabalho(semMensagem.contexto, DO_LEAD)).toMatchObject({
      feito: false,
      motivo: 'sem_mensagens',
    });
    const semLead = montar({
      entradaImovel: entradaDoImovel({ leads: [{ nivel: 'quente', situacao: null }] }),
    });
    expect(await tratarTrabalho(semLead.contexto, DO_IMOVEL)).toMatchObject({
      feito: false,
      motivo: 'sem_leads',
    });
    expect([...semMensagem.duble.chamadas, ...semLead.duble.chamadas]).toEqual([]);
  });

  it('entrada fora do contrato é determinística, sem chamar o modelo', async () => {
    for (const [payload, chave, torta] of [
      [DO_LEAD, 'entradaLead', entradaDoLead({ agora: '09/11/2026 10:00' })],
      [DO_LEAD, 'entradaLead', entradaDoLead({ mensagens: 'não é lista' })],
      [DO_IMOVEL, 'entradaImovel', entradaDoImovel({ imovel: null })],
    ] as const) {
      const { contexto, duble } = montar({ [chave]: torta });
      const erro = await tratarTrabalho(contexto, payload).catch((e: unknown) => e);
      expect(erro, JSON.stringify(torta).slice(0, 80)).toBeInstanceOf(ErroDeterministico);
      expect((erro as Error).message).toMatch(/fora do contrato/);
      expect(duble.chamadas).toEqual([]);
    }
  });

  it('payload fora do contrato é recusado, determinístico, sem ler o banco', async () => {
    const { contexto, leituras, duble } = montar();
    for (const torto of [
      { purpose: 'aconselhar_vendas', alvo: 'lead' },
      { purpose: 'aconselhar_vendas', alvo: 'lead', conversation_id: 'nao-e-uuid' },
      { purpose: 'aconselhar_vendas', alvo: 'imovel', codigo: '   ' },
      { purpose: 'aconselhar_vendas', alvo: 'bairro', codigo: 'Tirol' },
      { purpose: 'aconselhar_vendas', conversation_id: CONVERSA },
      { ...DO_LEAD, purpose: 'avaliar_atendimento' },
    ]) {
      const erro = await aconselharVendas(contexto, torto).catch((e: unknown) => e);
      expect(erro, JSON.stringify(torto)).toBeInstanceOf(ErroDeterministico);
      expect(eDeterministico(erro)).toBe(true);
    }
    await expect(
      tratarTrabalho(contexto, { purpose: 'aconselhar_vendas', alvo: 'lead' }),
    ).rejects.toBeInstanceOf(ErroDeterministico);
    expect(leituras).toEqual([]);
    expect(duble.chamadas).toEqual([]);
  });

  it('fora da Imova não lê nada e não chama o modelo', async () => {
    const { contexto, leituras, duble } = montar({ empresa: 'komune' });
    // Na KOMUNE o trabalho nem deveria nascer; se nascer, sai como "sem o que fazer".
    expect(await aconselharVendas(contexto, DO_LEAD)).toMatchObject({
      feito: false,
      motivo: 'so_na_imova',
    });
    expect(leituras).toEqual([]);
    expect(duble.chamadas).toEqual([]);
  });

  it('orçamento bloqueado: nenhuma chamada paga, a dívida é anotada com a chave', async () => {
    const { banco, contexto, duble, gravacoes } = montar({
      rpcs: { ia_pode_gastar: () => ({ pode: false, motivo: 'orcamento_esgotado' }) },
    });

    await expect(tratarTrabalho(contexto, DO_LEAD)).rejects.toThrow(OrcamentoEsgotadoError);

    expect(duble.chamadas).toEqual([]);
    expect(gravacoes).toEqual([]);
    expect((banco.tabelas.ai_runs?.[0] as { status?: string }).status).toBe('bloqueado');
    const adiados = banco.chamadasDeRpc.filter((c) => c.nome === 'ia_adiar_trabalho');
    expect(adiados).toHaveLength(1);
    expect(adiados[0]?.argumentos).toMatchObject({
      p_purpose: 'aconselhar_vendas',
      p_chave: DO_LEAD.chave,
      p_motivo: 'orcamento_esgotado',
    });
  });

  it('orçamento bloqueado no imóvel também vira dívida, não trabalho perdido', async () => {
    const { banco, contexto, duble } = montar({
      rpcs: { ia_pode_gastar: () => ({ pode: false, motivo: 'linha_de_alerta' }) },
    });
    const erro = await tratarTrabalho(contexto, DO_IMOVEL).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(OrcamentoEsgotadoError);
    expect(eDeterministico(erro)).toBe(true);
    expect(duble.chamadas).toEqual([]);
    expect(banco.chamadasDeRpc.filter((c) => c.nome === 'ia_adiar_trabalho')).toHaveLength(1);
  });
});

describe('o conselheiro: os erros do modelo e da gravação', () => {
  it('saída fora do schema não é gravada, e o ai_run guarda o erro', async () => {
    const { banco, contexto, gravacoes } = montar({
      duble: {
        forcar: {
          conselheiro_lead: {
            imoveis: [{ codigo: 'TE0002_IMOVA', nivel: 'quente', perguntas: [] }],
            perfil: {
              finalidade: null,
              tipos: [],
              bairros: [],
              quartos_min: null,
              valor_max: null,
              pagamento: null,
            },
            situacao: 'x',
            falar: 'y',
            dadosInsuficientes: false,
          },
        },
      },
    });
    const erro = await tratarTrabalho(contexto, DO_LEAD).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(RespostaIlegivelError);
    expect(gravacoes).toEqual([]);
    expect((banco.tabelas.ai_runs?.[0] as { status?: string }).status).toBe('erro');
  });

  it('saída do imóvel sem as sugestões também é recusada', async () => {
    const { contexto, gravacoes } = montar({
      duble: { forcar: { conselheiro_imovel: { dadosInsuficientes: false } } },
    });
    await expect(tratarTrabalho(contexto, DO_IMOVEL)).rejects.toBeInstanceOf(RespostaIlegivelError);
    expect(gravacoes).toEqual([]);
  });

  it('400 do modelo é determinístico; 429 volta para a fila', async () => {
    const recusa = montar({
      duble: { falharCom: () => new ErroDoModelo('400 schema inválido', 400, false) },
    });
    expect(await tratarTrabalho(recusa.contexto, DO_LEAD).catch((e: unknown) => e)).toBeInstanceOf(
      ErroDeterministico,
    );
    const limite = montar({
      duble: { falharCom: () => new ErroDoModelo('429 rate limit', 429, true) },
    });
    const erro = await tratarTrabalho(limite.contexto, DO_IMOVEL).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDoModelo);
    expect(eDeterministico(erro)).toBe(false);
    expect([...recusa.gravacoes, ...limite.gravacoes]).toEqual([]);
  });

  it('a gravação recusada é determinística, com o motivo do banco', async () => {
    const { contexto } = montar({
      gravar: () => ({ ok: false, motivo: 'conversa_nao_e_cliente' }),
    });
    const erro = await tratarTrabalho(contexto, DO_LEAD).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeterministico);
    expect((erro as Error).message).toContain('conversa_nao_e_cliente');
  });
});

describe('montarEntradaDoLead e montarEntradaDoImovel', () => {
  it('traduz a forma da porta e deixa de fora o que o prompt não conhece', () => {
    const e = {
      ...(entradaDoLead() as EntradaDoLeadNoBanco),
      conversa: {
        quem: 'Cliente',
        atitude: 'etiqueta_nova',
        antes_de_esfriar: 'morno',
        etapa: null,
        visita_marcada: '12/11 10:00',
        dono: null,
      },
      sinais: [
        { codigo: 'TE0005_IMOVA', origem: 'origem_nova' },
        { codigo: 'TE0005_IMOVA', origem: 'origem_nova' },
        { codigo: '  ', origem: 'portal' },
      ],
      compromissos_abertos: [
        { quem: 'cliente', o_que: 'Mandar os documentos', prazo: null },
        { quem: 'robo', o_que: 'Fica de fora', prazo: null },
        { quem: 'equipe', o_que: '   ', prazo: null },
      ],
      mensagens: [
        ...Array.from({ length: 45 }, (_, i) => ({
          de: i % 2 === 0 ? 'parceiro' : 'equipe',
          quando: '08/11 18:40',
          texto: `mensagem ${i + 1}`,
        })),
        { de: 'tipo_novo', quando: '08/11 18:41', texto: 'fica de fora' },
      ],
    } as EntradaDoLeadNoBanco;
    const entrada = montarEntradaDoLead(e, 'lead-abc123');

    expect(entrada.conversa).toEqual({
      quem: 'Cliente',
      atitude: null,
      antesDeEsfriar: null,
      etapa: null,
      visitaMarcada: '12/11 10:00',
      temDono: false,
    });
    expect(entrada.sinais).toEqual([{ codigo: 'TE0005_IMOVA', origem: 'outra' }]);
    // O imóvel ligado à pessoa vem primeiro na carteira.
    expect(entrada.carteira.map((i) => i.codigo)).toEqual(['TE0005_IMOVA', 'TE0002_IMOVA']);
    expect(entrada.carteira[0]).toMatchObject({
      negocio: 'venda_e_aluguel',
      precoAluguel: 6500,
      condominio: null,
    });
    expect(entrada.compromissosAbertos).toEqual([
      { quem: 'parceiro', oQue: 'Mandar os documentos', prazo: null },
    ]);
    expect(entrada.mensagens).toHaveLength(40);
    // As 40 mais novas; `parceiro` é o cliente.
    expect(entrada.mensagens[0]).toMatchObject({ de: 'equipe', texto: 'mensagem 6' });
    expect(entrada.mensagens.at(-1)).toMatchObject({ de: 'cliente', texto: 'mensagem 45' });
    expect(entrada.ficha?.perfil).toEqual([
      { campo: 'finalidade', valor: 'compra' },
      { campo: 'bairros', valor: 'Tirol, Petrópolis' },
      { campo: 'quartos', valor: '3' },
    ]);
  });

  it('ficha nula e listas ausentes viram a entrada mínima que o prompt aceita', () => {
    const entrada = montarEntradaDoLead(
      {
        agora: '2026-11-09 10:00',
        mensagens: [{ de: 'cliente', quando: '09/11 08:00', texto: null }],
      },
      'lead-0',
    );
    expect(entrada.ficha).toBeNull();
    expect(entrada.carteira).toEqual([]);
    expect(entrada.conversa.quem).toBe('não informado');
    expect(entrada.mensagens).toEqual([{ de: 'cliente', quando: '09/11 08:00', texto: '' }]);
  });

  it('no imóvel, contagem torta vira zero e o portal sem número fica null', () => {
    const entrada = montarEntradaDoImovel(
      {
        agora: '2026-11-09 07:00',
        imovel: { codigo: null, titulo: 'Casa', preco_venda: -1, dias_no_ar: 12.4 },
        numeros: { visualizacoes: null, interessados: -3, muito: 2.4 },
        leads: [{ nivel: 'morno', perguntas: ['', 'IPTU'], valor_max: Number.NaN }],
      },
      'TE0009_IMOVA',
    );
    expect(entrada.imovel.codigo).toBe('TE0009_IMOVA');
    expect(entrada.imovel.precoVenda).toBeNull();
    expect(entrada.imovel.diasNoAr).toBe(12);
    expect(entrada.numeros).toEqual({
      visualizacoes: null,
      contatos: null,
      interessados: 0,
      muito: 2,
      visitas: 0,
      propostas: 0,
    });
    expect(entrada.leads).toEqual([
      {
        nivel: 'morno',
        situacao: null,
        perguntas: ['IPTU'],
        objecoes: [],
        valorMax: null,
        pagamento: null,
      },
    ]);
  });
});

describe('semDadoPessoal', () => {
  const mapa = {
    leadId: 'lead-1',
    porMarcador: new Map([
      ['[[NOME_1]]', 'Janio Ramalho'],
      ['[[NOME_2]]', 'Janio'],
      ['[[TELEFONE_1]]', '84 98877-6655'],
      ['[[EMPRESA_1]]', 'Ramalho Empreendimentos'],
    ]),
  };

  it('sem o primeiro nome, todo dado vira expressão neutra, com a maiúscula do começo', () => {
    expect(semDadoPessoal('[[NOME_1]] ligou do [[TELEFONE_1]].', mapa, false)).toBe(
      'O cliente ligou do o telefone.',
    );
    expect(semDadoPessoal('Falou com [[EMPRESA_1]] e [[NOME_9]].', mapa, false)).toBe(
      'Falou com o cliente e o cliente.',
    );
  });

  it('com o primeiro nome, só ele volta; marcador que o modelo inventou não', () => {
    expect(semDadoPessoal('Responder [[NOME_1]] e [[NOME_2]].', mapa, true)).toBe(
      'Responder Janio e Janio.',
    );
    expect(semDadoPessoal('Ligar para [[NOME_7]].', mapa, true)).toBe('Ligar para o cliente.');
    expect(semDadoPessoal('[[NOME_1]], mande as fotos.', mapa, true)).toBe(
      'Janio, mande as fotos.',
    );
  });

  it('o marcador cortado ao meio pelo teto do texto não vai para a tela', () => {
    expect(semDadoPessoal('Mandar as fotos e ligar para [[NOM…', mapa, true)).toBe(
      'Mandar as fotos e ligar para…',
    );
    expect(semDadoPessoal('Mandar as fotos [[…', mapa, false)).toBe('Mandar as fotos…');
  });
});
