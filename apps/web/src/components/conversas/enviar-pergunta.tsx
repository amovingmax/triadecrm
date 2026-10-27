'use client';

import { useState } from 'react';
import { List, MapPin, MousePointerClick, Plus, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { LIMITES_DA_PERGUNTA as L, montarPergunta } from './conteudo';
import {
  CAMPO,
  Campo,
  JanelaDoAnexo,
  useEnvioDoAnexo,
  type DestinoDoAnexo,
} from './janela-do-anexo';

/**
 * A pergunta com opções (27/10/2026): botões (até 3), lista (até 10) e o
 * pedido de localização. O contato responde com um toque, e a resposta volta
 * como "Escolheu …" no fio. Os limites são os da Meta, conferidos aqui e no
 * banco (`app.messages_forma`).
 */
export type ModoDaPergunta = 'botoes' | 'lista' | 'pedir_localizacao';

const TITULO: Record<ModoDaPergunta, string> = {
  botoes: 'Pergunta com botões',
  lista: 'Lista de opções',
  pedir_localizacao: 'Pedir localização',
};

export function EnviarPergunta({
  modo,
  aberto,
  aoFechar,
  destino,
}: {
  modo: ModoDaPergunta;
  aberto: boolean;
  aoFechar: () => void;
  destino: DestinoDoAnexo;
}) {
  return (
    <JanelaDoAnexo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={TITULO[modo]}
      descricao={
        modo === 'pedir_localizacao'
          ? 'O contato recebe um botão que manda a localização dele.'
          : 'O contato responde com um toque.'
      }
    >
      <Formulario modo={modo} destino={destino} aoFechar={aoFechar} />
    </JanelaDoAnexo>
  );
}

function Contador({ valor, teto }: { valor: string; teto: number }) {
  return (
    <span className={cn('numerico text-[11px]', valor.length > teto && 'text-destructive-texto')}>
      {valor.length}/{teto}
    </span>
  );
}

function Formulario({
  modo,
  destino,
  aoFechar,
}: {
  modo: ModoDaPergunta;
  destino: DestinoDoAnexo;
  aoFechar: () => void;
}) {
  const [pergunta, setPergunta] = useState(
    modo === 'pedir_localizacao' ? 'Pode me mandar a sua localização?' : '',
  );
  const [botoes, setBotoes] = useState<string[]>(['', '']);
  const [botao, setBotao] = useState('Ver opções');
  const [itens, setItens] = useState<{ titulo: string; descricao: string }[]>([
    { titulo: '', descricao: '' },
    { titulo: '', descricao: '' },
  ]);
  const [tentou, setTentou] = useState(false);
  const { enviar, indo } = useEnvioDoAnexo({
    ...destino,
    aoEnviar: () => {
      destino.aoEnviar();
      aoFechar();
    },
  });

  const montada = montarPergunta(
    modo === 'botoes'
      ? { modo, pergunta, botoes }
      : modo === 'lista'
        ? { modo, pergunta, botao, itens }
        : { modo, pergunta },
  );

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTentou(true);
        if (!montada.ok || indo) return;
        void enviar({ tipo: 'interactive', corpo: montada.corpo, conteudo: montada.conteudo });
      }}
    >
      <Campo rotulo="Pergunta" dica={<Contador valor={pergunta} teto={L.pergunta} />}>
        <textarea
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          rows={3}
          placeholder={modo === 'lista' ? 'Que tipo de evento você faz?' : 'Podemos falar amanhã?'}
          className={cn(CAMPO, 'h-auto py-2')}
        />
      </Campo>

      {modo === 'botoes' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1.5 text-sm font-medium">Botões</legend>
          {botoes.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={b}
                onChange={(e) => setBotoes((t) => t.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={['Sim', 'Agora não', 'Me liga'][i]}
                aria-label={`Botão ${i + 1}`}
                className={CAMPO}
              />
              <Contador valor={b} teto={L.botao} />
              {botoes.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="toque size-9 shrink-0"
                  onClick={() => setBotoes((t) => t.filter((_, j) => j !== i))}
                  aria-label={`Tirar o botão ${i + 1}`}
                >
                  <X aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ))}
          {botoes.length < L.botoes ? (
            <Button
              type="button"
              variant="ghost"
              className="toque h-10 w-fit md:h-8"
              onClick={() => setBotoes((t) => [...t, ''])}
            >
              <Plus aria-hidden="true" />
              Mais um botão
            </Button>
          ) : null}
        </fieldset>
      ) : null}

      {modo === 'lista' ? (
        <>
          <Campo rotulo="Botão que abre a lista" dica={<Contador valor={botao} teto={L.botao} />}>
            <input value={botao} onChange={(e) => setBotao(e.target.value)} className={CAMPO} />
          </Campo>
          <fieldset className="flex flex-col gap-2">
            <legend className="pb-1.5 text-sm font-medium">Opções</legend>
            {itens.map((item, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-hairline p-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <input
                    value={item.titulo}
                    onChange={(e) =>
                      setItens((t) =>
                        t.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)),
                      )
                    }
                    placeholder={`Opção ${i + 1}`}
                    aria-label={`Título da opção ${i + 1}`}
                    className={CAMPO}
                  />
                  <input
                    value={item.descricao}
                    onChange={(e) =>
                      setItens((t) =>
                        t.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)),
                      )
                    }
                    placeholder="Descrição (se quiser)"
                    aria-label={`Descrição da opção ${i + 1}`}
                    className={cn(CAMPO, 'h-10 text-sm md:h-8')}
                  />
                </div>
                {itens.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="toque size-9 shrink-0"
                    onClick={() => setItens((t) => t.filter((_, j) => j !== i))}
                    aria-label={`Tirar a opção ${i + 1}`}
                  >
                    <X aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            ))}
            {itens.length < L.itens ? (
              <Button
                type="button"
                variant="ghost"
                className="toque h-10 w-fit md:h-8"
                onClick={() => setItens((t) => [...t, { titulo: '', descricao: '' }])}
              >
                <Plus aria-hidden="true" />
                Mais uma opção
              </Button>
            ) : null}
          </fieldset>
        </>
      ) : null}

      {tentou && !montada.ok ? (
        <p className="text-xs text-destructive-texto">{montada.frase}</p>
      ) : null}

      <Button type="submit" disabled={indo} className="toque h-11 md:h-9">
        {modo === 'lista' ? (
          <List aria-hidden="true" />
        ) : modo === 'botoes' ? (
          <MousePointerClick aria-hidden="true" />
        ) : (
          <MapPin aria-hidden="true" />
        )}
        {indo ? 'Mandando...' : 'Mandar'}
      </Button>
    </form>
  );
}
