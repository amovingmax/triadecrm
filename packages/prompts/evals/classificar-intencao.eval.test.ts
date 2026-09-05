import { describe, expect, it } from 'vitest';

import {
  type ContextoDaDecisao,
  type Intencao,
  type MotivoDeEscalada,
  REGRAS_DE_OPT_OUT,
  type SaidaDoClassificador,
  decidirIntencao,
  detectarOptOut,
  fichaDa,
  INTENCOES,
} from '../src/index';
import { type CasoDeEval, rodarEvals } from './executar';

/**
 * A camada determinística sobre o classificador (RF-CON-19, RF-CON-20; R08 §1 e §5.3).
 *
 * O eval não chama modelo nenhum: a saída do Haiku entra como fixture, que é exatamente
 * o que ele devolveria, e o que se mede é a DECISÃO — a parte que é código nosso e que
 * tem de continuar valendo mesmo quando o modelo mudar de versão.
 *
 * Os dois casos conhecidos são o mesmo defeito visto de dois ângulos: o léxico de
 * opt-out do RF-CON-19 inclui "não quero" e "não tenho interesse", que também são as
 * palavras de quem só está recusando a oferta. Quem cai nele é suprimido para sempre —
 * e o R08 §1 diz que "não tenho interesse" é `SEM_INTERESSE_FIRME`, perdido com motivo,
 * reabrível por iniciativa da pessoa. As duas coisas não podem estar certas ao mesmo
 * tempo, e a divergência é do PRD, não do código: está aberta como decisão humana.
 */

interface Veredito {
  readonly intencao: Intencao;
  readonly origem: 'regra' | 'modelo';
  readonly secundaria: Intencao | null;
  readonly escalar: boolean;
  readonly motivos: readonly MotivoDeEscalada[];
}

function julgar(contexto: ContextoDaDecisao): Veredito {
  const decisao = decidirIntencao(contexto);
  return {
    intencao: decisao.intencao,
    origem: decisao.origem,
    secundaria: decisao.intencaoSecundaria,
    escalar: decisao.escalar,
    motivos: [...decisao.motivosDeEscalada].sort(),
  };
}

function doModelo(
  intencao: Intencao,
  confianca: number,
  segunda: Intencao | null = null,
): SaidaDoClassificador {
  return {
    intencao,
    confianca,
    segundaIntencao: segunda,
    sentimento: 'neutro',
    entidades: { dataHora: null, nomeCitado: null, plataformaCitada: null, motivo: null },
  };
}

const casos: readonly CasoDeEval<ContextoDaDecisao, Veredito>[] = [
  {
    nome: 'opt-out escondido no meio de outro assunto',
    entrada: {
      mensagem: 'quanto custa? ah, e não me manda mais mensagem aqui não',
      saidaDoModelo: doModelo('PEDIU_TAXA_PRECO', 0.93),
    },
    esperado: {
      intencao: 'OPT_OUT',
      origem: 'regra',
      secundaria: 'PEDIU_TAXA_PRECO',
      escalar: false,
      motivos: [],
    },
  },
  {
    nome: 'opt-out por comando isolado',
    entrada: { mensagem: 'PARAR', saidaDoModelo: doModelo('AMBIGUO', 0.4) },
    esperado: {
      intencao: 'OPT_OUT',
      origem: 'regra',
      secundaria: 'AMBIGUO',
      escalar: false,
      motivos: [],
    },
  },
  {
    nome: 'duas intenções: responde a taxa e guarda o retorno',
    entrada: {
      mensagem: 'quanto é a taxa? me chama sexta que hoje tô em evento',
      saidaDoModelo: doModelo('PEDIU_TAXA_PRECO', 0.88, 'ME_CHAMA_DEPOIS'),
    },
    esperado: {
      intencao: 'PEDIU_TAXA_PRECO',
      origem: 'modelo',
      secundaria: 'ME_CHAMA_DEPOIS',
      escalar: false,
      motivos: [],
    },
  },
  {
    nome: 'prioridade absoluta: hostil vence, mesmo com confiança baixa',
    entrada: {
      mensagem: 'vocês são chatos, já me ligaram três vezes',
      saidaDoModelo: doModelo('QUER_SABER_MAIS', 0.42, 'HOSTIL'),
    },
    esperado: {
      intencao: 'HOSTIL',
      origem: 'modelo',
      secundaria: 'QUER_SABER_MAIS',
      escalar: true,
      motivos: ['hostilidade'],
    },
  },
  {
    nome: 'confiança abaixo de 0,7 vira pergunta, não chute',
    entrada: { mensagem: 'ok', saidaDoModelo: doModelo('INTERESSADO', 0.55) },
    esperado: {
      intencao: 'AMBIGUO',
      origem: 'modelo',
      secundaria: 'INTERESSADO',
      escalar: false,
      motivos: [],
    },
  },
  {
    nome: 'confiança baixa duas vezes seguidas vai para humano',
    entrada: {
      mensagem: 'hum',
      saidaDoModelo: doModelo('INTERESSADO', 0.5),
      confiancaAnteriorBaixa: true,
    },
    esperado: {
      intencao: 'AMBIGUO',
      origem: 'modelo',
      secundaria: 'INTERESSADO',
      escalar: true,
      motivos: ['confianca_baixa_repetida'],
    },
  },
  {
    nome: 'termo de alto valor escala mesmo com a intenção certa',
    entrada: {
      mensagem: 'me manda o contrato pra eu ver com meu advogado',
      saidaDoModelo: doModelo('PERGUNTA_CONTRATUAL', 0.9),
    },
    esperado: {
      intencao: 'PERGUNTA_CONTRATUAL',
      origem: 'modelo',
      secundaria: null,
      escalar: true,
      motivos: ['termo_de_alto_valor'],
    },
  },
  {
    nome: 'objeção de comissão repetida vai para gente',
    entrada: {
      mensagem: 'já falei que não trabalho com porcentagem',
      saidaDoModelo: doModelo('NAO_TRABALHO_COM_COMISSAO', 0.94),
      intencaoAnterior: 'NAO_TRABALHO_COM_COMISSAO',
    },
    esperado: {
      intencao: 'NAO_TRABALHO_COM_COMISSAO',
      origem: 'modelo',
      secundaria: null,
      escalar: true,
      motivos: ['intencao_repetida'],
    },
  },
  {
    nome: 'sem saída do modelo, o sistema pergunta e chama gente',
    entrada: { mensagem: 'bom dia', saidaDoModelo: null },
    esperado: {
      intencao: 'AMBIGUO',
      origem: 'regra',
      secundaria: null,
      escalar: true,
      motivos: ['sem_saida_do_modelo'],
    },
  },
  {
    nome: 'contato VIP nunca é respondido pelo robô',
    entrada: {
      mensagem: 'pode mandar',
      saidaDoModelo: doModelo('INTERESSADO', 0.95),
      vip: true,
    },
    esperado: {
      intencao: 'INTERESSADO',
      origem: 'modelo',
      secundaria: null,
      escalar: true,
      motivos: ['contato_vip'],
    },
  },
  {
    nome: 'recusa suave da oferta não deveria ser opt-out',
    entrada: {
      mensagem: 'não quero mexer com aplicativo agora, obrigado',
      saidaDoModelo: doModelo('SEM_INTERESSE_SUAVE', 0.9),
    },
    esperado: {
      intencao: 'SEM_INTERESSE_SUAVE',
      origem: 'modelo',
      secundaria: null,
      escalar: false,
      motivos: [],
    },
    conhecido: {
      obtido: {
        intencao: 'OPT_OUT',
        origem: 'regra',
        secundaria: 'SEM_INTERESSE_SUAVE',
        escalar: false,
        motivos: [],
      },
      motivo:
        '"não quero" está no léxico de opt-out do RF-CON-19 e dispara antes da IA; o R08 §1 trata a mesma frase como recusa reativável. Precisa de decisão de Rafael/Dennis: ou a expressão sai do léxico, ou a supressão passa a valer para ela',
      desde: '2026-09-05',
    },
  },
  {
    nome: 'duas perguntas curtas não precisavam de gente',
    entrada: {
      mensagem: 'é caro? tem mensalidade?',
      saidaDoModelo: doModelo('PEDIU_TAXA_PRECO', 0.92),
    },
    esperado: {
      intencao: 'PEDIU_TAXA_PRECO',
      origem: 'modelo',
      secundaria: null,
      escalar: false,
      motivos: [],
    },
    conhecido: {
      obtido: {
        intencao: 'PEDIU_TAXA_PRECO',
        origem: 'modelo',
        secundaria: null,
        escalar: true,
        motivos: ['mensagem_longa'],
      },
      motivo:
        'o gatilho 7 do R08 §5.3 conta pontos de interrogação, e duas perguntas sobre o mesmo assunto contam como "múltiplas perguntas". Sobe a escalada acima dos 20–35% saudáveis; o conserto é contar assuntos, não interrogações',
      desde: '2026-09-05',
    },
  },
];

rodarEvals('decisão de intenção', casos, julgar, { conhecidosEsperados: 2 });

describe('taxonomia e léxico de opt-out', () => {
  it('são exatamente as 25 intenções do Apêndice C', () => {
    expect(INTENCOES).toHaveLength(25);
    expect(new Set(INTENCOES).size).toBe(25);
  });

  it('toda intenção tem ficha, e só três têm prioridade absoluta', () => {
    for (const intencao of INTENCOES) expect(fichaDa(intencao).intencao).toBe(intencao);
    const absolutas = INTENCOES.filter((intencao) => fichaDa(intencao).prioridadeAbsoluta);
    expect(absolutas).toEqual(['NAO_E_A_PESSOA', 'OPT_OUT', 'HOSTIL']);
  });

  it('as variações de opt-out do RF-CON-19 são reconhecidas', () => {
    for (const frase of [
      'sair',
      'pare',
      'para de me mandar mensagem',
      'não me manda mais nada',
      'me tira dessa lista por favor',
      'remover meu número',
      'quero descadastrar',
      'não quero mais receber',
      'vou bloquear',
      'não me ligue mais',
    ]) {
      expect(detectarOptOut(frase), frase).not.toBeNull();
    }
  });

  it('conversa normal não dispara opt-out', () => {
    for (const frase of [
      'manda pra mim',
      'pode parar aí que eu já entendi, gostei',
      'quanto custa?',
      'me liga amanhã',
    ]) {
      expect(detectarOptOut(frase), frase).toBeNull();
    }
  });

  it('as duas regras amplas estão marcadas como amplas', () => {
    const amplas = REGRAS_DE_OPT_OUT.filter((regra) => regra.amplo).map((regra) => regra.id);
    expect(amplas).toEqual(['nao-tenho-interesse', 'nao-quero']);
  });
});
