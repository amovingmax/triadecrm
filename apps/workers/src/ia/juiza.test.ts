import { describe, expect, it } from 'vitest';

import { bancoFalso, type TabelasFalsas } from './banco-de-teste';
import { ErroDoModelo, type PedidoAoModelo } from './cliente';
import { clienteDuble, type OpcoesDoDuble } from './duble';
import type { ContextoDaIa } from './execucao';
import { avaliarAtendimento, montarEntrada } from './juiza';
import { ErroDeterministico, eDeterministico, tratarTrabalho } from './tarefas';

import type { LogFields, Logger } from '../lib/log';

/**
 * A IA JUÍZA DA IMOVA (06/11/2026), SEM REDE.
 *
 * O caminho inteiro com o banco de mentira e o dublê do modelo: a porta de leitura, a
 * troca de uuid por etiqueta, a pseudonimização na ida, o nome de volta no porquê, a
 * gravação com o `ai_run` que pagou a nota — e o que não pode virar chamada paga.
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

// Ids de verdade: o payload da fila exige uuid.
const ORG = '11111111-1111-4111-8111-111111111111';
const CONTATO = '22222222-2222-4222-8222-222222222222';
const CONVERSA = '33333333-3333-4333-8333-333333333333';
const PERFIL = '99999999-9999-4999-8999-999999999999';
const mensagemId = (n: number): string => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PAYLOAD = {
  purpose: 'avaliar_atendimento',
  conversation_id: CONVERSA,
  dia: '2026-11-05',
  chave: `${CONVERSA}:2026-11-05`,
};

function tabelas(): TabelasFalsas {
  return {
    ai_runs: [],
    tasks: [],
    organizations: [
      { id: ORG, owner_id: PERFIL, name: 'Ramalho Empreendimentos', phone_e164: '+5584988776655' },
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

/** A entrada como `public.ia_juiza_entrada` a devolve — é este contrato que o worker consome. */
function entradaNoBanco(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    existe: true,
    conversation_id: CONVERSA,
    organization_id: ORG,
    contact_id: CONTATO,
    dia: '2026-11-05',
    respostas: 2,
    acoes: [
      { acao: 'respondeu', quando: '05/11 09:31' },
      { acao: 'acao_que_nao_existe', quando: '05/11 09:35' },
      { acao: 'marcou_visita', quando: '05/11 09:40' },
    ],
    atitude_antes: 'interessado',
    atitude_depois: 'etiqueta_nova_do_banco',
    mensagens: [
      {
        id: mensagemId(1),
        de: 'cliente',
        quando: '05/11 09:30',
        texto:
          'Bom dia! Aqui é o Janio Ramalho, meu número é 84 98877-6655. Quanto é o aluguel em Ponta Negra?',
      },
      {
        id: mensagemId(2),
        de: 'ia',
        quando: '05/11 09:31',
        texto: 'Bom dia, Janio! Sai por R$ 2.500 por mês. Quer visitar segunda às 14h30?',
      },
      {
        id: mensagemId(3),
        de: 'cliente',
        quando: '05/11 09:38',
        texto: 'Ótimo, obrigado! Pode ser. Aqui é o Janio Ramalho mesmo.',
      },
      { id: mensagemId(4), de: 'automatica', quando: '05/11 09:41', texto: null },
    ],
    ...extras,
  };
}

function montar(
  entrada: Record<string, unknown> = entradaNoBanco(),
  empresa: string | null = 'imova',
  opcoesDoDuble: OpcoesDoDuble = {},
  gravar: (argumentos: Record<string, unknown>) => unknown = () => ({ ok: true, respostas: 2 }),
) {
  const leituras: Record<string, unknown>[] = [];
  const gravacoes: Record<string, unknown>[] = [];
  const banco = bancoFalso(tabelas(), {
    rpcs: {
      ia_juiza_entrada: (argumentos) => {
        leituras.push(argumentos);
        return entrada;
      },
      ia_juiza_gravar: (argumentos) => {
        gravacoes.push(argumentos);
        return gravar(argumentos);
      },
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
  return { banco, contexto, duble, leituras, gravacoes, pedidos, linhas };
}

describe('a IA juíza: o caminho feliz', () => {
  it('lê o dia, chama o Haiku 5.5 e grava a nota com o ai_run que a pagou', async () => {
    const { banco, contexto, duble, leituras, gravacoes } = montar();

    const resultado = await tratarTrabalho(contexto, PAYLOAD);

    expect(resultado).toMatchObject({ proposito: 'avaliar_atendimento', feito: true });
    expect(duble.chamadas).toEqual(['juiza']);
    expect(leituras).toEqual([{ p_conversation_id: CONVERSA, p_dia: '2026-11-05' }]);

    const run = banco.tabelas.ai_runs?.[0] as Record<string, unknown> | undefined;
    expect(run?.purpose).toBe('avaliar_atendimento');
    expect(run?.model).toBe('claude-haiku-5-5');
    expect(run?.prompt_version).toBe('avaliacao-do-atendimento@v1');
    expect(run?.conversation_id).toBe(CONVERSA);
    expect(resultado.aiRunId).toBe(run?.id);

    expect(gravacoes).toHaveLength(1);
    const gravacao = gravacoes[0]!;
    expect(gravacao.p_conversation_id).toBe(CONVERSA);
    expect(gravacao.p_dia).toBe('2026-11-05');
    expect(gravacao.p_ai_run_id).toBe(run?.id);
    expect(gravacao.p_prompt_version).toBe('avaliacao-do-atendimento@v1');
    expect(gravacao.p_saida).toMatchObject({
      duvida: 4,
      informacao: 4,
      satisfacao: 5,
      interesse: 'subiu',
      melhorar: null,
      dadosInsuficientes: false,
    });
  });

  it('o porquê volta com o nome de verdade; o que fica em ai_runs, não', async () => {
    const { banco, contexto, gravacoes } = montar();
    await tratarTrabalho(contexto, PAYLOAD);

    const porque = (gravacoes[0]?.p_saida as { porque: string }).porque;
    expect(porque).toContain('Janio Ramalho');
    expect(porque).not.toMatch(/\[\[[A-Z]+_\d+\]\]/);
    // `ai_runs.output` guarda a saída como o modelo a viu (ADR-09).
    const output = JSON.stringify((banco.tabelas.ai_runs?.[0] as { output?: unknown }).output);
    expect(output).not.toContain('Janio');
    expect(output).toContain('[[NOME_');
  });

  it('ao modelo chegam etiquetas, não uuid, e nem o nome nem o telefone do cliente', async () => {
    const { contexto, pedidos } = montar();
    await tratarTrabalho(contexto, PAYLOAD);

    const pedido = pedidos[0]!;
    expect(pedido.modelo).toBe('claude-haiku-5-5');
    expect(pedido.maxTokens).toBe(3000);
    expect(pedido.mensagem).toContain('dia avaliado: 05/11/2026');
    expect(pedido.mensagem).toContain('[m1] em 05/11 às 09:30 — cliente:');
    expect(pedido.mensagem).toContain('[m2] em 05/11 às 09:31 — IA:');
    // Mensagem sem texto (figurinha, mídia) entra vazia, sem derrubar a avaliação.
    expect(pedido.mensagem).toContain('[m4] em 05/11 às 09:41 — automática: ');
    expect(pedido.mensagem).not.toContain('aaaaaaaa-0000');
    expect(pedido.mensagem).not.toContain('Janio');
    expect(pedido.mensagem).not.toMatch(/98877[-\s]?6655/);
  });

  it('ação e atitude que o prompt não conhece ficam de fora, sem parar a fila', async () => {
    const { contexto, pedidos } = montar();
    await tratarTrabalho(contexto, PAYLOAD);

    const mensagem = pedidos[0]!.mensagem;
    expect(mensagem).toContain('- respondeu em 05/11 às 09:31');
    expect(mensagem).toContain('- marcou visita em 05/11 às 09:40');
    expect(mensagem).not.toContain('acao_que_nao_existe');
    expect(mensagem).toContain('atitude do cliente no CRM antes do atendimento: interessado');
    expect(mensagem).toContain('atitude do cliente no CRM depois: sem etiqueta');
  });

  it('o log diz as notas, mas não o porquê, que tem o nome do cliente', async () => {
    const { contexto, linhas } = montar();
    await tratarTrabalho(contexto, PAYLOAD);

    const linha = linhas.find((l) => l.msg === 'a IA juíza deu nota ao atendimento');
    expect(linha?.campos).toMatchObject({
      conversation_id: CONVERSA,
      satisfacao: 5,
      interesse: 'subiu',
    });
    expect(JSON.stringify(linhas)).not.toContain('Janio');
  });

  it('o nome de verdade é mais longo que o marcador: o porquê é encurtado de novo até o teto do banco', async () => {
    const { contexto, gravacoes } = montar(entradaNoBanco(), 'imova', {
      forcar: {
        juiza: {
          duvida: 5,
          informacao: 5,
          satisfacao: 5,
          interesse: 'subiu',
          porque: '[[NOME_1]] gostou da resposta. '.repeat(12).trim(),
          melhorar: null,
          dadosInsuficientes: false,
        },
      },
    });
    await tratarTrabalho(contexto, PAYLOAD);

    const porque = (gravacoes[0]?.p_saida as { porque: string }).porque;
    expect(porque).toContain('Janio Ramalho gostou');
    expect(porque.length).toBeLessThanOrEqual(400);
    expect(porque.endsWith('…')).toBe(true);
  });
});

describe('a IA juíza: o que não vira chamada paga', () => {
  it('dia sem resposta da IA sai da fila sem chamar o modelo', async () => {
    const { banco, contexto, duble, gravacoes } = montar({
      existe: true,
      conversation_id: CONVERSA,
      respostas: 0,
      mensagens: [],
    });

    const resultado = await tratarTrabalho(contexto, PAYLOAD);

    expect(resultado).toMatchObject({
      proposito: 'avaliar_atendimento',
      feito: false,
      motivo: 'sem_resposta_da_ia',
    });
    expect(duble.chamadas).toEqual([]);
    expect(banco.tabelas.ai_runs).toHaveLength(0);
    expect(gravacoes).toHaveLength(0);
  });

  it('a resposta saiu mas não está na conversa (apagada no CRM): também não há o que julgar', async () => {
    const { contexto, duble } = montar(
      entradaNoBanco({
        mensagens: [{ id: mensagemId(1), de: 'cliente', quando: '05/11 09:30', texto: 'Oi?' }],
      }),
    );
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado).toMatchObject({ feito: false, motivo: 'sem_resposta_da_ia' });
    expect(duble.chamadas).toEqual([]);
  });

  it('conversa que não existe é determinística: a fila não gira cinco vezes', async () => {
    const { contexto, duble } = montar({ existe: false });

    const erro = await tratarTrabalho(contexto, PAYLOAD).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeterministico);
    expect(eDeterministico(erro)).toBe(true);
    expect((erro as Error).message).toContain(CONVERSA);
    expect(duble.chamadas).toEqual([]);
  });

  it('payload fora do contrato é recusado, determinístico, sem ler o banco', async () => {
    const { contexto, leituras, duble } = montar();
    for (const torto of [
      { ...PAYLOAD, dia: '05/11/2026' },
      { ...PAYLOAD, dia: '2026-02-30' },
      { ...PAYLOAD, conversation_id: 'nao-e-uuid' },
      { purpose: 'avaliar_atendimento', conversation_id: CONVERSA },
      { ...PAYLOAD, purpose: 'draft_reply' },
    ]) {
      const erro = await avaliarAtendimento(contexto, torto).catch((e: unknown) => e);
      expect(erro, JSON.stringify(torto)).toBeInstanceOf(ErroDeterministico);
      expect(eDeterministico(erro)).toBe(true);
    }
    // Pelo despachante também: o mesmo erro, com a mesma natureza.
    await expect(tratarTrabalho(contexto, { ...PAYLOAD, dia: 'ontem' })).rejects.toBeInstanceOf(
      ErroDeterministico,
    );
    expect(leituras).toEqual([]);
    expect(duble.chamadas).toEqual([]);
  });

  it('fora da Imova não lê nada e não chama o modelo', async () => {
    const { contexto, leituras, duble } = montar(entradaNoBanco(), 'komune');
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado).toMatchObject({ feito: false, motivo: 'so_na_imova' });
    expect(leituras).toEqual([]);
    expect(duble.chamadas).toEqual([]);
  });

  it('alvo suprimido: o despachante pergunta pela conversa e não gasta nada', async () => {
    const perguntas: Record<string, unknown>[] = [];
    const banco = bancoFalso(tabelas(), {
      rpcs: {
        ia_alvo_suprimido: (argumentos) => {
          perguntas.push(argumentos);
          return {
            suprimido: true,
            motivo: 'contato_suprimido',
            organization_id: ORG,
            contact_id: CONTATO,
          };
        },
        ia_juiza_entrada: () => entradaNoBanco(),
      },
    });
    const duble = clienteDuble();
    const { logger } = loggerDeTeste();
    const contexto: ContextoDaIa = {
      cliente: banco.cliente,
      modelo: duble,
      logger,
      empresa: 'imova',
    };

    const resultado = await tratarTrabalho(contexto, PAYLOAD);

    expect(resultado).toMatchObject({ feito: false, motivo: 'alvo_suprimido' });
    expect(perguntas[0]).toMatchObject({ p_purpose: 'avaliar_atendimento' });
    expect((perguntas[0]?.p_payload as { conversation_id?: string }).conversation_id).toBe(
      CONVERSA,
    );
    expect(duble.chamadas).toEqual([]);
    expect(banco.chamadasDeRpc.map((c) => c.nome)).not.toContain('ia_juiza_entrada');
  });
});

describe('a IA juíza: os erros do modelo e da gravação', () => {
  it('400 do modelo é determinístico: repetir pagaria a mesma recusa', async () => {
    const { contexto, gravacoes } = montar(entradaNoBanco(), 'imova', {
      falharCom: () => new ErroDoModelo('400 schema inválido', 400, false),
    });
    const erro = await tratarTrabalho(contexto, PAYLOAD).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeterministico);
    expect(gravacoes).toEqual([]);
  });

  it('429 e rede voltam para a fila', async () => {
    const { contexto, gravacoes } = montar(entradaNoBanco(), 'imova', {
      falharCom: () => new ErroDoModelo('429 rate limit', 429, true),
    });
    const erro = await tratarTrabalho(contexto, PAYLOAD).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDoModelo);
    expect(eDeterministico(erro)).toBe(false);
    expect(gravacoes).toEqual([]);
  });

  it('a conversa sumiu antes da gravação: determinístico, com o motivo do banco', async () => {
    const { contexto } = montar(entradaNoBanco(), 'imova', {}, () => ({
      ok: false,
      motivo: 'conversa_nao_existe',
    }));
    const erro = await tratarTrabalho(contexto, PAYLOAD).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeterministico);
    expect((erro as Error).message).toContain('conversa_nao_existe');
  });
});

describe('montarEntrada', () => {
  it('troca uuid por etiqueta, na ordem da conversa, e mantém o resto como veio', () => {
    const entrada = montarEntrada(
      {
        existe: true,
        respostas: 3,
        acoes: [{ acao: 'passou_para_pessoa', quando: '05/11 10:00' }],
        atitude_antes: null,
        atitude_depois: 'morno',
        mensagens: [
          { id: mensagemId(7), de: 'cliente', quando: '04/11 18:00', texto: 'Tem garagem?' },
          { id: mensagemId(8), de: 'ia', quando: '05/11 08:00', texto: 'Tem uma vaga.' },
        ],
      },
      '2026-11-05',
      'lead-abc123',
    );
    expect(entrada.mensagens.map((m) => m.messageId)).toEqual(['m1', 'm2']);
    expect(entrada.mensagens.map((m) => m.de)).toEqual(['cliente', 'ia']);
    expect(entrada.acoes).toEqual([{ acao: 'passou_para_pessoa', quando: '05/11 10:00' }]);
    expect(entrada.atitudeAntes).toBeNull();
    expect(entrada.atitudeDepois).toBe('morno');
    expect(entrada.respostas).toBe(3);
    expect(entrada.dia).toBe('2026-11-05');
    expect(JSON.stringify(entrada)).not.toContain('aaaaaaaa-0000');
  });
});
