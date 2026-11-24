'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, UserCheck, UserMinus } from 'lucide-react';
import { toast } from 'sonner';

import { ROTULO_PAPEL, type AppRole } from '@/lib/auth/role';
import { type Sessao } from '@/lib/auth/session';
import { ADMINS_TEM_NOME, EMPRESA, OUTRAS_EMPRESAS_DO_SELETOR } from '@/lib/empresa';
import { cn } from '@/lib/utils';
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
import { EscolhaMultipla } from '@/components/envios/escolha-multipla';

import { DialogoConfirmar } from './confirmar';
import {
  adicionarPermitido,
  carregarPermitidos,
  carregarPessoas,
  carregarSetoresDoTime,
  definirSetoresDaPessoa,
  removerPermitido,
  SemAcessoAoRegistro,
  trocarAcesso,
  trocarDominioAtivo,
  trocarPapel,
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
import { formatarData, mensagemDoErro } from './formatos';
import { O_QUE_O_PAPEL_FAZ, PAPEIS_ATRIBUIVEIS, type Permitido, type Pessoa } from './tipos';

/**
 * Pessoas (RF-ADM-01 e RF-ADM-06): quem entra, com que papel, e quem está autorizado
 * a entrar antes mesmo de ter entrado.
 *
 * São três listas em ordem de consequência. "Quem tem acesso" é o que existe hoje —
 * cada linha é uma pessoa que consegue abrir o CRM agora. A "lista de permitidos" e os
 * "domínios permitidos" são o que vai acontecer: quem ainda não entrou, mas entrará no
 * primeiro login com Google. Misturar as três seria esconder que revogar um acesso
 * exige as duas pontas — desativar o perfil e tirar da lista —, senão a pessoa
 * simplesmente entra de novo.
 *
 * Editar é privilégio de admin (política `profiles_update` mais o gatilho
 * `app.profiles_guard`); gestor lê e a tela diz isso, em vez de oferecer um botão que
 * o banco vai recusar.
 */
export function PainelPessoas({ sessao }: { sessao: Sessao }) {
  const ehAdmin = sessao.papel === 'admin';
  const [mostrarDesativadas, setMostrarDesativadas] = useState(false);
  const clienteDeConsultas = useQueryClient();

  const consulta = useQuery({
    queryKey: ['admin', 'pessoas'],
    queryFn: carregarPessoas,
  });

  // Setores do atendimento (Fase 1): quem é de qual fila na tela de Conversas.
  const setores = useQuery({ queryKey: ['admin', 'setores'], queryFn: carregarSetoresDoTime });
  const podeMudarSetor = sessao.papel === 'admin' || sessao.papel === 'gestor';
  const mudarSetores = useMutation({
    mutationFn: ({ pessoa, ids }: { pessoa: Pessoa; ids: number[] }) =>
      definirSetoresDaPessoa(pessoa.id, ids),
    onSuccess: () => void clienteDeConsultas.invalidateQueries({ queryKey: ['admin', 'setores'] }),
    onError: (erro) =>
      toast.error('Não deu para mudar os setores.', { description: mensagemDoErro(erro) }),
  });

  const permitidos = useQuery({
    queryKey: ['admin', 'permitidos'],
    queryFn: carregarPermitidos,
    enabled: ehAdmin,
  });

  const invalidar = () => {
    void clienteDeConsultas.invalidateQueries({ queryKey: ['admin', 'pessoas'] });
    void clienteDeConsultas.invalidateQueries({ queryKey: ['admin', 'permitidos'] });
  };

  const mudarPapel = useMutation({
    mutationFn: ({ pessoa, papel }: { pessoa: Pessoa; papel: AppRole }) =>
      trocarPapel(pessoa.id, papel),
    onSuccess: (_dado, { pessoa, papel }) => {
      invalidar();
      toast.success(`${pessoa.nome} agora é ${ROTULO_PAPEL[papel]}.`, {
        description: 'O papel novo passa a valer no próximo login dessa pessoa.',
      });
    },
    onError: (erro) =>
      toast.error('Não deu para trocar o papel.', { description: mensagemDoErro(erro) }),
  });

  const mudarAcesso = useMutation({
    mutationFn: ({ pessoa, ativo }: { pessoa: Pessoa; ativo: boolean }) =>
      trocarAcesso(pessoa.id, ativo),
    onSuccess: (_dado, { pessoa, ativo }) => {
      invalidar();
      toast.success(
        ativo ? `${pessoa.nome} voltou a ter acesso.` : `${pessoa.nome} perdeu o acesso.`,
        {
          description: ativo
            ? 'Ela entra de novo no próximo login.'
            : 'A sessão aberta cai na próxima renovação do login.',
        },
      );
    },
    onError: (erro) =>
      toast.error('Não deu para mudar o acesso.', { description: mensagemDoErro(erro) }),
  });

  const adicionar = useMutation({
    mutationFn: ({ email, papel, nota }: { email: string; papel: AppRole; nota: string }) =>
      adicionarPermitido(email, papel, nota),
    onSuccess: (_dado, { email }) => {
      invalidar();
      toast.success(`${email} entrou na lista de permitidos.`, {
        description: 'A pessoa passa a entrar pelo login com Google.',
      });
    },
    onError: (erro) =>
      toast.error('Não deu para adicionar.', { description: mensagemDoErro(erro) }),
  });

  const remover = useMutation({
    mutationFn: (linha: Permitido) => removerPermitido(linha.id),
    onSuccess: (_dado, linha) => {
      invalidar();
      toast.success(`${linha.email} saiu da lista de permitidos.`, {
        description: 'Quem já entrou continua entrando: desative o acesso também.',
      });
    },
    onError: (erro) => toast.error('Não deu para remover.', { description: mensagemDoErro(erro) }),
  });

  const mudarDominio = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) => trocarDominioAtivo(id, ativo),
    onSuccess: () => {
      invalidar();
      toast.success('Domínio atualizado.');
    },
    onError: (erro) =>
      toast.error('Não deu para atualizar o domínio.', { description: mensagemDoErro(erro) }),
  });

  const [aRevogar, setARevogar] = useState<Pessoa | null>(null);
  const [aRemover, setARemover] = useState<Permitido | null>(null);

  if (consulta.isPending) return <EsqueletoLista linhas={6} colunas={5} />;
  if (consulta.isError) {
    return (
      <ErroDoPainel
        causa={mensagemDoErro(consulta.error)}
        aoTentar={() => void consulta.refetch()}
      />
    );
  }

  const todas = consulta.data.pessoas;
  // Desativados ficam escondidos por padrão (22/09/2026): contas antigas e de
  // teste que não podem ser apagadas — aparecem na trilha de auditoria — não
  // precisam ocupar a lista de quem trabalha no CRM todo dia.
  const desativadas = todas.filter((p) => !p.ativo).length;
  const pessoas = mostrarDesativadas ? todas : todas.filter((p) => p.ativo);
  const ativos = pessoas.filter((p) => p.ativo);
  // Diretório do time para traduzir id em nome na renderização (nunca dentro da consulta).
  const nomes = new Map(todas.map((p) => [p.id, p.nome]));
  const admins = ativos.filter((p) => p.papel === 'admin');

  // Papel, setores e ações saem daqui para a tabela (tablet e computador) e para o
  // cartão do celular mostrarem a mesma coisa e oferecerem os mesmos botões.
  const celulaPapel = (p: Pessoa) => (
    <span title={O_QUE_O_PAPEL_FAZ[p.papel]}>
      {ehAdmin ? (
        <SeletorDePapel
          valor={p.papel}
          desabilitado={p.id === sessao.id || mudarPapel.isPending}
          aoMudar={(papel) => mudarPapel.mutate({ pessoa: p, papel })}
          rotulo={`Papel de ${p.nome}`}
        />
      ) : (
        <Badge variant="pilula" className="h-6 px-2.5 font-normal">
          {ROTULO_PAPEL[p.papel]}
        </Badge>
      )}
    </span>
  );

  const celulaSetores = (p: Pessoa) => {
    const meus = setores.data?.daPessoa[p.id] ?? [];
    const opcoes = (setores.data?.setores ?? []).map((s) => ({ valor: s.id, rotulo: s.nome }));
    if (!podeMudarSetor) {
      const nomes = opcoes.filter((o) => meus.includes(o.valor)).map((o) => o.rotulo);
      return <span className="text-muted-foreground">{nomes.join(', ') || '—'}</span>;
    }
    return (
      <EscolhaMultipla
        rotulo="Setor"
        opcoes={opcoes}
        valor={meus}
        aoMudar={(ids) => mudarSetores.mutate({ pessoa: p, ids })}
      />
    );
  };

  const acoesDaPessoa = ehAdmin
    ? (p: Pessoa) =>
        p.id === sessao.id ? (
          <span className="text-xs text-muted-foreground">É a sua conta</span>
        ) : p.ativo ? (
          <Button
            variant="outline"
            size="sm"
            className="toque h-11 md:h-7"
            onClick={() => setARevogar(p)}
          >
            <UserMinus aria-hidden="true" />
            Tirar o acesso
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="toque h-11 md:h-7"
            onClick={() => mudarAcesso.mutate({ pessoa: p, ativo: true })}
          >
            <UserCheck aria-hidden="true" />
            Devolver o acesso
          </Button>
        )
    : undefined;

  // O CARTÃO DA PESSOA NO CELULAR (24/11/2026, protótipo responsivo). A lista de
  // "rótulo e valor" deixava "Papel", "Setores" e "Acesso" soltos numa coluna de
  // 8rem; agora é avatar, nome e acesso numa linha, papel e setor embaixo.
  const cartaoDaPessoa = (p: Pessoa) => (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
      <Iniciais nome={p.nome} className="size-9 text-[13px]" />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-semibold">{p.nome}</span>
        {p.id === sessao.id ? <SeloVoce /> : null}
      </span>
      <SeloAcesso ativo={p.ativo} />
      <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-2">
        {celulaPapel(p)}
        {celulaSetores(p)}
      </div>
      {acoesDaPessoa ? (
        <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-2">
          {acoesDaPessoa(p)}
        </div>
      ) : null}
    </div>
  );

  const colunasPessoas: ColunaAdmin<Pessoa>[] = [
    {
      id: 'nome',
      rotulo: 'Pessoa',
      principal: true,
      // Larguras de 24/11/2026: com a coluna de seções à esquerda, a tabela tem uns
      // 620px no tablet e no notebook, e a soma antiga (672px) cortava "Ativo".
      largura: 'w-48',
      celula: (p) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Iniciais nome={p.nome} className="size-7 text-[11px]" />
          <span className="truncate font-semibold">{p.nome}</span>
          {p.id === sessao.id ? <SeloVoce /> : null}
        </span>
      ),
    },
    {
      id: 'papel',
      rotulo: 'Papel',
      largura: ehAdmin ? 'w-36' : 'w-28',
      // A EXPLICAÇÃO DO PAPEL VIROU TÍTULO (23/09/2026): numa equipe em que quase
      // todo mundo é SDR, a coluna "O que esse papel faz" repetia a mesma frase de
      // duas linhas em cada pessoa — 288 px de largura para dizer cinco vezes a
      // mesma coisa. Quem precisa da definição passa o mouse; quem decide olha
      // pessoa, papel e acesso.
      celula: (p) => celulaPapel(p),
    },
    {
      id: 'setores',
      rotulo: 'Setores',
      largura: 'w-40',
      celula: (p) => celulaSetores(p),
    },
    {
      id: 'acesso',
      rotulo: 'Acesso',
      largura: 'w-28',
      celula: (p) => <SeloAcesso ativo={p.ativo} />,
    },
    {
      id: 'desde',
      rotulo: 'No CRM desde',
      // Com a coluna de setores (Fase 1), esta só aparece em tela bem larga: a
      // tabela passava da largura e cortava o botão de acesso, que decide.
      largura: 'hidden w-28 2xl:table-cell',
      soNoDesktop: true,
      celula: (p) => (
        <span className="numerico text-muted-foreground">{formatarData(p.criadoEm)}</span>
      ),
    },
  ];

  const colunasPermitidos: ColunaAdmin<Permitido>[] = [
    {
      id: 'email',
      rotulo: 'E-mail autorizado',
      principal: true,
      largura: 'w-72',
      celula: (l) => <span className="font-medium break-all">{l.email}</span>,
    },
    {
      id: 'papel',
      rotulo: 'Entra como',
      largura: 'w-32',
      celula: (l) => (
        <Badge variant="pilula" className="h-6 px-2.5 font-normal">
          {ROTULO_PAPEL[l.papel]}
        </Badge>
      ),
    },
    {
      id: 'nota',
      rotulo: 'Observação',
      largura: 'hidden w-56 xl:table-cell',
      celula: (l) => <span className="text-muted-foreground">{l.nota ?? 'Sem observação'}</span>,
    },
    {
      id: 'quando',
      rotulo: 'Autorizado em',
      largura: 'w-28',
      celula: (l) => (
        <span className="numerico text-muted-foreground">{formatarData(l.criadoEm)}</span>
      ),
    },
    {
      id: 'porquem',
      rotulo: 'Autorizado por',
      largura: 'hidden w-36 xl:table-cell',
      soNoDesktop: true,
      celula: (l) => (
        <span className="text-muted-foreground">
          {(l.criadoPorId ? nomes.get(l.criadoPorId) : null) ?? 'Carga inicial'}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <Aviso titulo="Como alguém entra no Tríade">
        <p>
          A entrada é o login com Google, e só abre para quem está na{' '}
          <strong>lista de permitidos</strong> ou tem e-mail de um{' '}
          <strong>domínio permitido</strong>. O papel viaja no token da sessão, então{' '}
          <strong>toda troca de papel só vale no próximo login da pessoa</strong>.
        </p>
        {OUTRAS_EMPRESAS_DO_SELETOR.length > 0 ? (
          <p>
            Quem também entra na {OUTRAS_EMPRESAS_DO_SELETOR.map((d) => d.nome).join(' e ')} vê o
            botão de trocar de empresa no topo, sem ninguém marcar nada: basta o mesmo e-mail estar
            liberado lá.
          </p>
        ) : null}
      </Aviso>

      <section className="flex flex-col gap-3">
        <CabecalhoDeSecao
          titulo="Quem tem acesso"
          contagem={<Contagem n={ativos.length} rotulo="com acesso" />}
          descricao={
            ehAdmin
              ? 'Papel e acesso valem para todo o CRM. Você não muda o seu próprio papel: peça a outro admin.'
              : 'Só admin muda papel e acesso. Você vê a lista para saber a quem pedir.'
          }
        />
        {admins.length <= 1 ? (
          <Aviso tom="atencao">
            <p>
              Há <strong>um único admin ativo</strong> no CRM. Se essa conta cair, ninguém promove
              ninguém.{' '}
              {ADMINS_TEM_NOME
                ? `O combinado é ter três: ${EMPRESA.admins.e}.`
                : 'O combinado é ter mais de um.'}
            </p>
          </Aviso>
        ) : null}
        {desativadas > 0 ? (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="toque h-11 text-muted-foreground md:h-8"
              onClick={() => setMostrarDesativadas((v) => !v)}
            >
              {mostrarDesativadas
                ? 'Esconder desativados'
                : `Mostrar desativados (${desativadas})`}
            </Button>
          </div>
        ) : null}
        <ListaAdmin
          rotuloDaLista="Pessoas com acesso ao CRM"
          colunas={colunasPessoas}
          linhas={pessoas}
          chave={(p) => p.id}
          acoes={acoesDaPessoa}
          cartaoNoCelular={cartaoDaPessoa}
        />
      </section>

      <section className="flex flex-col gap-3">
        <CabecalhoDeSecao
          titulo="Lista de permitidos"
          contagem={
            permitidos.data ? (
              <Contagem n={permitidos.data.permitidos.length} rotulo="e-mails" />
            ) : undefined
          }
          descricao={`E-mails que podem entrar mesmo sem ser do domínio da ${EMPRESA.nome}. Entrar na lista não cria a pessoa: ela nasce no CRM no primeiro login com Google.`}
        />
        {!ehAdmin ? (
          <PainelRestrito registro="A lista de permitidos" />
        ) : permitidos.isPending ? (
          <EsqueletoLista linhas={3} colunas={4} />
        ) : permitidos.error instanceof SemAcessoAoRegistro ? (
          <PainelRestrito registro="A lista de permitidos" />
        ) : permitidos.isError ? (
          <ErroDoPainel
            causa={mensagemDoErro(permitidos.error)}
            aoTentar={() => void permitidos.refetch()}
          />
        ) : (
          <>
            <FormularioPermitido
              ocupado={adicionar.isPending}
              aoAdicionar={(email, papel, nota) => adicionar.mutate({ email, papel, nota })}
            />
            {permitidos.data.permitidos.length === 0 ? (
              <Vazio
                titulo="Ninguém na lista"
                texto="Hoje só entra quem tem e-mail de um domínio permitido. Adicione um e-mail acima para autorizar alguém de fora."
              />
            ) : (
              <ListaAdmin
                rotuloDaLista="E-mails autorizados a entrar"
                colunas={colunasPermitidos}
                linhas={permitidos.data.permitidos}
                chave={(l) => l.id}
                acoes={(l) => (
                  <Button
                    variant="outline"
                    size="sm"
                    className="toque h-11 md:h-7"
                    onClick={() => setARemover(l)}
                  >
                    <Trash2 aria-hidden="true" />
                    Remover
                  </Button>
                )}
              />
            )}

            <div className="mt-4 flex flex-col gap-3">
              <CabecalhoDeSecao
                titulo="Domínios permitidos"
                descricao="Qualquer e-mail desses domínios entra sozinho, com o papel padrão. É a porta mais larga da casa: mantenha só o domínio da empresa."
              />
              <ListaAdmin
                rotuloDaLista="Domínios de e-mail autorizados"
                colunas={[
                  {
                    id: 'dominio',
                    rotulo: 'Domínio',
                    principal: true,
                    largura: 'w-64',
                    celula: (d) => <span className="font-medium">@{d.dominio}</span>,
                  },
                  {
                    id: 'papel',
                    rotulo: 'Entra como',
                    largura: 'w-32',
                    celula: (d) => (
                      <Badge variant="pilula" className="h-6 px-2.5 font-normal">
                        {ROTULO_PAPEL[d.papelPadrao]}
                      </Badge>
                    ),
                  },
                  {
                    id: 'ativo',
                    rotulo: 'Situação',
                    largura: 'w-32',
                    celula: (d) =>
                      d.ativo ? (
                        <span>Aberto</span>
                      ) : (
                        <span className="text-muted-foreground">Fechado</span>
                      ),
                  },
                ]}
                linhas={permitidos.data.dominios}
                chave={(d) => d.id}
                acoes={(d) => (
                  <Button
                    variant="outline"
                    size="sm"
                    className="toque h-11 md:h-7"
                    disabled={mudarDominio.isPending}
                    onClick={() => mudarDominio.mutate({ id: d.id, ativo: !d.ativo })}
                  >
                    {d.ativo ? 'Fechar o domínio' : 'Abrir o domínio'}
                  </Button>
                )}
              />
            </div>
          </>
        )}
      </section>

      <DialogoConfirmar
        aberto={aRevogar !== null}
        aoFechar={() => setARevogar(null)}
        titulo={`Tirar o acesso de ${aRevogar?.nome ?? ''}?`}
        perigo
        ocupado={mudarAcesso.isPending}
        rotuloConfirmar="Tirar o acesso"
        descricao={
          <>
            <p>
              A pessoa deixa de entrar no CRM: o token dela para de ser emitido na próxima renovação
              do login, e não há tela que ela ainda alcance.
            </p>
            <p>
              O que ela já registrou continua no lugar (atividades, negócios, auditoria). Isto é
              revogação de acesso, não apagamento de histórico.
            </p>
            <p>
              Se ela também estiver na lista de permitidos, remova de lá: senão ela volta no próximo
              login.
            </p>
          </>
        }
        aoConfirmar={() => {
          if (aRevogar) mudarAcesso.mutate({ pessoa: aRevogar, ativo: false });
          setARevogar(null);
        }}
      />

      <DialogoConfirmar
        aberto={aRemover !== null}
        aoFechar={() => setARemover(null)}
        titulo={`Remover ${aRemover?.email ?? ''} da lista?`}
        perigo
        ocupado={remover.isPending}
        rotuloConfirmar="Remover da lista"
        descricao={
          <>
            <p>
              Esse e-mail deixa de ser autorizado a criar acesso novo no primeiro login com Google.
            </p>
            <p>
              Quem já entrou alguma vez continua entrando: para fechar de vez, desative também o
              acesso da pessoa na lista de cima.
            </p>
          </>
        }
        aoConfirmar={() => {
          if (aRemover) remover.mutate(aRemover);
          setARemover(null);
        }}
      />
    </div>
  );
}

/** As iniciais do nome num círculo ("Janio Ramalho" → JR; "gestor.teste" → GT). */
function Iniciais({ nome, className }: { nome: string; className?: string }) {
  const partes = nome.trim().split(/[\s._-]+/).filter(Boolean);
  const primeira = partes[0] ?? '';
  const ultima = partes.at(-1) ?? '';
  const iniciais =
    partes.length === 0
      ? '?'
      : partes.length === 1
        ? primeira.slice(0, 2)
        : `${primeira.charAt(0)}${ultima.charAt(0)}`;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-primary/12 font-semibold text-primary uppercase',
        className,
      )}
    >
      {iniciais}
    </span>
  );
}

function SeloVoce() {
  return (
    <Badge variant="pilula" className="h-5 shrink-0 px-2 text-[11px] font-normal">
      você
    </Badge>
  );
}

/** Ativo em verde de "sim", desativado apagado: a palavra continua dizendo o estado. */
function SeloAcesso({ ativo }: { ativo: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap',
        ativo ? 'bg-cliente-fundo text-cliente-texto' : 'bg-muted text-muted-foreground',
      )}
    >
      {ativo ? 'Ativo' : 'Desativado'}
    </span>
  );
}

function SeletorDePapel({
  valor,
  aoMudar,
  desabilitado,
  rotulo,
}: {
  valor: AppRole;
  aoMudar: (papel: AppRole) => void;
  desabilitado?: boolean;
  rotulo: string;
}) {
  return (
    <Select
      value={valor}
      onValueChange={(novo) => aoMudar(novo as AppRole)}
      disabled={desabilitado}
    >
      <SelectTrigger className="toque h-11 w-full md:h-8" aria-label={rotulo}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PAPEIS_ATRIBUIVEIS.map((papel) => (
          <SelectItem key={papel} value={papel}>
            {ROTULO_PAPEL[papel]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Adicionar um e-mail à lista de permitidos: três campos e um botão, sem folha nem modal. */
function FormularioPermitido({
  aoAdicionar,
  ocupado,
}: {
  aoAdicionar: (email: string, papel: AppRole, nota: string) => void;
  ocupado: boolean;
}) {
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<AppRole>('sdr');
  const [nota, setNota] = useState('');

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <form
      className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3 md:flex-row md:items-end"
      onSubmit={(evento) => {
        evento.preventDefault();
        if (!emailValido) return;
        aoAdicionar(email.trim(), papel, nota);
        setEmail('');
        setNota('');
      }}
    >
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="permitido-email" className="text-xs">
          E-mail
        </Label>
        <Input
          id="permitido-email"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="nome@empresa.com.br"
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
          className="h-11 md:h-8"
        />
      </div>
      <div className="space-y-1.5 md:w-40">
        <Label htmlFor="permitido-papel" className="text-xs">
          Entra como
        </Label>
        <Select value={papel} onValueChange={(novo) => setPapel(novo as AppRole)}>
          <SelectTrigger id="permitido-papel" className="toque h-11 w-full md:h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAPEIS_ATRIBUIVEIS.map((item) => (
              <SelectItem key={item} value={item}>
                {ROTULO_PAPEL[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="permitido-nota" className="text-xs">
          Observação
        </Label>
        <Input
          id="permitido-nota"
          placeholder="quem é e por quê"
          value={nota}
          onChange={(evento) => setNota(evento.target.value)}
          className="h-11 md:h-8"
        />
      </div>
      <Button type="submit" disabled={!emailValido || ocupado} className="toque h-11 md:h-8">
        <Plus aria-hidden="true" />
        {ocupado ? 'Adicionando...' : 'Adicionar'}
      </Button>
    </form>
  );
}
