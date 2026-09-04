import { describe, expect, it } from 'vitest';

import {
  CATALOGO_DE_TESTE,
  LIG_NAO_ATENDEU,
  LIG_REUNIAO_MARCADA,
  VIS_DECISOR_INTERESSADO,
  WA_AGORA_NAO,
  WA_OPTOUT,
  WA_RESPONDEU,
} from './catalogo.fixtures';
import { desfechosOferecidos, valeParaQuemPediuParar, type Superficie } from './tipos';

/**
 * O que a tela pode oferecer sobre quem pediu para NÃO ser contatado.
 *
 * O defeito: o DJ Zone Natal RN tem `do_not_contact = true`, negócio em "Opt-out / não
 * contatar", e a tela — que já mostrava os avisos certos — oferecia os sete desfechos
 * de WhatsApp assim mesmo. Registrar "Enviado, sem resposta" criou a tarefa
 * "Follow-up D+3" e devolveu para a fila do Meu dia justamente quem tinha pedido para
 * sair. O guardrail do CLAUDE.md é "nenhum envio a contato suprimido, em nenhum modo".
 */
describe('desfecho oferecido a quem pediu para parar', () => {
  it('deixa passar só o que não conta, não cria tarefa e não reabre a janela', () => {
    expect(valeParaQuemPediuParar(WA_OPTOUT)).toBe(true);
  });

  it('barra contato ativo: enviado, interessado, reunião marcada', () => {
    for (const desfecho of [
      WA_RESPONDEU,
      WA_AGORA_NAO,
      LIG_NAO_ATENDEU,
      LIG_REUNIAO_MARCADA,
      VIS_DECISOR_INTERESSADO,
    ]) {
      expect(valeParaQuemPediuParar(desfecho), desfecho.slug).toBe(false);
    }
  });

  it('a lista do WhatsApp encolhe para o registro do próprio pedido de parada', () => {
    const normal = desfechosOferecidos(CATALOGO_DE_TESTE, 'whatsapp', false);
    const suprimido = desfechosOferecidos(CATALOGO_DE_TESTE, 'whatsapp', true);

    expect(normal.map((d) => d.slug)).toEqual(['wa_respondeu', 'wa_agora_nao', 'wa_optout']);
    expect(suprimido.map((d) => d.slug)).toEqual(['wa_optout']);
  });

  it('ligação, visita e reunião ficam sem nenhum — e a tela precisa dizer por quê', () => {
    for (const superficie of ['ligacao', 'visita', 'reuniao'] as Superficie[]) {
      expect(desfechosOferecidos(CATALOGO_DE_TESTE, superficie, true), superficie).toEqual([]);
      expect(desfechosOferecidos(CATALOGO_DE_TESTE, superficie, false).length).toBeGreaterThan(0);
    }
  });

  it('nenhum desfecho oferecido a um suprimido cria próxima ação', () => {
    for (const superficie of [
      'whatsapp',
      'ligacao',
      'visita',
      'reuniao',
      'instagram_dm',
    ] as const) {
      for (const desfecho of desfechosOferecidos(CATALOGO_DE_TESTE, superficie, true)) {
        expect(desfecho.next_action_kind, desfecho.slug).toBeNull();
        expect(desfecho.can_reactivate, desfecho.slug).toBe(false);
        expect(desfecho.counts_as, desfecho.slug).toBe('nenhuma');
      }
    }
  });

  it('parceiro sem opt-out continua com o catálogo inteiro da superfície', () => {
    expect(desfechosOferecidos(CATALOGO_DE_TESTE, 'ligacao', false).map((d) => d.slug)).toEqual([
      'lig_nao_atendeu',
      'lig_atendeu_retorna',
      'lig_sem_interesse',
      'lig_reuniao_marcada',
    ]);
  });
});
