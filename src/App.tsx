import React, { useState, useEffect, useRef } from 'react';
import {
  SurfaceConfig,
  RippleLayer,
  Obstacle,
  ViewConfig,
  BrushConfig,
  MaterialType,
} from './types';
import { getDefaultLayers, createNewLayer } from './utils/mask';
import {
  serializeProject,
  saveAutoSaveSession,
} from './utils/projectStorage';
import { ensureObstacleCradle } from './utils/cradleGeometry';
import { Viewport } from './components/Viewport';
import { LayerPanel } from './components/LayerPanel';
import { LayerControls } from './components/LayerControls';
import { SurfaceControls } from './components/SurfaceControls';
import { ObstaclePanel } from './components/ObstaclePanel';
import { BrushToolbar } from './components/BrushToolbar';
import { ExportModal } from './components/ExportModal';
import { ProjectModal } from './components/ProjectModal';
import {
  Waves,
  Download,
  Grid,
  Box,
  Layers,
  Palette,
  SlidersHorizontal,
  CircleDot,
  Eye,
  EyeOff,
  FolderOpen,
  Save,
} from 'lucide-react';

export default function App() {
  // ── PROJECT IDENTITY STATE ──
  const [projectName, setProjectName] = useState<string>('Zen Sand Sculpt #1');
  const [isProjectOpen, setIsProjectOpen] = useState<boolean>(false);
  // ── SURFACE STATE (With True Physical Cut Filleted Corners & Optional Concave Basin) ──
  const [surface, setSurface] = useState<SurfaceConfig>({
    width: 1300,
    length: 400,
    cornerRadius: 40, // Physical perimeter cut fillet
    baseThickness: 10,
    resolution: 200,
    basinLift: 0,
    basinMargin: 0,
    basinProfile: 'conformal',
    basinCurvature: 2,
  });

  // ── MULTI-LAYER STATE (Starts completely dead flat at 0.0 mask) ──
  const [layers, setLayers] = useState<RippleLayer[]>(getDefaultLayers);
  const [selectedLayerId, setSelectedLayerId] = useState<string>(layers[0]?.id || '');

  // ── OBSTACLES STATE (Starts empty for dead-flat initial canvas) ──
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [selectedObsId, setSelectedObsId] = useState<string | null>(null);

  // ── VIEW & INTERACTION STATE ──
  const [view, setView] = useState<ViewConfig>({
    material: 'sandstone',
    showObstacleMeshes: true, // option to hide stone 3D mesh while keeping its effects
    applyObstaclePhysics: true, // physical mass & wake calculation
    showZones: false,
    showGrid: false,
    showWireframe: false,
    showMaskOverlay: false,
    activeTool: 'paint', // Default to Paint tool for immediate brush response!
    lightingPreset: 'desert_sun',
    showWaterPlane: false,
    waterLevel: 5.0,
    waterOpacity: 0.45,
    waterColor: '#0284c7',
    waterExtents: 'fit',
    waterAnimate: false,
    showBoundingBox: true,
    boundingBoxMode: 'oriented',
    showDimensionLabels: true,
  });

  // ── BRUSH CONFIG ──
  const [brush, setBrush] = useState<BrushConfig>({
    size: 75, // 75mm brush
    hardness: 0.35, // soft organic falloff
    opacity: 0.65,
    mode: 'paint',
  });

  // ── UI PANELS STATE ──
  const [activeTab, setActiveTab] = useState<'layers' | 'dune_params' | 'surface' | 'obstacles'>('layers');
  const [isExportOpen, setIsExportOpen] = useState(false);

  // ── AUTOSAVE TO LOCALSTORAGE ──
  const autoSaveTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    if (autoSaveTimeoutRef.current) {
      window.clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = window.setTimeout(() => {
      try {
        const serialized = serializeProject(
          projectName,
          surface,
          layers,
          obstacles,
          brush,
          view
        );
        saveAutoSaveSession(serialized);
      } catch (e) {
        // ignore background storage errors
      }
    }, 2000);

    return () => {
      if (autoSaveTimeoutRef.current) {
        window.clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [projectName, surface, layers, obstacles, brush, view]);

  // Load project state handler
  const handleLoadProject = (loaded: {
    projectMeta: { id: string; name: string; description?: string; updatedAt: string };
    surface: SurfaceConfig;
    layers: RippleLayer[];
    obstacles: Obstacle[];
    brush?: BrushConfig;
    view?: Partial<ViewConfig>;
  }) => {
    setSurface(loaded.surface);
    setLayers(loaded.layers);
    if (loaded.layers.length > 0) {
      setSelectedLayerId(loaded.layers[0].id);
    }
    setObstacles(loaded.obstacles.map(ensureObstacleCradle));
    if (loaded.obstacles.length > 0) {
      setSelectedObsId(loaded.obstacles[0].id);
    } else {
      setSelectedObsId(null);
    }
    if (loaded.brush) {
      setBrush(loaded.brush);
    }
    if (loaded.view) {
      setView((prev) => ({ ...prev, ...loaded.view }));
    }
    setProjectName(loaded.projectMeta.name);
  };

  // Active layer
  const activeLayer = layers.find((l) => l.id === selectedLayerId) || layers[0] || null;

  // Layer manipulation handlers
  const handleUpdateLayer = (id: string, updates: Partial<RippleLayer>) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...updates } : l))
    );
  };

  const handleUpdateLayerMask = (id: string, newMask: Float32Array) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, maskData: newMask } : l))
    );
  };

  const handleAddLayer = (newLayer: RippleLayer) => {
    setLayers((prev) => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const handleDeleteLayer = (id: string) => {
    if (layers.length <= 1) return;
    setLayers((prev) => prev.filter((l) => l.id !== id));
    if (selectedLayerId === id) {
      const remaining = layers.filter((l) => l.id !== id);
      setSelectedLayerId(remaining[0]?.id || '');
    }
  };

  const handleDuplicateLayer = (layer: RippleLayer) => {
    const duplicated = createNewLayer(`${layer.name} (Copy)`, layer.mode);
    duplicated.opacity = layer.opacity;
    duplicated.blendMode = layer.blendMode;
    duplicated.colorTag = layer.colorTag;
    duplicated.primaryDir = layer.primaryDir;
    duplicated.amplitude = layer.amplitude;
    duplicated.spacing = layer.spacing;
    duplicated.invert = layer.invert;
    duplicated.liftMode = layer.liftMode;
    duplicated.stretchRatio = layer.stretchRatio;
    duplicated.stretchAngle = layer.stretchAngle;
    duplicated.duneAsymmetry = layer.duneAsymmetry;
    duplicated.sharpness = layer.sharpness;
    duplicated.crestFlattening = layer.crestFlattening;
    duplicated.warpIntensity = layer.warpIntensity;
    duplicated.warpScale = layer.warpScale;
    duplicated.noiseOctaves = layer.noiseOctaves;
    duplicated.noiseSeed = layer.noiseSeed + 1;
    duplicated.microRipples = layer.microRipples;
    duplicated.microSpacing = layer.microSpacing;
    duplicated.noiseOverlay = layer.noiseOverlay;
    duplicated.maskData = new Float32Array(layer.maskData);

    setLayers((prev) => [...prev, duplicated]);
    setSelectedLayerId(duplicated.id);
  };

  // Obstacle handlers
  const handleAddObstacle = (customData?: Partial<Obstacle>) => {
    const newObs: Obstacle = {
      id: `stone-${Date.now()}`,
      name: customData?.name || `Zen Stone #${obstacles.length + 1}`,
      shape: customData?.shape || 'stone_sphere',
      x: customData?.x ?? (Math.random() - 0.5) * (surface.width * 0.4),
      z: customData?.z ?? (Math.random() - 0.5) * (surface.length * 0.4),
      radius: customData?.radius ?? 65,
      height: customData?.height ?? 80,
      mass: customData?.mass ?? 50,
      displacedSand: customData?.displacedSand ?? 0.7,
      disturbanceRadius: customData?.disturbanceRadius ?? (customData?.radius ? customData.radius * 2.8 : 190),
      disturbanceIntensity: customData?.disturbanceIntensity ?? 0.85,
      wakeAngle: customData?.wakeAngle ?? 25,
      wakeLength: customData?.wakeLength ?? 240,
      enabled: true,
      visibleMesh: true,
      flattenUnderFootprint: true,
      beddingDepth: customData?.beddingDepth ?? 0,
      verticalExtrusion: customData?.verticalExtrusion ?? 0,
      extrusionDraftAngle: 20,
      extrusionBevel: 2.0,
      extrusionCapProfile: 'flat',
      wakeAmplitude: 8.0,
      wakeWavelength: 28,
      wakeDecayRate: 1.0,
      wakeScourDepth: 0.0,
      wakeTurbulence: 0.0,
      wakeVerticalLift: 0.0,
      wakeSoftening: 0.75,
      bowMoundHeight: 8.0,
      bowMoundDistance: 60,
      diffractionRings: 0.5,
      diffractionSpacing: 30,
      diffractionPinch: 0.0,
      diffractionPinchAngle: 0,
      diffractionStretch: 1.0,
      diffractionStretchAngle: 0,
      diffractionSwirl: 0.0,
      diffractionFlutter: 0.0,
      rotation: 0,
      scaleX: 1.0,
      scaleZ: 1.0,
      ...customData,
    };
    const finalObs = ensureObstacleCradle(newObs);
    setObstacles((prev) => [...prev, finalObs]);
    setSelectedObsId(finalObs.id);
  };

  const handleDeleteObstacle = (id: string) => {
    setObstacles((prev) => prev.filter((o) => o.id !== id));
    if (selectedObsId === id) setSelectedObsId(null);
  };

  const handleUpdateObstacle = (id: string, updates: Partial<Obstacle>) => {
    setObstacles((prev) =>
      prev.map((o) => {
        if (o.id !== id) return o;
        const updated = { ...o, ...updates };

        // Recompute 3D underside cradle depth grid and rotated waterline contour
        // whenever any transform, orientation, scale, elevation, or cradle parameter changes
        const needsCradleRecalc =
          'rotation' in updates ||
          'rotationX' in updates ||
          'rotationY' in updates ||
          'rotationZ' in updates ||
          'scaleX' in updates ||
          'scaleY' in updates ||
          'scaleZ' in updates ||
          'lockAspectRatio' in updates ||
          'radius' in updates ||
          'height' in updates ||
          'elevation' in updates ||
          'beddingDepth' in updates ||
          'verticalExtrusion' in updates ||
          'cradleEnabled' in updates ||
          'cradleClearance' in updates ||
          'cradleBlendMargin' in updates ||
          'customMeshData' in updates ||
          'flipX' in updates ||
          'flipZ' in updates ||
          'flattenCradleAnomalies' in updates ||
          'cradleCeilingClamp' in updates ||
          !updated.cradleDepthGrid;

        return needsCradleRecalc ? ensureObstacleCradle(updated) : updated;
      })
    );
  };

  const handleUpdateObstaclePos = (id: string, x: number, z: number) => {
    setObstacles((prev) =>
      prev.map((o) => (o.id === id ? { ...o, x, z } : o))
    );
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === '[') {
        setBrush((b) => ({ ...b, size: Math.max(10, b.size - 10) }));
      } else if (e.key === ']') {
        setBrush((b) => ({ ...b, size: Math.min(300, b.size + 10) }));
      } else if (e.key === 'Shift') {
        setBrush((b) => ({ ...b, mode: 'erase' }));
      } else if (e.key === 'b' || e.key === 'p') {
        setView((v) => ({ ...v, activeTool: 'paint' }));
      } else if (e.key === 'v' || e.key === 'n') {
        setView((v) => ({ ...v, activeTool: 'orbit' }));
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        setIsProjectOpen(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setBrush((b) => ({ ...b, mode: 'paint' }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return (
    <div className="flex flex-col w-screen h-screen bg-neutral-950 text-neutral-100 overflow-hidden select-none font-sans">
      {/* ── TOP HEADER / WORKBENCH BAR ── */}
      <header className="h-14 border-b border-neutral-800/90 bg-neutral-900/90 backdrop-blur-md px-4 flex items-center justify-between flex-shrink-0 z-30">
        {/* Brand & Project Name */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-amber-400 p-0.5 shadow-md flex items-center justify-center flex-shrink-0">
            <div className="w-full h-full bg-neutral-950 rounded-[7px] flex items-center justify-center">
              <Waves className="w-4 h-4 text-cyan-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-sm tracking-tight text-neutral-100">
                SandRipple
              </h1>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                CNC Studio
              </span>
            </div>
            {/* Clickable Project Title */}
            <button
              onClick={() => setIsProjectOpen(true)}
              className="text-[11px] text-neutral-400 hover:text-cyan-300 flex items-center gap-1 transition-colors cursor-pointer text-left"
              title="Click to rename or manage project files"
            >
              <span className="font-medium text-neutral-300 max-w-[180px] truncate">
                {projectName}
              </span>
              <span className="text-[10px] text-neutral-500 font-mono">
                ({surface.width}×{surface.length}mm)
              </span>
            </button>
          </div>
        </div>

        {/* Center: Quick Project Save/Open & Material Controls */}
        <div className="flex items-center gap-2.5">
          {/* Project Save / Open Quick Button */}
          <button
            onClick={() => setIsProjectOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-950 hover:bg-neutral-850 border border-neutral-800 hover:border-neutral-700 text-neutral-200 text-xs font-semibold rounded-lg shadow-sm transition-all cursor-pointer"
            title="Open project manager (Save, Upload .json, or browse presets)"
          >
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>Project Files</span>
          </button>
          {/* Material Preset */}
          <div className="flex items-center gap-1.5 bg-neutral-950 border border-neutral-800 px-2 py-1 rounded-lg text-xs">
            <Palette className="w-3.5 h-3.5 text-neutral-400" />
            <select
              value={view.material}
              onChange={(e) =>
                setView((prev) => ({
                  ...prev,
                  material: e.target.value as MaterialType,
                }))
              }
              className="bg-transparent text-neutral-200 focus:outline-none cursor-pointer text-xs"
            >
              <option value="sandstone">🏖 Sandstone Dune</option>
              <option value="fine_sand">✨ Fine Ivory Beach</option>
              <option value="desert_gold">🌅 Desert Gold</option>
              <option value="granite">⛰ Slate Granite</option>
              <option value="machined_wood">🪵 Machined Timber</option>
              <option value="elevation_heatmap">🌈 CNC Depth Heatmap</option>
              <option value="slope_analysis">📐 3-Axis Draft Slope</option>
            </select>
          </div>

          {/* Quick Toggles */}
          <div className="flex items-center gap-1 bg-neutral-950 border border-neutral-800 p-1 rounded-lg">
            <button
              onClick={() =>
                setView((prev) => ({ ...prev, showGrid: !prev.showGrid }))
              }
              className={`p-1.5 rounded text-xs transition-colors ${
                view.showGrid ? 'bg-neutral-800 text-cyan-400' : 'text-neutral-500 hover:text-neutral-300'
              }`}
              title="Toggle Ground Grid"
            >
              <Grid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() =>
                setView((prev) => ({
                  ...prev,
                  showWireframe: !prev.showWireframe,
                }))
              }
              className={`p-1.5 rounded text-xs transition-colors ${
                view.showWireframe
                  ? 'bg-neutral-800 text-cyan-400'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
              title="Toggle Mesh Wireframe Overlay"
            >
              <Box className="w-3.5 h-3.5" />
            </button>

            {/* Option to visually toggle Stone 3D Mesh (without affecting its physics!) */}
            <button
              onClick={() =>
                setView((prev) => ({
                  ...prev,
                  showObstacleMeshes: !prev.showObstacleMeshes,
                }))
              }
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                view.showObstacleMeshes
                  ? 'bg-blue-900/40 text-blue-300 border border-blue-500/30'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
              title="Toggle Stone 3D Mesh (When hidden, mass displacement & wake effects remain active on sand!)"
            >
              <CircleDot className="w-3.5 h-3.5" />
              <span className="text-[10px]">
                {view.showObstacleMeshes ? 'Stone Visible' : 'Stone Hidden (Effects ON)'}
              </span>
            </button>

            {/* Visual Water Level Plane Toggle */}
            <button
              onClick={() =>
                setView((prev) => ({
                  ...prev,
                  showWaterPlane: !prev.showWaterPlane,
                }))
              }
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all cursor-pointer ${
                view.showWaterPlane
                  ? 'bg-sky-950 text-sky-300 border border-sky-500/50 shadow-sm shadow-sky-500/20'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
              title="Toggle Visual Water Level Plane (Visual aid while designing - excluded from CNC STL export)"
            >
              <Waves className={`w-3.5 h-3.5 ${view.showWaterPlane ? 'text-sky-400 animate-pulse' : 'text-neutral-500'}`} />
              <span className="text-[10px] font-medium">
                {view.showWaterPlane ? `Water ${view.waterLevel !== undefined && view.waterLevel > 0 ? `+${view.waterLevel}` : view.waterLevel ?? '+5'}mm` : 'Water Level'}
              </span>
            </button>

            {/* Visual 3D Bounding Box & Precision Caliper Measurements */}
            <button
              onClick={() =>
                setView((prev) => ({
                  ...prev,
                  showBoundingBox: !prev.showBoundingBox,
                }))
              }
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all cursor-pointer ${
                view.showBoundingBox
                  ? 'bg-amber-950/70 text-amber-300 border border-amber-500/50 shadow-sm shadow-amber-500/20'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
              title="Toggle 3D Bounding Box & Precision Caliper Measurements (Visual inspection guide)"
            >
              <Box className={`w-3.5 h-3.5 ${view.showBoundingBox ? 'text-amber-400' : 'text-neutral-500'}`} />
              <span className="text-[10px] font-medium">
                {view.showBoundingBox ? 'Box & Caliper ON' : 'Bounding Box'}
              </span>
            </button>
          </div>
        </div>

        {/* Right Action: Export STL */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExportOpen(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-neutral-950 font-bold text-xs rounded-lg shadow-lg shadow-cyan-500/20 transition-all active:scale-95 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export CNC STL</span>
          </button>
        </div>
      </header>

      {/* ── WORKSPACE BODY ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* ── LEFT CONTROL SIDEBAR ── */}
        <aside className="w-84 md:w-96 bg-neutral-900/95 border-r border-neutral-800/90 flex flex-col flex-shrink-0 z-20 overflow-hidden shadow-2xl">
          {/* Navigation Tabs */}
          <div className="grid grid-cols-4 p-1.5 bg-neutral-950/80 border-b border-neutral-800 gap-1 text-[11px] font-medium">
            <button
              onClick={() => setActiveTab('layers')}
              className={`py-1.5 rounded flex flex-col items-center gap-1 transition-colors cursor-pointer ${
                activeTab === 'layers'
                  ? 'bg-neutral-800 text-cyan-300 font-semibold shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Layers</span>
            </button>

            <button
              onClick={() => setActiveTab('dune_params')}
              className={`py-1.5 rounded flex flex-col items-center gap-1 transition-colors cursor-pointer ${
                activeTab === 'dune_params'
                  ? 'bg-neutral-800 text-cyan-300 font-semibold shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Dunes</span>
            </button>

            <button
              onClick={() => setActiveTab('surface')}
              className={`py-1.5 rounded flex flex-col items-center gap-1 transition-colors cursor-pointer ${
                activeTab === 'surface'
                  ? 'bg-neutral-800 text-cyan-300 font-semibold shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              <span>Canvas</span>
            </button>

            <button
              onClick={() => setActiveTab('obstacles')}
              className={`py-1.5 rounded flex flex-col items-center gap-1 transition-colors cursor-pointer ${
                activeTab === 'obstacles'
                  ? 'bg-neutral-800 text-cyan-300 font-semibold shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <CircleDot className="w-3.5 h-3.5" />
              <span>Stones</span>
            </button>
          </div>

          {/* Active Tab Panel Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeTab === 'layers' && (
              <LayerPanel
                layers={layers}
                selectedLayerId={selectedLayerId}
                onSelectLayer={setSelectedLayerId}
                onUpdateLayer={handleUpdateLayer}
                onAddLayer={handleAddLayer}
                onDeleteLayer={handleDeleteLayer}
                onDuplicateLayer={handleDuplicateLayer}
              />
            )}

            {activeTab === 'dune_params' && (
              <LayerControls
                layer={activeLayer}
                onUpdate={(updates) => {
                  if (activeLayer) handleUpdateLayer(activeLayer.id, updates);
                }}
              />
            )}

            {activeTab === 'surface' && (
              <SurfaceControls
                surface={surface}
                onUpdate={(updates) => setSurface((prev) => ({ ...prev, ...updates }))}
              />
            )}

            {activeTab === 'obstacles' && (
              <ObstaclePanel
                obstacles={obstacles}
                selectedObsId={selectedObsId}
                onSelectObstacle={setSelectedObsId}
                onAddObstacle={handleAddObstacle}
                onDeleteObstacle={handleDeleteObstacle}
                onUpdateObstacle={handleUpdateObstacle}
                surfaceWidth={surface.width}
                surfaceLength={surface.length}
                view={view}
                onUpdateView={(updates) => setView((prev) => ({ ...prev, ...updates }))}
              />
            )}
          </div>
        </aside>

        {/* ── CENTER 3D VIEWPORT & FLOATING BRUSH TOOLBAR ── */}
        <main className="flex-1 relative flex flex-col overflow-hidden bg-neutral-950">
          {/* Floating Top Brush Toolbar */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-auto max-w-[95%]">
            <BrushToolbar
              brush={brush}
              onUpdateBrush={(updates) => setBrush((prev) => ({ ...prev, ...updates }))}
              view={view}
              onUpdateView={(updates) => setView((prev) => ({ ...prev, ...updates }))}
              activeLayerName={activeLayer?.name || 'Active Layer'}
            />
          </div>

          {/* Three.js Interactive 3D Canvas */}
          <div className="w-full h-full flex-1">
            <Viewport
              surface={surface}
              layers={layers}
              selectedLayerId={selectedLayerId}
              onUpdateLayerMask={handleUpdateLayerMask}
              obstacles={obstacles}
              selectedObsId={selectedObsId}
              onSelectObstacle={setSelectedObsId}
              onUpdateObstaclePos={handleUpdateObstaclePos}
              view={view}
              brush={brush}
              onUpdateView={(updates) => setView((prev) => ({ ...prev, ...updates }))}
            />
          </div>
        </main>
      </div>

      {/* ── PROJECT SAVE / LOAD MODAL ── */}
      <ProjectModal
        isOpen={isProjectOpen}
        onClose={() => setIsProjectOpen(false)}
        projectName={projectName}
        onUpdateProjectName={setProjectName}
        surface={surface}
        layers={layers}
        obstacles={obstacles}
        brush={brush}
        view={view}
        onLoadProject={handleLoadProject}
      />

      {/* ── CNC EXPORT MODAL ── */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        surface={surface}
        layers={layers}
        obstacles={obstacles}
      />
    </div>
  );
}
