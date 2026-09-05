/**
 * O leitor de planilha dentro de um Web Worker.
 *
 * Por que um worker: uma planilha de milhares de linhas leva segundos para
 * descompactar e varrer, e na thread principal isso é a tela congelada — o botão
 * não responde, o cursor não pisca, e quem está importando acha que travou.
 * Aqui a leitura acontece ao lado e a tela continua viva, mostrando em que passo
 * está.
 *
 * O worker não fala com o banco e não sabe o que é um campo do CRM: ele devolve
 * cabeçalho e linhas de texto. Toda decisão é da tela e do Postgres.
 */
import { ErroDePlanilha, lerArquivo } from './planilha';
import type { PlanilhaLida } from './tipos';

export type PedidoAoLeitor = { arquivo: File };

export type RespostaDoLeitor =
  | { tipo: 'passo'; passo: 'lendo' | 'abrindo' | 'varrendo' }
  | { tipo: 'pronto'; planilha: PlanilhaLida }
  | { tipo: 'erro'; mensagem: string; comoResolver: string };

function responder(r: RespostaDoLeitor) {
  self.postMessage(r);
}

self.addEventListener('message', (evento: MessageEvent<PedidoAoLeitor>) => {
  const { arquivo } = evento.data;

  void (async () => {
    try {
      responder({ tipo: 'passo', passo: 'lendo' });
      const bytes = new Uint8Array(await arquivo.arrayBuffer());

      responder({ tipo: 'passo', passo: 'abrindo' });
      const planilha = lerArquivo(arquivo.name, bytes);

      responder({ tipo: 'passo', passo: 'varrendo' });
      responder({ tipo: 'pronto', planilha });
    } catch (erro) {
      if (erro instanceof ErroDePlanilha) {
        responder({ tipo: 'erro', mensagem: erro.message, comoResolver: erro.comoResolver });
        return;
      }
      responder({
        tipo: 'erro',
        mensagem: 'Não deu para ler este arquivo.',
        comoResolver: 'Confira se ele abre no Excel e salve de novo como .xlsx ou .csv.',
      });
    }
  })();
});
