/**
 * Os leads dos portais (05/11/2026), só na Imova: o vocabulário da tela.
 *
 * Cada toque num anúncio do ZAP Imóveis, do Viva Real ou da OLX chega pelo
 * webhook do Grupo OLX (Edge Function `grupozap-lead`) e vira uma linha de
 * `public.portal_leads`, ligada ao anúncio pelo código. Desde a migração
 * 20261105130000 o lead só "chega" quando a pessoa MANDA MENSAGEM — no WhatsApp
 * (a conversa do mesmo telefone, depois do clique) ou pelo chat, formulário ou
 * pedido de visita do portal. Quem só tocou no WhatsApp, em "ver telefone" ou em
 * agendar fica à parte, em "Clicaram e não chamaram", para a equipe ligar.
 *
 * O banco decide tudo (o grupo, a situação, quem respondeu primeiro, quem pode
 * assumir, descartar, o que conta); aqui ficam os rótulos, as contas do resumo e
 * os filtros que a tela faz sem ir ao servidor.
 *
 * Desde 12/11/2026 (migração 20261112180000) o lead também nasce da CONVERSA:
 * quem toca em "WhatsApp" no anúncio do ZAP ou do Viva Real manda o texto
 * pronto do portal, o canal de chegada reconhece, e a chegada vira um lead com
 * `origem = 'whatsapp'` e o tipo `WHATSAPP_DO_PORTAL` ("Mensagem no WhatsApp"),
 * que diz de qual portal veio (`portal`). Ele não avisa como lead novo (a
 * mensagem já avisou), e a lista mostra uma vez só a pessoa que também chegou
 * pelo aviso do Grupo OLX.
 *
 * Puro: sem React, sem Supabase. Testado em `leads-rotulos.test.ts`.
 */
import { TIMEZONE } from '@komune/schema';

export type SituacaoDoLead = 'novo' | 'em_atendimento' | 'respondido' | 'descartado';

/** `mensagem`: mandou mensagem (WhatsApp ou portal). `clicou`: só tocou. */
export type GrupoDoLead = 'mensagem' | 'clicou';

/**
 * Por onde a primeira mensagem chegou. `whatsapp_do_portal` não vem do banco
 * (para ele, a mensagem chegou `whatsapp`): é o lead que nasceu da conversa,
 * separado na tela por `jeitoDeChegar`.
 */
export type ChegouPor = 'whatsapp' | 'whatsapp_do_portal' | 'chat' | 'formulario' | 'visita';

/** De qual portal veio (só o lead que nasce do WhatsApp sabe; o webhook não diz). */
export type Portal = 'zap' | 'vivareal' | 'olx';

/** A origem do lead que nasce da conversa de WhatsApp (o do webhook é 'grupo_olx'). */
export const ORIGEM_WHATSAPP = 'whatsapp';

/** O tipo que o CRM dá ao lead que nasce da conversa de WhatsApp. */
export const TIPO_WHATSAPP_DO_PORTAL = 'WHATSAPP_DO_PORTAL';

/**
 * Uma linha de `public.portal_leads_na_lista` (migrações 20261105100000 e
 * 20261105130000). Nome, telefone e e-mail vêm da FICHA (`organizations_view`)
 * quando há ficha, e do que o portal mandou quando não há; o SDR recebe o
 * telefone mascarado, com `phone_is_masked`, e revela pelo botão (o de sempre na
 * ficha; `portal_lead_revelar_telefone` sem ficha).
 */
export type LeadDoPortal = {
  id: string;
  origem: string | null;
  origin_lead_id: string | null;
  /** O leadOrigin como veio: 'Grupo OLX' ou 'MCMV_OLX'. */
  origem_no_portal: string | null;
  client_listing_id: string | null;
  origin_listing_id: string | null;
  anuncio_id: string | null;
  anuncio_no_canal_pro_id: string | null;
  organization_id: string | null;
  /** Os `leadType` do Grupo OLX: CLICK_WHATSAPP, CONTACT_FORM... */
  tipos: string[] | null;
  temperatura: string | null;
  transacao: string | null;
  /** A pessoa NÃO clicou neste anúncio: o código é de um parecido da Imova. */
  lead_certo: boolean | null;
  mcmv: boolean | null;
  mensagem: string | null;
  link_historico: string | null;
  recebido_no_portal_em: string | null;
  recebido_em: string;
  /**
   * A situação que vale: "respondido" sozinha quando alguém do time respondeu na
   * conversa de WhatsApp. A gravada (a que `portal_lead_mudar` muda) é
   * `situacao_registrada`.
   */
  situacao: SituacaoDoLead;
  situacao_registrada: SituacaoDoLead | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  motivo_descarte: string | null;
  situacao_em: string | null;
  situacao_por: string | null;
  /** Telefone na lista de supressão, ou ficha que pediu para não ser contatada: sem ficha. */
  suprimido: boolean | null;
  /** O nome da ficha; sem ficha, o que o portal mandou. */
  ficha_nome: string | null;
  /** O nome que o portal mandou (some com o contato, 90 dias depois). */
  nome_no_portal: string | null;
  phone_e164: string | null;
  email: string | null;
  phone_is_masked: boolean | null;
  anuncio_codigo: string | null;
  anuncio_titulo: string | null;
  /** A conversa de WhatsApp: a da mensagem depois do clique, ou a da ficha. */
  conversation_id: string | null;
  grupo: GrupoDoLead;
  chegou_por: ChegouPor | null;
  /** A primeira mensagem recebida no WhatsApp depois do clique, ou a hora do clique. */
  chegou_em: string | null;
  /** Até 280 letras: o texto do WhatsApp ou a mensagem do portal. */
  primeira_mensagem: string | null;
  /** O `msg_type` da mensagem do WhatsApp (foto, áudio... vêm sem texto). */
  primeira_mensagem_tipo: string | null;
  /** A primeira resposta de alguém do time na conversa, ou o "respondido" marcado à mão. */
  respondido_em: string | null;
  respondido_por_nome: string | null;
  /** Quando o contato que o portal mandou foi apagado (90 dias depois do aviso). */
  contato_apagado_em: string | null;
  /**
   * De qual portal veio: o do lead que nasceu do WhatsApp, ou o do par dele
   * quando a lista mostra o aviso do Grupo OLX da mesma pessoa. null = não se sabe.
   */
  portal: Portal | null;
};

// ---------------------------------------------------------------------------
// Tipo de contato
// ---------------------------------------------------------------------------

/** Os tipos de contato que o Grupo OLX documenta, na ordem do mais quente. */
export const TIPOS_DE_CONTATO = [
  'CLICK_WHATSAPP',
  'VISIT_REQUEST',
  'CLICK_SCHEDULE',
  'CONTACT_FORM',
  'CONTACT_CHAT',
  'PHONE_VIEW',
] as const;

export type TipoDeContato = (typeof TIPOS_DE_CONTATO)[number];

/** Os toques que não são mensagem: quem só fez isso fica em "Clicaram e não chamaram". */
export const TIPOS_DE_CLIQUE: readonly TipoDeContato[] = [
  'CLICK_WHATSAPP',
  'PHONE_VIEW',
  'CLICK_SCHEDULE',
];

const ROTULO_DO_TIPO: Record<TipoDeContato, string> = {
  CLICK_WHATSAPP: 'WhatsApp',
  VISIT_REQUEST: 'Pediu visita',
  CLICK_SCHEDULE: 'Agendou visita',
  CONTACT_FORM: 'Formulário',
  CONTACT_CHAT: 'Chat do portal',
  PHONE_VIEW: 'Viu o telefone',
};

export function ehTipoConhecido(tipo: string): tipo is TipoDeContato {
  return (TIPOS_DE_CONTATO as readonly string[]).includes(tipo);
}

/**
 * "WhatsApp", "Pediu visita"...; o tipo do CRM para o lead que nasce da conversa
 * é "Mensagem no WhatsApp"; o que o Grupo OLX inventar depois vira "Outro contato".
 */
export function rotuloDoTipo(tipo: string): string {
  if (tipo === TIPO_WHATSAPP_DO_PORTAL) return 'Mensagem no WhatsApp';
  return ehTipoConhecido(tipo) ? ROTULO_DO_TIPO[tipo] : 'Outro contato';
}

/** Os tipos do lead sem repetir, na ordem do mais quente; vazio quando não veio nenhum. */
export function tiposDoLead(tipos: readonly string[] | null | undefined): string[] {
  const unicos = [...new Set((tipos ?? []).map((t) => t.trim().toUpperCase()).filter(Boolean))];
  const posicao = (t: string) => {
    const i = (TIPOS_DE_CONTATO as readonly string[]).indexOf(t);
    return i === -1 ? TIPOS_DE_CONTATO.length : i;
  };
  return unicos.sort((a, b) => posicao(a) - posicao(b));
}

/** "WhatsApp" ou "WhatsApp e mais 1"; sem tipo, "Contato". */
export function resumoDosTipos(tipos: readonly string[] | null | undefined): string {
  const lista = tiposDoLead(tipos);
  if (lista.length === 0) return 'Contato';
  const primeiro = rotuloDoTipo(lista[0]!);
  return lista.length === 1 ? primeiro : `${primeiro} e mais ${lista.length - 1}`;
}

/**
 * A pessoa escreveu pelo próprio portal (chat, formulário, pedido de visita)? O
 * mesmo que `app.portal_lead_mandou_mensagem`. Nos outros toques o Grupo OLX
 * manda um texto pronto ("Um novo contato foi estabelecido via WhatsApp."), que
 * não é mensagem da pessoa e não aparece como se fosse.
 */
export function escreveuNoPortal(tipos: readonly string[] | null | undefined): boolean {
  const comMensagem = ['CONTACT_CHAT', 'CONTACT_FORM', 'VISIT_REQUEST'];
  return tiposDoLead(tipos).some((t) => comMensagem.includes(t));
}

// ---------------------------------------------------------------------------
// Como chegou e a primeira mensagem
// ---------------------------------------------------------------------------

export const JEITOS_DE_CHEGAR: readonly ChegouPor[] = [
  'whatsapp',
  'whatsapp_do_portal',
  'chat',
  'formulario',
  'visita',
];

const ROTULO_DA_CHEGADA: Record<ChegouPor, string> = {
  whatsapp: 'Pelo WhatsApp',
  whatsapp_do_portal: 'WhatsApp pelo portal',
  chat: 'Pelo chat do portal',
  formulario: 'Pelo formulário do portal',
  visita: 'Pediu visita pelo portal',
};

/** O tipo do Grupo OLX de cada jeito de chegar: é dele o ícone. */
export const TIPO_DA_CHEGADA: Record<ChegouPor, TipoDeContato> = {
  whatsapp: 'CLICK_WHATSAPP',
  whatsapp_do_portal: 'CLICK_WHATSAPP',
  chat: 'CONTACT_CHAT',
  formulario: 'CONTACT_FORM',
  visita: 'VISIT_REQUEST',
};

export function ehJeitoDeChegar(valor: string | null | undefined): valor is ChegouPor {
  return (JEITOS_DE_CHEGAR as readonly (string | null | undefined)[]).includes(valor);
}

/** "Pelo WhatsApp", "Pelo chat do portal"...; null quando não mandou mensagem. */
export function comoChegou(chegouPor: string | null | undefined): string | null {
  return ehJeitoDeChegar(chegouPor) ? ROTULO_DA_CHEGADA[chegouPor] : null;
}

const ROTULO_DO_PORTAL: Record<Portal, string> = {
  zap: 'ZAP Imóveis',
  vivareal: 'Viva Real',
  olx: 'OLX',
};

function ehPortal(valor: string | null | undefined): valor is Portal {
  return valor === 'zap' || valor === 'vivareal' || valor === 'olx';
}

/** "ZAP Imóveis", "Viva Real", "OLX"; null quando não se sabe. */
export function rotuloDoPortal(portal: string | null | undefined): string | null {
  return ehPortal(portal) ? ROTULO_DO_PORTAL[portal] : null;
}

/** O lead nasceu da conversa de WhatsApp (o canal de chegada reconheceu o portal)? */
export function ehLeadDoWhatsapp(lead: Pick<LeadDoPortal, 'origem' | 'tipos'>): boolean {
  return lead.origem === ORIGEM_WHATSAPP || (lead.tipos ?? []).includes(TIPO_WHATSAPP_DO_PORTAL);
}

/**
 * Por onde chegou, como a tela separa: o lead que nasceu da conversa é
 * `whatsapp_do_portal`; os outros, o `chegou_por` do banco.
 */
export function jeitoDeChegar(
  lead: Pick<LeadDoPortal, 'chegou_por' | 'origem' | 'tipos'>,
): ChegouPor | null {
  if (ehLeadDoWhatsapp(lead)) return 'whatsapp_do_portal';
  return ehJeitoDeChegar(lead.chegou_por) ? lead.chegou_por : null;
}

/**
 * Como chegou, com o portal quando se sabe: "WhatsApp pelo ZAP Imóveis",
 * "WhatsApp pela OLX", "Pelo chat do portal"...; null quando não mandou mensagem.
 */
export function comoChegouOLead(
  lead: Pick<LeadDoPortal, 'chegou_por' | 'origem' | 'tipos' | 'portal'>,
): string | null {
  const jeito = jeitoDeChegar(lead);
  const portal = rotuloDoPortal(lead.portal);
  if (jeito === 'whatsapp_do_portal' && portal) {
    return `WhatsApp ${lead.portal === 'olx' ? 'pela' : 'pelo'} ${portal}`;
  }
  return comoChegou(jeito);
}

/** O que a pessoa mandou quando a mensagem é mídia sem texto. */
const ROTULO_DA_MIDIA: Record<string, string> = {
  image: 'Foto',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
  location: 'Localização',
  contacts: 'Contato',
  interactive: 'Resposta de botão',
  reaction: 'Reação',
  template: 'Mensagem',
};

/** As mídias que podem vir com legenda: "Foto: segue a planta". */
const MIDIA_COM_LEGENDA = new Set(['image', 'video', 'document']);

/**
 * A primeira mensagem numa forma que se lê: o texto, ou o tipo da mídia ("Foto",
 * "Áudio"...), com a legenda quando há. `midia` diz se o texto é rótulo nosso.
 */
export function primeiraMensagemDoLead(
  lead: Pick<LeadDoPortal, 'primeira_mensagem' | 'primeira_mensagem_tipo'>,
): { texto: string; midia: boolean } | null {
  const texto = (lead.primeira_mensagem ?? '').trim();
  const tipo = (lead.primeira_mensagem_tipo ?? '').trim();
  const midia = ROTULO_DA_MIDIA[tipo];
  if (midia && MIDIA_COM_LEGENDA.has(tipo)) {
    return { texto: texto ? `${midia}: ${texto}` : midia, midia: !texto };
  }
  if (texto) return { texto, midia: false };
  if (midia) return { texto: midia, midia: true };
  return null;
}

// ---------------------------------------------------------------------------
// Situação, temperatura e negócio
// ---------------------------------------------------------------------------

export const SITUACOES_DO_LEAD: Record<SituacaoDoLead, string> = {
  novo: 'Sem resposta',
  em_atendimento: 'Em atendimento',
  respondido: 'Respondido',
  descartado: 'Descartado',
};

export type Tom = 'quente' | 'morno' | 'frio';

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * A temperatura que o Grupo OLX dá ao lead ("Alta", "Média", "Baixa"), com o
 * tom da escala térmica do CRM. O que vier fora disso não ganha cor.
 */
export function temperaturaDoLead(
  valor: string | null | undefined,
): { rotulo: string; tom: Tom } | null {
  switch (semAcento(valor ?? '')) {
    case 'alta':
      return { rotulo: 'Alta', tom: 'quente' };
    case 'media':
      return { rotulo: 'Média', tom: 'morno' };
    case 'baixa':
      return { rotulo: 'Baixa', tom: 'frio' };
    default:
      return null;
  }
}

/** O que a pessoa quer: comprar ou alugar. */
export function rotuloDaTransacao(valor: string | null | undefined): string | null {
  switch ((valor ?? '').trim().toUpperCase()) {
    case 'SELL':
      return 'Quer comprar';
    case 'RENT':
      return 'Quer alugar';
    default:
      return null;
  }
}

/**
 * "Marcar como respondido" é para quem escreveu pelo portal (a resposta vai por
 * telefone ou e-mail, e o CRM não vê). No WhatsApp a situação muda sozinha
 * quando alguém do time responde na conversa; quem só clicou não escreveu nada.
 * Sem a conversa ligada (o lead do WhatsApp de quem pediu para não ser
 * contatado), nada muda sozinho, e a marca à mão volta.
 */
export function marcaRespondidoAMao(
  lead: Pick<LeadDoPortal, 'grupo' | 'chegou_por' | 'conversation_id'>,
): boolean {
  return lead.grupo === 'mensagem' && (lead.chegou_por !== 'whatsapp' || !lead.conversation_id);
}

// ---------------------------------------------------------------------------
// De qual anúncio veio
// ---------------------------------------------------------------------------

export type OrigemDoLead =
  | { tipo: 'anuncio'; codigo: string; frase: string }
  | { tipo: 'parecido'; codigo: string; frase: string }
  | { tipo: 'mcmv'; codigo: null; frase: string }
  | { tipo: 'sem_codigo'; codigo: null; frase: string };

/**
 * A frase que diz de onde o lead veio. Lead Certo é o Grupo OLX oferecendo à
 * Imova alguém que procurou imóvel parecido em OUTRO anúncio: a pessoa nunca
 * viu o da Imova, e a tela não pode dizer que "veio" dele.
 */
export function origemDoLead(
  lead: Pick<LeadDoPortal, 'client_listing_id' | 'anuncio_codigo' | 'lead_certo' | 'mcmv'>,
): OrigemDoLead {
  const codigo = (lead.anuncio_codigo ?? lead.client_listing_id ?? '').trim();
  if (codigo) {
    return lead.lead_certo
      ? { tipo: 'parecido', codigo, frase: `Parecido com o anúncio ${codigo}` }
      : { tipo: 'anuncio', codigo, frase: `Veio do anúncio ${codigo}` };
  }
  if (lead.mcmv) {
    return { tipo: 'mcmv', codigo: null, frase: 'Simulação do Minha Casa Minha Vida' };
  }
  return { tipo: 'sem_codigo', codigo: null, frase: 'Sem o código do anúncio' };
}

const CANAL_DA_CHEGADA: Record<ChegouPor, string> = {
  whatsapp: 'WhatsApp',
  // O banco diz 'whatsapp' também para o lead que nasce da conversa; isto é só
  // para quem passar o jeito da tela.
  whatsapp_do_portal: 'WhatsApp',
  chat: 'Chat do portal',
  formulario: 'Formulário',
  visita: 'Pediu visita',
};

/**
 * "Veio do anúncio SA0012_IMOVA · WhatsApp", a etiqueta da conversa. O canal é
 * por onde a mensagem chegou; sem ele, o tipo de contato mais quente.
 */
export function fraseDaOrigem(
  lead: Pick<
    LeadDoPortal,
    'client_listing_id' | 'anuncio_codigo' | 'lead_certo' | 'mcmv' | 'tipos'
  > & { chegou_por?: string | null },
): string {
  const origem = origemDoLead(lead).frase;
  if (ehJeitoDeChegar(lead.chegou_por)) return `${origem} · ${CANAL_DA_CHEGADA[lead.chegou_por]}`;
  const tipos = tiposDoLead(lead.tipos);
  return tipos.length > 0 ? `${origem} · ${rotuloDoTipo(tipos[0]!)}` : origem;
}

/**
 * Quem é a pessoa, na lista: o nome da ficha, ou o que o portal mandou. Sem
 * nome, a razão (`semNome`, que a tela mostra apagado): quem pediu para não ser
 * contatado (o banco não guarda nem o nome), o contato apagado aos 90 dias, ou o
 * portal que não mandou nada.
 */
export function nomeDoLead(
  lead: Pick<
    LeadDoPortal,
    'ficha_nome' | 'organization_id' | 'suprimido' | 'contato_apagado_em' | 'phone_e164' | 'email'
  >,
): { nome: string; semNome: boolean } {
  const nome = (lead.ficha_nome ?? '').trim();
  if (nome) return { nome, semNome: false };
  if (lead.organization_id) return { nome: 'Sem nome na ficha', semNome: true };
  if (lead.suprimido) return { nome: 'Pediu para não ser contatado', semNome: true };
  if (lead.contato_apagado_em) return { nome: 'Contato apagado', semNome: true };
  if (lead.phone_e164 || lead.email) return { nome: 'Sem nome no portal', semNome: true };
  return { nome: 'Sem telefone nem e-mail', semNome: true };
}

/** O nome do portal, quando é outro que o da ficha ("Marina" na ficha, "Marina Costa" no portal). */
export function nomeNoPortalDiferente(
  lead: Pick<LeadDoPortal, 'ficha_nome' | 'nome_no_portal'>,
): string | null {
  const portal = (lead.nome_no_portal ?? '').trim();
  if (!portal) return null;
  return normalizarBusca(portal) === normalizarBusca(lead.ficha_nome ?? '') ? null : portal;
}

// ---------------------------------------------------------------------------
// Quando chegou
// ---------------------------------------------------------------------------

/** A hora do contato no portal; sem ela, a hora em que o CRM recebeu. */
export function quandoChegou(lead: Pick<LeadDoPortal, 'recebido_no_portal_em' | 'recebido_em'>) {
  return lead.recebido_no_portal_em ?? lead.recebido_em;
}

/**
 * Quando o lead chegou de verdade: a primeira mensagem no WhatsApp depois do
 * clique, ou a hora do contato no portal.
 */
export function chegouEm(
  lead: Pick<LeadDoPortal, 'chegou_em' | 'recebido_no_portal_em' | 'recebido_em'>,
): string {
  return lead.chegou_em ?? quandoChegou(lead);
}

const DIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
});
const DIA_MES = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: '2-digit',
});
const DIA_MES_ANO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** "2026-11-05": o dia do calendário de Natal. */
export function diaEmNatal(data: Date): string {
  return DIA.format(data);
}

/** Quantos dias de calendário (de Natal) separam `de` de `ate`. */
function diasEntre(de: Date, ate: Date): number {
  const meiaNoite = (d: Date) => Date.parse(`${diaEmNatal(d)}T00:00:00Z`);
  return Math.round((meiaNoite(ate) - meiaNoite(de)) / 86_400_000);
}

/**
 * "agora", "há 12 min", "há 3 h", "hoje às 08:10", "ontem às 17:45", "03/11 às
 * 09:10" — no fuso de Natal. A hora exata vai sempre no `title` da tela.
 */
export function recebidoHa(iso: string, agora: Date = new Date()): string {
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return '';
  const minutos = Math.floor((agora.getTime() - quando.getTime()) / 60_000);
  const dias = diasEntre(quando, agora);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  if (dias === 0 && minutos < 6 * 60) return `há ${Math.floor(minutos / 60)} h`;
  if (dias === 0) return `hoje às ${HORA.format(quando)}`;
  if (dias === 1) return `ontem às ${HORA.format(quando)}`;
  const mesmoAno = diaEmNatal(quando).slice(0, 4) === diaEmNatal(agora).slice(0, 4);
  return `${(mesmoAno ? DIA_MES : DIA_MES_ANO).format(quando)} às ${HORA.format(quando)}`;
}

/** "05/11/2026 às 14:32", para o `title` e a ficha. */
export function dataHoraDoLead(iso: string): string {
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return '';
  return `${DIA_MES_ANO.format(quando)} às ${HORA.format(quando)}`;
}

/** "05/11/2026", no fuso de Natal. */
export function dataDoLead(iso: string): string {
  const quando = new Date(iso);
  return Number.isNaN(quando.getTime()) ? '' : DIA_MES_ANO.format(quando);
}

/** Os dias que o contato que o portal mandou fica guardado (`app.portal_leads_manter`). */
export const DIAS_DO_CONTATO = 90;

/** Quando o contato que o portal mandou será apagado: 90 dias depois do aviso. */
export function contatoApagaEm(lead: Pick<LeadDoPortal, 'recebido_em'>): string {
  return new Date(Date.parse(lead.recebido_em) + DIAS_DO_CONTATO * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// Quanto tempo até a resposta
// ---------------------------------------------------------------------------

/** "menos de 1 min", "13 min", "1 h 5 min", "2 h", "3 dias". */
export function duracao(ms: number): string {
  const minutos = Math.floor(Math.max(0, ms) / 60_000);
  if (minutos < 1) return 'menos de 1 min';
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) {
    const resto = minutos % 60;
    return resto ? `${horas} h ${resto} min` : `${horas} h`;
  }
  const dias = Math.floor(horas / 24);
  return dias === 1 ? '1 dia' : `${dias} dias`;
}

export type RespostaDoLead = {
  respondido: boolean;
  /** "Respondido em 13 min · gestor.teste" ou "Sem resposta há 14 min". */
  frase: string;
  /** O que vai ao lado do selo da situação, sem repetir o selo. */
  detalhe: string;
};

/**
 * A primeira resposta do time: quanto demorou e quem respondeu; sem resposta, há
 * quanto tempo a pessoa espera. Descartado não espera ninguém: null. Quem só
 * clicou não mandou mensagem, então não há o que responder: null também.
 */
export function respostaDoLead(
  lead: Pick<
    LeadDoPortal,
    | 'grupo'
    | 'situacao'
    | 'respondido_em'
    | 'respondido_por_nome'
    | 'chegou_em'
    | 'recebido_no_portal_em'
    | 'recebido_em'
  >,
  agora: Date = new Date(),
): RespostaDoLead | null {
  if (lead.grupo !== 'mensagem' || lead.situacao === 'descartado') return null;
  const chegou = Date.parse(chegouEm(lead));
  const quem = (lead.respondido_por_nome ?? '').trim();
  if (lead.respondido_em) {
    const tempo = `em ${duracao(Date.parse(lead.respondido_em) - chegou)}`;
    const detalhe = quem ? `${tempo} · ${quem}` : tempo;
    return { respondido: true, frase: `Respondido ${detalhe}`, detalhe };
  }
  if (lead.situacao === 'respondido') {
    return { respondido: true, frase: 'Respondido', detalhe: quem };
  }
  const espera = `há ${duracao(agora.getTime() - chegou)}`;
  return {
    respondido: false,
    frase: `Sem resposta ${espera}`,
    detalhe: lead.situacao === 'novo' ? espera : `sem resposta ${espera}`,
  };
}

// ---------------------------------------------------------------------------
// Os grupos, o resumo e os filtros
// ---------------------------------------------------------------------------

/**
 * O lead está nesta lista? "Clicaram e não chamaram" deixa de fora quem pediu
 * para não ser contatado: não há para quem ligar.
 */
export function estaNoGrupo(
  lead: Pick<LeadDoPortal, 'grupo' | 'suprimido'>,
  grupo: GrupoDoLead,
): boolean {
  return grupo === 'clicou' ? lead.grupo === 'clicou' && !lead.suprimido : lead.grupo === grupo;
}

type ParaContar = Pick<
  LeadDoPortal,
  'grupo' | 'situacao' | 'chegou_em' | 'recebido_no_portal_em' | 'recebido_em' | 'respondido_em'
>;

export type ResumoDosLeads = {
  hoje: number;
  seteDias: number;
  semResposta: number;
  /** A média até a primeira resposta, dos que chegaram nos últimos 7 dias; null sem nenhum. */
  tempoMedioMs: number | null;
};

/**
 * Só quem mandou mensagem, sem os descartados: hoje e os últimos 7 dias (hoje e
 * os 6 anteriores, no calendário de Natal) pela hora em que chegou; "sem
 * resposta" é a situação `novo`; o tempo médio é da chegada à primeira resposta.
 */
export function resumoDosLeads(
  leads: readonly ParaContar[],
  agora: Date = new Date(),
): ResumoDosLeads {
  const r: ResumoDosLeads = { hoje: 0, seteDias: 0, semResposta: 0, tempoMedioMs: null };
  let soma = 0;
  let respondidos = 0;
  for (const lead of leads) {
    if (lead.grupo !== 'mensagem' || lead.situacao === 'descartado') continue;
    if (lead.situacao === 'novo') r.semResposta += 1;
    const chegou = chegouEm(lead);
    const dias = diasEntre(new Date(chegou), agora);
    if (dias === 0) r.hoje += 1;
    if (dias >= 0 && dias < 7) {
      r.seteDias += 1;
      if (lead.respondido_em) {
        soma += Math.max(0, Date.parse(lead.respondido_em) - Date.parse(chegou));
        respondidos += 1;
      }
    }
  }
  if (respondidos > 0) r.tempoMedioMs = soma / respondidos;
  return r;
}

export type ResumoDoAnuncio = {
  /** O código, ou '' para os que vieram sem código. */
  chave: string;
  codigo: string | null;
  titulo: string | null;
  mensagem: number;
  /** Dos que mandaram mensagem, quantos nasceram da conversa ("Mensagem no WhatsApp"). */
  whatsapp: number;
  clicou: number;
  semResposta: number;
};

/**
 * Quanto cada anúncio rendeu nos últimos 7 dias: quantos mandaram mensagem,
 * quantos só clicaram, e quantos dos que mandaram estão sem resposta. Os mesmos
 * recortes das duas listas (sem os descartados; quem pediu para não ser
 * contatado não entra em "clicaram"). O Lead Certo fica de fora e é contado à
 * parte: a pessoa não viu o anúncio, então ele não "rendeu" esse lead. Dos que
 * mandaram mensagem, `whatsapp` conta os que nasceram da conversa (o texto do
 * anúncio que o CRM reconheceu), por anúncio e no total.
 */
export function resumoPorAnuncio(
  leads: readonly (ParaContar &
    Pick<
      LeadDoPortal,
      | 'suprimido'
      | 'lead_certo'
      | 'anuncio_codigo'
      | 'client_listing_id'
      | 'anuncio_titulo'
      | 'origem'
      | 'tipos'
    >)[],
  agora: Date = new Date(),
): { anuncios: ResumoDoAnuncio[]; leadCerto: number; whatsapp: number } {
  const porCodigo = new Map<string, ResumoDoAnuncio>();
  let leadCerto = 0;
  let whatsapp = 0;
  for (const lead of leads) {
    if (lead.situacao === 'descartado') continue;
    const mandou = estaNoGrupo(lead, 'mensagem');
    if (!mandou && !estaNoGrupo(lead, 'clicou')) continue;
    const dias = diasEntre(new Date(chegouEm(lead)), agora);
    if (dias < 0 || dias >= 7) continue;
    if (lead.lead_certo) {
      leadCerto += 1;
      continue;
    }
    const codigo = codigoDoAnuncioDoLead(lead);
    const chave = codigo ?? '';
    const linha = porCodigo.get(chave) ?? {
      chave,
      codigo,
      titulo: null,
      mensagem: 0,
      whatsapp: 0,
      clicou: 0,
      semResposta: 0,
    };
    linha.titulo ??= lead.anuncio_titulo?.trim() || null;
    if (mandou) {
      linha.mensagem += 1;
      if (ehLeadDoWhatsapp(lead)) {
        linha.whatsapp += 1;
        whatsapp += 1;
      }
      if (lead.situacao === 'novo') linha.semResposta += 1;
    } else {
      linha.clicou += 1;
    }
    porCodigo.set(chave, linha);
  }
  const anuncios = [...porCodigo.values()].sort(
    (a, b) =>
      // Sem código vai por último; os anúncios, do que mais rendeu ao que menos.
      Number(a.codigo === null) - Number(b.codigo === null) ||
      b.mensagem + b.clicou - (a.mensagem + a.clicou) ||
      b.mensagem - a.mensagem ||
      (a.codigo ?? '').localeCompare(b.codigo ?? '', 'pt-BR'),
  );
  return { anuncios, leadCerto, whatsapp };
}

/** "Todos" deixa os descartados de fora, como a lista de Anúncios faz com os excluídos. */
export type RecorteDosLeads = 'todos' | SituacaoDoLead;

export type FiltrosDosLeads = {
  /** A lista: quem mandou mensagem, ou quem clicou e não chamou. */
  grupo: GrupoDoLead;
  recorte: RecorteDosLeads;
  /** Um `leadType`, ou null para todos (a lista de quem clicou). */
  tipo: string | null;
  /** Por onde chegou, ou null para todos (a lista de quem mandou mensagem). */
  chegouPor: ChegouPor | null;
  /** O código do anúncio (`?anuncio=`), ou null para todos. */
  anuncio: string | null;
  busca: string;
};

export const FILTROS_INICIAIS: FiltrosDosLeads = {
  grupo: 'mensagem',
  recorte: 'todos',
  tipo: null,
  chegouPor: null,
  anuncio: null,
  busca: '',
};

/** Sem acento e em minúsculas, como o `unaccent` + `lower` do banco. */
export function normalizarBusca(texto: string): string {
  return semAcento(texto).replace(/\s+/g, ' ');
}

export function codigoDoAnuncioDoLead(
  lead: Pick<LeadDoPortal, 'anuncio_codigo' | 'client_listing_id'>,
): string | null {
  return (lead.anuncio_codigo ?? lead.client_listing_id ?? '').trim() || null;
}

/**
 * Os leads que passam nos filtros. `semRecorte` ignora a situação: é a base dos
 * números dos chips ("3 sem resposta" deste anúncio).
 */
export function filtrarLeads<T extends LeadDoPortal>(
  leads: readonly T[],
  filtros: FiltrosDosLeads,
  { semRecorte = false }: { semRecorte?: boolean } = {},
): T[] {
  const busca = normalizarBusca(filtros.busca);
  const anuncio = filtros.anuncio?.trim().toLowerCase() || null;
  return leads.filter((lead) => {
    if (!estaNoGrupo(lead, filtros.grupo)) return false;
    if (!semRecorte) {
      const fora =
        filtros.recorte === 'todos'
          ? lead.situacao === 'descartado'
          : lead.situacao !== filtros.recorte;
      if (fora) return false;
    }
    if (filtros.tipo && !tiposDoLead(lead.tipos).includes(filtros.tipo)) return false;
    if (filtros.chegouPor && jeitoDeChegar(lead) !== filtros.chegouPor) return false;
    if (anuncio && codigoDoAnuncioDoLead(lead)?.toLowerCase() !== anuncio) return false;
    if (
      busca &&
      !normalizarBusca(lead.ficha_nome ?? '').includes(busca) &&
      !normalizarBusca(lead.nome_no_portal ?? '').includes(busca)
    ) {
      return false;
    }
    return true;
  });
}

/** Quantos há em cada situação, para os chips. "todos" já sem os descartados. */
export function contagemPorSituacao(
  leads: readonly Pick<LeadDoPortal, 'situacao'>[],
): Record<RecorteDosLeads, number> {
  const c: Record<RecorteDosLeads, number> = {
    todos: 0,
    novo: 0,
    em_atendimento: 0,
    respondido: 0,
    descartado: 0,
  };
  for (const lead of leads) {
    c[lead.situacao] += 1;
    if (lead.situacao !== 'descartado') c.todos += 1;
  }
  return c;
}

/** A mensagem numa linha: espaços juntados e cortada na palavra, com reticências. */
export function cortarMensagem(texto: string | null | undefined, limite = 90): string {
  const limpo = (texto ?? '').replace(/\s+/g, ' ').trim();
  if (limpo.length <= limite) return limpo;
  const corte = limpo.slice(0, limite);
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > limite * 0.6 ? corte.slice(0, espaco) : corte).replace(/[\s.,;:!?-]+$/, '')}…`;
}

/** O título do anúncio curto o bastante para a linha da lista. */
export function tituloCurto(titulo: string | null | undefined, limite = 40): string | null {
  const t = (titulo ?? '').trim();
  return t ? cortarMensagem(t, limite) : null;
}
