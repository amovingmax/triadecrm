import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, MessageSquare, ShieldAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { BarraTermica, ChipTemperatura } from '@/components/temperatura';
import { TransicaoPagina } from '@/components/movimento';
import {
  carregarFicha,
  diasDesde,
  ROTULO_STATUS,
  type NegocioDaFicha,
} from '@/components/parceiros/ficha';
import { formatarData, formatarLocal, ROTULO_TIPO } from '@/components/parceiros/formatos';
import { ProximaAcao } from '@/components/parceiros/proxima-acao';
import { TelefoneRevelavel } from '@/components/parceiros/telefone-revelavel';
import { PainelPreCadastro } from '@/components/precadastro/painel-precadastro';
import { requireSession } from '@/lib/auth/session';

/**
 * Separador de termos: espaço normal ANTES do ponto (ali pode quebrar) e espaço
 * inquebrável DEPOIS. Assim o "·" desce junto do termo que apresenta em vez de ficar
 * pendurado no fim da linha anterior, que era o que acontecia no celular quando o
 * ponto era um item de flex independente.
 */
const SEPARADOR = ' \u00b7\u00a0';

/** Junta termos com esse separador, ignorando os que vierem vazios. */
function unir(...termos: (string | null | undefined)[]): string {
  return termos.filter((t) => t && t.trim()).join(SEPARADOR);
}

/**
 * Valor da ficha que é link. `min-h-11` no celular porque estes eram os alvos de 20px
 * do levantamento (os únicos abaixo de 24px em 16 páginas); no desktop volta a ser
 * uma linha de texto, que é onde o mouse já acerta.
 */
const LINK_VALOR =
  'inline-flex min-h-11 items-center gap-1.5 underline underline-offset-4 md:min-h-0';

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
  const [ficha, sessao] = await Promise.all([carregarFicha(id), requireSession()]);
  if (!ficha) notFound();

  const principal = ficha.negocios.find((n) => n.status === 'open') ?? ficha.negocios[0] ?? null;
  const diasNaEtapa = principal ? diasDesde(principal.naEtapaDesde) : null;
  const diasSemContato = principal ? diasDesde(principal.ultimoContatoEm) : null;

  return (
    // Sem `mx-auto`: centrada, a ficha começava em x=376 enquanto a lista, o cabeçalho
    // do app e a busca global começam em x=232, e o mesmo clique movia o conteúdo 144px
    // para dentro. A largura de leitura continua limitada em 896px; o que muda é que a
    // coluna nasce na mesma margem de todas as outras telas.
    <TransicaoPagina className="flex w-full max-w-4xl flex-col gap-6">
      {/* 44px de alvo no celular (era 36), 28 no desktop: esta e o "Revelar" eram os
          dois únicos controles de toque da ficha, e os dois estavam abaixo do mínimo
          enquanto a lista e a barra inferior já cumpriam 44 e 64. */}
      <Button asChild variant="ghost" size="sm" className="toque -ml-2 h-11 w-fit md:h-7">
        <Link href="/parceiros">
          <ArrowLeft aria-hidden="true" />
          Parceiros
        </Link>
      </Button>

      {/* -------------------------------------------------- cabeçalho */}
      <header className="relative flex flex-col gap-3 pl-4">
        {/* O rótulo da temperatura está visível no chip logo abaixo, então a barra
            não repete a informação para o leitor de tela. */}
        <BarraTermica
          temperatura={ficha.temperatura}
          needsAttention={principal?.precisaAtencao ?? false}
          posicao="absoluta"
          semRotulo
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{ficha.nome}</h1>
            <ChipTemperatura
            temperatura={ficha.temperatura}
            esfriando={principal?.precisaAtencao ?? false}
          />
          {ficha.vip ? <Badge variant="outline">VIP</Badge> : null}
          {ficha.naoContatar ? (
            <Badge variant="destructive">
              <ShieldAlert aria-hidden="true" />
              Não contatar
            </Badge>
          ) : null}
        </div>

        {/* Duas linhas, um ponto médio em cada: encadear quatro numa faixa só vira
            corrente sem hierarquia, e a ficha tem largura de sobra.

            Cada linha é TEXTO CORRIDO, e não um `flex` com o ponto como item próprio.
            Como item de flex o "·" podia terminar a linha sozinho, e terminava: no
            celular lia-se "Fornecedor ·" numa linha e a categoria na seguinte. Aqui o
            separador é `unir()`, que cola o ponto ao termo SEGUINTE com espaço
            inquebrável, então ele viaja com o que apresenta e não pode ser o último
            caractere de uma linha. */}
        <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
          <p>{unir(ROTULO_TIPO[ficha.tipo] ?? ficha.tipo, ficha.categorias.join(', '))}</p>
          {formatarLocal(ficha.bairro, ficha.cidade) || ficha.responsavel ? (
            <p>
              {unir(
                formatarLocal(ficha.bairro, ficha.cidade),
                ficha.responsavel ? `Responsável: ${ficha.responsavel}` : '',
              )}
            </p>
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
        {/* Três colunas no `lg`: com duas, dentro de max-w-4xl, cada par rótulo/valor
            recebia 432px para valores de ~95px ("Não informado"), e WhatsApp e
            Instagram ficavam a 464px um do outro na mesma linha. A ~288px o par cabe
            no campo de visão e ainda sobra espaço para o telefone mascarado mais o
            botão Revelar. */}
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
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
                className={LINK_VALOR}
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
                className={cn(LINK_VALOR, 'break-all')}
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
              <a href={`mailto:${ficha.email}`} className={cn(LINK_VALOR, 'break-all')}>
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
                  className={LINK_VALOR}
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
          <ul className="flex flex-col border-t border-hairline">
            {ficha.negocios.map((negocio) => (
              <CartaoNegocio key={negocio.id} negocio={negocio} />
            ))}
          </ul>
        )}
      </section>

      <Separator />

      {/* -------------------------------------------------- pré-cadastro na Komune */}
      {/* Depois dos negócios de propósito: o pré-cadastro é o que vem DEPOIS de o
          negócio andar, e a escada dele (rascunho, autorização, link) só faz
          sentido para quem já leu em que pé a conversa está. */}
      <PainelPreCadastro
        organizationId={ficha.id}
        papel={sessao.papel}
        naoContatar={ficha.naoContatar}
      />

      <Separator />

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

/**
 * Uma linha da lista de negócios da ficha.
 *
 * Duas correções em relação à primeira versão, as duas medidas na foto de 1440:
 *
 * 1. era o ÚNICO uso da `BarraTermica` sem um `ChipTemperatura` ao lado, ou seja, a
 *    temperatura do negócio era dada só por um traço de 3px. No modo claro, com
 *    deuteranopia, morno (#b37a1f) e quente (#c4472b) caem a 1,24:1 entre si: no
 *    traço são o mesmo pixel, e são justamente as duas leituras que mudam o
 *    comportamento em campo. Agora o chip abre a linha, como na tabela e no cartão,
 *    e a barra passa a `semRotulo` para não anunciar a temperatura duas vezes;
 * 2. o "haltere": com `flex-1` à esquerda numa linha de 896px, a próxima ação era
 *    empurrada contra a borda direita e ficava a ~486px do texto a que pertence, sem
 *    nenhuma coluna com que se alinhar (a ficha costuma ter um negócio só). Ela
 *    desceu para a coluna da esquerda, onde é a continuação natural da frase "em que
 *    pé está o negócio" e onde o celular já a jogava de qualquer jeito.
 */
function CartaoNegocio({ negocio }: { negocio: NegocioDaFicha }) {
  const dias = diasDesde(negocio.ultimoContatoEm);

  return (
    <li className="relative flex flex-col gap-1 border-b border-hairline py-3 pl-4">
      <BarraTermica
        temperatura={negocio.temperatura}
        needsAttention={negocio.precisaAtencao}
        posicao="absoluta"
        semRotulo
      />

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <ChipTemperatura
          temperatura={negocio.temperatura}
          esfriando={negocio.precisaAtencao}
          comDescricao={false}
        />
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">{negocio.etapa}</span>
          {SEPARADOR}
          {negocio.funil}
        </span>
      </p>

      {/* Um ponto médio por linha: status e responsável em cima, prioridade e
          último contato embaixo, separados por vírgula. */}
      <p className="text-xs text-muted-foreground">
        {unir(ROTULO_STATUS[negocio.status] ?? negocio.status, negocio.responsavel ?? '')}
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

      {negocio.proximaAcao ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Próxima ação: </span>
          {negocio.proximaAcao}
          {negocio.proximaAcaoEm ? (
            <>
              {SEPARADOR}
              <ProximaAcao iso={negocio.proximaAcaoEm} className="text-muted-foreground" />
            </>
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
