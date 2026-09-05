import { describe, expect, it } from 'vitest';

import { bancoFalso, type LinhaFalsa, type TabelasFalsas } from './banco-de-teste';
import { clienteDuble } from './duble';
import { ErroDeterministico, tratarTrabalho } from './tarefas';

import type { ContextoDaIa } from './execucao';
import type { LogFields, Logger } from '../lib/log';

function loggerDeTeste(): { logger: Logger; linhas: { nivel: string; msg: string; campos: LogFields }[] } {
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

// Ids de verdade: o payload da fila exige uuid, e um fixture que não passasse
// pelo próprio contrato não provaria nada sobre o worker.
const ORG = '11111111-1111-4111-8111-111111111111';
const CONTATO = '22222222-2222-4222-8222-222222222222';
const CONVERSA = '33333333-3333-4333-8333-333333333333';
const MENSAGEM = '44444444-4444-4444-8444-444444444444';
const ATIVIDADE = '55555555-5555-4555-8555-555555555555';
const NEGOCIO = '66666666-6666-4666-8666-666666666666';
const ROTEIRO = '77777777-7777-4777-8777-777777777777';
const TENTATIVA = '88888888-8888-4888-8888-888888888888';
const PERFIL = '99999999-9999-4999-8999-999999999999';

const ARVORE = [
  {
    id: 'abertura',
    texto: 'Bom dia! Aqui é a Heloísa, da Komune. Falo com quem cuida dos eventos?',
    saidas: [
      { rotulo: 'Sou eu, pode falar', destino: 'gancho_fornecedor' },
      { rotulo: 'Não é comigo', destino: 'pedir_decisor' },
    ],
  },
  {
    id: 'gancho_fornecedor',
    texto: 'A Komune é um app de eventos daqui de Natal. Quantos eventos vocês fazem por mês?',
    saidas: [{ rotulo: 'Ele respondeu quantos', destino: 'obj_comissao' }],
  },
  {
    id: 'obj_comissao',
    texto: 'Os 8% só existem sobre o evento que chegou pela Komune e fechou.',
    saidas: [{ rotulo: 'Ficou de pensar', destino: 'fim_retorna' }],
  },
  { id: 'fim_retorna', texto: 'Perfeito, eu ligo terça. Obrigada!', saidas: [] },
];

function tabelas(): TabelasFalsas {
  return {
    ai_runs: [],
    tasks: [],
    message_drafts: [],
    audio_assets: [{ slug: 'aeb-taxa-8-porcento' }],
    organizations: [{ id: ORG, owner_id: PERFIL, name: 'Buffet Aurora', phone_e164: '+5584999880011', vip: false }],
    profiles: [{ id: PERFIL, is_active: true, role: 'admin', created_at: '2026-01-01' }],
    contacts: [
      {
        id: CONTATO,
        full_name: 'Joana Medeiros',
        first_name: 'Joana',
        phone_e164: '+5584999880011',
        email: 'joana@buffetaurora.com.br',
        instagram_handle: '@buffetaurora',
      },
    ],
    organization_categories: [
      {
        organization_id: ORG,
        categories: { slug: 'buffet_adulto_corporativo', group: 'alimentos_bebidas' },
      },
    ],
    conversations: [
      {
        id: CONVERSA,
        organization_id: ORG,
        contact_id: CONTATO,
        peer_phone_e164: '+5584999880011',
        ai_summary: null,
        ai_intent: null,
        ai_confidence: null,
        bot_paused: false,
        status: 'aguardando_nos',
        last_message_at: '2026-09-05T10:00:00Z',
      },
    ],
    messages: [
      {
        id: MENSAGEM,
        conversation_id: CONVERSA,
        organization_id: ORG,
        contact_id: CONTATO,
        type: 'audio',
        direction: 'in',
        body: null,
        transcript: null,
      },
    ],
    activities: [{ id: ATIVIDADE, body: 'Achou 8% salgado, mas ouviu. Pediu retorno terça de manhã.', deal_id: NEGOCIO, metadata: { com_quem: 'decisor' } }],
    interaction_outcomes: [{ id: 7, slug: 'lig_atendeu_retorna' }],
    call_scripts: [{ id: ROTEIRO, arvore: ARVORE }],
    call_attempts: [
      {
        id: TENTATIVA,
        organization_id: ORG,
        contact_id: CONTATO,
        activity_id: ATIVIDADE,
        variante: 'fornecedor',
        duracao_seg: 214,
        caminho_script: ['abertura', 'gancho_fornecedor', 'obj_comissao', 'fim_retorna'],
        capturas: { eventos_por_mes: '6', retorno_combinado: 'terça de manhã' },
        script_id: ROTEIRO,
        outcome_id: 7,
      },
    ],
  };
}

function montar(dubleOpcoes = {}, extras: TabelasFalsas = {}) {
  const banco = bancoFalso({ ...tabelas(), ...extras });
  const { logger, linhas } = loggerDeTeste();
  const duble = clienteDuble(dubleOpcoes);
  const contexto: ContextoDaIa = { cliente: banco.cliente, modelo: duble, logger };
  return { banco, contexto, linhas, duble };
}

describe('1. transcrever o áudio recebido (R13, RF-CON-27)', () => {
  it('grava a transcrição reidratada e, no MVP, manda a conversa para uma pessoa', async () => {
    const { banco, contexto, duble } = montar();

    const resultado = await tratarTrabalho(contexto, {
      purpose: 'transcribe_audio',
      chave: `msg:${MENSAGEM}`,
      message_id: MENSAGEM,
      transcricao_bruta: 'oi é... aqui é a Joana do Buffet Aurora, tipo assim eu tenho interesse sim',
      confianca_asr: 0.92,
      duracao_seg: 22,
      contexto: null,
    });

    expect(resultado.feito).toBe(true);
    expect(duble.chamadas).toEqual(['transcricao']);

    const mensagem = banco.tabelas.messages?.[0] as LinhaFalsa;
    // Reidratada: quem lê `messages.transcript` é gente, e ela precisa do nome.
    expect(String(mensagem.transcript)).toContain('Joana');
    expect(String(mensagem.transcript)).not.toContain('[[NOME_');
    // E a hesitação saiu, então o texto gravado não é o que entrou.
    expect(String(mensagem.transcript)).not.toContain('é...');

    // Mas o que ficou em ai_runs continua pseudonimizado (ADR-09).
    const corrida = banco.tabelas.ai_runs?.[0] as LinhaFalsa;
    expect(JSON.stringify(corrida.output)).not.toContain('Joana');
    expect(JSON.stringify(corrida.output)).toContain('[[NOME_');
    expect(corrida.conversation_id).toBe(CONVERSA);

    // RF-CON-27: no MVP, áudio recebido é sempre de gente.
    const conversa = banco.tabelas.conversations?.[0] as LinhaFalsa;
    expect(conversa.bot_paused).toBe(true);
    expect(resultado.detalhes?.destino).toBe('humano');
    expect(resultado.detalhes?.motivos).toContain('mvp_audio_sempre_humano');
    // E nada foi enfileirado para o classificador.
    expect(banco.chamadasDeRpc.filter((c) => c.nome === 'esteira_fila_enfileirar')).toHaveLength(0);
  });

  it('mensagem que não existe é erro determinístico, não tentativa perdida', async () => {
    const { contexto } = montar();
    await expect(
      tratarTrabalho(contexto, {
        purpose: 'transcribe_audio',
        chave: 'x',
        message_id: '00000000-0000-4000-8000-000000000999',
        transcricao_bruta: 'oi',
        confianca_asr: 0.9,
        duracao_seg: 5,
      }),
    ).rejects.toBeInstanceOf(ErroDeterministico);
  });

  it('payload fora do contrato não vira chamada paga', async () => {
    const { contexto, duble } = montar();
    await expect(
      tratarTrabalho(contexto, {
        purpose: 'transcribe_audio',
        chave: 'x',
        message_id: MENSAGEM,
        confianca_asr: 3,
      }),
    ).rejects.toBeInstanceOf(ErroDeterministico);
    expect(duble.chamadas).toHaveLength(0);
  });
});

describe('2. resumir a ligação (R13 §3.2)', () => {
  it('escreve o resumo onde a linha do tempo lê e enfileira o follow-up', async () => {
    const { banco, contexto, duble } = montar();

    const resultado = await tratarTrabalho(contexto, {
      purpose: 'summarize_call',
      chave: `attempt:${TENTATIVA}`,
      attempt_id: TENTATIVA,
    });

    expect(resultado.feito).toBe(true);
    expect(duble.chamadas).toEqual(['resumo']);

    const atividade = banco.tabelas.activities?.[0] as LinhaFalsa;
    const metadata = atividade.metadata as Record<string, unknown>;
    // O merge preserva o que o gatilho do banco já tinha escrito.
    expect(metadata.com_quem).toBe('decisor');
    const resumo = metadata.resumo_ia as Record<string, unknown>;
    expect(String(resumo.resumo)).toContain('lig_atendeu_retorna');
    expect(resumo.prompt_version).toBe('resumo-ligacao@v1');
    // A regra do R13 §3.2 confere o modelo: os dois acharam o mesmo nó.
    expect(resumo.no_de_virada).toBe('obj_comissao');
    expect(resumo.no_de_virada_por_regra).toBe('obj_comissao');

    // O ciclo continua: liga, resume, ESCREVE.
    const enfileirados = banco.chamadasDeRpc.filter((c) => c.nome === 'esteira_fila_enfileirar');
    expect(enfileirados).toHaveLength(1);
    expect(enfileirados[0]?.argumentos.p_key).toBe(`draft_followup:attempt:${TENTATIVA}`);
    expect(enfileirados[0]?.argumentos.p_payload).toMatchObject({
      purpose: 'draft_followup',
      chave: `attempt:${TENTATIVA}`,
      attempt_id: TENTATIVA,
    });
  });

  it('ninguém atendeu: caminho vazio não vira chamada ao modelo', async () => {
    const semCaminho = tabelas();
    (semCaminho.call_attempts?.[0] as LinhaFalsa).caminho_script = [];
    const banco = bancoFalso(semCaminho);
    const { logger } = loggerDeTeste();
    const duble = clienteDuble();

    const resultado = await tratarTrabalho(
      { cliente: banco.cliente, modelo: duble, logger },
      { purpose: 'summarize_call', chave: 'x', attempt_id: TENTATIVA },
    );

    expect(resultado.feito).toBe(false);
    expect(resultado.motivo).toBe('caminho_vazio');
    expect(duble.chamadas).toHaveLength(0);
    expect(banco.tabelas.ai_runs).toHaveLength(0);
  });
});

describe('3. redigir o follow-up (ADR-05, RF-CON-24)', () => {
  async function comResumo() {
    const montado = montar();
    await tratarTrabalho(montado.contexto, {
      purpose: 'summarize_call',
      chave: `attempt:${TENTATIVA}`,
      attempt_id: TENTATIVA,
    });
    return montado;
  }

  it('o rascunho entra PENDENTE na fila de aprovação, nunca enviado', async () => {
    const { banco, contexto } = await comResumo();

    const resultado = await tratarTrabalho(contexto, {
      purpose: 'draft_followup',
      chave: `attempt:${TENTATIVA}`,
      attempt_id: TENTATIVA,
    });

    expect(resultado.feito).toBe(true);
    const rascunho = banco.tabelas.message_drafts?.[0] as LinhaFalsa;
    expect(rascunho.status).toBe('pendente');
    expect(rascunho.kind).toBe('followup_ligacao');
    expect(rascunho.organization_id).toBe(ORG);
    expect(rascunho.conversation_id).toBe(CONVERSA);
    expect(rascunho.deal_id).toBe(NEGOCIO);
    expect(rascunho.prompt_version).toBe('followup-ligacao@v1');
    // Reidratado: é uma pessoa que vai ler e enviar.
    expect(String(rascunho.proposed_body)).toContain('Joana');
    expect(String(rascunho.proposed_body)).not.toContain('[[NOME_');
    // O veredito do validador fica na linha — é a prova de que ele rodou.
    expect((rascunho.validator as Record<string, unknown>).situacao).toBe('aprovado');
    // Nenhuma mensagem foi criada. Nada sai sozinho (ADR-05).
    expect(banco.tabelas.messages?.filter((m) => m.direction === 'out')).toHaveLength(0);
  });

  it('rascunho que promete o que não pode entra assim mesmo, com o bloqueio escrito', async () => {
    const { banco, contexto } = await comResumo();
    const proibido = {
      mensagem: 'Oi, [[NOME_1]], eu garanto o dobro de eventos e ainda te dou 50% de desconto na taxa.',
      claims: [],
      audioSugerido: null,
      porQue: 'texto de teste',
    };
    const comPromessa = clienteDuble({ forcar: { followup: proibido } });

    await tratarTrabalho(
      { ...contexto, modelo: comPromessa },
      { purpose: 'draft_followup', chave: `attempt:${TENTATIVA}`, attempt_id: TENTATIVA },
    );

    const rascunho = (banco.tabelas.message_drafts ?? []).at(-1) as LinhaFalsa;
    const validador = rascunho.validator as Record<string, unknown>;
    expect(validador.situacao).toBe('bloqueado');
    expect(validador.queda).not.toBeNull();
    expect(Array.isArray(validador.motivos)).toBe(true);
    expect(JSON.stringify(validador.motivos)).toContain('palavra_proibida');
    // Continua PENDENTE: quem decide é gente, e agora ela vê o veredito.
    expect(rascunho.status).toBe('pendente');
  });

  it('áudio que não existe na biblioteca é descartado, não quebra a gravação', async () => {
    const { banco, contexto, linhas } = await comResumo();
    const comAudioInventado = clienteDuble({
      forcar: {
        followup: {
          mensagem: 'Oi, [[NOME_1]], te ligo terça às 9h30. Fica de pé?',
          claims: [],
          audioSugerido: 'audio-que-nunca-existiu',
          porQue: 'teste',
        },
      },
    });

    await tratarTrabalho(
      { ...contexto, modelo: comAudioInventado },
      { purpose: 'draft_followup', chave: `attempt:${TENTATIVA}`, attempt_id: TENTATIVA },
    );

    const rascunho = (banco.tabelas.message_drafts ?? []).at(-1) as LinhaFalsa;
    expect(rascunho.proposed_audio_slug).toBeNull();
    expect(linhas.some((l) => l.nivel === 'warn' && l.msg.includes('áudio'))).toBe(true);
  });

  it('sem resumo não há follow-up: mensagem genérica é mensagem errada', async () => {
    const { contexto, duble } = montar();
    await expect(
      tratarTrabalho(contexto, {
        purpose: 'draft_followup',
        chave: 'x',
        attempt_id: TENTATIVA,
      }),
    ).rejects.toBeInstanceOf(ErroDeterministico);
    expect(duble.chamadas).toHaveLength(0);
  });
});

describe('4. classificar a mensagem recebida (RF-CON-19, RF-CON-20)', () => {
  function comTexto(texto: string, extras: LinhaFalsa = {}) {
    const base = tabelas();
    Object.assign(base.messages?.[0] as LinhaFalsa, { type: 'text', body: texto }, extras);
    const banco = bancoFalso(base);
    const { logger, linhas } = loggerDeTeste();
    const duble = clienteDuble();
    return { banco, duble, linhas, contexto: { cliente: banco.cliente, modelo: duble, logger } };
  }

  it('opt-out é decidido por regra ANTES da IA — e não gasta uma chamada', async () => {
    const { banco, contexto, duble, linhas } = comTexto('para de mandar mensagem, por favor');

    const resultado = await tratarTrabalho(contexto, {
      purpose: 'classify_inbound',
      chave: `msg:${MENSAGEM}`,
      message_id: MENSAGEM,
    });

    expect(duble.chamadas).toHaveLength(0);
    expect(banco.tabelas.ai_runs).toHaveLength(0);
    expect(resultado.detalhes?.intencao).toBe('OPT_OUT');
    expect(resultado.detalhes?.origem).toBe('regra');

    const conversa = banco.tabelas.conversations?.[0] as LinhaFalsa;
    expect(conversa.ai_intent).toBe('OPT_OUT');
    expect(conversa.bot_paused).toBe(true);
    // E o worker diz, no log, o que ainda não é dele.
    expect(linhas.some((l) => l.nivel === 'warn' && l.msg.includes('opt-out'))).toBe(true);
  });

  it('classifica, grava na conversa e escala quando o assunto é de alto valor', async () => {
    const { banco, contexto, duble } = comTexto('quanto é a taxa? e como fica o contrato?');

    const resultado = await tratarTrabalho(contexto, {
      purpose: 'classify_inbound',
      chave: `msg:${MENSAGEM}`,
      message_id: MENSAGEM,
    });

    expect(duble.chamadas).toEqual(['classificacao']);
    const conversa = banco.tabelas.conversations?.[0] as LinhaFalsa;
    expect(conversa.ai_intent).toBe('PEDIU_TAXA_PRECO');
    expect(Number(conversa.ai_confidence)).toBeGreaterThan(0.7);
    // "contrato" é gatilho do R08 §5.3: vai para gente.
    expect(resultado.detalhes?.escalar).toBe(true);
    expect(resultado.detalhes?.motivos).toContain('termo_de_alto_valor');
    expect(conversa.bot_paused).toBe(true);
  });

  it('mensagem sem texto nenhum não vira chamada', async () => {
    const { contexto, duble } = montar();
    const resultado = await tratarTrabalho(contexto, {
      purpose: 'classify_inbound',
      chave: 'x',
      message_id: MENSAGEM,
    });
    expect(resultado.feito).toBe(false);
    expect(resultado.motivo).toBe('mensagem_sem_texto');
    expect(duble.chamadas).toHaveLength(0);
  });
});

describe('o despachante', () => {
  it('propósito que ninguém tratou é determinístico e diz quais existem', async () => {
    const { contexto } = montar();
    const erro = await tratarTrabalho(contexto, { purpose: 'digest', chave: 'x' }).catch(
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(ErroDeterministico);
    expect((erro as Error).message).toContain('transcribe_audio');
  });
});
