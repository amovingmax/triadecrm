/**
 * "Link do Calendly" (11/11/2026, só admin e só na Imova, módulo `agendaComImovel`),
 * a parte pura.
 *
 * O link público do Calendly é o que o botão "Enviar link da agenda" e a IA mandam ao
 * cliente, com o nome, o tipo, o telefone e o imóvel já preenchidos. Ele mora em
 * `app_settings['calendly'].link` (junto com `dono_email` e `google_agenda_id`, que
 * não mudam) e só muda por `public.calendly_link_configurar`, que confere o papel e
 * aceita só `https://calendly.com/...`.
 *
 * O preenchimento depende da ORDEM das perguntas no Calendly (`a1`, `a2`, `a3`), por
 * isso a tela mostra a ordem certa ao lado do campo.
 */

/** As perguntas do evento, na ordem que o preenchimento do link espera. */
export const PERGUNTAS_DO_CALENDLY: readonly string[] = [
  'O que você quer marcar? (Visita a um imóvel / Reunião)',
  'Telefone (WhatsApp)',
  'Endereço ou código do imóvel',
];

export type ConfiguracaoDoLink = {
  /** O link de todos os agendamentos; nulo enquanto ninguém cadastrou. */
  link: string | null;
  /** Um evento só para visita, quando houver (plano pago); vale no lugar de `link`. */
  linkVisita: string | null;
  linkReuniao: string | null;
};

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

/** O `value` de `app_settings['calendly']`, conferido. Linha ausente = nada cadastrado. */
export function lerConfiguracaoDoLink(valor: unknown): ConfiguracaoDoLink {
  const v = (
    typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? valor : {}
  ) as Record<string, unknown>;
  return {
    link: texto(v.link),
    linkVisita: texto(v.link_visita),
    linkReuniao: texto(v.link_reuniao),
  };
}

export type LinkValidado = { ok: true; link: string } | { ok: false; recado: string };

/**
 * A mesma régua do banco, antes de gravar: só `https://calendly.com/<evento>`. Aceita
 * o link colado sem o `https://` e tira o que vem depois do `?` ou do `#` (o mês que a
 * página do Calendly põe no endereço, por exemplo): é o CRM que acrescenta os
 * parâmetros do preenchimento.
 */
export function validarLinkDoCalendly(entrada: string): LinkValidado {
  const bruto = entrada.trim();
  if (!bruto) return { ok: false, recado: 'Cole o link do evento do Calendly.' };
  const comEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(bruto) ? bruto : `https://${bruto}`;
  let url: URL;
  try {
    url = new URL(comEsquema);
  } catch {
    return { ok: false, recado: 'Isso não é um link. Copie o endereço do evento no Calendly.' };
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'calendly.com') {
    return { ok: false, recado: 'O link precisa começar com https://calendly.com/.' };
  }
  const caminho = url.pathname.replace(/\/+$/, '');
  if (caminho === '' || caminho === '/') {
    return {
      ok: false,
      recado: 'Falta o evento no link: ele é https://calendly.com/<sua conta>/<evento>.',
    };
  }
  return { ok: true, link: `https://calendly.com${caminho}` };
}

/** O recado da recusa do banco ao gravar. */
export function erroAoGravarOLink(codigo: string | undefined, motivo?: string | null): string {
  if (codigo === '42501' || motivo === 'sem_permissao' || motivo === 'so_admin') {
    return 'Só um admin muda o link do Calendly.';
  }
  if (codigo === '22023' || motivo === 'link_invalido') {
    return 'O link precisa começar com https://calendly.com/.';
  }
  return 'Não deu para gravar agora. Confira a conexão e tente de novo.';
}
