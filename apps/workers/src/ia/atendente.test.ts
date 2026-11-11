import { describe, expect, it } from 'vitest';

import type { SaidaDoAtendenteV3 } from '@komune/prompts';

import {
  atenderCliente,
  convitesDaEntrada,
  instanteDeFortaleza,
  limparTexto,
  montarEntrada,
  perguntaDoImovel,
  semOLinkDaAgenda,
  soOPrimeiroNome,
  textoDoLink,
  textoParaOLink,
} from './atendente';
import { bancoFalso } from './banco-de-teste';
import type { PedidoAoModelo } from './cliente';
import { clienteDuble } from './duble';
import type { ContextoDaIa } from './execucao';

import type { ClienteDoBanco } from '../fila/esteira';
import type { LogFields, Logger } from '../lib/log';

describe('a IA que atende (Imova, 06/11/2026)', () => {
  it('chama o cliente só pelo primeiro nome', () => {
    expect(soOPrimeiroNome('Boa tarde, Janio Ramalho! Tudo bem?', 'Janio  Ramalho')).toBe('Boa tarde, Janio! Tudo bem?');
    expect(soOPrimeiroNome('Oi, Ana!', 'Ana')).toBe('Oi, Ana!');
    expect(soOPrimeiroNome('Oi!', null)).toBe('Oi!');
  });

  it('marcador que sobrou sai sem deixar vírgula solta', () => {
    expect(limparTexto('Oi, [[NOME_2]]! Temos sim.')).toBe('Oi! Temos sim.');
    expect(limparTexto('  Tudo   certo  .  ')).toBe('Tudo certo.');
  });

  it('a entrada troca uuid por rótulo, e os horários de visita não vão mais ao modelo (v3)', () => {
    const { entrada, rotulos } = montarEntrada(
      {
        existe: true,
        treino: true,
        agora: '2026-11-06 14:34',
        agora_por_extenso: 'sexta-feira, 6 de novembro, às 14h34',
        cliente: {
          nome: 'Janio Ramalho',
          tem_ficha: true,
          etapa: null,
          perfil: [{ campo: 'bairros', valor: 'Ponta Negra' }, { campo: 'quartos', valor: null }],
          visitas: [],
          canal_de_chegada: 'placa',
        },
        respostas_na_ultima_hora: 2,
        mensagens: [
          { id: '00000000-0000-4000-8000-000000000001', de: 'cliente', quem: null, quando: '06/11 14:33', texto: 'Oi' },
          { id: '00000000-0000-4000-8000-000000000002', de: 'equipe', quem: 'Ana', quando: '06/11 14:34', texto: null },
        ],
      },
      'lead-abc123',
    );
    expect(entrada.mensagens.map((m) => m.messageId)).toEqual(['m1', 'm2']);
    expect(rotulos.get('m1')).toBe('00000000-0000-4000-8000-000000000001');
    expect(entrada.mensagens[1]?.texto).toBe('');
    expect(entrada.cliente.perfil).toEqual([{ campo: 'bairros', valor: 'Ponta Negra' }]);
    expect(entrada.cliente.canalDeChegada).toBe('placa');
    expect(entrada).not.toHaveProperty('horariosDeVisita');
    expect(entrada.convitesDaAgenda).toEqual([]);
    // O agora vai com "T": com espaço, 2027 inteiro vira telefone para a auditoria.
    expect(entrada.agora).toBe('2026-11-06T14:34');
    expect(JSON.stringify(entrada)).not.toContain('00000000-0000');
  });
});

describe('os links da agenda na entrada (v3, 11/11/2026)', () => {
  it('o instante do banco vira o relógio de Natal, com "T"', () => {
    expect(instanteDeFortaleza('2026-11-11T17:05:42.123+00:00')).toBe('2026-11-11T14:05');
    expect(instanteDeFortaleza('2027-01-01T02:30:00Z')).toBe('2026-12-31T23:30');
    expect(instanteDeFortaleza('ontem')).toBeNull();
  });

  it('só os de forma conhecida, até cinco; a reunião não leva imóvel', () => {
    const visita = { tipo: 'visita', imovel_codigo: 'IM0003', enviado_em: '2026-11-11T17:05:00Z', agendado: false };
    expect(
      convitesDaEntrada([
        visita,
        { tipo: 'reuniao', imovel_codigo: 'IM0003', enviado_em: '2026-11-10T13:00:00Z', agendado: true },
        { tipo: 'presencial', imovel_codigo: 'IM0003', enviado_em: '2026-11-10T13:00:00Z', agendado: true },
        { tipo: 'visita', imovel_codigo: null, enviado_em: 'quando?', agendado: false },
        { tipo: 'visita', imovel_codigo: '  ', enviado_em: '2026-11-09T13:00:00Z', agendado: null },
        'lixo',
      ]),
    ).toEqual([
      { tipo: 'visita', imovelCodigo: 'IM0003', enviadoEm: '2026-11-11T14:05', agendado: false },
      { tipo: 'reuniao', imovelCodigo: null, enviadoEm: '2026-11-10T10:00', agendado: true },
      { tipo: 'visita', imovelCodigo: null, enviadoEm: '2026-11-09T10:00', agendado: false },
    ]);
    expect(convitesDaEntrada(Array(8).fill(visita))).toHaveLength(5);
    expect(convitesDaEntrada(undefined)).toEqual([]);
  });

  it('o link do Calendly que já saiu volta na conversa como "[link da agenda]"', () => {
    expect(
      semOLinkDaAgenda(
        'Escolha o horário: https://calendly.com/contato-imovaimobiliaria/30min?name=Janio&a2=%2B5584988776655&utm_content=k3j4s8d7f6',
      ),
    ).toBe('Escolha o horário: [link da agenda]');
    expect(semOLinkDaAgenda('veja calendly.com/imova/visita.')).toBe('veja [link da agenda]');
    expect(semOLinkDaAgenda('Quanto é o aluguel?')).toBe('Quanto é o aluguel?');
  });
});

describe('o texto que vai com o link (v3)', () => {
  it('nenhum endereço de site sai do modelo; vazio vira o texto padrão', () => {
    expect(textoParaOLink('Ótimo! Vou te mandar o link para você escolher o horário.', 'visita')).toBe(
      'Ótimo! Vou te mandar o link para você escolher o horário.',
    );
    expect(textoParaOLink('Agende aqui: https://calendly.com/imova/30min', 'visita')).toBe('Agende aqui.');
    expect(textoParaOLink('Pode marcar em www.calendly.com/imova', 'reuniao')).toBe('Pode marcar em.');
    expect(textoParaOLink('https://calendly.com/imova', 'visita')).toBe(textoDoLink('visita'));
    expect(textoParaOLink('', 'reuniao')).toBe(textoDoLink('reuniao'));
    expect(textoDoLink('reuniao')).toMatch(/conversar com um dos nossos corretores/);
  });

  it('a pergunta do imóvel não pede o código', () => {
    expect(perguntaDoImovel('visita_sem_imovel')).toMatch(/qual imóvel você quer ver\?/);
    expect(perguntaDoImovel('imovel_desconhecido')).toMatch(/Onde você viu o anúncio\?/);
    for (const motivo of ['visita_sem_imovel', 'imovel_desconhecido']) {
      expect(perguntaDoImovel(motivo)).not.toMatch(/código/i);
    }
  });
});

// ----------------------------------------------------------------- o caminho inteiro

const ORG = '11111111-1111-4111-8111-111111111111';
const CONTATO = '22222222-2222-4222-8222-222222222222';
const CONVERSA = '33333333-3333-4333-8333-333333333333';
const ULTIMA = 'aaaaaaaa-0000-4000-8000-000000000003';
const PAYLOAD = { purpose: 'draft_reply', conversation_id: CONVERSA, message_id: ULTIMA };

function entradaNoBanco(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    existe: true,
    conversation_id: CONVERSA,
    organization_id: ORG,
    contact_id: CONTATO,
    treino: false,
    atende: true,
    agora: '2026-11-11 14:40',
    agora_por_extenso: 'quarta-feira, 11 de novembro, às 14h40',
    cliente: { nome: 'Janio Ramalho', tem_ficha: true, etapa: 'Respondeu', perfil: [], visitas: [], canal_de_chegada: 'anuncios' },
    // O banco ainda pode mandar os horários: o worker não os leva mais ao modelo.
    horarios_de_visita: [{ inicio: '2026-11-12T12:30:00+00:00', quando_por_extenso: 'quinta-feira, 12 de novembro, às 09h30' }],
    convites_da_agenda: [{ tipo: 'visita', imovel_codigo: 'IM0003', enviado_em: '2026-11-11T17:05:00Z', agendado: false }],
    ultima_do_cliente: ULTIMA,
    respostas_na_ultima_hora: 1,
    mensagens: [
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', de: 'cliente', quem: null, quando: '11/11 14:04', texto: 'Quero visitar o IM0003' },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000002',
        de: 'ia',
        quem: null,
        quando: '11/11 14:05',
        texto: 'Vou te mandar o link.\nhttps://calendly.com/contato-imovaimobiliaria/30min?a2=5584988776655&utm_content=k3j4s8d7f6',
      },
      { id: ULTIMA, de: 'cliente', quem: null, quando: '11/11 14:38', texto: 'Na verdade, quero ver o TE0004' },
    ],
    ...extras,
  };
}

function loggerDeTeste(): Logger {
  const nada = (_msg: string, _campos?: LogFields): void => {};
  return { debug: nada, info: nada, warn: nada, error: nada };
}

function saidaDoModelo(mudanca: Partial<SaidaDoAtendenteV3> = {}): SaidaDoAtendenteV3 {
  return {
    acao: 'enviar_link_da_agenda',
    mensagem: 'Claro! Vou te mandar o link da agenda para você escolher o dia e o horário da visita.',
    agenda: { tipo: 'visita', imovelCodigo: 'TE0004' },
    motivo: 'Quer visitar o TE0004.',
    anotacoes: [],
    fotosEnsinadas: [],
    confianca: 0.9,
    ...mudanca,
  };
}

/**
 * O caminho inteiro sem rede: o banco de mentira responde as portas da IA, o dublê do
 * modelo devolve a saída do teste, e `enviarLink` faz o papel de `ia_atendente_enviar_link`
 * (que é do agente do convite e ainda não existe aqui).
 */
function montar(
  saida: SaidaDoAtendenteV3,
  enviarLink: (argumentos: Record<string, unknown>) => unknown = () => ({ ok: true, mensagem_id: 'm', link: 'x', convite_id: 'c' }),
  opcoes: { erroNoLink?: string; entrada?: Record<string, unknown> } = {},
) {
  const banco = bancoFalso(
    {
      ai_runs: [],
      tasks: [],
      app_settings: [],
      contacts: [{ id: CONTATO, full_name: 'Janio Ramalho', first_name: 'Janio', phone_e164: '+5584988776655', email: null, instagram_handle: null }],
      organizations: [{ id: ORG, name: 'Janio Ramalho', phone_e164: '+5584988776655', email: null, instagram_handle: null }],
    },
    {
      rpcs: {
        ia_entrada_do_atendente: () => opcoes.entrada ?? entradaNoBanco(),
        ia_atendente_base: () => ({ caderno: [], imoveis: [{ codigo: 'IM0003' }, { codigo: 'TE0004' }] }),
        ia_fotos_do_cliente: () => [],
        ia_fotos_reconhecidas_da_conversa: () => [],
        alvo_suprimido: () => false,
        ia_atendente_enviar_link: enviarLink,
        ia_atendente_responder: () => ({ ok: true, message_id: 'r' }),
        ia_atendente_passar: () => ({ ok: true }),
      },
    },
  );
  const cliente: ClienteDoBanco =
    opcoes.erroNoLink === undefined
      ? banco.cliente
      : ({
          ...(banco.cliente as unknown as Record<string, unknown>),
          rpc: async (nome: string, argumentos: Record<string, unknown>) => {
            if (nome === 'ia_atendente_enviar_link') {
              banco.chamadasDeRpc.push({ nome, argumentos });
              return { data: null, error: { message: opcoes.erroNoLink } };
            }
            return (banco.cliente as unknown as { rpc: (n: string, a: Record<string, unknown>) => unknown }).rpc(nome, argumentos);
          },
        } as unknown as ClienteDoBanco);
  const duble = clienteDuble({ forcar: { atendente: saida } });
  const pedidos: PedidoAoModelo[] = [];
  const contexto: ContextoDaIa = {
    cliente,
    modelo: {
      conversar: (pedido) => {
        pedidos.push(pedido);
        return duble.conversar(pedido);
      },
    },
    logger: loggerDeTeste(),
    empresa: 'imova',
  };
  const chamadas = (nome: string) => banco.chamadasDeRpc.filter((c) => c.nome === nome).map((c) => c.argumentos);
  return { banco, contexto, pedidos, chamadas };
}

describe('enviar_link_da_agenda: o worker chama ia_atendente_enviar_link', () => {
  it('a visita: o tipo, o código, o texto e o ai_run, com a versão v3', async () => {
    const { contexto, chamadas, banco } = montar(saidaDoModelo());
    const r = await atenderCliente(contexto, PAYLOAD);

    expect(r).toMatchObject({ feito: true, motivo: 'enviar_link_da_agenda' });
    const run = banco.tabelas.ai_runs?.[0] as Record<string, unknown>;
    expect(run.prompt_version).toBe('atendente-imova@v3');
    expect(chamadas('ia_atendente_enviar_link')).toEqual([
      {
        p_conversation_id: CONVERSA,
        p_em_resposta_a: ULTIMA,
        p_tipo: 'visita',
        p_imovel_codigo: 'TE0004',
        p_texto: 'Claro! Vou te mandar o link da agenda para você escolher o dia e o horário da visita.',
        p_ai_run_id: run.id,
        p_prompt_version: 'atendente-imova@v3',
      },
    ]);
    expect(chamadas('ia_atendente_marcar_visita')).toEqual([]);
    expect(chamadas('ia_atendente_responder')).toEqual([]);
    expect(chamadas('ia_atendente_passar')).toEqual([]);
  });

  it('o modelo lê os links já mandados, e não lê os horários nem o link cru', async () => {
    const { contexto, pedidos } = montar(saidaDoModelo());
    await atenderCliente(contexto, PAYLOAD);
    const mensagem = pedidos[0]?.mensagem ?? '';
    expect(mensagem).toContain('LINKS DA AGENDA que já saíram nesta conversa (o mais novo primeiro):\n- visita ao IM0003 · saiu há 35 minutos · ainda não agendou');
    expect(mensagem).toContain('[link da agenda]');
    expect(mensagem).not.toMatch(/calendly|HORÁRIOS DE VISITA|12 de novembro/);
    expect(pedidos[0]?.sistema).toContain('A VISITA E A REUNIÃO (acao = enviar_link_da_agenda)');
  });

  it('a reunião vai sem imóvel, mesmo que o modelo tenha posto um código', async () => {
    const { contexto, chamadas } = montar(saidaDoModelo({ agenda: { tipo: 'reuniao', imovelCodigo: 'IM0003' } }));
    await atenderCliente(contexto, PAYLOAD);
    expect(chamadas('ia_atendente_enviar_link')[0]).toMatchObject({ p_tipo: 'reuniao', p_imovel_codigo: null });
  });

  it('o endereço de site que o modelo escreveu sai do texto; vazio vira o texto padrão', async () => {
    const comLink = montar(saidaDoModelo({ mensagem: 'Agende aqui: https://calendly.com/imova/30min' }));
    await atenderCliente(comLink.contexto, PAYLOAD);
    expect(comLink.chamadas('ia_atendente_enviar_link')[0]?.p_texto).toBe('Agende aqui.');

    const vazio = montar(saidaDoModelo({ mensagem: '' }));
    await atenderCliente(vazio.contexto, PAYLOAD);
    expect(vazio.chamadas('ia_atendente_enviar_link')[0]?.p_texto).toBe(textoDoLink('visita'));
  });

  it.each([
    ['visita_sem_imovel', /qual imóvel você quer ver\?/],
    ['imovel_desconhecido', /Onde você viu o anúncio\?/],
  ])('recusa %s: pergunta qual é o imóvel pelo ia_atendente_responder, sem silêncio', async (motivo, pergunta) => {
    const { contexto, chamadas } = montar(saidaDoModelo({ agenda: { tipo: 'visita', imovelCodigo: 'XX9999' } }), () => ({
      ok: false,
      motivo,
    }));
    const r = await atenderCliente(contexto, PAYLOAD);

    expect(r).toMatchObject({ feito: true, motivo: 'perguntou_o_imovel' });
    const respondeu = chamadas('ia_atendente_responder');
    expect(respondeu).toHaveLength(1);
    expect(String(respondeu[0]?.p_texto)).toMatch(pergunta);
    expect(respondeu[0]).toMatchObject({
      p_conversation_id: CONVERSA,
      p_em_resposta_a: ULTIMA,
      p_prompt_version: 'atendente-imova@v3',
      p_detalhes: { agenda: { tipo: 'visita', imovelCodigo: 'XX9999', recusa: motivo } },
    });
    expect(chamadas('ia_atendente_passar')).toEqual([]);
  });

  it.each(['sem_link_configurado', 'tipo_invalido', 'teto_por_hora', 'porteira', 'motivo_que_ninguem_previu'])(
    'recusa %s: passa para o corretor, com o motivo',
    async (motivo) => {
      const { contexto, chamadas } = montar(saidaDoModelo(), () => ({ ok: false, motivo }));
      const r = await atenderCliente(contexto, PAYLOAD);

      expect(r.motivo).toMatch(/^passou_para_pessoa: /);
      const passou = chamadas('ia_atendente_passar');
      expect(passou).toHaveLength(1);
      expect(String(passou[0]?.p_motivo)).toContain(`visitar TE0004`);
      expect(String(passou[0]?.p_motivo)).toContain(`(${motivo})`);
      expect(chamadas('ia_atendente_responder')).toEqual([]);
    },
  );

  it.each(['chegou_mensagem_nova', 'ja_respondida', 'ia_nao_atende'])(
    'trava de sempre %s: não fala nem passa; a próxima rodada lê de novo',
    async (motivo) => {
      const { contexto, chamadas } = montar(saidaDoModelo(), () => ({ ok: false, motivo }));
      const r = await atenderCliente(contexto, PAYLOAD);

      expect(r).toMatchObject({ feito: false, motivo });
      expect(chamadas('ia_atendente_passar')).toEqual([]);
      expect(chamadas('ia_atendente_responder')).toEqual([]);
    },
  );

  it('o link sem dizer visita ou reunião: passa para o corretor, sem chamar o banco do link', async () => {
    const { contexto, chamadas } = montar(saidaDoModelo({ agenda: null }));
    const r = await atenderCliente(contexto, PAYLOAD);
    expect(r.motivo).toMatch(/não disse se é visita ou reunião/);
    expect(chamadas('ia_atendente_enviar_link')).toEqual([]);
    expect(chamadas('ia_atendente_passar')).toHaveLength(1);
  });

  it('o banco ainda sem a função do link: passa para o corretor, em vez de girar na fila', async () => {
    const { contexto, chamadas } = montar(saidaDoModelo(), undefined, {
      erroNoLink: 'Could not find the function public.ia_atendente_enviar_link(...) in the schema cache',
    });
    const r = await atenderCliente(contexto, PAYLOAD);
    expect(r.motivo).toMatch(/ainda não manda o link da agenda/);
    expect(chamadas('ia_atendente_passar')).toHaveLength(1);
  });

  it('outro erro do banco no link volta para a fila (repetir resolve)', async () => {
    const { contexto, chamadas } = montar(saidaDoModelo(), undefined, { erroNoLink: 'fetch failed' });
    await expect(atenderCliente(contexto, PAYLOAD)).rejects.toThrow(/ia_atendente_enviar_link: fetch failed/);
    expect(chamadas('ia_atendente_passar')).toEqual([]);
  });

  it('responder, sem link, segue o caminho de sempre', async () => {
    const { contexto, chamadas } = montar(
      saidaDoModelo({ acao: 'responder', agenda: null, mensagem: 'O condomínio é de R$ 600 por mês.' }),
    );
    const r = await atenderCliente(contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: true, motivo: 'responder' });
    expect(chamadas('ia_atendente_responder')[0]?.p_texto).toBe('O condomínio é de R$ 600 por mês.');
    expect(chamadas('ia_atendente_enviar_link')).toEqual([]);
  });

  it('a saída da v2 (marcar_visita) não passa mais pelo schema: vai para uma pessoa', async () => {
    const { contexto, chamadas } = montar({
      ...saidaDoModelo(),
      acao: 'marcar_visita' as SaidaDoAtendenteV3['acao'],
    });
    const r = await atenderCliente(contexto, PAYLOAD);
    expect(r.motivo).toMatch(/não conseguiu escrever a resposta/);
    expect(chamadas('ia_atendente_marcar_visita')).toEqual([]);
    expect(chamadas('ia_atendente_passar')).toHaveLength(1);
  });

  it('convites_da_agenda em forma estranha não derruba a resposta', async () => {
    const { contexto, chamadas, pedidos } = montar(saidaDoModelo(), undefined, {
      entrada: entradaNoBanco({ convites_da_agenda: 'não é lista' }),
    });
    const r = await atenderCliente(contexto, PAYLOAD);
    expect(r.feito).toBe(true);
    expect(pedidos[0]?.mensagem).toContain('LINKS DA AGENDA que já saíram nesta conversa (o mais novo primeiro):\n— nenhum');
    expect(chamadas('ia_atendente_enviar_link')).toHaveLength(1);
  });
});
