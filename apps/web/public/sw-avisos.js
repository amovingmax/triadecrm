/*
 * O service worker do aviso do navegador (30/10/2026).
 *
 * Existe por uma razão só: botão em notificação ("Responder") só é permitido em
 * notificação mostrada por um service worker. Ele cuida do clique e de mais nada.
 *
 * DE PROPÓSITO NÃO TEM:
 *   - `fetch`: nenhuma requisição do site passa por aqui, nada fica em cache, e o
 *     CRM funciona igual com ou sem ele;
 *   - `push`: com o navegador fechado não sai aviso, como o usuário pediu.
 *
 * O que chega em `data`, posto por `aviso-do-navegador.ts`: os ids das conversas e
 * o endereço para abrir. Texto de mensagem não fica aqui.
 */

self.addEventListener('install', () => {
  // Sem estado para migrar: a versão nova entra na hora.
  self.skipWaiting();
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  evento.waitUntil(abrir(evento.notification.data || {}));
});

async function abrir(dados) {
  // A lista vem da aba usada mais recentemente para a mais antiga. As abas abertas
  // antes do registro não são "controladas", e contam do mesmo jeito.
  const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const aba = abas[0];

  if (!aba) {
    // O CRM foi fechado depois de o aviso aparecer: abre direto na conversa.
    await self.clients.openWindow(dados.destino || '/conversas');
    return;
  }

  // Quem abre a conversa é a própria aba, que sabe fazer isso sem recarregar.
  // O navegador pode recusar o foco; a conversa abre mesmo assim.
  await aba.focus().catch(() => undefined);
  aba.postMessage({ tipo: 'triade-aviso-clicado', alvos: dados.alvos || [] });
}
