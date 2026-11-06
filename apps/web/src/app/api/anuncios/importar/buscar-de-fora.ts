/**
 * Buscar um arquivo fora do CRM, a pedido de alguém (05/11/2026).
 *
 * Usado pelo importador do sistema atual: o arquivo VRSync (até 30 MB) e as
 * fotos de cada anúncio (até 7 MB cada). O endereço vem de quem colou, e as
 * fotos vêm de dentro de um arquivo que ninguém aqui escreveu — por isso cada
 * passo passa por `seguranca-de-url`:
 *
 * 1. o endereço escrito (esquema, porta, usuário e senha, nome do host);
 * 2. o IP de verdade, na hora de conectar: a conexão resolve o nome com um
 *    `lookup` que confere TODOS os endereços do nome e recusa se algum for da
 *    rede de dentro. Conferir antes e conectar depois deixaria a janela do DNS
 *    que muda de resposta entre uma consulta e outra;
 * 3. cada redirecionamento (até 3), que volta ao passo 1.
 *
 * O CRM se apresenta como é ("Triade-CRM (importador de anuncios)"). Nunca se
 * passa pelo robô do Grupo OLX, mesmo que o endereço só abra para ele.
 */
import 'server-only';

import { lookup as resolver, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { type LookupFunction } from 'node:net';
import { pipeline, type Readable } from 'node:stream';
import zlib from 'node:zlib';

import { avaliarUrl, ipPermitido } from '@/components/anuncios/seguranca-de-url';

export const AGENTE = 'Triade-CRM (importador de anuncios)';

const REDIRECIONAMENTOS = 3;

export type Busca =
  { ok: true; bytes: Buffer; tipo: string | null } | { ok: false; motivo: string };

export type OpcoesDaBusca = {
  /** O tempo inteiro, com os redirecionamentos e o corpo. */
  tempoMs: number;
  /** O maior corpo aceito, já descomprimido. */
  teto: number;
  /** Fora de produção: libera a máquina e a rede local (ver `seguranca-de-url`). */
  permitirLocal: boolean;
  aceitar: string;
};

class Recusa extends Error {
  constructor(readonly motivo: string) {
    super(motivo);
    this.name = 'Recusa';
  }
}

/** O `lookup` da conexão: resolve o nome e só deixa conectar se TODO endereço for permitido. */
export function lookupConferido(permitirLocal: boolean): LookupFunction {
  return (nome, opcoes, devolver) => {
    resolver(nome, { all: true, family: opcoes.family }, (erro, enderecos: LookupAddress[]) => {
      if (erro) return devolver(erro, '');
      if (enderecos.length === 0) return devolver(new Recusa('nao_respondeu'), '');
      if (!enderecos.every((e) => ipPermitido(e.address, permitirLocal)))
        return devolver(new Recusa('url_bloqueada'), '');
      if (opcoes.all) return devolver(null, enderecos);
      return devolver(null, enderecos[0]!.address, enderecos[0]!.family);
    });
  };
}

type Resposta = {
  status: number;
  location: string | null;
  tipo: string | null;
  tamanho: number | null;
  corpo: Readable;
};

function pedir(url: URL, o: OpcoesDaBusca, sinal: AbortSignal): Promise<Resposta> {
  return new Promise((resolva, rejeite) => {
    const modulo = url.protocol === 'https:' ? https : http;
    const pedido = modulo.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': AGENTE,
          Accept: o.aceitar,
          'Accept-Encoding': 'gzip, deflate, br',
        },
        lookup: lookupConferido(o.permitirLocal),
        // Sem reaproveitar conexão: cada pedido passa pelo `lookup` de novo.
        agent: false,
        signal: sinal,
      },
      (resposta) => {
        const codificacao = String(resposta.headers['content-encoding'] ?? '').toLowerCase();
        const descompressor =
          codificacao === 'gzip' || codificacao === 'x-gzip'
            ? zlib.createGunzip()
            : codificacao === 'deflate'
              ? zlib.createInflate()
              : codificacao === 'br'
                ? zlib.createBrotliDecompress()
                : null;
        const corpo = descompressor ? pipeline(resposta, descompressor, () => {}) : resposta;
        const tamanho = Number(resposta.headers['content-length']);
        resolva({
          status: resposta.statusCode ?? 0,
          location: resposta.headers.location ?? null,
          tipo: resposta.headers['content-type'] ?? null,
          // Comprimido, o tamanho anunciado não é o do arquivo: conta-se lendo.
          tamanho: !descompressor && Number.isFinite(tamanho) ? tamanho : null,
          corpo,
        });
      },
    );
    pedido.on('error', rejeite);
    pedido.end();
  });
}

async function lerAte(corpo: Readable, teto: number): Promise<Buffer> {
  const pedacos: Buffer[] = [];
  let total = 0;
  for await (const pedaco of corpo) {
    const b = pedaco as Buffer;
    total += b.length;
    if (total > teto) {
      corpo.destroy();
      throw new Recusa('grande_demais');
    }
    pedacos.push(b);
  }
  return Buffer.concat(pedacos);
}

/**
 * O arquivo do endereço, ou o motivo de não ter vindo: 'url_invalida',
 * 'url_bloqueada', 'nao_respondeu', 'status_<n>', 'grande_demais' ou
 * 'redirecionamentos_demais'. Não lança.
 */
export async function buscarDeFora(endereco: string, o: OpcoesDaBusca): Promise<Busca> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), o.tempoMs);
  try {
    let atual = endereco;
    for (let saltos = 0; ; saltos++) {
      const avaliada = avaliarUrl(atual, o.permitirLocal);
      if (!avaliada.ok) return avaliada;
      const r = await pedir(avaliada.url, o, controle.signal);
      if (r.status >= 300 && r.status < 400 && r.location) {
        r.corpo.destroy();
        if (saltos >= REDIRECIONAMENTOS) return { ok: false, motivo: 'redirecionamentos_demais' };
        atual = new URL(r.location, avaliada.url).href;
        continue;
      }
      if (r.status < 200 || r.status >= 300) {
        r.corpo.destroy();
        return { ok: false, motivo: `status_${r.status}` };
      }
      if (r.tamanho !== null && r.tamanho > o.teto) {
        r.corpo.destroy();
        return { ok: false, motivo: 'grande_demais' };
      }
      return { ok: true, bytes: await lerAte(r.corpo, o.teto), tipo: r.tipo };
    }
  } catch (e) {
    if (e instanceof Recusa) return { ok: false, motivo: e.motivo };
    // Tempo esgotado, nome que não existe, conexão recusada, certificado inválido.
    return { ok: false, motivo: 'nao_respondeu' };
  } finally {
    clearTimeout(relogio);
  }
}
