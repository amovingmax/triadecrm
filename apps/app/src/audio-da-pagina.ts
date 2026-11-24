/**
 * O som da página do CRM durante a ligação no app (24/11/2026).
 *
 * No primeiro teste de verdade a Meta atendeu e o cliente não ouviu nada. A página do
 * CRM, aberta no app, mantém um `AudioContext` ligado para o som dos avisos
 * (`apps/web/src/components/avisos/som.ts`, que o religa a cada toque na tela) e toca
 * os áudios das conversas. No iPhone, o som da página é o som do app: com ele ativo o
 * CallKit não consegue ligar o áudio da ligação, e o WebKit troca o modo de áudio do
 * app no meio da conversa, o que cala o microfone.
 *
 * Então, enquanto uma ligação toca ou está em curso, a página fica calada: os
 * `AudioContext` dela são suspensos e não voltam (`resume` não faz nada), e `play()`
 * de áudio e vídeo é recusado. No fim da ligação tudo volta a funcionar; o som dos
 * avisos religa no toque seguinte, como sempre. O site não sabe de nada disso.
 */

/**
 * Roda na página antes do código do site, a cada carregamento: embrulha o
 * `AudioContext`, o `resume` e o `play` para obedecerem à ligação. `emLigacao` é o estado
 * na hora do carregamento (a página que abre no meio da ligação já nasce calada).
 */
export function guardaDoAudio(emLigacao: boolean): string {
  return `(function () {
  if (window.__triadeLigacao) { window.__triadeLigacao(${emLigacao ? 'true' : 'false'}); return; }
  var estado = { emLigacao: ${emLigacao ? 'true' : 'false'}, contextos: [] };
  function calar() {
    estado.contextos.forEach(function (c) {
      try { if (c.state === 'running') c.suspend(); } catch (e) {}
    });
    try {
      document.querySelectorAll('audio,video').forEach(function (m) {
        try { m.pause(); } catch (e) {}
      });
    } catch (e) {}
  }
  ['AudioContext', 'webkitAudioContext'].forEach(function (nome) {
    var Original = window[nome];
    if (typeof Original !== 'function' || Original.__triade) return;
    var retomar = Original.prototype.resume;
    Original.prototype.resume = function () {
      if (estado.emLigacao) return Promise.resolve();
      return retomar.apply(this, arguments);
    };
    function Embrulho() {
      var c = Reflect.construct(Original, arguments);
      estado.contextos.push(c);
      if (estado.emLigacao) { try { c.suspend(); } catch (e) {} }
      return c;
    }
    Embrulho.prototype = Original.prototype;
    Embrulho.__triade = true;
    window[nome] = Embrulho;
  });
  if (window.HTMLMediaElement) {
    var tocar = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (estado.emLigacao) return Promise.reject(new DOMException('Em ligação pelo app', 'NotAllowedError'));
      return tocar.apply(this, arguments);
    };
  }
  window.__triadeLigacao = function (em) {
    estado.emLigacao = !!em;
    if (estado.emLigacao) calar();
  };
  if (estado.emLigacao) calar();
})();
true;`;
}

/** Avisa a página já carregada que a ligação começou ou acabou. */
export function avisarLigacaoAPagina(emLigacao: boolean): string {
  return `window.__triadeLigacao && window.__triadeLigacao(${emLigacao ? 'true' : 'false'});\ntrue;`;
}
