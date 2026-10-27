/**
 * Ajustes → WhatsApp (27/10/2026): as regras sem rede nem React.
 *
 * Duas coisas moram nesta aba:
 *   1. as opções do envio que o contato percebe, em `app_settings['whatsapp.envio']`
 *      (a mesma linha do número conectado e da assinatura com o nome — por isso
 *      a gravação MESCLA, nunca troca o objeto inteiro):
 *        * `confirmar_leitura`: os tiques azuis quando alguém abre a conversa;
 *        * `mostrar_digitando`: o "digitando…" enquanto alguém escreve.
 *      As duas nascem ligadas: chave ausente é ligada (`app.wa_opcao`).
 *   2. o perfil da empresa no WhatsApp (o recado, a descrição, o endereço, o
 *      e-mail, os sites, a categoria e a foto), em `app_settings['whatsapp.perfil']`,
 *      escrito pelo worker-wa depois de ler da Meta. Só o admin muda, por
 *      `wa_perfil_salvar`, com os tetos da Meta.
 */

export type OpcoesDeEnvio = { confirmarLeitura: boolean; mostrarDigitando: boolean };

export type ChaveDeEnvio = 'confirmar_leitura' | 'mostrar_digitando';

function objeto(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

/** Ligada, a menos que esteja escrito "falso" (é como `app.wa_opcao` lê). */
function ligada(valor: unknown): boolean {
  return !(valor === false || valor === 'false');
}

export function lerOpcoesDeEnvio(valor: unknown): OpcoesDeEnvio {
  const v = objeto(valor);
  return {
    confirmarLeitura: ligada(v.confirmar_leitura),
    mostrarDigitando: ligada(v.mostrar_digitando),
  };
}

/** O objeto novo de `whatsapp.envio`: o de antes, com só a chave que mudou. */
export function mesclarOpcoes(
  valor: unknown,
  mudanca: Partial<Record<ChaveDeEnvio, boolean>>,
): Record<string, unknown> {
  return { ...objeto(valor), ...mudanca };
}

// ---------------------------------------------------------------------------
// O perfil
// ---------------------------------------------------------------------------

export type PerfilDoWhatsapp = {
  about: string;
  address: string;
  description: string;
  email: string;
  websites: string[];
  vertical: string;
  profilePictureUrl: string | null;
  /** Quando o worker leu da Meta pela última vez. */
  lidoEm: string | null;
};

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

/** `null` quando o worker ainda não leu o perfil nenhuma vez. */
export function lerPerfil(valor: unknown): PerfilDoWhatsapp | null {
  const v = objeto(valor);
  if (Object.keys(v).length === 0) return null;
  return {
    about: texto(v.about),
    address: texto(v.address),
    description: texto(v.description),
    email: texto(v.email),
    websites: Array.isArray(v.websites)
      ? v.websites.filter((s): s is string => typeof s === 'string')
      : [],
    vertical: texto(v.vertical),
    profilePictureUrl: texto(v.profile_picture_url) || null,
    lidoEm: texto(v.lido_em) || null,
  };
}

/** O que o formulário edita: os dois sites em campos separados. */
export type FormularioDoPerfil = {
  about: string;
  description: string;
  address: string;
  email: string;
  site1: string;
  site2: string;
  vertical: string;
};

export function formularioDoPerfil(perfil: PerfilDoWhatsapp | null): FormularioDoPerfil {
  return {
    about: perfil?.about ?? '',
    description: perfil?.description ?? '',
    address: perfil?.address ?? '',
    email: perfil?.email ?? '',
    site1: perfil?.websites[0] ?? '',
    site2: perfil?.websites[1] ?? '',
    vertical: perfil?.vertical ?? '',
  };
}

/**
 * Só o que mudou vai para `wa_perfil_salvar`: o que não mudou não é reescrito na
 * Meta, e o recado vazio (que a Meta recusa) não vai por engano.
 */
export function mudancasDoPerfil(
  antes: FormularioDoPerfil,
  agora: FormularioDoPerfil,
): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  for (const chave of ['about', 'description', 'address', 'email'] as const) {
    if (agora[chave].trim() !== antes[chave].trim()) m[chave] = agora[chave].trim();
  }
  const sites = (f: FormularioDoPerfil) => [f.site1.trim(), f.site2.trim()].filter((s) => s !== '');
  if (sites(agora).join('\n') !== sites(antes).join('\n')) m.websites = sites(agora);
  if (agora.vertical !== antes.vertical && agora.vertical !== '') m.vertical = agora.vertical;
  return m;
}

/** A mesma conferência de `wa_perfil_salvar`, antes de ir: devolve o motivo ou `null`. */
export function conferirPerfil(m: Record<string, unknown>): string | null {
  if ('about' in m) {
    const n = String(m.about ?? '').length;
    if (n < 1 || n > 139) return 'recado_de_1_a_139_letras';
  }
  if ('address' in m && String(m.address ?? '').length > 256) return 'endereco_longo_demais';
  if ('description' in m && String(m.description ?? '').length > 512)
    return 'descricao_longa_demais';
  if ('email' in m) {
    const email = String(m.email ?? '');
    if (email.length > 128) return 'email_longo_demais';
    if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'email_invalido';
  }
  if ('websites' in m) {
    const sites = Array.isArray(m.websites) ? m.websites : [];
    if (
      sites.length > 2 ||
      sites.some((s) => typeof s !== 'string' || s.length > 256 || !/^https?:\/\//.test(s))
    ) {
      return 'ate_2_sites_com_http';
    }
  }
  return null;
}

const FRASE_DO_PERFIL: Readonly<Record<string, string>> = {
  sem_permissao: 'Só o admin muda o perfil do WhatsApp.',
  dados_invalidos: 'O formulário veio estranho. Recarregue a página.',
  recado_de_1_a_139_letras: 'O recado vai de 1 a 139 letras.',
  endereco_longo_demais: 'O endereço passou de 256 letras.',
  descricao_longa_demais: 'A descrição passou de 512 letras.',
  email_longo_demais: 'O e-mail passou de 128 letras.',
  email_invalido: 'O e-mail não parece um e-mail.',
  ate_2_sites_com_http: 'Até 2 sites, cada um começando com https://.',
  nada_mudou: 'Nada mudou.',
};

export function fraseDoPerfil(motivo: string | null | undefined): string {
  return FRASE_DO_PERFIL[motivo ?? ''] ?? 'Não salvou. Tente de novo em alguns segundos.';
}

/** As categorias da Meta (`vertical`), em português. A Meta não aceita outra. */
export const VERTICAIS: readonly { valor: string; rotulo: string }[] = [
  { valor: 'EVENT_PLAN', rotulo: 'Organização de eventos' },
  { valor: 'PROF_SERVICES', rotulo: 'Serviços profissionais' },
  { valor: 'ENTERTAIN', rotulo: 'Entretenimento' },
  { valor: 'RESTAURANT', rotulo: 'Restaurante' },
  { valor: 'RETAIL', rotulo: 'Varejo' },
  { valor: 'BEAUTY', rotulo: 'Beleza e estética' },
  { valor: 'APPAREL', rotulo: 'Roupas e acessórios' },
  { valor: 'HOTEL', rotulo: 'Hotel e hospedagem' },
  { valor: 'TRAVEL', rotulo: 'Viagem e transporte' },
  { valor: 'EDU', rotulo: 'Educação' },
  { valor: 'HEALTH', rotulo: 'Saúde' },
  { valor: 'FINANCE', rotulo: 'Finanças' },
  { valor: 'GROCERY', rotulo: 'Mercado' },
  { valor: 'AUTO', rotulo: 'Automotivo' },
  { valor: 'NONPROFIT', rotulo: 'Sem fins lucrativos' },
  { valor: 'GOVT', rotulo: 'Governo' },
  { valor: 'OTHER', rotulo: 'Outra' },
];
