import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  MODELOS,
  type ContextoDoContato,
  PiiNaChamadaError,
  type PromptVersionado,
  TipoNaoAuditavelError,
  classificarIntencaoV1,
  definirPrompt,
  followupLigacaoV1,
  prepararChamada,
  pseudonimizar,
  raizDoCampo,
  reidratar,
  trechosDeFora,
  resumoLigacaoV1,
  transcricaoAudioV1,
  varrerMontagem,
  verificarSemPii,
} from '../src/index';
import { type CasoDeEval, rodarEvals } from './executar';

/**
 * O guardrail de LGPD, e o único eval do pacote que não admite "quase certo": nenhum
 * prompt pode receber telefone (ADR-09; R06 IA-06; CLAUDE.md).
 *
 * Esta suíte está na terceira versão porque as duas primeiras caíram na conferência
 * adversarial, e sempre do mesmo jeito: a detecção dependia de **reconhecer formatação**
 * (corridas de dígitos, separadores permitidos, fronteira de grupo), e sempre apareceu
 * uma arrumação nova que a heurística não previa. A v1 desistia da corrida inteira acima
 * de 13 dígitos, então dois telefones lado a lado (22 dígitos) vazavam os dois. A v2
 * passou a procurar subsequências, mas criou uma trava de "fronteira de grupo" e tirou a
 * barra da lista de separadores; caiu com nove entradas, entre elas o telefone que o CRM
 * já tem no cadastro, escrito `84 99988 - 0011`.
 *
 * A régua agora é a **projeção de dígitos**: o texto vira uma string só com os dígitos
 * mais o índice original de cada um, e toda a detecção acontece ali. Por isso o bloco
 * "formatação não existe" abaixo escreve o mesmo número de doze maneiras e exige o mesmo
 * resultado das doze.
 *
 * Na 4ª conferência a projeção passou — 65 variações de separador, 0 vazamentos. Caíram
 * duas outras coisas, e os blocos `FURO A` e `FURO B` no fim deste arquivo são delas:
 * algarismo que o Unicode não classifica como dígito decimal (`⑧`, `⁸`, `₈`), e dígito
 * separado por **letra**, que a fronteira de letra da auditoria deixava passar. A primeira
 * virou uma pergunta nova por ponto de código; a segunda virou uma auditoria que só
 * enxerga o que veio de fora, e por isso pode correr sem fronteira nenhuma.
 *
 * A suíte tem três metades obrigatórias:
 *
 * - **Positivos** — o que tem de virar marcador.
 * - **Negativos** — o que NÃO pode virar `[[TELEFONE]]`. Trocar um CEP ou uma data por
 *   telefone não vaza nada, mas estraga o texto que vai ao modelo e piora a resposta. Um
 *   eval que só cobre a primeira metade autoriza consertar o vazamento destruindo o
 *   texto, e isso não é conserto.
 * - **Auditoria** — a segunda camada, que pega o que a regra perde. Inclui um teste que
 *   quebra a regra de propósito.
 *
 * Os casos `conhecido` são limites reais, não descuido, e estão listados no relatório do
 * dia com o que ainda vaza.
 */

const CONTATO: ContextoDoContato = {
  leadId: 'lead-0f21',
  nome: 'Marcos Tavares',
  empresa: 'Buffet Sabor da Praia',
  telefones: ['+5584999880011'],
  emails: ['contato@sabordapraia.com.br'],
  instagram: 'sabordapraia',
};

/** Um CNPJ de verdade (dígitos verificadores corretos): a regra confere o DV. */
const CNPJ = '12.345.678/0001-95';
const UUID = '6f2a1c84-9d21-4b77-8e10-446655440000';

interface CasoDeTexto {
  readonly texto: string;
  readonly contexto: ContextoDoContato;
}

const casos: readonly CasoDeEval<CasoDeTexto, string>[] = [
  // ---------------------------------------------------------------- positivos
  {
    nome: 'telefone formatado no meio da frase',
    entrada: { texto: 'pode me ligar no (84) 99988-0011 depois das 14h', contexto: CONTATO },
    esperado: 'pode me ligar no [[TELEFONE_1]] depois das 14h',
  },
  {
    nome: 'telefone colado, sem separador',
    entrada: { texto: 'meu whats é 84999880011', contexto: CONTATO },
    esperado: 'meu whats é [[TELEFONE_1]]',
  },
  {
    nome: 'o mesmo número em dois formatos vira o mesmo marcador',
    entrada: {
      texto: 'anota 84 99988-0011, ou se preferir +55 84 99988 0011',
      contexto: CONTATO,
    },
    esperado: 'anota [[TELEFONE_1]], ou se preferir [[TELEFONE_1]]',
  },
  {
    nome: 'telefone que o CRM não conhece também sai',
    entrada: { texto: 'fala com o financeiro no 84 3222-1188', contexto: CONTATO },
    esperado: 'fala com o financeiro no [[TELEFONE_2]]',
  },
  {
    nome: 'conferência: dois telefones seguidos — o vizinho não pode desarmar a troca',
    entrada: {
      texto: 'oi e o Marcos, meu whats 84999880011 84988887777, escolhe',
      contexto: CONTATO,
    },
    esperado: 'oi e o [[NOME_2]], meu whats [[TELEFONE_1]] [[TELEFONE_2]], escolhe',
  },
  {
    nome: 'conferência: telefone ao lado de um CEP',
    entrada: { texto: 'anota: CEP 59082-050 84999880011 pode ligar', contexto: CONTATO },
    esperado: 'anota: CEP 59082-050 [[TELEFONE_1]] pode ligar',
  },
  {
    nome: 'conferência: telefone ao lado de um valor em reais',
    entrada: { texto: 'o buffet sai R$ 2.500 84999880011 me chama', contexto: CONTATO },
    esperado: 'o buffet sai R$ 2.500 [[TELEFONE_1]] me chama',
  },
  {
    nome: 'conferência: telefone ao lado de um número de pedido',
    entrada: { texto: 'pedido 20260905 84999880011 confirmado', contexto: CONTATO },
    esperado: 'pedido 20260905 [[TELEFONE_1]] confirmado',
  },
  {
    nome: 'telefone ao lado de um CNPJ (o CNPJ vira DOCUMENTO, não TELEFONE)',
    entrada: { texto: `CNPJ ${CNPJ}, whats 84988887777`, contexto: CONTATO },
    esperado: 'CNPJ [[DOCUMENTO_1]], whats [[TELEFONE_2]]',
  },
  {
    nome: 'telefone ao lado de uma data',
    entrada: { texto: 'dia 12/12/2026 chama no 84988887777', contexto: CONTATO },
    esperado: 'dia 12/12/2026 chama no [[TELEFONE_2]]',
  },
  {
    nome: 'telefone ao lado de uma placa',
    entrada: { texto: 'placa ABC-1234 e o zap 84988887777', contexto: CONTATO },
    esperado: 'placa ABC-1234 e o zap [[TELEFONE_2]]',
  },
  {
    nome: 'três telefones separados por vírgula',
    entrada: { texto: 'salva 84988887777, 84977776666 e 84966665555', contexto: CONTATO },
    esperado: 'salva [[TELEFONE_2]], [[TELEFONE_3]] e [[TELEFONE_4]]',
  },
  {
    nome: 'telefone dentro de um e-mail sai como e-mail, não como telefone',
    entrada: { texto: 'manda pro 84988887777@gmail.com que eu vejo', contexto: CONTATO },
    esperado: 'manda pro [[EMAIL_2]] que eu vejo',
  },
  {
    nome: 'o telefone conhecido sem o nono dígito cai no mesmo marcador',
    entrada: { texto: 'me liga no 84 9988-0011 que é o mesmo número', contexto: CONTATO },
    esperado: 'me liga no [[TELEFONE_1]] que é o mesmo número',
  },
  {
    nome: 'o telefone conhecido não depende de fronteira: um zero grudado não o salva',
    entrada: { texto: 'ligue 084999880011 agora', contexto: CONTATO },
    esperado: 'ligue 0[[TELEFONE_1]] agora',
  },
  {
    nome: 'o telefone desconhecido também não depende de fronteira',
    entrada: { texto: 'ligue 084988887777 agora', contexto: CONTATO },
    esperado: 'ligue 0[[TELEFONE_2]] agora',
  },
  {
    nome: 'telefone local, sem DDD, com hífen',
    entrada: { texto: 'liga no 3222-1188 depois das 14h', contexto: CONTATO },
    esperado: 'liga no [[TELEFONE_2]] depois das 14h',
  },
  {
    nome: 'telefone local, sem DDD e SEM hífen — a tecla que ninguém aperta',
    entrada: { texto: 'liga no 3222 1188 depois das 14h', contexto: CONTATO },
    esperado: 'liga no [[TELEFONE_2]] depois das 14h',
  },
  {
    nome: 'o celular do próprio contato, escrito sem DDD e sem hífen',
    entrada: { texto: 'meu whats é 99988 0011, salva aí', contexto: CONTATO },
    esperado: 'meu whats é [[TELEFONE_1]], salva aí',
  },
  {
    nome: 'e-mail e @instagram',
    entrada: {
      texto: 'manda em contato@sabordapraia.com.br ou chama no @sabordapraia',
      contexto: CONTATO,
    },
    esperado: 'manda em [[EMAIL_1]] ou chama no [[INSTAGRAM_1]]',
  },
  {
    nome: 'nome, primeiro nome e empresa',
    entrada: {
      texto:
        'O Marcos Tavares disse que o Buffet Sabor da Praia fecha em janeiro. Marcos volta dia 3.',
      contexto: CONTATO,
    },
    esperado: 'O [[NOME_1]] disse que o [[EMPRESA_1]] fecha em janeiro. [[NOME_2]] volta dia 3.',
  },

  // ---------------------------------------------------------------- negativos
  {
    nome: 'negativo: CEP sozinho não é telefone',
    entrada: { texto: 'o CEP é 59082-050', contexto: CONTATO },
    esperado: 'o CEP é 59082-050',
  },
  {
    nome: 'negativo: valor em reais sozinho não é telefone',
    entrada: { texto: 'o buffet dele sai por R$ 3.500 por evento', contexto: CONTATO },
    esperado: 'o buffet dele sai por R$ 3.500 por evento',
  },
  {
    nome: 'negativo: CNPJ sozinho não é telefone',
    entrada: { texto: `CNPJ ${CNPJ} registrado`, contexto: CONTATO },
    esperado: 'CNPJ [[DOCUMENTO_1]] registrado',
  },
  {
    nome: 'negativo: CNPJ nu não é telefone',
    entrada: { texto: 'nota fiscal 12345678000195 emitida', contexto: CONTATO },
    esperado: 'nota fiscal [[DOCUMENTO_1]] emitida',
  },
  {
    nome: 'negativo: data sozinha não é telefone',
    entrada: { texto: 'a formatura é 12/12/2026, às 20h', contexto: CONTATO },
    esperado: 'a formatura é 12/12/2026, às 20h',
  },
  {
    nome: 'negativo: data ISO não é telefone',
    entrada: { texto: 'reunião marcada para 2026-09-05', contexto: CONTATO },
    esperado: 'reunião marcada para 2026-09-05',
  },
  {
    nome: 'negativo: número de protocolo de 10 dígitos não é telefone',
    entrada: { texto: 'protocolo 2026090512 aberto', contexto: CONTATO },
    esperado: 'protocolo 2026090512 aberto',
  },
  {
    nome: 'negativo: uuid não é telefone',
    entrada: { texto: `negócio ${UUID} fechado`, contexto: CONTATO },
    esperado: 'negócio [[DOCUMENTO_1]] fechado',
  },
  {
    nome: 'negativo: par de anos não é telefone local',
    entrada: { texto: 'contrato de 1990-2020 arquivado', contexto: CONTATO },
    esperado: 'contrato de 1990-2020 arquivado',
  },

  // ---------------------------------------------------------------- conhecidos
  {
    nome: 'telefone falado por extenso na transcrição',
    entrada: {
      texto: 'anota aí, oito quatro nove nove nove oito oito zero zero um um',
      contexto: CONTATO,
    },
    esperado: 'anota aí, [[TELEFONE_1]]',
    conhecido: {
      obtido: 'anota aí, oito quatro nove nove nove oito oito zero zero um um',
      motivo:
        'a projeção só enxerga dígito; número ditado por extenso não tem dígito nenhum. Segurado pela regra de RF-CON-27 (áudio recebido vai para humano no MVP), não pela detecção',
      desde: '2026-09-05',
    },
  },
  {
    nome: 'nome de terceiro que o CRM não conhece',
    entrada: { texto: 'quem decide é a Ana, sócia dele', contexto: CONTATO },
    esperado: 'quem decide é a [[NOME_2]], sócia dele',
    conhecido: {
      obtido: 'quem decide é a Ana, sócia dele',
      motivo:
        'só nomes vindos do CRM são reconhecidos; nome de terceiro exigiria NER e é justamente o que não se manda ao modelo para descobrir',
      desde: '2026-09-05',
    },
  },
  {
    nome: 'telefone gratuito 0800',
    entrada: { texto: 'liga no 0800 970 5555 se preferir', contexto: CONTATO },
    esperado: 'liga no [[TELEFONE_2]] se preferir',
    conhecido: {
      obtido: 'liga no 0800 970 5555 se preferir',
      motivo:
        '0800 não tem DDD e a numeração não é a de telefone pessoal; aceitá-la aqui obrigaria a aceitar qualquer 11 dígitos começando em zero. É linha comercial, não contato de pessoa física — e a auditoria também não a acusa',
      desde: '2026-09-05',
    },
  },
];

rodarEvals(
  'pseudonimização: o que sai do CRM antes de virar token',
  casos,
  ({ texto, contexto }) => pseudonimizar(texto, contexto).texto,
  { conhecidosEsperados: 3 },
);

/**
 * As nove entradas que derrubaram a v2. Todas têm a mesma forma: espaço e hífen
 * espalhados em lugares que nenhuma lista de separadores previu, e uma delas é o
 * telefone que o CRM **já tem no cadastro**. Sobre a projeção de dígitos, as nove são o
 * mesmo número — e é por isso que este bloco existe: se alguém voltar a decidir por
 * formatação, ele fica vermelho.
 */
const NOVE_QUE_DERRUBARAM: ReadonlyArray<readonly [string, string]> = [
  ['salva ai: 84 99988 - 0011', 'salva ai: [[TELEFONE_1]]'],
  ['zap novo: 84  99988  0011', 'zap novo: [[TELEFONE_1]]'],
  ['chama no (84)99988.0011 hoje', 'chama no [[TELEFONE_1]] hoje'],
  ['anota: 8 4 9 9 9 8 8 0 0 1 1', 'anota: [[TELEFONE_1]]'],
  ['whats +55 (84) 9 9988-0011', 'whats [[TELEFONE_1]]'],
  ['84-99988-0011 é o meu', '[[TELEFONE_1]] é o meu'],
  ['84/99988/0011 pode salvar', '[[TELEFONE_1]] pode salvar'],
  ['me liga: 084 99988 0011', 'me liga: 0[[TELEFONE_1]]'],
  [
    'dois contatos: 84 99988 - 0011 / 84 98888 - 7777',
    'dois contatos: [[TELEFONE_1]] / [[TELEFONE_2]]',
  ],
];

describe('as nove entradas da conferência que derrubou a v2', () => {
  for (const [texto, esperado] of NOVE_QUE_DERRUBARAM) {
    it(`vira marcador: ${texto}`, () => {
      const { texto: protegido } = pseudonimizar(texto, CONTATO);
      expect(protegido).toBe(esperado);
      expect(protegido).not.toContain('99988');
      expect(protegido).not.toContain('98888');
      expect(verificarSemPii(protegido)).toEqual([]);
    });
  }
});

/**
 * Formatação não existe: o telefone do contato escrito de doze maneiras, inclusive com
 * um espaço entre cada dígito, tem de dar o mesmo resultado. É o caminho do "telefone
 * conhecido primeiro", o único que não pode falhar nunca.
 */
const DOZE_FORMAS: readonly string[] = [
  '84999880011',
  '84 99988 0011',
  '(84) 99988-0011',
  '+55 84 99988-0011',
  '+5584999880011',
  '84.99988.0011',
  '84-99988-0011',
  '84/99988/0011',
  '8 4 9 9 9 8 8 0 0 1 1',
  '84 99988 - 0011',
  '55 (84) 9 9988 0011',
  '84 9988-0011',
];

describe('o telefone do cadastro, doze formatações, um só resultado', () => {
  for (const forma of DOZE_FORMAS) {
    it(`contato: ${forma}`, () => {
      const original = `contato: ${forma}`;
      const { texto, mapa } = pseudonimizar(original, CONTATO);
      expect(texto).toBe('contato: [[TELEFONE_1]]');
      expect(reidratar(texto, mapa)).toBe(original);
      expect(verificarSemPii(texto)).toEqual([]);
    });
  }
});

describe('pseudonimização: mapa, reidratação e a conferência final', () => {
  it('reidratar devolve exatamente o texto original', () => {
    const original =
      'Oi Marcos Tavares, te ligo no (84) 99988-0011 ou mando em contato@sabordapraia.com.br';
    const { texto, mapa } = pseudonimizar(original, CONTATO);
    expect(texto).not.toContain('99988');
    expect(reidratar(texto, mapa)).toBe(original);
  });

  it('reidratar devolve o original mesmo com dois telefones colados na frase', () => {
    const original = 'meu whats 84999880011 84988887777, escolhe';
    const { texto, mapa } = pseudonimizar(original, CONTATO);
    expect(texto).not.toMatch(/\d{8}/);
    expect(reidratar(texto, mapa)).toBe(original);
  });

  it('reidratar devolve o CNPJ e o uuid que viraram DOCUMENTO', () => {
    const original = `CNPJ ${CNPJ} do negócio ${UUID}`;
    const { texto, mapa } = pseudonimizar(original, CONTATO);
    expect(texto).toBe('CNPJ [[DOCUMENTO_1]] do negócio [[DOCUMENTO_2]]');
    expect(reidratar(texto, mapa)).toBe(original);
  });

  it('o telefone do contato é sempre o [[TELEFONE_1]], venha ele de onde vier', () => {
    const { texto } = pseudonimizar('liga no 84 3222-1188 que é o fixo', CONTATO);
    expect(texto).toContain('[[TELEFONE_2]]');
  });

  it('prepararChamada não deixa telefone chegar ao modelo', () => {
    const chamada = prepararChamada(
      transcricaoAudioV1,
      {
        leadId: CONTATO.leadId,
        canal: 'whatsapp',
        duracaoSeg: 24,
        transcricaoBruta: 'oi é o Marcos Tavares, me liga no (84) 99988-0011 hoje ainda',
        confiancaAsr: 0.9,
        contexto: null,
      },
      CONTATO,
    );
    expect(chamada.mensagem).not.toMatch(/99988/);
    expect(chamada.mensagem).toContain('[[TELEFONE_1]]');
    // A mensagem montada se confere com `varrerMontagem`; a auditoria de verdade
    // (`verificarSemPii`, sem fronteira, só sobre o que veio de fora) já rodou dentro de
    // `prepararChamada` — se ela tivesse achado algo, esta linha não seria alcançada.
    expect(varrerMontagem(chamada.mensagem)).toEqual([]);
    expect(chamada.promptVersion).toBe('transcricao-audio@v1');
  });

  it('a chamada é recusada quando o campo com PII não foi declarado', () => {
    const promptSemCampoDeclarado = { ...transcricaoAudioV1, camposDeTexto: [] as string[] };
    expect(() =>
      prepararChamada(
        promptSemCampoDeclarado,
        {
          leadId: CONTATO.leadId,
          canal: 'whatsapp',
          duracaoSeg: 24,
          transcricaoBruta: 'me liga no (84) 99988-0011',
          confiancaAsr: 0.9,
          contexto: null,
        },
        CONTATO,
      ),
    ).toThrow(PiiNaChamadaError);
  });
});

/**
 * A segunda camada. Ela não importa nada da regra e é burra de propósito: projeta os
 * dígitos, quebra só nas letras e acusa qualquer janela de 10 a 13 dígitos que comece
 * por DDD. Não conhece CEP, não conhece CNPJ, não confere dígito verificador, não
 * desconta nada — foi o desconto de CNPJ por DV que abriu, na v2, um buraco de 14
 * dígitos.
 */
describe('auditoria: a segunda camada pega o que a regra perde', () => {
  const EM_CLARO = [
    'oi e o Marcos, meu whats 84999880011 84988887777, escolhe',
    'anota: CEP 59082-050 84999880011 pode ligar',
    'o buffet sai R$ 2.500 84999880011 me chama',
    'pedido 20260905 84999880011 confirmado',
    'salva ai: 84 99988 - 0011',
    'anota: 8 4 9 9 9 8 8 0 0 1 1',
    '84/99988/0011 pode salvar',
  ];

  for (const texto of EM_CLARO) {
    it(`acusa telefone em claro: ${texto}`, () => {
      expect(verificarSemPii(texto).some((problema) => problema.tipo === 'TELEFONE')).toBe(true);
    });
  }

  it('acusa telefone com dígitos grudados na frente e no fim', () => {
    expect(verificarSemPii('ligue 084988887777 agora')).toEqual([
      { tipo: 'TELEFONE', trecho: '84988887777' },
    ]);
    expect(verificarSemPii('o zap dele é 84988887777123')).toEqual([
      { tipo: 'TELEFONE', trecho: '8498888777712' },
    ]);
  });

  it('acusa telefone, e-mail e @ no formato de sempre', () => {
    expect(verificarSemPii('sem nada aqui')).toEqual([]);
    expect(verificarSemPii('liga 84 99988-0011')).toEqual([
      { tipo: 'TELEFONE', trecho: '84 99988-0011' },
    ]);
    expect(verificarSemPii('escreve pra contato@sabordapraia.com.br')).toEqual([
      { tipo: 'EMAIL', trecho: 'contato@sabordapraia.com.br' },
    ]);
    expect(verificarSemPii('chama no @sabordapraia')).toEqual([
      { tipo: 'INSTAGRAM', trecho: '@sabordapraia' },
    ]);
  });

  it('não derruba a chamada por CEP, valor, data, protocolo, par de anos ou marcador', () => {
    for (const texto of [
      'o CEP é 59082-050',
      'o buffet dele sai por R$ 3.500 por evento',
      'reunião marcada para 2026-09-05',
      'protocolo 2026090512 aberto',
      'contrato de 1990-2020 arquivado',
      'o [[NOME_1]] do [[EMPRESA_1]] mandou [[TELEFONE_1]] e [[TELEFONE_2]] hoje',
    ]) {
      expect({ texto, problemas: verificarSemPii(texto) }).toEqual({ texto, problemas: [] });
    }
  });

  /**
   * A contrapartida de a auditoria não descontar nada: 14 dígitos crus com DDD na frente
   * barram a chamada. É consequência esperada e aceita — o conserto é a regra substituir
   * mais (é o que a passada de `[[DOCUMENTO_n]]` faz), nunca a auditoria perdoar mais.
   */
  it('derruba a chamada por CNPJ ou uuid crus — e é por isso que a regra os mascara', () => {
    expect(verificarSemPii(`CNPJ ${CNPJ} registrado`).length).toBeGreaterThan(0);
    expect(verificarSemPii(`negócio ${UUID} fechado`).length).toBeGreaterThan(0);
    // Depois da regra, o texto que chega à auditoria não tem mais os dígitos.
    expect(verificarSemPii(pseudonimizar(`CNPJ ${CNPJ} registrado`, CONTATO).texto)).toEqual([]);
    expect(verificarSemPii(pseudonimizar(`negócio ${UUID} fechado`, CONTATO).texto)).toEqual([]);
  });

  it('a chamada não sai quando a regra é quebrada de propósito', () => {
    // `camposDeTexto: []` desliga a pseudonimização: é a regra falhando por completo.
    // A auditoria é a única coisa entre o telefone e a API — e ela segura.
    const semRegra = { ...transcricaoAudioV1, camposDeTexto: [] as string[] };
    for (const bruta of [
      'salva ai: 84 99988 - 0011',
      'anota: 8 4 9 9 9 8 8 0 0 1 1',
      '84/99988/0011 pode salvar',
      'ligue 084988887777 agora',
    ]) {
      expect(() =>
        prepararChamada(
          semRegra,
          {
            leadId: CONTATO.leadId,
            canal: 'whatsapp',
            duracaoSeg: 24,
            transcricaoBruta: bruta,
            confiancaAsr: 0.9,
            contexto: null,
          },
          CONTATO,
        ),
      ).toThrow(PiiNaChamadaError);
    }
  });

  /**
   * Por que o prompt de sistema **não pode** chegar à auditoria — a prova, e a razão de a
   * 4ª versão ter estreitado o que a auditoria enxerga em vez de afrouxar a janela dela.
   *
   * Os quatro prompts de sistema deste pacote, sozinhos e sem nenhum dado de contato, já
   * contêm janela de dez dígitos começando por DDD válido (versões, limites, percentuais,
   * exemplos). Enquanto a auditoria varria a mensagem inteira, ela precisava de uma
   * fronteira de letra só para não recusar 100% das chamadas — e a fronteira de letra era
   * o furo por onde `ddd 84 numero 988776655` saía inteiro.
   *
   * Agora a auditoria roda sem fronteira nenhuma, e os quatro prompts não passam por ela.
   * Este teste afirma as três coisas.
   */
  it('o prompt de sistema barraria toda chamada — por isso a auditoria não o vê', () => {
    const sistemas = [
      transcricaoAudioV1,
      resumoLigacaoV1,
      followupLigacaoV1,
      classificarIntencaoV1,
    ].map((prompt) => prompt.sistema);

    // 1. Sem fronteira, os quatro acusam: é o que os manteria fora do produto.
    expect(sistemas.filter((sistema) => verificarSemPii(sistema).length > 0).length).toBe(4);
    // 2. A rede de segurança, que roda sobre a montagem inteira, tem a fronteira de letra
    //    exatamente por isso — e com ela nenhum dos quatro acusa nada.
    expect(sistemas.flatMap((sistema) => varrerMontagem(sistema))).toEqual([]);
    // 3. E a chamada de verdade, com o prompt de sistema dentro, sai.
    const chamada = prepararChamada(
      transcricaoAudioV1,
      {
        leadId: CONTATO.leadId,
        canal: 'whatsapp',
        duracaoSeg: 24,
        transcricaoBruta: 'oi, é o Marcos Tavares, tenho interesse sim',
        confiancaAsr: 0.9,
        contexto: null,
      },
      CONTATO,
    );
    expect(chamada.sistema).toBe(transcricaoAudioV1.sistema);
  });
});;

/**
 * Algarismo não é só `[0-9]`.
 *
 * Um teclado de celular produz `８４` (largura inteira), e o texto estilizado que as redes
 * sociais popularizaram produz `𝟴𝟰`. Nas duas grafias o telefone continua legível para
 * qualquer pessoa e para o modelo — e uma detecção presa ao ASCII deixaria as duas
 * passarem inteiras, pela regra E pela auditoria. Por isso a projeção reduz qualquer
 * dígito decimal do Unicode ao algarismo correspondente, nas duas camadas, cada uma com
 * a sua implementação.
 */
describe('a projeção enxerga dígito, não byte', () => {
  const GRAFIAS: ReadonlyArray<readonly [string, string]> = [
    ['largura inteira', '８４９９９８８００１１'],
    ['árabe-índico', '٨٤٩٩٩٨٨٠٠١١'],
    ['devanagári', '८४९९९८८००११'],
    ['estilizado (matemático)', '𝟴𝟰 𝟵𝟵𝟵𝟴𝟴-𝟬𝟬𝟭𝟭'],
    [
      'espaço de largura zero entre os dígitos',
      '8\u200b4\u200b9\u200b9\u200b9\u200b8\u200b8\u200b0\u200b0\u200b1\u200b1',
    ],
  ];

  for (const [nome, forma] of GRAFIAS) {
    it(`o telefone do cadastro em ${nome}`, () => {
      const original = `contato: ${forma}`;
      const { texto, mapa } = pseudonimizar(original, CONTATO);
      expect(texto).toBe('contato: [[TELEFONE_1]]');
      expect(reidratar(texto, mapa)).toBe(original);
    });
  }

  it('um telefone desconhecido em outra escrita também sai, e a auditoria o enxerga', () => {
    expect(pseudonimizar('bold 𝟴𝟰 𝟵𝟴𝟴𝟴𝟴-𝟳𝟳𝟳𝟳', CONTATO).texto).toBe('bold [[TELEFONE_2]]');
    expect(verificarSemPii('bold 𝟴𝟰 𝟵𝟴𝟴𝟴𝟴-𝟳𝟳𝟳𝟳').length).toBeGreaterThan(0);
    expect(verificarSemPii('tel ٨٤٩٩٩٨٨٠٠١١').length).toBeGreaterThan(0);
  });
});

/**
 * FURO A da 4ª conferência: algarismo que o Unicode não classifica como **dígito
 * decimal**.
 *
 * A 3ª versão tratou a categoria `Nd` — árabe-índico, devanagári, matemático negrito — e
 * parou ali. Circulado (`⑧`), sobrescrito (`⁸`) e subscrito (`₈`) são categoria `No`, e os
 * três saíram inteiros na conferência, dois deles com o telefone **do cadastro**. Entre
 * parênteses (`⑻`) e com ponto (`⒏`) são o mesmo caso e nem chegaram a ser testados.
 *
 * A pergunta agora é feita ponto de código por ponto de código — "qual algarismo isto
 * representa?" — respondida pelo NFKC daquele caractere sozinho. Como um ponto de código
 * continua sendo um ponto de código, o índice de volta ao texto original continua exato,
 * e a projeção da 3ª versão fica de pé sem uma linha alterada.
 *
 * As famílias abaixo são varridas nas DUAS camadas, cada uma com a sua implementação.
 */
describe('FURO A: algarismo que não é dígito decimal para o Unicode', () => {
  /** O telefone do cadastro, `84 99988-0011`, escrito em cada família de algarismo. */
  const CADASTRO: ReadonlyArray<readonly [string, string]> = [
    ['circulado', '⑧④ ⑨⑨⑨⑧⑧-⓪⓪①①'],
    ['sobrescrito', '⁸⁴ ⁹⁹⁹⁸⁸-⁰⁰¹¹'],
    ['subscrito', '₈₄₉₉₉₈₈₀₀₁₁'],
    ['largura total', '８４ ９９９８８-００１１'],
    ['com ponto', '⒏⒋ ⒐⒐⒐⒏⒏-🄀🄀⒈⒈'],
    ['circulado negativo (sem decomposição)', '➑➍ ➒➒➒➑➑-⓿⓿➊➊'],
    ['circulado duplo (sem decomposição)', '⓼⓸ ⓽⓽⓽⓼⓼-🄋🄋⓵⓵'],
    ['famílias misturadas no mesmo número', '⑧4 ⁹𝟵9８⑧-₀0１1'],
  ];

  for (const [familia, forma] of CADASTRO) {
    it(`o telefone do cadastro em ${familia}`, () => {
      const original = `salva ai: ${forma}`;
      const { texto, mapa } = pseudonimizar(original, CONTATO);
      expect(texto).toBe('salva ai: [[TELEFONE_1]]');
      expect(reidratar(texto, mapa)).toBe(original);
      // E a auditoria, sozinha, enxergaria o mesmo texto se a regra tivesse falhado.
      expect(verificarSemPii(original).some((p) => p.tipo === 'TELEFONE')).toBe(true);
    });
  }

  /**
   * Não há algarismo zero entre parênteses no Unicode (a família vai de `⑴` a `⑼`), então
   * este caso usa um número sem zero — que o CRM não conhece, e portanto passa pela
   * varredura genérica, não pelo casamento com o cadastro.
   */
  it('telefone desconhecido escrito entre parênteses', () => {
    const original = 'chama no ⑻⑷ ⑼⑼⑻⑻⑺-⑺⑹⑹⑸';
    const { texto, mapa } = pseudonimizar(original, CONTATO);
    expect(texto).toBe('chama no [[TELEFONE_2]]');
    expect(reidratar(texto, mapa)).toBe(original);
    expect(verificarSemPii(original).some((p) => p.tipo === 'TELEFONE')).toBe(true);
  });

  /**
   * O que **não** é algarismo continua não sendo, nas duas camadas: se `⑩` valesse `1`, a
   * projeção passaria a inventar dígito e a regra a estragar texto legítimo.
   */
  it('o que só parece algarismo continua fora da projeção', () => {
    for (const texto of [
      'o pacote ⑩ é o maior',
      'metade (½) do salão',
      'o salão tem 250㎡',
      'capítulo Ⅷ do contrato',
      'o 1º e a 2ª parcela',
    ]) {
      expect({ texto, saida: pseudonimizar(texto, CONTATO).texto }).toEqual({ texto, saida: texto });
    }
  });
});

/**
 * FURO B da 4ª conferência: dígitos separados por **letra**, de número que o CRM não
 * conhece. `ddd 84 numero 988776655` e `84 nove 8877 6655` saíam inteiros.
 *
 * A auditoria tinha uma fronteira de letra, e ela existia por um motivo real e medido: a
 * auditoria varria a mensagem inteira, prompt de sistema junto, e os quatro prompts deste
 * pacote já contêm, sozinhos, janela de dez dígitos começando por DDD. Sem fronteira
 * nenhuma, 100% das chamadas seriam recusadas.
 *
 * O conserto não foi afrouxar a janela: foi estreitar o que a auditoria enxerga. Ela
 * agora recebe só os trechos de origem externa, já pseudonimizados — e sobre eles corre
 * sem fronteira nenhuma.
 *
 * **O desfecho destes dois casos melhorou na 6ª versão**, e é a única mudança de
 * comportamento que o conserto do telefone local trouxe fora dele mesmo. Até a 5ª versão
 * a chamada era *recusada*: a regra não mexia em trecho que atravessa palavra e a
 * auditoria segurava. Agora o pedaço depois da palavra (`988776655`, `8877 6655`) é um
 * grupo local de 9 e de 8 dígitos, a regra o **mascara**, e a chamada sai com o número
 * fora dela. Mascarar é estritamente melhor que recusar — custa uma palavra trocada em
 * vez de uma chamada perdida —, e o que sobra em claro é o DDD solto (`84`), que não é
 * telefone.
 *
 * O que este bloco tranca continua sendo o mesmo, e agora pelos dois lados: **o número
 * não sai inteiro**. Ou a regra o mascara, ou a auditoria recusa a chamada — e com a
 * regra desligada de propósito é sempre a auditoria.
 */
describe('FURO B: dígitos separados por letra', () => {
  const ATRAVESSAM_PALAVRA: readonly string[] = [
    'ddd 84 numero 988776655',
    'meu zap e 84 nove 8877 6655',
  ];

  for (const bruta of ATRAVESSAM_PALAVRA) {
    it(`o número não sai inteiro: ${bruta}`, () => {
      // 1. A auditoria, sozinha, continua acusando o texto cru.
      expect(verificarSemPii(bruta).some((p) => p.tipo === 'TELEFONE')).toBe(true);
      // 2. Com a regra ligada, o pedaço local é mascarado e a chamada sai limpa.
      const chamada = prepararChamada(
        transcricaoAudioV1,
        {
          leadId: CONTATO.leadId,
          canal: 'whatsapp',
          duracaoSeg: 24,
          transcricaoBruta: bruta,
          confiancaAsr: 0.9,
          contexto: null,
        },
        CONTATO,
      );
      expect(chamada.mensagem).toContain('[[TELEFONE_2]]');
      expect(chamada.mensagem).not.toContain('988776655');
      expect(chamada.mensagem).not.toContain('8877');
      // 3. E com a regra desligada de propósito, a auditoria segura como antes.
      expect(() =>
        prepararChamada(
          { ...transcricaoAudioV1, camposDeTexto: [] as string[] },
          {
            leadId: CONTATO.leadId,
            canal: 'whatsapp',
            duracaoSeg: 24,
            transcricaoBruta: bruta,
            confiancaAsr: 0.9,
            contexto: null,
          },
          CONTATO,
        ),
      ).toThrow(PiiNaChamadaError);
    });
  }

  /**
   * O telefone **do cadastro** atravessando palavra é outro caso, e melhor: o casamento
   * por substring da projeção não olha o texto, então a regra o troca por marcador e a
   * chamada sai limpa. É o caminho que o desenho diz que nunca pode falhar — e ele não
   * depende de fronteira nenhuma, nem para achar nem para recusar.
   */
  for (const bruta of [
    'ddd oitenta e quatro, 84 então 99988 0011',
    'é 84 depois 9 9988 depois 0011',
  ]) {
    it(`o do cadastro sai mascarado, não recusado: ${bruta}`, () => {
      const { texto } = pseudonimizar(bruta, CONTATO);
      expect(texto).toContain('[[TELEFONE_1]]');
      expect(texto).not.toContain('99988');
      expect(texto).not.toContain('9988');
      expect(verificarSemPii(texto)).toEqual([]);
    });
  }

  /**
   * Por que a REGRA continua recusando o trecho que atravessa palavra, mesmo agora que a
   * auditoria pega esses casos: sem essa recusa, a janela da regra atravessaria a placa e
   * a frase inteira. `1234 e o zap 8498` é um telefone de dez dígitos plausível pela
   * numeração (DDD 12, terceiro dígito 3), e a regra trocaria seis palavras por um
   * marcador. Este é o preço que não se paga — o texto que vai ao modelo tem de continuar
   * legível.
   */
  it('a fronteira de palavra da regra é load-bearing: sem ela, a placa vira telefone', () => {
    expect(pseudonimizar('placa ABC-1234 e o zap 84988887777', CONTATO).texto).toBe(
      'placa ABC-1234 e o zap [[TELEFONE_2]]',
    );
  });
});

/**
 * A trava estrutural do CONSERTO B: **auditado por padrão, nunca esquecido por padrão.**
 *
 * `prepararChamada` não recebe uma lista de "campos a auditar". Ele varre a entrada
 * validada inteira e manda para `verificarSemPii` todo valor escalar que encontrar, em
 * qualquer profundidade (`trechosDeFora`). Não há declaração para alguém esquecer de
 * atualizar: um campo acrescentado ao schema amanhã cai na auditoria sozinho.
 *
 * Estes dois testes trancam isso pelos dois lados — o estrutural (a auditoria enxerga o
 * campo) e o comportamental (um telefone posto nele não chega ao modelo). Se alguém
 * voltar a auditar por lista declarada, ou trocar a varredura por `camposDeTexto`, o
 * primeiro fica vermelho.
 */
describe('nenhum campo de entrada escapa da auditoria', () => {
  /**
   * Os quatro prompts vistos pelo lado de fora: entrada é um registro, saída é `unknown`.
   * O canário não usa o tipo de nenhum deles — ele existe justamente para desconfiar de
   * quem confia no tipo declarado.
   */
  type PromptQualquer = PromptVersionado<Record<string, unknown>, unknown>;
  const PROMPTS = [
    transcricaoAudioV1,
    resumoLigacaoV1,
    followupLigacaoV1,
    classificarIntencaoV1,
  ] as unknown as readonly PromptQualquer[];

  /** Um telefone que o CRM NÃO conhece: quem tem de pegá-lo é a varredura, não o cadastro. */
  const INJETADO = '84 99123-4567';

  const chavesDoSchema = (prompt: PromptQualquer): string[] => {
    const esquema = z.toJSONSchema(prompt.entrada) as { properties?: Record<string, unknown> };
    return Object.keys(esquema.properties ?? {});
  };

  it('a auditoria enxerga todo campo escalar da entrada, em qualquer profundidade', () => {
    for (const prompt of PROMPTS) {
      const validada = prompt.entrada.parse(prompt.exemplos[0]?.entrada) as Record<string, unknown>;
      // Só o **valor** conta. Desde a 5ª versão a varredura também devolve o NOME de cada
      // campo (um `z.record()` imprime as chaves na mensagem, e chave é texto como outro
      // qualquer) — mas se o nome contasse aqui, este teste ficaria verde mesmo com a
      // travessia dos valores quebrada, que é exatamente o que ele existe para pegar.
      const vistos = new Set(
        trechosDeFora(validada)
          .filter((trecho) => !trecho.campo.endsWith('[nome do campo]'))
          .map((trecho) => raizDoCampo(trecho.campo)),
      );
      for (const chave of chavesDoSchema(prompt)) {
        const valor = validada[chave];
        // Booleano e nulo não têm como carregar dígito; todo o resto tem de ser auditado.
        if (valor === null || valor === undefined || typeof valor === 'boolean') continue;
        expect({ prompt: prompt.id, chave, auditado: vistos.has(chave) }).toEqual({
          prompt: prompt.id,
          chave,
          auditado: true,
        });
      }
    }
  });

  it('um telefone em qualquer campo da entrada não chega ao modelo', () => {
    for (const prompt of PROMPTS) {
      for (const chave of chavesDoSchema(prompt)) {
        const bruta = { ...prompt.exemplos[0]?.entrada, [chave]: INJETADO };
        let desfecho: 'schema-recusou' | 'auditoria-recusou' | 'regra-mascarou';
        try {
          const chamada = prepararChamada(prompt, bruta, CONTATO);
          expect({ prompt: prompt.id, chave, mensagem: chamada.mensagem }).toEqual({
            prompt: prompt.id,
            chave,
            mensagem: expect.not.stringContaining('99123'),
          });
          desfecho = 'regra-mascarou';
        } catch (erro) {
          desfecho = erro instanceof PiiNaChamadaError ? 'auditoria-recusou' : 'schema-recusou';
        }
        // Nenhum campo pode terminar em outro lugar que não estes três.
        expect({ prompt: prompt.id, chave, desfecho }).toEqual({
          prompt: prompt.id,
          chave,
          desfecho: expect.stringMatching(/^(schema-recusou|auditoria-recusou|regra-mascarou)$/),
        });
      }
    }
  });
});

/**
 * O preço medido do CONSERTO B, declarado em número.
 *
 * A auditoria sem fronteira nenhuma acusa mais, e parte do que ela acusa é legítimo.
 * Falso positivo aqui não corrompe texto — só impede a chamada de sair —, mas impedir
 * chamada legítima é o produto parando, e isso tem de ser medido, não estimado.
 *
 * O corpus abaixo é de mensagens reais de fornecedor de evento em Natal/RN, **nenhuma
 * com telefone**, medidas como o produto as vê: depois da regra. O número exato é
 * declarado — se ele subir, este teste fica vermelho e alguém decide de novo.
 *
 * O padrão dos falsos positivos é sempre o mesmo: data com hora colada, ou uma sequência
 * de anos e quantidades que soma dez dígitos começando por duas casas que por acaso são
 * DDD. O conserto, quando incomodar, é a REGRA substituir mais (como já faz com CNPJ e
 * uuid), nunca a auditoria perdoar mais.
 *
 * **Este número é também a régua da 6ª versão.** A janela do telefone local (8 e 9
 * dígitos) foi desenhada contra ele: solta sobre a projeção, ela levava estas 40
 * mensagens de 5 bloqueios para 10 e os 10 exemplos dos próprios prompts de 0 para 3 — o
 * CEP `59082-050`, a data ISO, `30/09/2026`, `21/11/2026` e `R$ 12.000 dá R$ 960` viravam
 * telefone, e o protocolo `2026090512` virava `[[TELEFONE_2]]12` na regra. Exigir
 * que a janela local **corte onde houve separador**, com a pontuação onde um telefone a
 * põe, devolveu o número a 5. As duas afirmações abaixo continuam sendo as mesmas de
 * antes do conserto, e é isso que elas provam.
 */
const CORPUS_DE_FORNECEDOR: readonly string[] = [
    'oi, tudo bem? vi a mensagem de vocês',
    'faço uns 6 eventos por mês',
    'a taxa de 8% é sobre o quê?',
    'a formatura é 12/12/2026, às 20h',
    'o casamento é dia 15/03/2027 às 19h',
    'me manda hoje que amanhã eu viajo',
    'o CEP daqui é 59082-050',
    'meu buffet atende até 300 pessoas',
    'reunião marcada para 2026-09-05',
    'protocolo 2026090512 aberto',
    'contrato de 1990-2020 arquivado',
    'trabalho com decoração desde 2014',
    'cobro R$ 3.500 por evento, com 2 garçons',
    'a taxa de 8% sobre R$ 12.000 dá R$ 960',
    'tenho 12 mesas e 120 cadeiras',
    'fechamos 18 eventos em 2025 e 22 em 2026',
    'atendo em Natal, Parnamirim e Macaíba',
    'o pacote de 4h sai 2.800 e o de 6h 3.900',
    'me chama depois das 14h',
    'confirmo até sexta, sem problema',
    'meu perfil tem 12 mil seguidores',
    'a diária é 450 e a hora extra 90',
    'o evento é dia 7 de setembro de 2026',
    'quero entender o contrato antes de fechar',
    'nota fiscal 12345678000195 emitida',
    'meu CNPJ é 12.345.678/0001-95',
    'faturei 45 mil em 2025',
    'o salão tem 250m² e 8 banheiros',
    'sou cerimonialista há 11 anos, desde 2015',
    'orçamento 2026/2027 fechado',
    'a promoção vale de 01/09 a 30/09/2026',
    'de 2020 a 2024 eu trabalhei sozinho',
    'preciso de 15 dias para fechar a agenda de 2027',
    'o buffet fica no km 12 da rota do sol',
    'somos 3 sócios e 14 funcionários',
    'tenho 2 datas livres em janeiro de 2027',
    'a montagem leva 4h e a desmontagem 2h',
    'evento para 80 convidados no dia 21/11/2026',
    'cheguei às 8h30 e saí às 17h45 no dia 03/10/2026',
  'o pagamento é 50% na assinatura e 50% na entrega',
];

/** As que a auditoria barra hoje. Lista literal, para a mudança aparecer no diff. */
const BARRADAS_DE_FORNECEDOR: readonly string[] = [
  'a formatura é 12/12/2026, às 20h',
  'o casamento é dia 15/03/2027 às 19h',
  'fechamos 18 eventos em 2025 e 22 em 2026',
  'o pacote de 4h sai 2.800 e o de 6h 3.900',
  'cheguei às 8h30 e saí às 17h45 no dia 03/10/2026',
];

describe('quantas chamadas legítimas a auditoria passa a barrar', () => {
  it('o corpus não tem telefone nenhum: o que for acusado é falso positivo', () => {
    // A régua é a REGRA, que conhece a numeração da Anatel: se ela não vê telefone em
    // nenhuma destas mensagens, o que a auditoria acusar depois é falso positivo.
    for (const texto of CORPUS_DE_FORNECEDOR) {
      const { texto: protegido } = pseudonimizar(texto, CONTATO);
      expect({ texto, temTelefone: protegido.includes('[[TELEFONE') }).toEqual({
        texto,
        temTelefone: false,
      });
    }
  });

  it('a conta: 5 de 40 mensagens legítimas passam a barrar a chamada (12,5%)', () => {
    const barradas = CORPUS_DE_FORNECEDOR.filter(
      (texto) => verificarSemPii(pseudonimizar(texto, CONTATO).texto).length > 0,
    );
    expect(barradas).toEqual(BARRADAS_DE_FORNECEDOR);
    expect(barradas.length).toBe(5);
  });

  it('com a fronteira de letra da 3ª versão, nenhuma delas barrava — era esse o troco', () => {
    const barradasAntes = CORPUS_DE_FORNECEDOR.filter(
      (texto) => varrerMontagem(pseudonimizar(texto, CONTATO).texto).length > 0,
    );
    expect(barradasAntes).toEqual([]);
  });
});

/**
 * O que a rede de segurança da montagem pega, e o que a junção passou a pegar.
 *
 * `verificarSemPii` roda campo a campo. Um telefone partido **dentro do mesmo campo**
 * (uma lista com `['84988', '776655']`) some da auditoria campo a campo, porque nenhum
 * elemento sozinho tem dez dígitos — mas `montarMensagem` junta os elementos com `; `, e
 * é aí que `varrerMontagem` o vê.
 *
 * Um telefone partido **entre dois campos diferentes** era, até a 4ª versão, buraco
 * conhecido: nem a auditoria (que olhava campo a campo) nem a rede de segurança (que
 * quebra na letra do rótulo) o viam. O que travava o conserto óbvio — auditar os campos
 * concatenados — era o falso positivo: `leadId` + `duracaoSeg` + capturas somam dez
 * dígitos começando por DDD sozinhos, e barravam 1 dos 10 exemplos reais dos próprios
 * prompts.
 *
 * A 5ª versão desfaz o empate separando as duas naturezas: a junção corre **só sobre o
 * texto que veio de uma pessoa de fora** (transcrição, mensagem, resumo da conversa,
 * anotação, capturas, nome), e o metadado que o próprio Tríade escreveu (`leadId`,
 * `canal`, `duracaoSeg`, `confiancaAsr`, flags) fica fora dela, declarado em
 * `camposDoTriade`. Com a separação, os 10 exemplos passam e o número repartido não.
 */
describe('telefone partido entre campos', () => {
  const base = {
    leadId: CONTATO.leadId,
    variante: 'fornecedor' as const,
    segmento: 'AEB' as const,
    resumoDaLigacao: 'ok',
    combinado: null,
    objecoes: [] as string[],
    desfecho: 'lig_atendeu_retorna',
    gancho: null,
  };

  it('partido dentro do mesmo campo: a rede de segurança da montagem pega', () => {
    expect(() =>
      prepararChamada(followupLigacaoV1, { ...base, objecoes: ['84988', '776655'] }, CONTATO),
    ).toThrow(PiiNaChamadaError);
  });

  it('partido entre dois campos, com rótulo com letra no meio: a junção pega', () => {
    expect(() =>
      prepararChamada(
        transcricaoAudioV1,
        {
          leadId: CONTATO.leadId,
          canal: 'whatsapp',
          duracaoSeg: 24,
          transcricaoBruta: 'anota o resto: 8776655',
          confiancaAsr: 0.9,
          contexto: 'o começo é 8499',
        },
        CONTATO,
      ),
    ).toThrow(PiiNaChamadaError);
  });

  /**
   * O KILL 2 da 4ª conferência, em prompt real e sem nada sintético: o lead começa a
   * ditar o número no fim de uma mensagem e termina na seguinte. O resumo rolante fica
   * com `84 99988`, a mensagem nova com `0011`. Nenhum dos dois campos, sozinho, tem
   * telefone; juntos, na ordem em que o modelo os lê, têm.
   */
  it('[KILL 2] número ditado em duas mensagens: resumo + mensagem não sai', () => {
    expect(() =>
      prepararChamada(
        classificarIntencaoV1,
        {
          leadId: CONTATO.leadId,
          canal: 'whatsapp',
          mensagem: '0011, esse é o final. anota aí',
          resumoDaConversa: 'Lead começou a passar outro número: 84 99988',
          ultimaIntencao: null,
          jaRecebeuAudio: false,
        },
        CONTATO,
      ),
    ).toThrow(PiiNaChamadaError);
  });

  /**
   * A ordem importa e não é a do schema. Em `classificar-intencao`, `mensagem` vem antes
   * de `resumoDaConversa` nas chaves do schema e **depois** dele na mensagem montada.
   * Colar na ordem das chaves daria `0011` + `8499988`, que não é telefone nenhum; colar
   * na ordem em que o modelo lê dá `8499988` + `0011`, que é. Este teste é o que impede
   * alguém de "simplificar" a ordenação de volta para a do schema.
   */
  it('a junção segue a ordem da mensagem montada, não a das chaves do schema', () => {
    const chaves = Object.keys(
      z.toJSONSchema(classificarIntencaoV1.entrada).properties as Record<string, unknown>,
    );
    expect(chaves.indexOf('mensagem')).toBeLessThan(chaves.indexOf('resumoDaConversa'));
    const montada = classificarIntencaoV1.montarMensagem({
      leadId: 'lead-1',
      canal: 'whatsapp',
      mensagem: 'AQUI-A-MENSAGEM',
      resumoDaConversa: 'AQUI-O-RESUMO',
      ultimaIntencao: null,
      jaRecebeuAudio: false,
    });
    expect(montada.indexOf('AQUI-O-RESUMO')).toBeLessThan(montada.indexOf('AQUI-A-MENSAGEM'));
  });
});

/**
 * A trava da dimensão **TIPO** — o KILL 1 da 4ª conferência.
 *
 * O eval "nenhum campo de entrada escapa da auditoria" tranca a dimensão *campo*: ele
 * itera as chaves dos quatro prompts de hoje e exige que cada uma seja auditada. O que
 * ele não tranca é a dimensão *tipo*: até a 4ª versão, `trechosDeFora` sabia abrir
 * string, número, lista e objeto simples, e para `Map`, `Set`, `Date` ou instância de
 * classe `Object.entries` devolvia `[]` — o campo sumia da auditoria **sem erro nenhum**.
 * O "campo novo que alguém acrescenta amanhã" voltava a vazar, agora escondido atrás de
 * uma condição de tipo.
 *
 * O conserto não é a lista de tipos (embora `Map`, `Set` e `Date` tenham entrado nela): é
 * a lista ter deixado de ser o limite silencioso. `abrir` não tem ramo de escape — o que
 * ela não souber percorrer levanta `TipoNaoAuditavelError`. Este bloco exige exatamente
 * isso de cada tipo: **ou é auditado, ou levanta erro; passar calado não é desfecho.**
 */
describe('nenhum TIPO de entrada escapa da auditoria', () => {
  class PistasDoLead {
    constructor(readonly texto: string) {}
  }
  const TELEFONE_DE_FORA = 'ddd 84 numero 988776655';

  const semPrototipo = Object.create(null) as Record<string, unknown>;
  semPrototipo['texto'] = TELEFONE_DE_FORA;

  const comChaveDeSimbolo: Record<string, unknown> = {};
  (comChaveDeSimbolo as Record<symbol, unknown>)[Symbol('zap')] = TELEFONE_DE_FORA;

  const comGetter = Object.defineProperty({}, 'zap', {
    get: () => TELEFONE_DE_FORA,
    enumerable: true,
    configurable: true,
  });

  const CASOS: readonly { readonly nome: string; readonly valor: unknown }[] = [
    { nome: 'Map', valor: new Map([['zap', TELEFONE_DE_FORA]]) },
    { nome: 'Set', valor: new Set([TELEFONE_DE_FORA]) },
    { nome: 'Date', valor: new Date('2026-09-05T12:34:56.000Z') },
    { nome: 'Date inválida', valor: new Date('não é data') },
    { nome: 'instância de classe', valor: new PistasDoLead(TELEFONE_DE_FORA) },
    { nome: 'objeto de protótipo nulo', valor: semPrototipo },
    {
      nome: 'lista aninhada em objeto aninhado em lista',
      valor: [{ dentro: [[{ fundo: TELEFONE_DE_FORA }]] }],
    },
    { nome: 'Symbol como valor', valor: Symbol('zap') },
    { nome: 'chave de símbolo', valor: comChaveDeSimbolo },
    { nome: 'propriedade de acesso (getter)', valor: comGetter },
    { nome: 'função', valor: () => TELEFONE_DE_FORA },
    { nome: 'RegExp', valor: /84988776655/ },
    { nome: 'Map dentro de lista dentro de objeto', valor: { fila: [new Map([[1, 2]])] } },
    { nome: 'BigInt', valor: 84988776655n },
    { nome: 'objeto de classe sem nome', valor: new (class {})() },
  ];

  it('ou o valor é auditado, ou a auditoria levanta erro — nunca passa calado', () => {
    for (const { nome, valor } of CASOS) {
      let desfecho: 'auditado' | 'levantou-erro' | 'passou-calado';
      try {
        const doCampo = trechosDeFora({ campo: valor }).filter(
          (trecho) =>
            raizDoCampo(trecho.campo) === 'campo' && !trecho.campo.endsWith('[nome do campo]'),
        );
        desfecho = doCampo.length > 0 ? 'auditado' : 'passou-calado';
      } catch (erro) {
        desfecho = erro instanceof TipoNaoAuditavelError ? 'levantou-erro' : 'passou-calado';
      }
      expect({ nome, desfecho }).toEqual({
        nome,
        desfecho: expect.stringMatching(/^(auditado|levantou-erro)$/),
      });
    }
  });

  it('o que a auditoria sabe abrir, ela audita de verdade: o telefone é acusado', () => {
    const abriveis: readonly unknown[] = [
      new Map([['zap', TELEFONE_DE_FORA]]),
      new Set([TELEFONE_DE_FORA]),
      semPrototipo,
      [{ dentro: [[{ fundo: TELEFONE_DE_FORA }]] }],
    ];
    for (const valor of abriveis) {
      const acusacoes = trechosDeFora({ campo: valor }).flatMap((trecho) =>
        verificarSemPii(trecho.texto),
      );
      expect(acusacoes.map((problema) => problema.tipo)).toContain('TELEFONE');
    }
  });

  it('o erro diz, em português, o que apareceu, onde, e que isso trava a chamada', () => {
    let capturado: unknown;
    try {
      trechosDeFora({ pistas: { interna: new PistasDoLead('x') } });
    } catch (erro) {
      capturado = erro;
    }
    expect(capturado).toBeInstanceOf(TipoNaoAuditavelError);
    const erro = capturado as TipoNaoAuditavelError;
    expect(erro.campo).toBe('pistas.interna');
    expect(erro.tipo).toBe('instância de PistasDoLead');
    expect(erro.message).toContain('não sabe auditar');
    expect(erro.message).toContain('pistas.interna');
    expect(erro.message).toContain('ANTES de a chamada sair');
  });

  /**
   * O KILL 1, do jeito que ele foi apresentado: um `pistas: z.map(z.string(), z.string())`
   * acrescentado ao schema por alguém amanhã, fora de `camposDeTexto` — o campo novo que
   * a auditoria não conhecia. Na 4ª versão o telefone saía inteiro na mensagem e a
   * auditoria devolvia `[]`. Agora o `Map` é aberto, auditado, e a chamada não sai.
   */
  it('[KILL 1] campo Map novo, fora de camposDeTexto: o telefone não chega ao modelo', () => {
    const canario = definirPrompt<{ normal: string; pistas: Map<string, string> }, unknown>({
      id: 'canario-de-tipo',
      versao: 1,
      modelo: MODELOS.haiku,
      proposito: 'classify_inbound',
      entrada: z.object({ normal: z.string(), pistas: z.map(z.string(), z.string()) }),
      saida: z.any(),
      sistema: 'Canário de tipo. Nada aqui.',
      camposDeTexto: ['normal'],
      camposDoTriade: [],
      maxTokens: 10,
      montarMensagem: (dados) =>
        ['PISTAS:', ...[...dados.pistas].map(([c, v]) => `- ${c}: ${v}`), dados.normal].join('\n'),
      exemplos: [],
    });
    expect(() =>
      prepararChamada(
        canario,
        { normal: 'ok', pistas: new Map([['zap', TELEFONE_DE_FORA]]) },
        CONTATO,
      ),
    ).toThrow(PiiNaChamadaError);
  });

  /**
   * O outro lado da mesma trava: tipo que a auditoria não sabe abrir derruba a chamada
   * com `TipoNaoAuditavelError`, e não com um `[]` silencioso. A chamada não sair custa
   * uma chamada; sair com telefone custa o guardrail.
   */
  it('tipo desconhecido em campo de entrada derruba a chamada, barulhento', () => {
    const canario = definirPrompt<{ pistas: unknown }, unknown>({
      id: 'canario-de-tipo-opaco',
      versao: 1,
      modelo: MODELOS.haiku,
      proposito: 'classify_inbound',
      entrada: z.object({ pistas: z.any() }),
      saida: z.any(),
      sistema: 'Canário de tipo. Nada aqui.',
      camposDeTexto: [],
      camposDoTriade: [],
      maxTokens: 10,
      montarMensagem: () => 'nada',
      exemplos: [],
    });
    expect(() =>
      prepararChamada(canario, { pistas: new PistasDoLead(TELEFONE_DE_FORA) }, CONTATO),
    ).toThrow(TipoNaoAuditavelError);
  });
});

/**
 * O preço da junção, medido nos dois corpora que o repositório já tinha.
 *
 * O falso positivo da junção não é hipótese: foi ele que fez a 4ª versão desistir do
 * conserto. Então ele é medido, em número, nos dois lugares onde há texto de verdade —
 * as 40 mensagens de fornecedor e os 10 exemplos dos próprios prompts. Se qualquer um dos
 * dois subir, estes testes ficam vermelhos e alguém decide de novo.
 */
describe('o preço da junção, em número', () => {
  type PromptQualquer = PromptVersionado<Record<string, unknown>, unknown>;
  const PROMPTS = [
    transcricaoAudioV1,
    resumoLigacaoV1,
    followupLigacaoV1,
    classificarIntencaoV1,
  ] as unknown as readonly PromptQualquer[];

  const barrou = (prompt: PromptQualquer, entrada: unknown): boolean => {
    try {
      prepararChamada(prompt, entrada, CONTATO);
      return false;
    } catch {
      return true;
    }
  };

  it('os 10 exemplos reais dos próprios prompts: 0 barrados pela junção', () => {
    const exemplos = PROMPTS.flatMap((prompt) =>
      prompt.exemplos.map((exemplo) => ({
        prompt,
        nome: `${prompt.id}: ${exemplo.nome}`,
        entrada: exemplo.entrada,
      })),
    );
    expect(exemplos.length).toBe(10);
    const barrados = exemplos
      .filter(({ prompt, entrada }) => barrou(prompt, entrada))
      .map(({ nome }) => nome);
    expect(barrados).toEqual([]);
  });

  /**
   * A única coisa que pode reabrir o KILL 2 sem ninguém perceber é alguém declarar como
   * "nosso" um campo que na verdade é texto de fora — a junção passaria a pulá-lo. Não há
   * como o tipo pegar isso, mas há uma contradição que o teste pega: um campo que a regra
   * pseudonimiza é, por definição, campo que carrega o que uma pessoa de fora escreveu.
   * As duas listas têm de ser disjuntas.
   */
  it('o que é nosso nunca é, ao mesmo tempo, texto que a regra pseudonimiza', () => {
    for (const prompt of PROMPTS) {
      const nossos = new Set(prompt.camposDoTriade);
      const sobreposicao = prompt.camposDeTexto.filter((campo) => nossos.has(campo));
      expect({ prompt: prompt.id, sobreposicao }).toEqual({ prompt: prompt.id, sobreposicao: [] });
    }
  });

  it('todo nome declarado em camposDoTriade existe mesmo no schema de entrada', () => {
    for (const prompt of PROMPTS) {
      const chaves = new Set(
        Object.keys(
          (z.toJSONSchema(prompt.entrada) as { properties?: Record<string, unknown> }).properties ??
            {},
        ),
      );
      const inventados = prompt.camposDoTriade.filter((campo) => !chaves.has(campo));
      expect({ prompt: prompt.id, inventados }).toEqual({ prompt: prompt.id, inventados: [] });
    }
  });

  it('as 40 mensagens de fornecedor, pelo caminho real: as mesmas 5 de antes', () => {
    const barradas = CORPUS_DE_FORNECEDOR.filter((mensagem) =>
      barrou(classificarIntencaoV1 as unknown as PromptQualquer, {
        leadId: CONTATO.leadId,
        canal: 'whatsapp',
        mensagem,
        resumoDaConversa: null,
        ultimaIntencao: null,
        jaRecebeuAudio: false,
      }),
    );
    expect(barradas).toEqual(BARRADAS_DE_FORNECEDOR);
    expect(barradas.length).toBe(5);
  });
});


/**
 * FURO C: o telefone **local**, sem DDD e sem hífen — o caso comum, não a borda.
 *
 * Até a 5ª versão a passada 5 da regra era uma expressão regular com hífen literal
 * (`99988-0011`, `3222-1188`), e a auditoria tinha a mesma forma. Uma pessoa de Natal
 * passando o próprio WhatsApp dentro da cidade escreve `99988 0011` ou `999880011` — sem
 * DDD, porque quem lê mora aqui, e sem hífen, porque é uma tecla a mais. Nessas duas
 * grafias o número saía **inteiro** para a Anthropic, sem a regra ver e sem a auditoria
 * ver. Repartido entre dois campos escapava pelo mesmo motivo: a junção não tem hífen
 * nenhum.
 *
 * Agora as duas camadas procuram por janela sobre os dígitos, cada uma com a sua
 * implementação — com a única diferença de desenho que o caso exige: **a janela local é o
 * corte de um separador, e não em qualquer dígito.** Oito dígitos é entropia curta demais
 * para deslizar; o bloco "o preço do local, em número", no fim deste arquivo, é a medição
 * que decidiu isso.
 */
describe('FURO C: telefone local, sem DDD e sem hífen', () => {
  /** O celular do cadastro (`84 99988-0011`) escrito sem o DDD, de todo jeito. */
  const LOCAL_DO_CADASTRO: readonly string[] = [
    '99988 0011',
    '999880011',
    '99988-0011',
    '99988.0011',
    '9 9988 0011',
    '9 9 9 8 8 0 0 1 1',
    '99988\u200b0011',
    '99988\u20110011',
    '⑨⑨⑨⑧⑧⓪⓪①①',
    '𝟵𝟵𝟵𝟴𝟴 𝟬𝟬𝟭𝟭',
  ];

  for (const forma of LOCAL_DO_CADASTRO) {
    it(`vira o mesmo [[TELEFONE_1]] do cadastro: ${JSON.stringify(forma)}`, () => {
      const original = `salva ai: ${forma}`;
      const { texto, mapa } = pseudonimizar(original, CONTATO);
      expect(texto).toBe('salva ai: [[TELEFONE_1]]');
      expect(reidratar(texto, mapa)).toBe(original);
      expect(verificarSemPii(texto)).toEqual([]);
      // E a auditoria, sozinha, enxergaria o mesmo texto se a regra tivesse falhado.
      expect(verificarSemPii(original).some((p) => p.tipo === 'TELEFONE')).toBe(true);
    });
  }

  /** Fixo local (8 dígitos) e móvel antigo local (8 dígitos começando em 6-9). */
  const LOCAL_DESCONHECIDO: ReadonlyArray<readonly [string, string]> = [
    ['fala com o financeiro no 3222 1188', 'fala com o financeiro no [[TELEFONE_2]]'],
    ['fala com o financeiro no 32221188', 'fala com o financeiro no [[TELEFONE_2]]'],
    ['o fixo antigo é 4009 8888', 'o fixo antigo é [[TELEFONE_2]]'],
    ['sem o nove é 98887777 mesmo', 'sem o nove é [[TELEFONE_2]] mesmo'],
    ['anota 977776666 que é da minha sócia', 'anota [[TELEFONE_2]] que é da minha sócia'],
  ];

  for (const [texto, esperado] of LOCAL_DESCONHECIDO) {
    it(`local que o CRM não conhece também sai: ${texto}`, () => {
      const { texto: protegido, mapa } = pseudonimizar(texto, CONTATO);
      expect(protegido).toBe(esperado);
      expect(reidratar(protegido, mapa)).toBe(texto);
      expect(verificarSemPii(protegido)).toEqual([]);
      expect(verificarSemPii(texto).some((p) => p.tipo === 'TELEFONE')).toBe(true);
    });
  }

  /**
   * O que a janela de oito dígitos **não** pode engolir. É a metade cara do conserto: a
   * regra que troca um CEP, uma data ou um protocolo por `[[TELEFONE]]` não vaza nada,
   * mas estraga o texto que vai ao modelo — e a auditoria que os acusa para a chamada.
   * Cada linha aqui é uma coisa de oito dígitos que existe no mundo.
   */
  const NAO_E_LOCAL: readonly string[] = [
    'o CEP é 59082-050',
    'reunião marcada para 2026-09-05',
    'a reunião é 21.11.2026 mesmo',
    'protocolo 2026090512 aberto',
    'contrato de 1990-2020 arquivado',
    'o intervalo 2020-2024 foi difícil',
    'a série 2026 2027 já fechou',
    'CNPJ 12.345.678/0001-95 registrado',
    'a nota é 12345678000195',
    'de 01/09 a 30/09/2026 tem promoção',
    'o valor é R$ 32.221.188,00 no total',
  ];

  for (const texto of NAO_E_LOCAL) {
    it(`não vira telefone: ${texto}`, () => {
      const { texto: protegido } = pseudonimizar(texto, CONTATO);
      expect({ texto, protegido }).toEqual({
        texto,
        protegido: expect.not.stringContaining('[[TELEFONE'),
      });
    });
  }

  /**
   * A metade que a auditoria também tem de deixar passar. Não são todas as de cima: a
   * auditoria é burra de propósito e continua acusando CNPJ e uuid crus (é a regra que os
   * mascara, e o teste disso já existe acima). O que ela não pode passar a acusar é o que
   * antes do conserto ela deixava em paz.
   */
  for (const texto of [
    'o CEP é 59082-050',
    'reunião marcada para 2026-09-05',
    'a reunião é 21.11.2026 mesmo',
    'protocolo 2026090512 aberto',
    'contrato de 1990-2020 arquivado',
    'o intervalo 2020-2024 foi difícil',
    'a série 2026 2027 já fechou',
    'de 01/09 a 30/09/2026 tem promoção',
  ]) {
    it(`a auditoria também não derruba a chamada: ${texto}`, () => {
      expect({ texto, problemas: verificarSemPii(texto) }).toEqual({ texto, problemas: [] });
    });
  }

  /**
   * O local repartido entre dois campos: `99988` no resumo rolante, `0011` na mensagem
   * seguinte. É o KILL 2 sem o DDD — e antes do conserto nem a junção o via, porque a
   * junção cola os trechos sem separador nenhum e a passada local só conhecia hífen.
   */
  it('local repartido entre dois campos: a junção pega', () => {
    expect(() =>
      prepararChamada(
        classificarIntencaoV1,
        {
          leadId: CONTATO.leadId,
          canal: 'whatsapp',
          mensagem: '0011, esse é o final. anota aí',
          resumoDaConversa: 'Lead começou a passar outro número: 99988',
          ultimaIntencao: null,
          jaRecebeuAudio: false,
        },
        CONTATO,
      ),
    ).toThrow(PiiNaChamadaError);
  });

  it('local repartido dentro do mesmo campo: a rede da montagem pega', () => {
    expect(() =>
      prepararChamada(
        followupLigacaoV1,
        {
          leadId: CONTATO.leadId,
          variante: 'fornecedor' as const,
          segmento: 'AEB' as const,
          resumoDaLigacao: 'ok',
          combinado: null,
          objecoes: ['32221', '188'] as string[],
          desfecho: 'lig_atendeu_retorna',
          gancho: null,
        },
        CONTATO,
      ),
    ).toThrow(PiiNaChamadaError);
  });

  /**
   * Por que a janela local corta só em separador, e não em qualquer dígito — a prova pelo
   * avesso.
   * `2026090512` tem, deslizando, um `20260905` de oito dígitos começando em 2. Se a
   * janela deslizasse, este protocolo viraria telefone nas duas camadas, e com ele a data
   * ISO, a sequência de anos e metade do corpus.
   */
  it('a janela local corta só em separador: dígito colado antes ou depois desarma', () => {
    expect(pseudonimizar('protocolo 2026090512 aberto', CONTATO).texto).toBe(
      'protocolo 2026090512 aberto',
    );
    // Um dígito qualquer colado na frente desarma; um ZERO, não — zero é prefixo de
    // discagem, e `0 99988 0011` é o mesmo número. Os dois casos, lado a lado:
    // `29` não é DDD nenhum: a janela de 10 a 13 recusa, e a local também, porque o grupo
    // tem dez dígitos e não nove. Este número o CRM não conhece, e ele fica no texto — é
    // o limite registrado no README ("dígito colado na frente de um local").
    expect(pseudonimizar('o número 2988887777 não é local', CONTATO).texto).toBe(
      'o número 2988887777 não é local',
    );
    // Com o número DO CADASTRO no lugar dele, nada disso importa: o casamento por
    // substring dos dígitos não olha grupo, nem fronteira, nem numeração.
    expect(pseudonimizar('o número 2999880011 é o do cadastro', CONTATO).texto).toBe(
      'o número 2[[TELEFONE_1]] é o do cadastro',
    );
    expect(pseudonimizar('anota 0999880011 aí', CONTATO).texto).toBe('anota 0[[TELEFONE_1]] aí');
    // Com o grupo do tamanho certo, o mesmo miolo sai.
    expect(pseudonimizar('o número 999880011 é local', CONTATO).texto).toBe(
      'o número [[TELEFONE_1]] é local',
    );
  });

  /**
   * **O preço do conserto, escrito por extenso.** Oito dígitos corridos, sem separador
   * nenhum e começando em 2–9, são indistinguíveis de um fixo local — e a coisa mais
   * comum com essa forma, depois do CEP, é uma data compacta (`20260905`, `21112026`).
   *
   * Deixá-la passar como telefone custava caro nos dois lados: a regra trocava a data por
   * marcador (texto pior) e, quando ela não trocava, a auditoria **barrava a chamada**.
   * Por isso as duas camadas recusam a data compacta, cada uma com a sua conta — é a
   * única recusa que a auditoria ganhou junto com a janela local, e ela não toca na
   * janela de 10 a 13 dígitos.
   *
   * O preço que sobrou está aqui embaixo, e é o menor dos três: um fixo local de oito
   * dígitos escrito **corrido** cujos dígitos leiam uma data (`3101 2026` escrito
   * `31012026`) não é visto por ninguém. Com qualquer separador — espaço, hífen, ponto —
   * ele volta a ser telefone, e é assim que quase todo mundo escreve.
   */
  it('o preço medido: data compacta não vira telefone, nas duas camadas', () => {
    for (const texto of ['o pedido 20260905 saiu', 'a reunião 21112026 foi boa']) {
      expect({ texto, saida: pseudonimizar(texto, CONTATO).texto }).toEqual({ texto, saida: texto });
      expect({ texto, problemas: verificarSemPii(texto) }).toEqual({ texto, problemas: [] });
    }
    // A chamada sai, com a data intacta no texto que o modelo lê.
    const chamada = prepararChamada(
      classificarIntencaoV1,
      {
        leadId: CONTATO.leadId,
        canal: 'whatsapp',
        mensagem: 'o pedido 20260905 saiu',
        resumoDaConversa: null,
        ultimaIntencao: null,
        jaRecebeuAudio: false,
      },
      CONTATO,
    );
    expect(chamada.mensagem).toContain('20260905');
  });

  /**
   * O outro lado da mesma moeda, e o falso NEGATIVO que a recusa acima custa. Está aqui
   * escrito como caso `conhecido` seria — em teste normal, porque o número não vaza: ele
   * é do cadastro no primeiro caso (e o casamento por substring o pega de qualquer jeito)
   * e, no segundo, basta um separador para voltar a ser telefone.
   */
  it('o falso negativo que a recusa custa, e as duas coisas que o seguram', () => {
    // 1. Um fixo desconhecido, corrido, com forma de data: ninguém o vê. É o limite.
    expect(pseudonimizar('liga no 31012026', CONTATO).texto).toBe('liga no 31012026');
    // 2. Com qualquer separador, ele volta a ser telefone.
    expect(pseudonimizar('liga no 3101 2026', CONTATO).texto).toBe('liga no [[TELEFONE_2]]');
    expect(pseudonimizar('liga no 3101-2026', CONTATO).texto).toBe('liga no [[TELEFONE_2]]');
    // 3. E o número do cadastro não depende de nada disso.
    expect(pseudonimizar('meu whats é 999880011', CONTATO).texto).toBe(
      'meu whats é [[TELEFONE_1]]',
    );
  });
});
