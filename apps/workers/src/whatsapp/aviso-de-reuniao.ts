/**
 * O e-mail de reunião marcada, cancelada ou remarcada (ADR-15).
 *
 * POR QUE ISTO EXISTE
 * ---------------------------------------------------------------------------
 * A partir de 25/09/2026 o calendário é do CRM e a IA marca sozinha. Reunião
 * que a IA marca sem ninguém saber é reunião a que ninguém vai: o aviso é o que
 * põe a pessoa que atende a par de um compromisso que ela não agendou.
 *
 * Reaproveita o cano que já existe — `enviarPeloResend`, extraído de
 * `aviso-por-email.ts` — e não o corpo. Segundo worker para mandar um e-mail
 * seria infraestrutura nova para um problema que não existe.
 *
 * QUEM RECEBE
 * ---------------------------------------------------------------------------
 * O DONO da reunião (é dele a agenda que ficou ocupada) mais a lista do time em
 * `app_settings.notificacoes.email.para`. O dono entra por fora da config
 * porque a config é a lista do time, e o dono muda a cada reunião.
 *
 * O LEAD NÃO RECEBE E-MAIL. Ele falou por WhatsApp e foi por WhatsApp que
 * consentiu; muitos nem têm e-mail na ficha. A confirmação dele é a mensagem do
 * robô. E-mail para o lead exige base legal declarada e um `consent_events` que
 * não existe — vira item no dia em que houver.
 *
 * O QUE NÃO VAI: o telefone do parceiro. E-mail é caixa de entrada de gente,
 * fora da RLS, e telefone completo lá é PII exportada sem `pii_access_log`
 * (RF-BAS-14). Quem quer o resto abre o CRM, e o e-mail leva os dois links.
 */

import {
  enviarPeloResend,
  type ConfiguracaoDoAviso,
  type ResultadoDoEnvio,
} from './aviso-por-email';
import type { Logger } from '../lib/log';

/** Uma linha de `public.reuniao_avisos_proximos`, do jeito que o e-mail precisa. */
export interface AvisoDeReuniao {
  msgId: number;
  chave: string;
  motivo: string;
  reuniaoId: string;
  organizationId: string | null;
  conversationId: string | null;
  parceiro: string | null;
  quandoPorExtenso: string | null;
  quandoCurto: string | null;
  formato: string;
  link: string | null;
  local: string | null;
  estado: string;
  marcadaPeloRobo: boolean;
  atende: string | null;
  emailDoDono: string | null;
}

const TITULO: Record<string, string> = {
  marcada: 'Reunião marcada',
  cancelada: 'Reunião cancelada',
  remarcada: 'Reunião remarcada',
};

export function assuntoDaReuniao(aviso: AvisoDeReuniao): string {
  const base =
    aviso.motivo === 'marcada' && aviso.estado === 'a_confirmar'
      ? 'Reunião a confirmar'
      : (TITULO[aviso.motivo] ?? 'Reunião');
  const quem = aviso.parceiro ?? 'parceiro';
  const quando = aviso.quandoCurto ?? 'sem hora';
  return `${base}: ${quem} — ${quando}`;
}

/** O corpo em texto puro. Sem HTML: e-mail de aviso se lê no celular. */
export function corpoDaReuniao(aviso: AvisoDeReuniao, urlDoCrm: string): string {
  const onde =
    aviso.formato === 'online'
      ? `Sala: ${aviso.link ?? '(sem link — abra o CRM)'}`
      : `Endereço: ${aviso.local ?? '(sem endereço — abra o CRM)'}`;

  const linhas: string[] = [
    aviso.motivo === 'cancelada'
      ? `A reunião com ${aviso.parceiro ?? 'o parceiro'} foi CANCELADA.`
      : aviso.motivo === 'remarcada'
        ? `A reunião com ${aviso.parceiro ?? 'o parceiro'} foi REMARCADA.`
        : `Tem reunião com ${aviso.parceiro ?? 'um parceiro'}.`,
    '',
    `Quando: ${aviso.quandoPorExtenso ?? 'sem hora'}`,
    `Formato: ${aviso.formato === 'online' ? 'on-line' : 'presencial'}`,
    onde,
    `Quem atende: ${aviso.atende ?? 'sem responsável na ficha'}`,
  ];

  if (aviso.marcadaPeloRobo) {
    linhas.push('Esta reunião foi marcada pelo robô, na conversa do WhatsApp.');
  }

  if (aviso.estado === 'a_confirmar') {
    linhas.push(
      '',
      'ATENÇÃO: o fornecedor ainda NÃO sabe o horário. Alguém precisa confirmar',
      'no cartão da Agenda para o robô poder dizer a ele que está marcado.',
    );
  }

  if (aviso.organizationId) {
    linhas.push('', `Ficha: ${urlDoCrm}/parceiros/${aviso.organizationId}`);
    linhas.push(`Conversa: ${urlDoCrm}/conversas?org=${aviso.organizationId}`);
  }
  linhas.push(`Agenda: ${urlDoCrm}/agenda`);

  return linhas.join('\n');
}

/**
 * A lista do time mais o dono, sem repetir.
 *
 * A comparação ignora caixa porque o mesmo endereço escrito de dois jeitos é
 * uma pessoa só — e dois e-mails idênticos na mesma caixa é o jeito mais barato
 * de o aviso passar a ser ignorado.
 */
export function destinatarios(aviso: AvisoDeReuniao, doTime: readonly string[]): string[] {
  const saida: string[] = [];
  const vistos = new Set<string>();
  for (const bruto of [...doTime, aviso.emailDoDono ?? '']) {
    const email = bruto.trim();
    if (email === '') continue;
    const chave = email.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(email);
  }
  return saida;
}

export async function avisarDaReuniao(
  aviso: AvisoDeReuniao,
  config: ConfiguracaoDoAviso,
  chave: string | undefined,
  logger: Logger,
  buscar: typeof fetch = fetch,
): Promise<ResultadoDoEnvio> {
  return enviarPeloResend(
    assuntoDaReuniao(aviso),
    corpoDaReuniao(aviso, config.urlDoCrm),
    config,
    destinatarios(aviso, config.para),
    chave,
    logger,
    buscar,
  );
}
