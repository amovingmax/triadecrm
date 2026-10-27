'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, UserRound } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { formatarTelefone } from '@/components/parceiros/formatos';

import { telefoneDoCartao } from './conteudo';
import { carregarConversas, CHAVE_CONVERSAS } from './dados';
import {
  CAMPO,
  Campo,
  JanelaDoAnexo,
  useEnvioDoAnexo,
  type DestinoDoAnexo,
} from './janela-do-anexo';
import { normalizar } from './montagem';

/**
 * Mandar um cartão de contato (27/10/2026): alguém da base — parceiro com
 * telefone à vista ou cliente que já escreveu — ou um nome e um número
 * digitados. O contato recebe o cartão do WhatsApp, com o botão de conversar.
 *
 * O telefone mascarado (o papel da pessoa não vê o número) não entra na lista:
 * mandar no cartão um número que a tela esconde seria revelar por outra porta.
 */
export function EnviarContato({
  aberto,
  aoFechar,
  destino,
}: {
  aberto: boolean;
  aoFechar: () => void;
  destino: DestinoDoAnexo;
}) {
  return (
    <JanelaDoAnexo aberto={aberto} aoFechar={aoFechar} titulo="Mandar contato">
      <Formulario destino={destino} aoFechar={aoFechar} />
    </JanelaDoAnexo>
  );
}

type DaBase = { chave: string; nome: string; telefone: string };

function Formulario({ destino, aoFechar }: { destino: DestinoDoAnexo; aoFechar: () => void }) {
  const lista = useQuery({ queryKey: CHAVE_CONVERSAS, queryFn: carregarConversas });
  const [busca, setBusca] = useState('');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const { enviar, indo } = useEnvioDoAnexo({
    ...destino,
    aoEnviar: () => {
      destino.aoEnviar();
      aoFechar();
    },
  });

  const daBase = useMemo<DaBase[]>(() => {
    const dados = lista.data;
    if (!dados) return [];
    const parceiros = dados.organizacoes.flatMap((o) =>
      o.phone_e164 && !o.phone_is_masked && o.name
        ? [{ chave: `o:${o.id}`, nome: o.name, telefone: o.phone_e164 }]
        : [],
    );
    const clientes = dados.fios.flatMap((f) =>
      f.organization_id === null && f.peer_nome?.trim()
        ? [{ chave: `f:${f.id}`, nome: f.peer_nome.trim(), telefone: f.peer_phone_e164 }]
        : [],
    );
    return [...parceiros, ...clientes];
  }, [lista.data]);

  const procura = normalizar(busca);
  const achados =
    procura.length >= 2
      ? daBase.filter((c) => normalizar(c.nome).includes(procura)).slice(0, 8)
      : [];
  const numero = telefoneDoCartao(telefone);
  const pronto = nome.trim() !== '' && numero !== null;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pronto || indo || !numero) return;
        void enviar({
          tipo: 'contacts',
          conteudo: {
            contatos: [
              {
                nome: nome.trim(),
                // `wa_id` é o que faz o cartão ter o botão "Conversar" no WhatsApp.
                telefones: [{ numero, tipo: 'CELL', wa_id: numero.replace(/\D/g, '') }],
              },
            ],
          },
        });
      }}
    >
      <Campo rotulo="Procurar na base">
        <span className="relative block">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome do parceiro ou do cliente"
            autoComplete="off"
            className={cn(CAMPO, 'pl-9')}
          />
        </span>
      </Campo>
      {achados.length > 0 ? (
        <ul className="overflow-hidden rounded-lg border border-hairline">
          {achados.map((c) => (
            <li key={c.chave} className="border-b border-hairline last:border-b-0">
              <button
                type="button"
                onClick={() => {
                  setNome(c.nome);
                  setTelefone(c.telefone);
                  setBusca('');
                }}
                className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
              >
                <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                <span className="numerico shrink-0 text-xs text-muted-foreground">
                  {formatarTelefone(c.telefone)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Campo rotulo="Nome">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={100}
          className={CAMPO}
        />
      </Campo>
      <Campo
        rotulo="Telefone"
        dica={
          telefone.trim() !== '' && numero === null
            ? 'Número com DDD, como 84 99999-0000.'
            : undefined
        }
      >
        <input
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          inputMode="tel"
          autoComplete="off"
          placeholder="84 99999-0000"
          className={CAMPO}
        />
      </Campo>

      <Button type="submit" disabled={!pronto || indo} className="toque h-11 md:h-9">
        <UserRound aria-hidden="true" />
        {indo ? 'Mandando...' : 'Mandar contato'}
      </Button>
    </form>
  );
}
