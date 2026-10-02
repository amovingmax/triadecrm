import { toast } from 'sonner';

import { type Permissao } from './aviso-do-navegador';

/**
 * O que dizer depois que o navegador respondeu ao pedido de notificação.
 *
 * O aviso nasce ligado no CRM, mas o navegador só mostra notificação depois de a
 * pessoa dizer sim à pergunta DELE — e ele só faz a pergunta em resposta a um
 * clique. Esse clique é oferecido uma vez, num cartão da pilha de avisos
 * (`pilha-de-avisos.tsx`), e fica sempre à mão no menu do usuário. Os dois
 * caminhos terminam aqui.
 */
export function avisarDaPermissao(resultado: Permissao): void {
  if (resultado === 'liberada') {
    toast.success('Avisos ligados neste navegador.', {
      description: 'Quando chegar mensagem, o aviso aparece mesmo com o CRM em outra aba.',
    });
  } else if (resultado === 'bloqueada') {
    toast('O navegador bloqueou as notificações.', {
      description:
        'O aviso continua aparecendo dentro do CRM. Para liberar, use o cadeado ao lado do endereço.',
    });
  }
}
