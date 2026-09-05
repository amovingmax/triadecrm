import { describe, expect, it } from 'vitest';
import { INTENCOES } from '@komune/prompts';

import {
  duracaoLonga,
  entregaDaMensagem,
  estadoDaJanela,
  fichaDaIntencao,
  fraseDaRecusaDoEnvio,
  lerValidador,
  montarFio,
  montarMensagens,
  montarRascunho,
  ordenarFila,
  podeEscreverLivre,
  ROTULO_INTENCAO,
  tempoCurto,
  validadorApitou,
  type FioCru,
  type MensagemCrua,
  type RascunhoCru,
} from './mensagens';
import type { MensagemDoFio } from './tipos';

/**
 * O que estes testes protegem: as três decisões que a tela toma sozinha e que,
 * se estiverem erradas, ninguém percebe olhando.
 *
 *  1. **A janela de 24 h.** "Fechada" e "nunca houve" não são a mesma coisa, e
 *     confundir as duas manda a Heloísa procurar no histórico uma resposta que
 *     não existe. Do outro lado, uma janela que "abre" um minuto depois de ter
 *     fechado faz a tela liberar texto livre que a Meta vai recusar.
 *  2. **O estado de entrega.** Enquanto não houver número na Meta, TODA mensagem
 *     que sai fica em `queued`. Se a tela chamar isso de "enviada", ela mente
 *     sobre a única coisa que a pessoa precisa saber.
 *  3. **O veredito do validador.** Um `validator` que a tela não soube ler tem
 *     de virar aviso, nunca aprovação. Falhar aberto aqui é aprovar em silêncio
 *     um texto que ninguém validou.
 */

const AGORA = new Date('2026-09-05T12:00:00.000Z');
const HELOISA = 'd0000000-0000-4000-8000-000000000d01';
const NOMES = new Map([[HELOISA, 'Heloísa Cavalcanti']]);

// ---------------------------------------------------------------------------
// A janela de 24 h
// ---------------------------------------------------------------------------

describe('estadoDaJanela', () => {
  it('sem janela nenhuma diz "nunca", e não "fechada"', () => {
    expect(estadoDaJanela(null, AGORA)).toEqual({ situacao: 'nunca' });
  });

  it('conta os minutos que faltam quando ainda há tempo', () => {
    const estado = estadoDaJanela('2026-09-05T15:12:00.000Z', AGORA);
    expect(estado).toEqual({
      situacao: 'aberta',
      expiraEm: '2026-09-05T15:12:00.000Z',
      restanteMin: 192,
    });
  });

  it('conta quanto tempo faz que fechou', () => {
    const estado = estadoDaJanela('2026-09-05T09:30:00.000Z', AGORA);
    expect(estado).toEqual({
      situacao: 'fechada',
      expirouEm: '2026-09-05T09:30:00.000Z',
      fechadaHaMin: 150,
    });
  });

  it('no instante exato do vencimento já está fechada', () => {
    // A borda importa: "aberta com 0 minutos" liberaria a caixa de texto livre
    // para uma mensagem que a Meta recusaria na entrega.
    expect(estadoDaJanela('2026-09-05T12:00:00.000Z', AGORA).situacao).toBe('fechada');
  });

  it('só a janela aberta libera texto livre', () => {
    expect(podeEscreverLivre(estadoDaJanela('2026-09-05T13:00:00.000Z', AGORA))).toBe(true);
    expect(podeEscreverLivre(estadoDaJanela('2026-09-05T11:00:00.000Z', AGORA))).toBe(false);
    expect(podeEscreverLivre(estadoDaJanela(null, AGORA))).toBe(false);
  });
});

describe('duracaoLonga e tempoCurto', () => {
  it('separam o dígito da palavra, para a mono ficar só no número', () => {
    expect(duracaoLonga(47)).toEqual([{ numero: '47', unidade: ' min' }]);
    expect(duracaoLonga(192)).toEqual([
      { numero: '3', unidade: ' horas' },
      { numero: '12', unidade: ' min' },
    ]);
    expect(duracaoLonga(60)).toEqual([{ numero: '1', unidade: ' hora' }]);
    expect(duracaoLonga(2880)).toEqual([{ numero: '2', unidade: ' dias' }]);
  });

  it('nunca devolvem tempo negativo', () => {
    expect(duracaoLonga(-30)).toEqual([{ numero: '0', unidade: ' min' }]);
    expect(tempoCurto(-30)).toEqual({ numero: '0', unidade: ' min' });
  });

  it('a versão curta cabe numa linha de lista', () => {
    expect(tempoCurto(192)).toEqual({ numero: '3', unidade: ' h' });
    expect(tempoCurto(1500)).toEqual({ numero: '1', unidade: ' dia' });
  });
});

// ---------------------------------------------------------------------------
// O estado de entrega
// ---------------------------------------------------------------------------

function mensagem(parcial: Partial<MensagemDoFio> = {}): MensagemDoFio {
  return {
    id: 'm1',
    fioId: 'f1',
    em: '2026-09-05T11:00:00.000Z',
    entrada: false,
    tipo: 'text',
    status: 'queued',
    texto: 'oi',
    midiaCaminho: null,
    midiaTipo: null,
    transcricao: null,
    autorTipo: 'human',
    autor: 'Heloísa Cavalcanti',
    aprovadoPor: null,
    origem: 'crm',
    iniciadaPelaEmpresa: false,
    primeiroContato: false,
    confirmacaoDeOptout: false,
    porModelo: false,
    erroCodigo: null,
    erroDetalhe: null,
    enviadaEm: null,
    entregueEm: null,
    lidaEm: null,
    falhouEm: null,
    ...parcial,
  };
}

describe('entregaDaMensagem', () => {
  it('diz que a mensagem na fila NÃO saiu, e por quê', () => {
    const entrega = entregaDaMensagem(mensagem({ status: 'queued' }));
    expect(entrega.rotulo).toBe('na fila');
    expect(entrega.tom).toBe('espera');
    // A frase é a única coisa que impede alguém de achar que a mensagem foi.
    expect(entrega.detalhe).toContain('não saiu');
  });

  it('na falha, mostra o detalhe do erro e cai para o código quando não há detalhe', () => {
    expect(entregaDaMensagem(mensagem({ status: 'failed', erroDetalhe: 'número inválido' })))
      .toMatchObject({ tom: 'falha', detalhe: 'número inválido' });
    expect(entregaDaMensagem(mensagem({ status: 'failed', erroCodigo: '131049' })).detalhe).toBe(
      '131049',
    );
  });

  it('entregue e lida não pedem explicação nenhuma', () => {
    expect(entregaDaMensagem(mensagem({ status: 'delivered' }))).toEqual({
      rotulo: 'entregue',
      detalhe: null,
      tom: 'normal',
    });
    expect(entregaDaMensagem(mensagem({ status: 'read' })).rotulo).toBe('lida');
  });

  it('mensagem recebida fala do nosso lado da leitura, não do lado do parceiro', () => {
    expect(entregaDaMensagem(mensagem({ entrada: true, status: 'received' })).rotulo).toBe(
      'recebida',
    );
    expect(entregaDaMensagem(mensagem({ entrada: true, status: 'read' })).rotulo).toBe(
      'lida por você',
    );
  });
});

// ---------------------------------------------------------------------------
// As 25 intenções
// ---------------------------------------------------------------------------

describe('as intenções do R08', () => {
  it('todas as 25 têm frase em português', () => {
    // O `Record<Intencao, string>` já garante isso no typecheck; este teste
    // garante que nenhuma delas ficou com o próprio código como "tradução".
    for (const intencao of INTENCOES) {
      const frase = ROTULO_INTENCAO[intencao];
      expect(frase, intencao).toBeTruthy();
      expect(frase, intencao).not.toBe(intencao);
      expect(frase, intencao).toBe(frase.toLowerCase());
    }
    expect(INTENCOES).toHaveLength(25);
  });

  it('rótulo desconhecido devolve null em vez de inventar ficha', () => {
    expect(fichaDaIntencao('INTERESSADO')?.intencao).toBe('INTERESSADO');
    expect(fichaDaIntencao('QUER_DESCONTO_DE_NATAL')).toBeNull();
    expect(fichaDaIntencao(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// O validador de promessas
// ---------------------------------------------------------------------------

describe('lerValidador', () => {
  it('lê o veredito aprovado', () => {
    expect(lerValidador({ situacao: 'aprovado', texto: 'oi' })).toEqual({
      situacao: 'aprovado',
      motivos: [],
      queda: null,
    });
    expect(validadorApitou(lerValidador({ situacao: 'aprovado', texto: 'oi' }))).toBe(false);
  });

  it('lê o bloqueio com os motivos e para onde o texto cai', () => {
    const veredito = lerValidador({
      situacao: 'bloqueado',
      queda: 'humano',
      motivos: [
        {
          codigo: 'valor_nao_autorizado',
          trecho: '5%',
          explicacao: 'número, preço ou prazo que não está na base de conhecimento',
        },
      ],
    });
    expect(veredito.situacao).toBe('bloqueado');
    expect(veredito.queda).toBe('humano');
    expect(veredito.motivos[0]?.trecho).toBe('5%');
    expect(validadorApitou(veredito)).toBe(true);
  });

  it('lê a substituição pela frase de escape do financeiro', () => {
    const veredito = lerValidador({
      situacao: 'substituido',
      texto: 'vou confirmar com o financeiro',
      motivos: [{ codigo: 'financeiro_sem_resposta', trecho: 'quando cai o dinheiro?' }],
    });
    expect(veredito.situacao).toBe('substituido');
    expect(veredito.motivos).toHaveLength(1);
    expect(validadorApitou(veredito)).toBe(true);
  });

  it('FALHA FECHADO: o que não dá para ler vira aviso, nunca aprovação', () => {
    for (const cru of [{}, null, 'aprovado', { situacao: 'seiLa' }, []]) {
      const veredito = lerValidador(cru);
      expect(veredito.situacao, JSON.stringify(cru)).toBe('sem_registro');
      expect(validadorApitou(veredito), JSON.stringify(cru)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Das linhas cruas para o que a tela usa
// ---------------------------------------------------------------------------

function crua(parcial: Partial<MensagemCrua> = {}): MensagemCrua {
  return {
    id: 'm1',
    conversation_id: 'f1',
    organization_id: 'o1',
    direction: 'out',
    type: 'text',
    status: 'queued',
    body: '  oi  ',
    media_path: null,
    media_mime: null,
    transcript: null,
    template_id: null,
    draft_id: null,
    author_kind: 'human',
    sent_by: HELOISA,
    approved_by: null,
    is_first_contact: false,
    business_initiated: false,
    optout_confirmation: false,
    origin: 'crm',
    error_code: null,
    error_detail: null,
    created_at: '2026-09-05T10:00:00.000Z',
    sent_at: null,
    delivered_at: null,
    read_at: null,
    failed_at: null,
    ...parcial,
  };
}

describe('montarMensagens', () => {
  it('a mensagem enviada vale pela hora em que SAIU; a que está na fila, pela hora em que entrou nela', () => {
    const [naFila, enviada] = montarMensagens(
      [
        crua({ id: 'a', created_at: '2026-09-05T10:00:00.000Z' }),
        crua({
          id: 'b',
          status: 'sent',
          created_at: '2026-09-05T09:00:00.000Z',
          sent_at: '2026-09-05T11:00:00.000Z',
        }),
      ],
      NOMES,
    );
    expect(naFila?.em).toBe('2026-09-05T10:00:00.000Z');
    expect(enviada?.em).toBe('2026-09-05T11:00:00.000Z');
  });

  it('a mensagem recebida vale pela hora em que chegou, mesmo com sent_at preenchido', () => {
    const [recebida] = montarMensagens(
      [
        crua({
          direction: 'in',
          status: 'received',
          created_at: '2026-09-05T08:00:00.000Z',
          sent_at: '2026-09-05T20:00:00.000Z',
        }),
      ],
      NOMES,
    );
    expect(recebida?.em).toBe('2026-09-05T08:00:00.000Z');
    expect(recebida?.entrada).toBe(true);
  });

  it('valor de enum que esta versão não conhece não derruba a tela', () => {
    const [m] = montarMensagens(
      [crua({ type: 'sticker_de_2027', status: 'reagida', author_kind: 'alien', origin: 'nuvem' })],
      NOMES,
    );
    expect(m?.tipo).toBe('system');
    expect(m?.status).toBe('queued');
    expect(m?.autorTipo).toBe('system');
    expect(m?.origem).toBe('crm');
  });

  it('texto e transcrição em branco viram null, não string vazia', () => {
    const [m] = montarMensagens([crua({ body: '   ', transcript: '\n ' })], NOMES);
    expect(m?.texto).toBeNull();
    expect(m?.transcricao).toBeNull();
  });

  it('resolve o nome de quem escreveu e de quem aprovou', () => {
    const [m] = montarMensagens(
      [crua({ author_kind: 'bot_ai', approved_by: HELOISA, draft_id: 'r1' })],
      NOMES,
    );
    expect(m?.autor).toBe('Heloísa Cavalcanti');
    expect(m?.aprovadoPor).toBe('Heloísa Cavalcanti');
  });

  it('mensagem por modelo é reconhecida pelo template_id e pelo tipo', () => {
    expect(montarMensagens([crua({ template_id: 7 })], NOMES)[0]?.porModelo).toBe(true);
    expect(montarMensagens([crua({ type: 'template' })], NOMES)[0]?.porModelo).toBe(true);
    expect(montarMensagens([crua()], NOMES)[0]?.porModelo).toBe(false);
  });
});

describe('montarFio', () => {
  const fio: FioCru = {
    id: 'f1',
    organization_id: 'o1',
    contact_id: null,
    channel: 'whatsapp',
    peer_phone_e164: '+5584999880011',
    business_number: '+5584999990000',
    assignee_id: HELOISA,
    status: 'aguardando_nos',
    bot_paused: false,
    last_message_at: '2026-09-05T11:00:00.000Z',
    last_inbound_at: '2026-09-05T11:00:00.000Z',
    last_outbound_at: null,
    window_expires_at: '2026-09-06T11:00:00.000Z',
    unread_count: 2,
    ai_summary: '  perguntou a taxa  ',
    ai_intent: 'PEDIU_TAXA_PRECO',
    ai_confidence: 0.91,
    ...{},
  };

  it('traz o telefone do parceiro CRU: é a identidade do fio', () => {
    expect(montarFio(fio, NOMES).telefoneParceiro).toBe('+5584999880011');
  });

  it('resolve o responsável e limpa o resumo', () => {
    const montado = montarFio(fio, NOMES);
    expect(montado.responsavel).toBe('Heloísa Cavalcanti');
    expect(montado.resumo).toBe('perguntou a taxa');
    expect(montado.naoLidas).toBe(2);
  });

  it('estado desconhecido cai em "esperando a gente", que é o que pede ação', () => {
    expect(montarFio({ ...fio, status: 'hibernando' }, NOMES).estado).toBe('aguardando_nos');
  });
});

describe('montarRascunho e ordenarFila', () => {
  function rascunho(parcial: Partial<RascunhoCru> = {}): RascunhoCru {
    return {
      id: 'r1',
      organization_id: 'o1',
      conversation_id: 'f1',
      kind: 'resposta',
      status: 'pendente',
      proposed_body: 'A taxa é 8% sobre o valor fechado.',
      proposed_claims: ['taxa-8'],
      validator: { situacao: 'aprovado', texto: 'x' },
      prompt_version: 'followup-ligacao@v1',
      final_body: null,
      foi_editado: null,
      reviewed_by: null,
      reviewed_at: null,
      discard_reason: null,
      created_at: '2026-09-05T10:00:00.000Z',
      expires_at: '2026-09-08T10:00:00.000Z',
      ...parcial,
    };
  }

  it('claims que não são lista viram lista vazia em vez de quebrar a tela', () => {
    expect(montarRascunho(rascunho({ proposed_claims: { taxa: true } })).afirmacoes).toEqual([]);
    expect(montarRascunho(rascunho({ proposed_claims: null })).afirmacoes).toEqual([]);
    expect(montarRascunho(rascunho()).afirmacoes).toEqual(['taxa-8']);
  });

  it('tipo de rascunho desconhecido vira "outro"', () => {
    expect(montarRascunho(rascunho({ kind: 'poema' })).tipo).toBe('outro');
  });

  it('a fila é ordenada por quem SOME primeiro, não por quem chegou primeiro', () => {
    const ordem = ordenarFila([
      montarRascunho(
        rascunho({
          id: 'antigo',
          created_at: '2026-09-01T10:00:00.000Z',
          expires_at: '2026-09-09T10:00:00.000Z',
        }),
      ),
      montarRascunho(
        rascunho({
          id: 'vence-hoje',
          created_at: '2026-09-05T09:00:00.000Z',
          expires_at: '2026-09-05T23:00:00.000Z',
        }),
      ),
    ]);
    expect(ordem.map((r) => r.id)).toEqual(['vence-hoje', 'antigo']);
  });
});

// ---------------------------------------------------------------------------
// As recusas do envio
// ---------------------------------------------------------------------------

describe('fraseDaRecusaDoEnvio', () => {
  /**
   * As duas primeiras strings NÃO foram escritas aqui: são o que
   * `app.messages_guard` levantou de verdade no banco local, com a sessão da
   * Heloísa, ao tentar responder fora da janela e a quem pediu para sair. Elas
   * ficam trancadas neste teste porque o contrato entre o gatilho e esta tela
   * não passa por compilador nenhum: se o motivo mudar de nome no SQL, nada
   * quebra — só some a frase, e a pessoa lê "não deu para falar com o servidor"
   * quando o problema era outro, e resolvível.
   */
  it('reconhece o motivo dentro do texto que o gatilho levanta', () => {
    expect(
      fraseDaRecusaDoEnvio(
        'Envio recusado: sem_janela_e_sem_template (RF-CON-10, RF-CON-11, RF-CON-18)',
      ),
    ).toContain('só sai modelo aprovado pela Meta');
    expect(
      fraseDaRecusaDoEnvio('Envio recusado: contato_suprimido (RF-CON-10, RF-CON-11, RF-CON-18)'),
    ).toContain('pediu para não receber mais');
  });

  it('lê as três formas em que o banco recusa', () => {
    // As três frases são as dos `raise exception` da migração 20260905000200:
    // insert de mensagem, transição queued → sent, e insert de rascunho.
    expect(fraseDaRecusaDoEnvio('Envio recusado: teto_do_numero (RF-CON-10)')).toContain(
      'primeiros contatos do dia',
    );
    expect(
      fraseDaRecusaDoEnvio(
        'Entrega recusada na saída: contato_suprimido — a fila não é permissão, é intenção',
      ),
    ).toContain('pediu para não receber mais');
    expect(
      fraseDaRecusaDoEnvio('Rascunho recusado na origem: numero_suprimido (RF-CON-18)'),
    ).toContain('lista de supressão');
  });

  it('compara por igualdade: motivo que só CONTÉM um conhecido não vale', () => {
    // `teto_do_numero_novo` não é `teto_do_numero`. Com varredura por substring
    // a tela mostraria a frase do teto de primeiros contatos para uma regra que
    // ninguém sabe qual é — e é assim que um aviso vira mentira sem ninguém ver.
    expect(fraseDaRecusaDoEnvio('Envio recusado: teto_do_numero_novo (RF-CON-10)')).toBeNull();
  });

  it('motivo desconhecido devolve null: melhor a frase genérica que o texto do Postgres', () => {
    expect(fraseDaRecusaDoEnvio('duplicate key value violates unique constraint')).toBeNull();
    expect(fraseDaRecusaDoEnvio('Envio recusado: motivo_que_ninguem_previu')).toBeNull();
  });
});
