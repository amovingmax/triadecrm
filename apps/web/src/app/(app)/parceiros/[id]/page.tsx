import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, MessageSquare, ShieldAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { BarraTermica, definicaoTemperatura } from '@/components/temperatura';
import { TransicaoPagina } from '@/components/movimento';
import {
  carregarFicha,
  diasDesde,
  ROTULO_STATUS,
  type NegocioDaFicha,
} from '@/components/parceiros/ficha';
import {
  formatarData,
  formatarDataHora,
  formatarLocal,
  formatarProximaAcao,
  ROTULO_TIPO,
} from '@/components/parceiros/formatos';
import { TelefoneRevelavel } from '@/components/parceiros/telefone-revelavel';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const ficha = await carregarFicha((await params).id);
  return { title: ficha ? ficha.nome : 'Parceiro' };
}

/**
 * Ficha do parceiro (RF-BAS-01 a 06, RF-BAS-10, RF-BAS-14).
 *
 * Ordem de leitura pensada para quem abre isto no carro, antes de entrar na loja:
 * quem é (cabeçalho com temperatura, etapa e há quantos dias), como falar (telefone,
 * @, site), de onde veio (proveniência, exigência do RF-BAS-10) e em que pé está o
 * negócio. Linha do tempo e conversa entram no D3 e no D5.
 */
export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ficha = await carregarFicha(id);
  if (!ficha) notFound();

  const escala = definicaoTemperatura(ficha.temperatura);
  const principal = ficha.negocios.find((n) => n.status === 'open') ?? ficha.negocios[0] ?? null;
  const diasNaEtapa = principal ? diasDesde(principal.naEtapaDesde) : null;
  const diasSemContato = principal ? diasDesde(principal.ultimoContatoEm) : null;

  return (
    <TransicaoPagina className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="toque -ml-2 h-9 w-fit md:h-7">
        <Link href="/parceiros">
          <ArrowLeft aria-hidden="true" />
          Parceiros
        </Link>
      </Button>

      {/* -------------------------------------------------- cabeçalho */}
      <header className="relative flex flex-col gap-3 pl-4">
        <BarraTermica
          temperatura={ficha.temperatura}
          needsAttention={principal?.precisaAtencao ?? false}
          posicao="absoluta"
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{ficha.nome}</h1>
          <span
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: escala.corFundo, color: escala.corTexto }}
            title={escala.descricao}
          >
            {escala.rotulo}
          </span>
          {ficha.vip ? <Badge variant="outline">VIP</Badge> : null}
          {ficha.naoContatar ? (
            <Badge variant="destructive">
              <ShieldAlert aria-hidden="true" />
              Não contatar
            </Badge>
          ) : null}
        </div>

        {/* Duas linhas, um ponto médio em cada: encadear quatro numa faixa só vira
            corrente sem hierarquia, e a ficha tem largura de sobra. */}
        <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{ROTULO_TIPO[ficha.tipo] ?? ficha.tipo}</span>
            {ficha.categorias.length ? <Ponto /> : null}
            <span>{ficha.categorias.join(', ')}</span>
          </div>
          {formatarLocal(ficha.bairro, ficha.cidade) || ficha.responsavel ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{formatarLocal(ficha.bairro, ficha.cidade)}</span>
              {formatarLocal(ficha.bairro, ficha.cidade) && ficha.responsavel ? <Ponto /> : null}
              {ficha.responsavel ? <span>Responsável: {ficha.responsavel}</span> : null}
            </div>
          ) : null}
        </div>

        {principal ? (
          <p className="text-sm">
            <span className="font-medium">{principal.etapa}</span>
            <span className="text-muted-foreground">
              {diasNaEtapa !== null ? (
                <>
                  {' '}
                  há <span className="numerico">{diasNaEtapa}</span>
                  {diasNaEtapa === 1 ? ' dia' : ' dias'}
                </>
              ) : null}
              {diasSemContato !== null ? (
                <>
                  , último contato há <span className="numerico">{diasSemContato}</span>
                  {diasSemContato === 1 ? ' dia' : ' dias'}
                </>
              ) : (
                ', sem contato registrado'
              )}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Sem negócio aberto em nenhum funil.</p>
        )}

        {ficha.temperaturaManual ? (
          <p className="text-xs text-muted-foreground">
            Temperatura definida à mão: {ficha.temperaturaMotivo}
          </p>
        ) : null}
      </header>

      <Separator />

      {/* -------------------------------------------------- campos */}
      <section>
        <h2 className="sr-only">Dados de contato e proveniência</h2>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Linha rotulo="WhatsApp">
            <TelefoneRevelavel
              organizationId={ficha.id}
              telefone={ficha.telefone}
              mascarado={ficha.telefoneMascarado}
            />
          </Linha>

          <Linha rotulo="Instagram">
            {ficha.instagram ? (
              <a
                href={`https://instagram.com/${ficha.instagram}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 underline underline-offset-4"
              >
                {`@${ficha.instagram}`}
              </a>
            ) : (
              <Ausente />
            )}
          </Linha>

          <Linha rotulo="Site">
            {ficha.site ? (
              <a
                href={ficha.site}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 break-all underline underline-offset-4"
              >
                {ficha.site.replace(/^https?:\/\/(www\.)?/, '')}
                <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
              </a>
            ) : (
              <Ausente />
            )}
          </Linha>

          <Linha rotulo="E-mail">
            {ficha.email ? (
              <a href={`mailto:${ficha.email}`} className="break-all underline underline-offset-4">
                {ficha.email}
              </a>
            ) : (
              <Ausente />
            )}
          </Linha>

          <Linha rotulo="CNPJ">
            {ficha.cnpj ? (
              <span className="numerico">{formatarCnpj(ficha.cnpj)}</span>
            ) : ficha.pessoaFisica ? (
              <span className="text-muted-foreground">Pessoa física (MEI ou autônomo)</span>
            ) : (
              <Ausente />
            )}
          </Linha>

          <Linha rotulo="Endereço">
            {ficha.endereco ? <span>{ficha.endereco}</span> : <Ausente />}
          </Linha>

          {/* Proveniência: RF-BAS-10 exige origem, quando e quem coletou. */}
          <Linha rotulo="Origem">
            {ficha.origem ? (
              ficha.origemUrl ? (
                <a
                  href={ficha.origemUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 underline underline-offset-4"
                >
                  {ficha.origem}
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                </a>
              ) : (
                <span>{ficha.origem}</span>
              )
            ) : (
              <Ausente />
            )}
          </Linha>

          <Linha rotulo="Coletado em">
            <span>
              <span className="numerico">{formatarData(ficha.coletadoEm)}</span>
              <span className="text-muted-foreground"> por {ficha.coletadoPor}</span>
            </span>
          </Linha>
        </dl>
      </section>

      {ficha.descricao ? (
        <p className="max-w-prose text-sm text-muted-foreground">{ficha.descricao}</p>
      ) : null}

      <Separator />

      {/* -------------------------------------------------- negócios */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-base font-medium">
          Negócios <span className="numerico text-muted-foreground">({ficha.negocios.length})</span>
        </h2>

        {ficha.negocios.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Este parceiro ainda não está em nenhum funil.
          </p>
        ) : (
          <ul className="flex flex-col border-t border-border">
            {ficha.negocios.map((negocio) => (
              <CartaoNegocio key={negocio.id} negocio={negocio} />
            ))}
          </ul>
        )}
      </section>

      {/* -------------------------------------------------- o que ainda vem */}
      <section className="grid gap-3 sm:grid-cols-2">
        <Marcador
          titulo="Linha do tempo"
          dia="D3"
          texto="Atividades, mudanças de etapa, visitas e notas em ordem, com quem fez cada coisa (RF-BAS-06, RF-FUN-08)."
        />
        <Marcador
          titulo="Conversa"
          dia="D5"
          texto="Histórico do WhatsApp com o robô assistido, sempre com aprovação da Heloísa antes do envio (RF-CON)."
          icone={<MessageSquare className="size-4" aria-hidden="true" />}
        />
      </section>
    </TransicaoPagina>
  );
}

function CartaoNegocio({ negocio }: { negocio: NegocioDaFicha }) {
  const acao = formatarProximaAcao(negocio.proximaAcaoEm);
  const dias = diasDesde(negocio.ultimoContatoEm);

  return (
    <li className="relative flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/70 py-3 pl-4">
      <BarraTermica
        temperatura={negocio.temperatura}
        needsAttention={negocio.precisaAtencao}
        posicao="absoluta"
      />

      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-medium">{negocio.etapa}</span>
          <span className="text-muted-foreground"> · {negocio.funil}</span>
        </p>
        {/* Um ponto médio por linha: status e responsável em cima, prioridade e
            último contato embaixo, separados por vírgula. */}
        <p className="text-xs text-muted-foreground">
          {ROTULO_STATUS[negocio.status] ?? negocio.status}
          {negocio.responsavel ? ` · ${negocio.responsavel}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          {negocio.tier ? `prioridade ${negocio.tier}, ` : ''}
          {dias !== null ? (
            <>
              {'último contato há '}
              <span className="numerico">{dias}</span>
              {dias === 1 ? ' dia' : ' dias'}
            </>
          ) : (
            'sem contato registrado'
          )}
        </p>
      </div>

      {negocio.proximaAcao ? (
        <p className="text-right text-sm">
          <span>{negocio.proximaAcao}</span>
          {acao ? (
            <span
              className={cn(
                'block text-xs text-muted-foreground',
                acao.numero && 'numerico',
                acao.atrasada && 'font-medium text-foreground',
              )}
              title={formatarDataHora(negocio.proximaAcaoEm)}
            >
              {acao.texto}
            </span>
          ) : null}
        </p>
      ) : null}
    </li>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function Ausente() {
  return <span className="text-muted-foreground">Não informado</span>;
}

function Ponto() {
  return <span aria-hidden="true">·</span>;
}

/** Espaço reservado para o que chega nos próximos dias do calendário (PRD §11.2). */
function Marcador({
  titulo,
  dia,
  texto,
  icone,
}: {
  titulo: string;
  dia: string;
  texto: string;
  icone?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        {icone}
        {titulo}
        <Badge variant="outline">
          chega no <span className="numerico">{dia}</span>
        </Badge>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{texto}</p>
    </div>
  );
}

/** 12.345.678/0001-95 */
function formatarCnpj(digitos: string): string {
  if (digitos.length !== 14) return digitos;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}
