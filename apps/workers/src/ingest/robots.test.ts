import { describe, expect, it } from 'vitest';

import { analisarRobots, avaliarCaminho, caminhoDaUrl, grupoParaAgente } from './robots';

const AGENTE = 'KomuneBot/1.0 (+https://komune.app.br)';

/** Recorte fiel do robots.txt do Casamentos.com.br (buscado em 05/09/2026). */
const CASAMENTOS = `
# updated 04/09/2026
User-agent: *
Disallow: /admin/
Disallow: /emp-ShowTelefonoTrace.php
Disallow: /emp-ShowTelefonoTrace.php?*
Disallow: /emp-ShowWebsiteTrace.php
Disallow: /busc-Filters.php
Allow: /json/empFotoGalleryEmpresa.php
Disallow: /json/
Disallow: /apps/empresas/

User-agent: GPTBot
Disallow: /

Sitemap: https://www.casamentos.com.br/sitemaps/desktop/vendor-catalog-index.xml
`;

describe('analisarRobots', () => {
  it('separa os grupos e guarda os sitemaps', () => {
    const arquivo = analisarRobots(CASAMENTOS);
    expect(arquivo.grupos).toHaveLength(2);
    expect(arquivo.grupos[0]?.agentes).toEqual(['*']);
    expect(arquivo.grupos[1]?.agentes).toEqual(['gptbot']);
    expect(arquivo.sitemaps).toHaveLength(1);
  });

  it('ignora comentário, linha vazia e linha sem dois-pontos', () => {
    const arquivo = analisarRobots('# só comentário\n\nlixo\nUser-agent: *\nDisallow: /x # nota\n');
    expect(arquivo.grupos).toHaveLength(1);
    expect(arquivo.grupos[0]?.regras[0]?.padrao).toBe('/x');
  });

  it('trata duas linhas User-agent seguidas como um grupo só', () => {
    const arquivo = analisarRobots('User-agent: a\nUser-agent: b\nDisallow: /z\n');
    expect(arquivo.grupos).toHaveLength(1);
    expect(arquivo.grupos[0]?.agentes).toEqual(['a', 'b']);
  });

  it('não transforma "Disallow:" vazio em proibição geral', () => {
    const arquivo = analisarRobots('User-agent: *\nDisallow:\n');
    expect(arquivo.grupos[0]?.regras).toHaveLength(0);
    expect(avaliarCaminho(arquivo, AGENTE, '/qualquer').permitido).toBe(true);
  });

  it('lê Crawl-delay', () => {
    const arquivo = analisarRobots('User-agent: *\nCrawl-delay: 7\nDisallow: /x\n');
    expect(grupoParaAgente(arquivo, AGENTE)?.atrasoSegundos).toBe(7);
  });
});

describe('avaliarCaminho no robots do Casamentos', () => {
  const arquivo = analisarRobots(CASAMENTOS);

  it('libera as listagens e os perfis, que é o que o Radar coleta', () => {
    expect(avaliarCaminho(arquivo, AGENTE, '/cerimonialista/rio-grande-do-norte/natal').permitido).toBe(
      true,
    );
    expect(
      avaliarCaminho(arquivo, AGENTE, '/cerimonialista/triunfal-cerimonial--e137503').permitido,
    ).toBe(true);
  });

  it('proíbe o endpoint de "ver telefone" — e é por isso que o coletor não o chama', () => {
    const veredito = avaliarCaminho(arquivo, AGENTE, '/emp-ShowTelefonoTrace.php?id=137503');
    expect(veredito.permitido).toBe(false);
    expect(veredito).toMatchObject({ regra: 'Disallow: /emp-ShowTelefonoTrace.php?*' });
  });

  it('deixa passar a exceção mais específica dentro de uma pasta proibida', () => {
    // Disallow: /json/ e Allow: /json/empFotoGalleryEmpresa.php — vence o padrão mais longo.
    expect(avaliarCaminho(arquivo, AGENTE, '/json/qualquer.php').permitido).toBe(false);
    expect(avaliarCaminho(arquivo, AGENTE, '/json/empFotoGalleryEmpresa.php').permitido).toBe(true);
  });

  it('não confunde o nosso agente com o grupo do GPTBot', () => {
    expect(grupoParaAgente(arquivo, AGENTE)?.agente).toBe('*');
    expect(grupoParaAgente(arquivo, 'GPTBot')?.agente).toBe('gptbot');
    expect(avaliarCaminho(arquivo, 'GPTBot', '/cerimonialista/natal').permitido).toBe(false);
  });
});

describe('regras de precedência da RFC 9309', () => {
  it('o padrão mais longo vence, e no empate exato o Allow vence', () => {
    const arquivo = analisarRobots('User-agent: *\nDisallow: /a\nAllow: /a\n');
    expect(avaliarCaminho(arquivo, AGENTE, '/a/b').permitido).toBe(true);
  });

  it('entende o curinga * e a âncora $', () => {
    const arquivo = analisarRobots('User-agent: *\nDisallow: /*.pdf$\n');
    expect(avaliarCaminho(arquivo, AGENTE, '/pasta/arquivo.pdf').permitido).toBe(false);
    expect(avaliarCaminho(arquivo, AGENTE, '/pasta/arquivo.pdf.html').permitido).toBe(true);
  });

  it('prefere o grupo específico ao grupo curinga', () => {
    const arquivo = analisarRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: komunebot\nDisallow: /privado\n',
    );
    expect(avaliarCaminho(arquivo, AGENTE, '/listagem').permitido).toBe(true);
    expect(avaliarCaminho(arquivo, AGENTE, '/privado/x').permitido).toBe(false);
  });

  it('sem grupo nenhum que sirva, não há regra a respeitar', () => {
    const arquivo = analisarRobots('User-agent: outrobot\nDisallow: /\n');
    expect(avaliarCaminho(arquivo, AGENTE, '/x')).toEqual({ permitido: true, motivo: 'sem_regra' });
  });
});

describe('caminhoDaUrl', () => {
  it('usa rota mais query, que é o que o robots avalia', () => {
    expect(caminhoDaUrl('https://www.casamentos.com.br/emp-ShowTelefonoTrace.php?id=1#x')).toBe(
      '/emp-ShowTelefonoTrace.php?id=1',
    );
  });
});
