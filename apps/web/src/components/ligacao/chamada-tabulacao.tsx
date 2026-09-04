'use client';

import { useState } from 'react';
import { Loader2, PhoneOff, ShieldBan } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ROTULOS_COM_QUEM, type ComQuem } from '@/components/registro/tipos';

import {
  desfechosDaChamada,
  ROTULOS_RESULTADO_TECNICO,
  RESULTADOS_SEM_CONVERSA,
  type DesfechoDeLigacao,
  type ResultadoTecnico,
} from './tipos';

/**
 * O rodapé: a tabulação, e ela é o commit.
 *
 * Os dois eixos do R13 §3.3 estão desenhados na própria forma da barra:
 *
 * - **Sem conversa**, os quatro botões de resultado TÉCNICO ficam sempre à mão, do
 *   primeiro segundo ao último. Um toque grava a tentativa, chama `registrar_contato`
 *   com o desfecho que o mapa resolveu e traz o próximo. Nenhum resultado comercial é
 *   oferecido aqui — oferecer "Sem interesse" a quem não atendeu seria fabricar uma
 *   recusa que ninguém fez.
 * - **Com conversa**, o eixo técnico já está decidido (`atendida_humano`) e some da
 *   tela. O que aparece é o desfecho comercial: quando a conversa chega a um nó `fim`,
 *   ele vem pronto num botão só; quando ela termina no meio do caminho (e termina, no
 *   telefone), "Encerrar agora" abre os cinco desfechos do catálogo.
 *
 * A lista de cinco não é fixa em código: sai de `interaction_outcomes` pela coluna
 * `requires_answer`, então marcar um sexto desfecho como comercial não exige deploy.
 *
 * ===========================================================================
 * As duas coisas que moram ACIMA dos desfechos, e por quê
 * ===========================================================================
 *
 * 1. **"Não me procure mais" está sempre aqui**, em qualquer nó do roteiro e mesmo
 *    antes de o roteiro começar. O pedido de opt-out chega quando chega — no gancho,
 *    no meio da objeção, no "só um instante" —, e antes desta barra ele só existia se
 *    a conversa passasse pelo nó `fim_optout`. Quem fechasse por "Encerrar agora →
 *    Sem interesse" gravava a recusa e NÃO gravava o pedido: `consent_events` vazio,
 *    `do_not_contact` intacto, `suppression_list` sem a linha, e a próxima cadência
 *    ligando de novo para quem pediu para sair. Isso fura o guardrail central do
 *    produto, e por isso o controle não pode depender do caminho percorrido.
 *
 * 2. **"Com quem você falou?" é perguntado ANTES do commit.** RF-MET-01 só conta porta
 *    ABERTA quando o registro afirma decisor ou influenciador, e os cinco desfechos
 *    comerciais da ligação são todos `counts_as = 'aberta'` sem interlocutor afirmado
 *    no nome (`perguntaComQuem`). Perguntar depois, no recibo, era perguntar a quem já
 *    está ouvindo o próximo telefone tocar: a resposta não vinha, a tabulação gravava
 *    `nao_informado` e a meta de porta aberta subcontava quase tudo — reunião marcada
 *    inclusive. Aqui a resposta é dada DURANTE a conversa, no tempo morto em que o
 *    outro fala, e não custa toque nenhum a mais no fim.
 */
export function ChamadaTabulacao({
  catalogo,
  atendeu,
  gravando,
  desfechoDoFim,
  fimTecnico,
  comQuem,
  cobrandoComQuem,
  aoComQuem,
  optoutMarcado,
  aoPedirOptout,
  aoResultadoTecnico,
  aoDesfecho,
}: {
  catalogo: readonly DesfechoDeLigacao[];
  atendeu: boolean;
  gravando: boolean;
  /** O desfecho que o nó `fim` alcançado já carrega, quando a árvore chegou a um. */
  desfechoDoFim: DesfechoDeLigacao | null;
  /**
   * O nó `fim` que fecha pelo eixo TÉCNICO. Existe por um caso real e um só —
   * "aqui não é o [Empresa], você ligou errado": alguém atendeu, mas não houve
   * conversa comercial nenhuma, e forçar um desfecho comercial ali gravaria uma
   * recusa que ninguém fez.
   */
  fimTecnico: ResultadoTecnico | null;
  /** Quem estava do outro lado. `null` = ninguém respondeu ainda, e a barra pergunta. */
  comQuem: ComQuem | null;
  /** A pessoa tocou num desfecho que precisa da resposta e ela ainda não foi dada. */
  cobrandoComQuem: boolean;
  aoComQuem: (valor: ComQuem) => void;
  optoutMarcado: boolean;
  aoPedirOptout: () => void;
  aoResultadoTecnico: (resultado: ResultadoTecnico) => void;
  aoDesfecho: (desfecho: DesfechoDeLigacao) => void;
}) {
  const [abertos, setAbertos] = useState(false);
  const comerciais = desfechosDaChamada(catalogo, 'atendida_humano');

  return (
    <div
      className={cn(
        'sticky bottom-[calc(var(--altura-barra-inferior)+var(--area-segura-inferior))] z-10 md:bottom-0',
        'superficie-vidro sombra-base -mx-4 mt-6 flex flex-col gap-3 rounded-t-xl border-t border-hairline px-4 py-3 md:-mx-6 md:px-6',
      )}
    >
      {gravando ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Gravando o resultado…
        </p>
      ) : null}

      <LinhaDeOptout marcado={optoutMarcado} gravando={gravando} aoPedir={aoPedirOptout} />

      {atendeu ? (
        <ComQuemFalou
          valor={comQuem}
          cobrando={cobrandoComQuem}
          gravando={gravando}
          aoEscolher={aoComQuem}
        />
      ) : null}

      {!atendeu ? (
        <>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Não falei com ninguém
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {RESULTADOS_SEM_CONVERSA.map((resultado) => (
              <Button
                key={resultado}
                type="button"
                variant="outline"
                disabled={gravando}
                className="h-12 flex-1 text-base sm:min-w-40"
                onClick={() => aoResultadoTecnico(resultado)}
              >
                {ROTULOS_RESULTADO_TECNICO[resultado]}
              </Button>
            ))}
          </div>
        </>
      ) : fimTecnico ? (
        <Button
          type="button"
          disabled={gravando}
          className="h-14 w-full text-base"
          onClick={() => aoResultadoTecnico(fimTecnico)}
        >
          Registrar: {ROTULOS_RESULTADO_TECNICO[fimTecnico]}
        </Button>
      ) : desfechoDoFim ? (
        <>
          <Button
            type="button"
            disabled={gravando}
            className="h-14 w-full text-base"
            onClick={() => aoDesfecho(desfechoDoFim)}
          >
            Registrar: {desfechoDoFim.name}
          </Button>
          <button
            type="button"
            onClick={() => setAbertos((v) => !v)}
            className="self-center rounded-lg px-2 py-1 text-sm text-muted-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {abertos ? 'Esconder os outros resultados' : 'Foi outro resultado'}
          </button>
          {abertos ? (
            <ListaComercial
              desfechos={comerciais.filter((d) => d.id !== desfechoDoFim.id)}
              gravando={gravando}
              aoDesfecho={aoDesfecho}
            />
          ) : null}
        </>
      ) : (
        <>
          {abertos ? (
            <>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                O que ficou combinado
              </p>
              <ListaComercial desfechos={comerciais} gravando={gravando} aoDesfecho={aoDesfecho} />
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={gravando}
              className="h-12 w-full text-base"
              onClick={() => setAbertos(true)}
            >
              <PhoneOff aria-hidden="true" />
              Encerrar agora
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * O pedido de não ser mais procurado, alcançável de qualquer nó (RF-CON-18, e o
 * guardrail do CLAUDE.md: opt-out entra em `do_not_contact` e na `suppression_list`).
 *
 * Depois de marcado ele não sai da tela e não tem "desmarcar": o toque já passou por
 * um diálogo que conta a consequência inteira, e oferecer um desfazer aqui é convidar
 * a apagar um pedido que a pessoa fez em voz alta. O que a linha faz é lembrar que o
 * pedido só vira `consent_events` quando o resultado da ligação for gravado — a
 * atividade é a prova de que o pedido existiu, e é por isso que a ordem é essa.
 */
function LinhaDeOptout({
  marcado,
  gravando,
  aoPedir,
}: {
  marcado: boolean;
  gravando: boolean;
  aoPedir: () => void;
}) {
  if (marcado) {
    return (
      <p
        aria-live="polite"
        className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-texto"
      >
        <ShieldBan className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Ele pediu para não ser mais procurado. Grave o resultado abaixo para o pedido
          valer: é ele que entra na lista de supressão.
        </span>
      </p>
    );
  }

  return (
    <button
      type="button"
      disabled={gravando}
      onClick={aoPedir}
      className="toque flex min-h-11 items-center gap-2 self-start rounded-lg border border-hairline px-3 text-sm text-muted-foreground transition-colors outline-none hover:border-destructive/40 hover:text-destructive-texto focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
    >
      <ShieldBan className="size-4 shrink-0" aria-hidden="true" />
      Pediu para não ser mais procurado
    </button>
  );
}

/** As quatro respostas de "com quem você falou?", na ordem de quem abre porta. */
const RESPOSTAS_COM_QUEM: readonly ComQuem[] = [
  'decisor',
  'influenciador',
  'funcionario',
  'nao_informado',
];

/**
 * A pergunta que decide a métrica de porta aberta (RF-MET-01), feita enquanto a
 * conversa acontece. "Não sei dizer" é uma resposta legítima e está aqui: o que não
 * pode existir é o `nao_informado` SILENCIOSO, escolhido pela tela no lugar de quem
 * ligou.
 */
function ComQuemFalou({
  valor,
  cobrando,
  gravando,
  aoEscolher,
}: {
  valor: ComQuem | null;
  cobrando: boolean;
  gravando: boolean;
  aoEscolher: (valor: ComQuem) => void;
}) {
  return (
    <fieldset
      className={cn(
        'flex flex-col gap-2 rounded-lg px-2 py-2 transition-colors',
        cobrando && 'bg-destructive/10 ring-2 ring-destructive/40',
      )}
    >
      <legend className="sr-only">Com quem você falou</legend>
      <p
        aria-live="polite"
        className={cn(
          'text-xs font-medium tracking-wide uppercase',
          cobrando ? 'text-destructive-texto' : 'text-muted-foreground',
        )}
      >
        {cobrando ? 'Antes de gravar: com quem você falou?' : 'Com quem você falou?'}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {RESPOSTAS_COM_QUEM.map((opcao) => (
          <button
            key={opcao}
            type="button"
            disabled={gravando}
            aria-pressed={valor === opcao}
            onClick={() => aoEscolher(opcao)}
            className={cn(
              'toque inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border px-3 text-center text-sm leading-tight transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 sm:min-w-36 sm:flex-none',
              valor === opcao
                ? 'border-input bg-muted font-medium'
                : 'border-hairline text-muted-foreground',
            )}
          >
            {ROTULOS_COM_QUEM[opcao]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ListaComercial({
  desfechos,
  gravando,
  aoDesfecho,
}: {
  desfechos: readonly DesfechoDeLigacao[];
  gravando: boolean;
  aoDesfecho: (desfecho: DesfechoDeLigacao) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      {desfechos.map((desfecho) => (
        <Button
          key={desfecho.id}
          type="button"
          variant="outline"
          disabled={gravando}
          className="h-12 flex-1 text-base sm:min-w-40"
          onClick={() => aoDesfecho(desfecho)}
        >
          {desfecho.name}
        </Button>
      ))}
    </div>
  );
}
