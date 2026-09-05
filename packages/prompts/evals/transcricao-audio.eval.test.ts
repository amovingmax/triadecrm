import { describe, expect, it } from 'vitest';

import {
  type ContextoDoContato,
  type DecisaoDaTranscricao,
  type SaidaDaTranscricao,
  decidirRoteamento,
  esquemaDeSaida,
  prepararChamada,
  transcricaoAudioV1,
  varrerMontagem,
} from '../src/index';
import { type CasoDeEval, rodarEvals } from './executar';

/**
 * `transcricao-audio@v1` (RF-CON-27) e a regra que decide o que fazer com o resultado.
 *
 * O modelo não é chamado: a saída dele entra como fixture, e o que se mede é o
 * roteamento — a parte que decide se a conversa anda sozinha ou se alguém precisa ouvir.
 * É a decisão que custa caro quando erra, e é código nosso.
 *
 * O caso conhecido é o buraco de um `[inaudível]` só: a regra conta trechos, não conta
 * o que estava dentro deles, e um buraco em cima da data é diferente de um buraco em
 * cima de "então assim". Contar não resolve isso; só o texto em volta resolveria.
 */

const CONTATO: ContextoDoContato = {
  leadId: 'lead-77c3',
  nome: 'Rita Bezerra',
  empresa: 'Espaço Dunas',
  telefones: ['+5584988776655'],
};

function saida(parcial: Partial<SaidaDaTranscricao>): SaidaDaTranscricao {
  return {
    textoLimpo: 'Pode mandar, quero entender melhor.',
    trechosInaudiveis: 0,
    confianca: 'alta',
    precisaDeHumano: false,
    resumo: 'Quer entender melhor.',
    entidades: { datas: [], valores: [], nomesCitados: [], plataformas: [] },
    ...parcial,
  };
}

interface CasoDeRoteamento {
  readonly saida: SaidaDaTranscricao;
  readonly modoMvp: boolean;
}

const casos: readonly CasoDeEval<CasoDeRoteamento, DecisaoDaTranscricao>[] = [
  {
    nome: 'no MVP, todo áudio recebido vai para gente',
    entrada: { saida: saida({}), modoMvp: true },
    esperado: { destino: 'humano', motivos: ['mvp_audio_sempre_humano'] },
  },
  {
    nome: 'fora do MVP, transcrição limpa segue para o classificador',
    entrada: { saida: saida({}), modoMvp: false },
    esperado: { destino: 'classificador', motivos: [] },
  },
  {
    nome: 'confiança baixa nunca segue sozinha',
    entrada: { saida: saida({ confianca: 'baixa' }), modoMvp: false },
    esperado: { destino: 'humano', motivos: ['confianca_baixa'] },
  },
  {
    nome: 'o modelo pedindo humano é obedecido',
    entrada: { saida: saida({ precisaDeHumano: true }), modoMvp: false },
    esperado: { destino: 'humano', motivos: ['modelo_pediu_humano'] },
  },
  {
    nome: 'áudio ruidoso: buraco demais, confiança baixa e pedido de humano juntos',
    entrada: {
      saida: saida({ confianca: 'baixa', precisaDeHumano: true, trechosInaudiveis: 3 }),
      modoMvp: false,
    },
    esperado: {
      destino: 'humano',
      motivos: ['modelo_pediu_humano', 'confianca_baixa', 'inaudiveis_demais'],
    },
  },
  {
    nome: 'um buraco só, em cima da data combinada',
    entrada: {
      saida: saida({
        textoLimpo: 'Pode ser [inaudível] de manhã, aí a gente conversa.',
        trechosInaudiveis: 1,
        confianca: 'media',
        resumo: 'Aceita conversar de manhã, mas o dia não deu para entender.',
      }),
      modoMvp: false,
    },
    esperado: { destino: 'humano', motivos: ['inaudiveis_demais'] },
    conhecido: {
      obtido: { destino: 'classificador', motivos: [] },
      motivo:
        'a regra conta trechos inaudíveis, não olha o que ficou dentro deles; um buraco em cima do dia combinado passa igual a um buraco em cima de uma hesitação. O conserto é o modelo marcar `precisaDeHumano` quando o [inaudível] cai sobre data, valor ou nome — instrução para a v2',
      desde: '2026-09-05',
    },
  },
];

rodarEvals(
  'roteamento do áudio transcrito',
  casos,
  ({ saida: resultado, modoMvp }) => decidirRoteamento(resultado, { modoMvp }),
  { conhecidosEsperados: 1 },
);

describe('transcricao-audio@v1: o contrato da versão', () => {
  it('os exemplos do prompt passam nos próprios schemas', () => {
    for (const exemplo of transcricaoAudioV1.exemplos) {
      expect(() => transcricaoAudioV1.entrada.parse(exemplo.entrada), exemplo.nome).not.toThrow();
      expect(() => transcricaoAudioV1.saida.parse(exemplo.saida), exemplo.nome).not.toThrow();
    }
  });

  it('a mensagem leva a transcrição pseudonimizada e nada mais', () => {
    const chamada = prepararChamada(
      transcricaoAudioV1,
      {
        leadId: CONTATO.leadId,
        canal: 'whatsapp',
        duracaoSeg: 33,
        transcricaoBruta:
          'oi aqui é a Rita Bezerra do Espaço Dunas, meu número é 84 98877-6655 viu',
        confiancaAsr: 0.87,
        contexto: 'Espaço para eventos na praia.',
      },
      CONTATO,
    );
    expect(chamada.modelo).toBe('claude-haiku-4-5');
    expect(chamada.proposito).toBe('transcribe_audio');
    expect(chamada.mensagem).toContain('[[NOME_1]]');
    expect(chamada.mensagem).toContain('[[EMPRESA_1]]');
    expect(chamada.mensagem).toContain('[[TELEFONE_1]]');
    // A mensagem montada se confere com `varrerMontagem`; a auditoria de verdade
    // (`verificarSemPii`, sem fronteira, só sobre o que veio de fora) já rodou dentro de
    // `prepararChamada` — se ela tivesse achado algo, esta linha não seria alcançada.
    expect(varrerMontagem(chamada.mensagem)).toEqual([]);
  });

  it('a saída do modelo é validada contra o schema da versão', () => {
    const chamada = prepararChamada(
      transcricaoAudioV1,
      {
        leadId: CONTATO.leadId,
        canal: 'whatsapp',
        duracaoSeg: 12,
        transcricaoBruta: 'pode mandar',
        confiancaAsr: 0.95,
        contexto: null,
      },
      CONTATO,
    );
    expect(chamada.interpretar(saida({}))).toEqual(saida({}));
    expect(() => chamada.interpretar({ textoLimpo: 'só isso' })).toThrow();
    expect(() => chamada.interpretar({ ...saida({}), confianca: 'altíssima' })).toThrow();
  });

  it('o JSON Schema da saída sai do próprio zod', () => {
    const esquema = esquemaDeSaida(transcricaoAudioV1);
    expect(esquema['type']).toBe('object');
    expect(Object.keys(esquema['properties'] as Record<string, unknown>)).toContain('textoLimpo');
  });
});
