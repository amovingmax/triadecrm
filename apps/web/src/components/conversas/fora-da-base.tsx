'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, EllipsisVertical, Link2, PanelRight, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';

import { EMPRESA, TIPOS_EM_USO, TIPOS_POR_EXTENSO } from '@/lib/empresa';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatarTelefone } from '@/components/parceiros/formatos';
import { buscarAlvos } from '@/components/registro/alvos';
import { DEBOUNCE_BUSCA_MS, type SugestaoDeAlvo } from '@/components/registro/tipos';

import { arquivarConversa, ErroDaConversa } from './acoes';
import { CONCLUIR_NA_EMPRESA, ConcluirConversa, FaixaDeConcluida } from './concluir-conversa';
import { ProvedorDoFio } from './contexto-do-fio';
import { CHAVE_CONVERSAS, mensagemDoErro } from './dados';
import { EnviarModelo } from './enviar-modelo';
import {
  carregarMensagensDoFio,
  chaveDasMensagensDoFio,
  criarFichaDaConversa,
  fraseDoResultado,
  nomeDoCliente,
  vincularConversa,
  type ResultadoDaFicha,
} from './fora-da-base-dados';
import { ListaConversas } from './lista-conversas';
import {
  BotaoDeLigarNaConversa,
  FaixaDaLigacao,
} from '@/components/ligacao-whatsapp/botao-na-conversa';
import { SEM_PERDIDAS, type Perdidas } from '@/components/ligacao-whatsapp/logica';
import { AreaDoFio, FichaAoLado, ROTULO_DA_SECAO, useAvisoDeNaoLidas } from './fio-wpp';
import { Janela24h, PilulaDaJanela } from './janela-24h';
import { LinhaDoTempo } from './linha-do-tempo';
import { agruparPorDia, montarLinhaDoTempo } from './montagem';
import type { Preferencias } from './preferencias';
import { AvatarDaConversa, BotaoRedondo } from './wpp';
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';
import { useLeituraDoFio } from './leitura-do-fio';
import {
  estadoDaJanela,
  JANELA_APERTADA_MIN,
  lerBloqueioNaMeta,
  montarMensagens,
  podeEscreverLivre,
  type FioCru,
} from './mensagens';
import {
  AvisoDeBloqueio,
  BarraDeBuscaNoFio,
  BotaoDeBuscarNoFio,
  MenuDaConversa,
} from './menu-da-conversa';
import { useEu } from './assumir-conversa';
import { AtitudeDaConversaNoTopo } from './atitude';
import type { BaseDasAtitudes } from './atitude-dados';
import type { CatalogosConversas } from './montagem';
import { TextoLivre } from './responder';
import { useRolagemNoFim } from './rolagem-no-fim';

/**
 * A aba "Clientes" (era "Fora da base"): quem escreveu para o número da KOMUNE
 * e não é parceiro.
 *
 * O QUE MUDOU EM 01/10/2026. Rafael: "adeque o crm pra responder clientes
 * normais, oq vem 'fora da base' em conversas, vem pessoas q n são leads". O
 * número vive só na Cloud API desde 14/09, então cliente da plataforma e
 * curioso também chegam aqui — e a aba só sabia fazer deles uma ficha. Agora a
 * conversa se RESPONDE aqui mesmo, sem virar parceiro nem entrar em funil; e
 * "virar parceiro" continua a um botão, para o fornecedor que escreveu antes de
 * estar na base.
 */
export function ListaForaDaBase({
  fios,
  selecionadoId,
  aoEscolher,
  atitudes = null,
  perdidas = SEM_PERDIDAS,
  preferencias,
  porInteresse = false,
}: {
  fios: FioCru[];
  selecionadoId: string | null;
  aoEscolher: (id: string) => void;
  /** A atitude do cliente (Imova): a etiqueta na linha. Desligada, nada aparece. */
  atitudes?: BaseDasAtitudes | null;
  /** Quem ligou e não foi atendido (03/11/2026): sobe para o topo com o selo. */
  perdidas?: Perdidas;
  /** Fixar e silenciar de quem está olhando. */
  preferencias?: Preferencias;
  /** "Mais interessados": a ordem é a da atitude. */
  porInteresse?: boolean;
}) {
  if (fios.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <p className="font-medium">Nenhum cliente esperando</p>
        <p className="max-w-xs text-sm text-wpp-suave">
          {EMPRESA.modulos.fichaDoCliente
            ? `Quem escrever para a ${EMPRESA.nomeDoNumero} aparece aqui e ganha a ficha de cliente sozinho, com a etapa e a próxima ação.`
            : `Quem escrever para a ${EMPRESA.nomeDoNumero} e não for parceiro aparece aqui: cliente da plataforma, curioso ou fornecedor que ainda não está na base.`}
        </p>
      </div>
    );
  }
  // A mesma linha da lista de Conversas, no jeito do WhatsApp (03/11/2026): o
  // retrato, o nome e a hora, a prévia, o número verde e a setinha das opções.
  return (
    <ListaConversas
      itens={[]}
      selecionadoId={null}
      aoEscolher={() => {}}
      clientes={fios}
      clienteSelecionadoId={selecionadoId}
      aoEscolherCliente={aoEscolher}
      preferencias={preferencias}
      atitudes={atitudes}
      porInteresse={porInteresse}
      perdidas={perdidas}
    />
  );
}

export function ConversaForaDaBase({
  fio,
  catalogos,
  aoVoltar,
  aoLigar,
  escolhaExplicita,
  mensagemAlvo = null,
  aoChegarNoAlvo,
  fichaAberta,
  aoAlternarFicha,
}: {
  fio: FioCru;
  catalogos: CatalogosConversas;
  aoVoltar: () => void;
  /** A conversa virou ficha: a tela abre a ficha na aba Conversas. */
  aoLigar: (organizacaoId: string) => void;
  /** A pessoa ESCOLHEU esta conversa; a que o desktop abre sozinho não conta como lida. */
  escolhaExplicita: boolean;
  /** Abrir já na mensagem que a busca da lista achou (27/10/2026). */
  mensagemAlvo?: string | null;
  aoChegarNoAlvo?: () => void;
  /** A coluna "Dados do contato" ao lado, no computador: vale para todas as conversas. */
  fichaAberta: boolean;
  aoAlternarFicha: () => void;
}) {
  const nomeDaPessoa = useMemo(
    () => new Map(catalogos.pessoas.map((p) => [p.id, p.nome])),
    [catalogos.pessoas],
  );
  const mensagens = useQuery({
    queryKey: chaveDasMensagensDoFio(fio.id),
    queryFn: () => carregarMensagensDoFio(fio.id),
  });
  // O "por ler" zera ao abrir e a cada mensagem que chega com a conversa na
  // frente da pessoa (06/10/2026); a marca "Nova" continua até a resposta.
  useLeituraDoFio({
    fioId: fio.id,
    naoLidas: fio.unread_count,
    ultimaEntradaEm: fio.last_inbound_at,
    escolhida: escolhaExplicita,
  });
  // Abre no fim, como a conversa de parceiro (ver `rolagem-no-fim.ts`).
  const { rolagem, conteudo, aoRolar, soltar, longe, irAoFim } = useRolagemNoFim(
    fio.id,
    mensagens.data?.length ?? 0,
  );
  // O fio montado uma vez, para os balões e para o menu de cada um (27/10/2026).
  const doFio = useMemo(
    () => (mensagens.data ? montarMensagens(mensagens.data, nomeDaPessoa) : []),
    [mensagens.data, nomeDaPessoa],
  );
  const chavesDaConversa = useMemo(() => [chaveDasMensagensDoFio(fio.id)], [fio.id]);
  const eu = useEu();
  const bloqueada = Boolean(fio.bloqueada_em);
  const [virando, setVirando] = useState(false);
  const [modo, setModo] = useState<'criar' | 'ligar'>('criar');
  // A folha do desenho do celular (protótipo A, 20/10/2026), como na conversa de parceiro.
  const [folha, setFolha] = useState(false);
  const janela = estadoDaJanela(fio.window_expires_at);
  const nome = fio.peer_nome?.trim();

  const dias = useMemo(
    () =>
      mensagens.data
        ? agruparPorDia(
            montarLinhaDoTempo({
              atividades: [],
              historico: [],
              mensagens: mensagens.data,
              catalogos,
            }),
          )
        : [],
    [mensagens.data, catalogos],
  );
  const avisoDeNaoLidas = useAvisoDeNaoLidas(dias, fio.unread_count);
  const painel = useRef<HTMLDivElement>(null);
  const naoCabeAFicha = () =>
    window.matchMedia('(max-width: 767px)').matches ||
    (window.matchMedia('(pointer: coarse)').matches && (painel.current?.clientWidth ?? 0) < 672);
  const ehCelular = useEhCelular();
  const rotulo = nomeDoCliente(fio);

  // O que a folha do celular e a coluna "Dados do contato" mostram: a atitude, as
  // ações e o telefone.
  const ficha = (naFolha: boolean) => (
    <>
      <AtitudeNaFolha conversaId={fio.id} podeEscrever={Boolean(eu?.podeEscrever)} />

      <section aria-label="Ações" className="flex flex-col gap-2">
        <h3 className={ROTULO_DA_SECAO}>Ações</h3>
        <div className={cn('grid gap-2', naFolha ? 'grid-cols-2' : 'grid-cols-1')}>
          {virando ? null : (
            <Button
              type="button"
              variant="outline"
              className={ACAO_DA_FOLHA}
              onClick={() => {
                setFolha(false);
                setVirando(true);
              }}
            >
              <UserPlus aria-hidden="true" />
              Virar parceiro
            </Button>
          )}
          {eu?.podeEscrever ? (
            CONCLUIR_NA_EMPRESA ? (
              <ConcluirConversa
                fioId={fio.id}
                concluidaEm={fio.arquivada_em}
                tamanho="bloco"
                className={ACAO_DA_FOLHA}
              />
            ) : (
              <ArquivarCliente fio={fio} comNome className={ACAO_DA_FOLHA} />
            )
          ) : null}
        </div>
      </section>

      {naFolha ? (
        <section aria-label="Conversa" className="flex flex-col gap-1">
          <h3 className={ROTULO_DA_SECAO}>Conversa</h3>
          <MenuDaConversa
            variante="folha"
            fioId={fio.id}
            bloqueada={bloqueada}
            podeEscrever={Boolean(eu?.podeEscrever)}
            atualizar={chavesDaConversa}
            aoFecharConversa={aoVoltar}
            aoEscolher={() => setFolha(false)}
          />
        </section>
      ) : null}

      <section aria-label="Contato" className="flex flex-col gap-1">
        <h3 className={ROTULO_DA_SECAO}>Contato</h3>
        <dl className="flex flex-col text-sm">
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-wpp-suave">WhatsApp</dt>
            <dd className="numerico text-right">{formatarTelefone(fio.peer_phone_e164)}</dd>
          </div>
        </dl>
      </section>
    </>
  );

  return (
    <ProvedorDoFio
      fioId={fio.id}
      mensagens={doFio}
      janelaAberta={podeEscreverLivre(janela)}
      bloqueada={bloqueada}
      nomeDoParceiro={nome || 'Cliente'}
      atualizar={chavesDaConversa}
      soltarRolagem={soltar}
      mensagemAlvo={mensagemAlvo}
      aoChegarNoAlvo={aoChegarNoAlvo}
    >
      <div className="flex h-full min-h-0">
        <div ref={painel} className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col">
          {/* O cabeçalho do WhatsApp, como o do parceiro (`conversa.tsx`): o
              retrato, o nome com o telefone embaixo e, à direita, buscar, ligar,
              virar parceiro, concluir e o "⋯". Tocar no nome abre os dados do
              contato — a folha no celular, a coluna ao lado no computador. */}
          <header className="flex h-14 shrink-0 items-center gap-0.5 border-b md:h-16 border-wpp-linha bg-wpp-painel pr-2.5 pl-1 md:pl-3">
            <BotaoRedondo
              onClick={aoVoltar}
              className="text-foreground md:hidden"
              aria-label="Voltar para a lista"
            >
              <ArrowLeft aria-hidden="true" />
            </BotaoRedondo>
            <button
              type="button"
              onClick={() => (naoCabeAFicha() ? setFolha(true) : aoAlternarFicha())}
              aria-haspopup="dialog"
              className="toque flex h-[52px] min-w-0 flex-1 items-center gap-3 rounded-[14px] pr-2 pl-1 text-left outline-none hover:bg-foreground/[0.04] focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <AvatarDaConversa nome={nome || '?'} tamanho={40} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-base leading-tight font-semibold">{rotulo}</span>
                <span className="truncate text-[12.5px] text-wpp-suave">
                  {nome ? `${formatarTelefone(fio.peer_phone_e164)} · ` : ''}não é parceiro
                </span>
              </span>
              <span className="sr-only">: ver o telefone e as ações</span>
            </button>
            <BotaoDeBuscarNoFio className="max-md:hidden" />
            {eu?.podeEscrever ? (
              <BotaoDeLigarNaConversa conversaId={fio.id} nome={rotulo} compacto={ehCelular} />
            ) : null}
            {virando ? null : (
              <Button
                type="button"
                variant="outline"
                className="toque mx-0.5 h-10 shrink-0 rounded-full border-wpp-linha-forte bg-transparent px-3.5 text-[13.5px] font-medium conversa-estreita:hidden"
                onClick={() => setVirando(true)}
                title={`É ${TIPOS_POR_EXTENSO}? Leve para a base.`}
              >
                <UserPlus aria-hidden="true" />
                <span className="hidden @3xl:inline">Virar parceiro</span>
                <span className="sr-only @3xl:hidden">Virar parceiro</span>
              </Button>
            )}
            {eu?.podeEscrever ? (
              CONCLUIR_NA_EMPRESA ? (
                <ConcluirConversa
                  fioId={fio.id}
                  concluidaEm={fio.arquivada_em}
                  rotuloPelaLargura
                  className="mx-1 conversa-estreita:hidden"
                />
              ) : (
                <ArquivarCliente fio={fio} className="conversa-estreita:hidden" />
              )
            ) : null}
            <BotaoRedondo
              onClick={aoAlternarFicha}
              aria-pressed={fichaAberta}
              aria-label={fichaAberta ? 'Fechar os dados do contato' : 'Ver os dados do contato'}
              className="max-md:hidden conversa-estreita:hidden"
            >
              <PanelRight aria-hidden="true" />
            </BotaoRedondo>
            <span className="contents conversa-estreita:hidden">
              <MenuDaConversa
                fioId={fio.id}
                bloqueada={bloqueada}
                podeEscrever={Boolean(eu?.podeEscrever)}
                atualizar={chavesDaConversa}
                aoFecharConversa={aoVoltar}
                concluidaEm={fio.arquivada_em}
              />
            </span>
            <BotaoRedondo
              onClick={() => setFolha(true)}
              aria-label="Mais: telefone e ações"
              className="hidden conversa-estreita:inline-flex"
            >
              <EllipsisVertical aria-hidden="true" />
            </BotaoRedondo>
          </header>

          <BarraDeBuscaNoFio />
          <FaixaDeConcluida
            fioId={fio.id}
            concluidaEm={fio.arquivada_em}
            concluidaPor={fio.arquivada_por ? (nomeDaPessoa.get(fio.arquivada_por) ?? null) : null}
            podeReabrir={Boolean(eu?.podeEscrever)}
          />
          <FaixaDaLigacao conversaId={fio.id} className="border-b border-wpp-linha" />

          <Sheet open={folha} onOpenChange={setFolha}>
            <SheetContent
              side="bottom"
              className="max-h-[88svh] gap-5 overflow-y-auto rounded-t-2xl px-4 pt-4 pb-[calc(var(--area-segura-inferior)+1.25rem)]"
            >
              <SheetHeader className="flex-row items-center gap-3 p-0 pr-12 text-left">
                <AvatarDaConversa nome={nome || '?'} tamanho={48} anel="var(--background)" />
                <div className="min-w-0">
                  <SheetTitle className="text-lg leading-tight">{rotulo}</SheetTitle>
                  <SheetDescription className="text-[13px]">
                    Não é parceiro: quem escreve aqui quase sempre é cliente.
                  </SheetDescription>
                </div>
              </SheetHeader>
              {ficha(true)}
            </SheetContent>
          </Sheet>

          {/* "Virar parceiro" é a exceção: quem escreve aqui quase sempre é cliente,
              e cliente se responde, não se cadastra. O formulário só abre a pedido. */}
          {virando ? (
            <section
              aria-label="Levar para a base de parceiros"
              className="max-h-[50%] shrink-0 space-y-3 overflow-y-auto border-b border-wpp-linha bg-wpp-painel2 px-4 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Levar para a base de parceiros</p>
                  <p className="text-xs text-wpp-suave">
                    Só para {TIPOS_POR_EXTENSO}. Cliente se responde aqui mesmo.
                  </p>
                </div>
                <BotaoRedondo onClick={() => setVirando(false)} aria-label="Fechar" tamanho="sm">
                  <X aria-hidden="true" />
                </BotaoRedondo>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={modo === 'criar' ? 'default' : 'outline'}
                  className="toque h-11 rounded-full md:h-9"
                  onClick={() => setModo('criar')}
                >
                  <UserPlus aria-hidden="true" />
                  Criar parceiro
                </Button>
                <Button
                  type="button"
                  variant={modo === 'ligar' ? 'default' : 'outline'}
                  className="toque h-11 rounded-full md:h-9"
                  onClick={() => setModo('ligar')}
                >
                  <Link2 aria-hidden="true" />
                  Ligar a um que já existe
                </Button>
              </div>
              {modo === 'criar' ? (
                <CriarFicha fio={fio} catalogos={catalogos} aoLigar={aoLigar} />
              ) : (
                <LigarFicha fio={fio} aoLigar={aoLigar} />
              )}
            </section>
          ) : null}

          <AreaDoFio
            rolagem={rolagem}
            conteudo={conteudo}
            aoRolar={aoRolar}
            longe={longe}
            irAoFim={irAoFim}
            topo={<PilulaDaJanela estado={janela} />}
          >
            {mensagens.isPending ? (
              <p className="mx-auto my-6 text-sm text-wpp-suave">Carregando as mensagens...</p>
            ) : mensagens.isError ? (
              <p className="mx-auto my-6 text-sm text-wpp-suave">
                {mensagens.error instanceof ErroDaConversa
                  ? mensagens.error.message
                  : 'Não deu para ler as mensagens.'}
              </p>
            ) : (
              // O nome do cliente vai para a citação do que ele mandou: sem isto,
              // a mensagem de quem não é parceiro aparecia assinada "O parceiro".
              <LinhaDoTempo
                dias={dias}
                nomeDoParceiro={nome || 'Cliente'}
                naoLidas={avisoDeNaoLidas}
              />
            )}
          </AreaDoFio>

          {/* A caixa de resposta, como em qualquer conversa: dentro das 24 h desde a
              última mensagem da pessoa, texto livre; depois disso o WhatsApp só
              deixa abrir com um modelo aprovado (o cumprimento do período). No
              celular o rodapé cresce até 60% e respeita a barrinha do iPhone. */}
          <div className="max-h-[42%] shrink-0 space-y-2 overflow-y-auto border-t border-wpp-linha bg-wpp-painel2 px-2 py-1.5 max-md:max-h-[60%] max-md:pb-[calc(0.375rem+var(--folga-inferior,0px))] md:px-3 md:py-2.5">
            {janela.situacao === 'aberta' && janela.restanteMin <= JANELA_APERTADA_MIN ? (
              <Janela24h estado={janela} className="mx-1" />
            ) : null}
            {bloqueada ? (
              // Bloqueada no CRM: nada sai, nem modelo. Quem desbloqueia é o "⋯".
              <AvisoDeBloqueio
                fioId={fio.id}
                quem={fio.bloqueada_por ? (nomeDaPessoa.get(fio.bloqueada_por) ?? null) : null}
                naMeta={lerBloqueioNaMeta(fio.bloqueio_na_meta)}
                erro={fio.bloqueio_erro?.trim() || null}
                atualizar={chavesDaConversa}
              />
            ) : podeEscreverLivre(janela) ? (
              <TextoLivre key={fio.id} fioId={fio.id} atualizar={chavesDaConversa} />
            ) : (
              <EnviarModelo destino={{ tipo: 'conversa', conversaId: fio.id }} />
            )}
          </div>
        </div>

        {fichaAberta ? (
          <FichaAoLado aoFechar={aoAlternarFicha}>
            <div className="flex flex-col items-center gap-2 text-center">
              <AvatarDaConversa nome={nome || '?'} tamanho={72} />
              <p className="text-lg leading-tight font-semibold">{rotulo}</p>
              <p className="numerico text-[13px] text-wpp-suave">
                {formatarTelefone(fio.peer_phone_e164)}
              </p>
            </div>
            {ficha(false)}
          </FichaAoLado>
        ) : null}
      </div>
    </ProvedorDoFio>
  );
}

/**
 * Arquivar: tira da lista e não apaga nada. Atendeu o cliente, arquiva — e se
 * ele escrever de novo, a conversa volta sozinha (`messages_desarquiva`).
 */
/** A atitude na folha do celular: some inteira quando está desligada. */
function AtitudeNaFolha({
  conversaId,
  podeEscrever,
}: {
  conversaId: string;
  podeEscrever: boolean;
}) {
  return (
    <section aria-label="Interesse" className="flex flex-col gap-2 has-[div:empty]:hidden">
      <h3 className="text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        Interesse
      </h3>
      <div className="flex flex-wrap items-center gap-1.5">
        <AtitudeDaConversaNoTopo conversaId={conversaId} podeEscrever={podeEscrever} naFolha />
      </div>
    </section>
  );
}

function ArquivarCliente({
  fio,
  comNome = false,
  className,
}: {
  fio: FioCru;
  /** Na folha do celular: botão inteiro, com o nome da ação. */
  comNome?: boolean;
  className?: string;
}) {
  const clientes = useQueryClient();
  const acao = useMutation({
    mutationFn: (arquivar: boolean) => arquivarConversa(fio.id, arquivar),
    onSuccess: (_r, arquivar) => {
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      if (arquivar) {
        toast.success('Conversa arquivada.', {
          description: 'Ela volta sozinha se a pessoa escrever.',
          action: { label: 'Desfazer', onClick: () => acao.mutate(false) },
        });
      } else {
        toast.success('Conversa de volta na lista.');
      }
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });
  if (comNome) {
    return (
      <Button
        type="button"
        variant="outline"
        className={className}
        disabled={acao.isPending}
        onClick={() => acao.mutate(true)}
      >
        <Archive aria-hidden="true" />
        Arquivar
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('toque size-11 md:size-9', className)}
      disabled={acao.isPending}
      onClick={() => acao.mutate(true)}
      title="Arquivar: tira da lista, não apaga nada"
    >
      <Archive aria-hidden="true" />
      <span className="sr-only">Arquivar conversa</span>
    </Button>
  );
}

/** Uma ação da folha do celular: bloco de 56 px, ícone e nome (como em `conversa.tsx`). */
const ACAO_DA_FOLHA =
  'toque h-14 w-full justify-start gap-2.5 rounded-xl px-4 text-[15px] font-medium md:h-14';

/** Fornecedor, produtor e cerimonialista, só os que a empresa usa e com o rótulo dela. */
const TIPOS = TIPOS_EM_USO;

function useDepoisDeLigar(aoLigar: (organizacaoId: string) => void) {
  const clientes = useQueryClient();
  return (r: ResultadoDaFicha, sucesso: string) => {
    if (r.ok && r.organization_id) {
      toast.success(sucesso);
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      aoLigar(r.organization_id);
      return true;
    }
    return false;
  };
}

function CriarFicha({
  fio,
  catalogos,
  aoLigar,
}: {
  fio: FioCru;
  catalogos: CatalogosConversas;
  aoLigar: (organizacaoId: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]['id']>('fornecedor');
  const [categoriaId, setCategoriaId] = useState<number | null>(null);
  const [recusa, setRecusa] = useState<ResultadoDaFicha | null>(null);
  const depois = useDepoisDeLigar(aoLigar);

  const criar = useMutation({
    mutationFn: () =>
      criarFichaDaConversa({ fioId: fio.id, nome, categoriaId: categoriaId ?? 0, tipo }),
    onSuccess: (r) => {
      if (!depois(r, 'Parceiro criado. A conversa agora está na ficha dele.')) setRecusa(r);
    },
    onError: (erro) =>
      toast.error(erro instanceof ErroDaConversa ? erro.message : 'Não deu para criar a ficha.'),
  });
  const ligarAExistente = useMutation({
    mutationFn: (organizacaoId: string) => vincularConversa(fio.id, organizacaoId),
    onSuccess: (r) => {
      if (!depois(r, 'Conversa ligada ao parceiro que já existia.')) setRecusa(r);
    },
  });

  const pode = nome.trim().length > 0 && categoriaId !== null && !criar.isPending;

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setRecusa(null);
        if (pode) criar.mutate();
      }}
    >
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`nome-${fio.id}`}>Nome da empresa ou do profissional</Label>
        <Input
          id={`nome-${fio.id}`}
          value={nome}
          maxLength={120}
          onChange={(e) => setNome(e.target.value)}
          className="h-11 md:h-9"
          placeholder="Como aparece na conversa"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`tipo-${fio.id}`}>Tipo</Label>
        <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
          <SelectTrigger id={`tipo-${fio.id}`} className="toque h-11 w-full md:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`categoria-${fio.id}`}>Categoria</Label>
        <Select
          value={categoriaId === null ? undefined : String(categoriaId)}
          onValueChange={(v) => setCategoriaId(Number(v))}
        >
          <SelectTrigger id={`categoria-${fio.id}`} className="toque h-11 w-full md:h-9">
            <SelectValue placeholder="Escolha" />
          </SelectTrigger>
          <SelectContent>
            {(catalogos.categorias ?? []).map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {recusa ? (
        <div className="space-y-2 sm:col-span-2">
          <p className="text-sm text-destructive-texto">{fraseDoResultado(recusa)}</p>
          {recusa.organization_id &&
          (recusa.motivo === 'telefone_ja_cadastrado' ||
            recusa.motivo === 'telefone_de_contato_existente') ? (
            <Button
              type="button"
              variant="outline"
              className="toque h-11 md:h-9"
              disabled={ligarAExistente.isPending}
              onClick={() => ligarAExistente.mutate(recusa.organization_id!)}
            >
              <Link2 aria-hidden="true" />
              Ligar a essa ficha
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" className="toque h-11 md:h-9" disabled={!pode}>
          {criar.isPending ? 'Criando...' : 'Criar parceiro com este número'}
        </Button>
      </div>
    </form>
  );
}

function LigarFicha({ fio, aoLigar }: { fio: FioCru; aoLigar: (organizacaoId: string) => void }) {
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [recusa, setRecusa] = useState<string | null>(null);
  const depois = useDepoisDeLigar(aoLigar);

  useEffect(() => {
    const id = window.setTimeout(() => setBusca(texto.trim()), DEBOUNCE_BUSCA_MS);
    return () => window.clearTimeout(id);
  }, [texto]);

  const resultados = useQuery({
    queryKey: ['conversas', 'fora-da-base', 'busca', busca],
    queryFn: () => buscarAlvos(busca),
    enabled: busca.length >= 2,
  });

  const ligar = useMutation({
    mutationFn: (alvo: SugestaoDeAlvo) => vincularConversa(fio.id, alvo.id),
    onSuccess: (r) => {
      if (!depois(r, 'Conversa ligada à ficha.')) setRecusa(fraseDoResultado(r));
    },
    onError: (erro) =>
      toast.error(erro instanceof ErroDaConversa ? erro.message : 'Não deu para ligar a ficha.'),
  });

  return (
    <div className="space-y-2">
      <Label htmlFor={`busca-${fio.id}`}>Procurar o parceiro</Label>
      <Input
        id={`busca-${fio.id}`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Nome, bairro, @instagram ou CNPJ"
        className="h-11 md:h-9"
      />
      {recusa ? <p className="text-sm text-destructive-texto">{recusa}</p> : null}
      {busca.length >= 2 ? (
        resultados.isPending ? (
          <p className="text-xs text-muted-foreground">Procurando...</p>
        ) : (resultados.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma ficha com esse nome.</p>
        ) : (
          <ul className="max-h-56 divide-y divide-hairline overflow-y-auto rounded-lg border border-hairline">
            {(resultados.data ?? []).map((alvo) => (
              <li key={alvo.id}>
                <button
                  type="button"
                  disabled={ligar.isPending}
                  onClick={() => {
                    setRecusa(null);
                    ligar.mutate(alvo);
                  }}
                  className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
                >
                  <span className="text-sm font-medium">{alvo.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {[alvo.categoria, alvo.bairro, alvo.etapa].filter(Boolean).join(' · ') ||
                      'Sem categoria'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
