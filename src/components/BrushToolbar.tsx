import React from 'react';
import {
  BrushConfig,
  BrushMode,
  InteractionMode,
  ViewConfig,
} from '../types';
import {
  Paintbrush,
  Eraser,
  Droplet,
  Move3d,
  Hand,
  Flame,
  Maximize,
  Sliders,
} from 'lucide-react';

interface BrushToolbarProps {
  brush: BrushConfig;
  onUpdateBrush: (updates: Partial<BrushConfig>) => void;
  view: ViewConfig;
  onUpdateView: (updates: Partial<ViewConfig>) => void;
  activeLayerName: string;
}

export const BrushToolbar: React.FC<BrushToolbarProps> = ({
  brush,
  onUpdateBrush,
  view,
  onUpdateView,
  activeLayerName,
}) => {
  return (
    <div className="bg-neutral-900/90 backdrop-blur-md border border-neutral-800 rounded-xl p-2 flex flex-wrap items-center justify-between gap-3 shadow-xl">
      {/* Primary Tool Mode */}
      <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800">
        <button
          onClick={() => onUpdateView({ activeTool: 'orbit' })}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
            view.activeTool === 'orbit'
              ? 'bg-neutral-800 text-white shadow-sm ring-1 ring-neutral-600'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
          }`}
          title="Orbit & inspect the 3D surface"
        >
          <Move3d className="w-3.5 h-3.5" />
          Navigate
        </button>

        <button
          onClick={() => onUpdateView({ activeTool: 'paint' })}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
            view.activeTool === 'paint'
              ? 'bg-cyan-600 text-white shadow-sm ring-1 ring-cyan-400'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
          }`}
          title="Paint ripples on the active layer"
        >
          <Paintbrush className="w-3.5 h-3.5" />
          Paint Mask
        </button>

        <button
          onClick={() => onUpdateView({ activeTool: 'move_obstacle' })}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
            view.activeTool === 'move_obstacle'
              ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
          }`}
          title="Drag stones across the surface"
        >
          <Hand className="w-3.5 h-3.5" />
          Move Stones
        </button>
      </div>

      {/* Brush Controls (Visible when in Paint mode or always configurable) */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Brush Mode: Paint vs Erase vs Smooth */}
        <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800">
          <button
            onClick={() => {
              onUpdateBrush({ mode: 'paint' });
              if (view.activeTool !== 'paint') onUpdateView({ activeTool: 'paint' });
            }}
            className={`p-1.5 rounded-md text-xs font-medium transition-colors ${
              brush.mode === 'paint' && view.activeTool === 'paint'
                ? 'bg-amber-600 text-white'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
            }`}
            title="Paint Dunes"
          >
            <Paintbrush className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              onUpdateBrush({ mode: 'erase' });
              if (view.activeTool !== 'paint') onUpdateView({ activeTool: 'paint' });
            }}
            className={`p-1.5 rounded-md text-xs font-medium transition-colors ${
              brush.mode === 'erase' && view.activeTool === 'paint'
                ? 'bg-rose-600 text-white'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
            }`}
            title="Erase / Carve Out Dunes"
          >
            <Eraser className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              onUpdateBrush({ mode: 'smooth' });
              if (view.activeTool !== 'paint') onUpdateView({ activeTool: 'paint' });
            }}
            className={`p-1.5 rounded-md text-xs font-medium transition-colors ${
              brush.mode === 'smooth' && view.activeTool === 'paint'
                ? 'bg-purple-600 text-white'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
            }`}
            title="Smooth Transitions"
          >
            <Droplet className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Brush Size */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-400 font-medium whitespace-nowrap">
            Size:
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="range"
              min="10"
              max="280"
              step="5"
              value={brush.size}
              onChange={(e) => onUpdateBrush({ size: parseInt(e.target.value, 10) })}
              className="w-24 h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <span className="font-mono text-xs text-neutral-200 w-12">
              {brush.size}mm
            </span>
          </div>
          {/* Quick size presets */}
          <div className="flex gap-1">
            {[30, 80, 160].map((sz) => (
              <button
                key={sz}
                onClick={() => onUpdateBrush({ size: sz })}
                className={`px-1.5 py-0.5 text-[10px] rounded font-mono transition-colors ${
                  brush.size === sz
                    ? 'bg-cyan-500 text-black font-bold'
                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                }`}
              >
                {sz}
              </button>
            ))}
          </div>
        </div>

        {/* Brush Hardness */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-400 font-medium whitespace-nowrap">
            Hardness:
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={brush.hardness}
            onChange={(e) => onUpdateBrush({ hardness: parseFloat(e.target.value) })}
            className="w-16 h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <span className="font-mono text-[11px] text-neutral-300">
            {Math.round(brush.hardness * 100)}%
          </span>
        </div>

        {/* Brush Flow / Opacity */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-400 font-medium whitespace-nowrap">
            Flow:
          </span>
          <input
            type="range"
            min="0.05"
            max="1.0"
            step="0.05"
            value={brush.opacity}
            onChange={(e) => onUpdateBrush({ opacity: parseFloat(e.target.value) })}
            className="w-16 h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <span className="font-mono text-[11px] text-neutral-300">
            {Math.round(brush.opacity * 100)}%
          </span>
        </div>

        {/* Mask Heatmap Overlay Toggle */}
        <button
          onClick={() => onUpdateView({ showMaskOverlay: !view.showMaskOverlay })}
          className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border transition-all ${
            view.showMaskOverlay
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/60'
              : 'bg-neutral-950 text-neutral-400 border-neutral-800 hover:text-neutral-200'
          }`}
          title="Toggle painted weight mask overlay"
        >
          <Flame className="w-3.5 h-3.5" />
          Mask Heatmap
        </button>
      </div>
    </div>
  );
};
