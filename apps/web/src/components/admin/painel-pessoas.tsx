'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, UserCheck, UserMinus } from 'lucide-react';
import { toast } from 'sonner';

import { ROTULO_PAPEL, type AppRole } from '@/lib/auth/role';
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

import { DialogoConfirmar } from './confirmar';
import {
  adicionarPermitido,
  carregarPermitidos,
  carregarPessoas,
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
  const clienteDeConsultas = useQueryClient();

  const consulta = useQuery({
    queryKey: ['admin', 'pessoas'],
    queryFn: carregarPessoas,
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

  const pessoas = consulta.data.pessoas;
  const ativos = pessoas.filter((p) => p.ativo);
  // Diretório do time para traduzir id em nome na renderização (nunca dentro da consulta).
  const nomes = new Map(pessoas.map((p) => [p.id, p.nome]));
  const admins = ativos.filter((p) => p.papel === 'admin');

  const colunasPessoas: ColunaAdmin<Pessoa>[] = [
    {
      id: 'nome',
      rotulo: 'Pessoa',
      principal: true,
      largura: 'w-56',
      celula: (p) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{p.nome}</span>
          {p.id === sessao.id ? (
            <Badge variant="pilula" className="h-5 px-2 text-[11px] font-normal">
              você
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'papel',
      rotulo: 'Papel',
      largura: 'w-44',
      celula: (p) =>
        ehAdmin ? (
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
        ),
    },
    {
      id: 'oque',
      rotulo: 'O que esse papel faz',
      largura: 'hidden w-72 xl:table-cell',
      soNoDesktop: true,
      celula: (p) => <span className="text-muted-foreground">{O_QUE_O_PAPEL_FAZ[p.papel]}</span>,
    },
    {
      id: 'acesso',
      rotulo: 'Acesso',
      largura: 'w-24',
      celula: (p) =>
        p.ativo ? <span>Ativo</span> : <span className="text-muted-foreground">Desativado</span>,
    },
    {
      id: 'desde',
      rotulo: 'No CRM desde',
      largura: 'w-28',
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
          <strong>toda troca de papel só vale no próximo login da pessoa</strong> (RF-ADM-01).
        </p>
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
              ninguém. O PRD prevê três (Rafael, Luiz e Matheus).
            </p>
          </Aviso>
        ) : null}
        <ListaAdmin
          rotuloDaLista="Pessoas com acesso ao CRM"
          colunas={colunasPessoas}
          linhas={pessoas}
          chave={(p) => p.id}
          acoes={
            ehAdmin
              ? (p) =>
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
              : undefined
          }
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
          descricao="E-mails que podem entrar mesmo sem ser do domínio da Komune. Entrar na lista não cria a pessoa: ela nasce no CRM no primeiro login com Google."
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
