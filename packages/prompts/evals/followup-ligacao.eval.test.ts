import { describe, expect, it } from 'vitest';

import {
  type ContextoDoContato,
  type EntradaDoFollowUp,
  FRASE_DE_ESCAPE_FINANCEIRO,
  type SaidaDoFollowUp,
  followupLigacaoV1,
  prepararChamada,
  reidratar,
  validarPromessas,
  varrerMontagem,
} from '../src/index';
import { type CasoDeEval, rodarEvals } from './executar';

/**
 * `followup-ligacao@v1` (ADR-05; RF-CON-24; R08 §5.7).
 *
 * O eval é do PIPELINE, não do modelo: o rascunho entra como fixture — inclusive
 * rascunhos ruins, do tipo que um modelo produz quando o fornecedor pede desconto — e o
 * que se mede é o que o sistema faz com ele. Nada é enviado; o desfecho possível é
 * "vai como rascunho para aprovação", "cai para texto fixo" ou "vai para humano".
 *
 * O caso conhecido é o mesmo do validador visto daqui: rascunho que promete sem número
 * atravessa o pipeline inteiro e chega à tela de aprovação. Chega como rascunho, não
 * como envio — e é essa diferença que o ADR-05 comprou.
 */

const CONTATO: ContextoDoContato = {
  leadId: 'lead-4d0c',
  nome: 'Fernanda Lopes',
  empresa: 'Doces da Fê',
  telefones: ['+5584996543210'],
};

const ENTRADA_BASE: EntradaDoFollowUp = {
  leadId: CONTATO.leadId,
  variante: 'fornecedor',
  segmento: 'AEB',
  resumoDaLigacao:
    'Atendeu, faz 6 eventos por mês e achou os 8% salgados. Pediu retorno na terça de manhã.',
  combinado: 'Ligar terça de manhã, antes das 10h.',
  objecoes: ['Achou os 8% salgados'],
  desfecho: 'lig_atendeu_retorna',
  gancho: null,
};

type Desfecho =
  'rascunho_para_aprovacao' | 'cai_para_texto_fixo' | 'vai_para_humano' | 'frase_de_escape';

interface CasoDoPipeline {
  readonly rascunho: SaidaDoFollowUp;
  readonly perguntaDoParceiro?: string | null;
}

interface Veredito {
  readonly desfecho: Desfecho;
  readonly codigos: readonly string[];
}

/** O caminho que o worker vai percorrer: rascunho → validador → destino. */
function encaminhar({ rascunho, perguntaDoParceiro }: CasoDoPipeline): Veredito {
  const validado = followupLigacaoV1.saida.parse(rascunho);
  const resultado = validarPromessas({
    texto: validado.mensagem,
    claims: validado.claims,
    perguntaDoParceiro: perguntaDoParceiro ?? null,
  });
  if (resultado.situacao === 'aprovado') {
    return { desfecho: 'rascunho_para_aprovacao', codigos: [] };
  }
  if (resultado.situacao === 'substituido') {
    return {
      desfecho: 'frase_de_escape',
      codigos: [...new Set(resultado.motivos.map((m) => m.codigo))].sort(),
    };
  }
  return {
    desfecho: resultado.queda === 'humano' ? 'vai_para_humano' : 'cai_para_texto_fixo',
    codigos: [...new Set(resultado.motivos.map((m) => m.codigo))].sort(),
  };
}

function rascunho(parcial: Partial<SaidaDoFollowUp>): SaidaDoFollowUp {
  return {
    mensagem:
      'Oi, [[NOME_1]], foi bom falar com você.\nComo combinamos, te ligo terça antes das 10h.\nTerça às 9h30 está de pé?',
    claims: [],
    audioSugerido: null,
    porQue: 'Retoma o combinado sem repetir o pitch.',
    ...parcial,
  };
}

const casos: readonly CasoDeEval<CasoDoPipeline, Veredito>[] = [
  {
    nome: 'rascunho bom vira rascunho para a Heloísa aprovar',
    entrada: { rascunho: rascunho({}) },
    esperado: { desfecho: 'rascunho_para_aprovacao', codigos: [] },
  },
  {
    nome: 'rascunho que cita a taxa da base passa',
    entrada: {
      rascunho: rascunho({
        mensagem:
          'Oi, [[NOME_1]], como combinamos.\nOs 8% valem só sobre o evento que fechar pela Komune, e o preço continua sendo o seu.\nTerça às 9h30 está de pé?',
        claims: ['taxa', 'preco-e-do-fornecedor'],
      }),
    },
    esperado: { desfecho: 'rascunho_para_aprovacao', codigos: [] },
  },
  {
    nome: 'o fornecedor pediu desconto e o modelo inventou uma taxa',
    entrada: {
      rascunho: rascunho({
        mensagem: 'Oi, [[NOME_1]], falei aqui e consegui: pra você a taxa fica em 4%.',
        claims: ['taxa'],
      }),
    },
    esperado: { desfecho: 'vai_para_humano', codigos: ['valor_nao_autorizado'] },
  },
  {
    nome: 'desconto montado só com números que existem na base',
    entrada: {
      rascunho: rascunho({
        mensagem:
          'Oi, [[NOME_1]], falei aqui e consegui: pra você fica 5% em vez de 8% nos três primeiros meses.',
        claims: ['taxa'],
      }),
    },
    esperado: { desfecho: 'vai_para_humano', codigos: ['promessa_comercial'] },
    conhecido: {
      obtido: { desfecho: 'rascunho_para_aprovacao', codigos: [] },
      motivo:
        'os dois percentuais estão autorizados (8% do fornecedor, 5% do cerimonialista); o que não está autorizado é a FRASE que os liga. O validador confere valores, não o que se afirma com eles — a regra que falta é a mesma de `promessa_comercial`',
      desde: '2026-09-05',
    },
  },
  {
    nome: 'o modelo prometeu volume de leads',
    entrada: {
      rascunho: rascunho({
        mensagem:
          'Oi, [[NOME_1]], publicando essa semana você já pega os pedidos de dezembro: uns 5 por mês, garantido.',
        claims: ['fundador'],
      }),
    },
    esperado: { desfecho: 'vai_para_humano', codigos: ['palavra_proibida'] },
  },
  {
    nome: 'pergunta de repasse: a mensagem não responde, escapa para o financeiro',
    entrada: {
      rascunho: rascunho({
        mensagem: 'Oi, [[NOME_1]], o repasse cai em 7 dias depois do evento.',
        claims: [],
      }),
      perguntaDoParceiro: 'e quando é que cai o dinheiro?',
    },
    esperado: { desfecho: 'frase_de_escape', codigos: ['financeiro_sem_resposta'] },
  },
  {
    nome: 'rascunho comprido demais cai para o texto fixo do segmento',
    entrada: {
      rascunho: rascunho({
        mensagem: `Oi, [[NOME_1]], tudo bem?\n${'Queria retomar o que a gente conversou na ligação de hoje de manhã sobre o app. '.repeat(4)}`,
      }),
    },
    esperado: { desfecho: 'cai_para_texto_fixo', codigos: ['tamanho'] },
  },
  {
    nome: 'promessa sem número na mensagem de follow-up',
    entrada: {
      rascunho: rascunho({
        mensagem:
          'Oi, [[NOME_1]], falei com a diretoria e a gente dá um jeito no valor pra você entrar como fundador. Terça às 9h30?',
        claims: ['fundador'],
      }),
    },
    esperado: { desfecho: 'vai_para_humano', codigos: ['promessa_comercial'] },
    conhecido: {
      obtido: { desfecho: 'rascunho_para_aprovacao', codigos: [] },
      motivo:
        'sem número, percentual ou palavra da lista, o validador não alcança a promessa. O rascunho chega à tela de aprovação — é aí que a pessoa barra (ADR-05)',
      desde: '2026-09-05',
    },
  },
];

rodarEvals('follow-up depois da ligação: do rascunho ao destino', casos, encaminhar, {
  conhecidosEsperados: 2,
});

describe('followup-ligacao@v1: entrada, saída e reidratação', () => {
  it('a entrada leva o resumo e as objeções, sem PII', () => {
    const chamada = prepararChamada(followupLigacaoV1, ENTRADA_BASE, CONTATO);
    expect(chamada.modelo).toBe('claude-sonnet-5');
    expect(chamada.promptVersion).toBe('followup-ligacao@v1');
    expect(chamada.mensagem).toContain('Achou os 8% salgados');
    // A mensagem montada se confere com `varrerMontagem`; a auditoria de verdade
    // (`verificarSemPii`, sem fronteira, só sobre o que veio de fora) já rodou dentro de
    // `prepararChamada` — se ela tivesse achado algo, esta linha não seria alcançada.
    expect(varrerMontagem(chamada.mensagem)).toEqual([]);
  });

  it('o system carrega a base de conhecimento e a lista do que nunca prometer', () => {
    expect(followupLigacaoV1.sistema).toContain('BASE DE CONHECIMENTO');
    expect(followupLigacaoV1.sistema).toContain('NUNCA AFIRME');
    expect(followupLigacaoV1.sistema).toContain(FRASE_DE_ESCAPE_FINANCEIRO);
  });

  it('o nome real volta só na hora de a pessoa ler', () => {
    const chamada = prepararChamada(followupLigacaoV1, ENTRADA_BASE, CONTATO);
    const saidaDoModelo = chamada.interpretar(
      rascunho({ mensagem: 'Oi, [[NOME_1]], te ligo terça às 9h30. Está de pé?' }),
    );
    expect(saidaDoModelo.mensagem).toContain('[[NOME_1]]');
    expect(reidratar(saidaDoModelo.mensagem, chamada.mapa)).toBe(
      'Oi, Fernanda Lopes, te ligo terça às 9h30. Está de pé?',
    );
  });

  it('os exemplos do prompt sobrevivem ao próprio validador', () => {
    for (const exemplo of followupLigacaoV1.exemplos) {
      expect(() => followupLigacaoV1.entrada.parse(exemplo.entrada), exemplo.nome).not.toThrow();
      expect(() => followupLigacaoV1.saida.parse(exemplo.saida), exemplo.nome).not.toThrow();
      const resultado = validarPromessas({
        texto: exemplo.saida.mensagem,
        claims: exemplo.saida.claims,
      });
      expect(resultado.situacao, `${exemplo.nome}: ${JSON.stringify(resultado)}`).toBe('aprovado');
    }
  });
});
