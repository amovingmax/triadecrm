import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ExternalLink,
  MessageCircle,
  PhoneOutgoing,
  ShieldAlert,
  SquareKanban,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { type AppRole } from '@/lib/auth/role';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { BarraTermica, ChipTemperatura } from '@/components/temperatura';
import { TransicaoPagina } from '@/components/movimento';
import { hrefDoFunil, type ItemDoDia } from '@/components/meu-dia/tipos';
import {
  carregarFicha,
  diasDesde,
  ROTULO_STATUS,
  type NegocioDaFicha,
} from '@/components/parceiros/ficha';
import { formatarData, formatarLocal, ROTULO_TIPO } from '@/components/parceiros/formatos';
import { ProximaAcao } from '@/components/parceiros/proxima-acao';
import { carregarCatalogos } from '@/components/parceiros/catalogos';
import { FolhaEditarFicha } from '@/components/parceiros/folha-editar-ficha';
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

/**
 * Espelho de `app.can_write()`, o mesmo par usado no painel de pré-cadastro e no lote
 * de ligações. Quem decide é o Postgres; isto só evita oferecer a quem tem papel de
 * leitura um botão cujo único desfecho é a recusa do banco duas telas adiante.
 */
const ESCREVEM: readonly AppRole[] = ['admin', 'gestor', 'sdr', 'embaixador'];

/** Botão de saída da ficha: 44px de alvo no celular, 36 no desktop. */
const SAIDA = 'toque h-11 w-full sm:h-9 sm:w-auto';

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
 * @, site), o que fazer agora (as saídas), de onde veio (proveniência, exigência do
 * RF-BAS-10) e em que pé está o negócio.
 *
 * As saídas logo abaixo do cabeçalho não são enfeite: oito lugares do CRM apontam
 * para cá — a fila do dia, o quadro dos funis, a busca global, o Radar, a agenda —, e
 * até aqui a ficha era um beco. Quem chegava por "reunião em 2 h" lia o que precisava
 * e então tinha que decorar o nome do parceiro e procurá-lo de novo em outro módulo
 * para registrar o que aconteceu. Registrar, conversar e mover no funil são as três
 * coisas que se faz depois de ler uma ficha, e agora as três estão a um toque.
 */
export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Os catálogos vêm junto, na mesma ida: a folha de edição precisa das 19
  // categorias e das 22 cidades para montar os dois seletores, e buscá-los só ao
  // abrir a folha deixaria os campos vazios por meio segundo — tempo suficiente
  // para alguém salvar sem cidade achando que a ficha não tinha uma.
  const [ficha, sessao, catalogos] = await Promise.all([
    carregarFicha(id),
    requireSession(),
    carregarCatalogos(),
  ]);
  if (!ficha) notFound();

  const principal = ficha.negocios.find((n) => n.status === 'open') ?? ficha.negocios[0] ?? null;
  const diasNaEtapa = principal ? diasDesde(principal.naEtapaDesde) : null;
  const diasSemContato = principal ? diasDesde(principal.ultimoContatoEm) : null;
  const podeEscrever = ESCREVEM.includes(sessao.papel);

  return (
    // Sem `mx-auto`: centrada, a ficha começava em x=376 enquanto a lista, o cabeçalho
    // do app e a busca global começam em x=232, e o mesmo clique movia o conteúdo 144px
    // para dentro. A largura de leitura continua limitada em 896px; o que muda é que a
    // coluna nasce na mesma margem de todas as outras telas.
    <TransicaoPagina className="flex mx-auto w-full max-w-4xl flex-col gap-6">
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

      {/* -------------------------------------------------- saídas */}
      {/* Empilhadas e largas no celular, lado a lado no desktop: na calçada o polegar
          não acerta três alvos de 36px encostados um no outro. */}
      <nav aria-label="O que fazer com este parceiro" className="flex flex-col gap-2 sm:flex-row">
        {/* Papel de leitura não vê este: o `app.can_write()` recusaria a gravação no
            fim do fluxo, depois de a pessoa ter escolhido parceiro, canal e desfecho. */}
        {podeEscrever ? (
          <Button asChild className={SAIDA}>
            <Link href={`/registrar?org=${ficha.id}`}>
              <PhoneOutgoing aria-hidden="true" />
              Registrar contato
            </Link>
          </Button>
        ) : null}

        {/* Ler a conversa é leitura: cabe a qualquer papel. A tela de conversas abre
            direto neste parceiro com `?org=`, e é lá que moram a linha do tempo e o
            histórico do WhatsApp. */}
        <Button asChild variant="outline" className={SAIDA}>
          <Link href={`/conversas?org=${ficha.id}`}>
            <MessageCircle aria-hidden="true" />
            Abrir a conversa
          </Link>
        </Button>

        {/* Sem negócio não há coluna para onde ir, e a seção "Negócios" logo abaixo já
            diz isso com todas as letras — um botão aqui só levaria ao quadro vazio.

            A URL sai de `hrefDoFunil`, a mesma da fila do dia: é ela que sabe traduzir
            o NOME do funil no slug que o quadro usa. Copiar a montagem para cá é o que
            faria os dois lugares divergirem no dia em que um terceiro funil entrar. O
            `as` é estreito de propósito — a função lê só `funil` e `organizacao`, e o
            resto do `ItemDoDia` é da fila do dia, não existe aqui. */}
        {principal ? (
          <Button asChild variant="outline" className={SAIDA}>
            <Link
              href={hrefDoFunil({ funil: principal.funil, organizacao: ficha.nome } as ItemDoDia)}
            >
              <SquareKanban aria-hidden="true" />
              Ver no funil
            </Link>
          </Button>
        ) : null}

        {/* Editar fica com quem escreve, pelo mesmo motivo de "Registrar contato":
            o gatilho `INSTEAD OF` da view recusaria a gravação com `app.can_write()`
            no fim, depois de a pessoa ter preenchido o formulário inteiro. Quem só
            lê continua vendo a ficha, e não vê um botão que sempre erra. */}
        {podeEscrever ? (
          <FolhaEditarFicha
            catalogos={catalogos}
            ficha={{
              id: ficha.id,
              name: ficha.nome,
              legalName: ficha.razaoSocial,
              telefone: ficha.telefone,
              telefoneMascarado: ficha.telefoneMascarado,
              email: ficha.email,
              instagram: ficha.instagram,
              site: ficha.site,
              cnpj: ficha.cnpj,
              bairro: ficha.bairro,
              endereco: ficha.endereco,
              descricao: ficha.descricao,
              cidadeId: ficha.cidadeId,
              categoriaId: ficha.categoriaId,
            }}
          />
        ) : null}
      </nav>

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

      {/* Aqui terminavam dois quadros tracejados que anunciavam a Linha do tempo e a
          Conversa como coisas que ainda iam chegar. As duas existem hoje, inteiras, na
          tela de conversas, e é para lá que o botão "Abrir a conversa" leva. Anunciar
          como futuro o que já está pronto ensina o time a não procurar: quem lê aquilo
          para de ir atrás do histórico e passa a perguntar no grupo. */}
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

/** 12.345.678/0001-95 */
function formatarCnpj(digitos: string): string {
  if (digitos.length !== 14) return digitos;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}
