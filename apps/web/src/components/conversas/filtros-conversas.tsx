'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Archive, Flame, Search, SlidersHorizontal, X } from 'lucide-react';
import { CANAIS_DE_CHEGADA, ROTULO_DO_CANAL as ROTULO_DA_CHEGADA } from '@komune/schema';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FolhaFiltros, GrupoDeFiltro } from '@/components/ui/folha-filtros';

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

/**
 * O botão de filtros da lista e a folha "Filtros e ordem" (protótipo responsivo
 * da Imova, 24/11/2026).
 *
 * Até aqui os recortes moravam numa janelinha (03/11/2026) e a ORDEM (Recentes /
 * Mais interessados) era uma quinta faixa de botões de 24 px acima da lista. A
 * ordem e os recortes agora moram juntos numa folha que sobe de baixo no celular
 * e abre do lado do tablet para cima; o ícone mostra QUANTOS estão diferentes do
 * padrão. "Minhas · Meu setor · Todas" ficam fora da conta: estão à vista, na
 * faixa de cima da lista.
 *
 * `comRecortes` liga os recortes (só a aba Conversas os usa) e `comOrdem`, a
 * ordem por interesse (só onde a atitude do cliente existe: a Imova).
 */
export function BotaoDeFiltros({
  filtros,
  pessoas,
  aoMudar,
  aoLimpar,
  comRecortes = true,
  comOrdem = false,
}: {
  filtros: FiltrosConversas;
  pessoas: { id: string; nome: string }[];
  aoMudar: (parcial: Partial<FiltrosConversas>) => void;
  aoLimpar: () => void;
  comRecortes?: boolean;
  comOrdem?: boolean;
}) {
  const [aberta, setAberta] = useState(false);
  const porInteresse = comOrdem && filtros.ordem === 'interesse';
  const ligados = (comRecortes ? contarFiltros(filtros) : 0) + (porInteresse ? 1 : 0);
  // Na KOMUNE não há a ordem por interesse: lá a folha é só de filtros.
  const titulo = !comRecortes ? 'Ordem da lista' : comOrdem ? 'Filtros e ordem' : 'Filtros';
  return (
    <>
      <BotaoRedondo
        aria-label={ligados > 0 ? `${titulo} (${ligados} ligado${ligados > 1 ? 's' : ''})` : titulo}
        aria-haspopup="dialog"
        onClick={() => setAberta(true)}
        className="relative text-foreground md:size-10"
      >
        <SlidersHorizontal aria-hidden="true" />
        {ligados > 0 ? (
          <span
            aria-hidden="true"
            className="numerico absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-menta px-1 text-[10px] font-bold text-menta-tinta"
          >
            {ligados}
          </span>
        ) : null}
      </BotaoRedondo>
      <FolhaFiltros
        aberta={aberta}
        aoMudar={setAberta}
        titulo={titulo}
        rodape={
          <>
            {comRecortes ? (
              <Button
                variant="outline"
                onClick={aoLimpar}
                disabled={ligados === 0 && filtros.q.trim() === ''}
                className="toque h-11 md:h-10"
              >
                <X aria-hidden="true" />
                Limpar
              </Button>
            ) : null}
            <Button onClick={() => setAberta(false)} className="toque h-11 md:h-10">
              Pronto
            </Button>
          </>
        }
      >
        {comOrdem ? (
          <GrupoDeFiltro titulo="Ordem">
            <Chip ativo={!porInteresse} onClick={() => aoMudar({ ordem: 'recentes' })}>
              Recentes
            </Chip>
            <Chip ativo={porInteresse} onClick={() => aoMudar({ ordem: 'interesse' })}>
              <Flame className="size-3.5" aria-hidden="true" />
              Mais interessados
            </Chip>
          </GrupoDeFiltro>
        ) : null}
        {comRecortes ? (
          <>
            {/* Este filtro pergunta por QUALQUER laço da pessoa com o parceiro: dono do
                negócio, quem atende o fio de WhatsApp e quem registrou algum contato.
                É de propósito mais largo que o campo "Responsável" do cabeçalho da
                conversa, que mostra só o dono do negócio — quem filtra por si mesma
                está perguntando "o que é meu?", e uma conversa que ela mesma atende não
                pode ficar de fora da resposta. A dica diz os três laços. */}
            <Escolha
              titulo="Responsável"
              dica="Dono do negócio, quem atende a conversa ou quem registrou contato."
              todos="Qualquer pessoa"
              valor={filtros.responsavelId}
              opcoes={pessoas.map((p) => ({ valor: p.id, rotulo: p.nome }))}
              aoMudar={(v) => aoMudar({ responsavelId: v })}
            />
            <Escolha
              titulo="Atendendo"
              dica="Quem atende a conversa no WhatsApp."
              todos="Qualquer atendente"
              valor={filtros.atendenteId}
              opcoes={pessoas.map((p) => ({ valor: p.id, rotulo: p.nome }))}
              aoMudar={(v) => aoMudar({ atendenteId: v })}
            />
            {/* O CANAL DE CHEGADA (06/11/2026, só Imova): por onde a pessoa
                ficou sabendo da empresa. Outro nome que o "Canal" logo abaixo,
                que é o meio da interação (WhatsApp, ligação). */}
            {CANAL_NA_EMPRESA ? (
              <Escolha
                titulo="Canal de chegada"
                todos="Qualquer canal"
                valor={filtros.chegada}
                opcoes={CANAIS_DE_CHEGADA.map((c) => ({ valor: c, rotulo: ROTULO_DA_CHEGADA[c] }))}
                aoMudar={(v) => aoMudar({ chegada: v })}
              />
            ) : null}
            <Escolha
              titulo="Canal"
              todos="Todos os canais"
              valor={filtros.canal}
              opcoes={CANAIS_EM_ORDEM.map((c) => ({ valor: c, rotulo: ROTULO_CANAL[c] }))}
              aoMudar={(v) => aoMudar({ canal: v })}
            />
            <Escolha
              titulo={ROTULO_JANELA.qualquer}
              todos="Qualquer tempo"
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
              <GrupoDeFiltro titulo="Arquivadas">
                <Chip
                  ativo={filtros.arquivadas}
                  onClick={() => aoMudar({ arquivadas: !filtros.arquivadas })}
                >
                  <Archive className="size-4" aria-hidden="true" />
                  {filtros.arquivadas ? 'Mostrando as arquivadas' : 'Ver arquivadas'}
                </Chip>
              </GrupoDeFiltro>
            )}
          </>
        ) : null}
      </FolhaFiltros>
    </>
  );
}

/**
 * A busca da lista. Era a pílula cinza do WhatsApp; desde o protótipo responsivo
 * (24/11/2026) é o campo com contorno do resto do CRM, com 44 px no celular.
 *
 * A busca é local (a base inteira já está em memória, ver `dados.ts`), então não há
 * atraso de rede a esconder; mesmo assim ela mantém os 300 ms dos outros módulos, para
 * a lista não reordenar embaixo do dedo a cada tecla.
 */
export function BuscaDaLista({
  valor,
  aoMudar,
  className,
  placeholder = 'Buscar nome, bairro ou mensagem',
}: {
  valor: string;
  aoMudar: (q: string) => void;
  className?: string;
  /** A caixa Clientes (13/11/2026) busca por nome, telefone ou mensagem. */
  placeholder?: string;
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
        'flex h-11 items-center gap-2.5 rounded-xl border border-input bg-card pr-1 pl-3.5 text-wpp-suave focus-within:ring-3 focus-within:ring-ring/40 md:h-10',
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
        placeholder={placeholder}
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

/**
 * Uma escolha de um valor só, em fichas: "Qualquer…" desliga o recorte. Era um
 * seletor na janelinha; na folha as opções ficam à vista e o dedo alcança.
 */
function Escolha<T extends string>({
  titulo,
  dica,
  todos,
  valor,
  opcoes,
  aoMudar,
}: {
  titulo: string;
  dica?: string;
  /** A primeira ficha, que desliga o filtro. */
  todos: string;
  valor: T | null;
  opcoes: { valor: T; rotulo: string }[];
  aoMudar: (v: T | null) => void;
}) {
  return (
    <GrupoDeFiltro titulo={titulo}>
      {dica ? <p className="-mt-1 w-full text-xs text-muted-foreground">{dica}</p> : null}
      <Chip ativo={valor === null} onClick={() => aoMudar(null)}>
        {todos}
      </Chip>
      {opcoes.map((o) => (
        <Chip key={o.valor} ativo={valor === o.valor} onClick={() => aoMudar(o.valor)}>
          {o.rotulo}
        </Chip>
      ))}
    </GrupoDeFiltro>
  );
}
