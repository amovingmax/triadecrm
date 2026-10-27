import { textoSemMarcas } from './conteudo';
import type { MensagemDoFio } from './tipos';

/**
 * A lupa DENTRO da conversa (27/10/2026): procura no que já está carregado, sem
 * ida ao banco. A conversa de parceiro vem inteira; a de cliente, as 200 mais
 * recentes. Procurar no banco inteiro é a busca da lista (`conversas_buscar`).
 *
 * Sem acento e sem maiúscula, como o resto da casa, e o destaque cai no trecho
 * ORIGINAL: quem procura "joao" vê "João" marcado, não "joao".
 */

/** Menos que isto acende metade do fio e não ajuda ninguém a achar nada. */
export const MINIMO_DA_BUSCA = 2;

function semAcento(c: string): string {
  return c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * O texto normalizado e, para cada caractere dele, a posição no original. É o
 * que deixa o destaque voltar ao texto com acento.
 */
function normalizarComMapa(texto: string): { normal: string; origem: number[] } {
  let normal = '';
  const origem: number[] = [];
  for (let i = 0; i < texto.length; i += 1) {
    const base = semAcento(texto.charAt(i));
    for (const c of base) {
      normal += c;
      origem.push(i);
    }
  }
  return { normal, origem };
}

/** O que da mensagem a lupa olha: o texto, a transcrição e o nome do arquivo. */
function textoDaBusca(m: MensagemDoFio): string {
  return [
    textoSemMarcas(m.texto),
    m.transcricao,
    m.midiaNome,
    m.conteudo.localizacao?.nome,
    m.conteudo.localizacao?.endereco,
    ...m.conteudo.contatos.map((c) => c.nome),
  ]
    .filter(Boolean)
    .join(' \n ');
}

/** Os ids das mensagens que batem, na ordem do fio. A apagada no CRM não entra. */
export function achadosNoFio(mensagens: readonly MensagemDoFio[], termo: string): string[] {
  const procura = semAcento(termo.trim());
  if (procura.length < MINIMO_DA_BUSCA) return [];
  return mensagens
    .filter((m) => m.apagadaEm === null && semAcento(textoDaBusca(m)).includes(procura))
    .map((m) => m.id);
}

export type Parte = { texto: string; destaque: boolean };

/** O texto em pedaços, com os trechos que batem marcados. */
export function partesDestacadas(texto: string, termo: string): Parte[] {
  const procura = semAcento(termo.trim());
  if (procura.length < MINIMO_DA_BUSCA || texto === '') return [{ texto, destaque: false }];
  const { normal, origem } = normalizarComMapa(texto);
  const partes: Parte[] = [];
  let cursor = 0;
  let desde = 0;
  for (;;) {
    const achado = normal.indexOf(procura, desde);
    if (achado < 0) break;
    const inicio = origem[achado] ?? texto.length;
    const ultimo = origem[achado + procura.length - 1] ?? texto.length - 1;
    const fim = ultimo + 1;
    if (inicio > cursor) partes.push({ texto: texto.slice(cursor, inicio), destaque: false });
    partes.push({ texto: texto.slice(inicio, fim), destaque: true });
    cursor = fim;
    desde = achado + procura.length;
  }
  if (cursor < texto.length) partes.push({ texto: texto.slice(cursor), destaque: false });
  return partes.length ? partes : [{ texto, destaque: false }];
}
