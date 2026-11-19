import { describe, expect, it } from 'vitest';

import { hostBloqueado, temLinkBloqueado } from './bloqueio';
import { contatoValido, TOKEN_DO_ROBO, userAgent } from './identidade';
import {
  decodificar,
  entidades,
  jsonLd,
  lerRobots,
  locsDoSitemap,
  Navegador,
  numeroBR,
  permitidoPeloRobots,
  semTags,
} from './web';

describe('robots.txt (RFC 9309)', () => {
  const texto = [
    'User-agent: *',
    'Disallow: /busca-imoveis.html',
    'Disallow: /privado/',
    'Allow: /privado/aberto',
    'Disallow: /*?pg=',
    'Disallow: /fim$',
    'Crawl-delay: 7',
    '',
    'User-agent: GPTBot',
    'Disallow: /',
  ].join('\n');
  const r = lerRobots(texto, TOKEN_DO_ROBO);

  it('usa o grupo "*" quando não há grupo com o nosso nome', () => {
    expect(r.grupo).toBe('*');
    expect(r.atraso).toBe(7);
  });

  it('fecha e abre pelos caminhos, com a regra mais longa vencendo', () => {
    expect(permitidoPeloRobots(r, 'https://x.com.br/')).toBe(true);
    expect(permitidoPeloRobots(r, 'https://x.com.br/busca-imoveis.html')).toBe(false);
    expect(permitidoPeloRobots(r, 'https://x.com.br/privado/qualquer')).toBe(false);
    expect(permitidoPeloRobots(r, 'https://x.com.br/privado/aberto')).toBe(true);
    expect(permitidoPeloRobots(r, 'https://x.com.br/lista?pg=2')).toBe(false);
    expect(permitidoPeloRobots(r, 'https://x.com.br/fim')).toBe(false);
    expect(permitidoPeloRobots(r, 'https://x.com.br/fim/mais')).toBe(true);
  });

  it('o grupo com o nosso nome vale sobre o "*"', () => {
    const nosso = lerRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: coletor-de-dados-publicos\nAllow: /api/mcp\nDisallow: /',
      TOKEN_DO_ROBO,
    );
    expect(nosso.grupo).toBe(TOKEN_DO_ROBO);
    expect(permitidoPeloRobots(nosso, 'https://x.com.br/api/mcp/')).toBe(true);
    expect(permitidoPeloRobots(nosso, 'https://x.com.br/imovel/1')).toBe(false);
  });

  it('"Disallow:" vazio libera tudo', () => {
    expect(
      permitidoPeloRobots(
        lerRobots('User-agent: *\nDisallow:', TOKEN_DO_ROBO),
        'https://x.com.br/a',
      ),
    ).toBe(true);
  });
});

/** Um servidor de mentira: rotas → resposta. Conta os pedidos e guarda os cabeçalhos. */
function servidor(rotas: Record<string, () => Response>) {
  const pedidos: Array<{
    url: string;
    ua: string | null;
    metodo: string;
    corpo: unknown;
    redirect: RequestInit['redirect'];
  }> = [];
  const fetchImpl = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada);
    const h = new Headers(init?.headers);
    pedidos.push({
      url,
      ua: h.get('user-agent'),
      metodo: init?.method ?? 'GET',
      corpo: init?.body,
      redirect: init?.redirect,
    });
    const f = rotas[url];
    return f ? f() : new Response('não achei', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, pedidos };
}

/** Um redirecionamento de verdade (o fetch com redirect: 'manual' devolve o 3xx com o Location). */
const redireciona =
  (para: string, status = 302) =>
  () =>
    new Response(null, { status, headers: { location: para } });

function relogio() {
  let t = 1_000_000;
  const esperas: number[] = [];
  return {
    agora: () => t,
    dormir: async (ms: number) => {
      esperas.push(ms);
      t += ms;
    },
    passar: (ms: number) => {
      t += ms;
    },
    esperas,
  };
}

function navegador(
  rotas: Record<string, () => Response>,
  extra: Partial<ConstructorParameters<typeof Navegador>[0]> = {},
) {
  const s = servidor(rotas);
  const r = relogio();
  const n = new Navegador({
    urlDaFonte: 'https://www.site-permitido.com.br/',
    intervaloMs: 5_000,
    maxPedidos: 10,
    prazo: r.agora() + 3_600_000,
    userAgent: userAgent(),
    tokenDoRobo: TOKEN_DO_ROBO,
    fetchImpl: s.fetchImpl,
    agora: r.agora,
    dormir: r.dormir,
    ...extra,
  });
  return { n, s, r };
}

describe('Navegador educado', () => {
  it('lê o robots.txt antes e respeita o intervalo entre páginas', async () => {
    const { n, s, r } = navegador({
      'https://www.site-permitido.com.br/robots.txt': () =>
        new Response('User-agent: *\nDisallow: /fechado'),
      'https://www.site-permitido.com.br/a': () => new Response('<html>a</html>'),
      'https://www.site-permitido.com.br/b': () => new Response('<html>b</html>'),
    });
    expect(await n.abrir('/')).toBe(true);
    const a = await n.pagina('https://www.site-permitido.com.br/a');
    const b = await n.pagina('https://www.site-permitido.com.br/b');
    expect(a?.texto).toContain('a');
    expect(b?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.pedidos.map((p) => p.url)).toEqual([
      'https://www.site-permitido.com.br/robots.txt',
      'https://www.site-permitido.com.br/a',
      'https://www.site-permitido.com.br/b',
    ]);
    // Dois intervalos de 5 s esperados (entre robots→a e a→b).
    expect(r.esperas).toEqual([5_000, 5_000]);
  });

  it('se identifica de forma honesta: sem "Mozilla", sem o nome da empresa', async () => {
    const { n, s } = navegador({
      'https://www.site-permitido.com.br/robots.txt': () => new Response(''),
    });
    await n.abrir();
    const ua = s.pedidos[0]?.ua ?? '';
    expect(ua).toMatch(/^coletor-de-dados-publicos\/1\.0/);
    expect(ua).not.toMatch(/mozilla|imova|komune|triade/i);
  });

  it('não pede página que o robots fecha', async () => {
    const { n, s } = navegador({
      'https://www.site-permitido.com.br/robots.txt': () =>
        new Response('User-agent: *\nDisallow: /fechado'),
    });
    await n.abrir();
    expect(await n.pagina('https://www.site-permitido.com.br/fechado/1')).toBeNull();
    expect(s.pedidos).toHaveLength(1);
    expect(n.fechadosPeloRobots).toHaveLength(1);
  });

  it('robots 404 é "sem regra"; robots 5xx ou HTML para a fonte', async () => {
    const sem = navegador({});
    expect(await sem.n.abrir()).toBe(true);
    const cai = navegador({
      'https://www.site-permitido.com.br/robots.txt': () => new Response('erro', { status: 503 }),
    });
    expect(await cai.n.abrir()).toBe(false);
    expect(cai.n.parada).toMatch(/HTTP 503/);
    const html = navegador({
      'https://www.site-permitido.com.br/robots.txt': () =>
        new Response('<html><body>oi</body></html>'),
    });
    expect(await html.n.abrir()).toBe(false);
    expect(html.n.parada).toMatch(/HTML/);
  });

  it('robots ilegível (5xx) há 30 dias seguidos vale como "sem robots" (RFC 9309 §2.3.1.4)', async () => {
    const rotas = {
      'https://www.site-permitido.com.br/robots.txt': () => new Response('erro', { status: 502 }),
    };
    const novo = navegador(rotas, { hoje: '2026-11-18' });
    expect(await novo.n.abrir()).toBe(false);
    expect(novo.n.robotsIlegivel).toEqual({ 'https://www.site-permitido.com.br': '2026-11-18' });
    const dez = navegador(rotas, {
      hoje: '2026-11-28',
      robotsIlegivelDesde: { 'https://www.site-permitido.com.br': '2026-11-18' },
    });
    expect(await dez.n.abrir()).toBe(false);
    const trinta = navegador(rotas, {
      hoje: '2026-12-18',
      robotsIlegivelDesde: { 'https://www.site-permitido.com.br': '2026-11-18' },
    });
    expect(await trinta.n.abrir()).toBe(true);
    expect(trinta.n.robotsLidos()[0]?.grupo).toMatch(/30 dias/);
  });

  it('robots que fecha o site inteiro: a fonte não roda', async () => {
    const { n } = navegador({
      'https://www.site-permitido.com.br/robots.txt': () =>
        new Response('User-agent: *\nDisallow: /'),
    });
    expect(await n.abrir()).toBe(false);
  });

  it('para no 429 e no 403, sem nova tentativa', async () => {
    let vezes = 0;
    const { n } = navegador({
      'https://www.site-permitido.com.br/robots.txt': () => new Response(''),
      'https://www.site-permitido.com.br/a': () => {
        vezes += 1;
        return new Response('devagar', { status: 429 });
      },
      'https://www.site-permitido.com.br/b': () => new Response('ok'),
    });
    await n.abrir();
    const a = await n.pagina('https://www.site-permitido.com.br/a');
    expect(a?.status).toBe(429);
    expect(vezes).toBe(1);
    expect(await n.pagina('https://www.site-permitido.com.br/b')).toBeNull();
    expect(n.parada).toMatch(/pediu para parar/);
  });

  it('tenta de novo em 5xx (no mesmo ritmo) e desiste depois', async () => {
    let vezes = 0;
    const { n } = navegador({
      'https://www.site-permitido.com.br/robots.txt': () => new Response(''),
      'https://www.site-permitido.com.br/a': () => {
        vezes += 1;
        return new Response('x', { status: 502 });
      },
    });
    await n.abrir();
    const a = await n.pagina('https://www.site-permitido.com.br/a');
    expect(vezes).toBe(3);
    expect(a?.erro).toBe('HTTP 502');
  });

  it('recusa host fora da fonte e domínio bloqueado, antes de sair o pedido', async () => {
    const { n, s } = navegador({
      'https://www.site-permitido.com.br/robots.txt': () => new Response(''),
    });
    await n.abrir();
    expect(await n.pagina('https://outro-site.com.br/a')).toBeNull();
    expect(await n.pagina('https://www.zapimoveis.com.br/imovel/1')).toBeNull();
    expect(n.motivoDeRecusa('https://www.zapimoveis.com.br/imovel/1')).toMatch(/bloqueado/);
    expect(n.motivoDeRecusa('https://usuario:senha@www.site-permitido.com.br/')).toMatch(/login/);
    expect(s.pedidos).toHaveLength(1);
  });

  it('respeita o teto de pedidos por rodada e o Crawl-delay maior', async () => {
    const rotas: Record<string, () => Response> = {
      'https://www.site-permitido.com.br/robots.txt': () =>
        new Response('User-agent: *\nCrawl-delay: 9'),
    };
    for (let i = 0; i < 5; i += 1)
      rotas[`https://www.site-permitido.com.br/${i}`] = () => new Response('ok');
    const { n, r } = navegador(rotas, { maxPedidos: 3 });
    await n.abrir();
    await n.pagina('https://www.site-permitido.com.br/0');
    await n.pagina('https://www.site-permitido.com.br/1');
    expect(await n.pagina('https://www.site-permitido.com.br/2')).toBeNull();
    expect(n.parada).toMatch(/teto/);
    expect(r.esperas.every((ms) => ms === 9_000)).toBe(true);
  });

  describe('redirecionamento seguido à mão', () => {
    it('302 para um portal proibido: nenhum pedido sai para o portal', async () => {
      const { n, s } = navegador({
        'https://www.site-permitido.com.br/robots.txt': () => new Response(''),
        'https://www.site-permitido.com.br/a': redireciona('https://www.vivareal.com.br/imovel/1'),
        'https://www.vivareal.com.br/robots.txt': () => new Response(''),
        'https://www.vivareal.com.br/imovel/1': () => new Response('<html>portal</html>'),
      });
      await n.abrir();
      const a = await n.pagina('https://www.site-permitido.com.br/a');
      expect(a?.texto).toBeNull();
      expect(a?.status).toBe(302);
      expect(a?.erro).toMatch(/fora da fonte.*bloqueado/);
      // Nem o relatório guarda o nome do portal: fica o endereço da fonte.
      expect(a?.url).toBe('https://www.site-permitido.com.br/a');
      expect(JSON.stringify(a)).not.toMatch(/vivareal/);
      expect(n.fechadosPeloRobots.join(' ')).not.toMatch(/vivareal/);
      expect(s.pedidos.map((p) => p.url)).toEqual([
        'https://www.site-permitido.com.br/robots.txt',
        'https://www.site-permitido.com.br/a',
      ]);
      expect(s.pedidos.some((p) => /vivareal/.test(p.url))).toBe(false);
      // O fetch nunca segue sozinho.
      expect(s.pedidos.every((p) => p.redirect === 'manual')).toBe(true);
    });

    it('para outro site qualquer (fora da fonte): também não sai', async () => {
      const { n, s } = navegador({
        'https://www.site-permitido.com.br/robots.txt': () => new Response(''),
        'https://www.site-permitido.com.br/a': redireciona('https://outro-site.com.br/x', 301),
      });
      await n.abrir();
      expect((await n.pagina('https://www.site-permitido.com.br/a'))?.erro).toMatch(
        /fora da fonte/,
      );
      expect(s.pedidos.some((p) => /outro-site/.test(p.url))).toBe(false);
    });

    it('para um caminho que o robots fecha, no mesmo host: não sai', async () => {
      const { n, s } = navegador({
        'https://www.site-permitido.com.br/robots.txt': () =>
          new Response('User-agent: *\nDisallow: /fechado'),
        'https://www.site-permitido.com.br/a': redireciona('/fechado/1', 301),
        'https://www.site-permitido.com.br/fechado/1': () => new Response('não devia'),
      });
      await n.abrir();
      const a = await n.pagina('https://www.site-permitido.com.br/a');
      expect(a?.erro).toMatch(/robots/);
      expect(s.pedidos.map((p) => p.url)).not.toContain(
        'https://www.site-permitido.com.br/fechado/1',
      );
      expect(n.fechadosPeloRobots).toContain('https://www.site-permitido.com.br/fechado/1');
    });

    it('para o mesmo site sem "www": lê o robots do destino, respeita o ritmo e conta no teto', async () => {
      const { n, s, r } = navegador({
        'https://www.site-permitido.com.br/robots.txt': () => new Response(''),
        'https://www.site-permitido.com.br/a': redireciona('https://site-permitido.com.br/a'),
        'https://site-permitido.com.br/robots.txt': () => new Response('User-agent: *\nAllow: /'),
        'https://site-permitido.com.br/a': () => new Response('<html>a</html>'),
      });
      await n.abrir();
      const a = await n.pagina('https://www.site-permitido.com.br/a');
      expect(a?.texto).toContain('a');
      expect(a?.url).toBe('https://site-permitido.com.br/a');
      expect(s.pedidos.map((p) => p.url)).toEqual([
        'https://www.site-permitido.com.br/robots.txt',
        'https://www.site-permitido.com.br/a',
        'https://site-permitido.com.br/robots.txt',
        'https://site-permitido.com.br/a',
      ]);
      expect(n.pedidos).toBe(4);
      expect(r.esperas).toEqual([5_000, 5_000]);
    });

    it('303 depois de POST vira GET sem corpo', async () => {
      const { n, s } = navegador({
        'https://www.site-permitido.com.br/robots.txt': () => new Response(''),
        'https://www.site-permitido.com.br/api': redireciona('/resultado', 303),
        'https://www.site-permitido.com.br/resultado': () => new Response('{"ok":true}'),
      });
      await n.abrir();
      const r = await n.json<{ ok: boolean }>('https://www.site-permitido.com.br/api', {
        metodo: 'POST',
        corpo: '{"q":1}',
      });
      expect(r?.dado.ok).toBe(true);
      expect(
        s.pedidos
          .slice(1)
          .map((p) => `${p.metodo} ${p.url} ${p.corpo === undefined ? '-' : 'corpo'}`),
      ).toEqual([
        'POST https://www.site-permitido.com.br/api corpo',
        'GET https://www.site-permitido.com.br/resultado -',
      ]);
    });

    it('mais de 5 saltos: desiste', async () => {
      const rotas: Record<string, () => Response> = {
        'https://www.site-permitido.com.br/robots.txt': () => new Response(''),
      };
      for (let i = 0; i < 10; i += 1)
        rotas[`https://www.site-permitido.com.br/${i}`] = redireciona(`/${i + 1}`);
      const { n, s } = navegador(rotas, { maxPedidos: 50 });
      await n.abrir();
      const a = await n.pagina('https://www.site-permitido.com.br/0');
      expect(a?.erro).toMatch(/mais de 5 redirecionamentos/);
      expect(s.pedidos).toHaveLength(1 + 6);
    });

    it('o robots.txt redirecionado para um portal: a fonte para, e nada é pedido ao portal', async () => {
      const { n, s } = navegador({
        'https://www.site-permitido.com.br/robots.txt': redireciona(
          'https://www.zapimoveis.com.br/robots.txt',
        ),
        'https://www.zapimoveis.com.br/robots.txt': () => new Response(''),
      });
      expect(await n.abrir()).toBe(false);
      expect(n.parada).toMatch(/robots\.txt redirecionado para fora da fonte/);
      expect(n.parada).not.toMatch(/zapimoveis/);
      expect(s.pedidos.map((p) => p.url)).toEqual(['https://www.site-permitido.com.br/robots.txt']);
    });

    it('o robots.txt da Fipe (302 e 301 até um 404 do site da Fipe): "sem regra" só com o host declarado', async () => {
      const rotas = {
        'https://downloads.fipe.org.br/robots.txt': redireciona(
          'http://www.fipe.org.br/pt-br/pagina-nao-encontrada',
        ),
        'http://www.fipe.org.br/pt-br/pagina-nao-encontrada': redireciona(
          'https://www.fipe.org.br/pt-br/pagina-nao-encontrada',
          301,
        ),
        'https://www.fipe.org.br/pt-br/pagina-nao-encontrada': () =>
          new Response('<html>Página não encontrada</html>', { status: 404 }),
        'https://downloads.fipe.org.br/indices/fipezap/fipezap-serieshistoricas.xlsx': () =>
          new Response('xlsx'),
      };
      const fonte = 'https://downloads.fipe.org.br/indices/fipezap/fipezap-serieshistoricas.xlsx';
      const sem = navegador(rotas, { urlDaFonte: fonte });
      expect(await sem.n.abrir('/indices/fipezap/fipezap-serieshistoricas.xlsx')).toBe(false);
      expect(sem.s.pedidos).toHaveLength(1);
      const com = navegador(rotas, { urlDaFonte: fonte, hostsExtras: ['www.fipe.org.br'] });
      expect(await com.n.abrir('/indices/fipezap/fipezap-serieshistoricas.xlsx')).toBe(true);
      expect(com.n.robotsLidos()[0]?.status).toBe(404);
      expect((await com.n.pagina(fonte, { binario: true }))?.bytes?.toString()).toBe('xlsx');
      expect(com.s.pedidos).toHaveLength(4);
    });

    it('o robots.txt redirecionado de http para https, no mesmo host: segue', async () => {
      const { n, s } = navegador(
        {
          'http://www.site-permitido.com.br/robots.txt': redireciona(
            'https://www.site-permitido.com.br/robots.txt',
            301,
          ),
          'https://www.site-permitido.com.br/robots.txt': () =>
            new Response('User-agent: *\nDisallow: /fechado'),
        },
        { urlDaFonte: 'http://www.site-permitido.com.br/' },
      );
      expect(await n.abrir()).toBe(true);
      expect(await n.podePedir('http://www.site-permitido.com.br/fechado/1')).toBe(false);
      expect(s.pedidos).toHaveLength(2);
    });
  });
});

describe('bloqueio e identificação', () => {
  it('bloqueia o Grupo OLX e parecidos, inclusive subdomínio; não bloqueia a Fipe', () => {
    expect(hostBloqueado('www.zapimoveis.com.br')).toBe(true);
    expect(hostBloqueado('canalpro.grupozap.com')).toBe(true);
    expect(hostBloqueado('imoveis.grupoolx.com.br')).toBe(true);
    expect(hostBloqueado('deztop.com')).toBe(true);
    expect(hostBloqueado('downloads.fipe.org.br')).toBe(false);
    expect(hostBloqueado('www.chavesnamao.com.br')).toBe(false);
    expect(hostBloqueado('img.olx.qualquer.com', ['olx'])).toBe(true);
  });

  it('acha link bloqueado escondido em qualquer campo', () => {
    expect(temLinkBloqueado({ a: 1, bruto: { obs: 'veja em www.vivareal.com.br/123' } })).toBe(
      true,
    );
    expect(
      temLinkBloqueado({ titulo: 'Casa em Pipa', url: 'https://www.zilmonteiro.com.br/imovel/1' }),
    ).toBe(false);
  });

  it('o contato do robô é um e-mail genérico, nunca com o nome da empresa', () => {
    expect(contatoValido(undefined).ok).toBe(true);
    expect(contatoValido('dados.publicos@exemplo.com').ok).toBe(true);
    expect(contatoValido('robo@imova.com.br').ok).toBe(false);
    expect(contatoValido('não é e-mail').ok).toBe(false);
    expect(userAgent('dados.publicos@exemplo.com')).toBe(
      'coletor-de-dados-publicos/1.0 (+contato: dados.publicos@exemplo.com)',
    );
  });
});

describe('peças de leitura', () => {
  it('lê número no jeito brasileiro', () => {
    expect(numeroBR('R$ 1.250.000,00')).toBe(1_250_000);
    expect(numeroBR('1.250')).toBe(1250);
    expect(numeroBR('98,5 m²')).toBe(98.5);
    expect(numeroBR('450.90')).toBe(450.9);
    expect(numeroBR('consulte')).toBeNull();
    expect(numeroBR(0)).toBeNull();
  });

  it('decodifica entidades, tira tags e lê o charset certo', () => {
    expect(entidades('&Aacute;rea &uacute;til 98m&sup2; &#233; &#x00e7;')).toBe(
      'Área útil 98m² é ç',
    );
    expect(semTags('<p>Casa <b>linda</b><script>x()</script></p>')).toBe('Casa linda');
    const latin1 = Buffer.from('<meta charset="iso-8859-1">Área', 'latin1');
    expect(decodificar(latin1, null)).toContain('Área');
  });

  it('lê JSON-LD (inclusive @graph e bloco com caractere de controle) e o mapa do site', () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"A"}]}</script>
      <script type="application/ld+json">{"@type":"Product","name":"B\u0001"}</script>`;
    expect(jsonLd(html).map((b) => b.name)).toEqual(['A', 'B ']);
    expect(
      locsDoSitemap(
        '<urlset><url><loc>https://a.com/1?x=1&amp;y=2</loc></url><url><loc><![CDATA[https://a.com/2]]></loc></url></urlset>',
      ),
    ).toEqual(['https://a.com/1?x=1&y=2', 'https://a.com/2']);
  });
});
