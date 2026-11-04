/**
 * Só no `next dev`, para o celular de teste (03/11/2026).
 *
 * O celular abre o site de teste pelo endereço do computador na rede
 * (`http://10.0.0.x:3081`), e fora de https o navegador não oferece
 * `crypto.randomUUID`: o eco ao vivo das conversas e dos avisos, que nomeia o
 * canal com ele, quebrava, e o anexo também. `getRandomValues` existe em
 * qualquer endereço, e é dele que sai o mesmo UUID v4. Em produção (https) a
 * função nativa existe e este arquivo não faz nada.
 */
if (
  process.env.NODE_ENV === 'development' &&
  typeof crypto !== 'undefined' &&
  typeof crypto.randomUUID !== 'function'
) {
  crypto.randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`;
  };
}
