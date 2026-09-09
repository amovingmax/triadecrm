/**
 * `server-only` é um pacote virtual que o Next resolve no build para quebrar o
 * build quando um módulo de servidor vaza para o bundle do cliente. Fora do
 * Next ele não existe, e o Vitest não consegue importar nenhum arquivo que o
 * declare — o que deixaria a lógica pura desses arquivos permanentemente sem
 * teste (`lib/google/lugares.ts`, `lib/google/agenda.ts`).
 *
 * O alias no vitest.config aponta para este arquivo vazio. A garantia de verdade
 * continua sendo o build do Next, que é quem tem como saber o que foi para o
 * navegador; o teste só precisa conseguir importar o módulo.
 */
export {};
