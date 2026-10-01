import React, { useEffect, useRef } from 'react';
import {
  RippleLayer,
  BlendMode,
  RippleMode,
} from '../types';
import {
  createNewLayer,
  clearMask,
  fillMask,
  invertMask,
  MASK_RES,
} from '../utils/mask';
import {
  Layers,
  Plus,
  Eye,
  EyeOff,
  Trash2,
  Copy,
  Paintbrush,
  Sparkles,
  Maximize2,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';

interface LayerPanelProps {
  layers: RippleLayer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string) => void;
  onUpdateLayer: (id: string, updates: Partial<RippleLayer>) => void;
  onAddLayer: (layer: RippleLayer) => void;
  onDeleteLayer: (id: string) => void;
  onDuplicateLayer: (layer: RippleLayer) => void;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({
  layers,
  selectedLayerId,
  onSelectLayer,
  onUpdateLayer,
  onAddLayer,
  onDeleteLayer,
  onDuplicateLayer,
}) => {
  const activeLayer = layers.find((l) => l.id === selectedLayerId) || layers[0];
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Render 2D mini-map preview of active layer's painted mask
  useEffect(() => {
    if (!miniCanvasRef.current || !activeLayer) return;
    const canvas = miniCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(MASK_RES, MASK_RES);
    const mask = activeLayer.maskData;

    for (let i = 0; i < mask.length; i++) {
      const val = mask[i];
      // Draw white/amber on dark background
      imgData.data[i * 4 + 0] = Math.round(val * 245);
      imgData.data[i * 4 + 1] = Math.round(val * 158);
      imgData.data[i * 4 + 2] = Math.round(val * 11);
      imgData.data[i * 4 + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
  }, [activeLayer, activeLayer?.maskData]);

  const handleAddNew = (mode: RippleMode = 'warped_perlin', name?: string) => {
    const newL = createNewLayer(name, mode, 0.0); // start with empty mask for painting
    onAddLayer(newL);
    onSelectLayer(newL.id);
  };

  return (
    <div className="space-y-4">
      {/* Header & Add button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span className="font-semibold text-xs text-neutral-200 tracking-wide uppercase">
            Ripple Layers ({layers.length})
          </span>
        </div>
        <button
          onClick={() => handleAddNew('warped_perlin')}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 rounded-md transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Layer
        </button>
      </div>

      {/* Layer List */}
      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {layers.map((layer) => {
          const isSelected = layer.id === selectedLayerId;
          return (
            <div
              key={layer.id}
              onClick={() => onSelectLayer(layer.id)}
              className={`group relative p-2.5 rounded-lg border transition-all cursor-pointer ${
                isSelected
                  ? 'bg-neutral-800/90 border-cyan-500/60 shadow-md ring-1 ring-cyan-500/30'
                  : 'bg-neutral-900/60 border-neutral-800/80 hover:border-neutral-700 hover:bg-neutral-800/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: layer.colorTag }}
                  />
                  <input
                    type="text"
                    value={layer.name}
                    onChange={(e) =>
                      onUpdateLayer(layer.id, { name: e.target.value })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent font-medium text-xs text-neutral-200 focus:outline-none focus:bg-neutral-950 px-1 py-0.5 rounded truncate max-w-[130px]"
                  />
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateLayer(layer.id, { visible: !layer.visible });
                    }}
                    className={`p-1 rounded hover:bg-neutral-700/60 transition-colors ${
                      layer.visible ? 'text-neutral-300' : 'text-neutral-600'
                    }`}
                    title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                  >
                    {layer.visible ? (
                      <Eye className="w-3.5 h-3.5" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateLayer(layer);
                    }}
                    className="p-1 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/60 rounded transition-colors"
                    title="Duplicate Layer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>

                  {layers.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteLayer(layer.id);
                      }}
                      className="p-1 text-neutral-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors"
                      title="Delete Layer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Layer details row: Blend Mode & Opacity */}
              <div className="flex items-center gap-3 text-[11px] text-neutral-400">
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-[10px] uppercase font-mono text-neutral-500">
                    Blend:
                  </span>
                  <select
                    value={layer.blendMode}
                    onChange={(e) =>
                      onUpdateLayer(layer.id, {
                        blendMode: e.target.value as BlendMode,
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="bg-neutral-900 border border-neutral-700/70 rounded px-1.5 py-0.5 text-xs text-neutral-300 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="add">Add (+)</option>
                    <option value="max">Max (Ridge Peak)</option>
                    <option value="multiply">Multiply (×)</option>
                    <option value="replace">Replace</option>
                  </select>

                  {layer.invert && (
                    <span className="text-[9px] px-1 py-0.2 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded font-mono">
                      INV
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 w-28">
                  <span className="text-[10px] uppercase font-mono text-neutral-500">
                    Weight:
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={layer.opacity}
                    onChange={(e) =>
                      onUpdateLayer(layer.id, {
                        opacity: parseFloat(e.target.value),
                      })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <span className="font-mono text-[10px] text-neutral-300 w-6 text-right">
                    {Math.round(layer.opacity * 100)}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Layer Mask Inspector & Quick Actions */}
      {activeLayer && (
        <div className="p-3 bg-neutral-900/90 rounded-lg border border-neutral-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
              <Paintbrush className="w-3.5 h-3.5 text-amber-400" />
              Layer Mask: <span className="text-amber-400">{activeLayer.name}</span>
            </span>
            <span className="text-[10px] text-neutral-500 font-mono">256×256 px</span>
          </div>

          <div className="flex gap-3 items-center">
            {/* 2D Mini Mask Canvas */}
            <div className="relative w-20 h-16 rounded border border-neutral-700 bg-black overflow-hidden flex-shrink-0 shadow-inner">
              <canvas
                ref={miniCanvasRef}
                width={MASK_RES}
                height={MASK_RES}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 border border-neutral-600/30 pointer-events-none" />
            </div>

            {/* Quick Mask Buttons */}
            <div className="grid grid-cols-2 gap-1.5 flex-1">
              <button
                onClick={() =>
                  onUpdateLayer(activeLayer.id, {
                    maskData: fillMask(activeLayer.maskData),
                  })
                }
                className="px-2 py-1 text-[11px] font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded border border-neutral-700/80 transition-colors"
                title="Fill entire surface 100% with this layer"
              >
                Fill 100%
              </button>

              <button
                onClick={() =>
                  onUpdateLayer(activeLayer.id, {
                    maskData: clearMask(activeLayer.maskData, 0.0),
                  })
                }
                className="px-2 py-1 text-[11px] font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded border border-neutral-700/80 transition-colors"
                title="Clear mask to 0% (ready for brush painting)"
              >
                Clear (0%)
              </button>

              <button
                onClick={() =>
                  onUpdateLayer(activeLayer.id, {
                    maskData: invertMask(activeLayer.maskData),
                  })
                }
                className="px-2 py-1 text-[11px] font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded border border-neutral-700/80 transition-colors col-span-2"
                title="Invert painted areas"
              >
                Invert Mask
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
