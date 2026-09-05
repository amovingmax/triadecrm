'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  ExternalLink,
  FilePlus2,
  Link2,
  Lock,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import type { AppRole } from '@/lib/auth/role';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarData, formatarDataHora } from '@/components/parceiros/formatos';

import {
  buscarPreCadastro,
  chaveDoPreCadastro,
  criarRascunho,
  frase,
  gerarLink,
  mensagemDoErro,
  MOTIVO_DA_CRIACAO,
  MOTIVO_DO_LINK,
} from './dados';
import { EsqueletoDoPainel, ErroDoPainel } from './estados';
import { REVISADO_PELO_JURIDICO } from './termo';
import {
  podeEmitirLink,
  ROTULO_ATOR,
  ROTULO_EVENTO,
  ROTULO_SITUACAO,
  type LinkEmitido,
  type PreCadastro,
} from './tipos';

/** Papéis que o banco deixa escrever (`app.can_write`). */
const ESCREVEM: readonly AppRole[] = ['admin', 'gestor', 'sdr', 'embaixador'];

/**
 * Pré-cadastro na Komune, dentro da ficha do parceiro (RF-PRE-05, RF-PRE-07, RF-PRE-16).
 *
 * O painel é uma escada de três degraus, e a escada é o conteúdo: rascunho →
 * autorização → link. O degrau do meio não é nosso, é do fornecedor, e é por isso
 * que o botão que emite o link nasce DESABILITADO e explica, no lugar onde a mão
 * ia clicar, que a autorização vem primeiro. Sem `consent_events` não sai link — a
 * RPC recusa de qualquer jeito (guardrail do CLAUDE.md e RF-PRE-06); o que a tela
 * faz é impedir que a pessoa descubra isso batendo na porta.
 *
 * O TOKEN APARECE UMA VEZ SÓ. O banco guarda apenas o sha256, então recarregar a
 * ficha não traz o endereço de volta — o painel diz isso na hora em que mostra o
 * link, e diz de novo quando existe um link ativo cujo endereço já não temos.
 */
export function PainelPreCadastro({
  organizationId,
  papel,
  naoContatar,
}: {
  organizationId: string;
  papel: AppRole;
  /** `organizations.do_not_contact`: nem rascunho nem link nascem para quem pediu para sair. */
  naoContatar: boolean;
}) {
  const clienteDeConsultas = useQueryClient();
  const podeEscrever = ESCREVEM.includes(papel);

  /** O endereço em claro do último link emitido NESTA sessão. Nunca vem do banco. */
  const [link, setLink] = useState<LinkEmitido | null>(null);
  const [copiado, setCopiado] = useState(false);

  const consulta = useQuery({
    queryKey: chaveDoPreCadastro(organizationId),
    queryFn: () => buscarPreCadastro(organizationId),
  });

  const criacao = useMutation({
    mutationFn: () => criarRascunho(organizationId),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error('O rascunho não foi criado.', {
          description: frase(MOTIVO_DA_CRIACAO, r.motivo),
        });
        return;
      }
      toast.success(r.novo ? 'Rascunho criado.' : 'Rascunho atualizado com o que está na ficha.', {
        description: 'Ele nasce privado: ninguém vê, e ele não aparece em busca nenhuma.',
      });
      void clienteDeConsultas.invalidateQueries({ queryKey: chaveDoPreCadastro(organizationId) });
    },
    onError: (erro) => toast.error('Não deu para criar o rascunho.', {
      description: mensagemDoErro(erro),
    }),
  });

  const emissao = useMutation({
    mutationFn: () => gerarLink(organizationId, window.location.origin),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error('O link não foi emitido.', { description: frase(MOTIVO_DO_LINK, r.motivo) });
        return;
      }
      setLink(r.link);
      setCopiado(false);
      toast.success('Link emitido.', {
        description: 'Copie agora: o endereço aparece uma vez só.',
      });
      void clienteDeConsultas.invalidateQueries({ queryKey: chaveDoPreCadastro(organizationId) });
    },
    onError: (erro) => toast.error('Não deu para emitir o link.', {
      description: mensagemDoErro(erro),
    }),
  });

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      toast.success('Link copiado.');
    } catch {
      toast.error('O navegador não deixou copiar.', {
        description: 'Selecione o endereço na tela e copie à mão.',
      });
    }
  }

  if (consulta.isPending) return <Moldura>{<EsqueletoDoPainel />}</Moldura>;

  if (consulta.isError) {
    return (
      <Moldura>
        <ErroDoPainel
          causa={mensagemDoErro(consulta.error)}
          aoTentar={() => void consulta.refetch()}
        />
      </Moldura>
    );
  }

  const p = consulta.data;
  const emitir = podeEmitirLink(p) && podeEscrever && !naoContatar;

  return (
    <Moldura>
      {/* ------------------------------------------------ estado, de relance */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="pilula">{ROTULO_SITUACAO[p.situacao]}</Badge>
        {/* Sem cromia: "pendente" é um degrau da escada, não um erro. A brasa
            (`destructive`) significa urgência na escala térmica, e usá-la aqui
            faria o estado normal de todo parceiro novo parecer um incidente. */}
        {p.existe ? (
          <Badge variant="pilula">
            {p.temAutorizacao ? <ShieldCheck aria-hidden="true" /> : <Lock aria-hidden="true" />}
            {p.temAutorizacao ? 'Autorização registrada' : 'Autorização pendente'}
          </Badge>
        ) : null}
        {p.publicado ? (
          <Badge variant="pilula">
            <Check aria-hidden="true" />
            Publicado na Komune
          </Badge>
        ) : null}
      </div>

      {/* ------------------------------------------------ a escada */}
      <ol className="flex flex-col border-t border-hairline">
        <Degrau
          numero={1}
          titulo="Rascunho do perfil"
          cumprido={p.existe}
          detalhe={
            p.existe
              ? p.origem
                ? `Privado: ninguém vê. Montado com o que já está na ficha. Origem: ${p.origem}.`
                : 'Privado: ninguém vê. Montado com o que já está na ficha.'
              : 'Ainda não existe. O rascunho leva só o factual da ficha: nome, categoria, cidade, bairro, site e @. Sem foto, sem descrição e sem telefone.'
          }
        />
        <Degrau
          numero={2}
          titulo="Autorização do fornecedor"
          cumprido={p.temAutorizacao}
          detalhe={
            p.temAutorizacao
              ? 'Registrada em consent_events. O link pode sair.'
              : 'Este degrau não é nosso. Peça a autorização na conversa (é a segunda mensagem, nunca a primeira) e registre a resposta. Sem ela, nenhum link é emitido.'
          }
        />
        <Degrau
          numero={3}
          titulo="Link de reivindicação"
          cumprido={p.reivindicadoEm !== null}
          detalhe={detalheDoLink(p)}
        />
      </ol>

      {/* ------------------------------------------------ o que vai no rascunho */}
      {p.existe && p.rascunho.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            O que o fornecedor vê ao abrir o link
            {p.fotosPublicas === 0 ? '. Nenhuma foto vai junto.' : ''}
          </p>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {p.rascunho.map((linha) => (
              <div key={linha.campo} className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{linha.campo}</dt>
                <dd className="text-sm">{linha.valor}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {/* ------------------------------------------------ o link recém-emitido */}
      {link ? (
        <div className="flex flex-col gap-2 rounded-xl bg-muted p-4">
          <p className="text-sm font-medium">Este endereço aparece uma vez só</p>
          <p className="text-sm text-muted-foreground">
            O banco guarda apenas o resumo criptográfico do token. Copie agora e mande para o
            fornecedor. Vale até{' '}
            {/* `whitespace-nowrap`: a data e a hora são um átomo, e a linha quebrava
                depois da vírgula, deixando "01:17." sozinho na linha seguinte. */}
            <span className="numerico whitespace-nowrap">{formatarDataHora(link.expiraEm)}</span>.
          </p>
          {/* `break-all` porque o token tem 64 caracteres sem espaço: sem isso ele
              estoura a largura da ficha no celular. */}
          <code className="numerico rounded-lg bg-background px-3 py-2 text-xs break-all">
            {link.url}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void copiar(link.url)} className="toque h-11 md:h-9">
              {copiado ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copiado ? 'Copiado' : 'Copiar o link'}
            </Button>
            <Button asChild variant="outline" className="toque h-11 md:h-9">
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                Abrir como o fornecedor vê
              </a>
            </Button>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------ a ação */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {!p.existe ? (
            <Button
              onClick={() => criacao.mutate()}
              disabled={criacao.isPending || !podeEscrever || naoContatar}
              className="toque h-11 md:h-9"
            >
              <FilePlus2 aria-hidden="true" />
              {criacao.isPending ? 'Criando...' : 'Criar rascunho'}
            </Button>
          ) : (
            <Button
              onClick={() => emissao.mutate()}
              disabled={!emitir || emissao.isPending}
              className="toque h-11 md:h-9"
            >
              <Link2 aria-hidden="true" />
              {emissao.isPending
                ? 'Emitindo...'
                : p.linkAtivo || link
                  ? 'Emitir um link novo'
                  : 'Emitir o link de reivindicação'}
            </Button>
          )}
        </div>

        <p className="max-w-prose text-xs text-muted-foreground">{porQueNaoDaParaAgir(p, {
          podeEscrever,
          naoContatar,
        })}</p>

        {/* O aviso de que o termo ainda não passou pelo jurídico é do TIME. Ele
            fica aqui, ao lado do botão que dispara o aceite, e nunca na página do
            fornecedor: o problema é nosso. */}
        {!REVISADO_PELO_JURIDICO && p.existe ? (
          <p className="flex max-w-prose items-start gap-1.5 text-xs text-morno-texto">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              O texto do termo que o fornecedor aceita ainda não passou pelo Dennis. Antes de usar
              isto com parceiro de verdade, feche a redação com ele.
            </span>
          </p>
        ) : null}
      </div>

      {/* ------------------------------------------------ linha do tempo */}
      {p.linhaDoTempo.length > 0 ? (
        <details className="group">
          <summary className="toque flex min-h-11 cursor-pointer list-none items-center text-sm text-muted-foreground underline underline-offset-4 md:min-h-0">
            Histórico do pré-cadastro{' '}
            <span className="numerico ml-1">({p.linhaDoTempo.length})</span>
          </summary>
          <ol className="mt-2 flex flex-col border-t border-hairline">
            {p.linhaDoTempo.map((e, i) => (
              <li
                key={`${e.evento}-${e.quando}-${i}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-hairline py-2 text-sm"
              >
                <span>
                  {ROTULO_EVENTO[e.evento] ?? e.evento}
                  <span className="text-muted-foreground"> · {ROTULO_ATOR[e.quem] ?? e.quem}</span>
                </span>
                <span className="numerico text-xs text-muted-foreground">
                  {formatarDataHora(e.quando)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </Moldura>
  );
}

/** A seção, com o mesmo desenho das outras seções da ficha. */
function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-heading text-base font-medium">Pré-cadastro na Komune</h2>
      {children}
    </section>
  );
}

/** Um degrau da escada: número, título, o que já aconteceu, e o que falta. */
function Degrau({
  numero,
  titulo,
  cumprido,
  detalhe,
}: {
  numero: number;
  titulo: string;
  cumprido: boolean;
  detalhe: string;
}) {
  return (
    <li className="flex gap-3 border-b border-hairline py-3">
      <span
        aria-hidden="true"
        className={cn(
          'numerico mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs',
          cumprido ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
        )}
      >
        {cumprido ? <Check className="size-3.5" /> : numero}
      </span>
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">
          {titulo}
          <span className="sr-only">{cumprido ? ' (cumprido)' : ' (pendente)'}</span>
        </p>
        <p className="max-w-prose text-xs text-muted-foreground">{detalhe}</p>
      </div>
    </li>
  );
}

/** O que dizer no terceiro degrau, conforme o que já aconteceu com o link. */
function detalheDoLink(p: PreCadastro): string {
  if (p.reivindicadoEm) {
    return `O fornecedor reivindicou o perfil em ${formatarDataHora(p.reivindicadoEm)}. O token morreu no aceite.`;
  }
  if (p.recusadoEm) {
    return `O fornecedor recusou o perfil em ${formatarDataHora(p.recusadoEm)}. Os dados do rascunho são apagados em até 48 horas, e o contato entra na lista de supressão.`;
  }
  if (p.apagadoEm) {
    return `Os dados do rascunho foram apagados em ${formatarData(p.apagadoEm)}. O lead continua no CRM; o rascunho, não.`;
  }
  if (p.linkAbertoEm) {
    return `Aberto pelo fornecedor em ${formatarDataHora(p.linkAbertoEm)}, sem aceite até agora.`;
  }
  if (p.linkAtivo) {
    return `Emitido em ${formatarDataHora(p.linkEnviadoEm)} e ainda válido até ${formatarDataHora(p.linkExpiraEm)}, mas nunca aberto. O endereço não fica guardado: se você precisar dele de novo, emita outro (o anterior deixa de valer na hora).`;
  }
  if (p.linkEnviadoEm) {
    return `O último link, de ${formatarDataHora(p.linkEnviadoEm)}, expirou sem ser aberto. Emita outro quando for falar com o fornecedor.`;
  }
  return 'Ainda não emitido. Ele vale 7 dias, aparece uma vez só e leva o fornecedor à página de aceite.';
}

/**
 * A frase que fica debaixo do botão.
 *
 * Ela existe para o caso desabilitado, que é o caso importante: o botão cinza sem
 * explicação é a pior tela possível para quem está na rua. Quando dá para agir, ela
 * continua na tela dizendo o que o clique vai fazer.
 */
function porQueNaoDaParaAgir(
  p: PreCadastro,
  ctx: { podeEscrever: boolean; naoContatar: boolean },
): string {
  if (!ctx.podeEscrever) {
    return 'O seu acesso é de leitura: dá para acompanhar o pré-cadastro, não para criar rascunho nem emitir link.';
  }
  if (ctx.naoContatar) {
    return 'Este contato pediu para não ser procurado. Nem rascunho nem link nascem para ele, em nenhum modo.';
  }
  if (!p.existe) {
    return 'Criar o rascunho não avisa ninguém e não publica nada: ele nasce privado e invisível, e é o que o fornecedor vai ver quando abrir o link.';
  }
  if (p.reivindicadoEm) {
    return 'O perfil já foi reivindicado. O que vier daqui em diante acontece na conta do fornecedor, dentro da Komune.';
  }
  if (p.recusadoEm) {
    return 'O fornecedor recusou o perfil. Nada mais é emitido, e o contato está suprimido.';
  }
  if (p.apagadoEm) {
    return 'O rascunho foi apagado por prazo. Para recomeçar, crie outro rascunho a partir da ficha.';
  }
  if (!p.temAutorizacao) {
    return 'A autorização vem primeiro: sem um registro de autorização em consent_events, o link não é emitido. Peça a autorização na conversa, registre a resposta, e este botão abre sozinho.';
  }
  return 'Emitir invalida o link anterior e gera um novo, válido por 7 dias. O endereço aparece uma vez só.';
}
