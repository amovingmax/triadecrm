import { describe, expect, it } from 'vitest';

import {
  type EntradaDaValidacao,
  FRASE_DE_ESCAPE_FINANCEIRO,
  type ResultadoDaValidacao,
  eDuvidaFinanceiraSemResposta,
  validarPromessas,
} from '../src/index';
import { type CasoDeEval, rodarEvals } from './executar';

/**
 * O validador de promessas (RF-CON-24; R08 §5.4).
 *
 * O eval compara só a decisão e os códigos, não o texto das explicações: o que precisa
 * ficar estável entre versões é "passou / caiu para humano / virou frase de escape", e
 * não a redação do motivo.
 *
 * Os dois casos conhecidos são os dois lados do erro de um validador determinístico, e
 * estão aqui de propósito, um de cada lado: ele deixa passar promessa sem número
 * ("a gente dá um jeito no valor") e barra menção legítima a concorrente
 * ("Casamentos.com"), que a regra de URL não sabe distinguir de link. Um custa uma
 * promessa que ninguém autorizou; o outro custa um rascunho reescrito. É por isso que a
 * aprovação humana continua sendo a regra (ADR-05), e não uma formalidade.
 */

interface Veredito {
  readonly situacao: ResultadoDaValidacao['situacao'];
  readonly codigos: readonly string[];
  readonly queda: string | null;
  readonly texto: string | null;
}

function julgar(entrada: EntradaDaValidacao): Veredito {
  const resultado = validarPromessas(entrada);
  if (resultado.situacao === 'aprovado') {
    return { situacao: 'aprovado', codigos: [], queda: null, texto: resultado.texto };
  }
  if (resultado.situacao === 'substituido') {
    return {
      situacao: 'substituido',
      codigos: [...new Set(resultado.motivos.map((m) => m.codigo))].sort(),
      queda: null,
      texto: resultado.texto,
    };
  }
  return {
    situacao: 'bloqueado',
    codigos: [...new Set(resultado.motivos.map((m) => m.codigo))].sort(),
    queda: resultado.queda,
    texto: null,
  };
}

const aprovado = (texto: string): Veredito => ({
  situacao: 'aprovado',
  codigos: [],
  queda: null,
  texto,
});

const bloqueado = (codigos: readonly string[], queda: 'humano' | 'texto_fixo'): Veredito => ({
  situacao: 'bloqueado',
  codigos: [...codigos].sort(),
  queda,
  texto: null,
});

const TEXTO_BOM =
  'Oi, [[NOME_1]], foi bom falar com você.\nOs 8% valem só sobre o evento que fechar pela Komune, e o preço continua sendo o seu.\nTerça às 9h30 está de pé?';

const casos: readonly CasoDeEval<EntradaDaValidacao, Veredito>[] = [
  {
    nome: 'rascunho bom, com a taxa que está na base',
    entrada: { texto: TEXTO_BOM, claims: ['taxa', 'preco-e-do-fornecedor'] },
    esperado: aprovado(TEXTO_BOM),
  },
  {
    nome: 'prazo que está na base (30 dias do programa Fundador)',
    entrada: {
      texto: 'Como fundador, você recebe a primeira oportunidade real em até 30 dias.',
      claims: ['fundador'],
    },
    esperado: aprovado('Como fundador, você recebe a primeira oportunidade real em até 30 dias.'),
  },
  {
    nome: 'tentativa de fazer o robô prometer desconto',
    entrada: {
      texto: 'Consigo um desconto pra você: em vez de 8%, fica 5% no primeiro semestre.',
      claims: ['taxa'],
    },
    esperado: bloqueado(['palavra_proibida'], 'humano'),
  },
  {
    nome: 'promessa de volume de leads',
    entrada: {
      texto: 'Garanto pelo menos 4 pedidos por mês assim que você publicar.',
      claims: [],
    },
    esperado: bloqueado(['palavra_proibida'], 'humano'),
  },
  {
    nome: 'prazo de repasse inventado',
    entrada: { texto: 'O valor cai na sua conta em 15 dias depois do evento.', claims: [] },
    esperado: bloqueado(['valor_nao_autorizado'], 'humano'),
  },
  {
    nome: 'percentual que não existe na base',
    entrada: { texto: 'A taxa é de 12% sobre o evento fechado.', claims: ['taxa'] },
    esperado: bloqueado(['valor_nao_autorizado'], 'humano'),
  },
  {
    nome: 'claim que não mapeia para nenhum fato',
    entrada: {
      texto: 'A gente já é o maior app de eventos do Nordeste.',
      claims: ['maior-app-do-nordeste'],
    },
    esperado: bloqueado(['claim_sem_base'], 'humano'),
  },
  {
    nome: 'link fora da lista permitida',
    entrada: { texto: 'Dá uma olhada em bit.ly/komune-fundador', claims: [] },
    esperado: bloqueado(['url_fora_da_lista'], 'texto_fixo'),
  },
  {
    nome: 'link permitido passa',
    entrada: { texto: 'O aviso de privacidade fica em komune.app/privacidade.', claims: [] },
    esperado: aprovado('O aviso de privacidade fica em komune.app/privacidade.'),
  },
  {
    nome: 'emoji demais e caixa alta',
    entrada: { texto: 'OPORTUNIDADE 🎉🎉 pra você entrar agora 🙂', claims: [] },
    esperado: bloqueado(['caixa_alta', 'emoji_demais'], 'texto_fixo'),
  },
  {
    nome: 'pergunta de dinheiro fora da FAQ vira a frase de escape',
    entrada: {
      texto: 'O repasse sai em 5 dias úteis depois do evento.',
      claims: [],
      perguntaDoParceiro: 'e quando é que cai o dinheiro depois que o evento acontece?',
    },
    esperado: {
      situacao: 'substituido',
      codigos: ['financeiro_sem_resposta'],
      queda: null,
      texto: FRASE_DE_ESCAPE_FINANCEIRO,
    },
  },
  {
    nome: 'promessa sem número passa pelo validador',
    entrada: {
      texto: 'Fica tranquilo que a gente dá um jeito no valor pra você entrar como fundador.',
      claims: ['fundador'],
    },
    // `promessa_comercial` ainda não existe em `CodigoDeBloqueio`, e é isso que o caso
    // diz: a regra que reprovaria esta frase é a que falta escrever.
    esperado: bloqueado(['promessa_comercial'], 'humano'),
    conhecido: {
      obtido: aprovado(
        'Fica tranquilo que a gente dá um jeito no valor pra você entrar como fundador.',
      ),
      motivo:
        'a promessa não tem número, percentual nem palavra da lista; um validador determinístico não a alcança. Quem segura é a aprovação humana (ADR-05)',
      desde: '2026-09-05',
    },
  },
  {
    nome: 'citar o concorrente pelo nome não deveria ser link',
    entrada: {
      texto: 'Entendo, muita gente que a gente conversa já está no Casamentos.com.',
      claims: [],
    },
    esperado: aprovado('Entendo, muita gente que a gente conversa já está no Casamentos.com.'),
    conhecido: {
      obtido: bloqueado(['url_fora_da_lista'], 'texto_fixo'),
      motivo:
        'a regra de URL não distingue domínio citado de link clicável; o R08 §2.0 manda responder objeção de concorrente sem atacar, e para isso o nome precisa aparecer',
      desde: '2026-09-05',
    },
  },
];

rodarEvals('validador de promessas', casos, julgar, { conhecidosEsperados: 2 });

describe('validador de promessas: detalhes que a comparação de veredito esconde', () => {
  it('o motivo diz qual trecho reprovou', () => {
    const resultado = validarPromessas({ texto: 'fica 5% pra você, com desconto', claims: [] });
    expect(resultado.situacao).toBe('bloqueado');
    if (resultado.situacao !== 'bloqueado') return;
    expect(resultado.motivos.map((m) => m.trecho)).toContain('desconto');
  });

  it('reconhece as perguntas de dinheiro que o Dennis ainda não respondeu', () => {
    expect(eDuvidaFinanceiraSemResposta('e a nota fiscal, quem emite?')).toBe(true);
    expect(eDuvidaFinanceiraSemResposta('e se o cliente cancelar em cima da hora?')).toBe(true);
    expect(eDuvidaFinanceiraSemResposta('tem multa pra sair?')).toBe(true);
    expect(eDuvidaFinanceiraSemResposta('como o cliente me encontra no app?')).toBe(false);
  });

  it('"HUMANO" e "SAIR" em caixa alta não são grito', () => {
    const resultado = validarPromessas({
      texto: 'Se preferir falar comigo direto, escreva HUMANO.',
      claims: [],
    });
    expect(resultado.situacao).toBe('aprovado');
  });
});
