/**
 * Paridade SQL × TypeScript.
 *
 * Roda a MESMA tabela de casos de `casos-normalizacao.fixtures.ts` dentro do Postgres
 * local (o mesmo banco que o pgTAP usa) e compara, caso a caso, com o resultado das
 * funções TypeScript. É o teste que impede o pacote de se afastar das migrações.
 *
 * Quando o banco não responde (CI sem Docker, OrbStack fechado), a suíte inteira é
 * pulada com `describe.skipIf` — nunca falha por ambiente.
 */

import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  type CasoBooleano,
  type CasoTexto,
  CASOS_CNPJ_NORMALIZE,
  CASOS_CNPJ_VALIDO,
  CASOS_DOMINIO,
  CASOS_HOST_COMPARTILHADO,
  CASOS_INSTAGRAM,
  CASOS_MASCARA,
  CASOS_SEARCH_NAME,
  CASOS_TELEFONE,
} from './casos-normalizacao.fixtures';
import {
  cnpjIsValid,
  isSharedWebHost,
  maskPhone,
  normalizeCnpj,
  normalizeInstagram,
  normalizePhoneBr,
  ROTAS_RESERVADAS_INSTAGRAM,
  searchName,
  websiteDomain,
} from './normalizadores';

/** Container do Postgres da stack local do Supabase (`supabase start`). */
const CONTAINER = 'supabase_db_komune-crm';

/** Executa SQL no banco local pelo psql de dentro do container (não há psql no host). */
function psql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-tAq',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      '-',
    ],
    { input: sql, encoding: 'utf8', timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

function bancoResponde(): boolean {
  try {
    return psql('select 1;') === '1';
  } catch {
    return false;
  }
}

const BANCO_DISPONIVEL = bancoResponde();

/** Literal SQL da entrada; `$k$…$k$` evita qualquer escape de aspas. */
function literal(entrada: string | null): string {
  return entrada === null ? 'null::text' : `$k$${entrada}$k$`;
}

/**
 * Avalia `funcao(entrada)` para todos os casos em UMA consulta e devolve o resultado
 * do Postgres como array JSON, na mesma ordem dos casos.
 */
function avaliarNoPostgres<T>(funcao: string, casos: readonly { entrada: string | null }[]): T[] {
  const linhas = casos
    .map((caso, i) => `select ${i} as i, ${funcao}(${literal(caso.entrada)}) as v`)
    .join('\nunion all\n');
  const saida = psql(
    `select coalesce(json_agg(t.v order by t.i)::text, '[]') from (\n${linhas}\n) t;`,
  );
  return JSON.parse(saida) as T[];
}

describe.skipIf(!BANCO_DISPONIVEL)('paridade SQL × TypeScript (Postgres local)', () => {
  const paridadeTexto = (funcao: string, casos: readonly CasoTexto[]) => {
    const doBanco = avaliarNoPostgres<string | null>(funcao, casos);
    expect(doBanco).toHaveLength(casos.length);
    return casos.map((caso, i) => ({ ...caso, doBanco: doBanco[i] ?? null }));
  };

  const paridadeBooleana = (funcao: string, casos: readonly CasoBooleano[]) => {
    const doBanco = avaliarNoPostgres<boolean>(funcao, casos);
    expect(doBanco).toHaveLength(casos.length);
    return casos.map((caso, i) => ({ ...caso, doBanco: doBanco[i] as boolean }));
  };

  it('app.normalize_phone_br devolve o mesmo que normalizePhoneBr', () => {
    for (const caso of paridadeTexto('app.normalize_phone_br', CASOS_TELEFONE)) {
      expect
        .soft(normalizePhoneBr(caso.entrada), `telefone (${caso.descricao}): ${caso.entrada}`)
        .toBe(caso.doBanco);
      expect.soft(caso.doBanco, `pgTAP diverge do banco em: ${caso.descricao}`).toBe(caso.esperado);
    }
  });

  it('app.normalize_cnpj devolve o mesmo que normalizeCnpj', () => {
    for (const caso of paridadeTexto('app.normalize_cnpj', CASOS_CNPJ_NORMALIZE)) {
      expect.soft(normalizeCnpj(caso.entrada), `cnpj (${caso.descricao})`).toBe(caso.doBanco);
      expect.soft(caso.doBanco, `pgTAP diverge do banco em: ${caso.descricao}`).toBe(caso.esperado);
    }
  });

  it('app.cnpj_is_valid devolve o mesmo que cnpjIsValid', () => {
    for (const caso of paridadeBooleana('app.cnpj_is_valid', CASOS_CNPJ_VALIDO)) {
      expect.soft(cnpjIsValid(caso.entrada), `cnpj válido (${caso.descricao})`).toBe(caso.doBanco);
      expect.soft(caso.doBanco, `pgTAP diverge do banco em: ${caso.descricao}`).toBe(caso.esperado);
    }
  });

  it('app.normalize_instagram devolve o mesmo que normalizeInstagram', () => {
    for (const caso of paridadeTexto('app.normalize_instagram', CASOS_INSTAGRAM)) {
      expect
        .soft(normalizeInstagram(caso.entrada), `instagram (${caso.descricao}): ${caso.entrada}`)
        .toBe(caso.doBanco);
      expect.soft(caso.doBanco, `pgTAP diverge do banco em: ${caso.descricao}`).toBe(caso.esperado);
    }
  });

  it('app.website_domain devolve o mesmo que websiteDomain', () => {
    for (const caso of paridadeTexto('app.website_domain', CASOS_DOMINIO)) {
      expect
        .soft(websiteDomain(caso.entrada), `domínio (${caso.descricao}): ${caso.entrada}`)
        .toBe(caso.doBanco);
      expect.soft(caso.doBanco, `pgTAP diverge do banco em: ${caso.descricao}`).toBe(caso.esperado);
    }
  });

  it('app.is_shared_web_host devolve o mesmo que isSharedWebHost', () => {
    for (const caso of paridadeBooleana('app.is_shared_web_host', CASOS_HOST_COMPARTILHADO)) {
      expect.soft(isSharedWebHost(caso.entrada), `host (${caso.descricao})`).toBe(caso.doBanco);
      expect.soft(caso.doBanco, `pgTAP diverge do banco em: ${caso.descricao}`).toBe(caso.esperado);
    }
  });

  it('app.search_name devolve o mesmo que searchName', () => {
    for (const caso of paridadeTexto('app.search_name', CASOS_SEARCH_NAME)) {
      expect
        .soft(searchName(caso.entrada), `search_name (${caso.descricao}): ${caso.entrada}`)
        .toBe(caso.doBanco);
      expect.soft(caso.doBanco, `pgTAP diverge do banco em: ${caso.descricao}`).toBe(caso.esperado);
    }
  });

  it('app.mask_phone devolve o mesmo que maskPhone', () => {
    for (const caso of paridadeTexto('app.mask_phone', CASOS_MASCARA)) {
      expect.soft(maskPhone(caso.entrada), `máscara (${caso.descricao})`).toBe(caso.doBanco);
      expect.soft(caso.doBanco, `pgTAP diverge do banco em: ${caso.descricao}`).toBe(caso.esperado);
    }
  });

  it('a lista de rotas reservadas do Instagram é a mesma nos dois lados', () => {
    // Uma rota nova só no SQL passaria despercebida pelos casos acima: aqui o array
    // `v_reservadas` é lido da definição da função no banco e comparado com a constante
    // ROTAS_RESERVADAS_INSTAGRAM, item a item.
    const doBanco = JSON.parse(
      psql(`
        select coalesce(json_agg(x order by x)::text, '[]')
          from (
            select unnest(regexp_matches(
                     substring(pg_get_functiondef(p.oid)
                               from 'v_reservadas constant text\\[\\] := array\\[(.*?)\\];'),
                     '''([a-z]+)''', 'g')) as x
              from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'app' and p.proname = 'normalize_instagram'
          ) s;`),
    ) as string[];
    expect(
      doBanco.length,
      'não consegui ler o array v_reservadas da função no banco',
    ).toBeGreaterThan(0);
    expect(doBanco).toEqual([...ROTAS_RESERVADAS_INSTAGRAM].sort());
  });
});

describe.skipIf(BANCO_DISPONIVEL)('paridade SQL × TypeScript', () => {
  it('pulada: o Postgres local não respondeu (rode `supabase start`)', () => {
    expect(BANCO_DISPONIVEL).toBe(false);
  });
});
