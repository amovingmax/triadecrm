'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

/**
 * O texto que a pessoa digitou na caixa de resposta e ainda não enviou.
 *
 * ===========================================================================
 * O PROBLEMA
 * ===========================================================================
 * O texto morava num `useState` da caixa, e a conversa é remontada a cada troca
 * (`key` em `tela-conversas.tsx`): clicar em outra conversa apagava o que estava
 * escrito. Janio, 02/10/2026, com o print do WhatsApp mostrando "Rascunho: É
 * assim que deveri…": "quando eu saia de uma conversa a mensagem rascunho que eu
 * escrevi não seja apagada".
 *
 * Agora o texto mora aqui, por conversa: volta à caixa quando a pessoa reabre a
 * conversa, e a lista mostra "Rascunho:" na linha de quem tem texto por enviar.
 *
 * ===========================================================================
 * NÃO É O RASCUNHO DA IA, E NÃO É BANCO
 * ===========================================================================
 * No código, "rascunho" é o que a IA redige e alguém aprova (`message_drafts`,
 * a aba "Aprovar"). Isto aqui é outra coisa — o que a PESSOA digitou —, e por
 * isso o arquivo e as funções dizem "texto digitado". Na tela a palavra é
 * "Rascunho", que é a que o time conhece do WhatsApp.
 *
 * Nada disto vai ao banco nem ao WhatsApp. O texto fica no navegador, com chave
 * por pessoa (o aparelho de campo passa de mão em mão), e só sai quando alguém
 * aperta Enviar — pelo mesmo caminho de sempre (`acoes.ts`, `responder`). O
 * preço é o texto não atravessar aparelhos: o que foi digitado no computador
 * não aparece no celular.
 */

const CHAVE = 'komune.conversas.digitado.v1';

/** Quantos textos por enviar o aparelho guarda. Passou disso, saem os mais antigos. */
export const TETO_DE_TEXTOS = 100;

/** Texto esquecido há mais tempo que isto some sozinho. */
export const VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;

/** Quantos caracteres do texto a lista mostra depois de "Rascunho:". */
const TAMANHO_DA_PREVIA = 80;

export interface TextoDigitado {
  readonly texto: string;
  /** Quando foi mexido pela última vez (relógio do aparelho): só ordena e expira. */
  readonly em: number;
}

export type TextosDigitados = ReadonlyMap<string, TextoDigitado>;

const NENHUM: TextosDigitados = new Map();

// ---------- a parte pura ----------

/**
 * Os textos com o de uma conversa trocado. Texto vazio apaga a entrada: caixa
 * limpa não é rascunho. O texto em si é guardado como foi digitado, com os
 * espaços — a caixa é um campo controlado, e aparar aqui comeria o espaço que a
 * pessoa acabou de digitar.
 */
export function comTexto(
  textos: TextosDigitados,
  fioId: string,
  texto: string,
  agora: number,
): TextosDigitados {
  const novos = new Map(textos);
  if (texto.length === 0) novos.delete(fioId);
  else novos.set(fioId, { texto, em: agora });
  return aparar(novos, agora);
}

/** Tira o que venceu e, passando do teto, o que foi mexido há mais tempo. */
export function aparar(textos: TextosDigitados, agora: number): TextosDigitados {
  const validos = [...textos].filter(([, t]) => agora - t.em <= VALIDADE_MS);
  if (validos.length === textos.size && validos.length <= TETO_DE_TEXTOS) return textos;
  validos.sort(([, a], [, b]) => b.em - a.em);
  return new Map(validos.slice(0, TETO_DE_TEXTOS));
}

/**
 * O que está guardado no aparelho, lido com desconfiança: texto estragado, de
 * outra versão ou mexido à mão vira "nada guardado", que é o erro barato.
 */
export function lerGuardado(json: string | null, agora: number): TextosDigitados {
  if (json === null) return NENHUM;
  try {
    const lido: unknown = JSON.parse(json);
    if (lido === null || typeof lido !== 'object' || Array.isArray(lido)) return NENHUM;
    const textos = new Map<string, TextoDigitado>();
    for (const [fioId, valor] of Object.entries(lido)) {
      if (valor === null || typeof valor !== 'object') continue;
      const { texto, em } = valor as { texto?: unknown; em?: unknown };
      if (typeof texto === 'string' && texto.length > 0 && typeof em === 'number') {
        textos.set(fioId, { texto, em });
      }
    }
    return aparar(textos, agora);
  } catch {
    return NENHUM;
  }
}

export function paraGuardar(textos: TextosDigitados): string | null {
  return textos.size === 0 ? null : JSON.stringify(Object.fromEntries(textos));
}

/**
 * O que a lista mostra depois de "Rascunho:": o começo do texto, numa linha só.
 * `null` quando só há espaços — isso não é rascunho, é um toque na barra.
 */
export function previaDoDigitado(texto: string | null | undefined): string | null {
  const limpo = texto?.replace(/\s+/g, ' ').trim();
  if (!limpo) return null;
  return limpo.length > TAMANHO_DA_PREVIA
    ? `${limpo.slice(0, TAMANHO_DA_PREVIA - 1).trimEnd()}…`
    : limpo;
}

// ---------- o que mora no aparelho ----------

/**
 * Quem está digitando. `null` enquanto a tela não sabe (ou fora da tela de
 * Conversas): aí o texto vale só enquanto a página está aberta, e não é gravado
 * — texto sem dono no aparelho apareceria para a próxima pessoa que entrasse.
 */
export const DonoDoTextoDigitado = createContext<string | null>(null);

/**
 * Diz à tela de Conversas quem está digitando. Quem sabe é a página, no
 * servidor (`app/(app)/conversas/page.tsx`), que já leu a sessão.
 */
export function ProvedorDoTextoDigitado({
  dono,
  children,
}: {
  dono: string | null;
  children: ReactNode;
}) {
  return createElement(DonoDoTextoDigitado.Provider, { value: dono }, children);
}

const SEM_DONO = '';
const porDono = new Map<string, TextosDigitados>();
const ouvintes = new Set<() => void>();

function chaveDe(dono: string): string {
  return `${CHAVE}:${dono}`;
}

function textosDe(dono: string | null): TextosDigitados {
  const quem = dono ?? SEM_DONO;
  const emMemoria = porDono.get(quem);
  if (emMemoria) return emMemoria;

  let lidos = NENHUM;
  if (dono !== null) {
    try {
      lidos = lerGuardado(window.localStorage.getItem(chaveDe(dono)), Date.now());
    } catch {
      // Aba anônima ou armazenamento bloqueado: vale só a memória.
    }
  }
  porDono.set(quem, lidos);
  return lidos;
}

function guardar(dono: string | null, textos: TextosDigitados): void {
  porDono.set(dono ?? SEM_DONO, textos);
  if (dono !== null) {
    try {
      const json = paraGuardar(textos);
      if (json === null) window.localStorage.removeItem(chaveDe(dono));
      else window.localStorage.setItem(chaveDe(dono), json);
    } catch {
      // Sem armazenamento o texto não sobrevive à recarga; continua na memória.
    }
  }
  for (const ouvinte of ouvintes) ouvinte();
}

/**
 * Outra aba mexeu: a memória daqui está velha, e a próxima leitura vai ao
 * aparelho. Um ouvinte só para a página inteira — um por linha da lista
 * esvaziaria a memória cem vezes para a mesma mudança.
 */
function aoGuardarEmOutraAba(evento: StorageEvent): void {
  if (evento.key !== null && !evento.key.startsWith(CHAVE)) return;
  for (const quem of [...porDono.keys()]) if (quem !== SEM_DONO) porDono.delete(quem);
  for (const ouvinte of ouvintes) ouvinte();
}

function inscrever(ouvinte: () => void): () => void {
  if (ouvintes.size === 0) window.addEventListener('storage', aoGuardarEmOutraAba);
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
    if (ouvintes.size === 0) window.removeEventListener('storage', aoGuardarEmOutraAba);
  };
}

const noServidor = (): TextosDigitados => NENHUM;

/** Todos os textos por enviar desta pessoa: é o que a lista consulta. */
export function useTextosDigitados(): TextosDigitados {
  const dono = useContext(DonoDoTextoDigitado);
  return useSyncExternalStore(inscrever, () => textosDe(dono), noServidor);
}

/**
 * O texto da caixa de UMA conversa, e como mudá-lo. No lugar do `useState` que
 * a caixa tinha: mesma forma, mas o texto sobrevive à troca de conversa.
 * `fioId` nulo (ficha sem conversa) devolve sempre vazio.
 */
export function useTextoDigitado(fioId: string | null): [string, (texto: string) => void] {
  const dono = useContext(DonoDoTextoDigitado);
  const textos = useSyncExternalStore(inscrever, () => textosDe(dono), noServidor);
  const mudar = useCallback(
    (texto: string) => {
      if (fioId === null) return;
      guardar(dono, comTexto(textosDe(dono), fioId, texto, Date.now()));
    },
    [dono, fioId],
  );
  return [fioId === null ? '' : (textos.get(fioId)?.texto ?? ''), mudar];
}

/**
 * A mensagem entrou na fila: o texto daquela conversa deixa de ser rascunho.
 *
 * Função solta, e não um efeito da caixa, porque é chamada de dentro do envio:
 * se a pessoa trocar de conversa antes de a fila responder, a caixa já saiu da
 * tela — e o texto enviado NÃO pode ficar guardado, ou voltaria à caixa como
 * rascunho e alguém mandaria a mesma mensagem duas vezes.
 */
export function esquecerTextoDigitado(dono: string | null, fioId: string): void {
  guardar(dono, comTexto(textosDe(dono), fioId, '', Date.now()));
}
