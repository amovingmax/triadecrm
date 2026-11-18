'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CircleCheck, Search, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { estadoDoCartao, parecidosNoCrm } from './aba-dos-anuncios';
import { EtiquetaDaSituacao } from './cartao-do-anuncio';
import { type AnuncioNaLista, precoDoAnuncio, TIPOS_DE_IMOVEL, tipoDeImovel } from './tipos';

/**
 * "Novo anúncio" que confere antes (18/11/2026): com o tipo, a cidade, o bairro e
 * a área, o CRM procura um imóvel igual entre os anúncios que já tem. Achando,
 * oferece abrir o que existe; senão, o editor de sempre abre com esses campos já
 * preenchidos. "É outro imóvel" segue mesmo assim.
 */
export function NovoAnuncioConferido({
  aberto,
  aoMudar,
  anuncios,
  aoAbrir,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  anuncios: readonly AnuncioNaLista[];
  aoAbrir: (anuncioId: string) => void;
}) {
  const router = useRouter();
  const [tipo, setTipo] = useState('');
  const [cidade, setCidade] = useState('Natal');
  const [bairro, setBairro] = useState('');
  const [area, setArea] = useState('');
  const metros = Number(area.replace(/\D/g, '')) || null;
  const pronto = tipo !== '' && cidade.trim() !== '' && metros !== null;
  const iguais = useMemo(() => {
    const ids = parecidosNoCrm({ tipo, cidade, bairro, area: metros }, anuncios);
    return anuncios.filter((a) => ids.includes(a.id));
  }, [tipo, cidade, bairro, metros, anuncios]);

  function continuar() {
    const busca = new URLSearchParams();
    if (tipo) busca.set('tipo', tipo);
    if (cidade.trim()) busca.set('cidade', cidade.trim());
    if (bairro.trim()) busca.set('bairro', bairro.trim());
    if (metros) busca.set('area', String(metros));
    router.push(`/anuncios/novo?${busca.toString()}`);
  }

  return (
    <Dialog open={aberto} onOpenChange={aoMudar}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo anúncio</DialogTitle>
          <DialogDescription>
            Primeiro o básico, para o CRM conferir se o imóvel já existe. O resto vem no editor de
            sempre.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pronto && iguais.length === 0) continuar();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="novo-tipo">Tipo</Label>
            <select
              id="novo-tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="h-11 rounded-full border border-input bg-transparent px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9"
            >
              <option value="">Escolha</option>
              {TIPOS_DE_IMOVEL.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="novo-cidade">Cidade</Label>
            <Input id="novo-cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="novo-bairro">Bairro</Label>
            <Input
              id="novo-bairro"
              value={bairro}
              placeholder="Ex.: Capim Macio"
              onChange={(e) => setBairro(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="novo-area">Área (m²)</Label>
            <Input
              id="novo-area"
              value={area}
              inputMode="numeric"
              placeholder="Ex.: 3000"
              onChange={(e) => setArea(e.target.value)}
            />
          </div>
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>

        {!pronto ? (
          <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
            <Search className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Com tipo, cidade e área, o CRM procura um imóvel igual antes de criar.
          </p>
        ) : iguais.length ? (
          <div className="flex flex-col gap-2 rounded-xl bg-morno-fundo p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-morno-texto">
              <TriangleAlert className="size-4" aria-hidden="true" />
              {iguais.length === 1
                ? 'Este imóvel parece já estar no CRM'
                : `${iguais.length} anúncios parecidos já estão no CRM`}
            </p>
            <ul className="flex flex-col gap-2">
              {iguais.map((a) => (
                <li key={a.id} className="flex flex-col gap-1.5 rounded-lg bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-hairline px-2 py-0.5 text-xs font-medium numerico">
                      {a.codigo}
                    </span>
                    <EtiquetaDaSituacao estado={estadoDoCartao(a)} />
                  </div>
                  <p>{a.titulo.trim() || 'Sem título'}</p>
                  <p className="text-xs text-muted-foreground numerico">
                    {tipoDeImovel(a.tipo).rotulo}
                    {(a.area_total ?? a.area_util)
                      ? ` · ${(a.area_total ?? a.area_util)!.toLocaleString('pt-BR')} m²`
                      : ''}
                    {[a.bairro, a.cidade].filter(Boolean).length
                      ? ` · ${[a.bairro, a.cidade].filter(Boolean).join(', ')}`
                      : ''}
                    {` · ${precoDoAnuncio(a)}`}
                  </p>
                  <Button
                    size="sm"
                    className="toque h-11 w-fit md:h-8"
                    onClick={() => {
                      aoMudar(false);
                      aoAbrir(a.id);
                    }}
                  >
                    Abrir {a.codigo}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="flex items-center gap-2 rounded-xl bg-cliente-fundo p-3 text-sm text-cliente-texto">
            <CircleCheck className="size-4" aria-hidden="true" />
            Nenhum imóvel parecido no CRM. Pode criar.
          </p>
        )}

        <DialogFooter className="gap-2">
          {pronto && iguais.length ? (
            <Button variant="ghost" className="toque h-11 md:h-9" onClick={continuar}>
              É outro imóvel: criar mesmo assim
            </Button>
          ) : null}
          <Button
            className="toque h-11 md:h-9"
            disabled={!pronto || iguais.length > 0}
            onClick={continuar}
          >
            Continuar no editor
            <ArrowRight aria-hidden="true" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
