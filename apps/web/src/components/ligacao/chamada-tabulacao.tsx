'use client';

import { useState } from 'react';
import { Loader2, PhoneOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

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
 */
export function ChamadaTabulacao({
  catalogo,
  atendeu,
  gravando,
  desfechoDoFim,
  fimTecnico,
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
