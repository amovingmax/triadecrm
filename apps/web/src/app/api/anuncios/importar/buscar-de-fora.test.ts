import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AGENTE, buscarDeFora, lookupConferido, type OpcoesDaBusca } from './buscar-de-fora';

let servidor: Server;
let base: string;
let agenteVisto: string | undefined;

beforeAll(async () => {
  servidor = createServer((pedido, resposta) => {
    agenteVisto = pedido.headers['user-agent'];
    const caminho = pedido.url ?? '/';
    if (caminho === '/feed.xml') {
      resposta.writeHead(200, { 'Content-Type': 'application/xml' });
      resposta.end('<ListingDataFeed/>');
    } else if (caminho === '/comprimido.xml') {
      resposta.writeHead(200, { 'Content-Type': 'application/xml', 'Content-Encoding': 'gzip' });
      resposta.end(gzipSync('<ListingDataFeed>comprimido</ListingDataFeed>'));
    } else if (caminho === '/grande') {
      resposta.writeHead(200);
      resposta.end(Buffer.alloc(2048, 1));
    } else if (caminho === '/grande-sem-tamanho') {
      resposta.writeHead(200, { 'Transfer-Encoding': 'chunked' });
      resposta.write(Buffer.alloc(1024, 1));
      resposta.end(Buffer.alloc(1024, 1));
    } else if (caminho.startsWith('/pula/')) {
      const n = Number(caminho.slice('/pula/'.length));
      resposta.writeHead(302, { Location: n > 0 ? `/pula/${n - 1}` : '/feed.xml' });
      resposta.end();
    } else if (caminho === '/para-o-metadado') {
      resposta.writeHead(301, { Location: 'http://169.254.169.254/latest/meta-data/' });
      resposta.end();
    } else if (caminho === '/devagar') {
      setTimeout(() => resposta.end('tarde'), 2000);
    } else {
      resposta.writeHead(404);
      resposta.end();
    }
  });
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => {
  servidor.closeAllConnections();
  servidor.close();
});

const LOCAL: OpcoesDaBusca = {
  tempoMs: 5000,
  teto: 1024,
  permitirLocal: true,
  aceitar: 'application/xml',
};

describe('buscarDeFora', () => {
  it('traz o arquivo e se apresenta como o CRM', async () => {
    const r = await buscarDeFora(`${base}/feed.xml`, LOCAL);
    expect(r.ok && r.bytes.toString()).toBe('<ListingDataFeed/>');
    expect(r.ok && r.tipo).toBe('application/xml');
    expect(agenteVisto).toBe(AGENTE);
  });

  it('descomprime o gzip', async () => {
    const r = await buscarDeFora(`${base}/comprimido.xml`, LOCAL);
    expect(r.ok && r.bytes.toString()).toBe('<ListingDataFeed>comprimido</ListingDataFeed>');
  });

  it('em produção, a máquina local está fechada', async () => {
    expect(await buscarDeFora(`${base}/feed.xml`, { ...LOCAL, permitirLocal: false })).toEqual({
      ok: false,
      motivo: 'url_bloqueada',
    });
  });

  it('o lookup da conexão confere todos os endereços do nome', async () => {
    const perguntar = (permitirLocal: boolean, nome: string) =>
      new Promise<{ erro: string | null; endereco: unknown }>((pronto) =>
        lookupConferido(permitirLocal)(nome, { all: true }, (erro, endereco) =>
          pronto({
            erro: erro ? ((erro as { motivo?: string }).motivo ?? erro.message) : null,
            endereco,
          }),
        ),
      );
    expect((await perguntar(false, '127.0.0.1')).erro).toBe('url_bloqueada');
    expect((await perguntar(false, '::1')).erro).toBe('url_bloqueada');
    expect((await perguntar(false, '169.254.169.254')).erro).toBe('url_bloqueada');
    expect(await perguntar(true, '127.0.0.1')).toEqual({
      erro: null,
      endereco: [{ address: '127.0.0.1', family: 4 }],
    });
    expect((await perguntar(true, '169.254.169.254')).erro).toBe('url_bloqueada');
  });

  it('segue até 3 redirecionamentos, e não o 4º', async () => {
    const tres = await buscarDeFora(`${base}/pula/2`, LOCAL);
    expect(tres.ok && tres.bytes.toString()).toBe('<ListingDataFeed/>');
    expect(await buscarDeFora(`${base}/pula/3`, LOCAL)).toEqual({
      ok: false,
      motivo: 'redirecionamentos_demais',
    });
  });

  it('não segue redirecionamento para o serviço de metadados', async () => {
    expect(await buscarDeFora(`${base}/para-o-metadado`, LOCAL)).toEqual({
      ok: false,
      motivo: 'url_bloqueada',
    });
  });

  it('recusa o grande demais, com e sem o tamanho anunciado', async () => {
    expect(await buscarDeFora(`${base}/grande`, LOCAL)).toEqual({
      ok: false,
      motivo: 'grande_demais',
    });
    expect(await buscarDeFora(`${base}/grande-sem-tamanho`, LOCAL)).toEqual({
      ok: false,
      motivo: 'grande_demais',
    });
  });

  it('diz o status quando o servidor recusa, e desiste quando ele demora', async () => {
    expect(await buscarDeFora(`${base}/nao-existe`, LOCAL)).toEqual({
      ok: false,
      motivo: 'status_404',
    });
    expect(await buscarDeFora(`${base}/devagar`, { ...LOCAL, tempoMs: 300 })).toEqual({
      ok: false,
      motivo: 'nao_respondeu',
    });
  });
});
