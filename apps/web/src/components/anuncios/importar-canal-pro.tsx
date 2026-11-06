'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';

import { ErroDePlanilha, lerArquivo } from '@/components/importacao/planilha';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import {
  CHAVE_DO_CANAL_PRO,
  CHAVE_DOS_ANUNCIOS,
  CHAVE_DOS_MANUAIS,
  importarRelatorio,
} from './dados';
import { lerRelatorioDoCanalPro, type RelatorioLido } from './relatorio-canal-pro';
import { fraseDaRecusa, URL_DO_CANAL_PRO } from './tipos';

/**
 * Atualizar do Canal Pro (04/11/2026; um clique desde 06/11/2026).
 *
 * O Grupo OLX não tem API para ler os anúncios do Canal Pro: a lista vem do
 * relatório que o próprio Canal Pro exporta. Escolhido o arquivo, a folha o lê no
 * navegador e já manda ao banco, sem tela de conferência: o banco atualiza a
 * situação, as visitas e os contatos e traz sozinho o que só existe lá
 * (`canal_pro_importar`). Antes (04 e 05/11) a folha mostrava as colunas
 * reconhecidas e as primeiras linhas e pedia um segundo clique; as colunas do
 * relatório de verdade já são conhecidas, e o que ela não reconhece vira aviso.
 *
 * Importar não mexe no Canal Pro nem no arquivo do Grupo OLX: só atualiza a
 * lista do CRM. Quem estava na importação anterior e não está nesta saiu do
 * Canal Pro.
 */
export function ImportarCanalPro({
  aberto,
  aoMudar,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
}) {
  const cliente = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [recusado, setRecusado] = useState<Extract<RelatorioLido, { ok: false }> | null>(null);
  const [erro, setErro] = useState<{ titulo: string; comoResolver: string } | null>(null);
  const [importando, setImportando] = useState<number | null>(null);

  function recomecar() {
    setArquivo(null);
    setRecusado(null);
    setErro(null);
    if (entrada.current) entrada.current.value = '';
  }

  async function escolher(lista: FileList | null) {
    const f = lista?.[0];
    if (!f) return;
    setArquivo(f.name);
    setErro(null);
    setRecusado(null);
    let lido: RelatorioLido;
    try {
      lido = lerRelatorioDoCanalPro(lerArquivo(f.name, new Uint8Array(await f.arrayBuffer())));
    } catch (e) {
      setErro(
        e instanceof ErroDePlanilha
          ? { titulo: e.message, comoResolver: e.comoResolver }
          : {
              titulo: 'Não consegui ler o arquivo.',
              comoResolver: 'Baixe de novo pelo link do e-mail e tente outra vez.',
            },
      );
      return;
    }
    if (!lido.ok) {
      setRecusado(lido);
      return;
    }
    await importar(lido.anuncios);
  }

  async function importar(anuncios: Extract<RelatorioLido, { ok: true }>['anuncios']) {
    setImportando(anuncios.length);
    const r = await importarRelatorio(anuncios);
    setImportando(null);
    if (!r.ok) {
      setErro({ titulo: 'A lista não foi importada.', comoResolver: fraseDaRecusa(r.motivo) });
      return;
    }
    toast.success(
      `${r.anuncios} ${r.anuncios === 1 ? 'anúncio do Canal Pro' : 'anúncios do Canal Pro'} atualizados.`,
      {
        description:
          [
            r.trazidos
              ? `${r.trazidos} ${r.trazidos === 1 ? 'imóvel que só existia lá veio' : 'imóveis que só existiam lá vieram'} para o CRM`
              : null,
            r.novos ? `${r.novos} novos` : null,
            r.sairam ? `${r.sairam} saíram do Canal Pro desde a última vez` : null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
      },
    );
    void cliente.invalidateQueries({ queryKey: CHAVE_DOS_MANUAIS });
    void cliente.invalidateQueries({ queryKey: CHAVE_DO_CANAL_PRO });
    // O que só existia no Canal Pro virou anúncio do CRM.
    void cliente.invalidateQueries({ queryKey: CHAVE_DOS_ANUNCIOS });
    recomecar();
    aoMudar(false);
  }

  return (
    <Sheet
      open={aberto}
      onOpenChange={(estado) => {
        if (importando !== null) return;
        if (!estado) recomecar();
        aoMudar(estado);
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Atualizar do Canal Pro</SheetTitle>
          <SheetDescription>
            Traz do relatório do Canal Pro a situação de cada anúncio (ativo ou inativo), as visitas
            e os contatos, e os imóveis cadastrados direto lá. Nada muda no Canal Pro.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              Entre no{' '}
              <a
                href={URL_DO_CANAL_PRO}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                Canal Pro
              </a>
              , abra Anúncios e clique em Exportar relatório (todos os anúncios).
            </li>
            <li>O link chega por e-mail: baixe o arquivo.</li>
            <li>Escolha o arquivo aqui embaixo. O CRM atualiza na hora.</li>
          </ol>

          <div>
            <input
              ref={entrada}
              type="file"
              accept=".csv,.xlsx,.xlsm,.txt"
              className="sr-only"
              onChange={(e) => void escolher(e.target.files)}
            />
            <Button
              type="button"
              className="toque h-11 md:h-9"
              disabled={importando !== null}
              onClick={() => entrada.current?.click()}
            >
              <FileSpreadsheet aria-hidden="true" />
              {importando !== null
                ? `Atualizando ${importando} ${importando === 1 ? 'anúncio' : 'anúncios'}...`
                : arquivo
                  ? 'Escolher outro arquivo'
                  : 'Escolher o relatório'}
            </Button>
            {arquivo ? (
              <p className="mt-1.5 truncate text-xs text-muted-foreground">{arquivo}</p>
            ) : null}
          </div>

          {erro ? (
            <div role="alert" className="rounded-lg border border-hairline p-3 text-sm">
              <p className="font-medium">{erro.titulo}</p>
              <p className="text-muted-foreground">{erro.comoResolver}</p>
            </div>
          ) : null}

          {recusado ? (
            <div role="alert" className="rounded-lg border border-hairline p-3 text-sm">
              <p className="font-medium">
                {recusado.motivo === 'sem_linhas'
                  ? 'O arquivo não tem nenhum anúncio.'
                  : 'Não achei a coluna do código do anúncio.'}
              </p>
              <p className="text-muted-foreground">
                Colunas do arquivo: {recusado.cabecalho.filter(Boolean).join(', ') || 'nenhuma'}.
                Confira se é o relatório de anúncios do Canal Pro; se for, mande este arquivo para
                quem cuida do CRM, para o CRM aprender os nomes.
              </p>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
