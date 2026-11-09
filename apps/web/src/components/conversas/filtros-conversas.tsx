'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Archive, Search, SlidersHorizontal, X } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { CANAIS_DE_CHEGADA, ROTULO_DO_CANAL as ROTULO_DA_CHEGADA } from '@komune/schema';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { CANAL_NA_EMPRESA } from './canal-de-chegada-dados';
import { CONCLUIR_NA_EMPRESA } from './concluir-conversa';
import { BotaoRedondo } from './wpp';
import {
  CANAIS_EM_ORDEM,
  contarFiltros,
  JANELAS_EM_ORDEM,
  ROTULO_CANAL,
  ROTULO_JANELA,
  type FiltrosConversas,
} from './tipos';

/** Valor do "sem filtro" no Radix Select, que não aceita item com valor vazio. */
const TODOS = 'todos';

/**
 * O botão de filtros da lista, com os recortes numa janelinha (03/11/2026).
 *
 * Até o jeito do WhatsApp a barra de filtros ficava ACIMA das duas colunas, porque
 * três gatilhos de select não cabiam lado a lado na lista de 20rem. Agora a lista é
 * o cabeçalho de tudo (título, busca, abas) e os recortes moram atrás de um ícone,
 * como os filtros do WhatsApp: a janelinha tem a largura que eles precisam, e o
 * ponto verde no ícone avisa que a lista está recortada.
 */
export function BotaoDeFiltros({
  filtros,
  pessoas,
  aoMudar,
  aoLimpar,
}: {
  filtros: FiltrosConversas;
  pessoas: { id: string; nome: string }[];
  aoMudar: (parcial: Partial<FiltrosConversas>) => void;
  aoLimpar: () => void;
}) {
  const ativos = contarFiltros(filtros);
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <BotaoRedondo
          aria-label={ativos > 0 ? `Filtros (${ativos} ligados)` : 'Filtros'}
          className="relative"
        >
          <SlidersHorizontal aria-hidden="true" />
          {ativos > 0 ? (
            <span
              aria-hidden="true"
              className="absolute top-2 right-2 size-2 rounded-full bg-wpp-cita-barra"
            />
          ) : null}
        </BotaoRedondo>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 flex w-[19rem] flex-col gap-3 rounded-2xl border border-wpp-linha bg-popover p-3.5 text-popover-foreground shadow-wpp-pop outline-none"
        >
          <p className="text-xs font-medium text-wpp-suave">Filtrar a lista</p>
          <div className="flex flex-col gap-2">
            {/* Este filtro pergunta por QUALQUER laço da pessoa com o parceiro: dono do
                negócio, quem atende o fio de WhatsApp e quem registrou algum contato.
                É de propósito mais largo que o campo "Responsável" do cabeçalho da
                conversa, que mostra só o dono do negócio — quem filtra por si mesma
                está perguntando "o que é meu?", e uma conversa que ela mesma atende não
                pode ficar de fora da resposta. O gatilho só cabe com uma palavra, então
                são a lista e o `aria` que dizem os três laços. */}
            <Filtro
              rotulo="Responsável"
              todos="Qualquer pessoa do time"
              aria="Filtrar por responsável: dono do negócio, quem atende a conversa ou quem registrou contato"
              valor={filtros.responsavelId}
              opcoes={pessoas.map((p) => ({ valor: p.id, rotulo: p.nome }))}
              aoMudar={(v) => aoMudar({ responsavelId: v })}
            />
            <Filtro
              rotulo="Atendendo"
              todos="Qualquer atendente"
              aria="Filtrar por quem atende a conversa no WhatsApp"
              valor={filtros.atendenteId}
              opcoes={pessoas.map((p) => ({ valor: p.id, rotulo: p.nome }))}
              aoMudar={(v) => aoMudar({ atendenteId: v })}
            />
            {/* O CANAL DE CHEGADA (06/11/2026, só Imova): por onde a pessoa
                ficou sabendo da empresa. Outro nome que o "Canal" logo abaixo,
                que é o meio da interação (WhatsApp, ligação). */}
            {CANAL_NA_EMPRESA ? (
              <Filtro
                rotulo="Canal de chegada"
                todos="Qualquer canal de chegada"
                aria="Filtrar por canal de chegada: placa, anúncios, redes sociais, outros ou não identificado"
                valor={filtros.chegada}
                opcoes={CANAIS_DE_CHEGADA.map((c) => ({ valor: c, rotulo: ROTULO_DA_CHEGADA[c] }))}
                aoMudar={(v) => aoMudar({ chegada: v })}
              />
            ) : null}
            <Filtro
              rotulo="Canal"
              todos="Todos os canais"
              aria="Filtrar por canal da interação"
              valor={filtros.canal}
              opcoes={CANAIS_EM_ORDEM.map((c) => ({ valor: c, rotulo: ROTULO_CANAL[c] }))}
              aoMudar={(v) => aoMudar({ canal: v })}
            />
            <Filtro
              rotulo={ROTULO_JANELA.qualquer}
              todos="Qualquer tempo sem contato"
              aria="Filtrar por dias sem contato"
              valor={filtros.janela === 'qualquer' ? null : filtros.janela}
              opcoes={JANELAS_EM_ORDEM.map((j) => ({ valor: j, rotulo: ROTULO_JANELA[j] }))}
              aoMudar={(v) => aoMudar({ janela: v ?? 'qualquer' })}
            />
            {/* AS ARQUIVADAS (29/09/2026). Um botão que liga e desliga, e não um
                seletor com duas opções: a pergunta tem uma resposta só na
                esmagadora maioria dos dias ("não, some com elas"). Ele não entra no
                contador de filtros por não ser um recorte do trabalho — é a porta
                do arquivo. Onde o Concluir existe a porta é a linha "Concluídas",
                no alto da lista (03/11/2026), e este botão sai. */}
            {CONCLUIR_NA_EMPRESA ? null : (
              <Button
                variant={filtros.arquivadas ? 'secondary' : 'outline'}
                onClick={() => aoMudar({ arquivadas: !filtros.arquivadas })}
                aria-pressed={filtros.arquivadas}
                className="toque h-11 w-full justify-start md:h-9"
              >
                <Archive aria-hidden="true" />
                {filtros.arquivadas ? 'Mostrando as arquivadas' : 'Ver arquivadas'}
              </Button>
            )}
          </div>
          <div className="flex justify-between gap-2">
            <Button
              variant="outline"
              onClick={aoLimpar}
              disabled={ativos === 0 && filtros.q.trim() === ''}
              className="toque h-10 rounded-full px-4"
            >
              <X aria-hidden="true" />
              Limpar
            </Button>
            <PopoverPrimitive.Close asChild>
              <Button className="toque h-10 rounded-full px-5">Pronto</Button>
            </PopoverPrimitive.Close>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * A busca da lista, na pílula cinza do WhatsApp.
 *
 * A busca é local (a base inteira já está em memória, ver `dados.ts`), então não há
 * atraso de rede a esconder; mesmo assim ela mantém os 300 ms dos outros módulos, para
 * a lista não reordenar embaixo do dedo a cada tecla.
 */
export function BuscaDaLista({
  valor,
  aoMudar,
  className,
}: {
  valor: string;
  aoMudar: (q: string) => void;
  className?: string;
}) {
  const id = useId();
  const [texto, setTexto] = useState(valor);
  const ultimoEnviado = useRef(valor);

  useEffect(() => {
    if (valor !== ultimoEnviado.current) {
      ultimoEnviado.current = valor;
      setTexto(valor);
    }
  }, [valor]);

  useEffect(() => {
    if (texto === ultimoEnviado.current) return;
    const relogio = window.setTimeout(() => {
      ultimoEnviado.current = texto;
      aoMudar(texto);
    }, 300);
    return () => window.clearTimeout(relogio);
  }, [texto, aoMudar]);

  return (
    <div
      className={cn(
        'flex h-10 items-center gap-2.5 rounded-full bg-wpp-busca pr-1 pl-3.5 text-wpp-suave focus-within:ring-3 focus-within:ring-ring/40',
        className,
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <label htmlFor={id} className="sr-only">
        Buscar conversa
      </label>
      <input
        id={id}
        type="search"
        inputMode="search"
        autoComplete="off"
        enterKeyHint="search"
        placeholder="Buscar nome, bairro ou mensagem"
        aria-describedby={`${id}-dica`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        // 16px no celular: abaixo disso o Safari do iPhone dá zoom no campo.
        className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-wpp-suave md:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {texto ? (
        <BotaoRedondo tamanho="sm" onClick={() => setTexto('')} aria-label="Limpar a busca">
          <X aria-hidden="true" />
        </BotaoRedondo>
      ) : null}
      <p id={`${id}-dica`} className="sr-only">
        Nome, categoria, bairro ou o texto de uma mensagem.
      </p>
    </div>
  );
}

function Filtro<T extends string>({
  rotulo,
  todos,
  aria,
  valor,
  opcoes,
  aoMudar,
}: {
  /** O que o gatilho mostra quando nada está escolhido. */
  rotulo: string;
  /** A primeira opção da lista, que desliga o filtro. */
  todos: string;
  aria: string;
  valor: T | null;
  opcoes: { valor: T; rotulo: string }[];
  aoMudar: (v: T | null) => void;
}) {
  return (
    <Select
      value={valor === null ? TODOS : valor}
      onValueChange={(v) => aoMudar(v === TODOS ? null : (v as T))}
    >
      <SelectTrigger
        aria-label={aria}
        className={cn(
          'toque h-11 w-full md:h-9',
          valor !== null && 'border-foreground/40 font-medium',
        )}
      >
        <SelectValue placeholder={rotulo}>
          {valor === null ? rotulo : opcoes.find((o) => o.valor === valor)?.rotulo}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>{todos}</SelectItem>
        {opcoes.map((o) => (
          <SelectItem key={o.valor} value={o.valor}>
            {o.rotulo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
