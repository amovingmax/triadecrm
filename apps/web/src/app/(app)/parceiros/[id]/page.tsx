import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  AtSign,
  ExternalLink,
  FileText,
  Globe,
  IdCard,
  Mail,
  MapPin,
  Phone,
  ShieldAlert,
  Star,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { iniciaisDe } from '@/lib/iniciais';
import { LEITURA } from '@/lib/larguras';
import { type AppRole } from '@/lib/auth/role';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChipTemperatura } from '@/components/temperatura';
import { TransicaoPagina } from '@/components/movimento';
import { hrefDoFunil, type ItemDoDia } from '@/components/meu-dia/tipos';
import {
  carregarFicha,
  diasDesde,
  ROTULO_STATUS,
  type Ficha,
  type NegocioDaFicha,
} from '@/components/parceiros/ficha';
import { AcoesDaFicha } from '@/components/parceiros/ficha-acoes';
import { CompletarAFicha, EdicaoDaFicha } from '@/components/parceiros/ficha-edicao';
import { ReguaDoFunil } from '@/components/parceiros/ficha-regua';
import {
  formatarData,
  formatarLocal,
  formatarNumero,
  formatarProximaAcao,
  ROTULO_TIPO,
} from '@/components/parceiros/formatos';
import { ProximaAcao } from '@/components/parceiros/proxima-acao';
import { carregarCatalogos } from '@/components/parceiros/catalogos';
import {
  camposQueFaltam,
  estadoDoWhatsapp,
  montarRegua,
  presencaPublica,
  ultimoContatoPorExtenso,
} from '@/components/parceiros/resumo-da-ficha';
import { TelefoneRevelavel } from '@/components/parceiros/telefone-revelavel';
import { PainelPreCadastro } from '@/components/precadastro/painel-precadastro';
import { requireSession } from '@/lib/auth/session';
import { whatsappConectado } from '@/components/conversas/whatsapp-conectado';

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
 * ===========================================================================
 * A FICHA NOVA (02/10/2026)
 * ===========================================================================
 * A ordem de leitura continua a de quem abre isto no carro, antes de entrar na
 * loja — quem é, em que pé está, como falar, de onde veio. O que mudou é onde
 * cada resposta mora. Janio: "está bem organizado, mas gostaria de algo mais
 * premium, mais profissional e mais direto".
 *
 *   1. UM CABEÇALHO SÓ. Identidade, ações, a régua do funil e os quatro
 *      números de quem vai falar com o parceiro agora: a próxima ação, o último
 *      contato, o estado do WhatsApp e o responsável. Era um título, uma frase
 *      em letra pequena e quatro botões do mesmo peso.
 *   2. O CONTATO MOSTRA O QUE EXISTE. O cartão tinha oito campos e, na maior
 *      parte das fichas, cinco "Não informado". Agora o que falta é uma linha de
 *      botões "+ Instagram", "+ Site", que já abrem a edição no campo certo.
 *   3. NADA SE REPETE. Temperatura, etapa e último contato apareciam no
 *      cabeçalho e de novo no cartão "Negócios". Com um negócio só, o cartão
 *      some: tudo o que ele dizia está na régua. Com dois ou mais, ele volta.
 *   4. O PRÉ-CADASTRO NÃO OCUPA O QUE NÃO COMEÇOU (`painel-precadastro.tsx`).
 *
 * As regras do que cada bloco diz estão em `resumo-da-ficha.ts`, com teste. A
 * página só lê: nada aqui escreve no banco nem fala com a Meta.
 *
 * As saídas continuam sendo o motivo de a ficha não ser um beco: oito lugares do
 * CRM apontam para cá (a fila do dia, o quadro dos funis, a busca global, a
 * Revisão, a agenda), e quem chega precisa registrar, conversar ou mover no
 * funil sem decorar o nome do parceiro para procurá-lo em outro módulo.
 */
export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Os catálogos vêm junto, na mesma ida: a folha de edição precisa das 19
  // categorias e das 22 cidades para montar os dois seletores, e buscá-los só ao
  // abrir a folha deixaria os campos vazios por meio segundo — tempo suficiente
  // para alguém salvar sem cidade achando que a ficha não tinha uma.
  const [ficha, sessao, catalogos, conectado] = await Promise.all([
    carregarFicha(id),
    requireSession(),
    carregarCatalogos(),
    whatsappConectado(),
  ]);
  if (!ficha) notFound();

  const principal = ficha.negocios.find((n) => n.status === 'open') ?? ficha.negocios[0] ?? null;
  const podeEscrever = ESCREVEM.includes(sessao.papel);
  const regua = principal
    ? montarRegua(ficha.etapasPorFunil[principal.funilId] ?? [], principal.etapaId)
    : null;

  const pagina = (
    // Sem `mx-auto`: centrada, a ficha começava em x=385 enquanto a lista, o cabeçalho
    // do app e a busca global começam em x=232, e o mesmo clique movia o conteúdo 153px
    // para dentro. A régua é a constante `LEITURA`, não a prosa.
    <TransicaoPagina className={cn(LEITURA, 'flex flex-col gap-5')}>
      {/* 44px de alvo no celular, 28 no desktop. */}
      <Button asChild variant="ghost" size="sm" className="toque -ml-2 h-11 w-fit md:h-7">
        <Link href="/parceiros">
          <ArrowLeft aria-hidden="true" />
          Parceiros
        </Link>
      </Button>

      {/* ------------------------------------------------------------ cabeçalho */}
      <header className="sombra-base flex flex-col gap-5 rounded-xl bg-card p-5 md:gap-6 md:p-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex min-w-0 items-start gap-4 md:items-center">
            {/* Quadrado de canto macio: é uma empresa, como no cartão de aviso. */}
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.07] text-base font-semibold ring-1 ring-foreground/15 md:size-[60px] md:text-lg"
            >
              {iniciaisDe(ficha.nome)}
            </span>

            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="font-heading text-2xl leading-tight font-normal tracking-[-0.02em] md:text-[30px]">
                  {ficha.nome}
                </h1>
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

              {/* TEXTO CORRIDO, e não um `flex` com o ponto como item próprio: como
                  item de flex o "·" podia terminar a linha sozinho, e terminava no
                  celular. `unir()` cola o ponto ao termo SEGUINTE. */}
              <p className="text-sm text-muted-foreground">
                {unir(
                  ROTULO_TIPO[ficha.tipo] ?? ficha.tipo,
                  ficha.categorias.join(', '),
                  formatarLocal(ficha.bairro, ficha.cidade),
                )}
              </p>

              <PresencaPublica ficha={ficha} />

              {ficha.temperaturaManual ? (
                <p className="text-xs text-muted-foreground">
                  Temperatura definida à mão: {ficha.temperaturaMotivo}
                </p>
              ) : null}
            </div>
          </div>

          <div className="md:ml-auto md:shrink-0">
            <AcoesDaFicha
              organizationId={ficha.id}
              podeEscrever={podeEscrever}
              conversaNoCrm={conectado && podeEscrever}
              // A URL sai de `hrefDoFunil`, a mesma da fila do dia: é ela que sabe
              // traduzir o NOME do funil no slug que o quadro usa. O `as` é estreito
              // de propósito — a função lê só `funil` e `organizacao`.
              hrefDoFunil={
                principal
                  ? hrefDoFunil({ funil: principal.funil, organizacao: ficha.nome } as ItemDoDia)
                  : null
              }
            />
          </div>
        </div>

        {principal && regua ? (
          <ReguaDoFunil
            regua={regua}
            funil={principal.funil}
            etapa={principal.etapa}
            apoio={<ApoioDaRegua negocio={principal} regua={regua} />}
          />
        ) : principal ? (
          <p className="text-sm">
            <span className="font-medium">{principal.etapa}</span>
            <span className="text-muted-foreground">
              {' '}
              {SEPARADOR}
              {principal.funil}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Sem negócio aberto em nenhum funil.</p>
        )}

        <div className="h-px bg-hairline" aria-hidden="true" />

        <Numeros ficha={ficha} principal={principal} />
      </header>

      {/* ------------------------------------------------------------ o corpo */}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Contato ficha={ficha} whatsappPeloCrm={conectado && podeEscrever} />

        <div className="flex min-w-0 flex-col gap-5">
          {/* O pré-cadastro é o que vem DEPOIS de o negócio andar: a escada dele
              (rascunho, autorização, link) só faz sentido para quem já leu em
              que pé a conversa está. Enquanto não começou, ocupa uma linha. */}
          <PainelPreCadastro
            organizationId={ficha.id}
            papel={sessao.papel}
            naoContatar={ficha.naoContatar}
          />

          {/* Com um negócio só, a régua do cabeçalho já disse tudo. A lista volta
              quando há mais de um: aí o cabeçalho mostra o principal, e os outros
              não podem sumir. */}
          {ficha.negocios.length > 1 ? (
            <section className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-5">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
                Negócios{' '}
                <span className="numerico font-normal text-muted-foreground">
                  ({ficha.negocios.length})
                </span>
              </h2>
              <ul className="flex flex-col gap-2">
                {ficha.negocios.map((negocio) => (
                  <CartaoNegocio key={negocio.id} negocio={negocio} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      {/* A linha do tempo e a conversa moram na tela de Conversas, e é para lá
          que "Conversar" leva. */}
    </TransicaoPagina>
  );

  // Editar fica com quem escreve: o gatilho `INSTEAD OF` da view recusaria a
  // gravação com `app.can_write()` no fim, depois de a pessoa ter preenchido o
  // formulário inteiro. Sem o provedor, o menu não oferece "Editar ficha" e o
  // que falta na ficha vira frase, não botão.
  return podeEscrever ? (
    <EdicaoDaFicha
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
    >
      {pagina}
    </EdicaoDaFicha>
  ) : (
    pagina
  );
}

/** A nota, as avaliações e o Instagram sob o nome. Some quando não há nenhum dos três. */
function PresencaPublica({ ficha }: { ficha: Ficha }) {
  const presenca = presencaPublica({ nota: ficha.nota, avaliacoes: ficha.avaliacoes });
  if (!presenca && !ficha.instagram) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-muted-foreground">
      {presenca ? (
        <span className="inline-flex items-center gap-1.5">
          {presenca.nota ? (
            <>
              <Star className="size-3.5 fill-current text-foreground" aria-hidden="true" />
              <span className="numerico font-semibold text-foreground">{presenca.nota}</span>
            </>
          ) : null}
          {presenca.avaliacoes ? (
            <span>
              <span className="numerico">{formatarNumero(presenca.avaliacoes)}</span>
              {presenca.avaliacoes === 1 ? ' avaliação' : ' avaliações'}
            </span>
          ) : null}
        </span>
      ) : null}
      {ficha.instagram ? (
        <a
          href={`https://instagram.com/${ficha.instagram}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
        >
          <AtSign className="size-3.5" aria-hidden="true" />
          {ficha.instagram}
        </a>
      ) : null}
    </p>
  );
}

/**
 * A linha à direita da régua: onde o parceiro está no caminho, há quanto tempo e
 * o que vem depois. No celular fica só o essencial; o resto não cabe ao lado do
 * nome da etapa.
 */
function ApoioDaRegua({
  negocio,
  regua,
}: {
  negocio: NegocioDaFicha;
  regua: NonNullable<ReturnType<typeof montarRegua>>;
}) {
  const dias = diasDesde(negocio.naEtapaDesde);
  const haDias =
    dias === null ? null : dias === 0 ? (
      'desde hoje'
    ) : (
      <>
        há <span className="numerico">{dias}</span>
        {dias === 1 ? ' dia' : ' dias'}
      </>
    );

  return (
    <>
      {/* O status só quando não é o normal ("Em aberto" é o que se espera) e
          quando a régua ainda vale: fora dela, "fora do funil: Perdido" já diz
          tudo, e o status na frente escreveria "Perdido" duas vezes. */}
      {negocio.status !== 'open' && !regua.fora ? (
        <>
          <span className="font-medium text-foreground">
            {ROTULO_STATUS[negocio.status] ?? negocio.status}
          </span>
          {SEPARADOR}
        </>
      ) : null}
      {regua.fora ? (
        <span className="font-medium text-foreground md:font-normal md:text-muted-foreground">
          fora do funil<span className="hidden md:inline">: {regua.fora}</span>
        </span>
      ) : (
        <>
          etapa <span className="numerico">{regua.posicao}</span> de{' '}
          <span className="numerico">{regua.total}</span>
        </>
      )}
      {haDias ? (
        <>
          {SEPARADOR}
          {haDias}
        </>
      ) : null}
      <span className="hidden md:inline">
        {regua.proxima ? `${SEPARADOR}próxima: ${regua.proxima}` : null}
        {negocio.tier ? `${SEPARADOR}prioridade ${negocio.tier}` : null}
      </span>
    </>
  );
}

/**
 * Os quatro números de quem vai falar com o parceiro agora. Quatro colunas com
 * um fio entre elas no desktop; dois por linha no celular.
 */
function Numeros({ ficha, principal }: { ficha: Ficha; principal: NegocioDaFicha | null }) {
  const proxima = formatarProximaAcao(principal?.proximaAcaoEm);
  const contato = ultimoContatoPorExtenso(principal?.ultimoContatoEm);
  const whatsapp = estadoDoWhatsapp({ naoContatar: ficha.naoContatar, conversa: ficha.conversa });
  const responsavel = principal?.responsavel ?? ficha.responsavel;
  const atendente = ficha.conversa?.atendente ?? null;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4 md:gap-0 md:divide-x md:divide-hairline">
      <Numero rotulo="Próxima ação">
        {principal?.proximaAcao ? (
          <>
            <Valor>
              {/* O único ponto de cor do cabeçalho: é o que pede para alguém agir. */}
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full bg-menta ring-4 ring-menta/20"
              />
              <span className="min-w-0 break-words md:truncate">{principal.proximaAcao}</span>
            </Valor>
            <Apoio>
              {proxima ? (
                <>
                  <ProximaAcao iso={principal.proximaAcaoEm} />
                  {SEPARADOR}
                  <span className="numerico">{proxima.detalhe}</span>
                </>
              ) : (
                'sem data marcada'
              )}
            </Apoio>
          </>
        ) : (
          <>
            <Valor apagado>Nenhuma marcada</Valor>
            <Apoio>
              {!principal
                ? 'sem negócio em funil'
                : principal.status === 'won' || principal.status === 'lost'
                  ? 'negócio encerrado'
                  : 'defina o próximo passo no funil'}
            </Apoio>
          </>
        )}
      </Numero>

      <Numero rotulo="Último contato">
        <Valor apagado={contato.texto === 'Sem registro'}>{contato.texto}</Valor>
        <Apoio>
          {principal?.ultimoContatoEm ? (
            <span className="numerico">{formatarData(principal.ultimoContatoEm)}</span>
          ) : (
            'nenhum contato registrado'
          )}
        </Apoio>
      </Numero>

      <Numero rotulo="WhatsApp">
        <Valor>{whatsapp.titulo}</Valor>
        <Apoio>
          {whatsapp.apoio.map((parte, i) =>
            parte.numerico ? (
              <span key={i} className="numerico">
                {parte.texto}
              </span>
            ) : (
              parte.texto
            ),
          )}
        </Apoio>
      </Numero>

      <Numero rotulo="Responsável">
        {responsavel ? (
          <Valor>
            <span
              aria-hidden="true"
              className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-foreground/15 text-[11px] font-semibold"
            >
              {iniciaisDe(responsavel)}
            </span>
            <span className="min-w-0 break-words md:truncate">{responsavel}</span>
          </Valor>
        ) : (
          <Valor apagado>Sem responsável</Valor>
        )}
        <Apoio>
          {atendente === null
            ? 'responde por este parceiro'
            : atendente === responsavel
              ? 'atende a conversa'
              : `quem atende a conversa: ${atendente}`}
        </Apoio>
      </Numero>
    </dl>
  );
}

function Numero({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 md:px-7 md:first:pl-0 md:last:pr-0">
      <dt className="text-[11px] leading-4 font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        {rotulo}
      </dt>
      <dd className="flex min-w-0 flex-col gap-1">{children}</dd>
    </div>
  );
}

function Valor({ children, apagado = false }: { children: React.ReactNode; apagado?: boolean }) {
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-2.5 text-[17px] leading-snug font-semibold tracking-[-0.015em] md:text-xl',
        apagado && 'font-medium text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function Apoio({ children }: { children: React.ReactNode }) {
  return <span className="text-[13px] leading-snug text-muted-foreground">{children}</span>;
}

/**
 * O cartão de contato: uma linha por dado que EXISTE, com o ícone dizendo o que
 * é. O que falta vira a fila de botões no fim (`CompletarAFicha`).
 *
 * O telefone continua sendo o `TelefoneRevelavel`: para sdr e embaixador o banco
 * entrega o número mascarado, e ver o número inteiro é uma ação registrada em
 * `pii_access_log` (RF-BAS-14, RF-ADM-03). O desenho novo não muda isso.
 */
function Contato({ ficha, whatsappPeloCrm }: { ficha: Ficha; whatsappPeloCrm: boolean }) {
  const lugar = formatarLocal(ficha.bairro, ficha.cidade);
  const faltam = camposQueFaltam(ficha);

  return (
    <section className="sombra-base flex min-w-0 flex-col gap-4 rounded-xl bg-card p-5 md:p-6">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Contato</h2>

      <ul className="flex flex-col gap-3.5">
        <LinhaDeContato icone={Phone} rotulo="WhatsApp">
          <TelefoneRevelavel
            organizationId={ficha.id}
            telefone={ficha.telefone}
            mascarado={ficha.telefoneMascarado}
            // Com o número da KOMUNE conectado, "Conversar" já está no cabeçalho;
            // repetir o botão aqui seria a mesma saída duas vezes.
            whatsapp={whatsappPeloCrm ? 'nenhum' : 'externo'}
          />
        </LinhaDeContato>

        {ficha.instagram ? (
          <LinhaDeContato icone={AtSign} rotulo="Instagram">
            <a
              href={`https://instagram.com/${ficha.instagram}`}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_VALOR}
            >
              {`@${ficha.instagram}`}
            </a>
          </LinhaDeContato>
        ) : null}

        {ficha.site ? (
          <LinhaDeContato icone={Globe} rotulo="Site">
            <a
              href={ficha.site}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(LINK_VALOR, 'break-all')}
            >
              {ficha.site.replace(/^https?:\/\/(www\.)?/, '')}
              <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
            </a>
          </LinhaDeContato>
        ) : null}

        {ficha.email ? (
          <LinhaDeContato icone={Mail} rotulo="E-mail">
            <a href={`mailto:${ficha.email}`} className={cn(LINK_VALOR, 'break-all')}>
              {ficha.email}
            </a>
          </LinhaDeContato>
        ) : null}

        {ficha.cnpj || ficha.pessoaFisica ? (
          <LinhaDeContato icone={IdCard} rotulo="CNPJ">
            {ficha.cnpj ? (
              <span className="numerico">{formatarCnpj(ficha.cnpj)}</span>
            ) : (
              <span className="text-muted-foreground">Pessoa física (MEI ou autônomo)</span>
            )}
          </LinhaDeContato>
        ) : null}

        {lugar || ficha.endereco ? (
          // Com endereço, ele é o valor e o bairro vira o apoio. Sem ele, o valor
          // é o bairro e a cidade — e chamá-los de "Endereço" esconderia que o
          // endereço é justamente o que falta ("+ Endereço", logo abaixo).
          <LinhaDeContato
            icone={MapPin}
            rotulo={ficha.endereco ? lugar || 'Endereço' : 'Bairro e cidade'}
          >
            {ficha.endereco ?? lugar}
          </LinhaDeContato>
        ) : null}
      </ul>

      {faltam.length > 0 ? (
        <div className="border-t border-hairline pt-4">
          <CompletarAFicha faltam={faltam} />
        </div>
      ) : null}

      {/* Proveniência: o RF-BAS-10 exige a origem, quando e quem coletou. As três
          continuam aqui, numa linha só. TEXTO CORRIDO, e não `flex`: como item de
          flex o trecho "· coletado em" descia sozinho no celular e a linha
          começava pelo ponto. */}
      <p className="border-t border-hairline pt-4 text-[13px] leading-relaxed text-muted-foreground">
        <FileText className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden="true" />
        {ficha.origem ? (
          ficha.origemUrl ? (
            <a
              href={ficha.origemUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-4"
            >
              {ficha.origem}
              <ExternalLink className="ml-1 inline size-3 align-[-1px]" aria-hidden="true" />
            </a>
          ) : (
            <span className="text-foreground">{ficha.origem}</span>
          )
        ) : (
          'Origem não informada'
        )}
        {SEPARADOR}coletado em <span className="numerico">{formatarData(ficha.coletadoEm)}</span>{' '}
        por {ficha.coletadoPor}
      </p>

      {ficha.descricao ? (
        <p className="max-w-prose border-t border-hairline pt-4 text-sm text-muted-foreground">
          {ficha.descricao}
        </p>
      ) : null}
    </section>
  );
}

function LinhaDeContato({
  icone: Icone,
  rotulo,
  children,
}: {
  icone: LucideIcon;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-start gap-3.5">
      <span
        aria-hidden="true"
        className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-foreground/[0.07] text-muted-foreground"
      >
        <Icone className="size-[17px]" strokeWidth={1.75} />
      </span>
      {/* O valor em cima, o rótulo embaixo: quem procura o telefone lê o número,
          não a palavra "WhatsApp". */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-[15px] leading-snug">{children}</div>
        <p className="text-[12.5px] leading-snug text-muted-foreground">{rotulo}</p>
      </div>
    </li>
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
 *    comportamento em campo. Agora o chip abre a linha, como na tabela e no cartão.
 *    Desde 29/09/2026 a barra saiu de vez e a linha virou uma superfície dentro do
 *    cartão "Negócios", como as linhas do Meu dia;
 * 2. o "haltere": com `flex-1` à esquerda numa linha de 896px, a próxima ação era
 *    empurrada contra a borda direita e ficava a ~486px do texto a que pertence, sem
 *    nenhuma coluna com que se alinhar (a ficha costuma ter um negócio só). Ela
 *    desceu para a coluna da esquerda, onde é a continuação natural da frase "em que
 *    pé está o negócio" e onde o celular já a jogava de qualquer jeito.
 */
function CartaoNegocio({ negocio }: { negocio: NegocioDaFicha }) {
  const dias = diasDesde(negocio.ultimoContatoEm);

  return (
    <li className="flex flex-col gap-1 rounded-lg bg-muted/45 px-4 py-3">
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

/** 12.345.678/0001-95 */
function formatarCnpj(digitos: string): string {
  if (digitos.length !== 14) return digitos;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}
