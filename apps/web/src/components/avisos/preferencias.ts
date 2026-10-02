'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { maisRecente, semOQueOPisoCobre } from './regra';

/**
 * O que o aviso de resposta guarda no aparelho, por pessoa.
 *
 * Quatro coisas, e nenhuma é dado de parceiro:
 *   - `silenciado`  a pessoa pediu para não ser avisada. Ausente = avisar, que é
 *                   o padrão: o aviso nasce ligado.
 *   - `visto`       o piso: a chegada abaixo da qual nada mais conta. Nasce na
 *                   última chegada de quando a pessoa usou o CRM pela primeira
 *                   vez neste navegador, e só anda quando o que ficou para trás
 *                   já foi aberto (`pisoPossivel`, em `regra.ts`).
 *   - `abertas`     por conversa, até que chegada ela foi aberta. É o que faz o
 *                   número do menu cair de 5 para 4 quando a pessoa abre uma.
 *                   Guarda só ids de conversa e carimbos de hora.
 *   - `convite`     ela dispensou o convite de ligar as notificações do navegador.
 *
 * POR QUE NO APARELHO, E NÃO NO BANCO. A permissão de notificação já é do
 * navegador, não da pessoa: liberar no computador não libera no celular. Guardar
 * o resto no mesmo lugar deixa a entrega sem migração nenhuma. O preço é o
 * "aberta" não atravessar aparelhos — abrir uma conversa no computador não tira
 * a marca dela no celular.
 *
 * A chave leva o dono, como a fila offline do registro: o celular de campo passa
 * de mão em mão, e o "silenciado" de uma pessoa não pode calar a seguinte.
 *
 * Como em `registro/usar-ultima-superficie.ts`, a leitura é um
 * `useSyncExternalStore`: o servidor renderiza o padrão, o cliente lê o aparelho,
 * e não há setState em efeito nem divergência de hidratação.
 */

const CHAVES = {
  silenciado: 'komune.avisos.silenciado.v1',
  visto: 'komune.avisos.visto.v1',
  abertas: 'komune.avisos.abertas.v1',
  convite: 'komune.avisos.convite.v1',
} as const;

type Campo = keyof typeof CHAVES;

function chave(campo: Campo, usuarioId: string): string {
  return `${CHAVES[campo]}:${usuarioId}`;
}

/** A chave do piso de uma pessoa: é por ela que uma aba sabe que a outra andou. */
export function chaveDoVisto(usuarioId: string): string {
  return chave('visto', usuarioId);
}

/** A chave das conversas abertas: é por ela que uma aba sabe que a outra abriu uma. */
export function chaveDasAbertas(usuarioId: string): string {
  return chave('abertas', usuarioId);
}

function ler(campo: Campo, usuarioId: string): string | null {
  try {
    return window.localStorage.getItem(chave(campo, usuarioId));
  } catch {
    // Aba anônima, cota cheia ou armazenamento bloqueado: vale o padrão.
    return null;
  }
}

const ouvintes = new Set<() => void>();

function gravar(campo: Campo, usuarioId: string, valor: string | null): void {
  try {
    if (valor === null) window.localStorage.removeItem(chave(campo, usuarioId));
    else window.localStorage.setItem(chave(campo, usuarioId), valor);
  } catch {
    // Sem armazenamento a preferência não persiste; o aviso continua funcionando.
  }
  for (const ouvinte of ouvintes) ouvinte();
}

function inscrever(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  // `storage` só dispara nas OUTRAS abas: silenciar numa cala todas.
  window.addEventListener('storage', ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
    window.removeEventListener('storage', ouvinte);
  };
}

const noServidor = (): string | null => null;

function usePreferencia(campo: Campo, usuarioId: string): string | null {
  return useSyncExternalStore(inscrever, () => ler(campo, usuarioId), noServidor);
}

export function useSilenciado(usuarioId: string): [boolean, (silenciar: boolean) => void] {
  const silenciado = usePreferencia('silenciado', usuarioId) === '1';
  const mudar = useCallback(
    (silenciar: boolean) => gravar('silenciado', usuarioId, silenciar ? '1' : null),
    [usuarioId],
  );
  return [silenciado, mudar];
}

export function useConviteDispensado(usuarioId: string): [boolean, () => void] {
  const dispensado = usePreferencia('convite', usuarioId) === '1';
  const dispensar = useCallback(() => gravar('convite', usuarioId, '1'), [usuarioId]);
  return [dispensado, dispensar];
}

/** Para quem decide fora da pintura: o provedor confere isto na hora de avisar. */
export function estaSilenciado(usuarioId: string): boolean {
  return ler('silenciado', usuarioId) === '1';
}

export function lerVistoAte(usuarioId: string): string | null {
  return ler('visto', usuarioId);
}

/** O marco só anda para a frente: duas abas gravando fora de ordem não o fazem voltar. */
export function gravarVistoAte(usuarioId: string, chegada: string): void {
  const atual = lerVistoAte(usuarioId);
  if (atual !== null && maisRecente(chegada, atual) <= 0) return;
  gravar('visto', usuarioId, chegada);
}

/**
 * Até que chegada cada conversa foi aberta. Texto estragado ou de outra versão
 * vira registro vazio: as conversas voltam a contar, que é o erro barato.
 */
export function lerAbertas(usuarioId: string): Map<string, string> {
  const abertas = new Map<string, string>();
  const texto = ler('abertas', usuarioId);
  if (texto === null) return abertas;
  try {
    const lido: unknown = JSON.parse(texto);
    if (lido === null || typeof lido !== 'object' || Array.isArray(lido)) return abertas;
    for (const [conversaId, abertaAte] of Object.entries(lido)) {
      if (typeof abertaAte === 'string') abertas.set(conversaId, abertaAte);
    }
  } catch {
    // Cai no registro vazio.
  }
  return abertas;
}

function gravarAbertas(usuarioId: string, abertas: ReadonlyMap<string, string>): void {
  gravar(
    'abertas',
    usuarioId,
    abertas.size === 0 ? null : JSON.stringify(Object.fromEntries(abertas)),
  );
}

/**
 * A pessoa abriu esta conversa com a chegada `chegouEm` na tela. Lê o registro
 * de novo antes de gravar, e só anda para a frente: duas abas abrindo conversas
 * diferentes não apagam a marca uma da outra. Devolve se mudou alguma coisa.
 */
export function marcarAberta(usuarioId: string, conversaId: string, chegouEm: string): boolean {
  const abertas = lerAbertas(usuarioId);
  const atual = abertas.get(conversaId);
  if (atual !== undefined && maisRecente(chegouEm, atual) <= 0) return false;
  abertas.set(conversaId, chegouEm);
  gravarAbertas(usuarioId, abertas);
  return true;
}

/** O piso andou: o registro larga o que ele já cobre. */
export function podarAbertas(usuarioId: string, piso: string): void {
  const abertas = lerAbertas(usuarioId);
  const restam = semOQueOPisoCobre(abertas, piso);
  if (restam.size !== abertas.size) gravarAbertas(usuarioId, restam);
}
