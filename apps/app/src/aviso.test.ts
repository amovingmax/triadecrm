import { describe, expect, it } from 'vitest';

import { origensDasEmpresas } from './ambiente';
import { enderecoDoAviso, origemDe, scriptDoAparelho } from './aviso';

const noAr = origensDasEmpresas('producao');

describe('o toque no aviso', () => {
  it('abre a conversa ou a agenda na empresa de onde o aviso veio', () => {
    expect(enderecoDoAviso({ empresa: 'imova', caminho: '/conversas?cliente=abc-123' }, noAr)).toBe(
      'https://imova-crm.vercel.app/conversas?cliente=abc-123',
    );
    expect(enderecoDoAviso({ empresa: 'komune', caminho: '/agenda' }, noAr)).toBe(
      'https://triade-crm-tawny.vercel.app/agenda',
    );
  });

  it('aviso que não é nosso não abre nada', () => {
    expect(enderecoDoAviso(null, noAr)).toBeNull();
    expect(enderecoDoAviso({ empresa: 'outra', caminho: '/agenda' }, noAr)).toBeNull();
    expect(enderecoDoAviso({ empresa: 'toString', caminho: '/agenda' }, noAr)).toBeNull();
    expect(enderecoDoAviso({ empresa: 'imova', caminho: '//atacante.com' }, noAr)).toBeNull();
    expect(enderecoDoAviso({ empresa: 'imova', caminho: 'https://atacante.com' }, noAr)).toBeNull();
    expect(enderecoDoAviso({ empresa: 'imova', caminho: '/x"><script>' }, noAr)).toBeNull();
  });
});

describe('a entrega do aparelho à empresa', () => {
  it('o endereço de push vai escapado para dentro da página', () => {
    const roteiro = scriptDoAparelho('ExponentPushToken[abc"\'</script>]', 'ios');
    expect(roteiro).toContain('"ExponentPushToken[abc\\"\'</script>]"');
    expect(roteiro).toContain("fetch('/api/aparelhos'");
    expect(roteiro).toContain('triade_aparelho=');
  });

  it('cada empresa é uma origem', () => {
    expect(origemDe('https://imova-crm.vercel.app/meu-dia?x=1')).toBe(
      'https://imova-crm.vercel.app',
    );
    expect(origemDe('http://10.0.0.188:3101/login')).toBe('http://10.0.0.188:3101');
  });
});
