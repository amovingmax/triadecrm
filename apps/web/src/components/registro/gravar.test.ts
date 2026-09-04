import { describe, expect, it } from 'vitest';

import {
  ETAPAS_FORNECEDOR,
  FERIADOS_2026,
  LIG_NAO_ATENDEU,
  LIG_REUNIAO_MARCADA,
  LIG_SEM_INTERESSE,
  REU_AUTORIZOU,
  VIS_DECISOR_INTERESSADO,
  WA_OPTOUT,
  WA_RESPONDEU,
} from './catalogo.fixtures';
import { mensagemDoErro, montarRegistro, type EntradaDoRegistro } from './gravar';
import {
  argumentosDaRpc,
  MENSAGENS_DE_RECUSA,
  preverRegistro,
  registroContatoSchema,
  resultadoRegistroSchema,
  validarExtras,
  type AlvoDoRegistro,
  type DesfechoCatalogo,
} from './tipos';

const SEXTA_10H = new Date('2026-09-04T10:00:00-03:00');

/** Um parceiro real da base: negócio no funil fornecedor, frio, sem contato. */
const BUFFET: AlvoDoRegistro = {
  id: '94a4ce96-1339-4fa5-b0b2-cc33f77a4ab8',
  nome: 'Abracadabra Festas',
  bairro: 'Lagoa Nova',
  cidade: 'Natal',
  categoria: 'Buffet',
  temperatura: 'frio',
  etapa: 'Prospectado',
  etapaId: 12,
  dealId: 'b4eb6e39-d5ad-4144-932e-ff7fe921d894',
  pipelineId: 1,
  diasSemContato: null,
  precisaAtencao: false,
  cooldownAte: null,
  bloqueado: false,
  naoContatar: false,
};

function entrada(
  desfecho: DesfechoCatalogo,
  extras: Partial<EntradaDoRegistro> = {},
): EntradaDoRegistro {
  return {
    alvo: BUFFET,
    desfecho,
    superficie: desfecho.surfaces[0] as EntradaDoRegistro['superficie'],
    comQuem: 'decisor',
    ocorridoEm: SEXTA_10H,
    previsao: preverRegistro(desfecho, {
      ocorridoEm: SEXTA_10H,
      comQuem: 'decisor',
      temperaturaAtual: BUFFET.temperatura,
      etapasAlvo: ETAPAS_FORNECEDOR,
      pipelineId: BUFFET.pipelineId,
      feriados: FERIADOS_2026,
    }),
    clientKey: '11111111-1111-4111-8111-111111111111',
    ...extras,
  };
}

describe('o pedido que sai do navegador', () => {
  it('leva o negócio e a etapa que a tela viu, para pegar quem mexeu antes', () => {
    const registro = montarRegistro(entrada(VIS_DECISOR_INTERESSADO));
    expect(registro.organizationId).toBe(BUFFET.id);
    expect(registro.dealId).toBe(BUFFET.dealId);
    expect(registro.etapaEsperadaId).toBe(12);
    expect(registro.outcomeId).toBe(VIS_DECISOR_INTERESSADO.id);
    expect(registro.superficie).toBe('visita');
  });

  it('manda a SUPERFÍCIE e nunca o par (tipo, canal): quem deriva é o banco', () => {
    const argumentos = argumentosDaRpc(montarRegistro(entrada(WA_RESPONDEU)));
    expect(Object.keys(argumentos)).not.toContain('p_type');
    expect(Object.keys(argumentos)).not.toContain('p_channel');
    expect(argumentos.p_outcome_id).toBe(WA_RESPONDEU.id);
  });

  it('a próxima ação viaja pronta, com a data que o recibo mostrou', () => {
    const argumentos = argumentosDaRpc(montarRegistro(entrada(LIG_NAO_ATENDEU)));
    expect(argumentos.p_next_action_kind).toBe('call');
    expect(argumentos.p_next_action_title).toBe('Ligar D+1 (última)');
    expect(argumentos.p_next_action_at).toBe('2026-09-08T09:00:00-03:00');
  });

  it('desfecho terminal não manda próxima ação nenhuma', () => {
    const argumentos = argumentosDaRpc(
      montarRegistro(entrada(LIG_SEM_INTERESSE, { lostReasonId: 2 })),
    );
    expect(argumentos.p_next_action_at).toBeNull();
    expect(argumentos.p_next_action_kind).toBeNull();
    expect(argumentos.p_lost_reason_id).toBe(2);
  });

  it('duração só existe em reunião: nas outras superfícies o campo nem viaja', () => {
    expect(montarRegistro(entrada(LIG_NAO_ATENDEU, { duracaoMin: 30 })).duracaoMin).toBeNull();
    expect(
      montarRegistro(
        entrada(REU_AUTORIZOU, {
          duracaoMin: 30,
          autorizacaoEvidencia: 'Pode cadastrar meu buffet na Komune.',
        }),
      ).duracaoMin,
    ).toBe(30);
  });

  it('observação vazia é null, não string vazia: o banco guarda ausência, não branco', () => {
    expect(montarRegistro(entrada(LIG_NAO_ATENDEU, { observacao: '   ' })).observacao).toBeNull();
    expect(montarRegistro(entrada(LIG_NAO_ATENDEU, { observacao: ' ok ' })).observacao).toBe('ok');
  });

  it('uma data combinada pela pessoa vence a régua do catálogo', () => {
    const combinada = '2026-09-10T15:00:00.000Z';
    const base = entrada(LIG_REUNIAO_MARCADA, {
      reuniaoEm: combinada,
      reuniaoFormato: 'meet',
    });
    const pedido = montarRegistro({
      ...base,
      previsao: { ...base.previsao, proximaAcaoEm: combinada },
    });
    expect(pedido.reuniaoEm).toBe(combinada);
    expect(pedido.proximaAcao?.em).toBe(combinada);
  });
});

describe('o que o zod recusa antes de gastar a viagem', () => {
  it('reunião com formato e sem data (e vice-versa) não passa', () => {
    const base = montarRegistro(entrada(LIG_NAO_ATENDEU));
    expect(registroContatoSchema.safeParse({ ...base, reuniaoFormato: 'meet' }).success).toBe(
      false,
    );
    expect(
      registroContatoSchema.safeParse({ ...base, reuniaoEm: '2026-09-10T15:00:00.000Z' }).success,
    ).toBe(false);
  });

  it('evidência de autorização curta demais não vale como evidência', () => {
    expect(() => montarRegistro(entrada(REU_AUTORIZOU, { autorizacaoEvidencia: 'ok' }))).toThrow();
  });

  it('id de organização que não é uuid não sai daqui', () => {
    expect(() =>
      montarRegistro(entrada(WA_RESPONDEU, { alvo: { ...BUFFET, id: 'nao-e-uuid' } })),
    ).toThrow();
  });
});

describe('validarExtras cobra o que o catálogo exige, no campo certo', () => {
  it('perda sem motivo', () => {
    const registro = montarRegistro(entrada(LIG_SEM_INTERESSE));
    expect(validarExtras(registro, LIG_SEM_INTERESSE)).toEqual({
      lostReasonId: 'Escolha o motivo da perda.',
    });
  });

  it('reunião sem data e sem formato', () => {
    const registro = montarRegistro(entrada(LIG_REUNIAO_MARCADA));
    expect(validarExtras(registro, LIG_REUNIAO_MARCADA)).toEqual({
      reuniaoEm: 'Quando é a reunião?',
      reuniaoFormato: 'Meet ou presencial?',
    });
  });

  it('opt-out sem confirmação', () => {
    const registro = montarRegistro(entrada(WA_OPTOUT));
    expect(validarExtras(registro, WA_OPTOUT).confirmouOptout).toBeTruthy();
  });

  it('desfecho comum não cobra nada', () => {
    const registro = montarRegistro(entrada(LIG_NAO_ATENDEU));
    expect(validarExtras(registro, LIG_NAO_ATENDEU)).toEqual({});
  });
});

describe('a resposta do banco', () => {
  const aceito = {
    registrado: true,
    repetido: false,
    activity_id: '75f5f609-3f0e-458b-962f-8c385f0297d6',
    deal_id: 'b4eb6e39-d5ad-4144-932e-ff7fe921d894',
    task_id: 'c8c07aae-6aef-4ac1-9853-20c00c1f1a83',
    outcome_slug: 'vis_decisor_interessado',
    etapa_antes: 'Prospectado',
    etapa_depois: 'Em conversa',
    etapa_aplicada: true,
    etapa_recusa: null,
    assumiu_negocio: true,
    temperatura_antes: 'frio',
    temperatura_depois: 'quente',
    precisa_atencao: false,
    porta_aberta: true,
    porta_batida: true,
    cooldown_ate: '2026-09-04T13:20:43.260398-03:00',
    proxima_acao_em: '2026-09-08T09:00:00-03:00',
    proxima_acao_titulo: 'Marcar apresentação ou link',
    sem_negocio: false,
  };

  it('lê a resposta medida no banco local, sem perder nenhum campo', () => {
    const lido = resultadoRegistroSchema.parse(aceito);
    expect(lido.registrado).toBe(true);
    if (lido.registrado) {
      expect(lido.temperatura_antes).toBe('frio');
      expect(lido.temperatura_depois).toBe('quente');
      expect(lido.assumiu_negocio).toBe(true);
    }
  });

  it('recusa prevista vira frase em português, nunca texto do Postgres', () => {
    const recusa = resultadoRegistroSchema.parse({
      registrado: false,
      motivo: 'motivo_de_perda_obrigatorio',
      detalhe: null,
    });
    expect(recusa.registrado).toBe(false);
    if (!recusa.registrado) {
      expect(MENSAGENS_DE_RECUSA[recusa.motivo]).toBe('Perda exige motivo (RF-FUN-04).');
    }
  });

  it('etapa recusada por funil não perde a atividade: `etapa_aplicada` é falso e pronto', () => {
    const lido = resultadoRegistroSchema.parse({
      ...aceito,
      etapa_aplicada: false,
      etapa_recusa: 'etapa_fora_do_funil',
      etapa_depois: 'Identificado',
      temperatura_depois: 'frio',
      assumiu_negocio: false,
    });
    expect(lido.registrado).toBe(true);
    if (lido.registrado) expect(lido.etapa_recusa).toBe('etapa_fora_do_funil');
  });

  /**
   * A recusa do guardrail (RF-CON-18) precisa estar no enum, senão o zod recusa a
   * resposta INTEIRA: `gravarRegistro` levanta "o servidor respondeu de um jeito que
   * esta versão da tela não entende", a tela diz "não deu para registrar" e a fila
   * marca como parado um contato que ESTÁ gravado no banco. Medido com um número na
   * `suppression_list` (organização sem `do_not_contact`), migração 001200.
   */
  it('contato suprimido é recusa de ETAPA, não resposta ilegível', () => {
    const lido = resultadoRegistroSchema.parse({
      ...aceito,
      task_id: null,
      etapa_aplicada: false,
      etapa_recusa: 'contato_suprimido',
      etapa_depois: 'Prospectado',
      temperatura_depois: 'frio',
      assumiu_negocio: false,
      proxima_acao_em: null,
      proxima_acao_titulo: null,
    });
    expect(lido.registrado).toBe(true);
    if (lido.registrado) {
      expect(lido.etapa_recusa).toBe('contato_suprimido');
      expect(lido.task_id).toBeNull();
    }
  });
});

describe('erro de infraestrutura também fala português', () => {
  it.each([
    ['42501', false],
    ['PGRST301', false],
    ['23514', false],
    [undefined, true],
  ])('o código %s vira frase, e diz se vale a pena guardar na fila', (codigo, repetivel) => {
    const { frase, podeTentarDeNovo } = mensagemDoErro(codigo);
    expect(frase).toMatch(/[a-zç]/i);
    expect(frase).not.toMatch(/violates|constraint|null value|permission denied/i);
    expect(podeTentarDeNovo).toBe(repetivel);
  });
});
