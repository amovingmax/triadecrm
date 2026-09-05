import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { lerRascunho, objeto, numero, texto } from '@/components/precadastro/tipos';

import { clientePublico, tokenPlausivel } from './cliente-publico';
import { LinkSemPerfil, PerfilReivindicado } from './estados';
import { hashDoTermo } from './termo-servidor';
import { TelaReivindicacao, type PreviaDoPerfil } from './tela-reivindicacao';

/**
 * `/c/<token>` — a página de reivindicação do pré-cadastro (RF-PRE-08, R10 §3 E3).
 *
 * É a única rota do produto que abre sem sessão, e a única em que um dado de
 * parceiro aparece para alguém de fora do time. Três coisas seguram isso:
 *
 * 1. Não há RLS a discutir: `anon` não tem `grant` de tabela nenhuma. O acesso
 *    passa por `public.abrir_reivindicacao(token)`, que é `security definer`,
 *    devolve UMA linha e só devolve o que o próprio dono já sabe — nome, os
 *    campos factuais do rascunho e a origem. Telefone, e-mail, temperatura,
 *    etapa do funil, dono da carteira: nada disso sai daqui.
 * 2. O token só existe como sha256 no banco, vale 7 dias, e a comparação é feita
 *    lá dentro. Esta página nunca sabe se um token "quase certo" existe.
 * 3. `referrer: 'no-referrer'` na metadata: o token está na URL, e um link de
 *    saída que vazasse o `Referer` vazaria a chave junto. Somado ao `robots`
 *    negativo que o layout raiz já carimba, a página não é indexada nem citada.
 */

export const metadata: Metadata = {
  title: 'Este perfil é seu?',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/**
 * Nunca estática e nunca em cache: a página REGISTRA a abertura do link
 * (`claim_link_opened`, com hash do IP), e uma resposta reaproveitada registraria
 * a visita de uma pessoa e mostraria o rascunho para outra.
 */
export const dynamic = 'force-dynamic';

/** Data de expiração do rascunho no fuso de Natal, escrita em dígitos. */
const DATA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Fortaleza',
});

/**
 * `expires_at` é NOT NULL no banco, mas a resposta chega como jsonb: uma data
 * ausente ou ilegível vira `null` e a frase da expiração some, em vez de a página
 * anunciar uma data inventada a partir do relógio de agora.
 */
function dataDeExpiracao(iso: string | null): string | null {
  if (!iso) return null;
  const quando = new Date(iso);
  return Number.isNaN(quando.getTime()) ? null : DATA.format(quando);
}

export default async function Pagina({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Peneira de forma antes de gastar uma ida ao banco. O motivo devolvido é o
  // mesmo da RPC de propósito: um token malformado e um token inexistente não
  // podem ser distinguíveis pela tela.
  if (!tokenPlausivel(token)) return <LinkSemPerfil motivo="token_invalido" />;

  const cabecalhos = await headers();
  const supabase = clientePublico();

  const { data, error } = await supabase.rpc('abrir_reivindicacao', {
    p_token: token,
    p_user_agent: cabecalhos.get('user-agent')?.slice(0, 400) ?? null,
    // A RPC guarda só o sha256 deste valor, nunca o endereço em claro.
    p_ip: cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  // Falha de rede ou de banco cai no mesmo lugar que o link inválido: sem o
  // rascunho não há o que mostrar, e inventar uma tela de erro técnica para o
  // dono do buffet não ajudaria ninguém.
  if (error) return <LinkSemPerfil motivo="token_invalido" />;

  const r = objeto(data);
  if (r.ok !== true) return <LinkSemPerfil motivo={texto(r.motivo) ?? 'token_invalido'} />;

  const nome = texto(r.nome) ?? 'o seu negócio';

  // Reivindicado com token ainda vivo não acontece pelo caminho normal (o aceite
  // apaga o hash), mas acontece se alguém reabrir a página com um token guardado
  // antes do aceite. Mostrar de novo o formulário seria pedir um segundo aceite
  // para quem já autorizou.
  if (r.reivindicado === true) return <PerfilReivindicado quem="" nome={nome} />;

  const previa: PreviaDoPerfil = {
    nome,
    campos: lerRascunho(r.rascunho),
    origem: texto(r.origem),
    fotosPublicas: numero(r.fotos_publicas),
    apagaEm: dataDeExpiracao(texto(r.expira_em)),
  };

  return <TelaReivindicacao token={token} previa={previa} termoHash={hashDoTermo()} />;
}
