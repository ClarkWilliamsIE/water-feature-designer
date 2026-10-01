import React, { useRef, useState } from 'react';
import { Obstacle, ViewConfig } from '../types';
import {
  PRESET_SHAPES,
  parseSvgToPolygon,
  imageToPolygon,
  generateSdfGridFromPolygon,
} from '../utils/customShape';
import {
  ParsedGeometryResult,
  CAD_SAMPLE_PRESETS,
} from '../utils/importers';
import { CadImportModal } from './CadImportModal';
import {
  CircleDot,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Waves,
  Upload,
  RotateCw,
  Box,
  Check,
  Mountain,
  Sliders,
  Wind,
  Layers,
  Sparkles,
  FileCode,
  FlipHorizontal,
  Lock,
  Unlock,
  Compass,
  RotateCcw,
} from 'lucide-react';

interface ObstaclePanelProps {
  obstacles: Obstacle[];
  selectedObsId: string | null;
  onSelectObstacle: (id: string | null) => void;
  onAddObstacle: (customData?: Partial<Obstacle>) => void;
  onDeleteObstacle: (id: string) => void;
  onUpdateObstacle: (id: string, updates: Partial<Obstacle>) => void;
  surfaceWidth: number;
  surfaceLength: number;
  view: ViewConfig;
  onUpdateView: (updates: Partial<ViewConfig>) => void;
}

export const ObstaclePanel: React.FC<ObstaclePanelProps> = ({
  obstacles,
  selectedObsId,
  onAddObstacle,
  onDeleteObstacle,
  onSelectObstacle,
  onUpdateObstacle,
  surfaceWidth,
  surfaceLength,
  view,
  onUpdateView,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isCadModalOpen, setIsCadModalOpen] = useState<boolean>(false);
  const [activeSection, setActiveSection] = useState<'cradle' | 'transform' | 'extrusion' | 'wake'>('cradle');

  const selectedObs = obstacles.find((o) => o.id === selectedObsId) || null;

  const handleImportGeometry = (result: ParsedGeometryResult, asNewObstacle: boolean) => {
    let shapeType: Obstacle['shape'] = 'custom_svg';
    if (result.format === 'stl' || result.format === 'obj') {
      shapeType = 'custom_3d';
    } else if (result.format === 'dxf') {
      shapeType = 'custom_dxf';
    } else if (result.format === 'image') {
      shapeType = 'custom_mask';
    }

    const updates: Partial<Obstacle> = {
      shape: shapeType,
      name: result.name,
      radius: result.recommendedRadius || 45,
      height: result.recommendedHeight || 20,
      customPolygonPoints: result.polygonPoints,
      customSdfGrid: result.sdfGrid,
      customSdfRes: result.sdfRes,
      customMeshData: result.meshData,
      disturbanceRadius: (result.recommendedRadius || 45) * 2.8,
      elevation: -5, // Sunk 5mm into plane so the plane immediately wraps around underside
      cradleEnabled: true,
      flattenUnderFootprint: false, // For imported rocks, skip flat bottom and follow 3D rock contour
      beddingDepth: 0,
      verticalExtrusion: 0,
      cradleClearance: 0.2,
      cradleBlendMargin: 6,
      lockAspectRatio: true,
      scaleX: 1.0,
      scaleY: 1.0,
      scaleZ: 1.0,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
    };

    if (asNewObstacle || !selectedObs) {
      onAddObstacle(updates);
      setImportStatus(`Added 3D/CAD "${result.name}" to canvas!`);
    } else {
      onUpdateObstacle(selectedObs.id, updates);
      setImportStatus(`Applied 3D/CAD "${result.name}"!`);
    }
    setActiveSection('cradle');
    setTimeout(() => setImportStatus(null), 3500);
  };

  // Handle custom SVG or Image upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedObs) return;

    setImportStatus(`Loading ${file.name}…`);

    if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const svgContent = event.target?.result as string;
        const pts = parseSvgToPolygon(svgContent, 48);
        const sdf = generateSdfGridFromPolygon(pts, 64);
        onUpdateObstacle(selectedObs.id, {
          shape: 'custom_svg',
          name: file.name.replace(/\.[^/.]+$/, ''),
          customSvgPath: svgContent,
          customPolygonPoints: pts,
          customSdfGrid: sdf,
          customSdfRes: 64,
        });
        setImportStatus(`Imported SVG vector shape!`);
        setTimeout(() => setImportStatus(null), 3000);
      };
      reader.readAsText(file);
    } else {
      // PNG, JPG image
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const pts = imageToPolygon(img, 128, 48);
          const sdf = generateSdfGridFromPolygon(pts, 64);
          onUpdateObstacle(selectedObs.id, {
            shape: 'custom_mask',
            name: file.name.replace(/\.[^/.]+$/, ''),
            customPolygonPoints: pts,
            customSdfGrid: sdf,
            customSdfRes: 64,
          });
          setImportStatus(`Imported silhouette displacement shape!`);
          setTimeout(() => setImportStatus(null), 3000);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const applyPresetShape = (presetKey: string) => {
    if (!selectedObs) return;
    const preset = PRESET_SHAPES[presetKey];
    if (!preset) return;

    const sdf = generateSdfGridFromPolygon(preset.points, 64);
    onUpdateObstacle(selectedObs.id, {
      shape: 'custom_svg',
      name: preset.name,
      customPolygonPoints: preset.points,
      customSdfGrid: sdf,
      customSdfRes: 64,
    });
  };

  return (
    <div className="space-y-4">
      {/* Header and Add / Import Buttons */}
      <div className="flex items-center justify-between gap-1.5 flex-wrap">
        <div className="flex items-center gap-2">
          <CircleDot className="w-4 h-4 text-blue-400" />
          <span className="font-semibold text-xs text-neutral-200 tracking-wide uppercase">
            Stones & Custom Shapes ({obstacles.length})
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsCadModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 rounded-md transition-colors cursor-pointer shadow-xs"
            title="Import 3D model (.STL, .OBJ) or AutoCAD drawing (.DXF) / SVG"
          >
            <Box className="w-3.5 h-3.5 text-cyan-300" />
            Import 3D / CAD
          </button>
          <button
            onClick={() => onAddObstacle()}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 border border-blue-500/40 rounded-md transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      </div>

      {/* Global Visual vs Physics Toggles */}
      <div className="p-2.5 bg-neutral-950/80 rounded-lg border border-neutral-800 space-y-2 text-xs">
        {/* Toggle 1: Hide Stone Visual 3D Mesh */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {view.showObstacleMeshes ? (
              <Eye className="w-3.5 h-3.5 text-blue-400" />
            ) : (
              <EyeOff className="w-3.5 h-3.5 text-neutral-500" />
            )}
            <div className="flex flex-col">
              <span className="font-medium text-neutral-200">
                Show Stone 3D Mesh
              </span>
              <span className="text-[10px] text-neutral-400">
                {view.showObstacleMeshes
                  ? '3D stone body rendered in viewport'
                  : '3D stone hidden — wake & extrusion physics active'}
              </span>
            </div>
          </div>
          <button
            onClick={() =>
              onUpdateView({ showObstacleMeshes: !view.showObstacleMeshes })
            }
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
              view.showObstacleMeshes
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {view.showObstacleMeshes ? 'Visible' : 'Hidden'}
          </button>
        </div>

        {/* Toggle 2: Show Disturbance Guide Rings */}
        <div className="flex items-center justify-between pt-1 border-t border-neutral-850">
          <span className="text-neutral-400 text-[11px]">
            Disturbance Guide Rings
          </span>
          <button
            onClick={() => onUpdateView({ showZones: !view.showZones })}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
              view.showZones
                ? 'bg-cyan-500/20 text-cyan-300'
                : 'bg-neutral-800 text-neutral-500'
            }`}
          >
            {view.showZones ? 'On' : 'Off'}
          </button>
        </div>

        {/* Toggle 3: 3D Bounding Box & Caliper Cage */}
        <div className="flex items-center justify-between pt-1 border-t border-neutral-850">
          <div className="flex items-center gap-1.5">
            <Box className="w-3.5 h-3.5 text-amber-400" />
            <div className="flex flex-col">
              <span className="text-neutral-200 text-[11px] font-medium">
                3D Bounding Box & Calipers
              </span>
              <span className="text-[9px] text-neutral-500">
                Visual measurement box & millimeter tags
              </span>
            </div>
          </div>
          <button
            onClick={() => onUpdateView({ showBoundingBox: !view.showBoundingBox })}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer border ${
              view.showBoundingBox
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-neutral-800 text-neutral-500 border-neutral-700'
            }`}
          >
            {view.showBoundingBox ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* Obstacles list */}
      <div className="space-y-1.5 max-h-36 overflow-y-auto">
        {obstacles.length === 0 ? (
          <div className="p-3 text-center text-xs text-neutral-500 bg-neutral-900/40 rounded-lg border border-neutral-800/60">
            No obstacles on canvas. Click "Add Shape" to place stones or custom vector outlines that displace sand.
          </div>
        ) : (
          obstacles.map((obs) => {
            const isSelected = obs.id === selectedObsId;
            const isEnabled = obs.enabled !== false;
            return (
              <div
                key={obs.id}
                onClick={() => onSelectObstacle(obs.id)}
                className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-neutral-800 border-blue-500/80 text-blue-200'
                    : 'bg-neutral-900/70 border-neutral-800 text-neutral-300 hover:bg-neutral-850'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isEnabled ? 'bg-blue-400' : 'bg-neutral-600'
                    }`}
                  />
                  <span className="font-medium truncate max-w-[130px]">{obs.name}</span>
                  {obs.verticalExtrusion ? (
                    <span className="text-[9px] px-1 py-0.2 bg-amber-500/20 text-amber-300 rounded font-mono">
                      +{obs.verticalExtrusion}mm
                    </span>
                  ) : null}
                  <span className="text-[10px] text-neutral-500 font-mono">
                    ({obs.x.toFixed(0)}, {obs.z.toFixed(0)})
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateObstacle(obs.id, { enabled: !isEnabled });
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      isEnabled
                        ? 'text-blue-300 hover:bg-blue-500/20'
                        : 'text-neutral-500 hover:bg-neutral-800'
                    }`}
                    title={isEnabled ? 'Disable sand physics' : 'Enable sand physics'}
                  >
                    <Waves className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteObstacle(obs.id);
                    }}
                    className="p-1 text-neutral-500 hover:text-rose-400 rounded"
                    title="Remove Shape"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Selected Obstacle Detailed Sub-Panels */}
      {selectedObs && (
        <div className="p-3 bg-neutral-900/80 border border-blue-500/30 rounded-xl space-y-3">
          {/* Sub-Panel Selector Tabs */}
          <div className="grid grid-cols-4 gap-1 p-0.5 bg-neutral-950 rounded-lg border border-neutral-800">
            <button
              onClick={() => setActiveSection('cradle')}
              className={`flex items-center justify-center gap-1 py-1 px-1 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                activeSection === 'cradle'
                  ? 'bg-neutral-800 text-emerald-300 shadow-sm border border-neutral-700'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title="Wrap plane around object underside & cradle in sand"
            >
              <Layers className="w-3 h-3 text-emerald-400" />
              Cradle
            </button>
            <button
              onClick={() => setActiveSection('transform')}
              className={`flex items-center justify-center gap-1 py-1 px-1 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                activeSection === 'transform'
                  ? 'bg-neutral-800 text-blue-300 shadow-sm border border-neutral-700'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title="Position & 3D Rotation"
            >
              <RotateCw className="w-3 h-3 text-blue-400" />
              3D & Pos
            </button>
            <button
              onClick={() => setActiveSection('wake')}
              className={`flex items-center justify-center gap-1 py-1 px-1 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                activeSection === 'wake'
                  ? 'bg-neutral-800 text-cyan-300 shadow-sm border border-neutral-700'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title="Wake Ripples & Dune Accumulation"
            >
              <Wind className="w-3 h-3 text-cyan-400" />
              Wake
            </button>
            <button
              onClick={() => setActiveSection('extrusion')}
              className={`flex items-center justify-center gap-1 py-1 px-1 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                activeSection === 'extrusion'
                  ? 'bg-neutral-800 text-amber-300 shadow-sm border border-neutral-700'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title="Plateau & CNC Footprint Extrusion"
            >
              <Mountain className="w-3 h-3 text-amber-400" />
              Extrude
            </button>
          </div>

          {/* ═══════════════════════════════════════════════════════════════════════
              SECTION 0: CONFORMAL PLANE CRADLE & 3-AXIS IMMERSION
          ═══════════════════════════════════════════════════════════════════════ */}
          {activeSection === 'cradle' && (
            <div className="space-y-3">
              {/* Conformal Cradle Toggle & Submerged Status */}
              <div className="p-2.5 bg-neutral-950 rounded-lg border border-emerald-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-emerald-400" />
                      Wrap Plane Around Underside (Cradle)
                    </span>
                    <span className="text-[10px] text-neutral-400">
                      Sand plane wraps conformally around any part of the 3D shape below the surface
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={selectedObs.cradleEnabled !== false}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        cradleEnabled: e.target.checked,
                      })
                    }
                    className="w-4 h-4 rounded text-emerald-500 bg-neutral-800 border-neutral-700 focus:ring-emerald-500 cursor-pointer"
                  />
                </div>

                {/* Status Readout */}
                <div className="flex items-center justify-between pt-1 border-t border-neutral-800/80 text-[10px]">
                  <span className="text-neutral-400">Geometry Type:</span>
                  <span className="font-mono text-emerald-300 font-medium">
                    {selectedObs.customMeshData
                      ? `3D Mesh (${selectedObs.customMeshData.triangleCount || (selectedObs.customMeshData.positions.length / 9)} tris)`
                      : selectedObs.shape === 'custom_svg'
                      ? 'Vector Contour Silhouette'
                      : 'Analytical Zen Stone'}
                  </span>
                </div>
              </div>

              {/* Plane Immersion / Elevation (Vertical Height relative to Plane) */}
              <div className="p-2.5 bg-neutral-950/80 rounded-lg border border-neutral-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-300 font-medium flex items-center gap-1">
                    <Mountain className="w-3 h-3 text-emerald-400" /> Plane Immersion / Elevation
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="-50"
                      max="100"
                      step="0.5"
                      value={selectedObs.elevation ?? -5}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) {
                          onUpdateObstacle(selectedObs.id, { elevation: val });
                        }
                      }}
                      className="w-16 px-1.5 py-0.5 text-right font-mono text-xs bg-neutral-900 border border-neutral-700 rounded text-emerald-300 focus:border-emerald-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-neutral-400 font-mono">mm</span>
                    <span className="text-[10px] font-mono text-neutral-400">
                      {(selectedObs.elevation ?? -5) < 0
                        ? '(Sunk)'
                        : (selectedObs.elevation ?? -5) === 0
                        ? '(Flush)'
                        : '(Raised)'}
                    </span>
                  </div>
                </div>

                <input
                  type="range"
                  min="-50"
                  max="60"
                  step="0.5"
                  value={selectedObs.elevation ?? -5}
                  onChange={(e) =>
                    onUpdateObstacle(selectedObs.id, {
                      elevation: parseFloat(e.target.value),
                    })
                  }
                  className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                />

                <div className="flex justify-between text-[9px] text-neutral-500 font-mono">
                  <span>-50mm (Sunk)</span>
                  <span>0mm (Flush)</span>
                  <span>+25mm</span>
                  <span>+50mm (Raised)</span>
                  <span>+60mm</span>
                </div>

                {/* Quick Depth & Height Presets */}
                <div className="grid grid-cols-6 gap-1 pt-1">
                  {[
                    { label: '-20mm', val: -20 },
                    { label: '-5mm', val: -5 },
                    { label: 'Flush', val: 0 },
                    { label: '+10mm', val: 10 },
                    { label: '+25mm', val: 25 },
                    { label: '+50mm', val: 50 },
                  ].map((p) => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => onUpdateObstacle(selectedObs.id, { elevation: p.val })}
                      className={`py-1 text-[9px] font-mono rounded border transition-colors cursor-pointer text-center ${
                        Math.abs((selectedObs.elevation ?? -5) - p.val) < 0.1
                          ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200 font-bold'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3-Axis Rotation & Orientation */}
              <div className="p-2.5 bg-neutral-950/80 rounded-lg border border-neutral-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-200 flex items-center gap-1.5">
                    <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
                    3-Axis Rotation in Position
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObstacle(selectedObs.id, {
                        rotationX: 0,
                        rotation: 0,
                        rotationY: 0,
                        rotationZ: 0,
                      })
                    }
                    className="text-[10px] text-neutral-400 hover:text-neutral-200 px-1.5 py-0.5 rounded bg-neutral-850 cursor-pointer"
                  >
                    Reset Angles
                  </button>
                </div>

                {/* Pitch (X-Axis) */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-rose-400 flex items-center gap-1">
                      Pitch (X-Axis)
                    </span>
                    <span className="font-mono text-rose-400 font-medium">
                      {selectedObs.rotationX ?? 0}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    step="5"
                    value={selectedObs.rotationX ?? 0}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        rotationX: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-rose-400"
                  />
                </div>

                {/* Yaw (Y-Axis / Ground) */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-cyan-400 flex items-center gap-1">
                      Yaw (Y-Axis / Ground)
                    </span>
                    <span className="font-mono text-cyan-400 font-medium">
                      {selectedObs.rotation ?? 0}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    step="5"
                    value={selectedObs.rotation ?? 0}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        rotation: parseInt(e.target.value, 10),
                        rotationY: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                {/* Roll (Z-Axis) */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-blue-400 flex items-center gap-1">
                      Roll (Z-Axis)
                    </span>
                    <span className="font-mono text-blue-400 font-medium">
                      {selectedObs.rotationZ ?? 0}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    step="5"
                    value={selectedObs.rotationZ ?? 0}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        rotationZ: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-400"
                  />
                </div>
              </div>

              {/* Clearance Gap & Blend Margin */}
              <div className="grid grid-cols-2 gap-2">
                {/* Fit Clearance */}
                <div className="p-2 bg-neutral-950/60 rounded-lg border border-neutral-800 space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-neutral-400">CNC Fit Clearance</span>
                    <span className="font-mono text-emerald-400">
                      {(selectedObs.cradleClearance ?? 0.2).toFixed(1)} mm
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="3.0"
                    step="0.1"
                    value={selectedObs.cradleClearance ?? 0.2}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        cradleClearance: parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                  />
                </div>

                {/* Blend Margin */}
                <div className="p-2 bg-neutral-950/60 rounded-lg border border-neutral-800 space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-neutral-400">Lip Fillet Blend</span>
                    <span className="font-mono text-emerald-400">
                      {(selectedObs.cradleBlendMargin ?? 6).toFixed(1)} mm
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="25"
                    step="0.5"
                    value={selectedObs.cradleBlendMargin ?? 6}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        cradleBlendMargin: parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                  />
                </div>
              </div>

              {/* Wake Interaction Link Banner */}
              <div className="p-2.5 bg-cyan-950/40 border border-cyan-500/30 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wind className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                  <div className="text-[11px] leading-tight text-neutral-300">
                    <span className="text-cyan-300 font-semibold block">Wake Waves Active</span>
                    Ripples interact seamlessly with the immersed shape's waterline.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSection('wake')}
                  className="px-2 py-1 text-[10px] font-medium bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 rounded border border-cyan-500/40 cursor-pointer transition-colors"
                >
                  Tune Wake
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════════
              SECTION 1: VERTICAL EXTRUSION & BEDDING POCKET
          ═══════════════════════════════════════════════════════════════════════ */}
          {activeSection === 'extrusion' && (
            <div className="space-y-3">
              {/* Imported 3D Model Contour Mode Banner */}
              {(selectedObs.shape === 'custom_3d' || Boolean(selectedObs.customMeshData)) && (
                <div className="p-2.5 bg-emerald-950/40 border border-emerald-500/40 rounded-lg flex items-start gap-2">
                  <Layers className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div className="text-[11px] leading-snug text-neutral-300">
                    <span className="text-emerald-300 font-semibold block">
                      3D Rock Contour Mode Active
                    </span>
                    Flat bottom bedding is skipped for imported 3D rocks. The sand bed directly follows the organic 3D contour of your imported model in the{' '}
                    <button
                      type="button"
                      onClick={() => setActiveSection('cradle')}
                      className="underline text-emerald-300 hover:text-emerald-200 font-medium cursor-pointer"
                    >
                      Cradle tab
                    </button>
                    .
                  </div>
                </div>
              )}

              {/* Flatten Footprint Toggle */}
              <div className="p-2.5 bg-neutral-950 rounded-lg border border-neutral-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-neutral-200 flex items-center gap-1">
                      <Check className="w-3 h-3 text-emerald-400" />
                      Flatten / Extrude Footprint
                    </span>
                    <span className="text-[10px] text-neutral-400">
                      Shape boundary directly carves flat CNC bed or raised plateau
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={selectedObs.flattenUnderFootprint !== false}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        flattenUnderFootprint: e.target.checked,
                      })
                    }
                    className="w-4 h-4 rounded text-blue-500 bg-neutral-800 border-neutral-700 focus:ring-blue-500 cursor-pointer"
                  />
                </div>

                {selectedObs.flattenUnderFootprint !== false && (
                  <>
                    {/* Vertical Extrusion Height */}
                    <div className="space-y-1 pt-1.5 border-t border-neutral-850">
                      <div className="flex justify-between text-xs">
                        <span className="text-amber-300 font-medium flex items-center gap-1">
                          <Mountain className="w-3 h-3" /> Vertical Extrusion Height
                        </span>
                        <span className="font-mono text-amber-400 font-semibold">
                          +{selectedObs.verticalExtrusion ?? 0} mm
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="60"
                        step="0.5"
                        value={selectedObs.verticalExtrusion ?? 0}
                        onChange={(e) =>
                          onUpdateObstacle(selectedObs.id, {
                            verticalExtrusion: parseFloat(e.target.value),
                          })
                        }
                        className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                      />
                      <div className="flex justify-between text-[9px] text-neutral-500">
                        <span>0mm (Flat Pocket)</span>
                        <span>30mm (Raised Plateau)</span>
                        <span>60mm (High Pillar)</span>
                      </div>
                    </div>

                    {/* Bedding Pocket Base Elevation */}
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-neutral-400">Base Floor Offset</span>
                        <span className="font-mono text-amber-300">
                          {selectedObs.beddingDepth ?? 0} mm
                        </span>
                      </div>
                      <input
                        type="range"
                        min="-15"
                        max="15"
                        step="0.5"
                        value={selectedObs.beddingDepth ?? 0}
                        onChange={(e) =>
                          onUpdateObstacle(selectedObs.id, {
                            beddingDepth: parseFloat(e.target.value),
                          })
                        }
                        className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Advanced Extrusion Geometry (When verticalExtrusion > 0) */}
              {(selectedObs.verticalExtrusion ?? 0) > 0 && (
                <div className="p-2.5 bg-neutral-950/70 rounded-lg border border-neutral-800 space-y-2.5">
                  <span className="text-[11px] font-semibold text-neutral-300 block">
                    Extruded Wall & Cap Profile
                  </span>

                  {/* Cap Profile Types */}
                  <div className="grid grid-cols-4 gap-1">
                    {(['flat', 'dome', 'pyramid', 'stepped'] as const).map((prof) => (
                      <button
                        key={prof}
                        onClick={() =>
                          onUpdateObstacle(selectedObs.id, { extrusionCapProfile: prof })
                        }
                        className={`py-1 px-1 rounded text-[10px] font-medium capitalize border transition-colors cursor-pointer ${
                          (selectedObs.extrusionCapProfile || 'flat') === prof
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/60'
                            : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                        }`}
                      >
                        {prof}
                      </button>
                    ))}
                  </div>

                  {/* Draft Angle & Top Bevel */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-neutral-400">Sidewall Draft</span>
                        <span className="font-mono text-amber-400">
                          {selectedObs.extrusionDraftAngle ?? 20}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="50"
                        step="2"
                        value={selectedObs.extrusionDraftAngle ?? 20}
                        onChange={(e) =>
                          onUpdateObstacle(selectedObs.id, {
                            extrusionDraftAngle: parseInt(e.target.value, 10),
                          })
                        }
                        className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-neutral-400">Top Bevel/Fillet</span>
                        <span className="font-mono text-amber-400">
                          {selectedObs.extrusionBevel ?? 2.0} mm
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="10"
                        step="0.5"
                        value={selectedObs.extrusionBevel ?? 2.0}
                        onChange={(e) =>
                          onUpdateObstacle(selectedObs.id, {
                            extrusionBevel: parseFloat(e.target.value),
                          })
                        }
                        className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════════
              SECTION 2: EXTENDED WAKE DYNAMICS & RIPPLE VARIABLES
          ═══════════════════════════════════════════════════════════════════════ */}
          {activeSection === 'wake' && (
            <div className="space-y-2.5">
              {/* Wake Amplitude & Wavelength */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-300 font-medium">Wake Crest Height</span>
                    <span className="font-mono text-cyan-400 font-semibold">
                      {selectedObs.wakeAmplitude ?? 8} mm
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="25"
                    step="0.5"
                    value={selectedObs.wakeAmplitude ?? 8}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        wakeAmplitude: parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-300 font-medium">Wake Wavelength</span>
                    <span className="font-mono text-cyan-400 font-semibold">
                      {selectedObs.wakeWavelength ?? 28} mm
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="80"
                    step="1"
                    value={selectedObs.wakeWavelength ?? 28}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        wakeWavelength: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>
              </div>

              {/* Wake Flare Angle & Effective Distance */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400">Wake Flare Angle</span>
                    <span className="font-mono text-cyan-400">{selectedObs.wakeAngle}°</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="55"
                    step="1"
                    value={selectedObs.wakeAngle}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        wakeAngle: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400">Wake Reach Length</span>
                    <span className="font-mono text-cyan-400">{selectedObs.wakeLength} mm</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="1500"
                    step="10"
                    value={selectedObs.wakeLength}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        wakeLength: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <div className="flex justify-between text-[9px] text-neutral-500">
                    <span>20mm</span>
                    <span>750mm</span>
                    <span>1500mm</span>
                  </div>
                </div>
              </div>

              {/* Scour Trough Depth & Vertical Sand Drift Lift */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400">Scour Trough Depth</span>
                    <span className="font-mono text-cyan-400">
                      {selectedObs.wakeScourDepth ?? 0} mm
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="15"
                    step="0.5"
                    value={selectedObs.wakeScourDepth ?? 0}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        wakeScourDepth: parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400">Wake Vertical Lift</span>
                    <span className="font-mono text-cyan-400">
                      {selectedObs.wakeVerticalLift ?? 0} mm
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-10"
                    max="20"
                    step="0.5"
                    value={selectedObs.wakeVerticalLift ?? 0}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        wakeVerticalLift: parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>
              </div>

              {/* Decay Rate & Turbulence Eddies */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400">Wake Decay Speed</span>
                    <span className="font-mono text-cyan-400">
                      {(selectedObs.wakeDecayRate ?? 1.0).toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="2.5"
                    step="0.1"
                    value={selectedObs.wakeDecayRate ?? 1.0}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        wakeDecayRate: parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400">Eddy Turbulence</span>
                    <span className="font-mono text-cyan-400">
                      {Math.round((selectedObs.wakeTurbulence ?? 0) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1.0"
                    step="0.05"
                    value={selectedObs.wakeTurbulence ?? 0}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        wakeTurbulence: parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>
              </div>

              {/* Wake Seam Softening & Boundary Blending */}
              <div className="p-2 bg-neutral-950/60 rounded-lg border border-neutral-800 space-y-1">
                <div className="flex justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-neutral-300 font-medium">Wake Seam Softening & Blend</span>
                    <span className="text-[10px] text-neutral-500">(feather boundaries)</span>
                  </div>
                  <span className="font-mono text-cyan-400 font-semibold">
                    {Math.round((selectedObs.wakeSoftening ?? 0.75) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={selectedObs.wakeSoftening ?? 0.75}
                  onChange={(e) =>
                    onUpdateObstacle(selectedObs.id, {
                      wakeSoftening: parseFloat(e.target.value),
                    })
                  }
                  className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
                <div className="flex justify-between text-[9px] text-neutral-500">
                  <span>Crisp V-Rays (10%)</span>
                  <span>Silky Blend (75%)</span>
                  <span>Ultra Soft (100%)</span>
                </div>
              </div>

              {/* Upstream Bow Shock Accumulation */}
              <div className="p-2 bg-neutral-950/60 rounded-lg border border-neutral-800 space-y-1.5">
                <span className="text-[11px] font-medium text-neutral-300 block">
                  Upstream Bow Dune Mound
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-neutral-400">Bow Height</span>
                      <span className="font-mono text-cyan-400">
                        {selectedObs.bowMoundHeight ?? 8} mm
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      step="0.5"
                      value={selectedObs.bowMoundHeight ?? 8}
                      onChange={(e) =>
                        onUpdateObstacle(selectedObs.id, {
                          bowMoundHeight: parseFloat(e.target.value),
                        })
                      }
                      className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-neutral-400">Stand-off Dist</span>
                      <span className="font-mono text-cyan-400">
                        {selectedObs.bowMoundDistance ?? 60} mm
                      </span>
                    </div>
                    <input
                      type="range"
                      min="15"
                      max="150"
                      step="5"
                      value={selectedObs.bowMoundDistance ?? 60}
                      onChange={(e) =>
                        onUpdateObstacle(selectedObs.id, {
                          bowMoundDistance: parseInt(e.target.value, 10),
                        })
                      }
                      className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                  </div>
                </div>
              </div>

              {/* Concentric Diffraction Rings & Fluid Distortions */}
              <div className="p-2.5 bg-neutral-950/70 rounded-lg border border-cyan-500/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5">
                    <Waves className="w-3.5 h-3.5 text-cyan-400" />
                    Radial Ring Diffraction & Distortions
                  </span>
                  <span className="text-[10px] font-mono text-cyan-400">
                    {Math.round((selectedObs.diffractionRings ?? 0.5) * 100)}%
                  </span>
                </div>

                {/* Base Ring Intensity, Presets & Controls */}
                <div className="space-y-2">
                  <div className="space-y-1 bg-neutral-900/60 p-2 rounded border border-neutral-800">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-neutral-300 font-medium">Ring Intensity</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max="1000"
                          step="10"
                          value={Math.round((selectedObs.diffractionRings ?? 0.5) * 100)}
                          onChange={(e) =>
                            onUpdateObstacle(selectedObs.id, {
                              diffractionRings: Math.max(0, (parseFloat(e.target.value) || 0) / 100),
                            })
                          }
                          className="w-12 px-1 py-0.5 text-right font-mono text-[10px] bg-neutral-950 border border-neutral-700 rounded text-cyan-300 focus:outline-none focus:border-cyan-400"
                        />
                        <span className="text-cyan-400 font-mono">%</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="5.0"
                      step="0.05"
                      value={selectedObs.diffractionRings ?? 0.5}
                      onChange={(e) =>
                        onUpdateObstacle(selectedObs.id, {
                          diffractionRings: parseFloat(e.target.value),
                        })
                      }
                      className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                    {/* Quick Boost Preset Buttons */}
                    <div className="flex items-center justify-between gap-1 pt-0.5">
                      <span className="text-[9px] text-neutral-500">Presets:</span>
                      <div className="flex gap-1">
                        {[
                          { label: '50%', val: 0.5 },
                          { label: '100%', val: 1.0 },
                          { label: '200%', val: 2.0 },
                          { label: '350%', val: 3.5 },
                          { label: '500%', val: 5.0 },
                        ].map((p) => {
                          const isCur = Math.abs((selectedObs.diffractionRings ?? 0.5) - p.val) < 0.04;
                          return (
                            <button
                              key={p.label}
                              type="button"
                              onClick={() =>
                                onUpdateObstacle(selectedObs.id, {
                                  diffractionRings: p.val,
                                })
                              }
                              className={`px-1.5 py-0.5 text-[9px] rounded font-mono transition-colors ${
                                isCur
                                  ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50 font-bold'
                                  : 'bg-neutral-800 hover:bg-neutral-750 text-neutral-400 border border-neutral-700/60'
                              }`}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Ring Wavelength & Reach Radius */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-neutral-400">Wavelength</span>
                        <span className="font-mono text-cyan-400">
                          {selectedObs.diffractionSpacing ?? 30} mm
                        </span>
                      </div>
                      <input
                        type="range"
                        min="8"
                        max="100"
                        step="1"
                        value={selectedObs.diffractionSpacing ?? 30}
                        onChange={(e) =>
                          onUpdateObstacle(selectedObs.id, {
                            diffractionSpacing: parseInt(e.target.value, 10),
                          })
                        }
                        className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-neutral-400">Ring Reach</span>
                        <span className="font-mono text-cyan-400">
                          {Math.round(selectedObs.disturbanceRadius ?? (selectedObs.radius * 2.8))} mm
                        </span>
                      </div>
                      <input
                        type="range"
                        min={Math.round(selectedObs.radius + 15)}
                        max={Math.round(selectedObs.radius + 600)}
                        step="5"
                        value={Math.round(selectedObs.disturbanceRadius ?? (selectedObs.radius * 2.8))}
                        onChange={(e) =>
                          onUpdateObstacle(selectedObs.id, {
                            disturbanceRadius: parseInt(e.target.value, 10),
                          })
                        }
                        className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      />
                    </div>
                  </div>
                </div>

                {/* ── DISTORTION 1: BACKDRAFT / DIRECTIONAL PINCH ── */}
                <div className="pt-2 border-t border-neutral-800/80 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-neutral-300 flex items-center gap-1">
                      💧 Water Backdraft Pinch
                    </span>
                    <span className="text-[10px] font-mono text-cyan-400">
                      {(selectedObs.diffractionPinch ?? 0) > 0
                        ? `+${Math.round((selectedObs.diffractionPinch ?? 0) * 100)}% (Cusp)`
                        : (selectedObs.diffractionPinch ?? 0) < 0
                        ? `${Math.round((selectedObs.diffractionPinch ?? 0) * 100)}% (Flare)`
                        : '0% (Circular)'}
                    </span>
                  </div>

                  <input
                    type="range"
                    min="-1.0"
                    max="1.0"
                    step="0.05"
                    value={selectedObs.diffractionPinch ?? 0}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        diffractionPinch: parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <div className="flex justify-between text-[9px] text-neutral-500">
                    <span>Upstream Flare (-1.0)</span>
                    <span>Concentric (0.0)</span>
                    <span>Downstream Cusp (+1.0)</span>
                  </div>

                  {/* Pinch Direction Angle */}
                  {Math.abs(selectedObs.diffractionPinch ?? 0) > 0.02 && (
                    <div className="pt-1 space-y-1 bg-neutral-900/60 p-1.5 rounded border border-neutral-800">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-neutral-400">Pinch Direction</span>
                        <span className="font-mono text-cyan-400">
                          {selectedObs.diffractionPinchAngle ?? 0}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="360"
                        step="5"
                        value={selectedObs.diffractionPinchAngle ?? 0}
                        onChange={(e) =>
                          onUpdateObstacle(selectedObs.id, {
                            diffractionPinchAngle: parseInt(e.target.value, 10),
                          })
                        }
                        className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      />
                      <div className="flex gap-1.5 pt-0.5">
                        <button
                          type="button"
                          onClick={() => onUpdateObstacle(selectedObs.id, { diffractionPinchAngle: 0 })}
                          className="px-1.5 py-0.5 text-[9px] bg-neutral-800 hover:bg-neutral-750 text-neutral-300 rounded"
                        >
                          → 0° (East)
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateObstacle(selectedObs.id, { diffractionPinchAngle: 90 })}
                          className="px-1.5 py-0.5 text-[9px] bg-neutral-800 hover:bg-neutral-750 text-neutral-300 rounded"
                        >
                          ↓ 90° (South)
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateObstacle(selectedObs.id, { diffractionPinchAngle: 180 })}
                          className="px-1.5 py-0.5 text-[9px] bg-neutral-800 hover:bg-neutral-750 text-neutral-300 rounded"
                        >
                          ← 180° (West)
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── DISTORTION 2: VORTEX SWIRL / EDDY TWIST ── */}
                <div className="pt-2 border-t border-neutral-800/80 space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-neutral-300 flex items-center gap-1 font-medium">
                      🌀 Spiral Vortex Swirl
                    </span>
                    <span className="font-mono text-cyan-400">
                      {(selectedObs.diffractionSwirl ?? 0) === 0
                        ? 'None'
                        : `${(selectedObs.diffractionSwirl ?? 0).toFixed(2)}x`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-2.0"
                    max="2.0"
                    step="0.05"
                    value={selectedObs.diffractionSwirl ?? 0}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        diffractionSwirl: parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <div className="flex justify-between text-[9px] text-neutral-500">
                    <span>CCW Vortex (-2.0)</span>
                    <span>Linear (0.0)</span>
                    <span>CW Vortex (+2.0)</span>
                  </div>
                </div>

                {/* ── DISTORTION 3: CURRENT ELONGATION & FLUID FLUTTER ── */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-neutral-800/80">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-neutral-400">Current Stretch</span>
                      <span className="font-mono text-cyan-400">
                        {(selectedObs.diffractionStretch ?? 1.0).toFixed(2)}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.4"
                      max="3.0"
                      step="0.05"
                      value={selectedObs.diffractionStretch ?? 1.0}
                      onChange={(e) =>
                        onUpdateObstacle(selectedObs.id, {
                          diffractionStretch: parseFloat(e.target.value),
                        })
                      }
                      className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-neutral-400">Fluid Flutter</span>
                      <span className="font-mono text-cyan-400">
                        {Math.round((selectedObs.diffractionFlutter ?? 0) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1.0"
                      step="0.05"
                      value={selectedObs.diffractionFlutter ?? 0}
                      onChange={(e) =>
                        onUpdateObstacle(selectedObs.id, {
                          diffractionFlutter: parseFloat(e.target.value),
                        })
                      }
                      className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                  </div>
                </div>

                {/* Quick Distortion Presets */}
                <div className="pt-2 border-t border-neutral-800/80 space-y-1">
                  <span className="text-[10px] text-neutral-400 block font-medium">
                    Diffraction Presets:
                  </span>
                  <div className="grid grid-cols-4 gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateObstacle(selectedObs.id, {
                          diffractionPinch: 0.75,
                          diffractionStretch: 1.25,
                          diffractionSwirl: 0,
                          diffractionFlutter: 0.15,
                        })
                      }
                      className="py-1 px-1 text-[9px] bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 rounded text-center transition-colors"
                      title="Pinched teardrop backdraft wake"
                    >
                      💧 Backdraft
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onUpdateObstacle(selectedObs.id, {
                          diffractionPinch: 0.3,
                          diffractionStretch: 1.1,
                          diffractionSwirl: 1.15,
                          diffractionFlutter: 0.25,
                        })
                      }
                      className="py-1 px-1 text-[9px] bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 rounded text-center transition-colors"
                      title="Rotating whirlpool vortex ripple"
                    >
                      🌀 Whirlpool
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onUpdateObstacle(selectedObs.id, {
                          diffractionPinch: 0.4,
                          diffractionStretch: 2.2,
                          diffractionSwirl: 0.2,
                          diffractionFlutter: 0.4,
                        })
                      }
                      className="py-1 px-1 text-[9px] bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 rounded text-center transition-colors"
                      title="Strong elongated river current drift"
                    >
                      🌊 Current
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onUpdateObstacle(selectedObs.id, {
                          diffractionPinch: 0,
                          diffractionStretch: 1.0,
                          diffractionSwirl: 0,
                          diffractionFlutter: 0,
                        })
                      }
                      className="py-1 px-1 text-[9px] bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-neutral-200 rounded text-center transition-colors"
                      title="Reset to perfect circular concentric rings"
                    >
                      ⭕ Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════════
              SECTION 3: SHAPE CONTOUR, ROTATION & POSITION
          ═══════════════════════════════════════════════════════════════════════ */}
          {activeSection === 'transform' && (
            <div className="space-y-3">
              {/* Presets & Importer */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-300">
                    Contour & 3D Geometry
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsCadModalOpen(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 rounded-lg transition-all cursor-pointer shadow-xs"
                  >
                    <Box className="w-3.5 h-3.5 text-cyan-300" />
                    Import 3D / DXF / SVG
                  </button>
                </div>

                {importStatus && (
                  <div className="p-2 text-[11px] bg-cyan-950/70 border border-cyan-500/50 rounded-lg text-cyan-300 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-cyan-400" />
                    <span>{importStatus}</span>
                  </div>
                )}

                {/* Quick Preset Shapes Grid */}
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObstacle(selectedObs.id, {
                        shape: 'stone_sphere',
                        name: 'Round Stone',
                        customPolygonPoints: undefined,
                        customMeshData: undefined,
                      })
                    }
                    className={`p-1.5 rounded-lg border text-left flex flex-col gap-0.5 cursor-pointer text-[11px] transition-colors ${
                      selectedObs.shape === 'stone_sphere'
                        ? 'bg-neutral-800 border-blue-500 text-blue-300'
                        : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                    }`}
                  >
                    <span className="font-semibold">● Circular</span>
                    <span className="text-[9px] text-neutral-500">Radial pebble</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyPresetShape('organic_pebble')}
                    className={`p-1.5 rounded-lg border text-left flex flex-col gap-0.5 cursor-pointer text-[11px] transition-colors ${
                      selectedObs.shape === 'custom_svg' && selectedObs.name === 'Zen River Pebble'
                        ? 'bg-neutral-800 border-blue-500 text-blue-300'
                        : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                    }`}
                  >
                    <span className="font-semibold">🪨 River Pebble</span>
                    <span className="text-[9px] text-neutral-500">Natural harmonic</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyPresetShape('lotus_leaf')}
                    className={`p-1.5 rounded-lg border text-left flex flex-col gap-0.5 cursor-pointer text-[11px] transition-colors ${
                      selectedObs.shape === 'custom_svg' && selectedObs.name === 'Organic Leaf Silhouette'
                        ? 'bg-neutral-800 border-blue-500 text-blue-300'
                        : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                    }`}
                  >
                    <span className="font-semibold">🍃 Teardrop</span>
                    <span className="text-[9px] text-neutral-500">Leaf contour</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyPresetShape('yin_yang')}
                    className={`p-1.5 rounded-lg border text-left flex flex-col gap-0.5 cursor-pointer text-[11px] transition-colors ${
                      selectedObs.shape === 'custom_svg' && selectedObs.name === 'Flowing S-Curve Island'
                        ? 'bg-neutral-800 border-blue-500 text-blue-300'
                        : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                    }`}
                  >
                    <span className="font-semibold">☯️ S-Island</span>
                    <span className="text-[9px] text-neutral-500">Flowing wave</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyPresetShape('bonsai_island')}
                    className={`p-1.5 rounded-lg border text-left flex flex-col gap-0.5 cursor-pointer text-[11px] transition-colors ${
                      selectedObs.shape === 'custom_svg' && selectedObs.name === 'Bonsai Island Plan'
                        ? 'bg-neutral-800 border-blue-500 text-blue-300'
                        : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                    }`}
                  >
                    <span className="font-semibold">🪴 Lobed</span>
                    <span className="text-[9px] text-neutral-500">Island contour</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObstacle(selectedObs.id, {
                        shape: 'box',
                        name: 'Faceted Block',
                        customPolygonPoints: undefined,
                        customMeshData: undefined,
                      })
                    }
                    className={`p-1.5 rounded-lg border text-left flex flex-col gap-0.5 cursor-pointer text-[11px] transition-colors ${
                      selectedObs.shape === 'box'
                        ? 'bg-neutral-800 border-blue-500 text-blue-300'
                        : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                    }`}
                  >
                    <span className="font-semibold">■ Block</span>
                    <span className="text-[9px] text-neutral-500">SDF Box</span>
                  </button>
                </div>
              </div>

              {/* 3D Multi-Axis Rotation & Non-Uniform Stretch */}
              <div className="space-y-3 pt-2 border-t border-neutral-800">
                {/* Header & Quick Align Presets */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                    <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
                    3D Orientation & Rotation
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateObstacle(selectedObs.id, {
                          rotation: 0,
                          rotationX: 0,
                          rotationY: 0,
                          rotationZ: 0,
                          flipX: false,
                          flipZ: false,
                        })
                      }
                      className="text-[10px] text-neutral-400 hover:text-neutral-200 px-1.5 py-0.5 rounded bg-neutral-800/80 cursor-pointer"
                      title="Reset all rotation angles to 0"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                {/* Quick 90° Flip Buttons */}
                <div className="grid grid-cols-4 gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObstacle(selectedObs.id, {
                        rotationX: (((selectedObs.rotationX || 0) + 90 + 180) % 360) - 180,
                      })
                    }
                    className="px-2 py-1 bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 rounded-lg text-neutral-300 text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors"
                    title="Tilt Pitch +90°"
                  >
                    <RotateCw className="w-3 h-3 text-rose-400" />
                    <span>Pitch +90°</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObstacle(selectedObs.id, {
                        rotation: ((selectedObs.rotation || 0) + 90) % 360,
                        rotationY: ((selectedObs.rotationY || selectedObs.rotation || 0) + 90) % 360,
                      })
                    }
                    className="px-2 py-1 bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 rounded-lg text-neutral-300 text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors"
                    title="Yaw +90°"
                  >
                    <RotateCw className="w-3 h-3 text-cyan-400" />
                    <span>Yaw +90°</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObstacle(selectedObs.id, {
                        rotationZ: (((selectedObs.rotationZ || 0) + 90 + 180) % 360) - 180,
                      })
                    }
                    className="px-2 py-1 bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 rounded-lg text-neutral-300 text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors"
                    title="Roll +90°"
                  >
                    <RotateCw className="w-3 h-3 text-blue-400" />
                    <span>Roll +90°</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObstacle(selectedObs.id, {
                        flipX: !selectedObs.flipX,
                      })
                    }
                    className={`px-2 py-1 border rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                      selectedObs.flipX
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                        : 'bg-neutral-900 hover:bg-neutral-850 border-neutral-800 text-neutral-300'
                    }`}
                    title="Mirror Flip X"
                  >
                    <FlipHorizontal className="w-3 h-3" />
                    <span>Flip X</span>
                  </button>
                </div>

                {/* Ground Yaw Rotation Slider */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400 flex items-center gap-1">
                      <RotateCw className="w-3 h-3 text-cyan-400" /> Yaw Rotation (Ground)
                    </span>
                    <span className="font-mono text-cyan-400 font-medium">
                      {selectedObs.rotation ?? 0}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    step="5"
                    value={selectedObs.rotation ?? 0}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        rotation: parseInt(e.target.value, 10),
                        rotationY: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                {/* Pitch Rotation (Tilt X) */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400 flex items-center gap-1">
                      <RotateCw className="w-3 h-3 text-rose-400" /> Pitch Tilt (X-Axis)
                    </span>
                    <span className="font-mono text-rose-400 font-medium">
                      {selectedObs.rotationX ?? 0}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    step="5"
                    value={selectedObs.rotationX ?? 0}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        rotationX: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-rose-400"
                  />
                </div>

                {/* Roll Rotation (Roll Z) */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400 flex items-center gap-1">
                      <RotateCw className="w-3 h-3 text-blue-400" /> Roll Tilt (Z-Axis)
                    </span>
                    <span className="font-mono text-blue-400 font-medium">
                      {selectedObs.rotationZ ?? 0}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    step="5"
                    value={selectedObs.rotationZ ?? 0}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        rotationZ: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-400"
                  />
                </div>

                {/* 3D Size Readout & Aspect Ratio */}
                <div className="space-y-2 pt-2 border-t border-neutral-800">
                  {(() => {
                    let dimW = selectedObs.radius * 2;
                    let dimD = selectedObs.radius * 2;
                    let dimH = selectedObs.height || 20;
                    if (selectedObs.customMeshData?.bbox) {
                      const bbox = selectedObs.customMeshData.bbox;
                      const rawW = Math.max(0.1, bbox.maxX - bbox.minX);
                      const rawH = Math.max(0.1, bbox.maxY - bbox.minY);
                      const rawD = Math.max(0.1, bbox.maxZ - bbox.minZ);
                      const maxHoriz = Math.max(0.1, Math.max(rawW, rawD));
                      const uScale = (selectedObs.radius * 2) / maxHoriz;
                      const sx = selectedObs.scaleX ?? 1.0;
                      const sy = selectedObs.lockAspectRatio !== false
                        ? (selectedObs.scaleY ?? 1.0)
                        : (selectedObs.scaleY ?? (selectedObs.height ? selectedObs.height / (rawH * uScale) : 1.0));
                      const sz = selectedObs.scaleZ ?? 1.0;
                      dimW = rawW * uScale * sx;
                      dimD = rawD * uScale * sz;
                      dimH = rawH * uScale * sy;
                    }
                    return (
                      <div className="p-3 bg-neutral-900/90 border border-neutral-800 rounded-xl text-xs space-y-2.5">
                        <div className="flex justify-between items-center text-[11px] font-mono">
                          <span className="text-neutral-300 font-semibold flex items-center gap-1.5">
                            <Box className="w-3.5 h-3.5 text-amber-400" />
                            3D Caliper Dimensions:
                          </span>
                          <span className="text-emerald-400 font-bold">
                            {dimW.toFixed(1)} × {dimD.toFixed(1)} × {dimH.toFixed(1)} mm
                          </span>
                        </div>

                        {/* 3-Axis Measurement Badges */}
                        <div className="grid grid-cols-3 gap-1.5 text-center font-mono text-[10px]">
                          <div className="p-1.5 rounded-lg bg-neutral-950 border border-neutral-800">
                            <span className="text-[9px] text-rose-400 block font-sans">Width (X)</span>
                            <span className="font-bold text-neutral-100">{dimW.toFixed(1)}</span>
                            <span className="text-neutral-500 text-[9px]"> mm</span>
                          </div>
                          <div className="p-1.5 rounded-lg bg-neutral-950 border border-neutral-800">
                            <span className="text-[9px] text-cyan-400 block font-sans">Depth (Z)</span>
                            <span className="font-bold text-neutral-100">{dimD.toFixed(1)}</span>
                            <span className="text-neutral-500 text-[9px]"> mm</span>
                          </div>
                          <div className="p-1.5 rounded-lg bg-neutral-950 border border-neutral-800">
                            <span className="text-[9px] text-emerald-400 block font-sans">Height (Y)</span>
                            <span className="font-bold text-emerald-300">{dimH.toFixed(1)}</span>
                            <span className="text-neutral-500 text-[9px]"> mm</span>
                          </div>
                        </div>

                        <div className="flex justify-between text-[10px] text-neutral-400 pt-1 border-t border-neutral-800">
                          <span>Footprint: <strong className="text-neutral-200">Ø {(selectedObs.radius * 2).toFixed(1)} mm</strong> (widest span)</span>
                          <span>Immersion: <strong className="text-cyan-300">{((selectedObs.elevation || 0) < 0 ? `Cradled ${selectedObs.elevation}mm` : `${selectedObs.elevation || 0}mm`)}</strong></span>
                        </div>

                        {/* Interactive Bounding Box Viewport Controls */}
                        <div className="pt-2 border-t border-neutral-800 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-neutral-300 font-medium">Show Bounding Box in 3D:</span>
                            <button
                              type="button"
                              onClick={() => onUpdateView({ showBoundingBox: !view.showBoundingBox })}
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer border ${
                                view.showBoundingBox
                                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                                  : 'bg-neutral-800 border-neutral-700 text-neutral-400'
                              }`}
                            >
                              {view.showBoundingBox ? 'Bounding Box ON' : 'Turn ON'}
                            </button>
                          </div>

                          {view.showBoundingBox && (
                            <div className="grid grid-cols-3 gap-1 pt-1 text-[10px]">
                              {(['oriented', 'footprint', 'both'] as const).map((mode) => (
                                <button
                                  key={mode}
                                  type="button"
                                  onClick={() => onUpdateView({ boundingBoxMode: mode })}
                                  className={`p-1 rounded text-center border font-mono transition-colors cursor-pointer ${
                                    (view.boundingBoxMode || 'oriented') === mode
                                      ? 'bg-amber-950 border-amber-500/50 text-amber-300 font-bold'
                                      : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                                  }`}
                                >
                                  {mode === 'oriented' ? 'Oriented Cage' : mode === 'footprint' ? 'Footprint' : 'Both Boxes'}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-300">
                      Aspect Ratio & Proportions
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const nextLock = !selectedObs.lockAspectRatio;
                          onUpdateObstacle(selectedObs.id, {
                            lockAspectRatio: nextLock,
                            ...(nextLock ? { scaleX: 1.0, scaleY: 1.0, scaleZ: 1.0 } : {}),
                          });
                        }}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                          selectedObs.lockAspectRatio !== false
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                        }`}
                        title={selectedObs.lockAspectRatio !== false ? 'Locked to 1:1:1 original proportion' : 'Unlocked non-uniform stretch'}
                      >
                        {selectedObs.lockAspectRatio !== false ? (
                          <>
                            <Lock className="w-3 h-3" />
                            <span>Locked (1:1:1)</span>
                          </>
                        ) : (
                          <>
                            <Unlock className="w-3 h-3" />
                            <span>Free Stretch</span>
                          </>
                        )}
                      </button>

                      {selectedObs.lockAspectRatio === false && (
                        <button
                          type="button"
                          onClick={() => {
                            onUpdateObstacle(selectedObs.id, {
                              lockAspectRatio: true,
                              scaleX: 1.0,
                              scaleY: 1.0,
                              scaleZ: 1.0,
                            });
                          }}
                          className="text-[10px] text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                          title="Reset to exact 1:1:1 aspect ratio"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>

                  {selectedObs.lockAspectRatio === false ? (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-400">Stretch X</span>
                          <span className="font-mono text-cyan-400">
                            {(selectedObs.scaleX ?? 1.0).toFixed(2)}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.3"
                          max="3.0"
                          step="0.05"
                          value={selectedObs.scaleX ?? 1.0}
                          onChange={(e) =>
                            onUpdateObstacle(selectedObs.id, {
                              scaleX: parseFloat(e.target.value),
                            })
                          }
                          className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-400">Stretch Y</span>
                          <span className="font-mono text-amber-400">
                            {(selectedObs.scaleY ?? 1.0).toFixed(2)}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.3"
                          max="3.0"
                          step="0.05"
                          value={selectedObs.scaleY ?? 1.0}
                          onChange={(e) =>
                            onUpdateObstacle(selectedObs.id, {
                              scaleY: parseFloat(e.target.value),
                            })
                          }
                          className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-400">Stretch Z</span>
                          <span className="font-mono text-cyan-400">
                            {(selectedObs.scaleZ ?? 1.0).toFixed(2)}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.3"
                          max="3.0"
                          step="0.05"
                          value={selectedObs.scaleZ ?? 1.0}
                          onChange={(e) =>
                            onUpdateObstacle(selectedObs.id, {
                              scaleZ: parseFloat(e.target.value),
                            })
                          }
                          className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="p-2 bg-neutral-900/60 rounded-lg text-[11px] text-neutral-400 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      <span>Dimensions and vertical height scale 1:1:1 with footprint radius</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Coordinates X & Z */}
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-neutral-800">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400">Pos X</span>
                    <span className="font-mono text-blue-400">{selectedObs.x.toFixed(0)} mm</span>
                  </div>
                  <input
                    type="range"
                    min={-surfaceWidth / 2}
                    max={surfaceWidth / 2}
                    step="1"
                    value={selectedObs.x}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, { x: parseFloat(e.target.value) })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-400"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400">Pos Z</span>
                    <span className="font-mono text-blue-400">{selectedObs.z.toFixed(0)} mm</span>
                  </div>
                  <input
                    type="range"
                    min={-surfaceLength / 2}
                    max={surfaceLength / 2}
                    step="1"
                    value={selectedObs.z}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, { z: parseFloat(e.target.value) })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-400"
                  />
                </div>
              </div>

              {/* Primary Radius & Displacement Rim */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400">Footprint Radius</span>
                    <span className="font-mono text-blue-400">{selectedObs.radius} mm</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="250"
                    step="2"
                    value={selectedObs.radius}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, { radius: parseFloat(e.target.value) })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-400"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-400">Displacement Rim</span>
                    <span className="font-mono text-blue-400">
                      {Math.round(selectedObs.displacedSand * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2.0"
                    step="0.05"
                    value={selectedObs.displacedSand}
                    onChange={(e) =>
                      onUpdateObstacle(selectedObs.id, {
                        displacedSand: parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-400"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CAD & 3D Import Dialog Modal */}
      <CadImportModal
        isOpen={isCadModalOpen}
        onClose={() => setIsCadModalOpen(false)}
        onImportGeometry={handleImportGeometry}
        selectedObstacle={selectedObs}
        surfaceWidth={surfaceWidth}
        surfaceLength={surfaceLength}
      />
    </div>
  );
};
