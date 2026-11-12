// =============================================================================
// Testes do lead do Grupo OLX. Rodam sem rede e sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     deno test grupozap-lead/
//
// O que estes testes protegem, em ordem de importância:
//   1. que a resposta seja sempre 200 (12/11/2026): o lead de anúncio ("Grupo
//      OLX") sem `clientListingId` leva só o aviso `anuncio_sem_codigo`, para o
//      log; MCMV sem código, código que não existe no CRM e campo desconhecido
//      recebem 200 sem aviso — recusar à toa perde lead e arrisca a integração;
//   2. que a chave de idempotência seja estável: o mesmo lead reenviado dá a
//      mesma chave, com ou sem `originLeadId`;
//   3. que `leadCerto` chegue ao banco como booleano, venha como vier, sem que
//      o resto do lead mude;
//   4. que o resumo do log não carregue dado pessoal.
// =============================================================================

import { assertEquals, assertMatch, assertNotEquals } from 'jsr:@std/assert@1';
import {
  chaveDeIdempotencia,
  decidirResposta,
  ehLeadDeExemplo,
  ID_DO_LEAD_DE_EXEMPLO,
  lerCorpo,
  motivoDeTeste,
  normalizarLeadCerto,
  paraOBanco,
  resumoParaLog,
  TAMANHO_MAXIMO_DA_CHAVE,
  temCodigoDoAnuncio,
} from './lead.ts';

/** O exemplo oficial (developers.grupozap.com), que o validador também usa. */
const EXEMPLO = {
  leadOrigin: 'Grupo OLX',
  timestamp: '2017-10-23T15:50:30.619Z',
  originLeadId: '59ee0fc6e4b043e1b2a6d863',
  originListingId: '87027856',
  clientListingId: 'a40171',
  name: 'Nome Consumidor',
  email: 'nome.consumidor@email.com',
  ddd: '11',
  phone: '999999999',
  phoneNumber: '11999999999',
  message: 'Olá, tenho interesse neste imóvel. Aguardo o contato.',
  temperature: 'Alta',
  transactionType: 'SELL',
  extraData: {
    leadCerto: true,
    izi: 'https://lead-conversation.grupozap.com/lead/59ee0fc6e4b043e1b2a6d863',
    feedback: 'Sua opinião é muito importante para nós.',
    leadType: 'CONTACT_CHAT',
  },
};

const MCMV = {
  leadOrigin: 'MCMV_OLX',
  timestamp: '2026-11-05T12:00:00.000Z',
  originLeadId: 'mcmv-0001',
  name: 'Nome Consumidor',
  ddd: '84',
  phone: '999999999',
  extraData: { leadType: 'CONTACT_FORM', mcmv: { valor: 180000, entrada: 20000 } },
};

function lido(corpoCru: string) {
  const r = lerCorpo(corpoCru);
  if (!r.ok) throw new Error(`não leu: ${r.motivo}`);
  return r.lead;
}

Deno.test('o exemplo oficial é lido e recebe 200', () => {
  const lead = lido(JSON.stringify(EXEMPLO));
  assertEquals(decidirResposta(lead), { status: 200, aviso: null });
  assertEquals(temCodigoDoAnuncio(lead), true);
});

Deno.test('JSON quebrado e corpo que não é objeto são recusados', () => {
  assertEquals(lerCorpo('{"leadOrigin": "Grupo OLX",'), { ok: false, motivo: 'json_invalido' });
  assertEquals(lerCorpo(''), { ok: false, motivo: 'json_invalido' });
  for (const naoObjeto of ['[]', '[{}]', 'null', '"texto"', '42', 'true']) {
    assertEquals(lerCorpo(naoObjeto), { ok: false, motivo: 'nao_e_objeto' }, naoObjeto);
  }
  assertEquals(lerCorpo('{}').ok, true);
});

Deno.test(
  'lead de anúncio sem clientListingId recebe 200, com o aviso para o log (nunca 422)',
  () => {
    const { clientListingId: _, ...semCodigo } = EXEMPLO;
    assertEquals(decidirResposta(semCodigo), { status: 200, aviso: 'anuncio_sem_codigo' });
    // Vazio, só espaços ou null contam como ausente.
    for (const vazio of ['', '   ', null]) {
      assertEquals(
        decidirResposta({ ...EXEMPLO, clientListingId: vazio }),
        { status: 200, aviso: 'anuncio_sem_codigo' },
        String(vazio),
      );
    }
    // A origem com espaço ou maiúscula diferente continua sendo de anúncio.
    assertEquals(
      decidirResposta({ ...semCodigo, leadOrigin: ' grupo  OLX ' }).aviso,
      'anuncio_sem_codigo',
    );
  },
);

Deno.test('lead MCMV sem clientListingId recebe 200, sem aviso', () => {
  assertEquals(decidirResposta(lido(JSON.stringify(MCMV))), { status: 200, aviso: null });
});

Deno.test(
  'origem ausente ou desconhecida sem código recebe 200, sem aviso (não perde lead)',
  () => {
    const { clientListingId: _, leadOrigin: __, ...semNada } = EXEMPLO;
    assertEquals(decidirResposta(semNada), { status: 200, aviso: null });
    assertEquals(decidirResposta({ ...semNada, leadOrigin: 'Outro Portal' }), {
      status: 200,
      aviso: null,
    });
  },
);

Deno.test('código que não existe no CRM, ou numérico, não é recusado', () => {
  assertEquals(decidirResposta({ ...EXEMPLO, clientListingId: 'nao-existe-no-crm' }), {
    status: 200,
    aviso: null,
  });
  assertEquals(decidirResposta({ ...EXEMPLO, clientListingId: 40171 }), {
    status: 200,
    aviso: null,
  });
});

Deno.test('campos a mais não atrapalham nada', () => {
  const comExtras = {
    ...EXEMPLO,
    campoNovo: 'qualquer',
    outroObjeto: { a: [1, 2, 3] },
    extraData: { ...EXEMPLO.extraData, novidade: true },
  };
  const lead = lido(JSON.stringify(comExtras));
  assertEquals(decidirResposta(lead).status, 200);
  const banco = paraOBanco(lead);
  assertEquals(banco.campoNovo, 'qualquer');
  assertEquals(banco.outroObjeto, { a: [1, 2, 3] });
  assertEquals((banco.extraData as Record<string, unknown>).novidade, true);
});

Deno.test('a chave é o originLeadId aparado', async () => {
  const corpo = JSON.stringify({ ...EXEMPLO, originLeadId: '  59ee0fc6e4b043e1b2a6d863 ' });
  const chave = await chaveDeIdempotencia(lido(corpo), corpo);
  assertEquals(chave, { chave: '59ee0fc6e4b043e1b2a6d863', de: 'originLeadId' });
  // Numérico também serve.
  const numerico = JSON.stringify({ ...EXEMPLO, originLeadId: 123456 });
  assertEquals((await chaveDeIdempotencia(lido(numerico), numerico)).chave, '123456');
});

Deno.test('sem originLeadId a chave é o SHA-256 do corpo, estável no reenvio', async () => {
  const { originLeadId: _, ...semId } = EXEMPLO;
  const corpo = JSON.stringify(semId);
  const a = await chaveDeIdempotencia(lido(corpo), corpo);
  const b = await chaveDeIdempotencia(lido(corpo), corpo);
  assertEquals(a.de, 'corpo');
  assertEquals(a.motivo, 'originLeadId_ausente');
  assertMatch(a.chave, /^sha256:[0-9a-f]{64}$/);
  assertEquals(a.chave, b.chave);
  // Outro corpo, outra chave.
  const outro = JSON.stringify({ ...semId, message: 'outra' });
  assertNotEquals((await chaveDeIdempotencia(lido(outro), outro)).chave, a.chave);
  // Vazio ou só espaços é o mesmo que ausente.
  for (const vazio of ['', '   ', null, {}]) {
    const c = JSON.stringify({ ...semId, originLeadId: vazio });
    assertEquals((await chaveDeIdempotencia(lido(c), c)).motivo, 'originLeadId_ausente');
  }
});

Deno.test('originLeadId longo demais também vira o SHA-256 do corpo', async () => {
  const noLimite = 'x'.repeat(TAMANHO_MAXIMO_DA_CHAVE);
  const c1 = JSON.stringify({ ...EXEMPLO, originLeadId: noLimite });
  assertEquals((await chaveDeIdempotencia(lido(c1), c1)).chave, noLimite);
  const c2 = JSON.stringify({ ...EXEMPLO, originLeadId: `${noLimite}x` });
  const chave = await chaveDeIdempotencia(lido(c2), c2);
  assertEquals(chave.motivo, 'originLeadId_longo_demais');
  assertMatch(chave.chave, /^sha256:[0-9a-f]{64}$/);
});

Deno.test('leadCerto: booleano, texto, sim/não e 1/0 viram booleano; o resto, null', () => {
  for (const [valor, esperado] of [
    [true, true],
    [false, false],
    ['true', true],
    ['false', false],
    [' TRUE ', true],
    ['False', false],
    [1, true],
    [0, false],
    ['1', true],
    ['0', false],
    // Os mesmos textos que o banco (`grupozap_lead_receber`) lê.
    ['sim', true],
    ['Não', false],
    ['nao', false],
    ['talvez', null],
    ['', null],
    [null, null],
    [undefined, null],
    [2, null],
    [{}, null],
  ] as const) {
    assertEquals(normalizarLeadCerto(valor), esperado, JSON.stringify(valor));
  }
});

Deno.test('leadCerto em texto chega ao banco como booleano, sem mexer no recebido', () => {
  const lead = lido(
    JSON.stringify({ ...EXEMPLO, extraData: { ...EXEMPLO.extraData, leadCerto: 'false' } }),
  );
  const banco = paraOBanco(lead);
  assertEquals((banco.extraData as Record<string, unknown>).leadCerto, false);
  assertEquals((lead.extraData as Record<string, unknown>).leadCerto, 'false');
  // Tirando o leadCerto, nada muda.
  const { extraData: e1, ...resto1 } = banco;
  const { extraData: e2, ...resto2 } = lead;
  assertEquals(resto1, resto2);
  const { leadCerto: _a, ...extra1 } = e1 as Record<string, unknown>;
  const { leadCerto: _b, ...extra2 } = e2 as Record<string, unknown>;
  assertEquals(extra1, extra2);
});

Deno.test('sem leadCerto, ou sem extraData, o lead vai como veio', () => {
  const mcmv = lido(JSON.stringify(MCMV));
  assertEquals(paraOBanco(mcmv), mcmv);
  const { extraData: _, ...semExtra } = EXEMPLO;
  assertEquals(paraOBanco(semExtra), semExtra);
  const extraTexto = { ...EXEMPLO, extraData: 'texto' };
  assertEquals(paraOBanco(extraTexto), extraTexto);
});

Deno.test('o resumo do log não leva dado pessoal', async () => {
  const corpo = JSON.stringify(EXEMPLO);
  const lead = lido(corpo);
  const resumo = resumoParaLog(lead, await chaveDeIdempotencia(lead, corpo));
  assertEquals(resumo, { lead: '59ee0fc6e4b0', tipo: 'CONTACT_CHAT' });
  const texto = JSON.stringify(resumo);
  for (const pessoal of [EXEMPLO.name, EXEMPLO.email, EXEMPLO.phone, EXEMPLO.message]) {
    assertEquals(texto.includes(pessoal), false, pessoal);
  }
});

Deno.test('o tipo de contato só vai ao log se tiver a forma dos documentados', async () => {
  const corpo = '{}';
  const chave = await chaveDeIdempotencia({}, corpo);
  const tipo = (leadType: unknown) => resumoParaLog({ extraData: { leadType } }, chave).tipo;
  assertEquals(tipo('CLICK_WHATSAPP'), 'CLICK_WHATSAPP');
  assertEquals(tipo('Maria 84 99999-9999'), 'outro');
  assertEquals(tipo(42), 'outro');
  assertEquals(tipo(undefined), 'sem_tipo');
  assertEquals(resumoParaLog({}, chave).tipo, 'sem_tipo');
  // Sem originLeadId, o log leva o começo do resumo do corpo.
  assertMatch(resumoParaLog({}, chave).lead, /^sha256:[0-9a-f]{12}$/);
});

// -----------------------------------------------------------------------------
// Teste não grava (10/11/2026): a chave de teste, ou o lead de exemplo da
// documentação com qualquer chave.
// -----------------------------------------------------------------------------
Deno.test('o lead de exemplo da documentação é reconhecido, também com espaço em volta', () => {
  assertEquals(ID_DO_LEAD_DE_EXEMPLO, EXEMPLO.originLeadId);
  assertEquals(ehLeadDeExemplo(EXEMPLO), true);
  assertEquals(ehLeadDeExemplo({ ...EXEMPLO, originLeadId: ` ${ID_DO_LEAD_DE_EXEMPLO} ` }), true);
  // Um caractere diferente, outro id ou id ausente: lead de verdade.
  assertEquals(ehLeadDeExemplo({ ...EXEMPLO, originLeadId: '59ee0fc6e4b043e1b2a6d864' }), false);
  assertEquals(ehLeadDeExemplo({ ...EXEMPLO, originLeadId: '6720f1a2b3c4d5e6f7a8b9c0' }), false);
  const { originLeadId: _sem, ...semId } = EXEMPLO;
  assertEquals(ehLeadDeExemplo(semId), false);
});

Deno.test('chamada com a chave de teste é teste, seja qual for o lead', () => {
  assertEquals(motivoDeTeste('teste', EXEMPLO), 'chave_de_teste');
  assertEquals(
    motivoDeTeste('teste', { ...EXEMPLO, originLeadId: '6720f1a2b3c4d5e6f7a8b9c0' }),
    'chave_de_teste',
  );
});

Deno.test('com a chave de verdade, só o lead de exemplo é teste; o resto vai ao banco', () => {
  assertEquals(motivoDeTeste('atual', EXEMPLO), 'lead_de_exemplo');
  assertEquals(motivoDeTeste('anterior', EXEMPLO), 'lead_de_exemplo');
  const real = { ...EXEMPLO, originLeadId: '6720f1a2b3c4d5e6f7a8b9c0' };
  assertEquals(motivoDeTeste('atual', real), null);
  assertEquals(motivoDeTeste('anterior', real), null);
});
