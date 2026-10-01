import React from 'react';
import { RippleLayer, RippleMode, ElevationLiftMode } from '../types';
import {
  Waves,
  Wind,
  Compass,
  Shuffle,
  Mountain,
  Sparkles,
  Sliders,
  Maximize2,
  ArrowUpDown,
} from 'lucide-react';

interface LayerControlsProps {
  layer: RippleLayer | null;
  onUpdate: (updates: Partial<RippleLayer>) => void;
}

export const LayerControls: React.FC<LayerControlsProps> = ({ layer, onUpdate }) => {
  if (!layer) {
    return (
      <div className="p-4 text-center text-xs text-neutral-500 bg-neutral-900/40 rounded-lg border border-neutral-800/80">
        Select or add a ripple layer to configure parametric dune controls.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pattern Archetype Mode Selector */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
          <Waves className="w-3.5 h-3.5 text-cyan-400" />
          Natural Dune Archetype
        </label>
        <select
          value={layer.mode}
          onChange={(e) => onUpdate({ mode: e.target.value as RippleMode })}
          className="w-full bg-neutral-900 border border-neutral-700/80 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-cyan-500"
        >
          <option value="warped_perlin">🌊 Warped Perlin (Natural Sweeping Dunes)</option>
          <option value="stretched_perlin">🏜 Stretched Anisotropic Perlin (Long Sand Ridges)</option>
          <option value="ridged_crests">⛰ Ridged Sand Crests (Knife-Edge Barchans)</option>
          <option value="windblown_drift">💨 Wind-Blown Sand Drift (Aerodynamic Streaks)</option>
          <option value="tidal_flats">🌊 Braided Tidal Flats (Tide Sand Wash)</option>
          <option value="rolling_ripples">〰️ Rolling Ocean Swell (Organic Random Ripples)</option>
          <option value="sand_hummocks">🏜️ Desert Sand Hummocks (Discrete Lumps & Mounds)</option>
          <option value="concentric">◎ Concentric Organic Ripple</option>
        </select>
      </div>

      {/* ── ELEVATION DIRECTION & 3D LIFT POLARITY ── */}
      <div className="p-3 bg-neutral-900/80 border border-amber-500/30 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
            <Mountain className="w-3.5 h-3.5" />
            Elevation Direction & 3D Lift
          </span>
          <button
            onClick={() => onUpdate({ invert: !layer.invert })}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors border ${
              layer.invert
                ? 'bg-amber-500/30 border-amber-400 text-amber-200'
                : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-750'
            }`}
            title="Invert shape polarity (flips crests and troughs)"
          >
            <ArrowUpDown className="w-3 h-3" />
            {layer.invert ? 'Inverted (Flipped)' : 'Normal'}
          </button>
        </div>

        {/* 3-way Lift Mode Selection */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-neutral-400">
            Vertical 3D Relief Behavior:
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => onUpdate({ liftMode: 'positive_lift' })}
              className={`p-1.5 rounded-lg border text-center transition-all ${
                (layer.liftMode || 'positive_lift') === 'positive_lift'
                  ? 'bg-amber-500/20 border-amber-500/60 text-amber-200 shadow-sm'
                  : 'bg-neutral-950/60 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
              }`}
            >
              <div className="text-xs font-bold flex items-center justify-center gap-1">
                <span>🏔️</span> Lift Up
              </div>
              <div className="text-[9px] text-neutral-400 mt-0.5">0 to +{layer.amplitude}mm</div>
            </button>

            <button
              onClick={() => onUpdate({ liftMode: 'centered' })}
              className={`p-1.5 rounded-lg border text-center transition-all ${
                layer.liftMode === 'centered'
                  ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200 shadow-sm'
                  : 'bg-neutral-950/60 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
              }`}
            >
              <div className="text-xs font-bold flex items-center justify-center gap-1">
                <span>↕️</span> Centered
              </div>
              <div className="text-[9px] text-neutral-400 mt-0.5">±{layer.amplitude}mm</div>
            </button>

            <button
              onClick={() => onUpdate({ liftMode: 'carved_groove' })}
              className={`p-1.5 rounded-lg border text-center transition-all ${
                layer.liftMode === 'carved_groove'
                  ? 'bg-rose-500/20 border-rose-500/60 text-rose-200 shadow-sm'
                  : 'bg-neutral-950/60 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
              }`}
            >
              <div className="text-xs font-bold flex items-center justify-center gap-1">
                <span>⛏️</span> Carved
              </div>
              <div className="text-[9px] text-neutral-400 mt-0.5">0 to -{layer.amplitude}mm</div>
            </button>
          </div>
        </div>

        <div className="text-[10px] text-neutral-400 bg-neutral-950/60 p-2 rounded border border-neutral-800/80">
          <strong className="text-neutral-300">Lift Up (Positive Relief):</strong> Dunes, braided tidal bars, and wind streaks rise upward out of the stock canvas. Use <span className="text-amber-300 font-semibold">Invert</span> to flip between raised ridges and inverted shapes.
        </div>
      </div>

      {/* ── STRETCHED DUNE PARAMETERS (EXTENDED REALISM) ── */}
      <div className="p-3 bg-neutral-900/70 border border-cyan-500/20 rounded-lg space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
            <Maximize2 className="w-3.5 h-3.5" />
            Long Sweeping Dune Adjustments
          </span>
          <span className="text-[10px] text-cyan-400/80 font-mono">Anisotropic</span>
        </div>

        {/* Stretch Ratio (1x to 50x) */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-neutral-300">Dune Elongation (Stretch Ratio)</span>
            <span className="font-mono text-cyan-400">{layer.stretchRatio.toFixed(1)}×</span>
          </div>
          <input
            type="range"
            min="1.0"
            max="40.0"
            step="0.5"
            value={layer.stretchRatio}
            onChange={(e) => onUpdate({ stretchRatio: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <div className="flex justify-between text-[10px] text-neutral-500 font-mono">
            <span>1× (Standard)</span>
            <span>15× (Sweeping Beach)</span>
            <span>40× (Endless Sahara)</span>
          </div>
        </div>

        {/* Stretch Direction Angle */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-neutral-300">Stretch Ridge Axis</span>
            <span className="font-mono text-cyan-400">{layer.stretchAngle}°</span>
          </div>
          <input
            type="range"
            min="0"
            max="360"
            step="1"
            value={layer.stretchAngle}
            onChange={(e) => onUpdate({ stretchAngle: parseInt(e.target.value, 10) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>

        {/* Dune Asymmetry (Stoss vs Slip Face) */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-neutral-300">Slip-Face Asymmetry (Stoss/Lee)</span>
            <span className="font-mono text-cyan-400">
              {Math.round(layer.duneAsymmetry * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1.0"
            step="0.02"
            value={layer.duneAsymmetry}
            onChange={(e) => onUpdate({ duneAsymmetry: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <p className="text-[10px] text-neutral-400">
            Gentle windward slope with steep drop on the slip-face.
          </p>
        </div>

        {/* Crest Sharpness */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-neutral-300">Crest Razor Sharpness</span>
            <span className="font-mono text-cyan-400">
              {Math.round(layer.sharpness * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1.0"
            step="0.02"
            value={layer.sharpness}
            onChange={(e) => onUpdate({ sharpness: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>

        {/* Crest Flattening / Plateau */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-neutral-300">Plateau / Crest Flattening</span>
            <span className="font-mono text-cyan-400">
              {Math.round(layer.crestFlattening * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1.0"
            step="0.02"
            value={layer.crestFlattening}
            onChange={(e) => onUpdate({ crestFlattening: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>
      </div>

      {/* ── WAVELENGTH & AMPLITUDE ── */}
      <div className="p-3 bg-neutral-900/70 border border-neutral-800 rounded-lg space-y-3">
        <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-amber-400" />
          Scale & Elevation
        </span>

        {/* Amplitude */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-neutral-300">Dune Amplitude (Height)</span>
            <span className="font-mono text-amber-400 font-semibold">{layer.amplitude} mm</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0.5"
              max="35"
              step="0.5"
              value={layer.amplitude}
              onChange={(e) => onUpdate({ amplitude: parseFloat(e.target.value) })}
              className="flex-1 h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
            />
            <input
              type="number"
              min="0.5"
              max="35"
              step="0.5"
              value={layer.amplitude}
              onChange={(e) => onUpdate({ amplitude: parseFloat(e.target.value) || 1 })}
              className="w-14 bg-neutral-950 border border-neutral-700 rounded px-1.5 py-0.5 text-xs text-right font-mono text-neutral-200"
            />
          </div>
        </div>

        {/* Wavelength / Spacing */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-neutral-300">Wavelength (Ridge Spacing)</span>
            <span className="font-mono text-amber-400 font-semibold">{layer.spacing} mm</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="8"
              max="200"
              step="1"
              value={layer.spacing}
              onChange={(e) => onUpdate({ spacing: parseFloat(e.target.value) })}
              className="flex-1 h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
            />
            <input
              type="number"
              min="8"
              max="200"
              step="1"
              value={layer.spacing}
              onChange={(e) => onUpdate({ spacing: parseFloat(e.target.value) || 10 })}
              className="w-14 bg-neutral-950 border border-neutral-700 rounded px-1.5 py-0.5 text-xs text-right font-mono text-neutral-200"
            />
          </div>
        </div>

        {/* Wave Direction */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-neutral-300 flex items-center gap-1">
              <Compass className="w-3.5 h-3.5 text-neutral-400" />
              Primary Wave Angle
            </span>
            <span className="font-mono text-amber-400">{layer.primaryDir}°</span>
          </div>
          <input
            type="range"
            min="0"
            max="360"
            step="1"
            value={layer.primaryDir}
            onChange={(e) => onUpdate({ primaryDir: parseInt(e.target.value, 10) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
        </div>
      </div>

      {/* ── MEANDER & TURBULENCE ── */}
      <div className="p-3 bg-neutral-900/70 border border-neutral-800 rounded-lg space-y-3">
        <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
          <Wind className="w-3.5 h-3.5 text-emerald-400" />
          Organic S-Curve Meanders
        </span>

        {/* Warp Intensity */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-neutral-300">Domain Warp Meander</span>
            <span className="font-mono text-emerald-400">
              {Math.round(layer.warpIntensity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.05"
            value={layer.warpIntensity}
            onChange={(e) => onUpdate({ warpIntensity: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-400"
          />
        </div>

        {/* Warp Scale */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-neutral-300">Sweep Meander Scale</span>
            <span className="font-mono text-emerald-400">{layer.warpScale.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.2"
            max="2.5"
            step="0.05"
            value={layer.warpScale}
            onChange={(e) => onUpdate({ warpScale: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-400"
          />
        </div>

        {/* Seed Shuffle */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-neutral-400">Random Seed: {layer.noiseSeed}</span>
          <button
            onClick={() =>
              onUpdate({ noiseSeed: Math.floor(Math.random() * 99999) + 1 })
            }
            className="flex items-center gap-1 px-2 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded border border-neutral-700 transition-colors"
          >
            <Shuffle className="w-3 h-3" />
            Reseed Dunes
          </button>
        </div>
      </div>

      {/* ── MICRO-SALTATION & SAND GRAIN ── */}
      <div className="p-3 bg-neutral-900/70 border border-neutral-800 rounded-lg space-y-3">
        <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          Micro-Saltation Texture
        </span>

        {/* Micro Ripples */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-neutral-300">Micro Wind Ripples</span>
            <span className="font-mono text-purple-400">
              {Math.round(layer.microRipples * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1.0"
            step="0.02"
            value={layer.microRipples}
            onChange={(e) => onUpdate({ microRipples: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-purple-400"
          />
        </div>

        {/* Micro Spacing */}
        {layer.microRipples > 0.01 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-neutral-300">Micro Wavelength</span>
              <span className="font-mono text-purple-400">{layer.microSpacing} mm</span>
            </div>
            <input
              type="range"
              min="2"
              max="20"
              step="1"
              value={layer.microSpacing}
              onChange={(e) => onUpdate({ microSpacing: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-purple-400"
            />
          </div>
        )}

        {/* Organic Sand Grain */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-neutral-300">Fine Grain Roughness</span>
            <span className="font-mono text-purple-400">
              {Math.round(layer.noiseOverlay * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.02"
            value={layer.noiseOverlay}
            onChange={(e) => onUpdate({ noiseOverlay: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-purple-400"
          />
        </div>
      </div>
    </div>
  );
};
