'use client';

import { useSyncExternalStore } from 'react';

/**
 * A notificação do sistema, pela Notification API do navegador.
 *
 * SEM PUSH, E É ESCOLHA. O aviso vale enquanto o CRM estiver aberto em alguma aba
 * — inclusive escondida, em segundo plano, ou com a janela minimizada. Com o
 * navegador fechado não sai aviso, e é o que o usuário pediu em 29/10/2026: "Com o
 * navegador fechado não deve ser exibido a notificação, porém se o navegador
 * estiver somente minimizado ou eu estiver em outra aba deve ser exibido
 * normalmente". Avisar com o CRM fechado exigiria uma assinatura por aparelho e um
 * disparo no instante em que a mensagem é gravada, que é justamente o caminho de
 * entrada do WhatsApp. Com o CRM fechado continua valendo o e-mail de aviso do
 * worker-wa.
 *
 * O SERVICE WORKER (30/10/2026) é só para o botão "Responder": botão em notificação
 * só existe na que um service worker mostra (`public/sw-avisos.js`). Quem decide
 * avisar continua sendo a aba; ele mostra e cuida do clique. Não intercepta
 * requisição nem guarda nada. Se ele ainda não estiver pronto ou falhar, sai a
 * `Notification` comum, sem o botão: o aviso nunca depende dele.
 *
 * O Chrome do Android também só mostra notificação por service worker, então lá o
 * aviso passa a sair com a aba aberta. O Safari do iPhone não tem a API fora de um
 * app instalado: `mostrarAviso` devolve `false`, e valem o número e o cartão.
 *
 * O QUE O SITE NÃO CONTROLA. A caixa é desenhada pelo sistema: forma, cor e fonte
 * são dele. E `Notification.permission` só diz o que o NAVEGADOR permitiu. O Mac
 * tem uma chave própria (Ajustes do Sistema → Notificações → Google Chrome), e com
 * ela desligada a chamada dá certo e nada aparece, sem erro nenhum: foi o que
 * aconteceu em 30/10/2026, com o som tocando e o aviso sumindo.
 */

/**
 * `a_pedir` é o estado de fábrica: o navegador só mostra a pergunta dele depois
 * de um clique da pessoa. `sem_suporte` é também o que o servidor renderiza.
 */
export type Permissao = 'sem_suporte' | 'a_pedir' | 'liberada' | 'bloqueada';

function temSuporte(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permissaoAtual(): Permissao {
  if (!temSuporte()) return 'sem_suporte';
  switch (Notification.permission) {
    case 'granted':
      return 'liberada';
    case 'denied':
      return 'bloqueada';
    default:
      return 'a_pedir';
  }
}

const ouvintes = new Set<() => void>();

function avisarOuvintes(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

function inscrever(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  // A permissão também muda por fora, nas configurações do navegador. Nem todo
  // navegador conta quando isso acontece; onde conta, a tela acompanha.
  let estado: PermissionStatus | null = null;
  let saiu = false;
  if (typeof navigator !== 'undefined' && navigator.permissions) {
    navigator.permissions
      .query({ name: 'notifications' })
      .then((resposta) => {
        if (saiu) return;
        estado = resposta;
        resposta.addEventListener('change', ouvinte);
      })
      .catch(() => undefined);
  }
  return () => {
    saiu = true;
    ouvintes.delete(ouvinte);
    estado?.removeEventListener('change', ouvinte);
  };
}

const noServidor = (): Permissao => 'sem_suporte';

export function usePermissao(): Permissao {
  return useSyncExternalStore(inscrever, permissaoAtual, noServidor);
}

/** Precisa nascer de um clique: fora de um gesto, Safari e Firefox recusam em silêncio. */
export async function pedirPermissao(): Promise<Permissao> {
  if (!temSuporte()) return 'sem_suporte';
  try {
    await Notification.requestPermission();
  } catch {
    // Navegador antigo, só com a forma de callback: fica como estava.
  }
  avisarOuvintes();
  return permissaoAtual();
}

const ENDERECO_DO_SERVICE_WORKER = '/sw-avisos.js';

let registro: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Registra o service worker, uma vez só. Não pede permissão nenhuma. Falhar aqui
 * não é problema: `mostrarAviso` usa a notificação comum.
 */
function registrar(): Promise<ServiceWorkerRegistration | null> {
  if (!temSuporte() || !('serviceWorker' in navigator)) return Promise.resolve(null);
  registro ??= navigator.serviceWorker
    .register(ENDERECO_DO_SERVICE_WORKER, { scope: '/' })
    .catch(() => null);
  return registro;
}

/** A casca chama ao montar, para o botão já estar pronto no primeiro aviso. */
export function prepararAvisoDoSistema(): void {
  void registrar();
}

/** O que `sw-avisos.js` manda à aba quando a pessoa clica no aviso. */
const TIPO_DO_CLIQUE = 'triade-aviso-clicado';

/** Escuta os cliques no aviso, inclusive os de um aviso anterior a uma recarga. */
export function ouvirCliqueNoAviso<T>(aoClicar: (alvos: readonly T[]) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => undefined;
  const aoReceber = (evento: MessageEvent) => {
    const dados = evento.data as { tipo?: unknown; alvos?: unknown } | null;
    if (dados?.tipo === TIPO_DO_CLIQUE && Array.isArray(dados.alvos)) {
      aoClicar(dados.alvos as T[]);
    }
  };
  navigator.serviceWorker.addEventListener('message', aoReceber);
  return () => navigator.serviceWorker.removeEventListener('message', aoReceber);
}

/** `actions` é só de notificação de service worker, e por isso não está no tipo comum. */
type OpcoesComBotao = NotificationOptions & {
  actions: readonly { action: string; title: string }[];
};

/**
 * Mostra a notificação. Devolve `false` quando não mostrou — sem permissão ou sem
 * suporte —, para quem chama avisar de outro jeito.
 */
export async function mostrarAviso<T>({
  titulo,
  corpo,
  marca,
  silenciosa,
  botao,
  alvos,
  destino,
  aoClicar,
}: {
  titulo: string;
  corpo: string;
  /** Avisos com a mesma marca se substituem: duas abas abertas não empilham dois. */
  marca: string;
  /**
   * Sem o som do sistema: o CRM já tocou o dele (`som.ts`), ou a pessoa
   * desligou o som. Dois toques para uma mensagem só cansam.
   */
  silenciosa: boolean;
  /** O texto do botão do aviso. */
  botao: string;
  /** O que abrir no clique. Só ids: fica guardado junto com o aviso. */
  alvos: readonly T[];
  /** Para onde ir se o CRM tiver sido fechado antes do clique. */
  destino: string;
  /** O clique, na notificação comum. No service worker, é `ouvirCliqueNoAviso`. */
  aoClicar: () => void;
}): Promise<boolean> {
  if (permissaoAtual() !== 'liberada') return false;

  const opcoes: NotificationOptions = {
    body: corpo,
    tag: marca,
    icon: '/icons/icon-192.png',
    lang: 'pt-BR',
    silent: silenciosa,
  };

  const pronto = await registrar();
  if (pronto?.active) {
    try {
      const comBotao: OpcoesComBotao = {
        ...opcoes,
        data: { alvos, destino },
        actions: [{ action: 'abrir', title: botao }],
      };
      await pronto.showNotification(titulo, comBotao);
      return true;
    } catch {
      // Cai na notificação comum, logo abaixo.
    }
  }

  try {
    const aviso = new Notification(titulo, opcoes);
    aviso.onclick = () => {
      window.focus();
      aoClicar();
      aviso.close();
    };
    return true;
  } catch {
    return false;
  }
}
