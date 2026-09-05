'use server';

import { headers } from 'next/headers';

import { TERMO_VERSAO } from '@/components/precadastro/termo';

import { clientePublico, tokenPlausivel } from './cliente-publico';
import { hashDoTermo } from './termo-servidor';

/**
 * As duas escritas da página pública, no servidor.
 *
 * Por que servidor, e não uma chamada direta do navegador: a prova do aceite
 * (LGPD art. 8º §2º, R06 PRE-07) é composta de coisas que o navegador não deve
 * ditar. O IP e o user-agent saem dos cabeçalhos da requisição, e o hash do termo
 * é recalculado aqui a partir do MESMO texto que a página renderizou. Se o hash
 * viesse do formulário, a prova provaria o que o cliente quisesse.
 *
 * O que o formulário manda é só o que só ele sabe: quem está aceitando e quais
 * caixas foram marcadas.
 */

export type ResultadoDoAceite =
  | { estado: 'inicial' }
  | { estado: 'aceito'; quem: string }
  | { estado: 'recusado' }
  | { estado: 'erro'; mensagem: string };

/**
 * Motivos das RPCs `aceitar_reivindicacao` e `recusar_reivindicacao`, escritos
 * para o dono do buffet — que não sabe o que é token, e nem precisa saber.
 */
const MOTIVO: Record<string, string> = {
  token_invalido:
    'Este link não vale mais. Peça um novo no mesmo WhatsApp por onde este chegou.',
  token_expirado:
    'Este link passou da validade de 7 dias. Peça um novo no mesmo WhatsApp por onde este chegou.',
  rascunho_encerrado:
    'Este rascunho já foi encerrado. Se foi engano, responda no WhatsApp que a gente resolve.',
  prova_incompleta:
    'Faltou alguma informação para registrar o seu aceite. Confira o nome e as duas caixas obrigatórias e tente de novo.',
  motivo_invalido: 'Escolha um dos dois motivos antes de confirmar.',
};

function frase(motivo: string | null): string {
  return (
    (motivo ? MOTIVO[motivo] : null) ??
    'Não deu para registrar agora. Tente de novo em instantes; se continuar, responda no WhatsApp que a gente resolve por lá.'
  );
}

function objeto(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor : null;
}

/**
 * O IP de quem aceitou, lido dos cabeçalhos.
 *
 * `x-forwarded-for` é uma lista da borda até aqui; o cliente é o PRIMEIRO item.
 * Sem proxy na frente (desenvolvimento na máquina do time) não há cabeçalho
 * nenhum, e aí o endereço honesto é o de loopback: melhor uma prova que diz "veio
 * da própria máquina" do que uma que inventa um IP público.
 */
function ipDaRequisicao(cabecalhos: Headers): string {
  const candidatos = [
    cabecalhos.get('x-forwarded-for')?.split(',')[0],
    cabecalhos.get('x-real-ip'),
    cabecalhos.get('cf-connecting-ip'),
  ];
  for (const bruto of candidatos) {
    const valor = bruto?.trim().replace(/^\[|\]$/g, '');
    // `inet` do Postgres aceita IPv4 e IPv6; esta peneira só descarta lixo óbvio,
    // porque quem valida de verdade é a coluna.
    if (valor && /^[0-9a-fA-F.:]{3,45}$/.test(valor)) return valor;
  }
  return '127.0.0.1';
}

/** O user-agent tem de ter pelo menos 5 caracteres (CHECK da tabela). */
function agenteDaRequisicao(cabecalhos: Headers): string {
  const bruto = cabecalhos.get('user-agent')?.trim();
  return bruto && bruto.length >= 5 ? bruto.slice(0, 400) : 'navegador não identificado';
}

/**
 * Registra o aceite (tela T3 do R10, RF-PRE-08).
 *
 * As duas caixas obrigatórias são conferidas AQUI, e não só no botão: `required`
 * no HTML é conveniência, não regra.
 */
export async function aceitar(
  token: string,
  _anterior: ResultadoDoAceite,
  formulario: FormData,
): Promise<ResultadoDoAceite> {
  if (!tokenPlausivel(token)) return { estado: 'erro', mensagem: frase('token_invalido') };

  const quem = String(formulario.get('quem') ?? '').trim();
  if (quem.length < 2) {
    return {
      estado: 'erro',
      mensagem: 'Escreva o seu nome completo: é ele que fica registrado como quem autorizou.',
    };
  }
  if (formulario.get('termos') !== 'on' || formulario.get('dados') !== 'on') {
    return {
      estado: 'erro',
      mensagem:
        'As duas primeiras caixas são obrigatórias: sem elas a Komune não pode usar os seus dados, e o perfil não é criado.',
    };
  }

  const cabecalhos = await headers();
  const supabase = clientePublico();

  const { data, error } = await supabase.rpc('aceitar_reivindicacao', {
    p_token: token,
    p_terms_version: TERMO_VERSAO,
    p_terms_hash: hashDoTermo(),
    p_ip: ipDaRequisicao(cabecalhos),
    p_user_agent: agenteDaRequisicao(cabecalhos),
    p_who_accepted: quem.slice(0, 120),
    p_auth_method: 'claim_link',
    p_marketing_optin: formulario.get('novidades') === 'on',
    // Nenhuma foto pública foi coletada (R03), então não há o que importar. A
    // declaração de titularidade acontece no envio, dentro da conta da Komune.
    p_photo_import: false,
  });

  if (error) return { estado: 'erro', mensagem: frase(null) };

  const r = objeto(data);
  if (r.ok !== true) return { estado: 'erro', mensagem: frase(texto(r.motivo)) };

  return { estado: 'aceito', quem };
}

/**
 * "Não é meu" / "não quero perfil", sem login (R06 PRE-09).
 *
 * Apaga o rascunho em até 48 h e registra a oposição, que suprime o contato em
 * todo o CRM. É a saída que a LGPD exige que exista antes de o dado ser usado, e
 * por isso ela não pede nome, não pede confirmação por e-mail e não negocia.
 */
export async function recusar(
  token: string,
  _anterior: ResultadoDoAceite,
  formulario: FormData,
): Promise<ResultadoDoAceite> {
  if (!tokenPlausivel(token)) return { estado: 'erro', mensagem: frase('token_invalido') };

  const motivo = String(formulario.get('motivo') ?? '');
  if (motivo !== 'nao_e_meu' && motivo !== 'nao_quero') {
    return { estado: 'erro', mensagem: frase('motivo_invalido') };
  }

  const supabase = clientePublico();
  const { data, error } = await supabase.rpc('recusar_reivindicacao', {
    p_token: token,
    p_motivo: motivo,
  });

  if (error) return { estado: 'erro', mensagem: frase(null) };

  const r = objeto(data);
  if (r.ok !== true) return { estado: 'erro', mensagem: frase(texto(r.motivo)) };

  return { estado: 'recusado' };
}
