import { describe, expect, it } from 'vitest';

import { bancoFalso, type TabelasFalsas } from './banco-de-teste';
import { ErroDoModelo, type PedidoAoModelo } from './cliente';
import { clienteDuble, type OpcoesDoDuble } from './duble';
import type { ContextoDaIa } from './execucao';
import { descricaoDoImovel, montarEntradaDaRetomada, textoDoAnuncio } from './retomar';
import { eDeterministico, tratarTrabalho } from './tarefas';

import type { LogFields, Logger } from '../lib/log';

/**
 * A IA QUE ATENDE RETOMA O CONTATO (Imova, 11/11/2026), SEM REDE.
 *
 * O caminho inteiro com o banco de mentira e o dublê do modelo: a porta de leitura, a
 * pseudonimização na ida, o nome de volta só no texto que sai, a decisão de não retomar
 * que encerra, a rede de segurança das frases proibidas — e o que não pode virar chamada
 * paga (fora da Imova, banco dizendo que não pode).
 */

function loggerDeTeste(): Logger {
  const nada = (_msg: string, _campos?: LogFields): void => undefined;
  return { debug: nada, info: nada, warn: nada, error: nada };
}

const ORG = '11111111-1111-4111-8111-111111111111';
const CONTATO = '22222222-2222-4222-8222-222222222222';
const CONVERSA = '33333333-3333-4333-8333-333333333333';
const RETOMADA = '44444444-4444-4444-8444-444444444444';
const LEITURA = '55555555-5555-4555-8555-555555555555';
const mensagemId = (n: number): string => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PAYLOAD = {
  purpose: 'retomar_conversa',
  retomada_id: RETOMADA,
  conversation_id: CONVERSA,
  chave: `retomar_conversa:${RETOMADA}`,
};

function tabelas(): TabelasFalsas {
  return {
    ai_runs: [],
    tasks: [],
    organizations: [{ id: ORG, name: 'Ana Souza', phone_e164: '+5584988776655' }],
    contacts: [
      {
        id: CONTATO,
        full_name: 'Ana Souza',
        first_name: 'Ana',
        phone_e164: '+5584988776655',
        email: null,
        instagram_handle: null,
      },
    ],
  };
}

/** A entrada como `public.ia_retomada_entrada` a devolve. */
function entradaNoBanco(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    existe: true,
    pode: true,
    motivo: null,
    conversation_id: CONVERSA,
    organization_id: ORG,
    contact_id: CONTATO,
    retomada_id: RETOMADA,
    etapa: 1,
    dias: 1,
    agora: '2026-11-12 09:10',
    agora_por_extenso: 'quinta-feira, 12 de novembro, às 09h10',
    horas_sem_resposta: 21,
    cliente: {
      nome: 'Ana Souza',
      tem_ficha: true,
      etapa: null,
      perfil: [],
      visitas: [],
      canal_de_chegada: null,
    },
    imovel: {
      codigo: 'AP0012',
      titulo: null,
      tipo: 'apartamento',
      bairro: 'Ponta Negra',
      disponivel: true,
    },
    mensagens: [
      {
        id: mensagemId(1),
        de: 'cliente',
        quem: null,
        quando: '11/11 12:05',
        texto: 'Oi, aqui é a Ana Souza. O AP0012 ainda está disponível?',
      },
      {
        id: mensagemId(2),
        de: 'ia',
        quem: null,
        quando: '11/11 12:06',
        texto: 'Está sim, Ana! Quer marcar uma visita?',
      },
    ],
    ...extras,
  };
}

function montar(
  entrada: Record<string, unknown> = entradaNoBanco(),
  empresa: string | null = 'imova',
  opcoesDoDuble: OpcoesDoDuble = {},
) {
  const ditos: Record<string, unknown>[] = [];
  const desistencias: Record<string, unknown>[] = [];
  const leituras: Record<string, unknown>[] = [];
  const banco = bancoFalso(tabelas(), {
    rpcs: {
      ia_alvo_suprimido: () => ({ suprimido: false }),
      ia_retomada_entrada: () => entrada,
      ia_retomada_dizer: (argumentos) => {
        ditos.push(argumentos);
        return { ok: true, message_id: mensagemId(9) };
      },
      ia_retomada_leitura_entrada: () => ({ ...entrada, leitura_id: LEITURA, dias: 3 }),
      ia_retomada_leitura_gravar: (argumentos) => {
        leituras.push(argumentos);
        return { ok: true };
      },
      ia_retomada_desistir: (argumentos) => {
        desistencias.push(argumentos);
        return { ok: true };
      },
    },
  });
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
    logger: loggerDeTeste(),
    empresa,
  };
  return { banco, contexto, duble, ditos, desistencias, leituras, pedidos };
}

describe('a retomada: o caminho feliz', () => {
  it('lê a conversa, chama o Haiku 5.5 sem nome nem telefone e manda o texto ao banco', async () => {
    const { banco, contexto, duble, ditos, desistencias, pedidos } = montar();

    const resultado = await tratarTrabalho(contexto, PAYLOAD);

    expect(resultado).toMatchObject({
      proposito: 'retomar_conversa',
      feito: true,
      motivo: 'retomou',
    });
    expect(duble.chamadas).toEqual(['retomada']);
    expect(desistencias).toHaveLength(0);

    // Para o modelo, nem o nome nem o telefone do cliente.
    const pedido = pedidos[0]!;
    expect(pedido.mensagem).not.toMatch(/Ana Souza/);
    expect(pedido.mensagem).not.toMatch(/98877/);
    // A v2 não manda o código ao modelo (ele nunca o escreve).
    expect(pedido.mensagem).toMatch(/IMÓVEL: apartamento em Ponta Negra \(disponível: sim\)/);
    // O código só aparece onde o cliente o escreveu (a conversa), nunca nas linhas do imóvel.
    expect(pedido.mensagem).not.toMatch(/^(IMÓVEL|ANÚNCIO).*AP0012/m);
    expect(pedido.mensagem).toMatch(/sem resposta do cliente há 21 horas/);

    const run = banco.tabelas.ai_runs?.[0] as Record<string, unknown> | undefined;
    expect(run?.purpose).toBe('draft_reply');
    expect(run?.model).toBe('claude-haiku-5-5');
    expect(run?.prompt_version).toBe('retomar-conversa@v2');
    expect(run?.conversation_id).toBe(CONVERSA);

    expect(ditos).toHaveLength(1);
    const dito = ditos[0]!;
    expect(dito.p_retomada_id).toBe(RETOMADA);
    expect(dito.p_ai_run_id).toBe(run?.id);
    expect(dito.p_prompt_version).toBe('retomar-conversa@v2');
    // O nome volta só no texto que sai, e só o primeiro.
    expect(dito.p_texto).toBe(
      'Simulação: oi, Ana! O apartamento em Ponta Negra que você viu continua disponível. Qualquer dúvida, é só me chamar.',
    );
  });
});

describe('a retomada: quando não sai', () => {
  it('a IA lê que o cliente fechou o assunto: desiste e encerra as etapas seguintes', async () => {
    const { ditos, desistencias, contexto } = montar(
      entradaNoBanco({
        mensagens: [
          {
            id: mensagemId(1),
            de: 'cliente',
            quem: null,
            quando: '11/11 12:05',
            texto: 'Obrigada, mas já comprei.',
          },
          {
            id: mensagemId(2),
            de: 'ia',
            quem: null,
            quando: '11/11 12:06',
            texto: 'Que bom! Qualquer coisa, estamos aqui.',
          },
        ],
      }),
    );
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado.feito).toBe(false);
    expect(ditos).toHaveLength(0);
    expect(desistencias).toHaveLength(1);
    expect(desistencias[0]).toMatchObject({ p_retomada_id: RETOMADA, p_encerra: true });
    expect(String(desistencias[0]?.p_motivo)).toMatch(/^a_ia_decidiu_nao_retomar: /);
  });

  it('o texto com frase proibida não sai, mesmo com o modelo dizendo que retoma', async () => {
    const { ditos, desistencias, contexto } = montar(entradaNoBanco(), 'imova', {
      forcar: {
        retomada: {
          retomar: true,
          mensagem: 'Oi! Você sumiu! Última chance para o apartamento.',
          motivo: 'Pressão.',
          confianca: 0.5,
        },
      },
    });
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado.feito).toBe(false);
    expect(ditos).toHaveLength(0);
    expect(desistencias[0]).toMatchObject({
      p_motivo: 'texto_fora_das_regras: cobranca',
      p_encerra: false,
    });
  });

  it('o banco diz que não pode (o cliente respondeu): sai da fila sem chamar o modelo', async () => {
    const { duble, desistencias, contexto } = montar(
      entradaNoBanco({ pode: false, motivo: 'o_cliente_respondeu' }),
    );
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado).toMatchObject({ feito: false, motivo: 'o_cliente_respondeu' });
    expect(duble.chamadas).toEqual([]);
    expect(desistencias[0]).toMatchObject({ p_motivo: 'o_cliente_respondeu', p_encerra: false });
  });

  it('a etapa já foi resolvida: não faz nada', async () => {
    const { duble, desistencias, contexto } = montar({
      existe: true,
      pode: false,
      motivo: 'ja_resolvida',
    });
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado).toMatchObject({ feito: false, motivo: 'ja_resolvida' });
    expect(duble.chamadas).toEqual([]);
    expect(desistencias).toHaveLength(0);
  });

  it('fora da Imova, o trabalho sai da fila sem chamar o modelo', async () => {
    const { duble, contexto } = montar(entradaNoBanco(), 'komune');
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado).toMatchObject({ feito: false, motivo: 'fora_da_ia_da_empresa' });
    expect(duble.chamadas).toEqual([]);
  });

  it('o modelo fora do ar volta para a fila; o 400 vira pulo com motivo', async () => {
    const transitorio = montar(entradaNoBanco(), 'imova', {
      falharCom: () => new ErroDoModelo('529 sobrecarregado', 529, true),
    });
    const erro = await tratarTrabalho(transitorio.contexto, PAYLOAD).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDoModelo);
    expect(eDeterministico(erro)).toBe(false);

    const definitivo = montar(entradaNoBanco(), 'imova', {
      falharCom: () => new ErroDoModelo('400 pedido inválido', 400, false),
    });
    const resultado = await tratarTrabalho(definitivo.contexto, PAYLOAD);
    expect(resultado.feito).toBe(false);
    expect(definitivo.desistencias[0]).toMatchObject({ p_motivo: 'a_ia_nao_conseguiu_escrever' });
  });
});

describe('a entrada do prompt', () => {
  it('troca uuid por rótulo, guarda as 30 últimas e descreve o imóvel', () => {
    const muitas = Array.from({ length: 35 }, (_, i) => ({
      id: mensagemId(i + 1),
      de: i % 2 === 0 ? ('cliente' as const) : ('ia' as const),
      quem: null,
      quando: '11/11 12:00',
      texto: `mensagem ${i + 1}`,
    }));
    const e = montarEntradaDaRetomada(
      {
        existe: true,
        horas_sem_resposta: 0,
        mensagens: muitas,
        imovel: {
          codigo: 'TE0002',
          tipo: 'terreno',
          bairro: null,
          titulo: 'Esquina, fale no 84 99988-0011',
          disponivel: false,
        },
      },
      'lead-abc123',
    );
    expect(e.mensagens).toHaveLength(30);
    expect(e.mensagens[0]?.messageId).toBe('m1');
    expect(e.mensagens[0]?.texto).toBe('mensagem 6');
    expect(JSON.stringify(e)).not.toContain('aaaaaaaa-0000');
    expect(e.horasSemResposta).toBe(1);
    expect(e.imovel).toEqual({
      codigo: 'TE0002',
      descricao: 'terreno — Esquina, fale no (telefone)',
      anuncio: 'Esquina, fale no (telefone)',
      disponivel: false,
    });
    expect(descricaoDoImovel({ codigo: 'X', tipo: null, bairro: 'Tirol', titulo: null })).toBe(
      'imóvel em Tirol',
    );
  });
});

const PAYLOAD_DA_LEITURA = {
  purpose: 'retomar_conversa',
  leitura_id: LEITURA,
  conversation_id: CONVERSA,
  chave: `retomar_leitura:${LEITURA}`,
};

describe('a leitura antes do modelo (revisão de 11/11/2026)', () => {
  it('a IA lê a conversa e diz que segue; nada é escrito para o cliente', async () => {
    const { duble, ditos, desistencias, leituras, contexto } = montar();
    const resultado = await tratarTrabalho(contexto, PAYLOAD_DA_LEITURA);
    expect(resultado).toMatchObject({
      proposito: 'retomar_conversa',
      feito: true,
      motivo: 'leitura_segue',
    });
    expect(duble.chamadas).toEqual(['retomada']);
    expect(ditos).toHaveLength(0);
    expect(desistencias).toHaveLength(0);
    expect(leituras).toHaveLength(1);
    expect(leituras[0]).toMatchObject({
      p_leitura_id: LEITURA,
      p_decisao: 'segue',
      p_prompt_version: 'retomar-conversa@v2',
    });
  });

  it('"já aluguei": a IA lê e encerra o silêncio', async () => {
    const { leituras, contexto } = montar(
      entradaNoBanco({
        mensagens: [
          {
            id: mensagemId(1),
            de: 'cliente',
            quem: null,
            quando: '08/11 22:30',
            texto: 'Obrigado, já aluguei com outra imobiliária',
          },
          {
            id: mensagemId(2),
            de: 'ia',
            quem: null,
            quando: '08/11 22:31',
            texto: 'Que bom! Qualquer coisa, estamos aqui.',
          },
        ],
      }),
    );
    const resultado = await tratarTrabalho(contexto, PAYLOAD_DA_LEITURA);
    expect(resultado).toMatchObject({ feito: true, motivo: 'leitura_encerra' });
    expect(leituras[0]).toMatchObject({ p_decisao: 'encerra' });
  });

  it('qualquer falha que repetir não resolve vira "falhou": o modelo não sai (falha fechada)', async () => {
    const definitivo = montar(entradaNoBanco(), 'imova', {
      falharCom: () => new ErroDoModelo('400 pedido inválido', 400, false),
    });
    const resultado = await tratarTrabalho(definitivo.contexto, PAYLOAD_DA_LEITURA);
    expect(resultado).toMatchObject({ feito: false, motivo: 'leitura_falhou' });
    expect(definitivo.leituras[0]).toMatchObject({
      p_decisao: 'falhou',
      p_motivo: 'a_ia_nao_conseguiu_escrever',
    });

    const naoPode = montar(entradaNoBanco({ pode: false, motivo: 'o_cliente_respondeu' }));
    await tratarTrabalho(naoPode.contexto, PAYLOAD_DA_LEITURA);
    expect(naoPode.duble.chamadas).toEqual([]);
    expect(naoPode.leituras[0]).toMatchObject({
      p_decisao: 'falhou',
      p_motivo: 'o_cliente_respondeu',
    });
  });

  it('rede fora do ar volta para a fila (se não voltar, o banco dá a leitura como falha em 2 h)', async () => {
    const { leituras, contexto } = montar(entradaNoBanco(), 'imova', {
      falharCom: () => new ErroDoModelo('529 sobrecarregado', 529, true),
    });
    const erro = await tratarTrabalho(contexto, PAYLOAD_DA_LEITURA).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDoModelo);
    expect(leituras).toHaveLength(0);
  });

  it('o payload tem de dizer qual dos dois: retomada ou leitura', async () => {
    const { contexto } = montar();
    await expect(tratarTrabalho(contexto, { ...PAYLOAD, leitura_id: LEITURA })).rejects.toThrow(
      /um dos dois/,
    );
  });
});

describe('a rede de segurança no worker', () => {
  it('número que não está na conversa nem no imóvel: o texto não sai', async () => {
    const { ditos, desistencias, contexto } = montar(entradaNoBanco(), 'imova', {
      forcar: {
        retomada: {
          retomar: true,
          mensagem: 'Oi! O apartamento tem 120 m². Qualquer dúvida, é só me chamar.',
          motivo: 'Inventou a área.',
          confianca: 0.6,
        },
      },
    });
    await tratarTrabalho(contexto, PAYLOAD);
    expect(ditos).toHaveLength(0);
    expect(desistencias[0]).toMatchObject({
      p_motivo: 'texto_fora_das_regras: numero_fora_da_conversa',
    });
  });

  it('o código do imóvel nunca sai, nem quando está na conversa (v2, nota 9 c do caderno)', async () => {
    const { ditos, desistencias, contexto } = montar(entradaNoBanco(), 'imova', {
      forcar: {
        retomada: {
          retomar: true,
          mensagem: 'Oi! O AP0012 continua disponível. Qualquer dúvida, é só me chamar.',
          motivo: 'Retomei.',
          confianca: 0.8,
        },
      },
    });
    await tratarTrabalho(contexto, PAYLOAD);
    expect(ditos).toHaveLength(0);
    expect(desistencias[0]).toMatchObject({ p_motivo: 'texto_fora_das_regras: cita_codigo' });
  });

  it('pergunta não sai: a retomada termina no gancho (decisão de 25/11/2026)', async () => {
    const { ditos, desistencias, contexto } = montar(entradaNoBanco(), 'imova', {
      forcar: {
        retomada: {
          retomar: true,
          mensagem: 'Oi! Ainda tem interesse no apartamento em Ponta Negra?',
          motivo: 'Retomei.',
          confianca: 0.8,
        },
      },
    });
    await tratarTrabalho(contexto, PAYLOAD);
    expect(ditos).toHaveLength(0);
    expect(desistencias[0]).toMatchObject({ p_motivo: 'texto_fora_das_regras: pergunta' });
  });

  it('o texto do anúncio vai sem preço, sem código e sem telefone', () => {
    expect(
      textoDoAnuncio({
        codigo: 'TE0004_IMOVA',
        titulo: 'Terreno Frente ao Mar com 810m² | R$ 520 mil',
        tipo: 'terreno',
        bairro: 'Praia de Tabatinga',
        descricao:
          'Terreno frente para o mar. Valor: R$ 520.000,00. Código TE0004. Escriturado e pronto para venda. Ligue 84 99988-0011',
        caracteristicas: ['Frente mar'],
      }),
    ).toBe(
      'Terreno Frente ao Mar com 810m²\nTerreno frente para o mar. Escriturado e pronto para venda. Ligue (telefone)\nCaracterísticas: Frente mar.',
    );
  });
});
