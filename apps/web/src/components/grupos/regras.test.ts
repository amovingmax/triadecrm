import { describe, expect, it } from 'vitest';

import {
  JANELA_FECHADA,
  contarPessoas,
  conversaAceitaConvite,
  entregaNoGrupo,
  estaFixada,
  fraseDaFila,
  fraseDoEvento,
  fraseDoMotivo,
  grupoDoEvento,
  janelaDoGrupo,
  montarFio,
  nomeDoParticipante,
  podeFixar,
  primeiraLinha,
  quemMandou,
  resumoDaMensagem,
  semAssinatura,
  situacaoDasAcoes,
  telefoneLegivel,
  temPedidoNaFila,
} from './regras';
import type { AcaoCrua, MensagemDoGrupoCrua, ParticipanteCru } from './tipos';

const AGORA = new Date('2026-10-27T15:00:00Z');

function mensagem(parcial: Partial<MensagemDoGrupoCrua>): MensagemDoGrupoCrua {
  return {
    id: 'm1',
    grupo_id: 'g1',
    direction: 'in',
    type: 'text',
    tipo_na_meta: null,
    status: 'received',
    wa_message_id: 'wamid.1',
    de_wa_id: '5584999998801',
    de_nome: null,
    sent_by: null,
    body: 'oi',
    media_path: null,
    media_mime: null,
    media_nome: null,
    conteudo: null,
    responde_a: null,
    reage_a: null,
    error_code: null,
    error_detail: null,
    created_at: '2026-10-27T14:00:00Z',
    apagada_em: null,
    fixada_ate: null,
    ...parcial,
  };
}

function participante(wa_id: string, parcial: Partial<ParticipanteCru> = {}): ParticipanteCru {
  return { wa_id, nome: null, entrou_em: null, saiu_em: null, ...parcial };
}

function acao(parcial: Partial<AcaoCrua>): AcaoCrua {
  return {
    id: 1,
    tipo: 'grupo_novo_convite',
    estado: 'feita',
    erro: null,
    pedida_em: '2026-10-27T14:00:00Z',
    feita_em: '2026-10-27T14:00:05Z',
    ...parcial,
  };
}

describe('fraseDoMotivo', () => {
  it('cada motivo das funções grupo_* vira uma frase', () => {
    expect(fraseDoMotivo('janela_do_grupo_fechada')).toBe(JANELA_FECHADA);
    expect(fraseDoMotivo('nome_de_1_a_128_letras')).toMatch(/128/);
    expect(fraseDoMotivo('mensagem_sem_id_na_meta')).toMatch(/fixar/);
  });

  it('o texto da porteira de messages é lido pelo que contém', () => {
    expect(
      fraseDoMotivo('Envio recusado: sem_janela_e_sem_template (RF-CON-10, RF-CON-11, RF-CON-18)'),
    ).toMatch(/24 h/);
    expect(fraseDoMotivo('Envio recusado: teto_iniciadas_dia (RF-CON-10)')).toMatch(/teto/);
  });

  it('vazio e desconhecido não ficam sem frase', () => {
    expect(fraseDoMotivo(null)).toMatch(/Tente de novo/);
    expect(fraseDoMotivo('xyz')).toMatch(/recusou/);
  });
});

describe('janelaDoGrupo', () => {
  it('aberta nas 24 h depois da última recebida', () => {
    const j = janelaDoGrupo('2026-10-27T10:00:00Z', AGORA);
    expect(j.aberta).toBe(true);
    expect(j.fechaEm?.toISOString()).toBe('2026-10-28T10:00:00.000Z');
    expect(j.restaMs).toBe(19 * 60 * 60 * 1000);
  });

  it('fechada depois das 24 h ou sem nada recebido', () => {
    expect(janelaDoGrupo('2026-10-26T14:59:00Z', AGORA).aberta).toBe(false);
    expect(janelaDoGrupo(null, AGORA)).toEqual({ aberta: false, fechaEm: null, restaMs: 0 });
  });
});

describe('conversaAceitaConvite', () => {
  it('vale a janela da conversa, ou 24 h desde a última recebida', () => {
    expect(
      conversaAceitaConvite(
        { window_expires_at: '2026-10-27T16:00:00Z', last_inbound_at: null },
        AGORA,
      ),
    ).toBe(true);
    expect(
      conversaAceitaConvite(
        { window_expires_at: null, last_inbound_at: '2026-10-26T16:00:00Z' },
        AGORA,
      ),
    ).toBe(true);
    expect(conversaAceitaConvite({ window_expires_at: null, last_inbound_at: null }, AGORA)).toBe(
      false,
    );
  });
});

describe('contarPessoas', () => {
  it('conta o número da empresa e só quem não saiu', () => {
    const r = contarPessoas(
      [
        participante('1'),
        participante('2'),
        participante('3', { saiu_em: '2026-10-27T10:00:00Z' }),
      ],
      null,
    );
    expect(r).toEqual({ pessoas: 3, vagas: 5, cheio: false });
  });

  it('o total da Meta vence quando é maior que o que o CRM conhece', () => {
    expect(contarPessoas([participante('1')], 8)).toEqual({ pessoas: 8, vagas: 0, cheio: true });
  });
});

describe('quem é quem', () => {
  it('telefone brasileiro legível, de 12 e de 13 dígitos', () => {
    expect(telefoneLegivel('5584999998801')).toBe('+55 84 99999-8801');
    expect(telefoneLegivel('558432221100')).toBe('+55 84 3222-1100');
    expect(telefoneLegivel('14155550100')).toBe('+14155550100');
    expect(telefoneLegivel(null)).toBe('Número oculto');
  });

  it('o nome da mensagem, depois o do participante, depois o número', () => {
    const ps = [participante('5584999998801', { nome: 'Maria' })];
    expect(nomeDoParticipante('5584999998801', ps, 'Mari ✨')).toBe('Mari ✨');
    expect(nomeDoParticipante('5584999998801', ps)).toBe('Maria');
    expect(nomeDoParticipante('5584911112222', ps)).toBe('+55 84 91111-2222');
  });

  it('a enviada diz a pessoa do time', () => {
    const pessoas = [{ id: 'u1', nome: 'Ana' }];
    expect(
      quemMandou({ direction: 'out', sent_by: 'u1', de_wa_id: null, de_nome: null }, [], pessoas),
    ).toBe('Ana');
    expect(
      quemMandou({ direction: 'out', sent_by: 'x', de_wa_id: null, de_nome: null }, [], pessoas),
    ).toBe('Alguém do time');
  });

  it('os eventos do grupo', () => {
    const ps = [participante('55849', { nome: 'João' })];
    expect(
      fraseDoEvento({ conteudo: { evento: 'entrou' }, de_wa_id: '55849', de_nome: null }, ps),
    ).toBe('João entrou');
    expect(
      fraseDoEvento({ conteudo: { evento: 'removido' }, de_wa_id: '55849', de_nome: null }, ps),
    ).toBe('João foi tirado do grupo');
  });
});

describe('montarFio', () => {
  it('as reações vão para baixo da mensagem, e a última de cada pessoa vale', () => {
    const alvo = mensagem({ id: 'a' });
    const fio = montarFio(
      [
        alvo,
        mensagem({ id: 'r1', type: 'reaction', reage_a: 'a', body: '👍', de_wa_id: '1' }),
        mensagem({ id: 'r2', type: 'reaction', reage_a: 'a', body: '❤️', de_wa_id: '1' }),
        mensagem({ id: 'r3', type: 'reaction', reage_a: 'a', body: '❤️', de_wa_id: '2' }),
        mensagem({ id: 'r4', type: 'reaction', reage_a: 'a', body: '😂', de_wa_id: '3' }),
        mensagem({ id: 'r5', type: 'reaction', reage_a: 'a', body: '', de_wa_id: '3' }),
      ],
      AGORA,
    );
    expect(fio.itens).toHaveLength(1);
    const item = fio.itens[0]!;
    expect(item.tipo === 'mensagem' && item.reacoes).toEqual([{ emoji: '❤️', quantas: 2 }]);
  });

  it('a citação ganha a mensagem citada, e o sistema vira evento', () => {
    const fio = montarFio(
      [
        mensagem({ id: 'a', body: 'qual o preço?' }),
        mensagem({ id: 'b', direction: 'out', responde_a: 'a', status: 'sent' }),
        mensagem({ id: 'c', type: 'system', conteudo: { evento: 'entrou' } }),
      ],
      AGORA,
    );
    expect(fio.itens.map((i) => i.tipo)).toEqual(['mensagem', 'mensagem', 'evento']);
    const b = fio.itens[1]!;
    expect(b.tipo === 'mensagem' && b.citada?.id).toBe('a');
  });

  it('fixadas são as que ainda não venceram e não foram apagadas', () => {
    const fio = montarFio(
      [
        mensagem({ id: 'a', fixada_ate: '2026-10-30T00:00:00Z' }),
        mensagem({ id: 'b', fixada_ate: '2026-10-20T00:00:00Z' }),
        mensagem({
          id: 'c',
          fixada_ate: '2026-10-30T00:00:00Z',
          apagada_em: '2026-10-27T00:00:00Z',
        }),
      ],
      AGORA,
    );
    expect(fio.fixadas.map((m) => m.id)).toEqual(['a']);
    expect(estaFixada({ fixada_ate: null, apagada_em: null }, AGORA)).toBe(false);
  });
});

describe('podeFixar', () => {
  it('precisa do id da Meta e de vaga entre as três', () => {
    expect(podeFixar({ wa_message_id: null, apagada_em: null, type: 'text' }, 0)).toMatchObject({
      ok: false,
    });
    expect(podeFixar({ wa_message_id: 'w', apagada_em: null, type: 'text' }, 3)).toMatchObject({
      ok: false,
    });
    expect(podeFixar({ wa_message_id: 'w', apagada_em: null, type: 'text' }, 2)).toEqual({
      ok: true,
    });
  });
});

describe('entrega, resumo e primeira linha', () => {
  it('a entrega só existe para o que saiu', () => {
    expect(entregaNoGrupo({ direction: 'in', status: 'received' })).toBeNull();
    expect(entregaNoGrupo({ direction: 'out', status: 'failed' })).toEqual({
      rotulo: 'não saiu',
      tom: 'falha',
    });
  });

  it('a assinatura sai da primeira linha', () => {
    expect(primeiraLinha('*Ana:*\nBom dia, pessoal\nsegunda linha')).toBe('Bom dia, pessoal');
    expect(semAssinatura('*Ana:*\nBom dia')).toBe('Bom dia');
    // Negrito no meio do texto não é assinatura.
    expect(semAssinatura('Oi! *Promoção*: 10%')).toBe('Oi! *Promoção*: 10%');
    expect(semAssinatura(null)).toBe('');
  });

  it('o resumo de quem é só arquivo', () => {
    expect(
      resumoDaMensagem({
        type: 'document',
        body: null,
        media_nome: 'cardapio.pdf',
        apagada_em: null,
      }),
    ).toBe('cardapio.pdf');
    expect(
      resumoDaMensagem({ type: 'text', body: 'x', media_nome: null, apagada_em: '2026-10-27' }),
    ).toBe('Mensagem apagada');
  });
});

describe('situacaoDasAcoes', () => {
  it('o que está na fila, sem repetir, e sem ler nem mensagem', () => {
    const s = situacaoDasAcoes(
      [
        acao({ id: 1, tipo: 'grupo_remover', estado: 'pendente' }),
        acao({ id: 2, tipo: 'grupo_remover', estado: 'fazendo' }),
        acao({ id: 3, tipo: 'ler', estado: 'pendente' }),
        acao({ id: 4, tipo: 'grupo_enviar', estado: 'pendente' }),
      ],
      AGORA,
    );
    expect(s.pendentes).toEqual(['tirar do grupo']);
    expect(temPedidoNaFila([acao({ estado: 'fazendo' })])).toBe(true);
  });

  it('a falha só conta se foi o último pedido daquele tipo, nas últimas 24 h', () => {
    expect(
      situacaoDasAcoes(
        [
          acao({
            id: 1,
            estado: 'falhou',
            erro: 'Group is full',
            pedida_em: '2026-10-27T13:00:00Z',
          }),
        ],
        AGORA,
      ).falha,
    ).toEqual({ rotulo: 'trocar o link', erro: 'Group is full' });
    expect(
      situacaoDasAcoes(
        [
          acao({ id: 1, estado: 'falhou', pedida_em: '2026-10-27T13:00:00Z' }),
          acao({ id: 2, estado: 'feita', pedida_em: '2026-10-27T14:00:00Z' }),
        ],
        AGORA,
      ).falha,
    ).toBeNull();
    expect(
      situacaoDasAcoes(
        [
          acao({
            estado: 'falhou',
            pedida_em: '2026-10-25T13:00:00Z',
            feita_em: '2026-10-25T13:00:00Z',
          }),
        ],
        AGORA,
      ).falha,
    ).toBeNull();
  });

  it('a frase da fila junta com vírgula e "e"', () => {
    expect(fraseDaFila([])).toBeNull();
    expect(fraseDaFila(['trocar o link', 'tirar do grupo', 'atualizar do WhatsApp'])).toBe(
      'Esperando a Meta: trocar o link, tirar do grupo e atualizar do WhatsApp.',
    );
  });
});

describe('grupoDoEvento', () => {
  it('o grupo é o id em wa_grupos e o grupo_id na mensagem', () => {
    expect(grupoDoEvento('wa_grupos', { id: 'g1' })).toBe('g1');
    expect(grupoDoEvento('wa_grupo_mensagens', { id: 'm', grupo_id: 'g2' })).toBe('g2');
    expect(grupoDoEvento('wa_grupo_mensagens', {})).toBeNull();
    expect(grupoDoEvento('wa_grupos', null)).toBeNull();
  });
});
