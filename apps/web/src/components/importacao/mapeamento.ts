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
const SINONIMOS: Record<CampoQualquer, string[]> = {
  nome: ['nome', 'nome fantasia', 'nome comercial', 'empresa', 'fornecedor', 'razao social', 'parceiro'],
  tipo: ['tipo', 'tipo de parceiro', 'natureza'],
  categoria: ['categoria', 'segmento', 'ramo', 'servico', 'especialidade'],
  whatsapp: ['whatsapp', 'whats', 'telefone', 'celular', 'fone', 'contato', 'tel', 'numero'],
  origem: ['origem', 'fonte', 'de onde veio', 'canal de origem'],
  origem_detalhe: ['origem detalhe', 'detalhe da origem', 'link', 'url', 'link de origem', 'perfil'],
  cidade: ['cidade', 'municipio', 'localidade'],
  bairro: ['bairro', 'regiao', 'zona'],
  instagram: ['instagram', 'insta', 'arroba', 'perfil instagram', 'ig'],
  etapa: ['etapa', 'estagio', 'status', 'fase', 'situacao'],
  responsavel: ['responsavel', 'dono', 'owner', 'quem falou', 'sdr', 'vendedor'],
  ultimo_contato: ['ultimo contato', 'data do ultimo contato', 'data contato', 'contato em'],
  canal_ultimo_contato: ['canal ultimo contato', 'canal', 'canal do contato', 'meio'],
  resultado: ['resultado', 'desfecho', 'retorno', 'o que aconteceu'],
  proxima_acao: ['proxima acao', 'next step', 'proximo passo', 'acao'],
  data_proxima_acao: ['data proxima acao', 'data da proxima acao', 'quando', 'prazo', 'follow up'],
  observacoes: ['observacoes', 'observacao', 'obs', 'notas', 'anotacoes', 'comentarios'],
  cnpj: ['cnpj', 'documento', 'cnpj mf'],
  site: ['site', 'website', 'pagina', 'endereco na web'],
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

/** Campos obrigatórios que o mapa ainda não cobre. */
export function faltando(mapa: Mapa): CampoQualquer[] {
  return CAMPOS_OBRIGATORIOS.filter((c) => mapa[c] === undefined);
}

/**
 * Uma linha da planilha vira o objeto que o banco entende.
 *
 * O número da linha vai junto (`linha`) e é o número REAL do arquivo, contando o
 * cabeçalho: quando a prévia disser "linha 47", a pessoa abre a planilha, vai na
 * 47 e vê o problema. Sem isso, a prévia obriga a contar linhas com o dedo.
 */
export function linhaParaObjeto(
  valores: string[],
  mapa: Mapa,
  numeroDaLinha: number,
): Record<string, string | number> {
  const objeto: Record<string, string | number> = { linha: numeroDaLinha };
  for (const campo of TODOS_OS_CAMPOS) {
    const indice = mapa[campo];
    if (indice === undefined) continue;
    const valor = (valores[indice] ?? '').trim();
    if (valor) objeto[campo] = valor;
  }
  return objeto;
}

/** Uma linha só tem conteúdo se algum campo MAPEADO tiver texto. */
export function temConteudo(valores: string[], mapa: Mapa): boolean {
  return Object.values(mapa).some(
    (indice) => indice !== undefined && (valores[indice] ?? '').trim() !== '',
  );
}
