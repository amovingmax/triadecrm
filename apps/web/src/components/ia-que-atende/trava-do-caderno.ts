/**
 * A trava do caderno (Imova, 27/11/2026): nota que faria a IA parar não entra.
 *
 * O caderno vai em toda resposta da IA. Um trecho sem letra com 10 ou mais algarismos (a
 * FICHA 4 com "1.338,99, 2.021", em 19/11), um e-mail ou um @ parecem dado pessoal para a
 * conferência da chamada, e a IA parou com todos os clientes por 40 minutos. O banco recusa
 * (`app.ia_caderno_problema`, migração 20261127200000); aqui a mesma regra avisa antes do
 * clique, mostrando o trecho e como reescrever.
 */

export interface ProblemaDoCaderno {
  readonly tipo: 'telefone' | 'contato';
  readonly trecho: string;
}

const LETRAS = /[A-Za-zÀ-ÖØ-öø-ÿ]+/;
const COM_ARROBA = /[^\s@]*@[^\s@]*/;
const INSTAGRAM = /(?:www\.)?instagram\.com\/\S*/i;

/** O que faria a IA parar (nulo = pode salvar). A mesma regra de `app.ia_caderno_problema`. */
export function problemaDoCaderno(texto: string): ProblemaDoCaderno | null {
  const arroba = COM_ARROBA.exec(texto);
  if (arroba !== null) return { tipo: 'contato', trecho: arroba[0].slice(0, 60) };
  const instagram = INSTAGRAM.exec(texto);
  if (instagram !== null) return { tipo: 'contato', trecho: instagram[0].slice(0, 60) };
  for (const parte of texto.split(LETRAS)) {
    if (parte.replace(/[^0-9]/g, '').length >= 10) {
      return { tipo: 'telefone', trecho: parte.replace(/^[\s.,;:()[\]\-/]+|[\s.,;:()[\]\-/]+$/g, '').slice(0, 60) };
    }
  }
  return null;
}

/** A frase para a pessoa: o trecho e como reescrever. */
export function fraseDaTrava(problema: { tipo?: string | null; trecho?: string | null }): string {
  const trecho = problema.trecho ? `“${problema.trecho}”` : 'Um trecho';
  if (problema.tipo === 'contato') {
    return `${trecho} parece e-mail ou @, e faria a IA parar de responder os clientes. Tire o contato da nota.`;
  }
  return (
    `${trecho} parece telefone para a IA (são 10 ou mais algarismos sem palavra no meio), e ela pararia ` +
    'de responder os clientes. Separe os números com palavras, por exemplo “1.338,99 m² e 2.021 m²”.'
  );
}
