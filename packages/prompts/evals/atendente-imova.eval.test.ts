import { describe, expect, it } from 'vitest';

import { VIGENTES, promptVigente } from '../src/catalogo';
import { varrerMontagem } from '../src/nucleo/auditoria-pii';
import { esquemaDeSaida, prepararChamada } from '../src/nucleo/chamada';
import { MODELOS } from '../src/nucleo/versionamento';
import {
  type EntradaDoAtendente,
  atendenteImovaV1 as prompt,
  linhaDoImovel,
  montarBase,
  semTelefone,
  sistemaComBase,
} from '../src/prompts/atendente-imova/v1';

/**
 * A IA QUE ATENDE O CLIENTE DA IMOVA (06/11/2026), SEM REDE.
 *
 * O que estes casos protegem é o que a qualidade do texto não mostra: o modelo e o
 * propósito, a base da Imova entrando no bloco estável em ordem estável, o telefone
 * que não pode chegar ao modelo (nem pela conversa, nem pela base) e a forma da saída.
 * A qualidade das respostas se mede na semana de treino, com a conversa do Janio.
 */

const CONTATO = { leadId: 'lead-1', nome: 'Janio Ramalho', empresa: null, telefones: ['+5584988776655'] };

function entrada(mensagens: EntradaDoAtendente['mensagens'], extra: Partial<EntradaDoAtendente> = {}): EntradaDoAtendente {
  return {
    leadId: 'lead-1',
    agora: '2026-11-06 14:34',
    agoraPorExtenso: 'sexta-feira, 6 de novembro, às 14h34',
    treino: false,
    cliente: { nome: 'Janio Ramalho', temFicha: true, etapa: null, perfil: [], visitas: [], canalDeChegada: null },
    horariosDeVisita: [
      { opcao: 'h1', quando: 'segunda-feira, 9 de novembro, às 09h30' },
      { opcao: 'h2', quando: 'segunda-feira, 9 de novembro, às 10h20' },
    ],
    respostasNaUltimaHora: 0,
    mensagens,
    ...extra,
  };
}

const BASE = {
  caderno: [
    { id: 2, texto: 'O escritório atende de segunda a sexta, das 8h às 18h.', origem: 'tela' },
    { id: 1, texto: 'No aluguel aceitamos fiador ou seguro-fiança.', origem: 'treino' },
  ],
  imoveis: [
    {
      codigo: 'IMV-0002',
      situacao: 'rascunho',
      tipo: 'terreno',
      negocio: 'venda',
      preco_venda: 180000,
      area_total: 360,
      bairro: 'Parnamirim',
      cidade: 'Parnamirim',
      estado: 'RN',
    },
    {
      codigo: 'IMV-0001',
      situacao: 'no_ar',
      tipo: 'apartamento',
      negocio: 'aluguel',
      preco_aluguel: 2500,
      periodo_aluguel: 'mensal',
      condominio: 600,
      iptu: 1200,
      iptu_periodo: 'anual',
      quartos: 3,
      suites: 1,
      banheiros: 2,
      vagas: 1,
      area_util: 90,
      bairro: 'Ponta Negra',
      cidade: 'Natal',
      estado: 'RN',
      rua: 'Rua das Dunas',
      numero: null,
      descricao: 'Vista para o mar. Fale com o corretor no 84 99988-0011.',
    },
  ],
};

describe('atendente-imova@v1', () => {
  it('roda no Opus 5.5, lê a conversa inteira e conta como resposta redigida', () => {
    expect(prompt.modelo).toBe(MODELOS.opus55);
    expect(prompt.modelo).toBe('claude-opus-5-5');
    expect(prompt.proposito).toBe('draft_reply');
    expect(prompt.escala).toBe('conversa');
    expect(VIGENTES['atendente-imova']).toBe(1);
    expect(promptVigente('atendente-imova')).toBe(prompt);
  });

  it('o texto é da Imova e assume as decisões do usuário', () => {
    expect(prompt.sistema).toMatch(/Imova Imobiliária/);
    expect(prompt.sistema).toMatch(/assinatura "Imova"/);
    expect(prompt.sistema).toMatch(/passar_para_corretor/);
    expect(prompt.sistema).toMatch(/ligação/);
    expect(prompt.sistema).toMatch(/CONVERSA DO TREINO/);
    expect(prompt.sistema).not.toMatch(/KOMUNE|Komune|fornecedor|evento/);
  });

  it('a saída pede ação, mensagem, visita, motivo, anotações e confiança', () => {
    const esquema = esquemaDeSaida(prompt) as { properties: Record<string, unknown> };
    expect(Object.keys(esquema.properties).sort()).toEqual(
      ['acao', 'anotacoes', 'confianca', 'mensagem', 'motivo', 'visita'].sort(),
    );
  });

  it('todo exemplo passa pelos dois schemas', () => {
    for (const exemplo of prompt.exemplos) {
      expect(() => prompt.entrada.parse(exemplo.entrada)).not.toThrow();
      expect(() => prompt.saida.parse(exemplo.saida)).not.toThrow();
    }
  });

  it('mensagem longa demais é encurtada na palavra, não recusada', () => {
    const longa = 'Temos o apartamento. '.repeat(80);
    const lida = prompt.saida.parse({
      acao: 'responder',
      mensagem: longa,
      visita: null,
      motivo: 'ok',
      anotacoes: [],
      confianca: 0.8,
    });
    expect(lida.mensagem.length).toBeLessThanOrEqual(1000);
    expect(lida.mensagem.endsWith('…')).toBe(true);
  });
});

describe('a base da Imova no bloco estável', () => {
  it('sai em ordem estável: caderno por número, imóveis por código', () => {
    const texto = montarBase(BASE);
    expect(texto.indexOf('[1]')).toBeLessThan(texto.indexOf('[2]'));
    expect(texto.indexOf('IMV-0001')).toBeLessThan(texto.indexOf('IMV-0002'));
    expect(montarBase(BASE)).toBe(montarBase({ caderno: [...BASE.caderno].reverse(), imoveis: [...BASE.imoveis].reverse() }));
  });

  it('o imóvel sai com os números do jeito brasileiro e sem o que não existe', () => {
    const [apartamento] = BASE.imoveis.filter((i) => i.codigo === 'IMV-0001');
    const linha = linhaDoImovel(apartamento!);
    expect(linha).toContain('aluguel R$ 2.500 por mês');
    expect(linha).toContain('condomínio R$ 600');
    expect(linha).toContain('3 quartos (1 suíte)');
    expect(linha).toContain('Rua das Dunas · Ponta Negra · Natal/RN');
    expect(linha).not.toContain('undefined');
    expect(linha).not.toContain('null');
  });

  it('telefone escrito na descrição ou no caderno sai do bloco; preço fica', () => {
    expect(semTelefone('Ligue 84 99988-0011 ou (84) 3222-1234.')).toBe('Ligue (telefone) ou (telefone).');
    expect(semTelefone('R$ 1.250.000 à vista')).toBe('R$ 1.250.000 à vista');
    expect(semTelefone('condomínio 650 e IPTU 1.200')).toBe('condomínio 650 e IPTU 1.200');
    const sistema = sistemaComBase(BASE);
    expect(sistema).toContain('Fale com o corretor no (telefone).');
    expect(varrerMontagem(sistema)).toEqual([]);
  });
});

describe('a chamada montada', () => {
  it('a conversa comum passa pela auditoria, com o nome pseudonimizado', () => {
    const chamada = prepararChamada(
      { ...prompt, sistema: sistemaComBase(BASE) },
      entrada([
        {
          messageId: 'm1',
          de: 'cliente',
          quem: null,
          quando: '06/11 14:33',
          texto: 'Oi, aqui é o Janio Ramalho! Vi a placa. Quanto é o aluguel do apartamento de Ponta Negra?',
        },
      ]),
      CONTATO,
    );
    expect(chamada.mensagem).not.toContain('Janio Ramalho');
    expect(chamada.mensagem).toContain('[[NOME_1]]');
    expect(chamada.mensagem).toContain('agora: sexta-feira, 6 de novembro, às 14h34');
    expect(chamada.mensagem).not.toContain('2026-11-06');
    expect(chamada.sistema).toContain('IMV-0001');
  });

  it('a hora por extenso e as datas da conversa não viram telefone', () => {
    expect(() =>
      prepararChamada(
        prompt,
        entrada([
          { messageId: 'm1', de: 'cliente', quem: null, quando: '06/11 14:34', texto: 'Pode ser dia 12/12 às 14:30?' },
          { messageId: 'm2', de: 'ia', quem: null, quando: '06/11 14:35', texto: 'Tenho segunda, 9 de novembro, às 10h20.' },
        ]),
        CONTATO,
      ),
    ).not.toThrow();
  });

  it('telefone de outra pessoa na conversa vira marcador antes de chegar ao modelo', () => {
    const chamada = prepararChamada(
      prompt,
      entrada([
        { messageId: 'm1', de: 'cliente', quem: null, quando: '06/11 14:34', texto: 'Liga para minha esposa no 84 99123-4567' },
      ]),
      CONTATO,
    );
    expect(chamada.mensagem).not.toMatch(/99123/);
  });

  it('o telefone do próprio cliente é trocado por marcador e a chamada sai', () => {
    const chamada = prepararChamada(
      prompt,
      entrada([
        { messageId: 'm1', de: 'cliente', quem: null, quando: '06/11 14:34', texto: 'Meu número é 84 98877-6655, pode me chamar' },
      ]),
      CONTATO,
    );
    expect(chamada.mensagem).not.toMatch(/98877/);
  });
});
