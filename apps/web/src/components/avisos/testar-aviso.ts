'use client';

import { toast } from 'sonner';

import { EMPRESA } from '@/lib/empresa';

import { mostrarAviso, pedirPermissao, permissaoAtual } from './aviso-do-navegador';
import { dicaDoSistema, identificarNavegador, passosParaDesbloquear } from './avisos-da-equipe';
import { avisarDaPermissao } from './convite-de-avisos';
import { tocarAmostra } from './som';

/**
 * "Testar aviso deste computador" (11/11/2026, só na Imova): a pessoa confere,
 * sozinha, que o aviso chega neste navegador. Mostra uma notificação do sistema
 * e toca o som do CRM, aqui mesmo, sem passar pelo banco nem pela fila dos
 * avisos do celular: nada é gravado e ninguém mais é avisado.
 *
 * Precisa nascer de um clique (o item do menu da conta, ou o "Testar" depois de
 * ligar os avisos na faixa): é o gesto que destrava o som e, se ainda faltar, a
 * pergunta do navegador.
 */
export async function testarAvisoDesteComputador(somLigado: boolean): Promise<void> {
  const { navegador, sistema } = identificarNavegador(
    navigator.userAgent,
    navigator.maxTouchPoints,
  );
  const permissao = permissaoAtual();

  if (permissao === 'a_pedir') {
    toast('Os avisos deste computador ainda não estão ligados.', {
      description: 'Ligue e teste de novo: o navegador vai perguntar se pode mostrar notificações.',
      action: {
        label: 'Ligar avisos',
        onClick: () =>
          void pedirPermissao().then((resultado) => {
            avisarDaPermissao(resultado);
            if (resultado === 'liberada') void testarAvisoDesteComputador(somLigado);
          }),
      },
    });
    return;
  }
  if (permissao === 'bloqueada') {
    toast('O navegador bloqueou os avisos deste site.', {
      description: passosParaDesbloquear(navegador, sistema).join(' '),
      duration: 20_000,
    });
    return;
  }
  if (permissao === 'sem_suporte') {
    toast('Este navegador não mostra aviso.', {
      description:
        'Use o Google Chrome, o Edge ou o Safari do Mac. No celular, o aviso chega pelo app do Tríade.',
    });
    return;
  }

  // O toque do CRM sai junto, e a notificação vai calada para não tocar duas vezes.
  if (somLigado) tocarAmostra();
  const mostrou = await mostrarAviso<never>({
    titulo: `${EMPRESA.nomeNoAviso} · Aviso de teste`,
    corpo: 'Funcionou. É assim que o aviso chega quando um cliente escreve.',
    marca: 'triade-aviso-de-teste',
    silenciosa: somLigado,
    botao: 'Abrir o CRM',
    alvos: [],
    destino: '/meu-dia',
    aoClicar: () => undefined,
  });
  if (!mostrou) {
    toast.error('O aviso de teste não saiu.', {
      description: 'Recarregue a página e tente de novo.',
    });
    return;
  }
  const dica = dicaDoSistema(navegador, sistema);
  toast('Aviso de teste enviado.', {
    description: `Ele aparece no canto da tela${somLigado ? ', com o som do CRM' : ''}. ${
      dica
        ? `Não apareceu? ${dica}`
        : 'Não apareceu? Confira se o sistema deixa o navegador mostrar notificações.'
    }`,
    duration: 12_000,
  });
}
