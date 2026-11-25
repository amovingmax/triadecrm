import { describe, expect, it } from 'vitest';

import { esquemaDeSaida, promptVigente } from '@komune/prompts';

import { bancoFalso, type TabelasFalsas } from './banco-de-teste';
import { ErroDoModelo, type PedidoAoModelo } from './cliente';
import { clienteDuble, fluxoDoEsquema, type OpcoesDoDuble } from './duble';
import type { ContextoDaIa } from './execucao';
import { montarEntradaDoResumo } from './resumo-da-passagem';
import { ErroDeterministico, eDeterministico, tratarTrabalho } from './tarefas';

import type { LogFields, Logger } from '../lib/log';

/**
 * O RESUMO DA PASSAGEM DA IMOVA (11/11/2026), SEM REDE.
 *
 * O caminho inteiro com o banco de mentira e o dublê do modelo: a porta de leitura, o
 * rótulo no lugar do uuid (e o uuid de volta nas provas), a pseudonimização na ida, o nome
 * de volta no texto do corretor, a gravação com o `ai_run` que pagou — e o que não pode
 * virar chamada paga nem atrasar a passagem.
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
const RESPOSTA = '44444444-4444-4444-8444-444444444444';
const PERFIL = '99999999-9999-4999-8999-999999999999';
const TAREFA = '55555555-5555-4555-8555-555555555555';
const mensagemId = (n: number): string => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PAYLOAD = {
  purpose: 'resumir_passagem',
  conversation_id: CONVERSA,
  resposta_id: RESPOSTA,
  chave: RESPOSTA,
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
        email: null,
        instagram_handle: null,
      },
    ],
    profiles: [{ id: PERFIL, is_active: true, role: 'admin', created_at: '2026-01-01' }],
  };
}

/** A entrada como `public.ia_resumo_da_passagem_entrada` a devolve. */
function entradaNoBanco(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    existe: true,
    passagem: true,
    resposta_id: RESPOSTA,
    conversation_id: CONVERSA,
    organization_id: ORG,
    contact_id: CONTATO,
    nome: 'Janio Ramalho',
    treino: false,
    teste: false,
    ja_resumida: false,
    motivo: 'o cliente pediu para falar com um corretor',
    agora_por_extenso: 'terça-feira, 10 de novembro, às 9h20',
    visitas: [],
    imoveis_citados: [{ codigo: 'AP0031_IMOVA', palavras: ['apartamento', 'ponta', 'negra'] }],
    mensagens: [
      {
        id: mensagemId(1),
        de: 'cliente',
        quem: null,
        quando: '10/11 09:12',
        texto: 'Bom dia! Aqui é o Janio Ramalho. Vi o AP0031_IMOVA, ainda está disponível?',
      },
      {
        id: mensagemId(2),
        de: 'ia',
        quem: null,
        quando: '10/11 09:12',
        texto: 'Bom dia, Janio! Está sim, R$ 590 mil. Quer conhecer?',
      },
      {
        id: mensagemId(3),
        de: 'cliente',
        quem: null,
        quando: '10/11 09:15',
        texto:
          'Quero comprar, meu teto é 600 mil e vou financiar. Me liga no 84 98877-6655. Dá para visitar sábado?',
      },
      {
        id: mensagemId(4),
        de: 'cliente',
        quem: null,
        quando: '10/11 09:20',
        texto: 'Quero falar com um corretor',
      },
      {
        id: mensagemId(5),
        de: 'ia',
        quem: null,
        quando: '10/11 09:20',
        texto: 'Certo! Já vou te passar para um dos nossos corretores.',
      },
    ],
    ...extras,
  };
}

function montar(
  entrada: Record<string, unknown> = entradaNoBanco(),
  empresa: string | null = 'imova',
  opcoesDoDuble: OpcoesDoDuble = {},
  rpcsExtras: Record<string, (argumentos: Record<string, unknown>) => unknown> = {},
) {
  const leituras: Record<string, unknown>[] = [];
  const gravacoes: Record<string, unknown>[] = [];
  const falhas: Record<string, unknown>[] = [];
  const banco = bancoFalso(tabelas(), {
    rpcs: {
      ia_resumo_da_passagem_entrada: (argumentos) => {
        leituras.push(argumentos);
        return entrada;
      },
      ia_resumo_da_passagem_gravar: (argumentos) => {
        gravacoes.push(argumentos);
        return { ok: true, id: 'r-1', task_id: TAREFA, descartados: [] };
      },
      ia_resumo_da_passagem_falhou: (argumentos) => {
        falhas.push(argumentos);
        return { ok: true };
      },
      ...rpcsExtras,
    },
  });
  const { logger, linhas } = loggerDeTeste();
  const duble = clienteDuble(opcoesDoDuble);
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
    empresa,
  };
  return { banco, contexto, duble, leituras, gravacoes, falhas, pedidos, linhas };
}

describe('o resumo da passagem: o caminho feliz', () => {
  it('o dublê reconhece o prompt pelo esquema', () => {
    expect(fluxoDoEsquema(esquemaDeSaida(promptVigente('resumo-da-passagem')))).toBe(
      'resumo_passagem',
    );
  });

  it('lê a passagem, chama o Haiku 5.5 uma vez e grava o resumo com o ai_run que o pagou', async () => {
    const { banco, contexto, duble, leituras, gravacoes, falhas } = montar();

    const resultado = await tratarTrabalho(contexto, PAYLOAD);

    expect(resultado).toMatchObject({ proposito: 'resumir_passagem', feito: true });
    expect(duble.chamadas).toEqual(['resumo_passagem']);
    expect(leituras).toEqual([{ p_resposta_id: RESPOSTA }]);
    expect(falhas).toEqual([]);

    const run = banco.tabelas.ai_runs?.[0] as Record<string, unknown> | undefined;
    expect(run?.purpose).toBe('summarize_deal');
    expect(run?.model).toBe('claude-haiku-5-5');
    expect(run?.prompt_version).toBe('resumo-da-passagem@v1');
    expect(run?.conversation_id).toBe(CONVERSA);
    expect(resultado.aiRunId).toBe(run?.id);

    expect(gravacoes).toHaveLength(1);
    const gravacao = gravacoes[0]!;
    expect(gravacao.p_resposta_id).toBe(RESPOSTA);
    expect(gravacao.p_ai_run_id).toBe(run?.id);
    expect(gravacao.p_prompt_version).toBe('resumo-da-passagem@v1');
  });

  it('as provas vão ao banco como o uuid da mensagem, com o trecho literal', async () => {
    const { contexto, gravacoes } = montar();
    await tratarTrabalho(contexto, PAYLOAD);
    const resumo = gravacoes[0]?.p_resumo as {
      procura: { negocio: unknown };
      imoveis: unknown[];
      orcamento: { valor: unknown; pagamento: unknown };
      temperatura: string | null;
    };
    expect(resumo.procura.negocio).toEqual({
      valor: 'compra',
      trecho: 'comprar',
      prova: mensagemId(3),
    });
    expect(resumo.imoveis).toEqual([
      { codigo: 'AP0031_IMOVA', prova: mensagemId(1), confirmacao: null },
    ]);
    expect(resumo.orcamento).toEqual({
      valor: { valor: 'até 600 mil', trecho: '600 mil', prova: mensagemId(3) },
      pagamento: { valor: 'financiamento', trecho: 'financiar', prova: mensagemId(3) },
    });
    expect(resumo.temperatura).toBe('quente');
  });

  it('o telefone e o nome não vão ao modelo; o nome volta no texto do corretor', async () => {
    const { banco, contexto, gravacoes, pedidos } = montar();
    await tratarTrabalho(contexto, PAYLOAD);

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.mensagem).not.toContain('Janio');
    expect(pedidos[0]?.mensagem).not.toMatch(/98877[-\s]?6655/);
    expect(pedidos[0]?.mensagem).toContain(
      'motivo registrado: o cliente pediu para falar com um corretor',
    );

    const porque = (gravacoes[0]?.p_resumo as { temperatura_porque: string }).temperatura_porque;
    // O dublê repete o primeiro marcador de nome que viu; a pessoa lê o nome de verdade.
    expect(porque).toContain('Janio');
    expect(porque).not.toMatch(/\[\[[A-Z]+_\d+\]\]/);
    // `ai_runs.output` guarda a saída como o modelo a viu (ADR-09).
    const output = JSON.stringify((banco.tabelas.ai_runs?.[0] as { output?: unknown }).output);
    expect(output).not.toContain('Janio');
  });

  it('o log diz o que foi dito, sem nome e sem o texto do resumo', async () => {
    const { contexto, linhas } = montar();
    await tratarTrabalho(contexto, PAYLOAD);
    const linha = linhas.find((l) => l.msg === 'a IA resumiu a passagem para o corretor');
    expect(linha?.campos).toMatchObject({
      resposta_id: RESPOSTA,
      temperatura: 'quente',
      disse: ['procura', 'imoveis', 'orcamento'],
      tarefa_avisada: true,
    });
    expect(JSON.stringify(linhas)).not.toContain('Janio');
  });

  it('o que o modelo disse sem prova não chega ao banco', async () => {
    const { contexto, gravacoes, linhas } = montar(entradaNoBanco(), 'imova', {
      forcar: {
        resumo_passagem: {
          procura: {
            negocio: null,
            // m2 é da IA: o que ela disse do anúncio não é o que o cliente procura.
            tipo: { valor: 'apartamento', trecho: 'Está sim', prova: 'm2' },
            // "Quero falar com um corretor" não diz bairro nenhum.
            regiao: { valor: 'Ponta Negra', trecho: 'Quero falar com um corretor', prova: 'm4' },
          },
          imoveis: [
            { codigo: 'AP0031_IMOVA', prova: 'm1', confirmacao: null },
            { codigo: 'CA0099_IMOVA', prova: 'm3', confirmacao: null },
          ],
          // O preço do anúncio não é o orçamento: 590 não está no trecho do cliente.
          orcamento: {
            valor: { valor: 'R$ 590 mil', trecho: 'meu teto é 600 mil', prova: 'm3' },
            pagamento: null,
          },
          objecao: { tipo: 'preco', comoDisse: 'achou caro', trecho: 'Certo', prova: 'm5' },
          temperatura: 'morno',
          temperaturaPorque: 'Perguntou e pediu corretor.',
          porquePassou: 'Pediu um corretor.',
          proximoPasso: 'Responder sobre o AP0031_IMOVA.',
          dadosInsuficientes: false,
        },
      },
    });
    await tratarTrabalho(contexto, PAYLOAD);
    const resumo = gravacoes[0]?.p_resumo as Record<string, unknown>;
    expect(resumo.procura).toEqual({ negocio: null, tipo: null, regiao: null });
    expect(resumo.imoveis).toEqual([
      { codigo: 'AP0031_IMOVA', prova: mensagemId(1), confirmacao: null },
    ]);
    expect(resumo.orcamento).toEqual({ valor: null, pagamento: null });
    expect(resumo.objecao).toBeNull();
    const linha = linhas.find((l) => l.msg === 'a IA resumiu a passagem para o corretor');
    expect(linha?.campos.descartados_no_worker).toBe(5);
  });

  it('o trecho que o modelo copiou com o marcador do nome volta com o nome, e passa', async () => {
    const { contexto, gravacoes, pedidos } = montar(
      entradaNoBanco({
        mensagens: [
          {
            id: mensagemId(1),
            de: 'cliente',
            quem: null,
            quando: '10/11 09:12',
            texto: 'Aqui é o Janio Ramalho, quero alugar em Lagoa Nova',
          },
        ],
      }),
    );
    await tratarTrabalho(contexto, PAYLOAD);
    // O que o modelo viu: o nome trocado pelo marcador.
    // (Aqui a ficha tem o mesmo nome do contato: o marcador pode ser o da empresa.)
    const marcador = /\[\[(?:NOME|EMPRESA)_\d+\]\]/.exec(pedidos[0]?.mensagem ?? '')?.[0];
    expect(marcador).toBeDefined();
    const { contexto: outro, gravacoes: outras } = montar(
      entradaNoBanco({
        mensagens: [
          {
            id: mensagemId(1),
            de: 'cliente',
            quem: null,
            quando: '10/11 09:12',
            texto: 'Aqui é o Janio Ramalho, quero alugar em Lagoa Nova',
          },
        ],
      }),
      'imova',
      {
        forcar: {
          resumo_passagem: {
            procura: {
              negocio: { valor: 'locacao', trecho: `${marcador}, quero alugar`, prova: 'm1' },
              tipo: null,
              regiao: { valor: 'Lagoa Nova', trecho: 'em Lagoa Nova', prova: 'm1' },
            },
            imoveis: [],
            orcamento: { valor: null, pagamento: null },
            objecao: null,
            temperatura: 'morno',
            temperaturaPorque: 'x',
            porquePassou: 'x',
            proximoPasso: 'x',
            dadosInsuficientes: false,
          },
        },
      },
    );
    await tratarTrabalho(outro, PAYLOAD);
    expect(gravacoes).toHaveLength(1);
    const procura = (outras[0]?.p_resumo as { procura: Record<string, unknown> }).procura;
    expect(procura.negocio).toEqual({
      valor: 'locacao',
      trecho: 'Janio Ramalho, quero alugar',
      prova: mensagemId(1),
    });
    expect(procura.regiao).toMatchObject({ valor: 'Lagoa Nova' });
  });
});

describe('o resumo da passagem: o que não vira chamada paga', () => {
  it('na KOMUNE sai da fila sem chamar o modelo', async () => {
    const { contexto, duble, leituras } = montar(entradaNoBanco(), 'komune');
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado).toMatchObject({ feito: false, motivo: 'fora_da_ia_da_empresa' });
    expect(duble.chamadas).toEqual([]);
    expect(leituras).toEqual([]);
  });

  it('a passagem já resumida (a fila entregou de novo) não paga outra vez', async () => {
    const { contexto, duble, gravacoes } = montar(entradaNoBanco({ ja_resumida: true }));
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado).toMatchObject({ feito: false, motivo: 'ja_resumida' });
    expect(duble.chamadas).toEqual([]);
    expect(gravacoes).toEqual([]);
  });

  it('o que não é passagem não é resumido', async () => {
    const { contexto, duble } = montar({ existe: true, passagem: false });
    expect(await tratarTrabalho(contexto, PAYLOAD)).toMatchObject({
      feito: false,
      motivo: 'nao_e_passagem',
    });
    expect(duble.chamadas).toEqual([]);
  });

  it('sem mensagem do cliente, fica registrado que não há o que resumir', async () => {
    const { contexto, duble, falhas } = montar(
      entradaNoBanco({
        mensagens: [
          { id: mensagemId(9), de: 'ia', quem: null, quando: '10/11 09:00', texto: 'Olá!' },
        ],
      }),
    );
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado).toMatchObject({ feito: false, motivo: 'sem_mensagem_do_cliente' });
    expect(duble.chamadas).toEqual([]);
    expect(falhas).toEqual([
      { p_resposta_id: RESPOSTA, p_motivo: 'sem_mensagem_do_cliente', p_ai_run_id: null },
    ]);
  });

  it('o orçamento de IA no limite: nenhuma chamada, sem dívida, e o porquê fica registrado', async () => {
    const { banco, contexto, duble, falhas } = montar(
      entradaNoBanco(),
      'imova',
      {},
      {
        ia_pode_gastar: () => ({ pode: false, motivo: 'orcamento_esgotado' }),
      },
    );
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado).toMatchObject({ feito: false, motivo: 'orcamento' });
    expect(duble.chamadas).toEqual([]);
    expect(falhas[0]).toMatchObject({ p_resposta_id: RESPOSTA, p_motivo: 'orcamento' });
    // Resumo de mês que vem não serve a ninguém: não vira dívida.
    expect(banco.chamadasDeRpc.some((c) => c.nome === 'ia_adiar_trabalho')).toBe(false);
  });

  it('a saída fora do combinado vira "erro do modelo", sem girar na fila', async () => {
    const { contexto, falhas, gravacoes } = montar(entradaNoBanco(), 'imova', {
      forcar: { resumo_passagem: { temperatura: 'fervendo' } },
    });
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado).toMatchObject({ feito: false, motivo: 'erro_do_modelo' });
    expect(falhas[0]).toMatchObject({ p_motivo: 'erro_do_modelo' });
    expect(gravacoes).toEqual([]);
  });

  it('rede, 429 e 5xx voltam para a fila', async () => {
    const { contexto, falhas } = montar(entradaNoBanco(), 'imova', {
      falharCom: () => new ErroDoModelo('529 sobrecarregado', 529, true),
    });
    const erro = await tratarTrabalho(contexto, PAYLOAD).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDoModelo);
    expect(eDeterministico(erro)).toBe(false);
    expect(falhas).toEqual([]);
  });

  it('payload torto é determinístico', async () => {
    const { contexto } = montar();
    const erro = await tratarTrabalho(contexto, {
      purpose: 'resumir_passagem',
      resposta_id: 'x',
    }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeterministico);
  });

  it('o banco que não grava (a passagem sumiu) não faz a chamada girar na fila', async () => {
    const { contexto } = montar(
      entradaNoBanco(),
      'imova',
      {},
      {
        ia_resumo_da_passagem_gravar: () => ({ ok: false, motivo: 'passagem_inexistente' }),
      },
    );
    const erro = await tratarTrabalho(contexto, PAYLOAD).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeterministico);
  });
});

describe('o resumo da passagem: todo fim sem resumo fica registrado', () => {
  it('o cliente pediu para sair entre a passagem e o resumo: "suprimido", sem chamada', async () => {
    const { contexto, duble, falhas } = montar(
      entradaNoBanco(),
      'imova',
      {},
      {
        ia_alvo_suprimido: () => ({ suprimido: true, motivo: 'contato_suprimido' }),
      },
    );
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado).toMatchObject({ feito: false, motivo: 'alvo_suprimido' });
    expect(duble.chamadas).toEqual([]);
    expect(falhas).toEqual([{ p_resposta_id: RESPOSTA, p_motivo: 'suprimido', p_ai_run_id: null }]);
  });

  it('o banco respondeu fora do combinado: "erro_interno", e o trabalho não gira', async () => {
    const { contexto, falhas } = montar({ existe: 'talvez' });
    const erro = await tratarTrabalho(contexto, PAYLOAD).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeterministico);
    expect(falhas[0]).toMatchObject({ p_resposta_id: RESPOSTA, p_motivo: 'erro_interno' });
  });
});

describe('montarEntradaDoResumo', () => {
  it('rótulo no lugar do uuid, as 60 mais recentes, e o motivo e as visitas como vieram', () => {
    const mensagens = Array.from({ length: 70 }, (_, i) => ({
      id: mensagemId(i + 1),
      de: 'cliente' as const,
      quem: null,
      quando: '10/11 09:00',
      texto: `mensagem ${i + 1}`,
    }));
    const { entrada, rotulos } = montarEntradaDoResumo(
      {
        existe: true,
        mensagens,
        motivo: '  pediu corretor  ',
        agora_por_extenso: 'terça-feira, 10 de novembro, às 9h20',
        visitas: [{ quando: 'sábado, 14 de novembro, às 9h30', estado: 'marcada' }],
        imoveis_citados: [
          { codigo: 'AP0031_IMOVA', palavras: ['apartamento', 'ponta'] },
          { codigo: 'X'.repeat(41), palavras: [] },
        ],
      },
      'lead-abc123',
    );
    // Os imóveis da Imova citados vêm como o banco os conhece; código longo demais fica fora.
    expect(entrada.imoveisCitados).toEqual([
      { codigo: 'AP0031_IMOVA', palavras: ['apartamento', 'ponta'] },
    ]);
    expect(entrada.mensagens).toHaveLength(60);
    expect(entrada.mensagens[0]).toMatchObject({ messageId: 'm1', texto: 'mensagem 11' });
    expect(rotulos.get('m1')).toBe(mensagemId(11));
    expect(rotulos.get('m60')).toBe(mensagemId(70));
    expect(entrada.motivoDaPassagem).toBe('pediu corretor');
    expect(entrada.passouEm).toBe('terça-feira, 10 de novembro, às 9h20');
    expect(entrada.visitas).toEqual([
      { quando: 'sábado, 14 de novembro, às 9h30', estado: 'marcada' },
    ]);
  });

  it('sem motivo e sem hora, a entrada continua válida', () => {
    const { entrada } = montarEntradaDoResumo(
      {
        existe: true,
        mensagens: [
          { id: mensagemId(1), de: 'cliente', quem: null, quando: '10/11 09:00', texto: null },
        ],
      },
      'lead-abc123',
    );
    expect(entrada.motivoDaPassagem).toBeNull();
    expect(entrada.passouEm).toBe('agora há pouco');
    expect(entrada.imoveisCitados).toEqual([]);
    expect(entrada.mensagens[0]?.texto).toBe('');
  });
});
