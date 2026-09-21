/**
 * As respostas prontas da caixa de resposta (Fase 3): digitar "/" oferece os
 * atalhos; escolher troca o "/atalho" pelo texto. A regra de texto é pura para
 * ser testada sem tela.
 */
export type RespostaPronta = { id: number; atalho: string; titulo: string; texto: string };

/** O "/algo" que a pessoa está digitando no FIM do texto, ou `null`. */
export function atalhoEmDigitacao(texto: string): string | null {
  const m = /(?:^|\s)\/([a-z0-9_-]*)$/i.exec(texto);
  return m ? (m[1] ?? '').toLowerCase() : null;
}

/** As respostas que batem com o que foi digitado depois da barra. */
export function respostasQueBatem(respostas: readonly RespostaPronta[], busca: string): RespostaPronta[] {
  const b = busca.toLowerCase();
  return respostas
    .filter((r) => r.atalho.startsWith(b) || r.titulo.toLowerCase().includes(b))
    .slice(0, 6);
}

/** Troca o "/atalho" do fim do texto pela resposta escolhida. */
export function aplicarResposta(texto: string, resposta: RespostaPronta): string {
  return texto.replace(/(^|\s)\/[a-z0-9_-]*$/i, (_m, antes: string) => `${antes}${resposta.texto}`);
}
