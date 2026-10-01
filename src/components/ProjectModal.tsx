import React, { useState, useRef, useEffect } from 'react';
import {
  SurfaceConfig,
  RippleLayer,
  Obstacle,
  BrushConfig,
  ViewConfig,
  SavedProjectSummary,
  ZenProject,
} from '../types';
import {
  serializeProject,
  deserializeProject,
  downloadProjectFile,
  readProjectJsonFile,
  getSavedProjectsList,
  saveProjectToBrowser,
  loadProjectFromBrowser,
  deleteProjectFromBrowser,
  getAutoSavedSession,
  PRESET_PROJECTS,
} from '../utils/projectStorage';
import {
  FolderOpen,
  Save,
  Download,
  Upload,
  FileJson,
  Trash2,
  Check,
  X,
  Sparkles,
  Clock,
  Layers,
  CircleDot,
  Box,
  AlertCircle,
  HelpCircle,
  FileDown,
  RefreshCw,
} from 'lucide-react';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  onUpdateProjectName: (name: string) => void;
  surface: SurfaceConfig;
  layers: RippleLayer[];
  obstacles: Obstacle[];
  brush: BrushConfig;
  view: ViewConfig;
  onLoadProject: (loaded: {
    projectMeta: { id: string; name: string; description?: string; updatedAt: string };
    surface: SurfaceConfig;
    layers: RippleLayer[];
    obstacles: Obstacle[];
    brush?: BrushConfig;
    view?: Partial<ViewConfig>;
  }) => void;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  projectName,
  onUpdateProjectName,
  surface,
  layers,
  obstacles,
  brush,
  view,
  onLoadProject,
}) => {
  const [activeTab, setActiveTab] = useState<'save' | 'load' | 'presets'>('save');
  const [localName, setLocalName] = useState(projectName);
  const [description, setDescription] = useState('');
  const [savedProjects, setSavedProjects] = useState<SavedProjectSummary[]>([]);
  const [autoSavedProj, setAutoSavedProj] = useState<ZenProject | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setLocalName(projectName);
      setSavedProjects(getSavedProjectsList());
      setAutoSavedProj(getAutoSavedSession());
      setStatusMessage(null);
    }
  }, [isOpen, projectName]);

  if (!isOpen) return null;

  const showStatus = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage((cur) => (cur?.text === text ? null : cur));
    }, 4000);
  };

  // ── SAVE HANDLERS ──
  const handleDownloadJson = () => {
    try {
      const proj = serializeProject(localName, surface, layers, obstacles, brush, view, undefined, description);
      onUpdateProjectName(localName);
      downloadProjectFile(proj);
      showStatus('success', `Exported "${proj.name}.json" to your computer!`);
    } catch (e: any) {
      showStatus('error', `Failed to download file: ${e.message}`);
    }
  };

  const handleSaveToBrowser = () => {
    try {
      const proj = serializeProject(localName, surface, layers, obstacles, brush, view, undefined, description);
      onUpdateProjectName(localName);
      const updatedList = saveProjectToBrowser(proj);
      setSavedProjects(updatedList);
      showStatus('success', `Project "${proj.name}" saved to browser library!`);
    } catch (e: any) {
      showStatus('error', `Failed to save: ${e.message}`);
    }
  };

  // ── LOAD HANDLERS ──
  const handleProcessProjectData = (rawJson: any, sourceName?: string) => {
    try {
      const deserialized = deserializeProject(rawJson);
      onLoadProject(deserialized);
      onUpdateProjectName(deserialized.projectMeta.name);
      showStatus(
        'success',
        `Successfully loaded "${deserialized.projectMeta.name}" with ${deserialized.layers.length} layers & ${deserialized.obstacles.length} obstacles!`
      );
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (e: any) {
      showStatus('error', `Could not load project: ${e.message}`);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const json = await readProjectJsonFile(file);
      handleProcessProjectData(json, file.name);
    } catch (err: any) {
      showStatus('error', err.message);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    try {
      const json = await readProjectJsonFile(file);
      handleProcessProjectData(json, file.name);
    } catch (err: any) {
      showStatus('error', err.message);
    }
  };

  const handleLoadFromBrowser = (id: string) => {
    const proj = loadProjectFromBrowser(id);
    if (!proj) {
      showStatus('error', 'Could not retrieve project from storage.');
      return;
    }
    handleProcessProjectData(proj);
  };

  const handleDeleteFromBrowser = (id: string, name: string) => {
    const updated = deleteProjectFromBrowser(id);
    setSavedProjects(updated);
    showStatus('success', `Deleted "${name}" from saved projects.`);
  };

  const handleLoadPreset = (preset: (typeof PRESET_PROJECTS)[0]) => {
    handleProcessProjectData(preset.project);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="p-4 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-400">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-neutral-100">Project Storage & Presets</h2>
              <p className="text-[11px] text-neutral-400">
                Save, download, or restore your CNC sand sculpting projects and layer parameters
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="grid grid-cols-3 p-1 bg-neutral-950/60 border-b border-neutral-800 gap-1 text-xs">
          <button
            onClick={() => setActiveTab('save')}
            className={`py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'save'
                ? 'bg-neutral-800 text-blue-300 shadow-sm border border-neutral-700'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            Save Current Project
          </button>
          <button
            onClick={() => setActiveTab('load')}
            className={`py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'load'
                ? 'bg-neutral-800 text-cyan-300 shadow-sm border border-neutral-700'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            Open & Import ({savedProjects.length})
          </button>
          <button
            onClick={() => setActiveTab('presets')}
            className={`py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'presets'
                ? 'bg-neutral-800 text-amber-300 shadow-sm border border-neutral-700'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Zen Design Presets
          </button>
        </div>

        {/* Status Notification Banner */}
        {statusMessage && (
          <div
            className={`px-4 py-2 text-xs flex items-center gap-2 border-b ${
              statusMessage.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-800/80 text-emerald-300'
                : 'bg-rose-950/80 border-rose-800/80 text-rose-300'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Body Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {/* ═══════════════════════════════════════════════════════════════════
              TAB 1: SAVE PROJECT
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'save' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-neutral-950/80 rounded-xl border border-neutral-800 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-200 block">
                    Project Name
                  </label>
                  <input
                    type="text"
                    value={localName}
                    onChange={(e) => setLocalName(e.target.value)}
                    placeholder="e.g. Zen Wave Board #1"
                    className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-400 block">
                    Notes / Description (Optional)
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. 1/4in ballnose, 2 stones with 1200mm wake reach"
                    className="w-full px-3 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Current Project Snapshot Summary */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 bg-neutral-950/50 border border-neutral-800 rounded-lg flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-400 flex items-center gap-1">
                    <Box className="w-3 h-3 text-cyan-400" /> Stock Dimensions
                  </span>
                  <span className="font-semibold text-neutral-200 font-mono">
                    {surface.width} × {surface.length} mm
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    r={surface.cornerRadius}mm fillet
                  </span>
                </div>

                <div className="p-2.5 bg-neutral-950/50 border border-neutral-800 rounded-lg flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-400 flex items-center gap-1">
                    <Layers className="w-3 h-3 text-blue-400" /> Sand Dune Layers
                  </span>
                  <span className="font-semibold text-neutral-200">
                    {layers.length} {layers.length === 1 ? 'Layer' : 'Layers'}
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    {layers.filter((l) => l.visible).length} active
                  </span>
                </div>

                <div className="p-2.5 bg-neutral-950/50 border border-neutral-800 rounded-lg flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-400 flex items-center gap-1">
                    <CircleDot className="w-3 h-3 text-amber-400" /> Stones & Extrusions
                  </span>
                  <span className="font-semibold text-neutral-200">
                    {obstacles.length} {obstacles.length === 1 ? 'Shape' : 'Shapes'}
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    {obstacles.filter((o) => (o.verticalExtrusion || 0) > 0).length} extruded
                  </span>
                </div>
              </div>

              {/* Comprehensive Settings Included in Save */}
              <div className="p-3 bg-neutral-950/60 rounded-xl border border-neutral-800/80 space-y-2 text-[11px]">
                <span className="font-semibold text-neutral-300 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  All Configuration Saved in Project:
                </span>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-neutral-400">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                    <span>Stock Size, Fillets & Basin Bowing</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                    <span>All Ripple Frequencies & Spacing</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <span>Lift Polarity (Lift Up / Carve Down)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span>Full 256×256 Painted Layer Masks</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    <span>Stone Positions, Radii & 3D Meshes</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span>
                    <span>Kelvin Wakes & Bow Mound Dynamics</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                    <span>Diffraction Backdraft, Pinch & Swirl</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span>
                    <span>Brush Settings & 3D Materials</span>
                  </div>
                </div>
              </div>

              {/* Save Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                {/* 1. Download to Disk */}
                <button
                  onClick={handleDownloadJson}
                  className="p-3.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/50 rounded-xl flex items-center justify-center gap-2.5 text-blue-200 font-semibold text-xs transition-all active:scale-98 cursor-pointer group"
                >
                  <FileDown className="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform" />
                  <div className="text-left">
                    <div>Download Project File (.json)</div>
                    <div className="text-[10px] font-normal text-blue-300/70">
                      Save complete state file to disk
                    </div>
                  </div>
                </button>

                {/* 2. Save in Browser Storage */}
                <button
                  onClick={handleSaveToBrowser}
                  className="p-3.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/50 rounded-xl flex items-center justify-center gap-2.5 text-emerald-200 font-semibold text-xs transition-all active:scale-98 cursor-pointer group"
                >
                  <Save className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                  <div className="text-left">
                    <div>Save to Browser Library</div>
                    <div className="text-[10px] font-normal text-emerald-300/70">
                      Quick 1-click slot in local storage
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              TAB 2: OPEN & IMPORT PROJECT
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'load' && (
            <div className="space-y-4">
              {/* File Upload / Drag & Drop Area */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`p-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center gap-2 transition-all cursor-pointer ${
                  isDragging
                    ? 'border-cyan-400 bg-cyan-500/10'
                    : 'border-neutral-750 bg-neutral-950/60 hover:bg-neutral-950 hover:border-neutral-600'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div className="p-3 bg-neutral-900 border border-neutral-800 rounded-full text-cyan-400 shadow-inner">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-neutral-200">
                    Click to browse or drag & drop project file (.json)
                  </span>
                  <p className="text-[11px] text-neutral-500">
                    Restores all surface dimensions, ripple frequencies, painted masks, stones, and wake variables
                  </p>
                </div>
              </div>

              {/* Auto-Saved Background Session if Available */}
              {autoSavedProj && (
                <div className="p-3 bg-cyan-950/40 border border-cyan-500/30 rounded-xl flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 bg-cyan-500/20 rounded-lg text-cyan-400">
                      <RefreshCw className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-neutral-200 flex items-center gap-1.5">
                        <span>Auto-Saved Background Session</span>
                        <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded font-mono">
                          Live AutoSave
                        </span>
                      </div>
                      <div className="text-[10px] text-neutral-400">
                        {autoSavedProj.name} ({autoSavedProj.layers?.length || 0} layers, {autoSavedProj.obstacles?.length || 0} stones)
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleProcessProjectData(autoSavedProj)}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer flex-shrink-0"
                  >
                    Restore AutoSave
                  </button>
                </div>
              )}

              {/* Saved Projects in Local Browser Library */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    Saved in Browser Library ({savedProjects.length})
                  </span>
                </div>

                {savedProjects.length === 0 ? (
                  <div className="p-4 bg-neutral-950/40 border border-neutral-800/60 rounded-xl text-center text-xs text-neutral-500">
                    No projects saved in browser yet. Save your current project or upload a .json file.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {savedProjects.map((p) => (
                      <div
                        key={p.id}
                        className="p-2.5 bg-neutral-950/80 border border-neutral-800 hover:border-neutral-700 rounded-xl flex items-center justify-between text-xs transition-colors"
                      >
                        <div className="flex flex-col gap-0.5 max-w-[340px]">
                          <span className="font-semibold text-neutral-200 truncate">{p.name}</span>
                          <div className="flex items-center gap-2 text-[10px] text-neutral-400">
                            <span>{p.dimensions}</span>
                            <span>•</span>
                            <span>{p.layerCount} layers</span>
                            <span>•</span>
                            <span>{p.obstacleCount} stones</span>
                            <span>•</span>
                            <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleLoadFromBrowser(p.id)}
                            className="px-2.5 py-1 bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                          >
                            Open
                          </button>
                          <button
                            onClick={() => handleDeleteFromBrowser(p.id, p.name)}
                            className="p-1 text-neutral-500 hover:text-rose-400 hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                            title="Delete from saved list"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              TAB 3: CURATED ZEN PRESETS
          ═══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'presets' && (
            <div className="space-y-3">
              <p className="text-xs text-neutral-400">
                Choose a pre-configured Zen sand sculpt. All settings, layers, and wake physics remain 100% customizable after loading.
              </p>

              <div className="space-y-2">
                {PRESET_PROJECTS.map((preset) => (
                  <div
                    key={preset.id}
                    className="p-3.5 bg-neutral-950/80 border border-neutral-800 hover:border-amber-500/40 rounded-xl flex items-start justify-between gap-3 text-xs transition-colors"
                  >
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-neutral-200 text-xs">{preset.name}</span>
                        <span className="px-1.5 py-0.5 bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded text-[10px] font-semibold">
                          {preset.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-400 leading-relaxed">
                        {preset.description}
                      </p>
                      <div className="flex items-center gap-3 text-[10px] text-neutral-500 pt-0.5">
                        <span>Stock: {preset.project.surface.width}×{preset.project.surface.length}mm</span>
                        <span>Layers: {preset.project.layers.length}</span>
                        <span>Shapes: {preset.project.obstacles.length}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleLoadPreset(preset)}
                      className="px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer flex-shrink-0"
                    >
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      Load Preset
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-neutral-950 border-t border-neutral-800 flex items-center justify-between text-xs text-neutral-500">
          <div className="flex items-center gap-1.5">
            <FileJson className="w-3.5 h-3.5 text-blue-400" />
            <span>Files are saved locally on your device as standard portable JSON.</span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
