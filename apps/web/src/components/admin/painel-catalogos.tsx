'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { DialogoConfirmar } from './confirmar';
import {
  adicionarFeriado,
  carregarCatalogos,
  removerFeriado,
  trocarAtivo,
  trocarGrandeNatal,
} from './dados';
import {
  Aviso,
  CabecalhoDeSecao,
  Contagem,
  ErroDoPainel,
  EsqueletoLista,
  ListaAdmin,
  Vazio,
  type ColunaAdmin,
} from './estados';
import {
  diaDaSemana,
  formatarDataPura,
  formatarNumero,
  hojeEmNatal,
  mensagemDoErro,
  rotuloDaCategoriaDeModelo,
  rotuloDaPorta,
  rotuloDaPrioridade,
  rotuloDaSuperficie,
  rotuloDaTemperatura,
  rotuloDoCanal,
  rotuloDoEscopo,
  rotuloDoGrupo,
  rotuloDoSegmento,
  rotuloDoSilencio,
} from './formatos';
import {
  ROTULO_CATALOGO,
  SECOES_CATALOGO,
  type Categoria,
  type Cidade,
  type DadosCatalogos,
  type Desfecho,
  type Feriado,
  type ModeloDeMensagem,
  type MotivoDePerda,
  type SecaoCatalogo,
} from './tipos';

/**
 * Catálogos (RF-ADM-02): as listas que o CRM usa para classificar, agendar e decidir.
 *
 * A tela é de leitura com edição leve, e a distinção importa. Categorias, cidades,
 * feriados e motivos de perda são rótulos: ligar e desligar um deles muda o que
 * aparece em filtro e formulário, e nada mais. Os desfechos de interação são outra
 * coisa — cada um carrega uma CONSEQUÊNCIA AUTOMÁTICA (move etapa, muda temperatura,
 * cria a próxima ação, abre janela de silêncio), então a linha mostra a consequência
 * inteira antes do clique e a confirmação repete o que vai deixar de acontecer.
 *
 * Editar nome, slug e as consequências em si continua fora: isso é migração, não
 * clique de tela. O que dá para fazer aqui é ligar, desligar e, nos feriados,
 * acrescentar e remover — que é o que a operação precisa entre um D e outro.
 */
export function PainelCatalogos({
  secao,
  aoTrocarSecao,
}: {
  secao: SecaoCatalogo;
  aoTrocarSecao: (secao: SecaoCatalogo) => void;
}) {
  const clienteDeConsultas = useQueryClient();

  const consulta = useQuery({
    queryKey: ['admin', 'catalogos'],
    queryFn: carregarCatalogos,
  });

  const invalidar = () => void clienteDeConsultas.invalidateQueries({ queryKey: ['admin'] });

  const ligarDesligar = useMutation({
    mutationFn: ({
      tabela,
      id,
      ativo,
    }: {
      tabela: 'categories' | 'lost_reasons' | 'interaction_outcomes' | 'message_templates';
      id: number;
      ativo: boolean;
      nome: string;
    }) => trocarAtivo(tabela, id, ativo),
    onSuccess: (_dado, { nome, ativo }) => {
      invalidar();
      toast.success(ativo ? `${nome} voltou para o catálogo.` : `${nome} saiu do catálogo.`);
    },
    onError: (erro) => toast.error('Não deu para salvar.', { description: mensagemDoErro(erro) }),
  });

  const mudarGrandeNatal = useMutation({
    mutationFn: ({ id, dentro }: { id: number; dentro: boolean; nome: string }) =>
      trocarGrandeNatal(id, dentro),
    onSuccess: (_dado, { nome, dentro }) => {
      invalidar();
      toast.success(dentro ? `${nome} entrou na Grande Natal.` : `${nome} saiu da Grande Natal.`);
    },
    onError: (erro) => toast.error('Não deu para salvar.', { description: mensagemDoErro(erro) }),
  });

  const criarFeriado = useMutation({
    mutationFn: ({ data, nome, escopo }: { data: string; nome: string; escopo: string }) =>
      adicionarFeriado(data, nome, escopo),
    onSuccess: (_dado, { nome }) => {
      invalidar();
      toast.success(`${nome} entrou no calendário.`, {
        description: 'Nenhum primeiro contato sai nesse dia.',
      });
    },
    onError: (erro) =>
      toast.error('Não deu para adicionar o feriado.', { description: mensagemDoErro(erro) }),
  });

  const apagarFeriado = useMutation({
    mutationFn: (feriado: Feriado) => removerFeriado(feriado.id),
    onSuccess: (_dado, feriado) => {
      invalidar();
      toast.success(`${feriado.nome} saiu do calendário.`);
    },
    onError: (erro) =>
      toast.error('Não deu para remover o feriado.', { description: mensagemDoErro(erro) }),
  });

  const [desfechoEmDuvida, setDesfechoEmDuvida] = useState<Desfecho | null>(null);
  const [modeloAberto, setModeloAberto] = useState<ModeloDeMensagem | null>(null);

  if (consulta.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <EsqueletoLista linhas={2} colunas={6} />
        <EsqueletoLista linhas={8} colunas={5} />
      </div>
    );
  }

  if (consulta.isError) {
    return (
      <ErroDoPainel
        causa={mensagemDoErro(consulta.error)}
        aoTentar={() => void consulta.refetch()}
      />
    );
  }

  const dados = consulta.data;
  const contagens: Record<SecaoCatalogo, number> = {
    categorias: dados.categorias.length,
    cidades: dados.cidades.length,
    feriados: dados.feriados.length,
    motivos: dados.motivos.length,
    desfechos: dados.desfechos.length,
    modelos: dados.modelos.length,
  };

  return (
    <div className="flex flex-col gap-5">
      <ChipsDeSecao
        rotulo="Catálogos do CRM"
        ativo={secao}
        aoTrocar={aoTrocarSecao}
        itens={SECOES_CATALOGO.map((id) => ({
          id,
          rotulo: ROTULO_CATALOGO[id],
          contagem: contagens[id],
        }))}
      />

      {secao === 'categorias' ? (
        <SecaoCategorias
          dados={dados}
          ocupado={ligarDesligar.isPending}
          aoAlternar={(c) =>
            ligarDesligar.mutate({
              tabela: 'categories',
              id: c.id,
              ativo: !c.ativo,
              nome: c.nome,
            })
          }
        />
      ) : null}

      {secao === 'cidades' ? (
        <SecaoCidades
          dados={dados}
          ocupado={mudarGrandeNatal.isPending}
          aoAlternar={(c) =>
            mudarGrandeNatal.mutate({ id: c.id, dentro: !c.grandeNatal, nome: c.nome })
          }
        />
      ) : null}

      {secao === 'feriados' ? (
        <SecaoFeriados
          dados={dados}
          ocupadoCriando={criarFeriado.isPending}
          aoCriar={(data, nome, escopo) => criarFeriado.mutate({ data, nome, escopo })}
          aoRemover={(feriado) => apagarFeriado.mutate(feriado)}
        />
      ) : null}

      {secao === 'motivos' ? (
        <SecaoMotivos
          dados={dados}
          ocupado={ligarDesligar.isPending}
          aoAlternar={(m) =>
            ligarDesligar.mutate({
              tabela: 'lost_reasons',
              id: m.id,
              ativo: !m.ativo,
              nome: m.nome,
            })
          }
        />
      ) : null}

      {secao === 'desfechos' ? (
        <SecaoDesfechos dados={dados} aoPedirConfirmacao={setDesfechoEmDuvida} />
      ) : null}

      {secao === 'modelos' ? (
        <SecaoModelos
          dados={dados}
          ocupado={ligarDesligar.isPending}
          aoAbrir={setModeloAberto}
          aoAlternar={(m) =>
            ligarDesligar.mutate({
              tabela: 'message_templates',
              id: m.id,
              ativo: !m.ativo,
              nome: m.nome,
            })
          }
        />
      ) : null}

      <DialogoConfirmar
        aberto={desfechoEmDuvida !== null}
        aoFechar={() => setDesfechoEmDuvida(null)}
        perigo={desfechoEmDuvida?.ativo ?? false}
        ocupado={ligarDesligar.isPending}
        titulo={
          desfechoEmDuvida?.ativo
            ? `Desligar \u201c${desfechoEmDuvida.nome}\u201d?`
            : `Religar \u201c${desfechoEmDuvida?.nome ?? ''}\u201d?`
        }
        rotuloConfirmar={desfechoEmDuvida?.ativo ? 'Desligar o desfecho' : 'Religar o desfecho'}
        descricao={desfechoEmDuvida ? <ConsequenciaDoDesfecho desfecho={desfechoEmDuvida} /> : null}
        aoConfirmar={() => {
          if (desfechoEmDuvida) {
            ligarDesligar.mutate({
              tabela: 'interaction_outcomes',
              id: desfechoEmDuvida.id,
              ativo: !desfechoEmDuvida.ativo,
              nome: desfechoEmDuvida.nome,
            });
          }
          setDesfechoEmDuvida(null);
        }}
      />

      <Dialog
        open={modeloAberto !== null}
        onOpenChange={(estado) => (estado ? null : setModeloAberto(null))}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{modeloAberto?.nome}</DialogTitle>
            <DialogDescription>
              {modeloAberto ? (
                <>
                  <span className="numerico">{modeloAberto.codigo}</span> ·{' '}
                  {rotuloDoCanal(modeloAberto.canal)} ·{' '}
                  {rotuloDaCategoriaDeModelo(modeloAberto.categoria)} ·{' '}
                  {rotuloDoSegmento(modeloAberto.segmento)}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <p className="max-h-[50vh] overflow-y-auto rounded-lg bg-muted/60 p-3 text-sm leading-relaxed whitespace-pre-wrap">
            {modeloAberto?.corpo}
          </p>
          {modeloAberto && modeloAberto.variaveis.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Variáveis: {modeloAberto.variaveis.join(', ')}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BotaoDeLinha({
  children,
  onClick,
  desabilitado,
}: {
  children: React.ReactNode;
  onClick: () => void;
  desabilitado?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="toque h-11 md:h-7"
      onClick={onClick}
      disabled={desabilitado}
    >
      {children}
    </Button>
  );
}

/**
 * Janela de silêncio na tabela: o NÚMERO em IBM Plex Mono, a palavra na Poppins.
 * "3 dias" inteiro em mono vestiria "dias" com o traço de fonte de código.
 */
function Silencio({ dias }: { dias: number }) {
  if (dias >= 3650) return <span className="text-muted-foreground">Para sempre</span>;
  if (dias === 0) return <span className="text-muted-foreground">Sem espera</span>;
  return (
    <span>
      <span className="numerico">{dias}</span> {dias === 1 ? 'dia' : 'dias'}
    </span>
  );
}

function Situacao({
  ativo,
  ligado,
  desligado,
}: {
  ativo: boolean;
  ligado: string;
  desligado: string;
}) {
  return ativo ? <span>{ligado}</span> : <span className="text-muted-foreground">{desligado}</span>;
}

function SecaoCategorias({
  dados,
  aoAlternar,
  ocupado,
}: {
  dados: DadosCatalogos;
  aoAlternar: (categoria: Categoria) => void;
  ocupado: boolean;
}) {
  const colunas: ColunaAdmin<Categoria>[] = [
    {
      id: 'nome',
      rotulo: 'Categoria',
      principal: true,
      largura: 'w-64',
      celula: (c) => <span className="font-medium">{c.nome}</span>,
    },
    {
      id: 'grupo',
      rotulo: 'Grupo',
      largura: 'w-44',
      celula: (c) => <span className="text-muted-foreground">{rotuloDoGrupo(c.grupo)}</span>,
    },
    {
      id: 'prioridade',
      rotulo: 'Prioridade de ataque',
      largura: 'w-40',
      celula: (c) => rotuloDaPrioridade(c.prioridade),
    },
    {
      id: 'parceiros',
      rotulo: 'Parceiros na base',
      largura: 'w-36',
      celula: (c) => <span className="numerico">{formatarNumero(c.parceiros)}</span>,
    },
    {
      id: 'situacao',
      rotulo: 'Situação',
      largura: 'w-28',
      celula: (c) => <Situacao ativo={c.ativo} ligado="Em uso" desligado="Fora de uso" />,
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <CabecalhoDeSecao
        titulo="Categorias"
        contagem={<Contagem n={dados.categorias.length} rotulo="categorias" />}
        descricao="O que o parceiro faz. Aparece no filtro da base, no cadastro rápido e na meta por categoria. Tirar de uso esconde a categoria dos formulários; quem já está nela continua onde está."
      />
      <ListaAdmin
        rotuloDaLista="Categorias de fornecedor"
        colunas={colunas}
        linhas={dados.categorias}
        chave={(c) => c.id}
        acoes={(c) => (
          <BotaoDeLinha desabilitado={ocupado} onClick={() => aoAlternar(c)}>
            {c.ativo ? 'Tirar de uso' : 'Voltar a usar'}
          </BotaoDeLinha>
        )}
      />
    </section>
  );
}

function SecaoCidades({
  dados,
  aoAlternar,
  ocupado,
}: {
  dados: DadosCatalogos;
  aoAlternar: (cidade: Cidade) => void;
  ocupado: boolean;
}) {
  const colunas: ColunaAdmin<Cidade>[] = [
    {
      id: 'nome',
      rotulo: 'Cidade',
      principal: true,
      largura: 'w-64',
      celula: (c) => (
        <span className="font-medium">
          {c.nome} <span className="text-muted-foreground">{c.uf}</span>
        </span>
      ),
    },
    {
      id: 'metro',
      rotulo: 'Grande Natal',
      largura: 'w-40',
      celula: (c) => <Situacao ativo={c.grandeNatal} ligado="Dentro" desligado="Fora" />,
    },
    {
      id: 'parceiros',
      rotulo: 'Parceiros na base',
      largura: 'w-36',
      celula: (c) => <span className="numerico">{formatarNumero(c.parceiros)}</span>,
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <CabecalhoDeSecao
        titulo="Cidades"
        contagem={<Contagem n={dados.cidades.length} rotulo="cidades" />}
        descricao="Onde o parceiro atende. Quem está na Grande Natal entra primeiro nas listas e nas rotas de visita; o resto do estado fica para depois do MVP."
      />
      <ListaAdmin
        rotuloDaLista="Cidades atendidas"
        colunas={colunas}
        linhas={dados.cidades}
        chave={(c) => c.id}
        acoes={(c) => (
          <BotaoDeLinha desabilitado={ocupado} onClick={() => aoAlternar(c)}>
            {c.grandeNatal ? 'Tirar da Grande Natal' : 'Pôr na Grande Natal'}
          </BotaoDeLinha>
        )}
      />
    </section>
  );
}

function SecaoFeriados({
  dados,
  aoCriar,
  aoRemover,
  ocupadoCriando,
}: {
  dados: DadosCatalogos;
  aoCriar: (data: string, nome: string, escopo: string) => void;
  aoRemover: (feriado: Feriado) => void;
  ocupadoCriando: boolean;
}) {
  const [data, setData] = useState(hojeEmNatal());
  const [nome, setNome] = useState('');
  const [escopo, setEscopo] = useState('nacional');
  const [aRemover, setARemover] = useState<Feriado | null>(null);

  const hoje = hojeEmNatal();
  const futuros = dados.feriados.filter((f) => f.data >= hoje);

  const colunas: ColunaAdmin<Feriado>[] = [
    {
      id: 'data',
      rotulo: 'Data',
      principal: true,
      largura: 'w-40',
      celula: (f) => (
        <span className="font-medium">
          <span className="numerico">{formatarDataPura(f.data)}</span>{' '}
          <span className="font-normal text-muted-foreground">{diaDaSemana(f.data)}</span>
        </span>
      ),
    },
    {
      id: 'nome',
      rotulo: 'Feriado',
      largura: 'w-80',
      celula: (f) => f.nome,
    },
    {
      id: 'escopo',
      rotulo: 'Alcance',
      largura: 'w-40',
      celula: (f) => <span className="text-muted-foreground">{rotuloDoEscopo(f.escopo)}</span>,
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <CabecalhoDeSecao
        titulo="Feriados"
        contagem={<Contagem n={futuros.length} rotulo="pela frente" />}
        descricao="Dias em que nenhum primeiro contato sai (RF-CON-11) e que não contam como dia útil no cálculo de metas. Vale para 2026 e 2027, nacional, do RN e de Natal."
      />

      <form
        className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3 md:flex-row md:items-end"
        onSubmit={(evento) => {
          evento.preventDefault();
          if (!nome.trim() || !data) return;
          aoCriar(data, nome, escopo);
          setNome('');
        }}
      >
        <div className="space-y-1.5 md:w-44">
          <Label htmlFor="feriado-data" className="text-xs">
            Data
          </Label>
          <Input
            id="feriado-data"
            type="date"
            value={data}
            onChange={(evento) => setData(evento.target.value)}
            className="numerico h-11 md:h-8"
          />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="feriado-nome" className="text-xs">
            Nome
          </Label>
          <Input
            id="feriado-nome"
            placeholder="Padroeira da cidade"
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            className="h-11 md:h-8"
          />
        </div>
        <div className="space-y-1.5 md:w-44">
          <Label htmlFor="feriado-escopo" className="text-xs">
            Alcance
          </Label>
          <Select value={escopo} onValueChange={setEscopo}>
            <SelectTrigger id="feriado-escopo" className="toque h-11 w-full md:h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nacional">Nacional</SelectItem>
              <SelectItem value="estadual">Estadual (RN)</SelectItem>
              <SelectItem value="municipal">Municipal (Natal)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="submit"
          disabled={!nome.trim() || ocupadoCriando}
          className="toque h-11 md:h-8"
        >
          <Plus aria-hidden="true" />
          {ocupadoCriando ? 'Adicionando...' : 'Adicionar'}
        </Button>
      </form>

      {dados.feriados.length === 0 ? (
        <Vazio
          titulo="Nenhum feriado no calendário"
          texto="Sem feriado cadastrado, a fila de primeiros contatos trata 07 de setembro como dia comum. Acrescente pelo menos os nacionais."
        />
      ) : (
        <ListaAdmin
          rotuloDaLista="Feriados do calendário"
          colunas={colunas}
          linhas={dados.feriados}
          chave={(f) => f.id}
          acoes={(f) => (
            <BotaoDeLinha onClick={() => setARemover(f)}>
              <Trash2 aria-hidden="true" />
              Remover
            </BotaoDeLinha>
          )}
        />
      )}

      <DialogoConfirmar
        aberto={aRemover !== null}
        aoFechar={() => setARemover(null)}
        perigo
        titulo={`Remover ${aRemover?.nome ?? ''}?`}
        rotuloConfirmar="Remover do calendário"
        descricao={
          <p>
            Sem esse feriado, o dia{' '}
            <span className="numerico">{formatarDataPura(aRemover?.data)}</span> volta a ser dia
            útil: a fila de primeiros contatos passa a enviar e o dia entra na conta das metas.
          </p>
        }
        aoConfirmar={() => {
          if (aRemover) aoRemover(aRemover);
          setARemover(null);
        }}
      />
    </section>
  );
}

function SecaoMotivos({
  dados,
  aoAlternar,
  ocupado,
}: {
  dados: DadosCatalogos;
  aoAlternar: (motivo: MotivoDePerda) => void;
  ocupado: boolean;
}) {
  const colunas: ColunaAdmin<MotivoDePerda>[] = [
    {
      id: 'nome',
      rotulo: 'Motivo',
      principal: true,
      largura: 'w-80',
      celula: (m) => <span className="font-medium">{m.nome}</span>,
    },
    {
      id: 'negocios',
      rotulo: 'Negócios perdidos assim',
      largura: 'w-52',
      celula: (m) => <span className="numerico">{formatarNumero(m.negocios)}</span>,
    },
    {
      id: 'situacao',
      rotulo: 'Situação',
      largura: 'w-32',
      celula: (m) => <Situacao ativo={m.ativo} ligado="Em uso" desligado="Fora de uso" />,
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <CabecalhoDeSecao
        titulo="Motivos de perda"
        contagem={<Contagem n={dados.motivos.length} rotulo="motivos" />}
        descricao="A lista que aparece quando um negócio vai para perdido (RF-FUN-04). É o que alimenta o relatório de por que a captação não fecha, então motivo genérico demais custa caro depois."
      />
      <ListaAdmin
        rotuloDaLista="Motivos de perda do funil"
        colunas={colunas}
        linhas={dados.motivos}
        chave={(m) => m.id}
        acoes={(m) => (
          <BotaoDeLinha desabilitado={ocupado} onClick={() => aoAlternar(m)}>
            {m.ativo ? 'Tirar de uso' : 'Voltar a usar'}
          </BotaoDeLinha>
        )}
      />
    </section>
  );
}

/** As consequências de um desfecho, em frases. Usada na linha e na confirmação. */
function ConsequenciaDoDesfecho({ desfecho }: { desfecho: Desfecho }) {
  const frases: string[] = [];

  if (desfecho.etapaDestino) {
    frases.push(`move o negócio para a etapa \u201c${desfecho.etapaDestino}\u201d`);
  }
  if (desfecho.temperatura)
    frases.push(
      `marca a temperatura como ${rotuloDaTemperatura(desfecho.temperatura).toLowerCase()}`,
    );
  if (desfecho.proximaAcaoRotulo)
    frases.push(
      `cria a próxima ação \u201c${desfecho.proximaAcaoRotulo}\u201d${
        desfecho.proximaAcaoDias === null ? '' : ` em D+${desfecho.proximaAcaoDias}`
      }`,
    );
  if (desfecho.silencioDias > 0)
    frases.push(
      `abre janela de silêncio de ${rotuloDoSilencio(desfecho.silencioDias).toLowerCase()}`,
    );
  if (desfecho.exigeMotivoDePerda) frases.push('exige um motivo de perda');
  if (!desfecho.podeReativar) frases.push('não permite reativar depois');

  return (
    <>
      <p>
        Este desfecho não é um rótulo: quando alguém o escolhe no registro de contato, o banco{' '}
        {frases.length > 0 ? frases.join(', ') : 'apenas registra a atividade'}. Ele conta como{' '}
        <strong>{rotuloDaPorta(desfecho.contaComo).toLowerCase()}</strong> na meta do dia.
      </p>
      {desfecho.ativo ? (
        <p>
          Desligando, ele some dos chips do registro de contato e essa consequência deixa de
          acontecer. As <span className="numerico">{formatarNumero(desfecho.usos)}</span> atividades
          já registradas com ele ficam como estão.
        </p>
      ) : (
        <p>Religando, ele volta a aparecer no registro de contato com essa mesma consequência.</p>
      )}
    </>
  );
}

function SecaoDesfechos({
  dados,
  aoPedirConfirmacao,
}: {
  dados: DadosCatalogos;
  aoPedirConfirmacao: (desfecho: Desfecho) => void;
}) {
  const colunas: ColunaAdmin<Desfecho>[] = [
    {
      id: 'nome',
      rotulo: 'Desfecho',
      principal: true,
      largura: 'w-52',
      celula: (d) => (
        <span className="font-medium">
          {d.nome}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {d.superficies.map(rotuloDaSuperficie).join(', ')}
          </span>
        </span>
      ),
    },
    {
      id: 'consequencia',
      rotulo: 'O que acontece sozinho',
      largura: 'w-64',
      celula: (d) => (
        <span className="text-muted-foreground">
          {[
            d.etapaDestino ? `etapa \u201c${d.etapaDestino}\u201d` : null,
            d.temperatura ? rotuloDaTemperatura(d.temperatura).toLowerCase() : null,
            d.proximaAcaoRotulo
              ? `${d.proximaAcaoRotulo}${d.proximaAcaoDias === null ? '' : ` (D+${d.proximaAcaoDias})`}`
              : null,
            d.exigeMotivoDePerda ? 'pede motivo de perda' : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'só registra a atividade'}
        </span>
      ),
    },
    {
      id: 'silencio',
      rotulo: 'Silêncio',
      largura: 'w-24',
      celula: (d) => <Silencio dias={d.silencioDias} />,
    },
    {
      id: 'porta',
      rotulo: 'Conta como',
      largura: 'w-28',
      celula: (d) => rotuloDaPorta(d.contaComo),
    },
    {
      id: 'usos',
      rotulo: 'Já usado',
      largura: 'hidden w-24 xl:table-cell',
      celula: (d) => <span className="numerico">{formatarNumero(d.usos)}</span>,
    },
    {
      id: 'situacao',
      rotulo: 'Situação',
      largura: 'w-24',
      celula: (d) => <Situacao ativo={d.ativo} ligado="Ligado" desligado="Desligado" />,
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <CabecalhoDeSecao
        titulo="Desfechos de interação"
        contagem={<Contagem n={dados.desfechos.length} rotulo="desfechos" />}
        descricao="Os chips que a Heloísa toca no fim de cada contato (RF-FUN-12). São o catálogo mais perigoso da tela."
      />
      <Aviso tom="atencao" titulo="Mexer aqui muda o que o CRM faz sozinho">
        <p>
          Cada desfecho carrega uma consequência automática: mover etapa, mudar temperatura, criar a
          próxima ação, abrir janela de silêncio e contar (ou não) como porta aberta na meta do dia.
          Desligar um deles não é esconder um rótulo: é desligar essa automação para todo o time, a
          partir do próximo contato registrado. Por isso a tela pede confirmação e mostra, antes,
          exatamente o que deixa de acontecer.
        </p>
        <p className="mt-1">
          Nome, etapa de destino e prazo continuam vindo do banco (migração e seed), como o PRD
          define para o MVP: aqui dá para ligar e desligar, não para reescrever a regra.
        </p>
      </Aviso>
      <ListaAdmin
        rotuloDaLista="Catálogo de desfechos de interação"
        colunas={colunas}
        linhas={dados.desfechos}
        chave={(d) => d.id}
        acoes={(d) => (
          <BotaoDeLinha onClick={() => aoPedirConfirmacao(d)}>
            {d.ativo ? 'Desligar' : 'Religar'}
          </BotaoDeLinha>
        )}
      />
    </section>
  );
}

function SecaoModelos({
  dados,
  aoAbrir,
  aoAlternar,
  ocupado,
}: {
  dados: DadosCatalogos;
  aoAbrir: (modelo: ModeloDeMensagem) => void;
  aoAlternar: (modelo: ModeloDeMensagem) => void;
  ocupado: boolean;
}) {
  const [busca, setBusca] = useState('');

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return dados.modelos;
    return dados.modelos.filter((m) =>
      [m.nome, m.codigo, m.corpo, rotuloDoSegmento(m.segmento)]
        .join(' ')
        .toLowerCase()
        .includes(termo),
    );
  }, [busca, dados.modelos]);

  const colunas: ColunaAdmin<ModeloDeMensagem>[] = [
    {
      id: 'nome',
      rotulo: 'Modelo',
      principal: true,
      largura: 'w-64',
      celula: (m) => (
        <span className="font-medium">
          {m.nome}
          {m.variante ? (
            <Badge variant="pilula" className="ml-2 h-5 px-2 text-[11px] font-normal">
              variante {m.variante}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'codigo',
      rotulo: 'Código',
      largura: 'hidden w-56 xl:table-cell',
      celula: (m) => <span className="numerico text-xs text-muted-foreground">{m.codigo}</span>,
    },
    {
      id: 'canal',
      rotulo: 'Canal',
      largura: 'w-32',
      celula: (m) => rotuloDoCanal(m.canal),
    },
    {
      id: 'segmento',
      rotulo: 'Segmento',
      largura: 'w-40',
      celula: (m) => <span className="text-muted-foreground">{rotuloDoSegmento(m.segmento)}</span>,
    },
    {
      id: 'situacao',
      rotulo: 'Situação',
      largura: 'w-28',
      celula: (m) => <Situacao ativo={m.ativo} ligado="Em uso" desligado="Fora de uso" />,
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <CabecalhoDeSecao
        titulo="Modelos de mensagem"
        contagem={<Contagem n={dados.modelos.length} rotulo="modelos" />}
        descricao="Os textos que a Heloísa usa nas conversas, por canal, segmento e versão. Escritos por Bárbara e aprovados por Dennis para a parte financeira."
      />
      <Aviso titulo="O envio pelo WhatsApp ainda não está ligado">
        <p>
          Estes modelos existem no banco e podem ser lidos e copiados agora, mas nenhuma mensagem
          sai do CRM: o envio depende da Cloud API oficial da Meta e da aprovação dos modelos pela
          própria Meta, que é trabalho do Luiz no Meta Business (RF-CON-01, D5). Enquanto isso, a
          coluna de situação diz o que está no catálogo, não o que a Meta aprovou.
        </p>
      </Aviso>

      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="busca-modelo" className="text-xs">
          Procurar no texto ou no código
        </Label>
        <Input
          id="busca-modelo"
          placeholder="abertura, follow-up, cerimonialista..."
          value={busca}
          onChange={(evento) => setBusca(evento.target.value)}
          className="h-11 md:h-8"
        />
      </div>

      {filtrados.length === 0 ? (
        <Vazio
          titulo="Nenhum modelo com esse texto"
          texto={`Nada bate com "${busca.trim()}". Tente uma palavra do corpo da mensagem ou parte do código.`}
        />
      ) : (
        <ListaAdmin
          rotuloDaLista="Modelos de mensagem"
          colunas={colunas}
          linhas={filtrados}
          chave={(m) => m.id}
          larguraDasAcoes="w-64"
          acoes={(m) => (
            <>
              <BotaoDeLinha onClick={() => aoAbrir(m)}>
                <FileText aria-hidden="true" />
                Ver texto
              </BotaoDeLinha>
              <BotaoDeLinha desabilitado={ocupado} onClick={() => aoAlternar(m)}>
                {m.ativo ? 'Tirar de uso' : 'Voltar a usar'}
              </BotaoDeLinha>
            </>
          )}
        />
      )}
    </section>
  );
}
