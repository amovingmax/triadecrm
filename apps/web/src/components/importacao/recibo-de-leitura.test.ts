/**
 * O recibo de leitura das colunas. O que precisa ser verdade:
 *   · nos dois CSV de verdade de `listas/` o recibo NÃO pergunta nada — são 10
 *     acertos por nome exato em 36 colunas, e o passo do mapa some;
 *   · a coluna `emails`, vazia nas vinte linhas, é anunciada como vazia: um
 *     recibo que promete "E-mail" sem ressalva parece bug;
 *   · a coluna `place_id` do arquivo aparece entre as ignoradas COM o motivo —
 *     ela não é o `place_id` do CRM, que é o `cid` (ADR-12);
 *   · casar por semelhança pergunta, e campo obrigatório que faltou também;
 *   · a planilha-ponte, que tem coluna de origem, continua sem perguntar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { sugerirMapa } from './mapeamento';
import { lerCsv } from './planilha';
import { montarReciboDeLeitura, rotuloComRessalva } from './recibo-de-leitura';
import type { Mapa, PlanilhaLida } from './tipos';

function ler(nome: string): PlanilhaLida {
  return lerCsv(
    readFileSync(fileURLToPath(new URL(`./fixtures/${nome}`, import.meta.url)), 'utf8'),
    nome,
  );
}

const MAPS = 'Google Maps (raspagem local)';

describe('o recibo do CSV do Maps', () => {
  const planilha = ler('maps-natal-fotografo.csv');
  const sugestao = sugerirMapa(planilha.cabecalho);
  const recibo = montarReciboDeLeitura(planilha, sugestao.mapa, sugestao, MAPS);

  it('lê 10 das 36 colunas e não pergunta nada', () => {
    expect(recibo.lidas).toHaveLength(10);
    expect(recibo.totalDeColunas).toBe(36);
    expect(recibo.chutadas).toEqual([]);
    expect(recibo.pendentes).toEqual([]);
    expect(recibo.precisaPerguntar).toBe(false);
  });

  it('a ordem é a de leitura dos campos, e não a do arquivo', () => {
    expect(recibo.lidas.map((l) => l.campo).slice(0, 4)).toEqual([
      'nome',
      'categoria',
      'whatsapp',
      'origem_detalhe',
    ]);
  });

  it('diz que a coluna de e-mail veio vazia, em vez de prometer e-mail', () => {
    const email = recibo.lidas.find((l) => l.campo === 'email');
    expect(email?.vazia).toBe(true);
    expect(rotuloComRessalva(email!)).toBe('E-mail (vazia no arquivo)');
    // E o que tem conteúdo não ganha ressalva nenhuma.
    expect(rotuloComRessalva(recibo.lidas.find((l) => l.campo === 'nome')!)).toBe('Nome');
  });

  it('a coluna place_id do arquivo é ignorada COM motivo: ela não é o cid', () => {
    const p = recibo.ignoradas.find((i) => i.titulo === 'place_id');
    expect(p).toBeDefined();
    expect(p?.motivo).toContain('ADR-12');
    // As três disputas de coluna do arquivo do Maps, todas com o porquê à vista.
    expect(recibo.ignoradas.filter((i) => i.motivo).map((i) => i.titulo).sort()).toEqual([
      'complete_address',
      'place_id',
      'reviews_link',
    ]);
  });

  it('as 26 colunas que sobram continuam listadas, para quem quiser trazer uma', () => {
    expect(recibo.ignoradas).toHaveLength(26);
  });
});

describe('o recibo do CSV dos buffets', () => {
  it('também não pergunta nada', () => {
    const planilha = ler('maps-natal-buffet-36.csv');
    const s = sugerirMapa(planilha.cabecalho);
    expect(montarReciboDeLeitura(planilha, s.mapa, s, MAPS).precisaPerguntar).toBe(false);
  });
});

describe('a planilha-ponte', () => {
  it('tem coluna de origem própria e também não pergunta nada', () => {
    const planilha = ler('planilha-ponte-preenchida.csv');
    const s = sugerirMapa(planilha.cabecalho);
    const r = montarReciboDeLeitura(planilha, s.mapa, s, 'Planilha (importação)');
    expect(r.pendentes).toEqual([]);
    expect(r.precisaPerguntar).toBe(false);
  });
});

describe('quando há dúvida de verdade', () => {
  const planilha: PlanilhaLida = {
    aba: 'teste',
    abas: ['teste'],
    cabecalho: ['nome', 'telefone 2', 'categoria'],
    linhas: [['Buffet X', '84 99999-0000', 'Buffet infantil']],
    cortadas: 0,
    tituloIgnorado: [],
  };

  it('coluna casada por semelhança vira pergunta', () => {
    const s = sugerirMapa(planilha.cabecalho);
    const r = montarReciboDeLeitura(planilha, s.mapa, s, MAPS);
    expect(r.chutadas.map((c) => c.campo)).toEqual(['whatsapp']);
    expect(r.precisaPerguntar).toBe(true);
  });

  it('campo obrigatório que ninguém cobriu também vira pergunta', () => {
    const so: Mapa = { nome: 0 };
    const r = montarReciboDeLeitura(planilha, so, { mapa: so, motivos: {} }, MAPS);
    expect(r.pendentes).toEqual(['categoria']);
    expect(r.precisaPerguntar).toBe(true);
  });

  it('sem origem no lote e sem coluna de origem, a origem é pendência', () => {
    const so: Mapa = { nome: 0, categoria: 2 };
    const r = montarReciboDeLeitura(planilha, so, { mapa: so, motivos: {} });
    expect(r.pendentes).toEqual(['origem']);
  });
});
