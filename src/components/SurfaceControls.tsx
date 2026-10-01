import React, { useState } from 'react';
import { SurfaceConfig } from '../types';
import { Box, CornerDownRight, Layers, Maximize2, Droplets, Waves, Check } from 'lucide-react';

interface SurfaceControlsProps {
  surface: SurfaceConfig;
  onUpdate: (updates: Partial<SurfaceConfig>) => void;
}

export const SurfaceControls: React.FC<SurfaceControlsProps> = ({ surface, onUpdate }) => {
  const maxFillet = Math.floor(Math.min(surface.width, surface.length) / 2);

  const handleNumberInput = (
    field: keyof SurfaceConfig,
    valStr: string,
    min: number,
    max: number
  ) => {
    const parsed = parseFloat(valStr);
    if (isNaN(parsed)) return;
    const clamped = Math.max(min, Math.min(max, parsed));
    onUpdate({ [field]: clamped });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Box className="w-4 h-4 text-cyan-400" />
        <span className="font-semibold text-xs text-neutral-200 tracking-wide uppercase">
          Canvas & CNC Stock Setup
        </span>
      </div>

      {/* Dimensions: Width & Length with editable numeric inputs + range sliders */}
      <div className="grid grid-cols-2 gap-3">
        {/* Width (X) */}
        <div className="space-y-1.5 p-2.5 bg-neutral-900/90 border border-neutral-800 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-300">Width (X)</span>
            <div className="flex items-center gap-1 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-750 focus-within:border-cyan-500 transition-colors">
              <input
                type="number"
                min={100}
                max={5000}
                step={10}
                value={surface.width}
                onChange={(e) => handleNumberInput('width', e.target.value, 100, 5000)}
                className="w-14 bg-transparent text-right font-mono text-xs text-cyan-400 font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[10px] text-neutral-400 select-none">mm</span>
            </div>
          </div>
          <input
            type="range"
            min="100"
            max="3000"
            step="10"
            value={Math.min(surface.width, 3000)}
            onChange={(e) => onUpdate({ width: parseInt(e.target.value, 10) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <div className="flex justify-between text-[10px] text-neutral-500">
            <span>100 mm</span>
            <span>3000+ mm</span>
          </div>
        </div>

        {/* Length (Z) */}
        <div className="space-y-1.5 p-2.5 bg-neutral-900/90 border border-neutral-800 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-300">Length (Z)</span>
            <div className="flex items-center gap-1 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-750 focus-within:border-cyan-500 transition-colors">
              <input
                type="number"
                min={100}
                max={3000}
                step={10}
                value={surface.length}
                onChange={(e) => handleNumberInput('length', e.target.value, 100, 3000)}
                className="w-14 bg-transparent text-right font-mono text-xs text-cyan-400 font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[10px] text-neutral-400 select-none">mm</span>
            </div>
          </div>
          <input
            type="range"
            min="100"
            max="1500"
            step="10"
            value={Math.min(surface.length, 1500)}
            onChange={(e) => onUpdate({ length: parseInt(e.target.value, 10) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <div className="flex justify-between text-[10px] text-neutral-500">
            <span>100 mm</span>
            <span>1500+ mm</span>
          </div>
        </div>
      </div>

      {/* Quick Canvas Size Presets */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-neutral-500 font-medium">Presets:</span>
        {[
          { label: '1300 × 400 (Default)', w: 1300, l: 400 },
          { label: '1000 × 350', w: 1000, l: 350 },
          { label: '800 × 300', w: 800, l: 300 },
          { label: '1600 × 450', w: 1600, l: 450 },
        ].map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onUpdate({ width: p.w, length: p.l })}
            className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
              surface.width === p.w && surface.length === p.l
                ? 'bg-cyan-950 border-cyan-500/80 text-cyan-300 font-semibold'
                : 'bg-neutral-900/60 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-850'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── TRUE PHYSICAL CORNER FILLET CUT ── */}
      <div className="p-3 bg-neutral-900/80 border border-cyan-500/30 rounded-xl space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
            <CornerDownRight className="w-3.5 h-3.5" />
            True Corner Fillet Radius
          </span>
          <div className="flex items-center gap-1 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-750 focus-within:border-cyan-500 transition-colors">
            <span className="text-[10px] text-cyan-400 font-mono font-bold">R</span>
            <input
              type="number"
              min={0}
              max={maxFillet}
              step={1}
              value={surface.cornerRadius}
              onChange={(e) => handleNumberInput('cornerRadius', e.target.value, 0, maxFillet)}
              className="w-10 bg-transparent text-right font-mono text-xs text-cyan-400 font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[10px] text-neutral-400 select-none">mm</span>
          </div>
        </div>

        <input
          type="range"
          min="0"
          max={maxFillet}
          step="1"
          value={Math.min(surface.cornerRadius, maxFillet)}
          onChange={(e) => onUpdate({ cornerRadius: parseInt(e.target.value, 10) })}
          className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
        />

        <div className="flex items-center justify-between text-[10px] text-neutral-400">
          <span>0 mm (Sharp Square)</span>
          <span className="text-cyan-400 font-mono">Max: {maxFillet} mm (Full Pill)</span>
        </div>

        <div className="text-[10px] text-neutral-400 bg-neutral-950/60 p-2 rounded border border-neutral-800">
          <strong className="text-neutral-300">True Physical Cut:</strong> Physically cuts the 3D canvas perimeter and vertical side walls into exact curved corner fillets for CNC routing.
        </div>
      </div>

      {/* ── GENTLE BASIN & PERIMETER EDGE BOWING ── */}
      <div className="p-3 bg-neutral-900/90 border border-sky-500/30 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Droplets className="w-4 h-4 text-sky-400" />
            <div>
              <span className="text-xs font-bold text-sky-300 block">
                Gentle Basin / Edge Bowing
              </span>
              <span className="text-[10px] text-neutral-400 block">
                Bows up edges so water pools in the middle
              </span>
            </div>
          </div>
          {/* Quick Toggle On/Off */}
          <button
            type="button"
            onClick={() => {
              if ((surface.basinLift || 0) > 0) {
                onUpdate({ basinLift: 0 });
              } else {
                onUpdate({ basinLift: 15, basinMargin: 0, basinProfile: 'conformal' });
              }
            }}
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors flex items-center gap-1 ${
              (surface.basinLift || 0) > 0
                ? 'bg-sky-500 text-neutral-950 shadow-sm'
                : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {(surface.basinLift || 0) > 0 ? (
              <>
                <Check className="w-3 h-3" />
                Active
              </>
            ) : (
              'Off'
            )}
          </button>
        </div>

        {/* Rim Lift (Bow Height) */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-300">
              Edge Bow Height (Rim Lift)
            </span>
            <div className="flex items-center gap-1 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-750 focus-within:border-sky-500 transition-colors">
              <span className="text-[10px] text-sky-400 font-mono font-bold">+</span>
              <input
                type="number"
                min={0}
                max={80}
                step={1}
                value={surface.basinLift || 0}
                onChange={(e) => handleNumberInput('basinLift', e.target.value, 0, 80)}
                className="w-10 bg-transparent text-right font-mono text-xs text-sky-400 font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[10px] text-neutral-400 select-none">mm</span>
            </div>
          </div>

          <input
            type="range"
            min="0"
            max="50"
            step="1"
            value={Math.min(surface.basinLift || 0, 50)}
            onChange={(e) => onUpdate({ basinLift: parseInt(e.target.value, 10) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-sky-400"
          />

          <div className="flex justify-between text-[10px] text-neutral-500">
            <span>0 mm (Flat Bed)</span>
            <span className="text-neutral-400">15 mm (Gentle)</span>
            <span>50 mm (Deep Dish)</span>
          </div>

          {/* Quick Basin Lift Presets */}
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {[
              { label: 'Flat', val: 0 },
              { label: 'Subtle', val: 8 },
              { label: 'Medium', val: 16 },
              { label: 'Deep', val: 28 },
            ].map((p) => (
              <button
                key={p.val}
                type="button"
                onClick={() =>
                  onUpdate({
                    basinLift: p.val,
                    basinMargin: surface.basinMargin ?? 0,
                    basinProfile: surface.basinProfile ?? 'conformal',
                  })
                }
                className={`py-1 px-1 rounded text-center transition-all border text-[10px] ${
                  (surface.basinLift || 0) === p.val
                    ? 'bg-sky-500/25 border-sky-500/70 text-sky-200 font-bold'
                    : 'bg-neutral-950/60 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                }`}
              >
                <div>{p.label}</div>
                <div className="text-[9px] text-neutral-500">+{p.val}mm</div>
              </button>
            ))}
          </div>
        </div>

        {/* Basin Span / Margin Selection (Only shown when basinLift > 0) */}
        {(surface.basinLift || 0) > 0 && (
          <div className="space-y-2.5 pt-2 border-t border-neutral-800/80">
            {/* Span Mode: Full Surface Bowl vs Perimeter Rim Margin */}
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-neutral-300">
                Basin Span & Transition
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onUpdate({ basinMargin: 0 })}
                  className={`p-1.5 rounded-lg border text-left transition-all ${
                    (surface.basinMargin || 0) === 0
                      ? 'bg-sky-950/50 border-sky-500/60 text-sky-200'
                      : 'bg-neutral-950/60 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <div className="text-[11px] font-semibold">Full Surface Dish</div>
                  <div className="text-[9px] text-neutral-400 leading-tight">
                    Continuous bowl across 100% of canvas to center
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdate({
                      basinMargin: surface.basinMargin && surface.basinMargin > 0 ? surface.basinMargin : 100,
                    })
                  }
                  className={`p-1.5 rounded-lg border text-left transition-all ${
                    (surface.basinMargin || 0) > 0
                      ? 'bg-sky-950/50 border-sky-500/60 text-sky-200'
                      : 'bg-neutral-950/60 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <div className="text-[11px] font-semibold">Edge Rim Margin</div>
                  <div className="text-[9px] text-neutral-400 leading-tight">
                    Level center bed with raised perimeter bevel
                  </div>
                </button>
              </div>
            </div>

            {/* If Edge Rim Margin is active, show margin slider */}
            {(surface.basinMargin || 0) > 0 && (
              <div className="space-y-1.5 bg-neutral-950/60 p-2 rounded-lg border border-neutral-800">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-300">Rim Bow Margin Width</span>
                  <div className="flex items-center gap-1 bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-750">
                    <input
                      type="number"
                      min={20}
                      max={maxFillet}
                      step={5}
                      value={surface.basinMargin || 100}
                      onChange={(e) => handleNumberInput('basinMargin', e.target.value, 20, maxFillet)}
                      className="w-12 bg-transparent text-right font-mono text-xs text-sky-400 font-semibold focus:outline-none"
                    />
                    <span className="text-[10px] text-neutral-400">mm</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="20"
                  max={Math.max(50, maxFillet)}
                  step="5"
                  value={Math.min(surface.basinMargin || 100, Math.max(50, maxFillet))}
                  onChange={(e) => onUpdate({ basinMargin: parseInt(e.target.value, 10) })}
                  className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-sky-400"
                />
                <div className="flex justify-between text-[10px] text-neutral-500">
                  <span>20 mm (Narrow Lip)</span>
                  <span>{Math.round(maxFillet)} mm (Wide Margin)</span>
                </div>
              </div>
            )}

            {/* Basin Profile Shape */}
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-neutral-300">
                Boundary Profile
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onUpdate({ basinProfile: 'conformal' })}
                  className={`py-1.5 px-2 rounded-lg border text-center transition-all ${
                    (surface.basinProfile || 'conformal') === 'conformal'
                      ? 'bg-sky-500/20 border-sky-500/60 text-sky-200 font-bold'
                      : 'bg-neutral-950/60 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <div className="text-[11px]">Conformal Rim</div>
                  <div className="text-[9px] text-neutral-400 font-normal">
                    Even height along all edges & fillets
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate({ basinProfile: 'radial' })}
                  className={`py-1.5 px-2 rounded-lg border text-center transition-all ${
                    surface.basinProfile === 'radial'
                      ? 'bg-sky-500/20 border-sky-500/60 text-sky-200 font-bold'
                      : 'bg-neutral-950/60 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <div className="text-[11px]">Elliptical Bowl</div>
                  <div className="text-[9px] text-neutral-400 font-normal">
                    Continuous smooth oval dish
                  </div>
                </button>
              </div>
            </div>

            {/* Basin Cross-Section Visual Schematic & Status */}
            <div className="p-2.5 bg-neutral-950 rounded-lg border border-sky-950 text-[10px] text-neutral-300 space-y-1.5">
              <div className="flex items-center justify-between text-sky-400 font-mono text-[11px]">
                <span>Edge: +{(surface.basinLift || 0).toFixed(1)}mm</span>
                <span className="text-neutral-500">→</span>
                <span className="text-emerald-400 font-bold">Center: 0.0mm (Lowest Point)</span>
                <span className="text-neutral-500">←</span>
                <span>Edge: +{(surface.basinLift || 0).toFixed(1)}mm</span>
              </div>
              <div className="relative w-full h-3 bg-neutral-900 rounded overflow-hidden flex items-end">
                <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 20">
                  <path
                    d="M 0,2 Q 50,18 100,2 L 100,20 L 0,20 Z"
                    fill="currentColor"
                    className="text-sky-500/20"
                  />
                  <path
                    d="M 0,2 Q 50,18 100,2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="text-sky-400"
                  />
                </svg>
              </div>
              <div className="text-neutral-400 text-[9px] leading-relaxed">
                Water collection basin active: The edge bows up around the perimeter so low points converge in the middle.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Base Thickness & Quality */}
      <div className="p-3 bg-neutral-900/70 border border-neutral-800 rounded-xl space-y-3">
        {/* Base Thickness */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-neutral-300 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-neutral-400" />
              Solid Base Thickness
            </span>
            <div className="flex items-center gap-1 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-750 focus-within:border-amber-500 transition-colors">
              <input
                type="number"
                min={2}
                max={100}
                step={1}
                value={surface.baseThickness}
                onChange={(e) => handleNumberInput('baseThickness', e.target.value, 2, 100)}
                className="w-10 bg-transparent text-right font-mono text-xs text-amber-400 font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[10px] text-neutral-400 select-none">mm</span>
            </div>
          </div>
          <input
            type="range"
            min="2"
            max="40"
            step="1"
            value={Math.min(surface.baseThickness, 40)}
            onChange={(e) => onUpdate({ baseThickness: parseInt(e.target.value, 10) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
          <span className="text-[10px] text-neutral-500 block">
            Solid substrate depth below lowest machined dune valley.
          </span>
        </div>

        {/* Mesh Resolution & Density */}
        <div className="space-y-2 pt-1 border-t border-neutral-800/80">
          <div className="flex justify-between items-center text-xs">
            <span className="text-neutral-300 font-medium flex items-center gap-1">
              Mesh Resolution (CNC Preview Density)
            </span>
            <div className="flex items-center gap-1 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-750 focus-within:border-cyan-500 transition-colors">
              <input
                type="number"
                min={50}
                max={1200}
                step={10}
                value={surface.resolution}
                onChange={(e) => handleNumberInput('resolution', e.target.value, 50, 1200)}
                className="w-12 bg-transparent text-right font-mono text-xs text-cyan-400 font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[10px] text-neutral-400 select-none">pts</span>
            </div>
          </div>

          <input
            type="range"
            min="100"
            max="800"
            step="10"
            value={Math.min(surface.resolution, 800)}
            onChange={(e) => onUpdate({ resolution: parseInt(e.target.value, 10) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />

          <div className="flex justify-between text-[10px] text-neutral-500">
            <span>100 pts (Fast)</span>
            <span>800+ pts (Ultra-Res)</span>
          </div>

          {/* Quick Resolution Presets */}
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {[
              { label: 'Standard', res: 200, desc: 'Fast' },
              { label: 'High', res: 350, desc: 'Detailed' },
              { label: 'Ultra', res: 500, desc: 'Crisp' },
              { label: 'Extreme', res: 700, desc: 'HD CNC' },
            ].map((p) => (
              <button
                key={p.res}
                type="button"
                onClick={() => onUpdate({ resolution: p.res })}
                className={`py-1 px-1.5 rounded text-center transition-all border ${
                  surface.resolution === p.res
                    ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200 font-bold'
                    : 'bg-neutral-950/60 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                }`}
              >
                <div className="text-[11px] leading-tight">{p.label}</div>
                <div className="text-[9px] text-neutral-500">{p.res} pts</div>
              </button>
            ))}
          </div>

          {/* Live Stepover / Grid Math Readout */}
          <div className="text-[10px] text-neutral-400 bg-neutral-950/70 p-2 rounded-lg border border-neutral-800/80 flex items-center justify-between">
            <div>
              <span className="text-neutral-500">Grid: </span>
              <span className="text-neutral-200 font-mono font-semibold">
                {surface.resolution} × {Math.max(16, Math.round((surface.resolution * surface.length) / surface.width))}
              </span>
            </div>
            <div>
              <span className="text-neutral-500">Vertex Pitch: </span>
              <span className="text-cyan-400 font-mono font-semibold">
                {(surface.width / surface.resolution).toFixed(2)} mm
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
