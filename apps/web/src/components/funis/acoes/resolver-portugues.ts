'use client';

/**
 * A rede de segurança do idioma.
 *
 * Toda regra do formulário de mover traz a sua mensagem em pt-BR escrita à mão. Mas o
 * zod tem mensagem própria para o que ninguém previu — `"Invalid input: expected
 * string, received undefined"` — e ela é em inglês. Numa tela usada na rua, por
 * alguém que não programa, uma frase dessas é pior do que erro nenhum: não diz o que
 * fazer e ainda parece defeito do aplicativo.
 *
 * Este resolvedor embrulha o `zodResolver` e troca qualquer mensagem que cheire a
 * texto de biblioteca por uma frase curta em português. É rede, não solução: quando
 * ela aparece, falta uma mensagem escrita no schema — e a frase genérica diz apenas o
 * suficiente para a pessoa continuar.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';

import type { criarSchemaMover, FormularioMover } from './formulario-mover';

/** Marcas do texto padrão do zod (e de qualquer validação que escape em inglês). */
const CHEIRO_DE_BIBLIOTECA =
  /invalid|expected|received|required|too (small|big)|must be|at least|at most|nan/i;

const FRASE_GENERICA = 'Confira este campo.';

/** Uma folha de `FieldErrors`: o que tem `message` de texto. */
function ehFolhaDeErro(valor: unknown): valor is { message?: unknown } {
  return typeof valor === 'object' && valor !== null && 'message' in valor;
}

function traduzir(no: unknown): unknown {
  if (Array.isArray(no)) return no.map(traduzir);
  if (typeof no !== 'object' || no === null) return no;

  const copia: Record<string, unknown> = { ...(no as Record<string, unknown>) };

  if (ehFolhaDeErro(no) && typeof copia.message === 'string') {
    if (CHEIRO_DE_BIBLIOTECA.test(copia.message)) copia.message = FRASE_GENERICA;
  }

  for (const [chave, valor] of Object.entries(copia)) {
    if (chave === 'message' || chave === 'type' || chave === 'ref') continue;
    copia[chave] = traduzir(valor);
  }

  return copia;
}

/** `zodResolver` com toda mensagem garantidamente em português. */
export function resolverEmPortugues(
  schema: ReturnType<typeof criarSchemaMover>,
): Resolver<FormularioMover, unknown, FormularioMover> {
  const base = zodResolver(schema) as Resolver<FormularioMover, unknown, FormularioMover>;

  const embrulhado: Resolver<FormularioMover, unknown, FormularioMover> = async (
    valores,
    contexto,
    opcoes,
  ) => {
    const resultado = await base(valores, contexto, opcoes);
    return { ...resultado, errors: traduzir(resultado.errors) } as Awaited<
      ReturnType<Resolver<FormularioMover, unknown, FormularioMover>>
    >;
  };

  return embrulhado;
}
