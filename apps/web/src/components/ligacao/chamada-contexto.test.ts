import { describe, expect, it } from 'vitest';

import { PAPEIS_QUE_LIGAM, podeLigar } from './chamada-contexto';

describe('quem liga', () => {
  it('os três papéis do CRM ligam: admin, gestor e SDR', () => {
    // O SDR é quem mais liga. De 10/10 a 20/10/2026 o telefone do navegador foi
    // entregue a quem `podeCriarParceiro` (só a gestão desde o pivô de 06/10) e
    // ele ficou sem: a chave do telefone é esta, e só esta.
    expect(podeLigar('admin')).toBe(true);
    expect(podeLigar('gestor')).toBe(true);
    expect(podeLigar('sdr')).toBe(true);
  });

  it('é o espelho de app.can_write(): leitura e financeiro não ligam', () => {
    // `voz_pode_ligar`, `voz_abrir_ligacao` e `montar_lote_avulso` recusam com
    // `sem_permissao` quem não escreve; oferecer o telefone a eles seria um botão
    // que o banco nega.
    expect([...PAPEIS_QUE_LIGAM].sort()).toEqual(['admin', 'embaixador', 'gestor', 'sdr']);
    expect(podeLigar('leitura')).toBe(false);
    expect(podeLigar('financeiro')).toBe(false);
  });
});
