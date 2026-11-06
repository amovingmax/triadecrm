/**
 * O erro que não adianta repetir, num arquivo só dele (06/11/2026).
 *
 * Morava em `tarefas.ts`, que continua a exportá-lo. Saiu de lá quando a IA juíza
 * (`juiza.ts`) precisou lançá-lo: `tarefas.ts` importa a juíza para montar a lista de
 * trabalhos, e a juíza importando `tarefas.ts` de volta seria um ciclo em que um dos
 * dois lê o outro antes de ele existir. Aqui não importa ninguém, e a classe é a mesma
 * para os dois — `instanceof` continua valendo em `eDeterministico`.
 */

/**
 * Erro que não adianta repetir: o mundo teria de mudar, não a tentativa.
 * A mensagem é concluída na fila e o motivo fica no log.
 */
export class ErroDeterministico extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'ErroDeterministico';
  }
}
