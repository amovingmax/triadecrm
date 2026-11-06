'use client';

import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import { ErroDaFoto, ordenarFotos, removerFoto, subirFoto, urlDaFoto } from './dados';
import { type FotoDoAnuncio, fraseDaRecusa } from './tipos';

/**
 * As fotos do anúncio (04/11/2026).
 *
 * A primeira é a capa (primary="true" no VRSync); as outras saem na ordem da
 * tela. Mover é por setas e "Pôr como capa", e não por arrastar: no celular o
 * arrastar briga com a rolagem, e a seta faz a mesma coisa com um toque.
 *
 * Cada foto vira JPEG no navegador (o portal só importa JPG, até 7 MB) e sobe
 * direto para o balde. Para ir ao ar basta uma (o formato do portal exige uma);
 * o máximo é 40. Sem mínimo maior: decisão do usuário em 05/11/2026.
 */
export function FotosDoAnuncio({
  anuncioId,
  fotos,
  editavel,
  aoMudar,
}: {
  anuncioId: string;
  fotos: FotoDoAnuncio[];
  editavel: boolean;
  aoMudar: () => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [subindo, setSubindo] = useState<{ feitas: number; total: number } | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const ordem = [...fotos].sort((a, b) => a.posicao - b.posicao);

  async function escolher(lista: FileList | null) {
    const arquivos = Array.from(lista ?? []).filter(
      (f) => f.type.startsWith('image/') || f.type === '',
    );
    if (entrada.current) entrada.current.value = '';
    if (arquivos.length === 0) return;
    const cabem = Math.max(0, 40 - ordem.length);
    const vao = arquivos.slice(0, cabem);
    if (vao.length < arquivos.length) toast.warning(`Só cabem mais ${cabem} fotos: o máximo é 40.`);

    setSubindo({ feitas: 0, total: vao.length });
    let falhas = 0;
    let motivo: string | null = null;
    // Uma de cada vez: a ordem de chegada é a ordem das fotos, e o celular não
    // segura dez fotos de 12 MP abertas ao mesmo tempo.
    for (const [i, arquivo] of vao.entries()) {
      try {
        await subirFoto(anuncioId, arquivo);
      } catch (e) {
        falhas += 1;
        motivo = e instanceof ErroDaFoto ? e.motivo : 'falhou';
      }
      setSubindo({ feitas: i + 1, total: vao.length });
    }
    setSubindo(null);
    aoMudar();
    if (falhas > 0) {
      toast.error(
        falhas === vao.length
          ? 'As fotos não subiram.'
          : `${falhas} de ${vao.length} fotos não subiram.`,
        {
          description: fraseDaRecusa(motivo),
        },
      );
    }
  }

  async function mover(de: number, para: number) {
    const nova = ordem.map((f) => f.id);
    const [foto] = nova.splice(de, 1);
    nova.splice(para, 0, foto!);
    setOcupada(foto!);
    const r = await ordenarFotos(anuncioId, nova);
    setOcupada(null);
    if (!r.ok) toast.error('A ordem não mudou.', { description: fraseDaRecusa(r.motivo) });
    aoMudar();
  }

  async function remover(foto: FotoDoAnuncio) {
    setOcupada(foto.id);
    try {
      await removerFoto(foto.id);
    } catch (e) {
      toast.error('A foto não saiu.', {
        description: fraseDaRecusa(e instanceof ErroDaFoto ? e.motivo : null),
      });
    }
    setOcupada(null);
    aoMudar();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {ordem.length === 0
          ? 'Ponha pelo menos uma foto para ir ao ar. A primeira é a capa.'
          : ordem.length === 1
            ? '1 foto, que é a capa.'
            : `${ordem.length} fotos. A primeira é a capa; as outras saem nesta ordem.`}
      </p>

      {ordem.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ordem.map((foto, i) => (
            <li key={foto.id} className="flex flex-col gap-1.5">
              <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- foto do balde público, a mesma URL que o portal baixa */}
                <img
                  src={urlDaFoto(foto.caminho)}
                  alt={`Foto ${i + 1}`}
                  loading="lazy"
                  className="size-full object-cover"
                />
                {i === 0 ? (
                  <span className="absolute top-1.5 left-1.5 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium">
                    Capa
                  </span>
                ) : null}
              </div>
              {editavel ? (
                <div className="flex items-center justify-between gap-1">
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="toque"
                      aria-label={`Mover a foto ${i + 1} para trás`}
                      disabled={i === 0 || ocupada !== null || subindo !== null}
                      onClick={() => void mover(i, i - 1)}
                    >
                      <ArrowLeft aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="toque"
                      aria-label={`Mover a foto ${i + 1} para a frente`}
                      disabled={i === ordem.length - 1 || ocupada !== null || subindo !== null}
                      onClick={() => void mover(i, i + 1)}
                    >
                      <ArrowRight aria-hidden="true" />
                    </Button>
                    {i > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="toque"
                        aria-label={`Pôr a foto ${i + 1} como capa`}
                        disabled={ocupada !== null || subindo !== null}
                        onClick={() => void mover(i, 0)}
                      >
                        <Star aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="toque"
                    aria-label={`Tirar a foto ${i + 1}`}
                    disabled={ocupada !== null || subindo !== null}
                    onClick={() => void remover(foto)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {editavel ? (
        <div>
          <input
            ref={entrada}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            id={`fotos-${anuncioId}`}
            onChange={(e) => void escolher(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            className="toque h-11 md:h-9"
            disabled={subindo !== null || ordem.length >= 40}
            onClick={() => entrada.current?.click()}
          >
            <ImagePlus aria-hidden="true" />
            {subindo
              ? `Subindo ${Math.min(subindo.feitas + 1, subindo.total)} de ${subindo.total}...`
              : 'Adicionar fotos'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
