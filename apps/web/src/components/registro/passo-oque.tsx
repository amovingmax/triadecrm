'use client';

import Link from 'next/link';
import { ArrowLeft, NotebookPen, PhoneOff, Timer } from 'lucide-react';

import { cn } from '@/lib/utils';
import { BarraTermica, ChipTemperatura, DiasSemContato } from '@/components/temperatura';
import { RevelarItem, RevelarLista } from '@/components/movimento';

import { formatarQuando } from './formatos';
import {
  desfechosOferecidos,
  ROTULOS_SUPERFICIE,
  SUPERFICIES_DO_REGISTRO,
  type AlvoDoRegistro,
  type DesfechoCatalogo,
  type EtapaAlvo,
  type Superficie,
} from './tipos';

/**
 * Passo 2: O QUE ACONTECEU. Um toque no canal (ou nenhum) e um no desfecho — e o
 * toque no desfecho É o commit. Não existe botão "Salvar": ele seria o quarto toque
 * de todo registro, trinta vezes por dia, para confirmar o que ela acabou de dizer.
 *
 * Os chips de canal vêm na ordem de quem está na rua (visita, ligação, WhatsApp, DM,
 * reunião), não na ordem do catálogo, e já chegam com o último canal que ela usou
 * selecionado: quem passa a manhã visitando não toca em canal nenhum.
 *
 * Os desfechos são os do BANCO (`public.interaction_outcomes`, filtrados pela
 * superfície e ordenados por `position`), nunca uma lista fixa em código: o catálogo
 * é editável pelo gestor (RF-ADM-02) e a tela desenha o que vier.
 *
 * A única coisa que a tela TIRA da lista é o que não pode existir: para quem pediu
 * para não ser contatado, sobram só os desfechos que `valeParaQuemPediuParar` aceita
 * (ver `tipos.ts`). Avisar e ao mesmo tempo oferecer "Enviado, sem resposta" era
 * convite ao erro — e o erro criava a tarefa de follow-up que devolvia à fila quem
 * tinha pedido para sair.
 */
export function PassoOQue({
  alvo,
  superficie,
  aoTrocarSuperficie,
  catalogo,
  etapasAlvo,
  aoEscolher,
  aoVoltar,
}: {
  alvo: AlvoDoRegistro;
  superficie: Superficie;
  aoTrocarSuperficie: (s: Superficie) => void;
  catalogo: readonly DesfechoCatalogo[];
  etapasAlvo: readonly EtapaAlvo[];
  aoEscolher: (desfecho: DesfechoCatalogo) => void;
  aoVoltar: () => void;
}) {
  const desfechos = desfechosOferecidos(catalogo, superficie, alvo.naoContatar);

  return (
    <div className="-mx-4 flex flex-col md:mx-0">
      <Cabecalho alvo={alvo} aoVoltar={aoVoltar} />

      {alvo.naoContatar || alvo.cooldownAte || alvo.bloqueado ? (
        <div className="flex flex-col gap-1.5 px-4 pt-3">
          {alvo.naoContatar ? (
            <Aviso
              icone={<PhoneOff className="size-3.5" aria-hidden="true" />}
              tom="atencao"
              titulo="Pediu para não ser contatado."
            >
              Não mande mensagem, não ligue e não visite. A lista aqui embaixo fica só com o que dá
              para registrar sobre quem pediu para sair: o resto criaria tarefa e devolveria este
              parceiro para a fila.
            </Aviso>
          ) : null}
          {alvo.cooldownAte ? (
            <Aviso icone={<Timer className="size-3.5" aria-hidden="true" />}>
              Janela de recontato aberta até {formatarQuando(alvo.cooldownAte)}.
            </Aviso>
          ) : null}
          {alvo.bloqueado ? (
            <Aviso icone={<Timer className="size-3.5" aria-hidden="true" />}>
              Perdido sem reativação: só volta para a fila com reabertura registrada.
            </Aviso>
          ) : null}
        </div>
      ) : null}

      {/* Grade de 3 (e de 5 no desktop), não `flex-wrap`: com 390px os cinco chips
          não cabem numa linha, e o wrap deixava "Reunião" sozinha na segunda. A grade
          dá 3 + 2 com larguras iguais, que é o que o polegar lê como um teclado. */}
      <fieldset className="grid grid-cols-3 gap-2 px-4 pt-4 pb-3 sm:grid-cols-5">
        <legend className="sr-only">Por onde foi o contato</legend>
        {SUPERFICIES_DO_REGISTRO.map((s) => {
          const ativo = s === superficie;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={ativo}
              onClick={() => aoTrocarSuperficie(s)}
              className={cn(
                'toque inline-flex h-11 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                ativo
                  ? 'acao-gradiente'
                  : 'border border-hairline bg-card/50 text-muted-foreground hover:text-foreground',
              )}
            >
              {ROTULOS_SUPERFICIE[s]}
            </button>
          );
        })}
      </fieldset>

      {desfechos.length === 0 ? (
        <NadaARegistrar alvo={alvo} superficie={superficie} />
      ) : (
        <>
          <RevelarLista>
            <ul className="corpo-tabela flex flex-col border-t border-hairline">
              {desfechos.map((desfecho, indice) => (
                <RevelarItem key={desfecho.id} indice={indice}>
                  <LinhaDesfecho
                    desfecho={desfecho}
                    etapasAlvo={etapasAlvo}
                    pipelineDoAlvo={alvo.pipelineId}
                    aoEscolher={aoEscolher}
                  />
                </RevelarItem>
              ))}
            </ul>
          </RevelarLista>
          {alvo.naoContatar ? (
            <div className="flex flex-col items-start gap-2 border-t border-hairline px-4 py-4">
              <p className="text-sm text-muted-foreground">
                Os outros resultados deste canal sumiram porque criariam tarefa em cima de quem
                pediu para sair. Foi outra coisa? Anote na ficha.
              </p>
              <LinkDaFicha alvo={alvo} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** A saída honesta de quem está em opt-out: anotar sem virar tarefa, etapa ou temperatura. */
function LinkDaFicha({ alvo }: { alvo: AlvoDoRegistro }) {
  return (
    <Link
      href={`/parceiros/${alvo.id}`}
      className="toque inline-flex h-11 items-center gap-2 rounded-lg border border-hairline px-3.5 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <NotebookPen className="size-4" aria-hidden="true" />
      Abrir a ficha de {alvo.nome}
    </Link>
  );
}

/**
 * O canal em que não sobrou nada para registrar. Só acontece com `do_not_contact`.
 *
 * A tela DIZ por que a lista está vazia — sumir com os botões sem explicação faria a
 * Heloísa achar que o CRM quebrou e procurar outro caminho para o mesmo erro. E oferece
 * a saída honesta: a ficha do parceiro, onde ela anota o que aconteceu sem que isso
 * vire tarefa, etapa ou temperatura.
 */
function NadaARegistrar({ alvo, superficie }: { alvo: AlvoDoRegistro; superficie: Superficie }) {
  return (
    <div className="flex flex-col items-start gap-3 border-t border-hairline px-4 py-6">
      <p className="text-sm">
        Nada a registrar por {ROTULOS_SUPERFICIE[superficie].toLowerCase()} com quem pediu para
        parar.
      </p>
      <p className="text-sm text-muted-foreground">
        {alvo.nome} está em opt-out: qualquer resultado deste canal seria o registro de um contato
        que não podia ter acontecido, e criaria a próxima tarefa em cima dele. Se ele procurou você,
        anote na ficha — anotação não devolve ninguém para a fila.
      </p>
      <LinkDaFicha alvo={alvo} />
    </div>
  );
}

/**
 * O cabeçalho fica GRUDADO no topo enquanto ela rola os desfechos: com o polegar
 * sobre a lista, é ele que garante que o registro está indo para o parceiro certo.
 */
function Cabecalho({ alvo, aoVoltar }: { alvo: AlvoDoRegistro; aoVoltar: () => void }) {
  return (
    <div className="superficie-vidro sticky top-14 z-10 flex items-center gap-2 py-2.5 pr-4 pl-1">
      <button
        type="button"
        onClick={aoVoltar}
        className="toque flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        <span className="sr-only">Trocar de parceiro</span>
      </button>
      <BarraTermica
        temperatura={alvo.temperatura}
        needsAttention={alvo.precisaAtencao}
        className="h-9"
        semRotulo
      />
      <div className="min-w-0 flex-1 pl-1">
        <p className="truncate font-medium">{alvo.nome}</p>
        <p className="flex items-center gap-2 truncate text-xs text-muted-foreground">
          <ChipTemperatura temperatura={alvo.temperatura} comDescricao={false} />
          {alvo.etapa ? <span className="truncate">{alvo.etapa}</span> : null}
        </p>
      </div>
      <DiasSemContato dias={alvo.diasSemContato} className="shrink-0" />
    </div>
  );
}

/**
 * Os avisos do cabeçalho. `tom="atencao"` é para a regra que a tela vai FAZER CUMPRIR
 * (hoje só o opt-out): quando a tela tira botões da mão de quem está na rua, o motivo
 * precisa ter o mesmo peso visual da coisa que sumiu.
 */
function Aviso({
  icone,
  titulo,
  tom = 'neutro',
  children,
}: {
  icone: React.ReactNode;
  titulo?: string;
  tom?: 'neutro' | 'atencao';
  children: React.ReactNode;
}) {
  const atencao = tom === 'atencao';
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
        atencao
          ? 'border-destructive/40 bg-destructive/10 text-muted-foreground'
          : 'border-hairline bg-card/50 text-muted-foreground',
      )}
    >
      <span
        className={cn('mt-0.5 shrink-0', atencao ? 'text-destructive-texto' : 'text-foreground')}
      >
        {icone}
      </span>
      <span>
        {titulo ? <span className="font-medium text-foreground">{titulo} </span> : null}
        {children}
      </span>
    </p>
  );
}

/**
 * Uma linha de desfecho: 56px de alvo, o nome do banco como rótulo e, embaixo, o que
 * o catálogo já decidiu que vem depois (a próxima ação). À direita, a temperatura que
 * o desfecho declara — é a previsão do pagamento, e é o que ensina a escala sem
 * nenhuma tela de ajuda.
 */
function LinhaDesfecho({
  desfecho,
  etapasAlvo,
  pipelineDoAlvo,
  aoEscolher,
}: {
  desfecho: DesfechoCatalogo;
  etapasAlvo: readonly EtapaAlvo[];
  pipelineDoAlvo: number | null;
  aoEscolher: (d: DesfechoCatalogo) => void;
}) {
  const destino =
    desfecho.target_stage_slug === null
      ? null
      : (etapasAlvo.find(
          (e) =>
            e.slug === desfecho.target_stage_slug &&
            (pipelineDoAlvo === null || e.pipelineId === pipelineDoAlvo),
        ) ?? null);
  const temperatura = desfecho.sets_temperature ?? destino?.temperatura ?? null;

  return (
    <li className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={() => aoEscolher(desfecho)}
        className="toque flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left outline-none active:bg-muted/60 focus-visible:bg-muted/60"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{desfecho.name}</span>
          {desfecho.next_action_label ? (
            <span className="block truncate text-xs text-muted-foreground">
              {desfecho.next_action_label}
            </span>
          ) : null}
        </span>
        {temperatura ? <ChipTemperatura temperatura={temperatura} comDescricao={false} /> : null}
      </button>
    </li>
  );
}
