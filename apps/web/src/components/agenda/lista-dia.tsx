'use client';

import { CalendarClock, Footprints, Route, Video } from 'lucide-react';

import { type DesfechoCatalogo } from '@/components/registro/tipos';

import { CartaoCompromisso } from './cartao-compromisso';
import { VazioDoDia } from './estados';
import {
  agruparPorBairro,
  blocosDoDia,
  diaDoInstante,
  horaEmNatal,
  rotuloDiaPorExtenso,
  type Compromisso,
  type Dia,
  type PedidoDeDesfecho,
} from './tipos';

/**
 * A lista de um dia, em quatro blocos.
 *
 * A ordem dos blocos é a ordem do expediente que o PRD desenha (RF-AGE-01):
 * apresentação online de manhã, visita à tarde. Só o primeiro bloco tem hora — os
 * outros entram pelo prazo da tarefa, e a tela diz isso em vez de fingir um horário
 * combinado que ninguém combinou.
 *
 * As visitas vêm agrupadas por bairro (RF-ROT-03), com o aviso de que a ordem
 * otimizada ainda não existe: sem geocodificação (RF-ROT-01, que não rodou), ordenar
 * por vizinho mais próximo seria inventar distância.
 */
export function ListaDoDia({
  dia,
  itens,
  catalogo,
  aoPedirDesfecho,
  proximo,
  semanaVazia,
  aoIrParaDia,
}: {
  dia: Dia;
  itens: readonly Compromisso[];
  catalogo: readonly DesfechoCatalogo[];
  aoPedirDesfecho: (pedido: PedidoDeDesfecho) => void;
  /** O próximo compromisso a partir deste dia, para o dia vazio ter saída. */
  proximo: Compromisso | null;
  /** `true` quando a semana inteira está sem compromisso aberto. */
  semanaVazia: boolean;
  aoIrParaDia: (dia: Dia) => void;
}) {
  const { marcados, visitas, aMarcar, concluidos } = blocosDoDia(itens);

  if (marcados.length + visitas.length + aMarcar.length + concluidos.length === 0) {
    return (
      <VazioDoDia
        frase={
          proximo
            ? `O próximo é ${proximo.organizacao}, ${rotuloDiaPorExtenso(diaDoInstante(proximo.quando))}${
                proximo.natureza === 'marcado' ? `, às ${horaEmNatal(proximo.quando)}` : ''
              }.`
            : semanaVazia
              ? 'Nada nesta semana. Um compromisso nasce do resultado de um contato: registre a ligação ou a visita e ele aparece aqui.'
              : 'Nada mais marcado daqui até o fim desta semana. Use as setas do cabeçalho para ver outra semana.'
        }
        acao={
          proximo
            ? {
                rotulo: 'Ir para esse dia',
                aoClicar: () => aoIrParaDia(diaDoInstante(proximo.quando)),
              }
            : null
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-7">
      {marcados.length > 0 ? (
        <Bloco
          icone={<Video className="size-4" aria-hidden="true" />}
          titulo="Com hora marcada"
          contagem={marcados.length}
          nota="Reuniões cuja data e hora foram combinadas com o parceiro e estão gravadas no funil."
        >
          <ul className="flex flex-col border-t border-hairline">
            {marcados.map((c) => (
              <CartaoCompromisso
                key={c.taskId}
                compromisso={c}
                catalogo={catalogo}
                aoPedirDesfecho={aoPedirDesfecho}
              />
            ))}
          </ul>
        </Bloco>
      ) : null}

      {visitas.length > 0 ? (
        <Bloco
          icone={<Footprints className="size-4" aria-hidden="true" />}
          titulo="Visitas do dia"
          contagem={visitas.length}
          nota="Sem hora combinada: são as portas a bater neste dia, agrupadas por bairro."
        >
          <div className="flex flex-col gap-4">
            {agruparPorBairro(visitas).map((grupo) => (
              <section key={grupo.bairro} className="flex flex-col">
                <h3 className="flex items-center gap-2 pb-1 text-xs font-medium text-muted-foreground">
                  <Route className="size-3.5" aria-hidden="true" />
                  {grupo.bairro}
                  <span className="numerico">{grupo.itens.length}</span>
                </h3>
                <ul className="flex flex-col border-t border-hairline">
                  {grupo.itens.map((c) => (
                    <CartaoCompromisso
                      key={c.taskId}
                      compromisso={c}
                      catalogo={catalogo}
                      aoPedirDesfecho={aoPedirDesfecho}
                    />
                  ))}
                </ul>
              </section>
            ))}
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              A ordem dentro do bairro é a do relógio. A rota otimizada (ordem por tempo de
              deslocamento e um link único do Maps com as paradas) chega depois: ela depende da
              geocodificação dos endereços, e hoje nenhuma organização da base tem coordenada nem
              endereço gravado. Por isso o botão do Maps busca pelo nome do parceiro e pelo bairro.
            </p>
          </div>
        </Bloco>
      ) : null}

      {aMarcar.length > 0 ? (
        <Bloco
          icone={<CalendarClock className="size-4" aria-hidden="true" />}
          titulo="Apresentações a marcar"
          contagem={aMarcar.length}
          nota="Ainda não têm hora combinada: o prazo caiu neste dia. Ligue ou mande mensagem para combinar a data, e o compromisso passa a valer."
        >
          <ul className="flex flex-col border-t border-hairline">
            {aMarcar.map((c) => (
              <CartaoCompromisso
                key={c.taskId}
                compromisso={c}
                catalogo={catalogo}
                aoPedirDesfecho={aoPedirDesfecho}
              />
            ))}
          </ul>
        </Bloco>
      ) : null}

      {concluidos.length > 0 ? (
        <Bloco
          titulo="Já registrados"
          contagem={concluidos.length}
          nota="O resultado já foi gravado e o funil já reagiu."
        >
          <ul className="flex flex-col border-t border-hairline">
            {concluidos.map((c) => (
              <CartaoCompromisso
                key={c.taskId}
                compromisso={c}
                catalogo={catalogo}
                aoPedirDesfecho={aoPedirDesfecho}
              />
            ))}
          </ul>
        </Bloco>
      ) : null}

      <p className="sr-only">Dia mostrado: {rotuloDiaPorExtenso(dia)}.</p>
    </div>
  );
}

function Bloco({
  icone,
  titulo,
  contagem,
  nota,
  children,
}: {
  icone?: React.ReactNode;
  titulo: string;
  contagem: number;
  nota: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-col gap-0.5">
        <h2 className="flex items-center gap-2 font-heading text-sm font-medium">
          {icone}
          {titulo}
          <span className="numerico text-muted-foreground">{contagem}</span>
        </h2>
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">{nota}</p>
      </header>
      {children}
    </section>
  );
}
