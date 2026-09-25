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

import {
  acharCampo,
  chave,
  faltando,
  linhaParaObjeto,
  montarLinhasDaPlanilha,
  sugerirMapa,
  temConteudo,
} from './mapeamento';
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

/**
 * O cabeçalho que o `google-maps-scraper-kit` devolve.
 *
 * As 29 colunas estão listadas na spec do pivô (§3.1): dez viram campo e
 * dezenove são descartadas, cada uma com motivo escrito. O cabeçalho está aqui à
 * mão de propósito — se o kit renomear uma coluna, quem tem de quebrar é este
 * teste, e não a importação de 600 linhas na mão de quem está prospectando.
 */
const CABECALHO_DO_KIT = [
  'link',
  'title',
  'category',
  'address',
  'open_hours',
  'popular_times',
  'website',
  'phone',
  'plus_code',
  'review_count',
  'review_rating',
  'latitude',
  'longitude',
  'cid',
  'status',
  'descriptions',
  'reviews_link',
  'thumbnail',
  'timezone',
  'price_range',
  'images',
  'reservations',
  'menu',
  'owner',
  'about',
  'user_reviews',
  'emails',
  'facebook',
  'linkedin',
];

describe('cabeçalho do google-maps-scraper-kit', () => {
  const { mapa, motivos } = sugerirMapa(CABECALHO_DO_KIT);

  it('casa as dez colunas que viram campo, todas por nome exato', () => {
    expect(mapa.origem_detalhe).toBe(0);
    expect(mapa.nome).toBe(1);
    expect(mapa.categoria).toBe(2);
    expect(mapa.endereco).toBe(3);
    expect(mapa.site).toBe(6);
    expect(mapa.whatsapp).toBe(7);
    expect(mapa.avaliacoes_qtd).toBe(9);
    expect(mapa.nota).toBe(10);
    expect(mapa.place_id).toBe(13);
    expect(mapa.email).toBe(26);
    const dez = [
      'origem_detalhe',
      'nome',
      'categoria',
      'endereco',
      'site',
      'whatsapp',
      'avaliacoes_qtd',
      'nota',
      'place_id',
      'email',
    ] as const;
    expect(dez.map((c) => motivos[c])).toEqual(dez.map(() => 'exato'));
  });

  it('title, category e phone passam a casar: hoje não casavam com nada', () => {
    expect(acharCampo('title')).toEqual({ campo: 'nome', motivo: 'exato' });
    expect(acharCampo('category')).toEqual({ campo: 'categoria', motivo: 'exato' });
    // `phone` não casava nem por semelhança: contém `hone`, e não `fone`.
    expect(acharCampo('phone')).toEqual({ campo: 'whatsapp', motivo: 'exato' });
  });

  it('cid é o ID do lugar, e não a cidade', () => {
    expect(acharCampo('cid')).toEqual({ campo: 'place_id', motivo: 'exato' });
    expect(mapa.cidade).toBeUndefined();
  });

  it('"Endereço" deixa de cair em Site, e "Endereço na web" continua no Site', () => {
    expect(acharCampo('Endereço')).toEqual({ campo: 'endereco', motivo: 'exato' });
    expect(acharCampo('Endereço completo')).toEqual({ campo: 'endereco', motivo: 'exato' });
    expect(acharCampo('Endereço na web')).toEqual({ campo: 'site', motivo: 'exato' });
  });

  it('a linha vira objeto só com o que foi mapeado', () => {
    const valores = CABECALHO_DO_KIT.map((c) => `v_${c}`);
    const objeto = linhaParaObjeto(valores, mapa, 2);
    expect(objeto.place_id).toBe('v_cid');
    expect(objeto.email).toBe('v_emails');
    expect(objeto.endereco).toBe('v_address');
    expect(objeto.nota).toBe('v_review_rating');
    expect(objeto.avaliacoes_qtd).toBe('v_review_count');
    expect('facebook' in objeto).toBe(false);
    expect('linkedin' in objeto).toBe(false);
    const valoresEmitidos = Object.values(objeto);
    for (const proibida of [
      'v_facebook',
      'v_linkedin',
      'v_thumbnail',
      'v_user_reviews',
      'v_images',
    ]) {
      expect(valoresEmitidos).not.toContain(proibida);
    }
  });

  it('o CSV do kit não traz origem: ela vem do seletor do lote', () => {
    expect(faltando(mapa)).toEqual(['origem']);
  });
});

/**
 * Trava de regressão: isto JÁ é verdade hoje, e o passo 6.4 não pode quebrar.
 *
 * Cinco sinônimos novos entram num casador que faz uma passada exata e depois uma
 * por trecho. Um sinônimo curto demais rouba coluna alheia em silêncio, e o
 * sintoma só aparece quando alguém importa 600 linhas com o campo trocado. Estes
 * três testes passam antes e depois da mudança — é esse o ponto.
 */
describe('o que o cabeçalho do kit NÃO pode passar a casar', () => {
  const { mapa } = sugerirMapa(CABECALHO_DO_KIT);

  it('facebook não casa com nada, e nem linkedin nem reviews_link roubam o link do lugar', () => {
    expect(acharCampo('facebook')).toBeNull();
    // `linkedin` e `reviews_link` contêm `link`, então casam por SEMELHANÇA com
    // "detalhe da origem". Nenhum dos dois entra no mapa: `link` já tomou o campo
    // por nome exato, e `sugerirMapa` não deixa um acerto parecido substituir um
    // exato.
    expect(acharCampo('linkedin')).toEqual({ campo: 'origem_detalhe', motivo: 'parecido' });
    expect(acharCampo('reviews_link')).toEqual({ campo: 'origem_detalhe', motivo: 'parecido' });
    expect(mapa.origem_detalhe).toBe(CABECALHO_DO_KIT.indexOf('link'));
  });

  it('as colunas que a whitelist não recebe não viram campo nenhum', () => {
    const fora = [
      'plus_code',
      'latitude',
      'longitude',
      'descriptions',
      'about',
      'images',
      'thumbnail',
      'user_reviews',
      'price_range',
      'open_hours',
      'popular_times',
      'menu',
      'reservations',
      'timezone',
    ];
    expect(fora.map(acharCampo)).toEqual(fora.map(() => null));
  });

  it('status e owner não casam com nada: no Maps eles querem dizer outra coisa', () => {
    // Medido no primeiro CSV raspado de verdade (25/09/2026): `status` é
    // "Operacional" e `owner` é o nome do dono do negócio. Casavam por nome
    // exato com Etapa e Responsável e sujavam as vinte linhas com dois avisos
    // falsos cada. O banco nunca chutou — "Operacional" não vira etapa —, mas
    // aviso falso em toda linha esconde o aviso de verdade.
    expect(acharCampo('status')).toBeNull();
    expect(acharCampo('owner')).toBeNull();
    expect(mapa.etapa).toBeUndefined();
    expect(mapa.responsavel).toBeUndefined();
  });

  it('e a planilha-ponte continua casando os dois pelos nomes dela', () => {
    expect(acharCampo('etapa')).toEqual({ campo: 'etapa', motivo: 'exato' });
    expect(acharCampo('situacao')).toEqual({ campo: 'etapa', motivo: 'exato' });
    expect(acharCampo('responsavel')).toEqual({ campo: 'responsavel', motivo: 'exato' });
    expect(acharCampo('dono')).toEqual({ campo: 'responsavel', motivo: 'exato' });
  });
});

describe('a origem do lote entra na linha', () => {
  it('injeta o nome da fonte quando o arquivo não tem coluna de origem', () => {
    const mapa: Mapa = { nome: 0, categoria: 1, whatsapp: 2 };
    const objeto = linhaParaObjeto(
      ['Buffet Alegria', 'Buffet', '84 99999-0000'],
      mapa,
      2,
      'Google Maps (raspagem local)',
    );
    expect(objeto.origem).toBe('Google Maps (raspagem local)');
  });

  it('não mexe na linha quando o arquivo TEM coluna de origem', () => {
    const mapa: Mapa = { nome: 0, categoria: 1, origem: 2 };
    const objeto = linhaParaObjeto(
      ['Buffet Alegria', 'Buffet', 'Indicação'],
      mapa,
      2,
      'Google Maps (raspagem local)',
    );
    expect(objeto.origem).toBe('Indicação');
  });

  it('célula de origem vazia continua vazia: quem manda é a coluna', () => {
    const mapa: Mapa = { nome: 0, categoria: 1, origem: 2 };
    const objeto = linhaParaObjeto(
      ['Buffet Alegria', 'Buffet', ''],
      mapa,
      2,
      'Planilha (importação)',
    );
    expect('origem' in objeto).toBe(false);
  });

  it('sem origem escolhida, a linha sai como saía antes', () => {
    const mapa: Mapa = { nome: 0, categoria: 1 };
    expect('origem' in linhaParaObjeto(['A', 'B'], mapa, 2)).toBe(false);
    expect('origem' in linhaParaObjeto(['A', 'B'], mapa, 2, '   ')).toBe(false);
  });
});

describe('o obrigatório `origem`, com o seletor do lote', () => {
  it('a origem escolhida no lote resolve o obrigatório', () => {
    const mapa: Mapa = { nome: 0, categoria: 1 };
    expect(faltando(mapa)).toEqual(['origem']);
    expect(faltando(mapa, 'Google Maps (raspagem local)')).toEqual([]);
  });

  it('e não resolve nome nem categoria', () => {
    expect(faltando({}, 'Google Maps (raspagem local)')).toEqual(['nome', 'categoria']);
  });
});

/**
 * A trava contra a divergência silenciosa.
 *
 * `scripts/placar-importacao.sql` monta, em SQL, o MESMO objeto que
 * `linhaParaObjeto` monta no navegador — dez campos, lidos de dez colunas do
 * CSV do Maps. Se `sugerirMapa` passar a ler outra coluna, ou onze, ou nove, o
 * placar continua verde medindo outra coisa que não a tela. Estes dois testes
 * são o que impede isso: eles falham no dia em que a leitura mudar.
 *
 * Cabeçalho real de `listas/2026-09-25-fotografo-natal-rn.csv`, 36 colunas.
 */
const mapsFotografo = lerCsv(
  readFileSync(
    fileURLToPath(new URL('./fixtures/maps-natal-fotografo.csv', import.meta.url)),
    'utf8',
  ),
  'maps-natal-fotografo.csv',
);

describe('o CSV de 36 colunas do Google Maps', () => {
  it('casa exatamente 10 campos, todos por nome exato', () => {
    const { mapa, motivos } = sugerirMapa(mapsFotografo.cabecalho);
    expect(Object.keys(mapa).sort()).toEqual([
      'avaliacoes_qtd',
      'categoria',
      'email',
      'endereco',
      'nome',
      'nota',
      'origem_detalhe',
      'place_id',
      'site',
      'whatsapp',
    ]);
    expect(Object.values(motivos).filter((m) => m === 'parecido')).toEqual([]);
  });

  it('nas três disputas de coluna, ganha a certa', () => {
    const { mapa } = sugerirMapa(mapsFotografo.cabecalho);
    // `link` (1) vence `reviews_link` (18); `cid` (15) vence `place_id` (24);
    // `address` (4) vence `complete_address` (30). Medido, não suposto.
    expect(mapa.origem_detalhe).toBe(1);
    expect(mapa.place_id).toBe(15);
    expect(mapa.endereco).toBe(4);
  });
});

/**
 * A prévia e a gravação veem as MESMAS linhas.
 *
 * Em 25/09/2026 elas se separaram: a tela refazia a prévia sem o corte de "não
 * importar estas linhas" quando alguém corrigia a origem no "não é?", e então
 * prometia mais linhas do que o botão escrevia. Uma função pura, com `fora`
 * obrigatório, é o que impede o próximo argumento omitido.
 */
describe('montarLinhasDaPlanilha', () => {
  const planilhaDoMaps = lerCsv(
    readFileSync(
      fileURLToPath(new URL('./fixtures/maps-natal-fotografo.csv', import.meta.url)),
      'utf8',
    ),
    'fotografo.csv',
  );
  const mapaDoMaps = sugerirMapa(planilhaDoMaps.cabecalho).mapa;
  const MAPS = 'Google Maps (raspagem local)';

  it('sem corte, sai uma linha por linha com conteúdo', () => {
    const linhas = montarLinhasDaPlanilha(planilhaDoMaps, mapaDoMaps, MAPS, []);
    expect(linhas).toHaveLength(20);
    // O número é o do Excel: a linha 1 é o cabeçalho.
    expect(linhas[0]!.linha).toBe(2);
    expect(linhas[19]!.linha).toBe(21);
  });

  it('corta pelo NOME da categoria do arquivo, sem acento nem caixa', () => {
    const linhas = montarLinhasDaPlanilha(planilhaDoMaps, mapaDoMaps, MAPS, [
      'impressoes FOTOGRAFICAS',
    ]);
    expect(linhas).toHaveLength(18);
    expect(linhas.some((l) => String(l.categoria).toLowerCase().includes('impress'))).toBe(false);
    // E o número de linha das que sobraram NÃO é renumerado: quem procura no
    // Excel procura pelo número do Excel.
    expect(linhas[0]!.linha).toBe(2);
  });

  it('cortar dois nomes tira as linhas dos dois, e só elas', () => {
    const linhas = montarLinhasDaPlanilha(planilhaDoMaps, mapaDoMaps, MAPS, [
      'Impressões fotográficas',
      'Loja de artigos para fotografia',
    ]);
    expect(linhas).toHaveLength(16);
  });

  it('nome que não está no arquivo não corta nada', () => {
    expect(
      montarLinhasDaPlanilha(planilhaDoMaps, mapaDoMaps, MAPS, ['Floricultura']),
    ).toHaveLength(20);
  });

  it('a planilha-ponte, que traz a própria origem, passa inteira', () => {
    const mapa = sugerirMapa(planilha.cabecalho).mapa;
    const linhas = montarLinhasDaPlanilha(planilha, mapa, 'Planilha (importação)', []);
    expect(linhas).toHaveLength(planilha.linhas.length);
  });
});
