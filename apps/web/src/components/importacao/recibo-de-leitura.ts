/**
 * O que o CRM leu no cabeçalho, dito como recibo e não como formulário.
 *
 * POR QUÊ, e é medido: o CSV do Google Maps tem 36 colunas, e o passo do mapa
 * pedia confirmação de 36 caixinhas para mostrar 10 acertos que a máquina já
 * tinha feito — todos por NOME EXATO, nenhum por semelhança. Em 25/09/2026 o
 * Rafael escreveu "ta bem tosco e poluido". Uma parede de 36 cartões não é
 * conferência: é onde o aviso de verdade se esconde.
 *
 * A regra: o recibo afirma o que foi lido; a pergunta só existe onde há dúvida.
 * Dúvida é uma de duas coisas, e só:
 *   · campo OBRIGATÓRIO que não foi achado — sem ele não há como criar o
 *     parceiro, e a pessoa precisa apontar a coluna;
 *   · coluna que casou por SEMELHANÇA (`parecido`) — um "telefone 2" que virou
 *     WhatsApp é exatamente o erro que passa despercebido quando a tela diz
 *     "pronto".
 *
 * Disputa de coluna NÃO é dúvida. No CSV do Maps há três (`link` × `reviews_link`,
 * `cid` × `place_id`, `address` × `complete_address`) e nas três a coluna certa
 * ganha — está medido em `mapeamento.test.ts`. Perguntar aqui seria pedir três
 * confirmações inúteis por arquivo. Disputa vira linha na lista dos ignorados,
 * com o motivo escrito.
 *
 * Módulo puro: sem React, sem banco.
 */
import { chave, faltando, type Sugestao } from './mapeamento';
import {
  rotuloDoCampo,
  TODOS_OS_CAMPOS,
  type CampoQualquer,
  type Mapa,
  type PlanilhaLida,
} from './tipos';

/** Uma coluna que o CRM leu, e o campo em que ela caiu. */
export type ColunaLida = {
  campo: CampoQualquer;
  rotulo: string;
  /** Título da coluna como está escrito no arquivo. */
  titulo: string;
  indice: number;
  /**
   * A coluna existe e está vazia em TODAS as linhas lidas.
   *
   * Dizer isso é o que evita o chamado: no CSV do Maps a coluna `emails` vem
   * vazia nas vinte linhas, e um recibo que anuncia "E-mail" sem ressalva
   * parece bug quando a ficha nasce sem e-mail.
   */
  vazia: boolean;
  /** Casou por semelhança: a pessoa confere. */
  chutado: boolean;
};

/** Uma coluna que o CRM não usa, e por quê — quando há um porquê que valha dizer. */
export type ColunaIgnorada = { titulo: string; indice: number; motivo?: string };

export type ReciboDeLeitura = {
  lidas: ColunaLida[];
  /** Só as que casaram por semelhança. Subconjunto de `lidas`. */
  chutadas: ColunaLida[];
  /** Campos obrigatórios que nenhuma coluna cobriu. */
  pendentes: CampoQualquer[];
  ignoradas: ColunaIgnorada[];
  totalDeColunas: number;
  /**
   * Existe pergunta a fazer? Quando não existe, o passo do mapa não precisa
   * acontecer: o recibo aparece junto da prévia e a pessoa vê tudo de uma vez.
   */
  precisaPerguntar: boolean;
};

/**
 * Colunas cuja ausência do mapa tem uma explicação que poupa um chamado.
 *
 * `place_id` é a que importa: o CSV do Maps tem uma coluna com esse nome, e ela
 * NÃO é o que o CRM chama de `place_id` — o CRM guarda o `cid` (ADR-12), que é
 * a identidade estável do lugar no Maps. Sem esta linha, quem confere vê a
 * coluna `place_id` ignorada e conclui que o CRM perdeu o identificador.
 */
const PORQUE_IGNORADA: Record<string, string> = {
  'place id': 'o place_id da Places API não é o cid do Maps (ADR-12) — o CRM leu a coluna cid',
  'reviews link': 'o link das avaliações; o CRM guardou o link do lugar, da coluna link',
  'complete address': 'endereço repetido; o CRM leu a coluna address',
};

export function montarReciboDeLeitura(
  planilha: PlanilhaLida,
  mapa: Mapa,
  sugestao: Sugestao,
  origemDoLote?: string,
): ReciboDeLeitura {
  const porColuna = new Map<number, CampoQualquer>();
  for (const campo of TODOS_OS_CAMPOS) {
    const indice = mapa[campo];
    if (indice !== undefined) porColuna.set(indice, campo);
  }

  const lidas: ColunaLida[] = [];
  const ignoradas: ColunaIgnorada[] = [];

  planilha.cabecalho.forEach((titulo, indice) => {
    const campo = porColuna.get(indice);
    if (campo === undefined) {
      ignoradas.push({ titulo, indice, motivo: PORQUE_IGNORADA[chave(titulo)] });
      return;
    }
    lidas.push({
      campo,
      rotulo: rotuloDoCampo(campo),
      titulo,
      indice,
      vazia: planilha.linhas.every((l) => (l[indice] ?? '').trim() === ''),
      // O motivo é do CAMPO, e não da coluna: `sugerirMapa` guarda por campo, e
      // uma coluna só está no mapa se foi ela que ganhou aquele campo.
      chutado: sugestao.motivos[campo] === 'parecido',
    });
  });

  // A ordem do recibo é a de leitura dos campos, e não a do arquivo: quem lê
  // quer ver "Nome · WhatsApp · Categoria", e não a ordem em que o Google
  // resolveu exportar as colunas.
  const ordem = new Map(TODOS_OS_CAMPOS.map((c, i) => [c, i]));
  lidas.sort((a, b) => (ordem.get(a.campo) ?? 0) - (ordem.get(b.campo) ?? 0));

  const pendentes = faltando(mapa, origemDoLote);
  const chutadas = lidas.filter((l) => l.chutado);

  return {
    lidas,
    chutadas,
    pendentes,
    ignoradas,
    totalDeColunas: planilha.cabecalho.length,
    precisaPerguntar: pendentes.length > 0 || chutadas.length > 0,
  };
}

/** O rótulo com a ressalva da coluna vazia, que é o que vai à tela. */
export function rotuloComRessalva(coluna: ColunaLida): string {
  return coluna.vazia ? `${coluna.rotulo} (vazia no arquivo)` : coluna.rotulo;
}
