'use client';

import { useId } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import {
  faixaDoPeriodo,
  hojeEmNatal,
  periodoDe,
  periodoValido,
  PERIODOS_EM_ORDEM,
  ROTULO_PERIODO,
  type ChavePeriodo,
  type Periodo,
} from './periodo';
import { PAINEIS, type ChavePainel } from './tipos';

/**
 * O recorte da tela: qual leitura e de qual período.
 *
 * Os dois seletores são fila de botões, e não `select`: com sete leituras e cinco
 * períodos, um menu escondido custa dois toques a mais em toda troca, e esta é a
 * tela em que se troca de recorte o tempo inteiro. No celular a fila rola na
 * horizontal (a página nunca rola de lado) e todo botão tem 44px de altura.
 */
export function SeletorDePainel({
  painel,
  aoTrocar,
}: {
  painel: ChavePainel;
  aoTrocar: (chave: ChavePainel) => void;
}) {
  return (
    <nav
      aria-label="Leituras do relatório"
      // A máscara à direita diz que ainda há leitura fora da tela: sem ela, no
      // celular, "Fontes" e "Base" simplesmente não existem para quem não arrasta.
      className="-mx-1 overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)] md:[mask-image:none]"
    >
      <ul className="flex w-max gap-1.5">
        {PAINEIS.map((definicao) => {
          const ativo = definicao.chave === painel;
          return (
            <li key={definicao.chave}>
              <Button
                variant={ativo ? 'secondary' : 'ghost'}
                aria-pressed={ativo}
                onClick={() => aoTrocar(definicao.chave)}
                className={cn('toque h-11 px-3 md:h-8', ativo && 'font-semibold')}
              >
                {definicao.rotulo}
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function BarraDePeriodo({
  periodo,
  aoTrocar,
}: {
  periodo: Periodo;
  aoTrocar: (novo: Periodo) => void;
}) {
  const idDe = useId();
  const idAte = useId();
  const hoje = hojeEmNatal();
  const valido = periodoValido(periodo);

  return (
    <div className="flex flex-col gap-2">
      <div className="-mx-1 overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)] md:[mask-image:none]">
        <div className="flex w-max items-center gap-1.5" role="group" aria-label="Período">
          {PERIODOS_EM_ORDEM.map((chave: ChavePeriodo) => {
            const ativo = periodo.chave === chave;
            return (
              <Button
                key={chave}
                variant={ativo ? 'secondary' : 'ghost'}
                aria-pressed={ativo}
                onClick={() => aoTrocar(periodoDe(chave, hoje, periodo))}
                className={cn('toque h-11 px-3 md:h-8', ativo && 'font-semibold')}
              >
                {ROTULO_PERIODO[chave]}
              </Button>
            );
          })}
        </div>
      </div>

      {periodo.chave === 'personalizado' ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={idDe} className="text-xs text-muted-foreground">
              De
            </label>
            <Input
              id={idDe}
              type="date"
              value={periodo.de}
              max={periodo.ate}
              onChange={(evento) => aoTrocar({ ...periodo, de: evento.target.value })}
              className="numerico h-11 w-40 md:h-9"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={idAte} className="text-xs text-muted-foreground">
              Até
            </label>
            <Input
              id={idAte}
              type="date"
              value={periodo.ate}
              min={periodo.de}
              max={hoje}
              onChange={(evento) => aoTrocar({ ...periodo, ate: evento.target.value })}
              className="numerico h-11 w-40 md:h-9"
            />
          </div>
          {!valido ? (
            <p className="text-xs text-muted-foreground">
              A data inicial precisa vir antes da final. Enquanto isso, o relatório continua
              mostrando o último período válido.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Período: <span className="numerico">{faixaDoPeriodo(periodo)}</span>, no fuso de Natal.
        Todo número desta tela obedece a ele, menos onde a tabela avisar o contrário.
      </p>
    </div>
  );
}
