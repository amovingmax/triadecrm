import { createHash } from 'node:crypto';

import { textoCanonicoDoTermo } from '@/components/precadastro/termo';

/**
 * O hash do termo, calculado no servidor.
 *
 * Fica num módulo próprio (sem `'use server'`) porque é lido em dois lugares que
 * não podem divergir: a página, que MOSTRA a versão e o hash do texto que a pessoa
 * está lendo, e a ação de aceite, que GRAVA os dois na prova. Uma função só, um
 * texto só, `node:crypto` que nunca chega ao navegador.
 */
export function hashDoTermo(): string {
  return createHash('sha256').update(textoCanonicoDoTermo(), 'utf8').digest('hex');
}
