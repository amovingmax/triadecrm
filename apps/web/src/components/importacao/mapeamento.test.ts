/**
 * O mapa de colunas. O que precisa ser verdade:
 *   · a planilha-ponte casa sozinha, inclusive com o `*` de obrigatório;
 *   · uma lista qualquer casa o que dá e ADMITE que casou por semelhança;
 *   · escolher um campo tira esse campo da coluna onde ele estava;
 *   · o número da linha que a prévia mostra é o número que a pessoa vê no Excel.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { acharCampo, chave, faltando, linhaParaObjeto, sugerirMapa, temConteudo } from './mapeamento';
import { lerCsv } from './planilha';
import type { Mapa } from './tipos';

const planilha = lerCsv(
  readFileSync(
    fileURLToPath(new URL('./fixtures/planilha-ponte-preenchida.csv', import.meta.url)),
    'utf8',
  ),
  'planilha.csv',
);

describe('chave do cabeçalho', () => {
  it('tira acento, caixa, pontuação e o asterisco de obrigatório', () => {
    expect(chave('Último contato')).toBe('ultimo contato');
    expect(chave('nome*')).toBe('nome');
    expect(chave('  DATA_PROXIMA_ACAO ')).toBe('data proxima acao');
  });
});

describe('um cabeçalho de cada vez', () => {
  it('acerta em cheio o vocabulário da planilha-ponte', () => {
    expect(acharCampo('whatsapp*')).toEqual({ campo: 'whatsapp', motivo: 'exato' });
    expect(acharCampo('canal_ultimo_contato')).toEqual({
      campo: 'canal_ultimo_contato',
      motivo: 'exato',
    });
  });

  it('reconhece o vocabulário dos diretórios, e diz que foi por semelhança', () => {
    expect(acharCampo('Telefone comercial')).toEqual({ campo: 'whatsapp', motivo: 'parecido' });
    expect(acharCampo('Nome fantasia')).toEqual({ campo: 'nome', motivo: 'exato' });
  });

  it('não confunde "data da próxima ação" com "próxima ação"', () => {
    expect(acharCampo('data_proxima_acao')?.campo).toBe('data_proxima_acao');
    expect(acharCampo('proxima_acao')?.campo).toBe('proxima_acao');
  });

  it('devolve nulo para coluna que não é campo nenhum', () => {
    expect(acharCampo('coluna auxiliar zzz')).toBeNull();
    expect(acharCampo('')).toBeNull();
  });
});

describe('mapa da planilha-ponte', () => {
  const { mapa, motivos } = sugerirMapa(planilha.cabecalho);

  it('casa as 17 colunas sozinho', () => {
    expect(Object.keys(mapa)).toHaveLength(17);
    expect(mapa.nome).toBe(0);
    expect(mapa.whatsapp).toBe(3);
    expect(mapa.observacoes).toBe(16);
  });

  it('nenhuma coluna da planilha-ponte precisa de conferência', () => {
    expect(Object.values(motivos).every((m) => m === 'exato')).toBe(true);
  });

  it('não sobra nada obrigatório', () => {
    expect(faltando(mapa)).toEqual([]);
  });
});

describe('mapa de uma lista qualquer', () => {
  it('não deixa a segunda coluna de telefone roubar a primeira', () => {
    const { mapa, motivos } = sugerirMapa(['Empresa', 'Telefone', 'Telefone 2', 'Segmento']);
    expect(mapa.nome).toBe(0);
    expect(mapa.whatsapp).toBe(1);
    expect(motivos.whatsapp).toBe('exato');
    expect(mapa.categoria).toBe(3);
  });

  it('acusa o obrigatório que faltou', () => {
    const { mapa } = sugerirMapa(['Empresa', 'Telefone']);
    expect(faltando(mapa)).toEqual(['categoria', 'origem']);
  });
});

describe('linha para objeto', () => {
  const { mapa } = sugerirMapa(planilha.cabecalho);

  it('manda o número da linha do Excel, contando o cabeçalho', () => {
    const objeto = linhaParaObjeto(planilha.linhas[0] ?? [], mapa, 2);
    expect(objeto.linha).toBe(2);
    expect(objeto.nome).toBe('Marileide Maison Buffet');
    expect(objeto.whatsapp).toBe('(84) 3217-7012');
    expect(objeto.categoria).toBe('Buffet adulto / corporativo');
  });

  it('não manda campo vazio (o banco distingue nulo de string vazia)', () => {
    const semTelefone = planilha.linhas.find((l) => l[0] === 'Multi Tendas Locações') ?? [];
    const objeto = linhaParaObjeto(semTelefone, mapa, 10);
    expect('whatsapp' in objeto).toBe(false);
    expect(objeto.instagram).toBe('@multitendas');
  });

  it('ignora coluna que a pessoa mandou não importar', () => {
    const parcial: Mapa = { nome: 0, categoria: 2, origem: 4 };
    const objeto = linhaParaObjeto(planilha.linhas[0] ?? [], parcial, 2);
    expect(Object.keys(objeto).sort()).toEqual(['categoria', 'linha', 'nome', 'origem']);
  });
});

describe('linha sem conteúdo', () => {
  const { mapa } = sugerirMapa(planilha.cabecalho);

  it('vê conteúdo quando algum campo mapeado tem texto', () => {
    expect(temConteudo(planilha.linhas[0] ?? [], mapa)).toBe(true);
  });

  it('não vê conteúdo quando só as colunas ignoradas estão preenchidas', () => {
    const so_observacao = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'sobrou'];
    expect(temConteudo(so_observacao, { nome: 0, categoria: 2 })).toBe(false);
    expect(temConteudo(so_observacao, { observacoes: 16 })).toBe(true);
  });
});
