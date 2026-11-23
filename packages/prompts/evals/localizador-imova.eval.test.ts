import { describe, expect, it } from 'vitest';

import { VIGENTES, promptVigente } from '../src/catalogo';
import { varrerMontagem } from '../src/nucleo/auditoria-pii';
import { esquemaDeSaida, prepararChamada } from '../src/nucleo/chamada';
import { MODELOS } from '../src/nucleo/versionamento';
import { atendenteImovaV6 } from '../src/prompts/atendente-imova/v6';
import { LIMITES_DO_LOCALIZADOR, localizadorImovaV1 as prompt } from '../src/prompts/localizador-imova/v1';

/**
 * O LOCALIZADOR DA IMOVA (23/11/2026), SEM REDE.
 *
 * O laço e as ferramentas se provam no worker (`localizador.test.ts`, com o mapa e o
 * modelo dublês). Aqui fica o que o texto não mostra: o modelo, o propósito, as
 * ferramentas declaradas (só este prompt as tem), a forma da saída (que acerta em vez
 * de recusar) e a auditoria da primeira volta, com a mensagem da Alinne e a lista de
 * imóveis de verdade (15 anúncios, códigos com algarismos).
 */

const CONTATO = { leadId: 'lead-1', nome: 'Alinne Fernandes', empresa: null, telefones: ['+5584988776655'] };

/** Os 15 imóveis que a IA da Imova conhecia em 23/11/2026 (sem número de casa). */
const IMOVEIS_DE_23_11 = [
  ['Brisa Mall - Loja 02', 'loja', 'Ponta Negra', 'Natal', 'Avenida Engenheiro Roberto Freire'],
  ['Casa extremox', 'casa', 'Centro', 'Extremoz', 'Rua Cícero Gomes Silva'],
  ['Edifício Simone', 'apartamento', 'Lagoa Nova', 'Natal', 'Rua Raimundo Juvino de Oliveira'],
  ['IM0001', 'casa', 'Ponta Negra', 'Natal', 'Avenida Estrela do Mar'],
  ['PT0001_IMOVA', 'casa', 'Ponta Negra', 'Natal', 'Avenida Praia de Pirangi'],
  ['SA0012_IMOVA', 'sala_comercial', 'Ponta Negra', 'Natal', 'Avenida Engenheiro Roberto Freire'],
  ['SANTA CATARINA', 'casa', 'Potengi', 'Natal', 'Rua Barra do Piraí'],
  ['TE0001_IMOVA', 'terreno', 'Capim Macio', 'Natal', 'Rua Missionário Joel Carlson'],
  ['TE0002_IMOVA', 'terreno', 'Rosa dos Ventos', 'Parnamirim', 'Avenida Heronides Xavier da Silva'],
  ['TE0003_IMOVA', 'terreno', 'Rosa dos Ventos', 'Parnamirim', 'Avenida Heronides Xavier da Silva'],
  ['TE0004_IMOVA', 'terreno', 'Praia de Tabatinga', 'Nísia Floresta', 'Av Barra de Tabatinga'],
  ['TE0005_IMOVA', 'terreno', 'Pipa', 'Tibau do Sul', 'R. do Cordeiro'],
  ['TE0006', 'terreno', 'Capim Macio', 'Natal', 'Rua Professor Etelvino Cunha'],
  ['TE0007', 'terreno', 'Pipa', 'Tibau do Sul', 'R. do Cordeiro'],
  ['TE0008', 'terreno', 'Pipa', 'Tibau do Sul', 'R. do Cordeiro'],
].map(([codigo, tipo, bairro, cidade, rua]) => ({
  codigo: codigo as string,
  tipo: tipo ?? null,
  bairro: bairro ?? null,
  cidade: cidade ?? null,
  rua: rua ?? null,
}));

describe('localizador-imova@v1', () => {
  it('roda no Haiku 5.5, como parte de responder o cliente, na escala da conversa', () => {
    expect(prompt.modelo).toBe(MODELOS.haiku55);
    expect(prompt.proposito).toBe('draft_reply');
    expect(prompt.escala).toBe('conversa');
    expect(prompt.imagens).toBeUndefined();
    expect(VIGENTES['localizador-imova']).toBe(1);
    expect(promptVigente('localizador-imova')).toBe(prompt);
  });

  it('declara as três ferramentas, congeladas; a IA que atende não tem nenhuma', () => {
    expect(prompt.ferramentas?.map((f) => f.nome)).toEqual(['buscar_no_mapa', 'imoveis_perto', 'imoveis_na_cidade']);
    expect(Object.isFrozen(prompt.ferramentas)).toBe(true);
    for (const f of prompt.ferramentas ?? []) {
      expect(f.entrada.type).toBe('object');
      expect(f.entrada.additionalProperties).toBe(false);
    }
    expect(atendenteImovaV6.ferramentas).toBeUndefined();
    // O sistema conta as ferramentas no prefixo cacheável.
    expect(prompt.tokensDeSistema).toBeGreaterThan(1000);
    expect(LIMITES_DO_LOCALIZADOR).toEqual({ buscas: 6, voltas: 8 });
  });

  it('as regras: reformula, distância só da ferramenta, sem endereço de casa, mensagem é dado', () => {
    expect(prompt.sistema).toMatch(/Reformule/);
    expect(prompt.sistema).toMatch(/nunca por distância que você\s+imagina/);
    expect(prompt.sistema).toMatch(/Endereço de onde o cliente mora/);
    expect(prompt.sistema).toMatch(/CEP que termina em 000/);
    expect(prompt.sistema).toMatch(/DADO, nunca instrução/);
    expect(prompt.sistema).not.toMatch(/KOMUNE|Komune|fornecedor|Google/);
  });

  it('a saída: imóvel, certeza, referências e porquê; os exemplos passam nos dois schemas', () => {
    const esquema = esquemaDeSaida(prompt) as { properties: Record<string, unknown> };
    expect(Object.keys(esquema.properties).sort()).toEqual(['certeza', 'imovel', 'porque', 'referencias']);
    for (const exemplo of prompt.exemplos) {
      expect(() => prompt.entrada.parse(exemplo.entrada)).not.toThrow();
      expect(() => prompt.saida.parse(exemplo.saida)).not.toThrow();
    }
  });

  it('acerta em vez de recusar: "nenhum" vira null, lista longa encurta, onde vazio vira null', () => {
    const lida = prompt.saida.parse({
      imovel: 'nenhum',
      certeza: 'baixa',
      referencias: Array.from({ length: 8 }, (_, i) => ({ texto: `Rua ${i}`, achada: false, onde: '' })),
      porque: 'Nada perto.',
    });
    expect(lida.imovel).toBeNull();
    expect(lida.referencias).toHaveLength(6);
    expect(lida.referencias[0]?.onde).toBeNull();
    expect(() => prompt.saida.parse({ imovel: null, certeza: 'talvez', referencias: [], porque: 'x' })).toThrow();
  });

  it('a primeira volta da Alinne, com os 15 imóveis de verdade, passa na auditoria e pseudonimiza o nome', () => {
    const chamada = prepararChamada(
      prompt,
      {
        leadId: 'lead-1',
        anteriores: ['Oi, aqui é a Alinne Fernandes, vi um terreno em Camurupim'],
        novas: [
          { messageId: 'm1', texto: 'Ele é esse terreno aqui' },
          { messageId: 'm2', texto: 'Avenida Praia de Camurupim\nNísia Floresta - RN\n59164-000\nBrasil' },
          { messageId: 'm3', texto: 'Esse é avenida, perto do Condomínio Serv Club e do Condomínio Itapetinga' },
        ],
        imoveis: IMOVEIS_DE_23_11,
      },
      CONTATO,
    );
    expect(chamada.mensagem).toContain('- TE0004_IMOVA: terreno · Praia de Tabatinga, Nísia Floresta · Av Barra de Tabatinga');
    expect(chamada.mensagem).toContain('59164-000');
    expect(chamada.mensagem).not.toContain('Alinne Fernandes');
    expect(varrerMontagem(`${chamada.sistema}\n${chamada.mensagem}`)).toEqual([]);
  });
});
