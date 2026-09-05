import { describe, expect, it } from 'vitest';

import {
  type ContextoDoContato,
  type EntradaDoResumo,
  prepararChamada,
  resumoLigacaoV1,
  varrerMontagem,
  viradaProvavel,
} from '../src/index';
import { type CasoDeEval, rodarEvals } from './executar';

/**
 * `resumo-ligacao@v1` (R13 §3.2 e §3.3).
 *
 * O que é testável sem modelo aqui é o que entra: o caminho percorrido no roteiro, as
 * capturas e a anotação viram a mensagem, na ordem, sem PII. E a regra de virada, que
 * confere o palpite do modelo sobre onde a conversa mudou de rumo.
 *
 * O caso conhecido é o limite da convenção de ids: a virada só é achável quando ela
 * passou por um nó `obj_*`. Conversa que esfria numa pergunta comum — o momento em que
 * a pessoa ouve o volume e muda de tom — não deixa rastro no id do nó.
 */

const CONTATO: ContextoDoContato = {
  leadId: 'lead-91ab',
  nome: 'Cláudio Nunes',
  empresa: 'Som e Luz Potiguar',
  telefones: ['+5584991234567'],
};

const CAMINHO_COM_OBJECAO: EntradaDoResumo['caminho'] = [
  {
    id: 'abertura',
    texto: 'Bom dia! Aqui é a Heloísa, da Komune. Falo com quem cuida dos eventos?',
    respostaEscolhida: 'Sou eu, pode falar',
  },
  {
    id: 'gancho_fornecedor',
    texto: 'Quantos eventos o Som e Luz Potiguar faz por mês hoje?',
    respostaEscolhida: 'Ele respondeu quantos',
  },
  {
    id: 'obj_comissao',
    texto: 'Os 8% só existem sobre o evento que chegou pela Komune e fechou.',
    respostaEscolhida: 'Ficou de pensar',
  },
  { id: 'fim_retorna', texto: 'Perfeito, eu ligo terça.', respostaEscolhida: null },
];

const CAMINHO_SEM_OBJECAO: EntradaDoResumo['caminho'] = [
  {
    id: 'abertura',
    texto: 'Bom dia! Aqui é a Heloísa, da Komune. Falo com quem cuida dos eventos?',
    respostaEscolhida: 'Sou eu, pode falar',
  },
  {
    id: 'gancho_fornecedor',
    texto: 'Quantos eventos você faz por mês hoje?',
    respostaEscolhida: 'Depende muito da época',
  },
  {
    id: 'agendar_reuniao',
    texto: 'São 20 minutos, por vídeo ou aí com você. Quinta às 9h30 serve?',
    respostaEscolhida: 'Melhor outro dia',
  },
  { id: 'fim_agora_nao', texto: 'Entendi, guardo o contato.', respostaEscolhida: null },
];

const casos: readonly CasoDeEval<EntradaDoResumo['caminho'], string | null>[] = [
  {
    nome: 'virada na objeção de comissão',
    entrada: CAMINHO_COM_OBJECAO,
    esperado: 'obj_comissao',
  },
  {
    nome: 'ligação direta não tem virada',
    entrada: [
      { id: 'abertura', texto: 'Bom dia!', respostaEscolhida: 'Sou eu, pode falar' },
      { id: 'fim_reuniao', texto: 'Combinado, quinta às 9h30.', respostaEscolhida: null },
    ],
    esperado: null,
  },
  {
    nome: 'a conversa esfriou na pergunta de volume, não numa objeção',
    entrada: CAMINHO_SEM_OBJECAO,
    esperado: 'agendar_reuniao',
    conhecido: {
      obtido: null,
      motivo:
        'a regra procura o prefixo `obj_`, e a virada aqui foi um "melhor outro dia" num nó comum. Só o modelo (ou o rótulo escolhido, que a v2 pode passar a olhar) enxerga isso',
      desde: '2026-09-05',
    },
  },
];

rodarEvals('virada da ligação, por regra', casos, viradaProvavel, { conhecidosEsperados: 1 });

describe('resumo-ligacao@v1: o que o modelo recebe', () => {
  const entrada: EntradaDoResumo = {
    leadId: CONTATO.leadId,
    variante: 'fornecedor',
    duracaoSeg: 187,
    caminho: CAMINHO_COM_OBJECAO,
    capturas: { eventos_por_mes: '9', decisor: 'Cláudio Nunes, 84 99123-4567' },
    anotacao: 'Cláudio achou 8% caro. Pediu pra ligar terça de manhã no 84 99123-4567.',
    desfecho: 'lig_atendeu_retorna',
  };

  it('a mensagem traz o caminho na ordem, com o rótulo escolhido em cada nó', () => {
    const chamada = prepararChamada(resumoLigacaoV1, entrada, CONTATO);
    const posicoes = ['abertura', 'gancho_fornecedor', 'obj_comissao', 'fim_retorna'].map((id) =>
      chamada.mensagem.indexOf(`[${id}]`),
    );
    expect(posicoes.every((posicao) => posicao >= 0)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(chamada.mensagem).toContain('respondeu: "Ficou de pensar"');
  });

  it('capturas e anotação chegam, mas sem telefone e sem nome', () => {
    const chamada = prepararChamada(resumoLigacaoV1, entrada, CONTATO);
    expect(chamada.mensagem).toContain('eventos_por_mes: 9');
    expect(chamada.mensagem).toContain('[[TELEFONE_1]]');
    expect(chamada.mensagem).toContain('[[NOME_1]]');
    expect(chamada.mensagem).not.toMatch(/99123/);
    expect(chamada.mensagem).not.toContain('Cláudio');
    // A mensagem montada se confere com `varrerMontagem`; a auditoria de verdade
    // (`verificarSemPii`, sem fronteira, só sobre o que veio de fora) já rodou dentro de
    // `prepararChamada` — se ela tivesse achado algo, esta linha não seria alcançada.
    expect(varrerMontagem(chamada.mensagem)).toEqual([]);
  });

  it('o texto dos nós do roteiro também é pseudonimizado', () => {
    const chamada = prepararChamada(resumoLigacaoV1, entrada, CONTATO);
    expect(chamada.mensagem).not.toContain('Som e Luz Potiguar');
    expect(chamada.mensagem).toContain('[[EMPRESA_1]]');
  });

  it('a versão e o modelo vão para ai_runs como Sonnet 5', () => {
    const chamada = prepararChamada(resumoLigacaoV1, entrada, CONTATO);
    expect(chamada.promptVersion).toBe('resumo-ligacao@v1');
    expect(chamada.modelo).toBe('claude-sonnet-5');
    expect(chamada.proposito).toBe('summarize_call');
  });

  it('os exemplos do prompt passam nos próprios schemas, e a virada citada existe no caminho', () => {
    for (const exemplo of resumoLigacaoV1.exemplos) {
      expect(() => resumoLigacaoV1.entrada.parse(exemplo.entrada), exemplo.nome).not.toThrow();
      expect(() => resumoLigacaoV1.saida.parse(exemplo.saida), exemplo.nome).not.toThrow();
      const virada = exemplo.saida.noDeVirada;
      if (virada !== null) {
        expect(
          exemplo.entrada.caminho.map((no) => no.id),
          exemplo.nome,
        ).toContain(virada);
      }
    }
  });

  it('ligação sem caminho nenhum é recusada: não há resumo a fazer', () => {
    expect(() => prepararChamada(resumoLigacaoV1, { ...entrada, caminho: [] }, CONTATO)).toThrow();
  });
});
