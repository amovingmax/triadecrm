import { describe, expect, it } from 'vitest';

import { FRASE_DA_VISITA, type SaidaDoAtendenteV6 } from '@komune/prompts';

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
import type { PedidoAoModelo, PedidoComFerramentas, VoltaDoModelo } from './cliente';
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

function saidaDoModelo(mudanca: Partial<SaidaDoAtendenteV6> = {}): SaidaDoAtendenteV6 {
  return {
    // Desde a v5 (12/11/2026), o link da agenda é só da reunião online.
    acao: 'enviar_link_da_agenda',
    mensagem: 'Claro! Vou te mandar o link da agenda para você escolher o dia e o horário da nossa conversa.',
    agenda: { tipo: 'reuniao', imovelCodigo: null },
    motivo: 'Quer anunciar o apartamento dele.',
    anotacoes: [],
    fotosEnsinadas: [],
    confianca: 0.9,
    // Desde a v6 (17/11/2026): a resposta ao convite de ofertas por e-mail.
    ofertasPorEmail: null,
    ...mudanca,
  };
}

/**
 * O caminho inteiro sem rede: o banco de mentira responde as portas da IA, o dublê do
 * modelo devolve a saída do teste, e `enviarLink` faz o papel de `ia_atendente_enviar_link`
 * (que é do agente do convite e ainda não existe aqui).
 */
function montar(
  saida: SaidaDoAtendenteV6,
  enviarLink: (argumentos: Record<string, unknown>) => unknown = () => ({ ok: true, mensagem_id: 'm', link: 'x', convite_id: 'c' }),
  opcoes: {
    erroNoLink?: string;
    entrada?: Record<string, unknown>;
    caderno?: unknown[];
    rpcs?: Record<string, (argumentos: Record<string, unknown>) => unknown>;
    arquivos?: Record<string, Blob | Error>;
    erroNaSubida?: string;
  } = {},
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
        ia_atendente_base: () => ({ caderno: opcoes.caderno ?? [], imoveis: [{ codigo: 'IM0003' }, { codigo: 'TE0004' }] }),
        ia_fotos_do_cliente: () => [],
        ia_fotos_reconhecidas_da_conversa: () => [],
        alvo_suprimido: () => false,
        ia_atendente_enviar_link: enviarLink,
        ia_atendente_responder: () => ({ ok: true, message_id: 'r' }),
        ia_atendente_passar: () => ({ ok: true }),
        ia_atendente_ofertas_por_email: () => ({ ok: true, gravado: true }),
        ...opcoes.rpcs,
      },
      ...(opcoes.arquivos === undefined ? {} : { arquivos: opcoes.arquivos }),
      ...(opcoes.erroNaSubida === undefined ? {} : { erroNaSubida: opcoes.erroNaSubida }),
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
  it('a reunião: o tipo, o texto e o ai_run, com a versão vigente (v6)', async () => {
    const { contexto, chamadas, banco } = montar(saidaDoModelo());
    const r = await atenderCliente(contexto, PAYLOAD);

    expect(r).toMatchObject({ feito: true, motivo: 'enviar_link_da_agenda' });
    const run = banco.tabelas.ai_runs?.[0] as Record<string, unknown>;
    expect(run.prompt_version).toBe('atendente-imova@v6');
    expect(chamadas('ia_atendente_enviar_link')).toEqual([
      {
        p_conversation_id: CONVERSA,
        p_em_resposta_a: ULTIMA,
        p_tipo: 'reuniao',
        p_imovel_codigo: null,
        p_texto: 'Claro! Vou te mandar o link da agenda para você escolher o dia e o horário da nossa conversa.',
        p_ai_run_id: run.id,
        p_prompt_version: 'atendente-imova@v6',
      },
    ]);
    expect(chamadas('ia_atendente_marcar_visita')).toEqual([]);
    expect(chamadas('ia_atendente_responder')).toEqual([]);
    expect(chamadas('ia_atendente_passar')).toEqual([]);
  });

  it('a visita (v5): não sai link; a frase da agenda e a passagem, com o imóvel no motivo', async () => {
    const { contexto, chamadas, banco } = montar(
      saidaDoModelo({
        mensagem: 'Claro! Vou te mandar o link da agenda para você escolher o dia e o horário da visita.',
        agenda: { tipo: 'visita', imovelCodigo: ' TE0004 ' },
        motivo: 'Quer visitar o TE0004 na sexta de manhã.',
      }),
    );
    const r = await atenderCliente(contexto, PAYLOAD);

    expect(r).toMatchObject({ feito: true, motivo: 'passou_a_visita' });
    const run = banco.tabelas.ai_runs?.[0] as Record<string, unknown>;
    expect(chamadas('ia_atendente_enviar_link')).toEqual([]);
    expect(chamadas('ia_atendente_responder')).toEqual([]);
    expect(chamadas('ia_atendente_passar')).toEqual([
      {
        p_conversation_id: CONVERSA,
        p_em_resposta_a: ULTIMA,
        p_texto: FRASE_DA_VISITA,
        p_motivo: 'Visita: TE0004 · combinar o dia e o horário com o cliente',
        p_ai_run_id: run.id,
        p_prompt_version: 'atendente-imova@v6',
      },
    ]);
  });

  it('a visita sem imóvel também não chama o banco do link (v5)', async () => {
    const { contexto, chamadas } = montar(saidaDoModelo({ agenda: { tipo: 'visita', imovelCodigo: null } }));
    const r = await atenderCliente(contexto, PAYLOAD);
    expect(r.motivo).toBe('passou_a_visita');
    expect(chamadas('ia_atendente_enviar_link')).toEqual([]);
    expect(String(chamadas('ia_atendente_passar')[0]?.p_motivo)).toMatch(/^Visita: imóvel não informado · /);
  });

  it('o modelo lê os links já mandados, e não lê os horários nem o link cru', async () => {
    const { contexto, pedidos } = montar(saidaDoModelo());
    await atenderCliente(contexto, PAYLOAD);
    const mensagem = pedidos[0]?.mensagem ?? '';
    expect(mensagem).toContain('LINKS DA AGENDA que já saíram nesta conversa (o mais novo primeiro):\n- visita ao IM0003 · saiu há 35 minutos · ainda não agendou');
    expect(mensagem).toContain('[link da agenda]');
    expect(mensagem).not.toMatch(/calendly|HORÁRIOS DE VISITA|12 de novembro/);
    expect(pedidos[0]?.sistema).toContain('A REUNIÃO ONLINE (acao = enviar_link_da_agenda)');
    expect(pedidos[0]?.sistema).toContain('A VISITA PRESENCIAL (ir ver um imóvel ou terreno): NUNCA mande o link');
  });

  it('a reunião com um imóvel é visita disfarçada (v5): a trava passa, sem link', async () => {
    const { contexto, chamadas } = montar(saidaDoModelo({ agenda: { tipo: 'reuniao', imovelCodigo: 'IM0007' } }));
    const r = await atenderCliente(contexto, PAYLOAD);
    expect(r.motivo).toBe('passou_a_visita');
    expect(chamadas('ia_atendente_enviar_link')).toEqual([]);
    expect(chamadas('ia_atendente_passar')[0]).toMatchObject({
      p_texto: FRASE_DA_VISITA,
      p_motivo: 'Visita: IM0007 · combinar o dia e o horário com o cliente',
    });
  });

  it('a reunião que fala em visita também passa pela trava (v5)', async () => {
    const { contexto, chamadas } = montar(
      saidaDoModelo({ mensagem: 'Segue o link para você escolher o horário da visita ao terreno.' }),
    );
    const r = await atenderCliente(contexto, PAYLOAD);
    expect(r.motivo).toBe('passou_a_visita');
    expect(chamadas('ia_atendente_enviar_link')).toEqual([]);
  });

  it('o Calendly escrito numa resposta comum sai do texto (v5)', async () => {
    const { contexto, chamadas } = montar(
      saidaDoModelo({
        acao: 'responder',
        agenda: null,
        mensagem: 'Agende aqui: https://calendly.com/contato-imovaimobiliaria/30min',
      }),
    );
    await atenderCliente(contexto, PAYLOAD);
    expect(chamadas('ia_atendente_responder')[0]?.p_texto).toBe('Agende aqui.');
  });

  it('só o Calendly na resposta comum: vazia, vai para uma pessoa', async () => {
    const { contexto, chamadas } = montar(
      saidaDoModelo({ acao: 'responder', agenda: null, mensagem: 'https://calendly.com/contato-imovaimobiliaria/30min' }),
    );
    const r = await atenderCliente(contexto, PAYLOAD);
    expect(r.motivo).toMatch(/resposta vazia/);
    expect(chamadas('ia_atendente_responder')).toEqual([]);
  });

  it('o endereço do Calendly no caderno não chega ao modelo (v5)', async () => {
    const { contexto, pedidos } = montar(saidaDoModelo(), undefined, {
      caderno: [
        {
          id: 30,
          texto: 'AGENDA: envie o link da nossa agenda: https://calendly.com/contato-imovaimobiliaria/30min',
          origem: 'tela',
        },
      ],
    });
    await atenderCliente(contexto, PAYLOAD);
    expect(pedidos[0]?.sistema).toContain('[30] AGENDA: envie o link da nossa agenda: [link da agenda]');
    expect(pedidos[0]?.sistema).not.toMatch(/calendly/i);
  });

  it('o endereço de site que o modelo escreveu sai do texto; vazio vira o texto padrão', async () => {
    const comLink = montar(saidaDoModelo({ mensagem: 'Agende aqui: https://calendly.com/imova/30min' }));
    await atenderCliente(comLink.contexto, PAYLOAD);
    expect(comLink.chamadas('ia_atendente_enviar_link')[0]?.p_texto).toBe('Agende aqui.');

    const vazio = montar(saidaDoModelo({ mensagem: '' }));
    await atenderCliente(vazio.contexto, PAYLOAD);
    expect(vazio.chamadas('ia_atendente_enviar_link')[0]?.p_texto).toBe(textoDoLink('reuniao'));
  });

  // As recusas que perguntavam o imóvel (visita_sem_imovel, imovel_desconhecido) eram da
  // visita pelo link; desde a v5 a visita não chega ao banco do link (a trava acima).

  it.each(['sem_link_configurado', 'tipo_invalido', 'teto_por_hora', 'porteira', 'motivo_que_ninguem_previu'])(
    'recusa %s: passa para o corretor, com o motivo',
    async (motivo) => {
      const { contexto, chamadas } = montar(saidaDoModelo(), () => ({ ok: false, motivo }));
      const r = await atenderCliente(contexto, PAYLOAD);

      expect(r.motivo).toMatch(/^passou_para_pessoa: /);
      const passou = chamadas('ia_atendente_passar');
      expect(passou).toHaveLength(1);
      expect(String(passou[0]?.p_motivo)).toContain('marcar uma conversa');
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
      acao: 'marcar_visita' as SaidaDoAtendenteV6['acao'],
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

describe('o e-mail para ofertas (v6, 17/11/2026)', () => {
  const resposta = (mudanca: Partial<SaidaDoAtendenteV6> = {}) =>
    saidaDoModelo({ acao: 'responder', agenda: null, mensagem: 'Perfeito, anotado!', ...mudanca });

  it('"aceitou": registra no banco, com a mensagem do cliente como prova, e responde', async () => {
    const { contexto, chamadas } = montar(resposta({ ofertasPorEmail: 'aceitou' }));
    const r = await atenderCliente(contexto, PAYLOAD);
    expect(r.feito).toBe(true);
    expect(chamadas('ia_atendente_ofertas_por_email')).toEqual([
      { p_conversation_id: CONVERSA, p_message_id: ULTIMA, p_aceita: true },
    ]);
    expect(chamadas('ia_atendente_responder')).toHaveLength(1);
  });

  it('"recusou": registra o não', async () => {
    const { contexto, chamadas } = montar(resposta({ ofertasPorEmail: 'recusou' }));
    await atenderCliente(contexto, PAYLOAD);
    expect(chamadas('ia_atendente_ofertas_por_email')).toEqual([
      { p_conversation_id: CONVERSA, p_message_id: ULTIMA, p_aceita: false },
    ]);
  });

  it('sem resposta ao convite, o banco não é chamado', async () => {
    const { contexto, chamadas } = montar(resposta());
    await atenderCliente(contexto, PAYLOAD);
    expect(chamadas('ia_atendente_ofertas_por_email')).toEqual([]);
  });

  it('o modelo lê o que o banco diz do e-mail, sem o endereço', async () => {
    const { contexto, pedidos } = montar(resposta(), undefined, {
      entrada: entradaNoBanco({ email: { na_ficha: false, ofertas: 'recusou', ofertas_em: '2026-11-17' } }),
    });
    await atenderCliente(contexto, PAYLOAD);
    expect(pedidos[0]?.mensagem).toContain(
      'e-mail do cliente: ainda não está na ficha; ofertas por e-mail: recusou (não convide de novo)',
    );
  });

  it('banco sem a chave do e-mail: vale a ficha (e o endereço não vai ao modelo)', async () => {
    const { contexto, pedidos } = montar(resposta());
    await atenderCliente(contexto, PAYLOAD);
    expect(pedidos[0]?.mensagem).toContain('e-mail do cliente: ainda não está na ficha');
    // Com e-mail na ficha, a mesma conversa diz que está.
    const outra = montar(resposta());
    (outra.banco.tabelas.organizations as { email: string | null }[])[0]!.email = 'janio@exemplo.com';
    await atenderCliente(outra.contexto, PAYLOAD);
    expect(outra.pedidos[0]?.mensagem).toContain('e-mail do cliente: já está na ficha');
    expect(outra.pedidos[0]?.mensagem).not.toContain('janio@exemplo.com');
  });

  it('erro ao registrar a resposta não derruba a resposta ao cliente', async () => {
    const { contexto, chamadas } = montar(resposta({ ofertasPorEmail: 'aceitou' }));
    const rpcOriginal = contexto.cliente.rpc.bind(contexto.cliente);
    const cliente = {
      ...(contexto.cliente as unknown as Record<string, unknown>),
      rpc: async (nome: string, argumentos: Record<string, unknown>) =>
        nome === 'ia_atendente_ofertas_por_email'
          ? { data: null, error: { message: 'caiu' } }
          : rpcOriginal(nome as never, argumentos as never),
    } as unknown as ClienteDoBanco;
    const r = await atenderCliente({ ...contexto, cliente }, PAYLOAD);
    expect(r.feito).toBe(true);
    expect(chamadas('ia_atendente_responder')).toHaveLength(1);
  });
});

describe('a busca no mapa (v7, 23/11/2026): só com o mapa no worker', () => {
  function comMapa(montado: ReturnType<typeof montar>, voltas: VoltaDoModelo[]) {
    const pedidos: PedidoComFerramentas[] = [];
    const buscas: string[] = [];
    const contexto: ContextoDaIa = {
      ...montado.contexto,
      mapa: {
        buscar: (consulta) => {
          buscas.push(consulta);
          return Promise.resolve({ lugares: [], doCache: false });
        },
      },
      modelo: {
        ...montado.contexto.modelo,
        conversarComFerramentas: (pedido) => {
          pedidos.push(pedido);
          const volta = voltas.shift();
          return volta === undefined ? Promise.reject(new Error('sem volta')) : Promise.resolve(volta);
        },
      },
    };
    return { contexto, pedidos, buscas };
  }
  const uso = { entrada: 100, saida: 20, escritaDeCache: 0, leituraDeCache: 0 };

  it('com mapa: a v8 (a v7 com a foto) com a ferramenta; a busca vai ao mapa e a resposta cita a volta final', async () => {
    const montado = montar(saidaDoModelo());
    const { contexto, pedidos, buscas } = comMapa(montado, [
      {
        tipo: 'ferramentas',
        chamadas: [{ id: 't1', nome: 'buscar_no_mapa', entrada: { referencia: 'Condomínio Serv Club', cidade: 'Nísia Floresta' } }],
        conteudo: [{ type: 'tool_use', id: 't1', name: 'buscar_no_mapa', input: {} }],
        uso,
        modelo: 'claude-haiku-5-5',
        paradaPor: 'tool_use',
      },
      {
        tipo: 'final',
        json: { ...saidaDoModelo(), fotoParaConfirmar: null, visita: null },
        uso,
        modelo: 'claude-haiku-5-5',
        paradaPor: 'end_turn',
      },
    ]);
    const r = await atenderCliente(contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: true, motivo: 'enviar_link_da_agenda' });
    // Não achado com a cidade, o sistema repete sem ela (conserto 1 do mapa, 24/11/2026).
    expect(buscas).toEqual(['Condomínio Serv Club, Nísia Floresta, RN', 'Condomínio Serv Club, RN']);
    expect(pedidos).toHaveLength(2);
    expect(pedidos[0]?.ferramentas.map((f) => f.nome)).toEqual(['buscar_no_mapa']);
    expect(pedidos[0]?.sistema).toContain('A BUSCA NO MAPA:');
    const runs = montado.banco.tabelas.ai_runs as Record<string, unknown>[];
    expect(runs.map((x) => x.prompt_version)).toEqual(['atendente-imova@v9', 'atendente-imova@v9']);
    expect(montado.chamadas('ia_atendente_enviar_link')[0]).toMatchObject({
      p_ai_run_id: runs[1]?.id,
      p_prompt_version: 'atendente-imova@v9',
    });
    expect(montado.pedidos).toHaveLength(0);
  });

  it('sem mapa: a v6 de sempre, sem ferramenta (é a volta fácil)', async () => {
    const montado = montar(saidaDoModelo());
    await atenderCliente(montado.contexto, PAYLOAD);
    const runs = montado.banco.tabelas.ai_runs as Record<string, unknown>[];
    expect(runs.map((x) => x.prompt_version)).toEqual(['atendente-imova@v6']);
    expect(montado.pedidos[0]?.sistema).not.toContain('A BUSCA NO MAPA:');
  });
});

describe('a foto para confirmar o imóvel (v8, 24/11/2026)', () => {
  const uso = { entrada: 100, saida: 20, escritaDeCache: 0, leituraDeCache: 0 };
  const CAPA = 'te0004/capa.jpg';
  const TEXTO = 'É o nosso terreno de frente para o mar em Tabatinga, perto de Camurupim.';
  const saidaComFoto = (legenda = 'É este aqui que você viu?') => ({
    ...saidaDoModelo({ acao: 'responder', mensagem: TEXTO, agenda: null }),
    fotoParaConfirmar: { imovelCodigo: 'TE0004', legenda },
    visita: null,
  });

  function comMapa(saida: Record<string, unknown>, opcoes: Parameters<typeof montar>[2] = {}) {
    const montado = montar(saidaDoModelo(), undefined, opcoes);
    const contexto: ContextoDaIa = {
      ...montado.contexto,
      mapa: { buscar: () => Promise.resolve({ lugares: [], doCache: false }) },
      modelo: {
        ...montado.contexto.modelo,
        conversarComFerramentas: () =>
          Promise.resolve({ tipo: 'final', json: saida, uso, modelo: 'claude-haiku-5-5', paradaPor: 'end_turn' }),
      },
    };
    return { ...montado, contexto };
  }
  const capaExiste = { ia_atendente_capa_do_imovel: () => ({ anuncio_id: 'a', codigo: 'TE0004_IMOVA', caminho: CAPA }) };
  const fotoNoBalde = { [`anuncios/${CAPA}`]: new Blob(['jpg']) };

  it('o texto sai sem a pergunta, a capa é copiada para mensagens/ia/<conversa>/ e a foto sai depois, com a legenda', async () => {
    const m = comMapa(saidaComFoto(), {
      rpcs: { ...capaExiste, ia_atendente_mostrar_foto: () => ({ ok: true, message_id: 'f' }) },
      arquivos: fotoNoBalde,
    });
    const r = await atenderCliente(m.contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: true, motivo: 'respondeu_com_foto', detalhes: { foto: { codigo: 'TE0004_IMOVA', saiu: true } } });
    expect(m.chamadas('ia_atendente_responder')[0]?.p_texto).toBe(TEXTO);
    expect(m.banco.downloads).toEqual([{ balde: 'anuncios', caminho: CAPA }]);
    expect(m.banco.uploads).toHaveLength(1);
    expect(m.banco.uploads[0]).toMatchObject({ balde: 'mensagens', tipo: 'image/jpeg' });
    expect(m.banco.uploads[0]?.caminho).toMatch(new RegExp(`^ia/${CONVERSA}/[0-9a-f-]{36}\\.jpg$`));
    const nomes = m.banco.chamadasDeRpc.map((c) => c.nome);
    expect(nomes.indexOf('ia_atendente_mostrar_foto')).toBeGreaterThan(nomes.indexOf('ia_atendente_responder'));
    expect(m.chamadas('ia_atendente_mostrar_foto')[0]).toMatchObject({
      p_conversation_id: CONVERSA,
      p_em_resposta_a: ULTIMA,
      p_imovel_codigo: 'TE0004_IMOVA',
      p_media_path: m.banco.uploads[0]?.caminho,
      p_legenda: 'É este aqui que você viu?',
      p_prompt_version: 'atendente-imova@v9',
    });
  });

  it('o registro do texto não leva a chave "foto": a porta da foto no banco recusaria (1º teste real, 24/11)', async () => {
    // A mesma regra de `public.ia_atendente_mostrar_foto` (migração 20261124170000): a foto só
    // sai se houver o registro do texto daquela resposta SEM `detalhes ? 'foto'`.
    const textos: Record<string, unknown>[] = [];
    const m = comMapa(saidaComFoto(), {
      rpcs: {
        ...capaExiste,
        ia_atendente_responder: (a) => {
          textos.push((a.p_detalhes ?? {}) as Record<string, unknown>);
          return { ok: true, message_id: 'r' };
        },
        ia_atendente_mostrar_foto: () =>
          textos.some((d) => !('foto' in d)) ? { ok: true, message_id: 'f' } : { ok: false, motivo: 'sem_texto_antes' },
      },
      arquivos: fotoNoBalde,
    });
    const r = await atenderCliente(m.contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: true, motivo: 'respondeu_com_foto' });
    expect(textos).toHaveLength(1);
    expect(textos[0]).not.toHaveProperty('foto');
    expect(textos[0]).toMatchObject({ foto_pedida: { codigo: 'TE0004_IMOVA', pronta: true } });
  });

  it('anúncio sem foto (ou código desconhecido): a pergunta vai no texto e nenhuma foto é pedida', async () => {
    const m = comMapa(saidaComFoto(), { rpcs: { ia_atendente_capa_do_imovel: () => null } });
    const r = await atenderCliente(m.contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: true, motivo: 'responder', detalhes: { foto: { saiu: false } } });
    expect(m.chamadas('ia_atendente_responder')[0]?.p_texto).toBe(`${TEXTO} É este aqui que você viu?`);
    expect(m.chamadas('ia_atendente_mostrar_foto')).toEqual([]);
    expect(m.banco.uploads).toEqual([]);
  });

  it('a mesma foto já foi mandada nesta conversa: não copia de novo, a pergunta vai no texto', async () => {
    const entrada = entradaNoBanco();
    const mensagens = [
      ...(entrada.mensagens as Record<string, unknown>[]).slice(0, 2),
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000009',
        de: 'ia',
        quem: null,
        quando: '11/11 14:30',
        texto: '[foto do anúncio TE0004_IMOVA que você mandou] É este aqui que você viu?',
      },
      ...(entrada.mensagens as Record<string, unknown>[]).slice(2),
    ];
    const m = comMapa(saidaComFoto(), { rpcs: capaExiste, arquivos: fotoNoBalde, entrada: { ...entrada, mensagens } });
    await atenderCliente(m.contexto, PAYLOAD);
    expect(m.banco.downloads).toEqual([]);
    expect(m.chamadas('ia_atendente_responder')[0]?.p_texto).toBe(`${TEXTO} É este aqui que você viu?`);
    expect(m.chamadas('ia_atendente_mostrar_foto')).toEqual([]);
  });

  it('o Storage recusou a cópia: a pergunta vai no texto, e a resposta não cai', async () => {
    const m = comMapa(saidaComFoto(), { rpcs: capaExiste, arquivos: fotoNoBalde, erroNaSubida: 'sem espaço' });
    const r = await atenderCliente(m.contexto, PAYLOAD);
    expect(r.feito).toBe(true);
    expect(m.chamadas('ia_atendente_responder')[0]?.p_texto).toBe(`${TEXTO} É este aqui que você viu?`);
    expect(m.chamadas('ia_atendente_mostrar_foto')).toEqual([]);
  });

  it('o banco recusou a foto depois do texto: a resposta conta como respondida, sem foto', async () => {
    const m = comMapa(saidaComFoto(), {
      rpcs: { ...capaExiste, ia_atendente_mostrar_foto: () => ({ ok: false, motivo: 'chegou_mensagem_nova' }) },
      arquivos: fotoNoBalde,
    });
    const r = await atenderCliente(m.contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: true, motivo: 'responder', detalhes: { foto: { saiu: false } } });
    expect(m.chamadas('ia_atendente_responder')[0]?.p_texto).toBe(TEXTO);
  });

  it('legenda vazia vira a padrão; o texto da resposta nunca leva a pergunta duas vezes', async () => {
    const m = comMapa(saidaComFoto('   '), { rpcs: { ia_atendente_capa_do_imovel: () => null } });
    await atenderCliente(m.contexto, PAYLOAD);
    expect(m.chamadas('ia_atendente_responder')[0]?.p_texto).toBe(`${TEXTO} É este aqui que você viu?`);
  });

  it('sem foto pedida, nada muda: nem capa, nem cópia', async () => {
    const m = comMapa({ ...saidaDoModelo({ acao: 'responder', mensagem: TEXTO, agenda: null }), fotoParaConfirmar: null, visita: null }, {
      rpcs: capaExiste,
      arquivos: fotoNoBalde,
    });
    const r = await atenderCliente(m.contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: true, motivo: 'responder' });
    expect(m.chamadas('ia_atendente_capa_do_imovel')).toEqual([]);
    expect(m.banco.downloads).toEqual([]);
  });
});

describe('o pedido de visita (v9, 24/11/2026)', () => {
  const uso = { entrada: 100, saida: 20, escritaDeCache: 0, leituraDeCache: 0 };
  const FRASE = 'Perfeito! Vou consultar um horário em que entre na minha agenda e te retorno pra combinarmos.';
  const pedido = { imovelCodigo: 'TE0004', data: '2026-11-26', periodo: 'manha', comoDisse: 'quinta de manhã' } as const;
  interface Pedido {
    readonly imovelCodigo: string;
    readonly data: string | null;
    readonly periodo: 'manha' | 'tarde' | 'noite' | null;
    readonly comoDisse: string;
  }
  const saidaDaVisita = (visita: Pedido | null) => ({
    ...saidaDoModelo({ acao: 'passar_para_corretor', mensagem: FRASE, agenda: null, motivo: 'Visita na quinta de manhã.' }),
    fotoParaConfirmar: null,
    visita,
  });

  function comMapa(saida: Record<string, unknown>, opcoes: Parameters<typeof montar>[2] = {}) {
    const montado = montar(saidaDoModelo(), undefined, opcoes);
    const contexto: ContextoDaIa = {
      ...montado.contexto,
      mapa: { buscar: () => Promise.resolve({ lugares: [], doCache: false }) },
      modelo: {
        ...montado.contexto.modelo,
        conversarComFerramentas: () =>
          Promise.resolve({ tipo: 'final', json: saida, uso, modelo: 'claude-haiku-5-5', paradaPor: 'end_turn' }),
      },
    };
    return { ...montado, contexto };
  }

  it('passa a conversa com a frase do caderno e, depois, grava o pedido para os admins', async () => {
    const m = comMapa(saidaDaVisita(pedido), {
      rpcs: { ia_atendente_pedir_visita: () => ({ ok: true, pedido_id: 'p1' }) },
    });
    const r = await atenderCliente(m.contexto, PAYLOAD);
    expect(r).toMatchObject({
      feito: true,
      motivo: 'pediu_a_visita',
      detalhes: { visita: { codigo: 'TE0004', gravado: true, motivo: null } },
    });
    expect(m.chamadas('ia_atendente_passar')[0]).toMatchObject({ p_texto: FRASE });
    const nomes = m.banco.chamadasDeRpc.map((c) => c.nome);
    expect(nomes.indexOf('ia_atendente_pedir_visita')).toBeGreaterThan(nomes.indexOf('ia_atendente_passar'));
    expect(m.chamadas('ia_atendente_pedir_visita')[0]).toMatchObject({
      p_conversation_id: CONVERSA,
      p_em_resposta_a: ULTIMA,
      p_imovel_codigo: 'TE0004',
      p_data: '2026-11-26',
      p_periodo: 'manha',
      p_como_disse: 'quinta de manhã',
      p_prompt_version: 'atendente-imova@v9',
    });
    // Sem hora nas palavras do cliente, a chamada é a de antes (sem `p_hora`).
    expect(m.chamadas('ia_atendente_pedir_visita')[0]).not.toHaveProperty('p_hora');
  });

  it('a hora que o cliente pediu vai junto (25/11/2026): "sábado às 10h"', async () => {
    const m = comMapa(
      saidaDaVisita({ imovelCodigo: 'PT0001', data: '2026-11-28', periodo: null, comoDisse: 'sábado às 10h' }),
      { rpcs: { ia_atendente_pedir_visita: () => ({ ok: true, pedido_id: 'p2' }) } },
    );
    await atenderCliente(m.contexto, PAYLOAD);
    expect(m.chamadas('ia_atendente_pedir_visita')[0]).toMatchObject({
      p_data: '2026-11-28',
      p_periodo: null,
      p_como_disse: 'sábado às 10h',
      p_hora: '10:00',
    });
  });

  it('o banco recusou o pedido (ou a porta não existe): a passagem vale, e fica o aviso no log', async () => {
    const m = comMapa(saidaDaVisita(pedido), {
      rpcs: {
        ia_atendente_pedir_visita: () => {
          throw new Error('function public.ia_atendente_pedir_visita does not exist');
        },
      },
    });
    const r = await atenderCliente(m.contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: true, motivo: 'passar_para_corretor', detalhes: { visita: { gravado: false } } });
    expect(m.chamadas('ia_atendente_passar')).toHaveLength(1);
  });

  it('passagem sem visita: nenhum pedido', async () => {
    const m = comMapa(saidaDaVisita(null), { rpcs: { ia_atendente_pedir_visita: () => ({ ok: true }) } });
    const r = await atenderCliente(m.contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: true, motivo: 'passar_para_corretor' });
    expect(m.chamadas('ia_atendente_pedir_visita')).toEqual([]);
  });

  it('a passagem recusada pelo banco não grava pedido', async () => {
    const m = comMapa(saidaDaVisita(pedido), {
      rpcs: {
        ia_atendente_passar: () => ({ ok: false, motivo: 'chegou_mensagem_nova' }),
        ia_atendente_pedir_visita: () => ({ ok: true }),
      },
    });
    await atenderCliente(m.contexto, PAYLOAD);
    expect(m.chamadas('ia_atendente_pedir_visita')).toEqual([]);
  });
});
