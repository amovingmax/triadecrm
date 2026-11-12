import { MOTIVOS_DE_RECUSA_DO_ENVIO } from './mensagens';
import type { EstadoDaJanela } from './tipos';

/**
 * "Enviar link da agenda" em Conversas, a parte pura (11/11/2026, só na Imova,
 * módulo `agendaComImovel`).
 *
 * Pedido do usuário: "Preciso que a IA envie o link da agenda para o cliente marcar
 * o horário da visita ao local ou horário da reunião. Caso seja visita presencial,
 * deverá ter o endereço e o código do imóvel/terreno que será tratado." A pessoa da
 * equipe manda o mesmo link pelo botão: o link pessoal do Calendly, que já leva o
 * nome, o tipo, o telefone e, na visita, o código e o endereço do imóvel, mais o
 * convite (`utm_content`) que liga o agendamento à ficha e à conversa.
 *
 * Quem monta o texto e o link é o banco: `public.agenda_link_previa` (a prévia, sem
 * gravar) e `public.agenda_enviar_link` (o convite e a mensagem, pela porteira de
 * sempre). Aqui ficam o que a folha diz quando não dá e a prévia com o começo que a
 * pessoa escreveu.
 */

export type TipoDoLink = 'visita' | 'reuniao';

/** As duas opções, com o mesmo texto da pergunta do Calendly. */
export const TIPOS_DO_LINK: readonly { id: TipoDoLink; rotulo: string }[] = [
  { id: 'visita', rotulo: 'Visita a um imóvel' },
  { id: 'reuniao', rotulo: 'Reunião' },
];

/** O que `agenda_link_previa` devolve quando dá certo. */
export type PreviaDoLink = {
  texto: string;
  link: string;
  codigo: string | null;
  endereco: string | null;
  titulo: string | null;
};

export type RespostaDoLink<T> =
  ({ ok: true } & T) | { ok: false; motivo: string; detalhe: string | null };

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

/** A prévia do banco, conferida campo a campo (sem texto ou sem link, é recusa). */
export function lerPrevia(valor: unknown): RespostaDoLink<PreviaDoLink> {
  const v = (typeof valor === 'object' && valor !== null ? valor : {}) as Record<string, unknown>;
  if (v.ok !== true) return recusa(v);
  const corpo = texto(v.texto);
  const link = texto(v.link);
  if (!corpo || !link) return { ok: false, motivo: 'resposta_estranha', detalhe: null };
  return {
    ok: true,
    texto: corpo,
    link,
    codigo: texto(v.codigo),
    endereco: texto(v.endereco),
    titulo: texto(v.titulo),
  };
}

/** O que `agenda_enviar_link` devolve. */
export function lerEnvio(
  valor: unknown,
): RespostaDoLink<{ mensagemId: string | null; link: string | null }> {
  const v = (typeof valor === 'object' && valor !== null ? valor : {}) as Record<string, unknown>;
  if (v.ok !== true) return recusa(v);
  return { ok: true, mensagemId: texto(v.mensagem_id), link: texto(v.link) };
}

function recusa(v: Record<string, unknown>): { ok: false; motivo: string; detalhe: string | null } {
  return { ok: false, motivo: texto(v.motivo) ?? 'resposta_estranha', detalhe: texto(v.detalhe) };
}

/**
 * Cada recusa do contrato em português claro. `nao_pode_enviar` traz no `detalhe`
 * o motivo da porteira (`messages_guard`), que tem a frase dela.
 */
const RECADO_DO_LINK: Record<string, string> = {
  sem_permissao: 'Seu perfil não pode mandar mensagem nesta conversa.',
  tipo_invalido: 'Escolha se o cliente vai marcar uma visita a um imóvel ou uma reunião.',
  visita_sem_imovel:
    'Para a visita, escolha o anúncio do imóvel: o link leva o código e o endereço dele.',
  anuncio_invalido: 'Esse anúncio não existe mais ou foi excluído. Escolha outro.',
  sem_link_configurado:
    'O link do Calendly ainda não foi cadastrado. Um admin cadastra no pé da Agenda, em "Link do Calendly".',
  fora_da_janela:
    'Faz mais de 24 h que o cliente escreveu. Fora da janela, a Meta só deixa passar modelo aprovado, e o link da agenda é texto livre: ele volta a sair quando o cliente responder.',
  nao_pode_enviar: 'O WhatsApp não deixou a mensagem sair agora.',
  funcao_ausente:
    'O banco ainda não tem o link da agenda. Avise um admin para publicar a atualização.',
  resposta_estranha:
    'O servidor respondeu de um jeito que esta versão da tela não entende. Recarregue a página.',
  erro_do_servidor: 'Não deu para falar com o servidor. Confira a conexão e tente de novo.',
};

export function recadoDoLink(motivo: string, detalhe?: string | null): string {
  if (motivo === 'nao_pode_enviar' && detalhe) {
    const daPorteira = MOTIVOS_DE_RECUSA_DO_ENVIO[detalhe];
    if (daPorteira) return daPorteira;
  }
  return RECADO_DO_LINK[motivo] ?? RECADO_DO_LINK.erro_do_servidor!;
}

/**
 * Por que a opção está desligada, no tom do relógio da janela (`janela-24h.tsx`).
 * Nulo quando o link pode sair: janela aberta, contato sem bloqueio e sem pedido
 * para sair. O link é texto livre, e só sai dentro da janela.
 */
export function porqueOLinkNaoSai(p: {
  janela: EstadoDaJanela;
  naoContatar?: boolean;
  bloqueada?: boolean;
}): string | null {
  if (p.naoContatar)
    return 'Este cliente pediu para não receber mais mensagens. Nada sai para ele.';
  if (p.bloqueada) return 'Contato bloqueado: nada sai para este número.';
  const { janela } = p;
  if (janela.situacao === 'aberta') return null;
  if (janela.situacao === 'fechada') {
    return 'Fora da janela de 24 h, a Meta só deixa passar modelo aprovado, e o link da agenda é texto livre. Ele volta a sair quando o cliente responder.';
  }
  return 'A janela de 24 h só existe depois que o cliente escreve. O link da agenda sai quando ele escrever.';
}

/**
 * Onde, na prévia do banco, começa o que ele SEMPRE acrescenta: a linha do imóvel
 * (na visita, a primeira linha com o código ou o endereço) ou, na reunião, a linha
 * do link. Antes disso está o começo padrão, que a pessoa pode trocar.
 */
function inicioDoQueOBancoAcrescenta(previa: PreviaDoLink): number {
  const linhas = previa.texto.split('\n');
  const marcas = [previa.codigo, previa.endereco, previa.link].filter(
    (m): m is string => m !== null,
  );
  let posicao = 0;
  for (const linha of linhas) {
    if (marcas.some((m) => linha.includes(m))) return posicao;
    posicao += linha.length + 1;
  }
  return 0;
}

/** O começo que sai quando a pessoa não escreve nada: é o exemplo do campo. */
export function comecoPadrao(previa: PreviaDoLink): string {
  return previa.texto.slice(0, inicioDoQueOBancoAcrescenta(previa)).trim();
}

/**
 * A prévia com o começo que a pessoa escreveu. Sem começo, é a prévia do banco
 * letra por letra. Com ele, o começo dela no lugar do padrão, e o resto (o imóvel e o
 * link) como o banco acrescenta, com o mesmo espaço entre um e outro.
 */
export function previaComOComeco(previa: PreviaDoLink, comeco: string): string {
  const dela = comeco.trim();
  if (!dela) return previa.texto;
  const inicio = inicioDoQueOBancoAcrescenta(previa);
  const resto = previa.texto.slice(inicio);
  const espaco = inicio > 0 ? (/\s*$/.exec(previa.texto.slice(0, inicio))?.[0] ?? '') : '';
  return `${dela}${espaco || '\n\n'}${resto}`;
}

/** O teto do começo: o texto inteiro ainda cabe nos 4096 da Cloud API. */
export const TETO_DO_COMECO = 1000;
