'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FilterX } from 'lucide-react';

import { type Sessao } from '@/lib/auth/session';
import { Badge } from '@/components/ui/badge';
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

import { ChipsDeSecao } from './abas';
import {
  carregarAuditoria,
  carregarPessoas,
  carregarSemContato,
  carregarSupressao,
  carregarTelefonesRevelados,
  SemAcessoAoRegistro,
} from './dados';
import {
  Aviso,
  CabecalhoDeSecao,
  Contagem,
  ErroDoPainel,
  EsqueletoLista,
  ListaAdmin,
  PainelRestrito,
  Vazio,
  type ColunaAdmin,
} from './estados';
import { ExportarParceiro } from './exportar-parceiro';
import {
  formatarDataHora,
  hashCurto,
  mensagemDoErro,
  rotuloDaAcao,
  rotuloDaTabela,
  rotuloDoAcesso,
  rotuloDoCampo,
  rotuloDoCanal,
  rotuloDoMotivoSuprimido,
  rotuloDoTipoSuprimido,
} from './formatos';
import {
  FILTRO_VAZIO,
  POR_PAGINA,
  ROTULO_LGPD,
  SECOES_LGPD,
  type FiltroRegistro,
  type LinhaAuditoria,
  type LinhaSupressao,
  type LinhaTelefoneRevelado,
  type ParceiroSemContato,
  type SecaoLgpd,
} from './tipos';

/**
 * LGPD (RF-ADM-03 e RF-ADM-04): os quatro registros que provam como a base é tratada.
 *
 * A ordem é a das perguntas que chegam de fora para dentro. "Quem pediu para parar" é
 * a que a operação faz todo dia; "quem viu telefone" e "o que mudou" são as que um
 * pedido de titular, uma auditoria interna ou um incidente fazem; a exportação é a
 * resposta que sai daqui para fora.
 *
 * Nenhuma das quatro revela telefone. A lista de supressão guarda só o HASH do número
 * (é o desenho do banco, não uma limitação da tela), o registro de acesso mostra o
 * parceiro e não o número, e a auditoria omite o valor dos campos sensíveis, mesmo
 * tendo a linha inteira na mão. Para ver um telefone existe um caminho só, o da ficha
 * do parceiro, e ele fica registrado (RF-BAS-14).
 */
export function PainelLgpd({
  sessao,
  secao,
  aoTrocarSecao,
}: {
  sessao: Sessao;
  secao: SecaoLgpd;
  aoTrocarSecao: (secao: SecaoLgpd) => void;
}) {
  const pessoas = useQuery({ queryKey: ['admin', 'pessoas'], queryFn: carregarPessoas });
  const nomes = new Map((pessoas.data?.pessoas ?? []).map((p) => [p.id, p.nome]));

  return (
    <div className="flex flex-col gap-5">
      <ChipsDeSecao
        rotulo="Registros de LGPD"
        ativo={secao}
        aoTrocar={aoTrocarSecao}
        itens={SECOES_LGPD.map((id) => ({ id, rotulo: ROTULO_LGPD[id] }))}
      />

      {/* `nomes` é lido na renderização, e não passado para dentro da consulta: assim o
          nome aparece assim que o diretório do time chega, sem depender da ordem em que
          as duas consultas terminam. */}
      {secao === 'supressao' ? <SecaoSupressao nomes={nomes} /> : null}
      {secao === 'telefones' ? (
        <SecaoTelefones nomes={nomes} pessoas={pessoas.data?.pessoas ?? []} />
      ) : null}
      {secao === 'auditoria' ? (
        <SecaoAuditoria
          nomes={nomes}
          pessoas={pessoas.data?.pessoas ?? []}
          ehAdmin={sessao.papel === 'admin'}
        />
      ) : null}
      {secao === 'exportar' ? <ExportarParceiro quemExportou={sessao.nome} /> : null}
    </div>
  );
}

/**
 * Id do registro quando não há nome para mostrar. Corta o UUID em oito dígitos (o
 * bastante para casar com o banco) e só põe reticências quando cortou de verdade —
 * um id de catálogo é um inteiro curto e aparecia como “199…”, sugerindo que
 * faltava alguma coisa.
 */
function idCurto(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** Nome de uma pessoa do time pelo id, ou `null` quando o perfil não existe mais. */
function nomeDe(nomes: Map<string, string>, id: string | null): string | null {
  if (!id) return null;
  return nomes.get(id) ?? null;
}

// ---------------------------------------------------------------------------

function SecaoSupressao({ nomes }: { nomes: Map<string, string> }) {
  const supressao = useQuery({
    queryKey: ['admin', 'supressao'],
    queryFn: carregarSupressao,
  });
  const semContato = useQuery({
    queryKey: ['admin', 'sem-contato'],
    queryFn: carregarSemContato,
  });

  const colunas: ColunaAdmin<LinhaSupressao>[] = [
    {
      id: 'parceiro',
      rotulo: 'Quem pediu',
      principal: true,
      largura: 'w-[clamp(11rem,22vw,18rem)]',
      celula: (l) => (
        <span className="font-medium">
          {l.parceiro ?? <span className="text-muted-foreground">Sem parceiro vinculado</span>}
        </span>
      ),
    },
    {
      id: 'tipo',
      rotulo: 'O que foi suprimido',
      largura: 'w-40',
      celula: (l) => rotuloDoTipoSuprimido(l.tipo),
    },
    {
      id: 'motivo',
      rotulo: 'Motivo',
      largura: 'w-44',
      celula: (l) => (
        <span className="text-muted-foreground">{rotuloDoMotivoSuprimido(l.motivo)}</span>
      ),
    },
    {
      id: 'canal',
      rotulo: 'Canal',
      largura: 'w-32',
      celula: (l) => <span className="text-muted-foreground">{rotuloDoCanal(l.canal)}</span>,
    },
    {
      id: 'quando',
      rotulo: 'Quando',
      largura: 'w-44',
      celula: (l) => <span className="numerico">{formatarDataHora(l.quando)}</span>,
    },
    {
      id: 'quem',
      rotulo: 'Registrado por',
      largura: 'w-40',
      soNoDesktop: true,
      celula: (l) => (
        <span className="text-muted-foreground">{nomeDe(nomes, l.quemId) ?? 'Sistema'}</span>
      ),
    },
    {
      id: 'hash',
      rotulo: 'Hash',
      largura: 'w-36',
      soNoDesktop: true,
      celula: (l) => (
        <span className="numerico text-xs text-muted-foreground">{hashCurto(l.hash)}…</span>
      ),
    },
  ];

  const colunasSemContato: ColunaAdmin<ParceiroSemContato>[] = [
    {
      id: 'nome',
      rotulo: 'Parceiro',
      principal: true,
      largura: 'w-[clamp(12rem,26vw,22rem)]',
      celula: (p) => <span className="font-medium">{p.nome}</span>,
    },
    {
      id: 'onde',
      rotulo: 'Onde fica',
      largura: 'w-64',
      celula: (p) => (
        <span className="text-muted-foreground">
          {[p.bairro, p.cidade].filter(Boolean).join(', ') || 'Sem endereço registrado'}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <CabecalhoDeSecao
          titulo="Lista de supressão"
          contagem={
            supressao.data ? <Contagem n={supressao.data.length} rotulo="suprimidos" /> : undefined
          }
          descricao="Quem pediu para parar de receber contato. Toda fila de envio e toda ingestão do Radar consultam esta lista antes de tocar em qualquer número."
        />
        <Aviso titulo="Por que aqui não tem telefone">
          <p>
            A lista guarda o <strong>hash</strong> do número, nunca o número: é o que permite
            reconhecer um contato suprimido sem manter o dado de quem pediu para sumir (PRD §10.6,
            “apagar dados, manter hash e data”). O nome do parceiro aparece quando o pedido veio de
            uma conversa registrada no CRM.
          </p>
        </Aviso>

        {supressao.isPending ? (
          <EsqueletoLista linhas={4} colunas={5} />
        ) : supressao.error instanceof SemAcessoAoRegistro ? (
          <PainelRestrito registro="A lista de supressão" />
        ) : supressao.isError ? (
          <ErroDoPainel
            causa={mensagemDoErro(supressao.error)}
            aoTentar={() => void supressao.refetch()}
          />
        ) : supressao.data.length === 0 ? (
          <Vazio
            titulo="Ninguém pediu para parar"
            texto="Nenhum opt-out registrado até agora. Quando alguém responder SAIR, PARAR ou equivalente, a linha aparece aqui no mesmo minuto."
          />
        ) : (
          <ListaAdmin
            rotuloDaLista="Contatos suprimidos"
            colunas={colunas}
            linhas={supressao.data}
            chave={(l) => l.id}
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <CabecalhoDeSecao
          titulo="Parceiros marcados “não contatar”"
          contagem={
            semContato.data ? <Contagem n={semContato.data.length} rotulo="parceiros" /> : undefined
          }
          descricao="A mesma decisão vista pelo lado da ficha: estes parceiros não entram em fila de contato nenhuma, em nenhum modo."
        />
        {semContato.isPending ? (
          <EsqueletoLista linhas={3} colunas={2} />
        ) : semContato.isError ? (
          <ErroDoPainel
            causa={mensagemDoErro(semContato.error)}
            aoTentar={() => void semContato.refetch()}
          />
        ) : semContato.data.length === 0 ? (
          <Vazio
            titulo="Nenhum parceiro marcado"
            texto="Nenhuma ficha da base está com “não contatar” ligado."
          />
        ) : (
          <ListaAdmin
            rotuloDaLista="Parceiros marcados como não contatar"
            colunas={colunasSemContato}
            linhas={semContato.data}
            chave={(p) => p.id}
          />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Filtro comum aos dois registros: uma pessoa e um dia. */
function FiltroDeRegistro({
  filtro,
  aoMudar,
  pessoas,
}: {
  filtro: FiltroRegistro;
  aoMudar: (filtro: FiltroRegistro) => void;
  pessoas: { id: string; nome: string }[];
}) {
  const temFiltro = filtro.pessoaId !== null || filtro.dia !== null;

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end">
      <div className="space-y-1.5 md:w-56">
        <Label htmlFor="filtro-pessoa" className="text-xs">
          Pessoa
        </Label>
        <Select
          value={filtro.pessoaId ?? 'todas'}
          onValueChange={(valor) =>
            aoMudar({ ...filtro, pessoaId: valor === 'todas' ? null : valor })
          }
        >
          <SelectTrigger id="filtro-pessoa" className="toque h-11 w-full md:h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todo mundo</SelectItem>
            {pessoas.map((pessoa) => (
              <SelectItem key={pessoa.id} value={pessoa.id}>
                {pessoa.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5 md:w-44">
        <Label htmlFor="filtro-dia" className="text-xs">
          Dia
        </Label>
        <Input
          id="filtro-dia"
          type="date"
          value={filtro.dia ?? ''}
          onChange={(evento) => aoMudar({ ...filtro, dia: evento.target.value || null })}
          className="numerico h-11 md:h-8"
        />
      </div>

      {temFiltro ? (
        <Button
          variant="outline"
          onClick={() => aoMudar(FILTRO_VAZIO)}
          className="toque h-11 md:h-8"
        >
          <FilterX aria-hidden="true" />
          Limpar
        </Button>
      ) : null}
    </div>
  );
}

function SecaoTelefones({
  nomes,
  pessoas,
}: {
  nomes: Map<string, string>;
  pessoas: { id: string; nome: string }[];
}) {
  const [filtro, setFiltro] = useState<FiltroRegistro>(FILTRO_VAZIO);

  const consulta = useQuery({
    queryKey: ['admin', 'telefones', filtro.pessoaId, filtro.dia],
    queryFn: () => carregarTelefonesRevelados(filtro),
  });

  const colunas: ColunaAdmin<LinhaTelefoneRevelado>[] = [
    {
      id: 'quem',
      rotulo: 'Quem viu',
      principal: true,
      largura: 'w-56',
      celula: (l) => (
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {nomeDe(nomes, l.quemId) ?? 'Pessoa que saiu do CRM'}
          {l.papel ? (
            <Badge variant="pilula" className="h-5 px-2 text-[11px] font-normal">
              {l.papel}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'acao',
      rotulo: 'O que fez',
      largura: 'w-80',
      celula: (l) => <span className="text-muted-foreground">{rotuloDoAcesso(l.acao)}</span>,
    },
    {
      id: 'parceiro',
      rotulo: 'De quem',
      largura: 'w-64',
      celula: (l) => l.parceiro ?? <span className="text-muted-foreground">Não identificado</span>,
    },
    {
      id: 'quando',
      rotulo: 'Quando',
      largura: 'w-44',
      celula: (l) => <span className="numerico">{formatarDataHora(l.quando)}</span>,
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <CabecalhoDeSecao
        titulo="Telefones revelados"
        contagem={
          consulta.data ? <Contagem n={consulta.data.length} rotulo="revelações" /> : undefined
        }
        descricao="Cada vez que alguém tocou em “Revelar” na ficha de um parceiro. É este registro que responde “quem andou vendo o número de quem” num incidente."
      />
      <FiltroDeRegistro filtro={filtro} aoMudar={setFiltro} pessoas={pessoas} />

      {consulta.isPending ? (
        <EsqueletoLista linhas={5} colunas={4} />
      ) : consulta.error instanceof SemAcessoAoRegistro ? (
        <PainelRestrito registro="O registro de acesso a telefone" />
      ) : consulta.isError ? (
        <ErroDoPainel
          causa={mensagemDoErro(consulta.error)}
          aoTentar={() => void consulta.refetch()}
        />
      ) : consulta.data.length === 0 ? (
        <Vazio
          titulo="Nenhuma revelação nesse recorte"
          texto={
            filtro.pessoaId || filtro.dia
              ? 'Ninguém revelou telefone com esses filtros. Tire o dia ou a pessoa para ver o resto.'
              : 'Ninguém revelou telefone ainda. Admin e gestor leem o número direto da base, sem passar por aqui; SDR e embaixador precisam do botão, e é o botão que escreve esta lista.'
          }
        >
          {filtro.pessoaId || filtro.dia ? (
            <Button
              variant="outline"
              onClick={() => setFiltro(FILTRO_VAZIO)}
              className="toque h-11 md:h-9"
            >
              <FilterX aria-hidden="true" />
              Limpar filtros
            </Button>
          ) : null}
        </Vazio>
      ) : (
        <ListaAdmin
          rotuloDaLista="Revelações de telefone registradas"
          colunas={colunas}
          linhas={consulta.data}
          chave={(l) => l.id}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function SecaoAuditoria({
  nomes,
  pessoas,
  ehAdmin,
}: {
  nomes: Map<string, string>;
  pessoas: { id: string; nome: string }[];
  ehAdmin: boolean;
}) {
  const [filtro, setFiltro] = useState<FiltroRegistro>(FILTRO_VAZIO);
  const [pagina, setPagina] = useState(1);

  const consulta = useQuery({
    queryKey: ['admin', 'auditoria', filtro.pessoaId, filtro.dia, pagina],
    queryFn: () => carregarAuditoria(filtro, pagina),
    enabled: ehAdmin,
  });

  const colunas: ColunaAdmin<LinhaAuditoria>[] = [
    {
      id: 'quando',
      rotulo: 'Quando',
      principal: true,
      largura: 'w-40',
      celula: (l) => <span className="numerico font-medium">{formatarDataHora(l.quando)}</span>,
    },
    {
      id: 'quem',
      rotulo: 'Quem',
      largura: 'w-40',
      celula: (l) =>
        nomeDe(nomes, l.quemId) ?? <span className="text-muted-foreground">Sistema</span>,
    },
    {
      id: 'oque',
      rotulo: 'O que fez',
      largura: 'w-56',
      celula: (l) => (
        <span>
          {rotuloDaAcao(l.acao)} <span className="lowercase">{rotuloDaTabela(l.tabela)}</span>
        </span>
      ),
    },
    {
      id: 'registro',
      rotulo: 'Em qual registro',
      largura: 'w-56',
      celula: (l) =>
        (l.tabela === 'profiles' ? nomeDe(nomes, l.registroId) : l.registro) ?? (
          <span className="numerico text-xs text-muted-foreground">{idCurto(l.registroId)}</span>
        ),
    },
    {
      id: 'mudou',
      rotulo: 'O que mudou',
      largura: 'w-80',
      celula: (l) => <Mudancas linha={l} />,
    },
  ];

  if (!ehAdmin) {
    return (
      <section className="flex flex-col gap-3">
        <CabecalhoDeSecao
          titulo="Auditoria"
          descricao="Quem alterou o quê, em qual registro e quando (RF-ADM-03)."
        />
        <PainelRestrito registro="O registro de auditoria" />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <CabecalhoDeSecao
        titulo="Auditoria"
        descricao="Toda escrita nas tabelas sensíveis, gravada por gatilho no banco. Ninguém edita e ninguém apaga: é registro, não histórico de interface."
      />
      <Aviso titulo="Valor de campo sensível não aparece aqui">
        <p>
          A auditoria diz <strong>que</strong> o telefone, o e-mail ou o CNPJ mudou, e nunca{' '}
          <strong>qual</strong> era o valor. Mostrar o antes e o depois faria desta tela um atalho
          para ler número sem passar pela revelação registrada da ficha. Os campos ocultos vêm
          marcados como “sem exibir o valor”.
        </p>
      </Aviso>

      <FiltroDeRegistro
        filtro={filtro}
        aoMudar={(novo) => {
          setFiltro(novo);
          setPagina(1);
        }}
        pessoas={pessoas}
      />

      {consulta.isPending ? (
        <EsqueletoLista linhas={8} colunas={5} />
      ) : consulta.error instanceof SemAcessoAoRegistro ? (
        <PainelRestrito registro="O registro de auditoria" />
      ) : consulta.isError ? (
        <ErroDoPainel
          causa={mensagemDoErro(consulta.error)}
          aoTentar={() => void consulta.refetch()}
        />
      ) : consulta.data.linhas.length === 0 ? (
        <Vazio
          titulo="Nada registrado nesse recorte"
          texto="Ninguém mexeu em nada com esses filtros. Tire o dia ou a pessoa para ver o resto."
        >
          <Button
            variant="outline"
            onClick={() => {
              setFiltro(FILTRO_VAZIO);
              setPagina(1);
            }}
            className="toque h-11 md:h-9"
          >
            <FilterX aria-hidden="true" />
            Limpar filtros
          </Button>
        </Vazio>
      ) : (
        <>
          <ListaAdmin
            rotuloDaLista="Registro de auditoria"
            colunas={colunas}
            linhas={consulta.data.linhas}
            chave={(l) => l.id}
          />
          <nav
            aria-label="Paginação da auditoria"
            className="flex items-center justify-between gap-3 pt-1"
          >
            <p className="text-sm text-muted-foreground">
              Página <span className="numerico">{pagina}</span> ·{' '}
              <span className="numerico">{POR_PAGINA}</span> por página
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                disabled={pagina <= 1}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                className="toque h-11 md:h-8"
              >
                <ChevronLeft aria-hidden="true" />
                Anterior
              </Button>
              <Button
                variant="outline"
                disabled={!consulta.data.temMais}
                onClick={() => setPagina((p) => p + 1)}
                className="toque h-11 md:h-8"
              >
                Próxima
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </nav>
        </>
      )}
    </section>
  );
}

/** As mudanças de uma linha da auditoria, com valor só onde é seguro mostrar. */
function Mudancas({ linha }: { linha: LinhaAuditoria }) {
  if (linha.acao === 'INSERT') return <span className="text-muted-foreground">Registro novo</span>;
  if (linha.acao === 'DELETE')
    return <span className="text-muted-foreground">Registro apagado</span>;
  if (linha.mudancas.length === 0) {
    return <span className="text-muted-foreground">Sem mudança de conteúdo</span>;
  }

  const visiveis = linha.mudancas.slice(0, 3);
  const resto = linha.mudancas.length - visiveis.length;

  return (
    <ul className="space-y-0.5">
      {visiveis.map((mudanca) => (
        <li key={mudanca.campo} className="text-xs leading-relaxed">
          <span className="text-foreground">{rotuloDoCampo(mudanca.campo)}</span>
          {mudanca.oculto ? (
            <span className="text-muted-foreground"> mudou, sem exibir o valor</span>
          ) : (
            <span className="text-muted-foreground">
              : {mudanca.de ?? 'vazio'} → {mudanca.para ?? 'vazio'}
            </span>
          )}
        </li>
      ))}
      {resto > 0 ? (
        <li className="text-xs text-muted-foreground">
          e mais <span className="numerico">{resto}</span> {resto === 1 ? 'campo' : 'campos'}
        </li>
      ) : null}
    </ul>
  );
}
