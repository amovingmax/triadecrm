import { describe, expect, it } from 'vitest';

import { avaliarUrl, ipPermitido } from './seguranca-de-url';

function motivo(texto: string, permitirLocal = false) {
  const r = avaliarUrl(texto, permitirLocal);
  return r.ok ? 'ok' : r.motivo;
}

describe('avaliarUrl', () => {
  it('passa o endereço da internet, em http ou https, na porta padrão', () => {
    expect(motivo('https://www.sistema.com.br/xml/imova.xml')).toBe('ok');
    expect(motivo('http://www.sistema.com.br:80/xml/imova.xml')).toBe('ok');
    expect(motivo('https://www.sistema.com.br:443/xml/imova.xml?chave=abc')).toBe('ok');
    expect(motivo('https://8.8.8.8/feed.xml')).toBe('ok');
    expect(motivo('https://[2606:4700:4700::1111]/feed.xml')).toBe('ok');
  });

  it('põe https:// quando a pessoa cola sem', () => {
    const r = avaliarUrl('  www.sistema.com.br/imova.xml  ');
    expect(r.ok && r.url.href).toBe('https://www.sistema.com.br/imova.xml');
  });

  it('recusa o que não é endereço da web', () => {
    expect(motivo('')).toBe('url_invalida');
    expect(motivo('ftp://sistema.com.br/imova.xml')).toBe('url_invalida');
    expect(motivo('file:///etc/passwd')).toBe('url_invalida');
    expect(motivo('javascript:alert(1)')).toBe('url_invalida');
    expect(motivo('https://')).toBe('url_invalida');
    expect(motivo(`https://a.com/${'x'.repeat(2100)}`)).toBe('url_invalida');
  });

  it('recusa usuário e senha no endereço e porta fora do padrão', () => {
    expect(motivo('https://usuario:senha@sistema.com.br/imova.xml')).toBe('url_bloqueada');
    expect(motivo('https://usuario@sistema.com.br/imova.xml')).toBe('url_bloqueada');
    expect(motivo('https://sistema.com.br:8080/imova.xml')).toBe('url_bloqueada');
    expect(motivo('http://sistema.com.br:22/')).toBe('url_bloqueada');
  });

  it('recusa a rede de dentro, em qualquer forma de escrever', () => {
    for (const url of [
      'http://localhost:3090/api',
      'http://localhost/',
      'http://LOCALHOST./',
      'http://app.localhost/',
      'http://127.0.0.1/',
      'http://127.1/',
      'http://2130706433/',
      'http://0x7f.0.0.1/',
      'http://0.0.0.0/',
      'http://10.0.0.5/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://192.168.1.1/',
      'http://100.64.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://metadata.google.internal/',
      'http://host.docker.internal/',
      'http://impressora.local/',
      'http://intranet/',
      'http://[::1]/',
      'http://[::]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:a9fe:a9fe]/',
      'http://[fe80::1]/',
      'http://[fd00::1]/',
      'http://[64:ff9b::a00:1]/',
      'http://[2002:7f00:1::]/',
      'http://224.0.0.1/',
      'http://255.255.255.255/',
    ]) {
      expect([url, motivo(url)]).toEqual([url, 'url_bloqueada']);
    }
  });

  it('fora de produção, libera a máquina local e qualquer porta — menos o link-local', () => {
    expect(motivo('http://127.0.0.1:8789/canal-pro-feed?chave=abc', true)).toBe('ok');
    expect(motivo('http://localhost:3090/teste.xml', true)).toBe('ok');
    expect(motivo('http://192.168.0.10:8000/x.xml', true)).toBe('ok');
    expect(motivo('http://host.docker.internal:54321/x', true)).toBe('ok');
    expect(motivo('http://169.254.169.254/latest/meta-data/', true)).toBe('url_bloqueada');
    expect(motivo('http://[fe80::1]/', true)).toBe('url_bloqueada');
    expect(motivo('http://metadata.google.internal/', true)).toBe('url_bloqueada');
    // Usuário e senha continuam fora.
    expect(motivo('http://a:b@127.0.0.1:8789/', true)).toBe('url_bloqueada');
  });
});

describe('ipPermitido', () => {
  it('IPv4 público passa; privado, loopback e link-local não', () => {
    expect(ipPermitido('177.70.1.10')).toBe(true);
    expect(ipPermitido('8.8.8.8')).toBe(true);
    expect(ipPermitido('172.32.0.1')).toBe(true);
    expect(ipPermitido('127.0.0.1')).toBe(false);
    expect(ipPermitido('10.1.2.3')).toBe(false);
    expect(ipPermitido('192.168.0.1')).toBe(false);
    expect(ipPermitido('169.254.169.254')).toBe(false);
  });

  it('IPv6: público passa; loopback, privado, link-local e IPv4 escondido não', () => {
    expect(ipPermitido('2606:4700:4700::1111')).toBe(true);
    expect(ipPermitido('2804:14c:5b80::1')).toBe(true);
    expect(ipPermitido('::ffff:8.8.8.8')).toBe(true);
    expect(ipPermitido('::1')).toBe(false);
    expect(ipPermitido('::ffff:10.0.0.1')).toBe(false);
    expect(ipPermitido('::ffff:7f00:1')).toBe(false);
    expect(ipPermitido('fe80::1%en0')).toBe(false);
    expect(ipPermitido('fc00::1')).toBe(false);
    expect(ipPermitido('2001:db8::1')).toBe(false);
    expect(ipPermitido('ff02::1')).toBe(false);
  });

  it('com permitirLocal, a máquina e a rede local passam; link-local e metadados não', () => {
    expect(ipPermitido('127.0.0.1', true)).toBe(true);
    expect(ipPermitido('::1', true)).toBe(true);
    expect(ipPermitido('192.168.0.1', true)).toBe(true);
    expect(ipPermitido('169.254.169.254', true)).toBe(false);
    expect(ipPermitido('fe80::1', true)).toBe(false);
  });

  it('o que não é IP não passa', () => {
    expect(ipPermitido('sistema.com.br')).toBe(false);
    expect(ipPermitido('1.2.3')).toBe(false);
    expect(ipPermitido('1:2:3')).toBe(false);
    expect(ipPermitido('')).toBe(false);
  });
});
