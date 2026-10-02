'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { maisRecente } from './regra';

/**
 * O que o aviso de resposta guarda no aparelho, por pessoa.
 *
 * Três coisas, e nenhuma é dado de parceiro:
 *   - `silenciado`  a pessoa pediu para não ser avisada. Ausente = avisar, que é
 *                   o padrão: o aviso nasce ligado.
 *   - `visto`       até que chegada ela já olhou a tela de Conversas. É o que faz
 *                   o número do menu zerar ao abrir.
 *   - `convite`     ela dispensou o convite de ligar as notificações do navegador.
 *
 * POR QUE NO APARELHO, E NÃO NO BANCO. A permissão de notificação já é do
 * navegador, não da pessoa: liberar no computador não libera no celular. Guardar
 * o resto no mesmo lugar deixa a entrega sem migração nenhuma. O preço é o
 * "visto" não atravessar aparelhos — abrir Conversas no computador não zera o
 * número no celular.
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
  convite: 'komune.avisos.convite.v1',
} as const;

type Campo = keyof typeof CHAVES;

function chave(campo: Campo, usuarioId: string): string {
  return `${CHAVES[campo]}:${usuarioId}`;
}

/** A chave do "visto" de uma pessoa: é por ela que uma aba sabe que a outra olhou. */
export function chaveDoVisto(usuarioId: string): string {
  return chave('visto', usuarioId);
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
