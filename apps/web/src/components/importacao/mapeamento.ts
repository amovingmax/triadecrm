/**
 * De cabeçalho de planilha para campo do CRM.
 *
 * A tela SUGERE e a pessoa corrige — nesta ordem, e não o contrário. A sugestão
 * erra quando a planilha não é a planilha-ponte (e ela quase nunca é: cada
 * diretório exporta com um nome), então a correção não é um "modo avançado", é o
 * caminho normal. O que esta função não pode fazer é adivinhar em silêncio:
 * cada acerto vem com o motivo (`exato` ou `parecido`), e a tela mostra qual foi.
 *
 * Módulo puro: sem React, sem banco.
 */
import {
  CAMPOS_OBRIGATORIOS,
  TODOS_OS_CAMPOS,
  type CampoQualquer,
  type Mapa,
  type PlanilhaLida,
} from './tipos';

/** Sem acento, sem caixa, sem pontuação e sem o `*` de obrigatório da planilha-ponte. */
export function chave(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Como cada campo costuma se chamar por aí. A primeira entrada é o nome canônico
 * da planilha-ponte; as outras são o que já apareceu nas exportações que o time
 * usa (Google Sheets em português, Casamentos, TeleListas, Solutudo).
 */
/**
 * `status` e `owner` NÃO entram aqui, e a ausência é deliberada (25/09/2026).
 *
 * Os dois pareciam sinônimos razoáveis de `etapa` e `responsavel` numa planilha
 * de CRM em inglês. Só que o único arquivo real que traz essas duas colunas é o
 * CSV do Google Maps, e lá elas querem dizer outra coisa: `status` é
 * "Operacional" (o negócio está aberto) e `owner` é o nome do DONO DO NEGÓCIO,
 * uma pessoa física de fora da equipe. Medido no primeiro CSV raspado de
 * verdade: as duas casavam por nome exato nas vinte linhas.
 *
 * O banco não chuta — "Operacional" não vira etapa nenhuma e o nome do dono não
 * vira responsável —, então não havia corrupção de dado. Havia coisa pior para
 * quem opera: dois avisos falsos em TODA linha, e aviso falso esconde aviso de
 * verdade. A planilha-ponte não perde nada: ela chama as colunas de `etapa` e
 * `responsavel`, e `situacao`, `fase`, `dono` e `vendedor` continuam valendo.
 */
const SINONIMOS: Record<CampoQualquer, string[]> = {
  nome: ['nome', 'nome fantasia', 'nome comercial', 'empresa', 'fornecedor', 'razao social', 'parceiro', 'title'],
  tipo: ['tipo', 'tipo de parceiro', 'natureza'],
  categoria: ['categoria', 'segmento', 'ramo', 'servico', 'especialidade', 'category'],
  whatsapp: ['whatsapp', 'whats', 'telefone', 'celular', 'fone', 'contato', 'tel', 'numero', 'phone'],
  origem: ['origem', 'fonte', 'de onde veio', 'canal de origem'],
  origem_detalhe: ['origem detalhe', 'detalhe da origem', 'link', 'url', 'link de origem', 'perfil'],
  cidade: ['cidade', 'municipio', 'localidade'],
  bairro: ['bairro', 'regiao', 'zona'],
  instagram: ['instagram', 'insta', 'arroba', 'perfil instagram', 'ig'],
  etapa: ['etapa', 'estagio', 'fase', 'situacao'],
  responsavel: ['responsavel', 'dono', 'quem falou', 'sdr', 'vendedor'],
  ultimo_contato: ['ultimo contato', 'data do ultimo contato', 'data contato', 'contato em'],
  canal_ultimo_contato: ['canal ultimo contato', 'canal', 'canal do contato', 'meio'],
  resultado: ['resultado', 'desfecho', 'retorno', 'o que aconteceu'],
  proxima_acao: ['proxima acao', 'next step', 'proximo passo', 'acao'],
  data_proxima_acao: ['data proxima acao', 'data da proxima acao', 'quando', 'prazo', 'follow up'],
  observacoes: ['observacoes', 'observacao', 'obs', 'notas', 'anotacoes', 'comentarios'],
  cnpj: ['cnpj', 'documento', 'cnpj mf'],
  site: ['site', 'website', 'pagina', 'endereco na web'],
  place_id: ['place id', 'cid', 'id do lugar', 'google cid'],
  email: ['email', 'e mail', 'emails', 'e mails', 'correio eletronico'],
  endereco: ['endereco', 'address', 'endereco completo', 'logradouro'],
  nota: ['nota', 'review rating', 'nota google', 'avaliacao google', 'estrelas'],
  avaliacoes_qtd: ['avaliacoes qtd', 'review count', 'avaliacoes', 'qtd de avaliacoes', 'numero de avaliacoes'],
};

const CHAVES: Array<{ campo: CampoQualquer; chaves: string[] }> = TODOS_OS_CAMPOS.map((campo) => ({
  campo,
  chaves: SINONIMOS[campo].map(chave),
}));

export type Acerto = { campo: CampoQualquer; motivo: 'exato' | 'parecido' };

/** Qual campo esta coluna parece ser, e com que confiança. */
export function acharCampo(cabecalho: string): Acerto | null {
  const k = chave(cabecalho);
  if (!k) return null;

  for (const { campo, chaves } of CHAVES) {
    if (chaves.includes(k)) return { campo, motivo: 'exato' };
  }
  // Só depois de esgotar o exato: "data da próxima ação" contém "acao", e casar
  // por trecho antes da hora mandaria a data para a coluna errada.
  for (const { campo, chaves } of CHAVES) {
    for (const c of chaves) {
      if (c.length >= 4 && (k.includes(c) || c.includes(k))) return { campo, motivo: 'parecido' };
    }
  }
  return null;
}

export type Sugestao = { mapa: Mapa; motivos: Partial<Record<CampoQualquer, 'exato' | 'parecido'>> };

/**
 * Mapa sugerido para um cabeçalho inteiro.
 *
 * Uma coluna nunca rouba um campo já preenchido por um acerto EXATO: numa planilha
 * com "telefone" e "telefone 2", a segunda não pode substituir a primeira.
 */
export function sugerirMapa(cabecalho: string[]): Sugestao {
  const mapa: Mapa = {};
  const motivos: Partial<Record<CampoQualquer, 'exato' | 'parecido'>> = {};

  cabecalho.forEach((titulo, indice) => {
    const acerto = acharCampo(titulo);
    if (!acerto) return;
    const jaTem = motivos[acerto.campo];
    if (jaTem === 'exato') return;
    if (jaTem === 'parecido' && acerto.motivo === 'parecido') return;
    mapa[acerto.campo] = indice;
    motivos[acerto.campo] = acerto.motivo;
  });

  return { mapa, motivos };
}

/** A origem escolhida no seletor do lote, sem espaço em volta. Vazio = nenhuma. */
function origemDoLoteLimpa(origemDoLote?: string): string {
  return (origemDoLote ?? '').trim();
}

/**
 * Campos obrigatórios que o mapa ainda não cobre.
 *
 * `origemDoLote` é o nome da fonte escolhida no seletor da tela. Com ela,
 * `origem` deixa de ser pendência do ARQUIVO: a linha ganha a origem do lote em
 * `linhaParaObjeto`, e a exigência de LGPD continua cumprida — só que pelo
 * seletor, e não por uma coluna que o CSV do Maps não tem.
 */
export function faltando(mapa: Mapa, origemDoLote?: string): CampoQualquer[] {
  const doLote = origemDoLoteLimpa(origemDoLote);
  return CAMPOS_OBRIGATORIOS.filter(
    (c) => mapa[c] === undefined && !(c === 'origem' && doLote !== ''),
  );
}

/**
 * Uma linha da planilha vira o objeto que o banco entende.
 *
 * O número da linha vai junto (`linha`) e é o número REAL do arquivo, contando o
 * cabeçalho: quando a prévia disser "linha 47", a pessoa abre a planilha, vai na
 * 47 e vê o problema. Sem isso, a prévia obriga a contar linhas com o dedo.
 *
 * `origemDoLote` é o nome da fonte escolhida no seletor. Ela entra só quando o
 * ARQUIVO não tem coluna de origem. Na planilha-ponte a coluna existe e continua
 * mandando — inclusive quando a célula está vazia: ali o vazio é um dado (quem
 * preencheu não soube dizer de onde veio), e carimbá-lo com o nome do lote
 * inventaria uma proveniência.
 */
export function linhaParaObjeto(
  valores: string[],
  mapa: Mapa,
  numeroDaLinha: number,
  origemDoLote?: string,
): Record<string, string | number> {
  const objeto: Record<string, string | number> = { linha: numeroDaLinha };
  for (const campo of TODOS_OS_CAMPOS) {
    const indice = mapa[campo];
    if (indice === undefined) continue;
    const valor = (valores[indice] ?? '').trim();
    if (valor) objeto[campo] = valor;
  }
  const doLote = origemDoLoteLimpa(origemDoLote);
  if (mapa.origem === undefined && doLote !== '') objeto.origem = doLote;
  return objeto;
}

/** Uma linha só tem conteúdo se algum campo MAPEADO tiver texto. */
export function temConteudo(valores: string[], mapa: Mapa): boolean {
  return Object.values(mapa).some(
    (indice) => indice !== undefined && (valores[indice] ?? '').trim() !== '',
  );
}

/**
 * A planilha inteira virando as linhas que vão ao banco — uma vez, para a
 * prévia e para a gravação.
 *
 * POR QUE EXISTE COMO FUNÇÃO PURA, e não como um laço dentro da tela: a prévia
 * e o gravar precisam ver EXATAMENTE as mesmas linhas. Em 25/09/2026 eles se
 * separaram por um argumento omitido — a tela refazia a prévia sem o corte de
 * "não importar estas linhas" quando alguém corrigia a origem no "não é?", e
 * então prometia mais linhas do que o botão escrevia. Com uma função só, e sem
 * valor padrão para `fora`, a divergência vira erro de compilação.
 *
 * `fora` são NOMES DE CATEGORIA do arquivo, e não números de linha: a pessoa
 * respondeu "não importar estas linhas" para um nome, na tela de resolver. A
 * linha cortada NÃO SAI DO NAVEGADOR — não vira `raw_capture`, não vira
 * candidato e não deixa rastro, porque nunca entrou. É o mesmo que apagar a
 * linha do arquivo antes de mandar, e é por isso que não fere o ADR-08.
 */
export function montarLinhasDaPlanilha(
  planilha: PlanilhaLida,
  mapa: Mapa,
  origemDoLote: string,
  fora: readonly string[],
): Array<Record<string, string | number>> {
  const cortadas = new Set(fora.map((n) => chave(n)));
  const saida: Array<Record<string, string | number>> = [];
  planilha.linhas.forEach((valores, i) => {
    if (!temConteudo(valores, mapa)) return;
    const daColuna = mapa.categoria === undefined ? '' : (valores[mapa.categoria] ?? '');
    if (cortadas.size > 0 && cortadas.has(chave(daColuna))) return;
    // +2: a linha 1 é o cabeçalho e a contagem da planilha começa em 1. Assim o
    // número que a prévia mostra é o número que a pessoa vê no Excel.
    saida.push(linhaParaObjeto(valores, mapa, i + 2, origemDoLote));
  });
  return saida;
}
