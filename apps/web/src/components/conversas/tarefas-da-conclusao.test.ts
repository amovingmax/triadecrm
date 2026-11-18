import { describe, expect, it } from 'vitest';

import { fraseDasTarefas } from './formatos';

// Concluir a conversa fecha as tarefas do cliente, e reabrir as devolve
// (17/11/2026, migração 20261117210000). O aviso diz quantas.
describe('fraseDasTarefas', () => {
  it('não diz nada quando não havia tarefa', () => {
    expect(fraseDasTarefas(0, true)).toBe('');
    expect(fraseDasTarefas(0, false)).toBe('');
    expect(fraseDasTarefas(Number.NaN, true)).toBe('');
  });

  it('ao concluir, diz que as tarefas saíram do Meu dia', () => {
    expect(fraseDasTarefas(1, true)).toBe(
      'A tarefa aberta deste cliente foi concluída e saiu do Meu dia. ',
    );
    expect(fraseDasTarefas(3, true)).toBe(
      'As 3 tarefas abertas deste cliente foram concluídas e saíram do Meu dia. ',
    );
  });

  it('ao reabrir, diz que elas voltaram', () => {
    expect(fraseDasTarefas(1, false)).toBe('A tarefa deste cliente voltou para o Meu dia. ');
    expect(fraseDasTarefas(2, false)).toBe('As 2 tarefas deste cliente voltaram para o Meu dia. ');
  });

  it('termina com espaço, para a frase seguinte do aviso encostar', () => {
    expect(fraseDasTarefas(2, true).endsWith(' ')).toBe(true);
  });
});
