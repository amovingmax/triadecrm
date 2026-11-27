import { describe, expect, it } from 'vitest';

import { VIGENTES, promptVigente } from '../src/catalogo';
import { prepararChamada } from '../src/nucleo/chamada';
import { MODELOS } from '../src/nucleo/versionamento';
import {
  type EntradaDaNotaDaResposta,
  motivoParaNaoSugerirANota,
  notaDaRespostaV1 as nota,
} from '../src/prompts/nota-da-resposta/v1';

/**
 * A NOTA DA RESPOSTA DA IMOVA (27/11/2026), SEM REDE.
 *
 * O que estes casos protegem: o modelo e o propósito, a pergunta e a resposta passando pela
 * pseudonimização (o nome que o admin escreve não chega ao modelo), os exemplos dentro da
 * trava que o banco repete, e a rede de segurança que segura o que o banco barraria
 * (telefone, código, arroba) e o que ele não vê (número que ninguém disse, "equipe").
 */

const CONTATO = { leadId: 'lead-1', nome: 'Carla Mendes', empresa: null, telefones: ['+5584988776655'] };
const base = (i = 0): EntradaDaNotaDaResposta => structuredClone(nota.exemplos[i]!.entrada);

describe('nota-da-resposta@v1: o contrato', () => {
  it('roda no Haiku 5.5, na escala da conversa e no custo do atendimento', () => {
    expect(nota.modelo).toBe(MODELOS.haiku55);
    expect(nota.escala).toBe('conversa');
    expect(nota.proposito).toBe('draft_reply');
    expect(VIGENTES['nota-da-resposta']).toBe(1);
    expect(promptVigente('nota-da-resposta')).toBe(nota);
  });

  it('a mensagem diz o imóvel, se ele já tem ficha, a pergunta e a resposta', () => {
    const { mensagem } = prepararChamada(nota, base(), CONTATO);
    expect(mensagem).toContain('IMÓVEL: a sala em Ponta Negra');
    expect(mensagem).toContain('JÁ TEM FICHA NO CADERNO: não');
    expect(mensagem).toContain('A PERGUNTA (do cliente): energia individualizada?');
    expect(mensagem).toContain('A RESPOSTA DA IMOVA: Sim, a sala tem energia individualizada');
  });

  it('sem imóvel, a mensagem diz que a pergunta não era de um imóvel', () => {
    const entrada = { ...base(), imovel: null };
    expect(prepararChamada(nota, entrada, CONTATO).mensagem).toContain('IMÓVEL: (nenhum');
  });

  it('o nome que o admin escreveu na resposta não chega ao modelo', () => {
    const entrada = { ...base(), respostaDaImova: 'Carla, sim, a energia é individualizada.' };
    const { mensagem } = prepararChamada(nota, entrada, CONTATO);
    expect(mensagem).not.toContain('Carla');
  });
});

describe('nota-da-resposta@v1: os exemplos e a rede de segurança', () => {
  it('as notas dos exemplos passam pela rede, com os números da pergunta e da resposta', () => {
    for (const exemplo of nota.exemplos) {
      const contexto = [
        exemplo.entrada.pergunta,
        exemplo.entrada.respostaDaImova,
        exemplo.entrada.imovel?.titulo,
      ];
      for (const texto of [exemplo.saida.textoDoImovel, exemplo.saida.textoGeral]) {
        if (texto !== null) expect(motivoParaNaoSugerirANota(texto, contexto)).toBeNull();
      }
    }
  });

  it('segura o que o banco barraria', () => {
    expect(motivoParaNaoSugerirANota('Para visitar, ligue 84 98820-9001.')).toBe('telefone');
    expect(motivoParaNaoSugerirANota('A área é 1.338,99, 2.021 m² no total.', ['1.338,99, 2.021'])).toBe(
      'telefone',
    );
    expect(motivoParaNaoSugerirANota('É o terreno TE0004, de frente para o mar.')).toBe('codigo');
    expect(motivoParaNaoSugerirANota('Documentos para contato@imova.com.br.')).toBe('arroba');
    expect(motivoParaNaoSugerirANota('O [[NOME_1]] aceita FGTS na compra.')).toBe('marcador');
    expect(motivoParaNaoSugerirANota('Sim.')).toBe('curta');
  });

  it('e o que o banco não vê: número que ninguém disse e "equipe"', () => {
    expect(
      motivoParaNaoSugerirANota('O condomínio é de R$ 350 por mês.', ['Quanto é o condomínio?', 'É barato.']),
    ).toBe('numero_fora_do_contexto');
    expect(motivoParaNaoSugerirANota('A equipe ajuda com a documentação do banco.')).toBe('disse_equipe');
    expect(motivoParaNaoSugerirANota('O condomínio é de R$ 350 por mês.', ['É R$ 350.'])).toBeNull();
  });
});
