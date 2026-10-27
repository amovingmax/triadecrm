'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, ChevronDown, Ellipsis, Link2, Phone, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';

import { MarcaDeNova } from '@/components/avisos/marca-de-nova';
import { useConversasNovas } from '@/components/avisos/provedor-avisos';
import { EMPRESA, TIPOS_EM_USO, TIPOS_POR_EXTENSO } from '@/lib/empresa';
import { cn } from '@/lib/utils';
import { iniciaisDe } from '@/lib/iniciais';
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
import { rotuloDoDia } from './formatos';
import { PreviaDoRascunho } from './lista-conversas';
import { FaixaDaJanela, Janela24h } from './janela-24h';
import { useLeituraDoFio } from './leitura-do-fio';
import { Mensagem } from './mensagem-do-fio';
import {
  estadoDaJanela,
  JANELA_APERTADA_MIN,
  lerBloqueioNaMeta,
  montarMensagens,
  podeEscreverLivre,
  type FioCru,
} from './mensagens';
import { AvisoDeBloqueio, BarraDeBuscaNoFio, MenuDaConversa } from './menu-da-conversa';
import { useEu } from './assumir-conversa';
import type { CatalogosConversas } from './montagem';
import { TextoLivre } from './responder';
import { useRolagemNoFim } from './rolagem-no-fim';
import { previaDoDigitado, useTextosDigitados } from './texto-digitado';

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
}: {
  fios: FioCru[];
  selecionadoId: string | null;
  aoEscolher: (id: string) => void;
}) {
  // As conversas com mensagem ainda sem resposta: a mesma marca da lista de
  // Conversas, e o mesmo número do menu (`components/avisos`).
  const novas = useConversasNovas();
  // O que a pessoa digitou e não enviou: "Rascunho:" na linha, como na lista de
  // Conversas (`texto-digitado.ts`).
  const digitados = useTextosDigitados();
  if (fios.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <p className="font-medium">Nenhum cliente esperando</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Quem escrever para a {EMPRESA.nomeDoNumero} e não for parceiro aparece aqui: cliente da
          plataforma, curioso ou fornecedor que ainda não está na base.
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-1 p-2">
      {fios.map((fio) => {
        const selecionado = fio.id === selecionadoId;
        const nome = fio.peer_nome?.trim();
        const nova = novas.has(fio.id);
        const rascunho = selecionado ? null : previaDoDigitado(digitados.get(fio.id)?.texto);
        return (
          <li key={fio.id}>
            <button
              type="button"
              onClick={() => aoEscolher(fio.id)}
              aria-current={selecionado ? 'true' : undefined}
              className={cn(
                'flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none transition-colors',
                'hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50',
                selecionado && 'bg-muted',
              )}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                {nome ? iniciaisDe(nome) : <Phone className="size-4" aria-hidden="true" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'min-w-0 truncate text-[15px]',
                      nova || fio.unread_count > 0 ? 'font-semibold' : 'font-medium',
                    )}
                  >
                    {nomeDoCliente(fio)}
                  </span>
                  {nova ? <MarcaDeNova /> : null}
                </span>
                {rascunho ? (
                  <PreviaDoRascunho texto={rascunho} className="block text-[13px]" />
                ) : (
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {nome ? formatarTelefone(fio.peer_phone_e164) : 'sem nome no perfil'}
                    {fio.unread_count > 0
                      ? ` · ${fio.unread_count} ${fio.unread_count === 1 ? 'por ler' : 'por ler'}`
                      : ''}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {fio.last_message_at ? (
                  <span className="numerico text-xs text-muted-foreground">
                    {rotuloDoDia(fio.last_message_at).palavra}
                  </span>
                ) : null}
                {fio.unread_count > 0 ? (
                  <span className="numerico inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-menta px-1.5 text-[11px] font-semibold text-menta-tinta">
                    {fio.unread_count}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
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
  const { rolagem, conteudo, aoRolar, soltar } = useRolagemNoFim(
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
      <div className="@container flex h-full min-h-0 flex-col">
        {/* Um cabeçalho por aparelho, como o do parceiro (`conversa.tsx`).
          Celular, e tablet com o painel estreito: UMA LINHA (protótipo A,
          20/10/2026) — voltar, o retrato, o nome com o telefone embaixo e o "⋯";
          o nome e o "⋯" abrem a folha com o telefone e as ações. Computador:
          tudo numa linha, como antes. */}
        <header className="@container border-b border-hairline">
          <div className="hidden h-16 items-center gap-1 pr-1.5 pl-1 md:pl-3 conversa-estreita:flex">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="toque size-11 shrink-0 md:hidden"
              onClick={aoVoltar}
              aria-label="Voltar para a lista"
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
            <button
              type="button"
              onClick={() => setFolha(true)}
              aria-haspopup="dialog"
              className="toque flex h-14 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                {nome ? iniciaisDe(nome) : <Phone className="size-4" aria-hidden="true" />}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[17px] leading-tight font-semibold">
                  {nomeDoCliente(fio)}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-[12.5px] text-muted-foreground">
                  <span className="truncate">
                    {nome ? `${formatarTelefone(fio.peer_phone_e164)} · ` : ''}não é parceiro
                  </span>
                  <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                </span>
              </span>
              <span className="sr-only">: ver o telefone e as ações</span>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="toque size-11 shrink-0"
              onClick={() => setFolha(true)}
              aria-label="Mais: telefone e ações"
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </div>

          <div className="flex items-center gap-3 px-4 py-3 conversa-estreita:hidden">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
              {nome ? iniciaisDe(nome) : <Phone className="size-4" aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{nomeDoCliente(fio)}</p>
              <p className="truncate text-[13px] text-muted-foreground">
                {nome ? `${formatarTelefone(fio.peer_phone_e164)} · ` : ''}não é parceiro
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {virando ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="toque h-8"
                  onClick={() => setVirando(true)}
                  title={`É ${TIPOS_POR_EXTENSO}? Leve para a base.`}
                >
                  <UserPlus aria-hidden="true" />
                  Virar parceiro
                </Button>
              )}
              <ArquivarCliente fio={fio} />
              <MenuDaConversa
                fioId={fio.id}
                bloqueada={bloqueada}
                podeEscrever={Boolean(eu?.podeEscrever)}
                atualizar={chavesDaConversa}
                aoFecharConversa={aoVoltar}
              />
            </div>
          </div>
        </header>
        {/* A lupa da conversa (27/10/2026), aberta pelo "⋯". */}
        <BarraDeBuscaNoFio />

        <Sheet open={folha} onOpenChange={setFolha}>
          <SheetContent
            side="bottom"
            className="max-h-[88svh] gap-5 overflow-y-auto rounded-t-2xl px-4 pt-4 pb-[calc(var(--area-segura-inferior)+1.25rem)]"
          >
            <SheetHeader className="flex-row items-center gap-3 p-0 pr-12 text-left">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
                {nome ? iniciaisDe(nome) : <Phone className="size-5" aria-hidden="true" />}
              </span>
              <div className="min-w-0">
                <SheetTitle className="text-lg leading-tight">{nomeDoCliente(fio)}</SheetTitle>
                <SheetDescription className="text-[13px]">
                  Não é parceiro: quem escreve aqui quase sempre é cliente.
                </SheetDescription>
              </div>
            </SheetHeader>

            <section aria-label="Ações" className="flex flex-col gap-2">
              <h3 className="text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
                Ações
              </h3>
              <div className="grid grid-cols-2 gap-2">
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
                <ArquivarCliente fio={fio} comNome className={ACAO_DA_FOLHA} />
              </div>
            </section>

            <section aria-label="Conversa" className="flex flex-col gap-1">
              <h3 className="text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
                Conversa
              </h3>
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

            <section aria-label="Contato" className="flex flex-col gap-1">
              <h3 className="text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
                Contato
              </h3>
              <dl className="flex flex-col text-sm">
                <div className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-muted-foreground">WhatsApp</dt>
                  <dd className="numerico text-right">{formatarTelefone(fio.peer_phone_e164)}</dd>
                </div>
              </dl>
            </section>
          </SheetContent>
        </Sheet>

        {/* "Virar parceiro" é a exceção: quem escreve aqui quase sempre é cliente,
          e cliente se responde, não se cadastra. O formulário só abre a pedido. */}
        {virando ? (
          <section
            aria-label="Levar para a base de parceiros"
            className="space-y-3 border-b border-hairline bg-muted/30 px-4 py-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Levar para a base de parceiros</p>
                <p className="text-xs text-muted-foreground">
                  Só para {TIPOS_POR_EXTENSO}. Cliente se responde aqui mesmo.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="toque size-9 shrink-0"
                onClick={() => setVirando(false)}
              >
                <X aria-hidden="true" />
                <span className="sr-only">Fechar</span>
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={modo === 'criar' ? 'default' : 'outline'}
                className="toque h-11 md:h-9"
                onClick={() => setModo('criar')}
              >
                <UserPlus aria-hidden="true" />
                Criar parceiro
              </Button>
              <Button
                type="button"
                variant={modo === 'ligar' ? 'default' : 'outline'}
                className="toque h-11 md:h-9"
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

        <div ref={rolagem} onScroll={aoRolar} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div ref={conteudo} className="space-y-2">
            {mensagens.isPending ? (
              <p className="text-sm text-muted-foreground">Carregando as mensagens...</p>
            ) : mensagens.isError ? (
              <p className="text-sm text-muted-foreground">
                {mensagens.error instanceof ErroDaConversa
                  ? mensagens.error.message
                  : 'Não deu para ler as mensagens.'}
              </p>
            ) : (
              // O nome do cliente em cima do balão dele: sem isto, a mensagem de quem
              // não é parceiro aparecia assinada "O parceiro".
              doFio.map((m) => (
                <Mensagem key={m.id} mensagem={m} nomeDoParceiro={nome || 'Cliente'} />
              ))
            )}
          </div>
        </div>

        {/* A caixa de resposta, como em qualquer conversa: dentro das 24 h desde a
          última mensagem da pessoa, texto livre; depois disso o WhatsApp só
          deixa abrir com um modelo aprovado (o cumprimento do período). */}
        {/* No desenho do celular a faixa das 24 h fica em cima da caixa, como na
          conversa de parceiro; no celular o rodapé cresce até 60% e respeita a
          barrinha do iPhone. */}
        <FaixaDaJanela
          estado={janela}
          className="hidden border-t border-hairline conversa-estreita:flex"
        />
        <div className="max-h-[42%] shrink-0 space-y-3 overflow-y-auto border-t border-hairline bg-background/80 px-3 py-2.5 max-md:max-h-[60%] max-md:pb-[calc(0.625rem+var(--folga-inferior,0px))] md:px-5 md:py-3 conversa-estreita:border-t-0 conversa-estreita:pt-1">
          {janela.situacao === 'aberta' && janela.restanteMin <= JANELA_APERTADA_MIN ? (
            <Janela24h estado={janela} />
          ) : null}
          {bloqueada ? (
            // Bloqueado (27/10/2026): nada sai, nem modelo.
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
    </ProvedorDoFio>
  );
}

/**
 * Arquivar: tira da lista e não apaga nada. Atendeu o cliente, arquiva — e se
 * ele escrever de novo, a conversa volta sozinha (`messages_desarquiva`).
 */
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
