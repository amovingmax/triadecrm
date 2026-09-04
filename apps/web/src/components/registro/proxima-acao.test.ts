import { describe, expect, it } from 'vitest';

import {
  CATALOGO_DE_TESTE,
  ETAPAS_FORNECEDOR,
  FERIADOS_2026,
  LIG_ATENDEU_RETORNA,
  LIG_NAO_ATENDEU,
  LIG_REUNIAO_MARCADA,
  LIG_SEM_INTERESSE,
  REU_AUTORIZOU,
  VIS_DECISOR_INTERESSADO,
  WA_AGORA_NAO,
  WA_OPTOUT,
  WA_RESPONDEU,
} from './catalogo.fixtures';
import {
  comQuemPadrao,
  desfechosDaSuperficie,
  extraDoDesfecho,
  MINUTOS_RESPOSTA_IMEDIATA,
  PAR_DA_SUPERFICIE,
  pedeDataDaProximaAcao,
  perguntaComQuem,
  prazoSugerido,
  preveePortaAberta,
  preverRegistro,
  proximoDiaUtil,
  SUPERFICIES_DO_REGISTRO,
  temProximaAcao,
  TETO_DESFECHOS_POR_SUPERFICIE,
} from './tipos';

/**
 * Uma sexta-feira de verdade: 04/09/2026, 10h de Fortaleza. É o primeiro dia do
 * calendário do MVP e, o que importa aqui, a véspera de um fim de semana emendado com
 * o feriado de 07/09 — o caso em que a régua de dias corridos e o pouso em dia útil se
 * separam de verdade.
 */
const SEXTA_10H = new Date('2026-09-04T10:00:00-03:00');

describe('a próxima ação sai do catálogo, nunca da tela', () => {
  it('D+1 do "não atendeu" pula sábado, domingo e o feriado de 7 de setembro', () => {
    const prazo = prazoSugerido(LIG_NAO_ATENDEU, SEXTA_10H, 'frio', FERIADOS_2026);
    // 04/09 + 1 dia corrido = sábado 05/09 → pousa na terça 08/09 (07/09 é feriado).
    expect(prazo).toBe('2026-09-08T09:00:00-03:00');
  });

  it('offset 0 quer dizer "agora": 15 minutos, não amanhã de manhã', () => {
    const prazo = prazoSugerido(WA_RESPONDEU, SEXTA_10H, 'morno', FERIADOS_2026);
    expect(prazo).toBe(
      new Date(SEXTA_10H.getTime() + MINUTOS_RESPOSTA_IMEDIATA * 60_000).toISOString(),
    );
  });

  it('sem offset, a espera é a régua do RF-MET-06 aplicada à temperatura resultante', () => {
    // `vis_decisor_interessado` não declara offset e resulta quente: D+1.
    expect(prazoSugerido(VIS_DECISOR_INTERESSADO, SEXTA_10H, 'quente', FERIADOS_2026)).toBe(
      '2026-09-08T09:00:00-03:00',
    );
    // O mesmo desfecho, se resultasse frio, esperaria D+7 — 11/09, sexta.
    expect(prazoSugerido(VIS_DECISOR_INTERESSADO, SEXTA_10H, 'frio', FERIADOS_2026)).toBe(
      '2026-09-11T09:00:00-03:00',
    );
  });

  it('a espera de 30 dias do "agora não" é em dias CORRIDOS, e só o pouso é ajustado', () => {
    // 04/09 + 30 dias corridos = 04/10, domingo → pousa em 05/10, segunda.
    // Contar 30 dias ÚTEIS cairia em 20/10 e a próxima ação deixaria de bater com o
    // cooldown de 30 dias, que é corrido.
    expect(prazoSugerido(WA_AGORA_NAO, SEXTA_10H, 'frio', FERIADOS_2026)).toBe(
      '2026-10-05T09:00:00-03:00',
    );
  });

  it('desfecho terminal não marca próxima ação: o próprio desfecho é a justificativa', () => {
    expect(temProximaAcao(LIG_SEM_INTERESSE)).toBe(false);
    expect(temProximaAcao(WA_OPTOUT)).toBe(false);
    expect(prazoSugerido(LIG_SEM_INTERESSE, SEXTA_10H, 'frio', FERIADOS_2026)).toBeNull();
  });

  it('os três desfechos de data combinada não inventam data nenhuma', () => {
    for (const desfecho of [LIG_ATENDEU_RETORNA, LIG_REUNIAO_MARCADA]) {
      expect(pedeDataDaProximaAcao(desfecho)).toBe(true);
      expect(prazoSugerido(desfecho, SEXTA_10H, 'quente', FERIADOS_2026)).toBeNull();
    }
  });

  it('proximoDiaUtil pousa, não conta', () => {
    expect(proximoDiaUtil('2026-09-05', FERIADOS_2026)).toBe('2026-09-08');
    expect(proximoDiaUtil('2026-09-04', FERIADOS_2026)).toBe('2026-09-04');
  });
});

describe('a previsão copia a regra do banco, não a reimplementa', () => {
  const entrada = {
    ocorridoEm: SEXTA_10H,
    comQuem: 'decisor' as const,
    temperaturaAtual: 'frio' as const,
    etapasAlvo: ETAPAS_FORNECEDOR,
    pipelineId: 1,
    feriados: FERIADOS_2026,
  };

  it('leva de frio a quente no funil fornecedor, e diz para onde a etapa vai', () => {
    const previsao = preverRegistro(VIS_DECISOR_INTERESSADO, entrada);
    expect(previsao.temperatura).toBe('quente');
    expect(previsao.moveEtapa).toBe(true);
    expect(previsao.etapaDestino?.nome).toBe('Em conversa');
    expect(previsao.portaAberta).toBe(true);
  });

  it('no funil produtor a etapa não existe, e a previsão não mente uma promoção', () => {
    const previsao = preverRegistro(VIS_DECISOR_INTERESSADO, { ...entrada, pipelineId: 3 });
    expect(previsao.moveEtapa).toBe(false);
    expect(previsao.etapaDestino).toBeNull();
    // A temperatura declarada pelo catálogo continua valendo: é `deals.last_intent`
    // que a produz, e essa coluna existe em qualquer funil.
    expect(previsao.temperatura).toBe('quente');
  });

  it('o cooldown do catálogo vira a janela de recontato, e 36500 dias é "permanente"', () => {
    const rapido = preverRegistro(LIG_NAO_ATENDEU, entrada);
    expect(rapido.cooldownAte).toBe(new Date('2026-09-05T10:00:00-03:00').toISOString());
    expect(rapido.cooldownPermanente).toBe(false);
    expect(preverRegistro(WA_OPTOUT, entrada).cooldownPermanente).toBe(true);
  });

  it('sem etapa alvo e sem temperatura declarada, a previsão mantém a atual', () => {
    const semEfeito = { ...LIG_NAO_ATENDEU, sets_temperature: null };
    expect(preverRegistro(semEfeito, entrada).temperatura).toBe('frio');
  });
});

describe('com quem falou: o formulário AFIRMA, e o que não afirma vira porta batida', () => {
  it('o padrão é o que o nome do desfecho já diz', () => {
    expect(comQuemPadrao(VIS_DECISOR_INTERESSADO)).toBe('decisor');
    expect(comQuemPadrao(LIG_NAO_ATENDEU)).toBe('ninguem');
    expect(comQuemPadrao(REU_AUTORIZOU)).toBe('decisor');
  });

  it('"Respondeu" não afirma quem digitou: o padrão é não informado, e a tela pergunta', () => {
    expect(comQuemPadrao(WA_RESPONDEU)).toBe('nao_informado');
    expect(perguntaComQuem(WA_RESPONDEU)).toBe(true);
    expect(preveePortaAberta(WA_RESPONDEU, 'nao_informado')).toBe(false);
    expect(preveePortaAberta(WA_RESPONDEU, 'decisor')).toBe(true);
  });

  it('desfecho que não é porta aberta nunca vira porta aberta, nem com o decisor', () => {
    expect(preveePortaAberta(LIG_NAO_ATENDEU, 'decisor')).toBe(false);
    expect(perguntaComQuem(LIG_NAO_ATENDEU)).toBe(false);
  });
});

describe('o único ramo do fluxo', () => {
  it('cada desfecho de exceção pede o campo dele, e pelo motivo dele', () => {
    expect(extraDoDesfecho(LIG_SEM_INTERESSE)).toBe('motivo_perda');
    expect(extraDoDesfecho(LIG_REUNIAO_MARCADA)).toBe('reuniao');
    expect(extraDoDesfecho(REU_AUTORIZOU)).toBe('autorizacao');
    expect(extraDoDesfecho(WA_OPTOUT)).toBe('confirmar_optout');
  });

  it('os desfechos comuns gravam em três toques', () => {
    expect(extraDoDesfecho(LIG_NAO_ATENDEU)).toBeNull();
    expect(extraDoDesfecho(WA_RESPONDEU)).toBeNull();
    expect(extraDoDesfecho(VIS_DECISOR_INTERESSADO)).toBeNull();
  });
});

describe('superfície e catálogo', () => {
  it('cada superfície mostra só os desfechos dela, na ordem do catálogo', () => {
    const daLigacao = desfechosDaSuperficie(CATALOGO_DE_TESTE, 'ligacao');
    expect(daLigacao.map((d) => d.slug)).toEqual([
      'lig_nao_atendeu',
      'lig_atendeu_retorna',
      'lig_sem_interesse',
      'lig_reuniao_marcada',
    ]);
  });

  it('nenhuma superfície passa do teto de 8 chips', () => {
    for (const superficie of SUPERFICIES_DO_REGISTRO) {
      expect(desfechosDaSuperficie(CATALOGO_DE_TESTE, superficie).length).toBeLessThanOrEqual(
        TETO_DESFECHOS_POR_SUPERFICIE,
      );
    }
  });

  it('o par (tipo, canal) é o inverso exato de app.interaction_surface', () => {
    // Espelho da função SQL: call→ligacao, visit→visita, meeting→reuniao, e só então
    // o canal decide entre instagram_dm e whatsapp.
    const superficieNoBanco = (tipo: string, canal: string) =>
      tipo === 'call'
        ? 'ligacao'
        : tipo === 'visit'
          ? 'visita'
          : tipo === 'meeting'
            ? 'reuniao'
            : canal === 'instagram'
              ? 'instagram_dm'
              : canal === 'whatsapp'
                ? 'whatsapp'
                : null;

    for (const superficie of SUPERFICIES_DO_REGISTRO) {
      const { tipo, canal } = PAR_DA_SUPERFICIE[superficie];
      expect(superficieNoBanco(tipo, canal)).toBe(superficie);
    }
  });
});
