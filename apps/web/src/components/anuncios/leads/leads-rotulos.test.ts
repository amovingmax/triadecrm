import { describe, expect, it } from 'vitest';

import {
  chegouEm,
  comoChegou,
  comoChegouOLead,
  contagemPorSituacao,
  contatoApagaEm,
  cortarMensagem,
  dataHoraDoLead,
  duracao,
  ehLeadDoWhatsapp,
  estaNoGrupo,
  filtrarLeads,
  FILTROS_INICIAIS,
  fraseDaOrigem,
  jeitoDeChegar,
  marcaRespondidoAMao,
  nomeDoLead,
  nomeNoPortalDiferente,
  origemDoLead,
  escreveuNoPortal,
  primeiraMensagemDoLead,
  recebidoHa,
  respostaDoLead,
  resumoDosLeads,
  resumoDosTipos,
  resumoPorAnuncio,
  rotuloDaTransacao,
  rotuloDoPortal,
  rotuloDoTipo,
  temperaturaDoLead,
  tiposDoLead,
  type LeadDoPortal,
} from './leads-rotulos';

function lead(parcial: Partial<LeadDoPortal> = {}): LeadDoPortal {
  return {
    id: 'l1',
    origem: 'grupo_olx',
    origin_lead_id: 'o1',
    origem_no_portal: 'Grupo OLX',
    client_listing_id: 'SA0012_IMOVA',
    origin_listing_id: '2712345678',
    anuncio_id: 'a1',
    anuncio_no_canal_pro_id: null,
    organization_id: 'org1',
    tipos: ['CLICK_WHATSAPP'],
    temperatura: 'Alta',
    transacao: 'SELL',
    lead_certo: false,
    mcmv: false,
    mensagem: null,
    link_historico: null,
    recebido_no_portal_em: null,
    recebido_em: '2026-11-05T12:00:00Z',
    situacao: 'novo',
    situacao_registrada: 'novo',
    responsavel_id: null,
    responsavel_nome: null,
    motivo_descarte: null,
    situacao_em: null,
    situacao_por: null,
    suprimido: false,
    ficha_nome: 'Maria José',
    nome_no_portal: 'Maria José',
    phone_e164: '+5584999990000',
    email: null,
    phone_is_masked: false,
    anuncio_codigo: 'SA0012_IMOVA',
    anuncio_titulo: 'Apartamento em Ponta Negra',
    conversation_id: null,
    grupo: 'mensagem',
    chegou_por: 'whatsapp',
    chegou_em: null,
    primeira_mensagem: null,
    primeira_mensagem_tipo: null,
    respondido_em: null,
    respondido_por_nome: null,
    contato_apagado_em: null,
    portal: null,
    ...parcial,
  };
}

/** O lead que nasce da conversa de WhatsApp (12/11/2026, migração 20261112180000). */
function leadDoWhatsapp(parcial: Partial<LeadDoPortal> = {}): LeadDoPortal {
  return lead({
    origem: 'whatsapp',
    origin_lead_id: 'whatsapp:c1',
    origem_no_portal: null,
    origin_listing_id: '2812345678',
    tipos: ['WHATSAPP_DO_PORTAL'],
    temperatura: null,
    conversation_id: 'conv1',
    portal: 'zap',
    ...parcial,
  });
}

// 05/11/2026 15:00 em Natal (UTC-3).
const AGORA = new Date('2026-11-05T18:00:00Z');

describe('tipo de contato', () => {
  it('dá nome aos tipos do Grupo OLX e um nome genérico ao que não conhece', () => {
    expect(rotuloDoTipo('CLICK_WHATSAPP')).toBe('WhatsApp');
    expect(rotuloDoTipo('PHONE_VIEW')).toBe('Viu o telefone');
    expect(rotuloDoTipo('VISIT_REQUEST')).toBe('Pediu visita');
    expect(rotuloDoTipo('NOVO_TIPO')).toBe('Outro contato');
  });

  it('o tipo do CRM para o lead que nasce da conversa é "Mensagem no WhatsApp"', () => {
    expect(rotuloDoTipo('WHATSAPP_DO_PORTAL')).toBe('Mensagem no WhatsApp');
    expect(resumoDosTipos(['WHATSAPP_DO_PORTAL'])).toBe('Mensagem no WhatsApp');
  });

  it('tira repetição e põe o mais quente primeiro', () => {
    expect(tiposDoLead(['PHONE_VIEW', 'click_whatsapp', 'PHONE_VIEW', ' '])).toEqual([
      'CLICK_WHATSAPP',
      'PHONE_VIEW',
    ]);
    expect(tiposDoLead(null)).toEqual([]);
  });

  it('resume em uma frase', () => {
    expect(resumoDosTipos(['CONTACT_FORM'])).toBe('Formulário');
    expect(resumoDosTipos(['PHONE_VIEW', 'CLICK_WHATSAPP'])).toBe('WhatsApp e mais 1');
    expect(resumoDosTipos([])).toBe('Contato');
  });
});

describe('temperatura e negócio', () => {
  it('lê Alta, Média e Baixa com ou sem acento', () => {
    expect(temperaturaDoLead('Alta')).toEqual({ rotulo: 'Alta', tom: 'quente' });
    expect(temperaturaDoLead('MEDIA')).toEqual({ rotulo: 'Média', tom: 'morno' });
    expect(temperaturaDoLead('baixa')).toEqual({ rotulo: 'Baixa', tom: 'frio' });
    expect(temperaturaDoLead(null)).toBeNull();
    expect(temperaturaDoLead('quente')).toBeNull();
  });

  it('diz o que a pessoa quer', () => {
    expect(rotuloDaTransacao('SELL')).toBe('Quer comprar');
    expect(rotuloDaTransacao('rent')).toBe('Quer alugar');
    expect(rotuloDaTransacao(null)).toBeNull();
  });

  it('diz quem é a pessoa, com ou sem ficha', () => {
    expect(nomeDoLead(lead())).toEqual({ nome: 'Maria José', semNome: false });
    expect(nomeDoLead(lead({ ficha_nome: ' ' }))).toEqual({
      nome: 'Sem nome na ficha',
      semNome: true,
    });
    // Sem ficha, o nome é o que o portal mandou.
    expect(nomeDoLead(lead({ organization_id: null, ficha_nome: 'Paulo Mendes' }))).toEqual({
      nome: 'Paulo Mendes',
      semNome: false,
    });
    expect(nomeDoLead(lead({ organization_id: null, ficha_nome: null, suprimido: true }))).toEqual({
      nome: 'Pediu para não ser contatado',
      semNome: true,
    });
    expect(nomeDoLead(lead({ organization_id: null, ficha_nome: null })).nome).toBe(
      'Sem nome no portal',
    );
    expect(
      nomeDoLead(lead({ organization_id: null, ficha_nome: null, phone_e164: null })).nome,
    ).toBe('Sem telefone nem e-mail');
  });

  it('o contato apagado aos 90 dias diz que foi apagado', () => {
    const apagado = lead({
      organization_id: null,
      ficha_nome: null,
      phone_e164: null,
      contato_apagado_em: '2027-02-03T12:00:00Z',
    });
    expect(nomeDoLead(apagado)).toEqual({ nome: 'Contato apagado', semNome: true });
    expect(contatoApagaEm(lead({ recebido_em: '2026-11-05T12:00:00Z' }))).toBe(
      '2027-02-03T12:00:00.000Z',
    );
  });

  it('mostra o nome do portal só quando é outro que o da ficha', () => {
    expect(
      nomeNoPortalDiferente(lead({ ficha_nome: 'Marina', nome_no_portal: 'Marina Costa' })),
    ).toBe('Marina Costa');
    expect(
      nomeNoPortalDiferente(lead({ ficha_nome: 'José', nome_no_portal: ' jose ' })),
    ).toBeNull();
    expect(nomeNoPortalDiferente(lead({ nome_no_portal: null }))).toBeNull();
  });

  it('"marcar como respondido" é só de quem escreveu pelo portal', () => {
    expect(marcaRespondidoAMao(lead({ chegou_por: 'chat' }))).toBe(true);
    expect(marcaRespondidoAMao(lead({ chegou_por: 'visita' }))).toBe(true);
    // No WhatsApp a situação muda sozinha; quem só clicou não escreveu.
    expect(marcaRespondidoAMao(lead({ chegou_por: 'whatsapp' }))).toBe(false);
    expect(marcaRespondidoAMao(lead({ grupo: 'clicou', chegou_por: null }))).toBe(false);
  });
});

describe('como chegou e a primeira mensagem', () => {
  it('diz por onde a mensagem chegou', () => {
    expect(comoChegou('whatsapp')).toBe('Pelo WhatsApp');
    expect(comoChegou('chat')).toBe('Pelo chat do portal');
    expect(comoChegou('formulario')).toBe('Pelo formulário do portal');
    expect(comoChegou('visita')).toBe('Pediu visita pelo portal');
    expect(comoChegou(null)).toBeNull();
    expect(comoChegou('telepatia')).toBeNull();
  });

  it('o lead que nasce da conversa de WhatsApp tem rótulo próprio, com o portal', () => {
    expect(comoChegou('whatsapp_do_portal')).toBe('WhatsApp pelo portal');
    expect(comoChegouOLead(leadDoWhatsapp())).toBe('WhatsApp pelo ZAP Imóveis');
    expect(comoChegouOLead(leadDoWhatsapp({ portal: 'vivareal' }))).toBe('WhatsApp pelo Viva Real');
    expect(comoChegouOLead(leadDoWhatsapp({ portal: 'olx' }))).toBe('WhatsApp pela OLX');
    // Corrigido por gente para "Canal Pro", sem dizer qual portal.
    expect(comoChegouOLead(leadDoWhatsapp({ portal: null }))).toBe('WhatsApp pelo portal');
    // O aviso do Grupo OLX continua "Pelo WhatsApp", mesmo com o portal do par.
    expect(comoChegouOLead(lead({ portal: 'zap' }))).toBe('Pelo WhatsApp');
    expect(comoChegouOLead(lead({ chegou_por: 'chat' }))).toBe('Pelo chat do portal');
    expect(comoChegouOLead(lead({ grupo: 'clicou', chegou_por: null }))).toBeNull();
  });

  it('separa o lead do WhatsApp pela origem ou pelo tipo', () => {
    expect(ehLeadDoWhatsapp(leadDoWhatsapp())).toBe(true);
    expect(ehLeadDoWhatsapp(lead({ origem: null, tipos: ['WHATSAPP_DO_PORTAL'] }))).toBe(true);
    expect(ehLeadDoWhatsapp(lead())).toBe(false);
    // Para o banco a mensagem chegou 'whatsapp'; a tela separa.
    expect(jeitoDeChegar(leadDoWhatsapp({ chegou_por: 'whatsapp' }))).toBe('whatsapp_do_portal');
    expect(jeitoDeChegar(lead({ chegou_por: 'whatsapp' }))).toBe('whatsapp');
    expect(jeitoDeChegar(lead({ chegou_por: null }))).toBeNull();
  });

  it('diz o nome de cada portal', () => {
    expect(rotuloDoPortal('zap')).toBe('ZAP Imóveis');
    expect(rotuloDoPortal('vivareal')).toBe('Viva Real');
    expect(rotuloDoPortal('olx')).toBe('OLX');
    expect(rotuloDoPortal(null)).toBeNull();
    expect(rotuloDoPortal('toString')).toBeNull();
  });

  it('o lead do WhatsApp responde pela conversa, como o do aviso do WhatsApp', () => {
    expect(marcaRespondidoAMao(leadDoWhatsapp())).toBe(false);
  });

  it('mídia sem texto vira o nome da mídia; com legenda, os dois', () => {
    expect(
      primeiraMensagemDoLead(lead({ primeira_mensagem: 'Oi!', primeira_mensagem_tipo: 'text' })),
    ).toEqual({
      texto: 'Oi!',
      midia: false,
    });
    expect(primeiraMensagemDoLead(lead({ primeira_mensagem_tipo: 'audio' }))).toEqual({
      texto: 'Áudio',
      midia: true,
    });
    expect(primeiraMensagemDoLead(lead({ primeira_mensagem_tipo: 'location' }))?.texto).toBe(
      'Localização',
    );
    expect(
      primeiraMensagemDoLead(
        lead({ primeira_mensagem: 'a planta', primeira_mensagem_tipo: 'image' }),
      ),
    ).toEqual({ texto: 'Foto: a planta', midia: false });
    // A mensagem do portal vem sem tipo.
    expect(primeiraMensagemDoLead(lead({ primeira_mensagem: ' Quero visitar. ' }))?.texto).toBe(
      'Quero visitar.',
    );
    expect(primeiraMensagemDoLead(lead())).toBeNull();
    expect(primeiraMensagemDoLead(lead({ primeira_mensagem_tipo: 'system' }))).toBeNull();
  });

  it('o texto pronto do clique no WhatsApp não é mensagem da pessoa', () => {
    expect(escreveuNoPortal(['CONTACT_CHAT'])).toBe(true);
    expect(escreveuNoPortal(['click_whatsapp', 'VISIT_REQUEST'])).toBe(true);
    expect(escreveuNoPortal(['CLICK_WHATSAPP', 'PHONE_VIEW', 'CLICK_SCHEDULE'])).toBe(false);
    expect(escreveuNoPortal(null)).toBe(false);
  });
});

describe('de qual anúncio veio', () => {
  it('diz "veio do anúncio" quando a pessoa clicou nele', () => {
    expect(origemDoLead(lead())).toEqual({
      tipo: 'anuncio',
      codigo: 'SA0012_IMOVA',
      frase: 'Veio do anúncio SA0012_IMOVA',
    });
  });

  it('Lead Certo nunca "veio" do anúncio: é parecido com ele', () => {
    const o = origemDoLead(lead({ lead_certo: true }));
    expect(o.tipo).toBe('parecido');
    expect(o.frase).toBe('Parecido com o anúncio SA0012_IMOVA');
    expect(o.frase).not.toMatch(/veio/i);
  });

  it('usa o código do lead quando o anúncio não está no CRM', () => {
    expect(origemDoLead(lead({ anuncio_codigo: null, client_listing_id: 'a40171' })).frase).toBe(
      'Veio do anúncio a40171',
    );
  });

  it('simulação do Minha Casa Minha Vida e lead sem código', () => {
    expect(
      origemDoLead(lead({ anuncio_codigo: null, client_listing_id: null, mcmv: true })).tipo,
    ).toBe('mcmv');
    expect(origemDoLead(lead({ anuncio_codigo: null, client_listing_id: ' ' })).tipo).toBe(
      'sem_codigo',
    );
  });

  it('a etiqueta da conversa junta a origem e o tipo de contato', () => {
    const semCanal = { chegou_por: null };
    expect(fraseDaOrigem(lead(semCanal))).toBe('Veio do anúncio SA0012_IMOVA · WhatsApp');
    expect(fraseDaOrigem(lead({ ...semCanal, lead_certo: true, tipos: ['CONTACT_FORM'] }))).toBe(
      'Parecido com o anúncio SA0012_IMOVA · Formulário',
    );
    expect(fraseDaOrigem(lead({ ...semCanal, tipos: [] }))).toBe('Veio do anúncio SA0012_IMOVA');
  });

  it('o canal da etiqueta é por onde a mensagem chegou, não o toque mais quente', () => {
    // Tocou no WhatsApp, mas escreveu pelo chat do portal.
    expect(
      fraseDaOrigem(lead({ tipos: ['CLICK_WHATSAPP', 'CONTACT_CHAT'], chegou_por: 'chat' })),
    ).toBe('Veio do anúncio SA0012_IMOVA · Chat do portal');
    expect(fraseDaOrigem(lead({ chegou_por: 'whatsapp', tipos: ['PHONE_VIEW'] }))).toBe(
      'Veio do anúncio SA0012_IMOVA · WhatsApp',
    );
  });
});

describe('quando chegou, no fuso de Natal', () => {
  it('conta minutos e horas no mesmo dia', () => {
    expect(recebidoHa('2026-11-05T17:59:40Z', AGORA)).toBe('agora');
    expect(recebidoHa('2026-11-05T17:48:00Z', AGORA)).toBe('há 12 min');
    expect(recebidoHa('2026-11-05T15:00:00Z', AGORA)).toBe('há 3 h');
    // 08:10 em Natal: mais de 6 h atrás, ainda hoje.
    expect(recebidoHa('2026-11-05T11:10:00Z', AGORA)).toBe('hoje às 08:10');
  });

  it('vira o dia à meia-noite de Natal, não à de Londres', () => {
    // 04/11 às 23:30 em Natal = 05/11 02:30 UTC: é ontem.
    expect(recebidoHa('2026-11-05T02:30:00Z', AGORA)).toBe('ontem às 23:30');
    expect(recebidoHa('2026-11-03T12:10:00Z', AGORA)).toBe('03/11 às 09:10');
    expect(recebidoHa('2025-12-31T15:00:00Z', AGORA)).toBe('31/12/2025 às 12:00');
  });

  it('a data inteira para a ficha', () => {
    expect(dataHoraDoLead('2026-11-05T17:32:00Z')).toBe('05/11/2026 às 14:32');
    expect(dataHoraDoLead('lixo')).toBe('');
  });
});

describe('o tempo até a resposta', () => {
  it('escreve a duração por extenso curto', () => {
    expect(duracao(20_000)).toBe('menos de 1 min');
    expect(duracao(-5_000)).toBe('menos de 1 min');
    expect(duracao(13 * 60_000)).toBe('13 min');
    expect(duracao(65 * 60_000)).toBe('1 h 5 min');
    expect(duracao(120 * 60_000)).toBe('2 h');
    expect(duracao(25 * 3_600_000)).toBe('1 dia');
    expect(duracao(80 * 3_600_000)).toBe('3 dias');
  });

  it('respondido: em quanto tempo e quem', () => {
    const r = respostaDoLead(
      lead({
        chegou_em: '2026-11-05T18:25:27Z',
        respondido_em: '2026-11-05T18:38:27Z',
        respondido_por_nome: 'gestor.teste',
        situacao: 'respondido',
      }),
      AGORA,
    );
    expect(r).toEqual({
      respondido: true,
      frase: 'Respondido em 13 min · gestor.teste',
      detalhe: 'em 13 min · gestor.teste',
    });
  });

  it('sem resposta: há quanto tempo a pessoa espera, contando da mensagem', () => {
    // Clicou às 14:00 de Natal e escreveu às 14:46: espera desde a mensagem.
    const l = lead({
      recebido_no_portal_em: '2026-11-05T17:00:00Z',
      chegou_em: '2026-11-05T17:46:00Z',
    });
    expect(chegouEm(l)).toBe('2026-11-05T17:46:00Z');
    expect(respostaDoLead(l, AGORA)).toEqual({
      respondido: false,
      frase: 'Sem resposta há 14 min',
      detalhe: 'há 14 min',
    });
    expect(respostaDoLead(lead({ ...l, situacao: 'em_atendimento' }), AGORA)?.detalhe).toBe(
      'sem resposta há 14 min',
    );
  });

  it('descartado e quem só clicou não esperam resposta', () => {
    expect(respostaDoLead(lead({ situacao: 'descartado' }), AGORA)).toBeNull();
    expect(respostaDoLead(lead({ grupo: 'clicou', chegou_por: null }), AGORA)).toBeNull();
  });
});

describe('o resumo', () => {
  it('conta hoje, os últimos 7 dias e os sem resposta, sem os descartados', () => {
    const leads = [
      lead({ recebido_em: '2026-11-05T13:00:00Z', situacao: 'novo' }),
      lead({ recebido_em: '2026-11-05T02:30:00Z', situacao: 'respondido' }), // ontem em Natal
      lead({ recebido_em: '2026-10-30T13:00:00Z', situacao: 'novo' }), // 6 dias atrás
      lead({ recebido_em: '2026-10-29T13:00:00Z', situacao: 'em_atendimento' }), // 7 dias: fora
      lead({ recebido_em: '2026-11-05T14:00:00Z', situacao: 'descartado' }),
    ];
    expect(resumoDosLeads(leads, AGORA)).toEqual({
      hoje: 1,
      seteDias: 3,
      semResposta: 2,
      tempoMedioMs: null,
    });
  });

  it('só conta quem mandou mensagem', () => {
    const leads = [
      lead({ recebido_em: '2026-11-05T13:00:00Z' }),
      lead({ recebido_em: '2026-11-05T13:00:00Z', grupo: 'clicou', chegou_por: null }),
    ];
    expect(resumoDosLeads(leads, AGORA)).toMatchObject({ hoje: 1, seteDias: 1, semResposta: 1 });
  });

  it('a hora do portal vale mais que a hora em que o CRM recebeu', () => {
    const l = lead({
      recebido_no_portal_em: '2026-11-04T13:00:00Z',
      recebido_em: '2026-11-05T13:00:00Z',
    });
    expect(resumoDosLeads([l], AGORA).hoje).toBe(0);
  });

  it('a hora da mensagem no WhatsApp vale mais que a do clique', () => {
    const l = lead({
      recebido_no_portal_em: '2026-11-04T13:00:00Z', // clicou ontem
      chegou_em: '2026-11-05T12:00:00Z', // escreveu hoje
    });
    expect(resumoDosLeads([l], AGORA).hoje).toBe(1);
  });

  it('o tempo médio até a 1ª resposta, dos últimos 7 dias', () => {
    const leads = [
      lead({
        chegou_em: '2026-11-05T12:00:00Z',
        respondido_em: '2026-11-05T12:10:00Z',
        situacao: 'respondido',
      }),
      lead({
        chegou_em: '2026-11-04T12:00:00Z',
        respondido_em: '2026-11-04T12:30:00Z',
        situacao: 'respondido',
      }),
      // Fora dos 7 dias: não entra na média.
      lead({
        chegou_em: '2026-10-20T12:00:00Z',
        respondido_em: '2026-10-21T12:00:00Z',
        situacao: 'respondido',
      }),
      lead({ chegou_em: '2026-11-05T13:00:00Z' }), // sem resposta: não entra
    ];
    expect(resumoDosLeads(leads, AGORA).tempoMedioMs).toBe(20 * 60_000);
  });
});

describe('o resumo por anúncio', () => {
  it('conta mensagens, cliques e sem resposta por anúncio, nos últimos 7 dias', () => {
    const r = resumoPorAnuncio(
      [
        lead({ anuncio_codigo: 'TE0002_IMOVA', anuncio_titulo: 'Terreno' }),
        lead({ anuncio_codigo: 'TE0002_IMOVA', situacao: 'respondido' }),
        lead({ anuncio_codigo: 'TE0002_IMOVA', grupo: 'clicou', chegou_por: null }),
        lead({ anuncio_codigo: 'TE0001_IMOVA', grupo: 'clicou', chegou_por: null }),
        // Fora da conta: descartado, velho, quem pediu para não ser contatado.
        lead({ anuncio_codigo: 'TE0001_IMOVA', situacao: 'descartado' }),
        lead({ anuncio_codigo: 'TE0001_IMOVA', recebido_em: '2026-10-20T12:00:00Z' }),
        lead({ anuncio_codigo: 'TE0001_IMOVA', grupo: 'clicou', suprimido: true }),
        // Sem código vai por último.
        lead({ anuncio_codigo: null, client_listing_id: null, anuncio_titulo: null }),
      ],
      AGORA,
    );
    expect(r.leadCerto).toBe(0);
    expect(r.anuncios).toEqual([
      {
        chave: 'TE0002_IMOVA',
        codigo: 'TE0002_IMOVA',
        titulo: 'Terreno',
        mensagem: 2,
        whatsapp: 0,
        clicou: 1,
        semResposta: 1,
      },
      {
        chave: 'TE0001_IMOVA',
        codigo: 'TE0001_IMOVA',
        titulo: 'Apartamento em Ponta Negra',
        mensagem: 0,
        whatsapp: 0,
        clicou: 1,
        semResposta: 0,
      },
      {
        chave: '',
        codigo: null,
        titulo: null,
        mensagem: 1,
        whatsapp: 0,
        clicou: 0,
        semResposta: 1,
      },
    ]);
    expect(r.whatsapp).toBe(0);
  });

  it('conta, dos que mandaram mensagem, os que vieram pela mensagem no WhatsApp', () => {
    const r = resumoPorAnuncio(
      [
        leadDoWhatsapp({ anuncio_codigo: 'PT0001_IMOVA' }),
        leadDoWhatsapp({ anuncio_codigo: 'PT0001_IMOVA', situacao: 'respondido' }),
        lead({ anuncio_codigo: 'PT0001_IMOVA', tipos: ['CONTACT_FORM'], chegou_por: 'formulario' }),
        leadDoWhatsapp({ anuncio_codigo: 'TE0002_IMOVA', situacao: 'descartado' }),
      ],
      AGORA,
    );
    expect(r.anuncios).toEqual([
      {
        chave: 'PT0001_IMOVA',
        codigo: 'PT0001_IMOVA',
        titulo: 'Apartamento em Ponta Negra',
        mensagem: 3,
        whatsapp: 2,
        clicou: 0,
        semResposta: 2,
      },
    ]);
    expect(r.whatsapp).toBe(2);
  });

  it('o Lead Certo não conta para o anúncio: a pessoa não o viu', () => {
    const r = resumoPorAnuncio([lead({ lead_certo: true })], AGORA);
    expect(r).toEqual({ anuncios: [], leadCerto: 1, whatsapp: 0 });
  });
});

describe('os filtros', () => {
  const leads = [
    lead({ id: 'a', ficha_nome: 'José Antônio', situacao: 'novo', tipos: ['CLICK_WHATSAPP'] }),
    lead({ id: 'b', ficha_nome: 'Ana', situacao: 'respondido', tipos: ['CONTACT_FORM'] }),
    lead({
      id: 'c',
      ficha_nome: 'Bia',
      situacao: 'descartado',
      anuncio_codigo: null,
      client_listing_id: 'SA0013_IMOVA',
    }),
    lead({ id: 'd', ficha_nome: null, situacao: 'em_atendimento', anuncio_codigo: 'SA0013_IMOVA' }),
  ];
  const ids = (l: LeadDoPortal[]) => l.map((x) => x.id);

  it('"todos" deixa os descartados de fora', () => {
    expect(ids(filtrarLeads(leads, FILTROS_INICIAIS))).toEqual(['a', 'b', 'd']);
    expect(ids(filtrarLeads(leads, { ...FILTROS_INICIAIS, recorte: 'descartado' }))).toEqual(['c']);
  });

  it('filtra por tipo, por anúncio (sem caixa) e pelo nome sem acento', () => {
    expect(ids(filtrarLeads(leads, { ...FILTROS_INICIAIS, tipo: 'CONTACT_FORM' }))).toEqual(['b']);
    expect(ids(filtrarLeads(leads, { ...FILTROS_INICIAIS, anuncio: 'sa0013_imova' }))).toEqual([
      'd',
    ]);
    expect(ids(filtrarLeads(leads, { ...FILTROS_INICIAIS, busca: 'jose  ANTONIO' }))).toEqual([
      'a',
    ]);
  });

  it('sem o recorte, a situação não filtra (a base dos chips)', () => {
    expect(
      ids(filtrarLeads(leads, { ...FILTROS_INICIAIS, recorte: 'novo' }, { semRecorte: true })),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('separa quem mandou mensagem de quem só clicou', () => {
    const grupos = [
      lead({ id: 'm1' }),
      lead({ id: 'm2', chegou_por: 'chat' }),
      lead({ id: 'c1', grupo: 'clicou', chegou_por: null, nome_no_portal: 'Paulo Mendes' }),
      lead({ id: 'c2', grupo: 'clicou', chegou_por: null, suprimido: true }),
    ];
    expect(ids(filtrarLeads(grupos, FILTROS_INICIAIS))).toEqual(['m1', 'm2']);
    // Quem pediu para não ser contatado não entra na lista para ligar.
    expect(ids(filtrarLeads(grupos, { ...FILTROS_INICIAIS, grupo: 'clicou' }))).toEqual(['c1']);
    expect(estaNoGrupo(grupos[3]!, 'clicou')).toBe(false);
    expect(ids(filtrarLeads(grupos, { ...FILTROS_INICIAIS, chegouPor: 'chat' }))).toEqual(['m2']);
    // A busca acha também pelo nome que o portal mandou.
    expect(
      ids(filtrarLeads(grupos, { ...FILTROS_INICIAIS, grupo: 'clicou', busca: 'mendes' })),
    ).toEqual(['c1']);
  });

  it('"WhatsApp pelo portal" é um filtro à parte de "Pelo WhatsApp"', () => {
    const jeitos = [
      lead({ id: 'w1', chegou_por: 'whatsapp' }),
      leadDoWhatsapp({ id: 'p1', chegou_por: 'whatsapp' }),
      lead({ id: 'f1', chegou_por: 'formulario' }),
    ];
    expect(ids(filtrarLeads(jeitos, { ...FILTROS_INICIAIS, chegouPor: 'whatsapp' }))).toEqual([
      'w1',
    ]);
    expect(
      ids(filtrarLeads(jeitos, { ...FILTROS_INICIAIS, chegouPor: 'whatsapp_do_portal' })),
    ).toEqual(['p1']);
    // Sem filtro, os dois estão em "Mandaram mensagem".
    expect(ids(filtrarLeads(jeitos, FILTROS_INICIAIS))).toEqual(['w1', 'p1', 'f1']);
  });

  it('conta cada situação para os chips', () => {
    expect(contagemPorSituacao(leads)).toEqual({
      todos: 3,
      novo: 1,
      em_atendimento: 1,
      respondido: 1,
      descartado: 1,
    });
  });
});

describe('textos cortados', () => {
  it('corta a mensagem na palavra e junta os espaços', () => {
    expect(cortarMensagem('  Olá,\n tenho interesse  ')).toBe('Olá, tenho interesse');
    expect(
      cortarMensagem('Olá, tenho interesse neste imóvel e gostaria de agendar uma visita', 30),
    ).toBe('Olá, tenho interesse neste…');
    expect(cortarMensagem(null)).toBe('');
  });
});
