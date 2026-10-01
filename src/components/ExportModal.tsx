import React, { useState, useMemo } from 'react';
import {
  SurfaceConfig,
  RippleLayer,
  Obstacle,
  ExportConfig,
} from '../types';
import {
  buildExportTriangles,
  exportSTLBinary,
  exportOBJText,
  exportHeightmap16BitPNG,
  estimateExportStats,
  triggerDownload,
} from '../utils/export';
import {
  Download,
  CheckCircle2,
  FileCode,
  Image as ImageIcon,
  Cpu,
  X,
  Gauge,
  Sparkles,
  Zap,
} from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  surface: SurfaceConfig;
  layers: RippleLayer[];
  obstacles: Obstacle[];
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  surface,
  layers,
  obstacles,
}) => {
  const [config, setConfig] = useState<ExportConfig>({
    includeBase: true,
    baseThickness: surface.baseThickness,
    scale: 1.0,
    unit: 'mm',
    exportObstacles: true,
    exportResolution: 800, // Default High-Precision 800 grid (~500k triangles)
  });

  const [isExporting, setIsExporting] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Real-time calculated mesh density and file stats
  const stats = useMemo(() => {
    return estimateExportStats(surface, config);
  }, [surface, config]);

  if (!isOpen) return null;

  const handleExportSTL = () => {
    setIsExporting(true);
    setProgressMsg(`Generating ${stats.triangleCount.toLocaleString()} high-precision triangles…`);
    setTimeout(() => {
      try {
        const tris = buildExportTriangles(surface, layers, obstacles, config);
        const data = exportSTLBinary(
          tris,
          `SandRipple_${surface.width}x${surface.length}_R${surface.cornerRadius}`
        );
        const filename = `SandRipple_${surface.width}x${surface.length}mm_R${surface.cornerRadius}_${config.exportResolution}res.stl`;
        triggerDownload(data, filename, 'application/sla');
        setExportSuccess(`Exported ultra-high quality Binary STL (${tris.length.toLocaleString()} triangles, ${(data.byteLength / 1048576).toFixed(1)} MB)`);
      } catch (err: any) {
        alert('Export failed: ' + err.message);
      } finally {
        setIsExporting(false);
        setProgressMsg('');
      }
    }, 40);
  };

  const handleExportOBJ = () => {
    setIsExporting(true);
    setProgressMsg(`Compiling high-density Wavefront OBJ file…`);
    setTimeout(() => {
      try {
        const objText = exportOBJText(surface, layers, obstacles, config);
        const filename = `SandRipple_${surface.width}x${surface.length}mm_R${surface.cornerRadius}_${config.exportResolution}res.obj`;
        triggerDownload(objText, filename, 'text/plain');
        setExportSuccess(`Exported Wavefront OBJ with smooth vertex coordinates`);
      } catch (err: any) {
        alert('Export failed: ' + err.message);
      } finally {
        setIsExporting(false);
        setProgressMsg('');
      }
    }, 40);
  };

  const handleExportHeightmap = (res: number) => {
    setIsExporting(true);
    setProgressMsg(`Rendering 16-bit displacement heightmap (${res}×${res} px)…`);
    setTimeout(() => {
      try {
        const dataUrl = exportHeightmap16BitPNG(surface, layers, obstacles, res, res);
        const filename = `SandRipple_Heightmap_${surface.width}x${surface.length}mm_${res}px.png`;
        triggerDownload(dataUrl, filename, 'image/png');
        setExportSuccess(`Exported ${res}×${res} High-Res Displacement Heightmap for Vectric Aspire & Blender`);
      } catch (err: any) {
        alert('Heightmap generation failed: ' + err.message);
      } finally {
        setIsExporting(false);
        setProgressMsg('');
      }
    }, 40);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 bg-neutral-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-neutral-100 text-sm">
                Export High-Precision CNC 3D Surface
              </h3>
              <p className="text-[11px] text-neutral-400">
                Generate ultra-high density watertight solid meshes and 16-bit heightmaps
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {exportSuccess && (
            <div className="flex items-center gap-2 p-3 bg-emerald-950/70 border border-emerald-500/50 rounded-xl text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="font-medium">{exportSuccess}</span>
            </div>
          )}

          {/* Mesh Density & CNC Quality Preset Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-neutral-200 flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                Mesh Density & Quality Resolution
              </span>
              <span className="font-mono text-cyan-400 font-bold">
                {config.exportResolution} grid ({stats.stepoverX}mm pitch)
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setConfig((prev) => ({ ...prev, exportResolution: 300 }))}
                className={`p-2 rounded-xl border flex flex-col items-center gap-0.5 cursor-pointer transition-all ${
                  config.exportResolution === 300
                    ? 'bg-neutral-800 border-cyan-500 text-cyan-300 shadow-sm'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                }`}
              >
                <span className="font-semibold text-xs">Standard</span>
                <span className="text-[10px] text-neutral-500">300 grid (~60k)</span>
              </button>

              <button
                type="button"
                onClick={() => setConfig((prev) => ({ ...prev, exportResolution: 600 }))}
                className={`p-2 rounded-xl border flex flex-col items-center gap-0.5 cursor-pointer transition-all ${
                  config.exportResolution === 600
                    ? 'bg-neutral-800 border-cyan-500 text-cyan-300 shadow-sm'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                }`}
              >
                <span className="font-semibold text-xs text-cyan-200">High Precision</span>
                <span className="text-[10px] text-neutral-500">600 grid (~250k)</span>
              </button>

              <button
                type="button"
                onClick={() => setConfig((prev) => ({ ...prev, exportResolution: 1000 }))}
                className={`p-2 rounded-xl border flex flex-col items-center gap-0.5 cursor-pointer transition-all ${
                  config.exportResolution === 1000
                    ? 'bg-neutral-800 border-amber-500 text-amber-300 shadow-sm'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                }`}
              >
                <span className="font-semibold text-xs text-amber-300 flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5 text-amber-400" /> Ultra Fine
                </span>
                <span className="text-[10px] text-neutral-500">1000 grid (~700k)</span>
              </button>

              <button
                type="button"
                onClick={() => setConfig((prev) => ({ ...prev, exportResolution: 1600 }))}
                className={`p-2 rounded-xl border flex flex-col items-center gap-0.5 cursor-pointer transition-all ${
                  config.exportResolution === 1600
                    ? 'bg-neutral-800 border-purple-500 text-purple-300 shadow-sm'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                }`}
              >
                <span className="font-semibold text-xs text-purple-300 flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5 text-purple-400" /> Master 0.5mm
                </span>
                <span className="text-[10px] text-neutral-500">1600 grid (~1.8M)</span>
              </button>
            </div>

            {/* Fine Resolution Slider */}
            <div className="pt-1">
              <input
                type="range"
                min="150"
                max="2000"
                step="50"
                value={config.exportResolution}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    exportResolution: parseInt(e.target.value, 10),
                  }))
                }
                className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>
          </div>

          {/* Model Specification Card */}
          <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-2">
            <div className="flex justify-between text-neutral-400">
              <span>Overall Stock Dimensions:</span>
              <span className="font-mono text-neutral-200 font-medium">
                {surface.width} × {surface.length} mm (True R{surface.cornerRadius}mm Cut)
              </span>
            </div>
            <div className="flex justify-between text-neutral-400">
              <span>Computed Triangle Count:</span>
              <span className="font-mono text-cyan-400 font-bold">
                {stats.triangleCount.toLocaleString()} triangles
              </span>
            </div>
            <div className="flex justify-between text-neutral-400">
              <span>Surface Point Pitch (Stepover):</span>
              <span className="font-mono text-amber-400 font-medium">
                {stats.stepoverX} mm × {stats.stepoverZ} mm
              </span>
            </div>
            <div className="flex justify-between text-neutral-400">
              <span>Estimated Binary STL Size:</span>
              <span className="font-mono text-neutral-200 font-medium">
                ~{stats.estFileSizeMB} MB
              </span>
            </div>
          </div>

          {/* Configuration Options */}
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-neutral-950/80 rounded-xl border border-neutral-800">
              <div className="flex flex-col">
                <span className="font-medium text-neutral-200">
                  Include Solid Base Skirt & Bottom
                </span>
                <span className="text-[11px] text-neutral-500">
                  Generates watertight manifold solid block for CNC clamping & CAM
                </span>
              </div>
              <input
                type="checkbox"
                checked={config.includeBase}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, includeBase: e.target.checked }))
                }
                className="w-4 h-4 rounded text-cyan-500 bg-neutral-800 border-neutral-700 focus:ring-cyan-500 cursor-pointer"
              />
            </div>

            {config.includeBase && (
              <div className="space-y-1 p-2.5 bg-neutral-950/60 rounded-xl border border-neutral-850">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-400">Base Substrate Thickness</span>
                  <span className="font-mono text-amber-400 font-semibold">
                    {config.baseThickness} mm
                  </span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="50"
                  step="1"
                  value={config.baseThickness}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      baseThickness: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                />
              </div>
            )}
          </div>

          {/* Progress state */}
          {isExporting && (
            <div className="flex items-center gap-3 p-3 bg-cyan-950/50 border border-cyan-500/40 rounded-xl text-cyan-300 text-xs">
              <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span>{progressMsg}</span>
            </div>
          )}

          {/* Export Action Buttons */}
          <div className="space-y-2 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleExportSTL}
                disabled={isExporting}
                className="flex items-center justify-center gap-2 py-3 px-4 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-neutral-950 font-bold rounded-xl transition-all shadow-lg shadow-cyan-500/20 active:scale-98 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Export High-Res STL (Binary)</span>
              </button>

              <button
                type="button"
                onClick={handleExportOBJ}
                disabled={isExporting}
                className="flex items-center justify-center gap-2 py-3 px-4 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-200 font-semibold rounded-xl border border-neutral-700 transition-all cursor-pointer"
              >
                <FileCode className="w-4 h-4" />
                <span>Export OBJ (With Normals)</span>
              </button>
            </div>

            {/* High-Res 16-bit Heightmap for Vectric Aspire & Blender */}
            <div className="pt-2 border-t border-neutral-800/80 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="font-semibold text-neutral-300 flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />
                  16-Bit Grayscale Displacement Heightmap
                </span>
                <span className="text-[10px] text-neutral-500">
                  Direct import for Vectric Aspire 3D Component, ArtCAM, Carbide Create & Blender
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleExportHeightmap(2048)}
                  disabled={isExporting}
                  className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg font-medium border border-neutral-700 transition-colors cursor-pointer text-xs"
                >
                  2K PNG
                </button>
                <button
                  type="button"
                  onClick={() => handleExportHeightmap(4096)}
                  disabled={isExporting}
                  className="px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 rounded-lg font-semibold transition-colors cursor-pointer text-xs"
                >
                  4K Ultra PNG
                </button>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-neutral-500 text-center pt-1">
            Compatible directly with Autodesk Fusion 360, Vectric VCarve / Aspire, RhinoCAM, MeshCAM, Blender, and 3D Slicers.
          </p>
        </div>
      </div>
    </div>
  );
};
