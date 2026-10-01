import {
  SurfaceConfig,
  RippleLayer,
  Obstacle,
  BrushConfig,
  ViewConfig,
  ZenProject,
  SavedProjectSummary,
} from '../types';

const STORAGE_KEY_PREFIX = 'zen_sand_project_';
const STORAGE_INDEX_KEY = 'zen_sand_projects_index';
const AUTOSAVE_KEY = 'zen_sand_autosave';

/**
 * Safe numeric parser that preserves 0 and negative values, falling back only when undefined/null/NaN
 */
const num = (val: any, fallback: number): number => {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
};

/**
 * Serialize application state into a clean JSON-friendly ZenProject
 */
export function serializeProject(
  name: string,
  surface: SurfaceConfig,
  layers: RippleLayer[],
  obstacles: Obstacle[],
  brush?: BrushConfig,
  view?: Partial<ViewConfig>,
  id?: string,
  description?: string
): ZenProject {
  const now = new Date().toISOString();

  const serializedLayers = layers.map((layer) => {
    let maskArray: number[] | undefined;
    if (layer.maskData) {
      maskArray = Array.from(layer.maskData);
    }
    const { maskData, ...layerWithoutMask } = layer;
    return {
      ...layerWithoutMask,
      maskData: maskArray,
    };
  });

  const serializedObstacles = obstacles.map((obs) => {
    return {
      ...obs,
      customPolygonPoints: obs.customPolygonPoints
        ? obs.customPolygonPoints.map((p) => [p[0], p[1]] as [number, number])
        : undefined,
      customSdfGrid: obs.customSdfGrid ? Array.from(obs.customSdfGrid) : undefined,
      customMeshData: obs.customMeshData
        ? {
            positions: Array.from(obs.customMeshData.positions || []),
            normals: obs.customMeshData.normals ? Array.from(obs.customMeshData.normals) : undefined,
            indices: obs.customMeshData.indices ? Array.from(obs.customMeshData.indices) : undefined,
            bbox: obs.customMeshData.bbox ? { ...obs.customMeshData.bbox } : undefined,
            triangleCount: obs.customMeshData.triangleCount,
            vertexCount: obs.customMeshData.vertexCount,
          }
        : undefined,
      sourceDimensions: obs.sourceDimensions ? { ...obs.sourceDimensions } : undefined,
    };
  });

  return {
    version: 2,
    id: id || `proj_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    name: name.trim() || 'Zen Sand Sculpt',
    description: description || '',
    createdAt: now,
    updatedAt: now,
    surface: { ...surface },
    layers: serializedLayers,
    obstacles: serializedObstacles,
    brush: brush ? { ...brush } : undefined,
    view: view
      ? {
          ...view,
          material: view.material,
          showObstacleMeshes: view.showObstacleMeshes,
          applyObstaclePhysics: view.applyObstaclePhysics,
          showZones: view.showZones,
          showGrid: view.showGrid,
          showWireframe: view.showWireframe,
          showMaskOverlay: view.showMaskOverlay,
          activeTool: view.activeTool,
          lightingPreset: view.lightingPreset,
          showWaterPlane: view.showWaterPlane,
          waterLevel: view.waterLevel,
          waterOpacity: view.waterOpacity,
          waterColor: view.waterColor,
          waterExtents: view.waterExtents,
          waterAnimate: view.waterAnimate,
        }
      : undefined,
  };
}

/**
 * Deserialize a parsed JSON object into live React state objects with typed Float32Arrays
 */
export function deserializeProject(data: any): {
  projectMeta: { id: string; name: string; description?: string; updatedAt: string };
  surface: SurfaceConfig;
  layers: RippleLayer[];
  obstacles: Obstacle[];
  brush?: BrushConfig;
  view?: Partial<ViewConfig>;
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid project file: not a JSON object.');
  }

  // Validate or construct surface (Default width: 1300mm)
  const surface: SurfaceConfig = {
    ...data.surface,
    width: num(data.surface?.width, 1300),
    length: num(data.surface?.length, 400),
    cornerRadius: num(data.surface?.cornerRadius, 40),
    baseThickness: num(data.surface?.baseThickness, 10),
    resolution: num(data.surface?.resolution, 200),
    basinLift: num(data.surface?.basinLift, 0),
    basinMargin: num(data.surface?.basinMargin, 0),
    basinProfile: data.surface?.basinProfile === 'radial' ? 'radial' : 'conformal',
    basinCurvature: num(data.surface?.basinCurvature, 2),
  };

  // Reconstruct layers with Float32Array maskData
  const rawLayers = Array.isArray(data.layers) ? data.layers : [];
  const layers: RippleLayer[] = rawLayers.map((rawL: any, idx: number) => {
    const maskW = num(rawL.maskWidth, 256);
    const maskH = num(rawL.maskHeight, 256);
    let maskData: Float32Array;

    if (Array.isArray(rawL.maskData) && rawL.maskData.length > 0) {
      maskData = new Float32Array(rawL.maskData);
    } else {
      // Default empty flat mask (0.0 = no painted elevation)
      maskData = new Float32Array(maskW * maskH);
    }

    return {
      ...rawL,
      id: String(rawL.id || `layer_${idx}_${Date.now()}`),
      name: String(rawL.name || `Ripple Layer ${idx + 1}`),
      visible: rawL.visible !== false,
      opacity: num(rawL.opacity, 1.0),
      blendMode: rawL.blendMode || 'add',
      colorTag: rawL.colorTag || '#38bdf8',

      maskWidth: maskW,
      maskHeight: maskH,
      maskData,

      mode: rawL.mode || 'stretched_perlin',
      primaryDir: num(rawL.primaryDir, 0),
      amplitude: num(rawL.amplitude, 10),
      spacing: num(rawL.spacing, 45),

      invert: Boolean(rawL.invert),
      liftMode: rawL.liftMode || 'positive_lift',

      stretchRatio: num(rawL.stretchRatio, 12.0),
      stretchAngle: num(rawL.stretchAngle, 0),
      duneAsymmetry: num(rawL.duneAsymmetry, 0.4),
      sharpness: num(rawL.sharpness, 0.6),
      crestFlattening: num(rawL.crestFlattening, 0),

      warpIntensity: num(rawL.warpIntensity, 0.35),
      warpScale: num(rawL.warpScale, 0.8),
      noiseOctaves: num(rawL.noiseOctaves, 3),
      noiseSeed: num(rawL.noiseSeed, 42),

      microRipples: num(rawL.microRipples, 0.25),
      microSpacing: num(rawL.microSpacing, 12),
      noiseOverlay: num(rawL.noiseOverlay, 0.1),
    };
  });

  // If no valid layers found, provide a default fallback
  if (layers.length === 0) {
    layers.push({
      id: `layer_${Date.now()}`,
      name: 'Primary Sand Dunes',
      visible: true,
      opacity: 1.0,
      blendMode: 'add',
      colorTag: '#38bdf8',
      maskWidth: 256,
      maskHeight: 256,
      maskData: new Float32Array(256 * 256), // Start flat
      mode: 'stretched_perlin',
      primaryDir: 15,
      amplitude: 12,
      spacing: 50,
      invert: false,
      liftMode: 'positive_lift',
      stretchRatio: 16,
      stretchAngle: 15,
      duneAsymmetry: 0.45,
      sharpness: 0.65,
      crestFlattening: 0,
      warpIntensity: 0.4,
      warpScale: 0.8,
      noiseOctaves: 3,
      noiseSeed: 123,
      microRipples: 0.2,
      microSpacing: 14,
      noiseOverlay: 0.15,
    });
  }

  // Reconstruct obstacles with complete physical, extrusion, 3D rotation and CAD/mesh parameters
  const rawObstacles = Array.isArray(data.obstacles) ? data.obstacles : [];
  const obstacles: Obstacle[] = rawObstacles.map((rawO: any, idx: number) => ({
    ...rawO,
    id: String(rawO.id || `obs_${idx}_${Date.now()}`),
    name: String(rawO.name || `Zen Stone ${idx + 1}`),
    shape: rawO.shape || 'stone_sphere',
    x: num(rawO.x, 0),
    z: num(rawO.z, 0),
    radius: num(rawO.radius, 60),
    height: num(rawO.height, 75),
    mass: num(rawO.mass, 50),
    displacedSand: num(rawO.displacedSand, 0.7),
    disturbanceRadius: num(rawO.disturbanceRadius, 190),
    disturbanceIntensity: num(rawO.disturbanceIntensity, 0.85),
    wakeAngle: num(rawO.wakeAngle, 25),
    wakeLength: num(rawO.wakeLength, 250),
    enabled: rawO.enabled !== false,
    visibleMesh: rawO.visibleMesh !== false,

    // Vertical extrusion & bedding & conformal cradle
    elevation: rawO.elevation !== undefined ? Number(rawO.elevation) : undefined,
    cradleEnabled: rawO.cradleEnabled !== false,
    cradleClearance: num(rawO.cradleClearance, 0),
    cradleBlendMargin: num(rawO.cradleBlendMargin, 2.0),
    cradleDepthGrid: Array.isArray(rawO.cradleDepthGrid)
      ? Array.from(rawO.cradleDepthGrid).map((v) => Number(v) || 0)
      : undefined,
    cradleGridRes: num(rawO.cradleGridRes, 64),
    cradleBBox:
      rawO.cradleBBox && typeof rawO.cradleBBox === 'object'
        ? {
            minX: num(rawO.cradleBBox.minX, -50),
            maxX: num(rawO.cradleBBox.maxX, 50),
            minZ: num(rawO.cradleBBox.minZ, -50),
            maxZ: num(rawO.cradleBBox.maxZ, 50),
            minY: num(rawO.cradleBBox.minY, -20),
            maxY: num(rawO.cradleBBox.maxY, 40),
          }
        : undefined,
    cradleWaterlineContour: Array.isArray(rawO.cradleWaterlineContour)
      ? rawO.cradleWaterlineContour.map((p: any) => [Number(p[0]) || 0, Number(p[1]) || 0] as [number, number])
      : undefined,

    flattenUnderFootprint: rawO.flattenUnderFootprint !== false,
    beddingDepth: num(rawO.beddingDepth, 0),
    verticalExtrusion: num(rawO.verticalExtrusion, 0),
    extrusionDraftAngle: num(rawO.extrusionDraftAngle, 20),
    extrusionBevel: num(rawO.extrusionBevel, 2.0),
    extrusionCapProfile: rawO.extrusionCapProfile || 'flat',

    // Wake variables
    wakeAmplitude: num(rawO.wakeAmplitude, 8.0),
    wakeWavelength: num(rawO.wakeWavelength, 28),
    wakeDecayRate: num(rawO.wakeDecayRate, 1.0),
    wakeScourDepth: num(rawO.wakeScourDepth, 0),
    wakeTurbulence: num(rawO.wakeTurbulence, 0),
    wakeVerticalLift: num(rawO.wakeVerticalLift, 0),
    wakeSoftening: num(rawO.wakeSoftening, 0.75),
    bowMoundHeight: num(rawO.bowMoundHeight, 8.0),
    bowMoundDistance: num(rawO.bowMoundDistance, 60),
    diffractionRings: num(rawO.diffractionRings, 0.5),
    diffractionSpacing: num(rawO.diffractionSpacing, 30),
    diffractionPinch: num(rawO.diffractionPinch, 0),
    diffractionPinchAngle:
      rawO.diffractionPinchAngle !== undefined && rawO.diffractionPinchAngle !== null && !isNaN(Number(rawO.diffractionPinchAngle))
        ? Number(rawO.diffractionPinchAngle)
        : undefined,
    diffractionStretch: num(rawO.diffractionStretch, 1.0),
    diffractionStretchAngle:
      rawO.diffractionStretchAngle !== undefined && rawO.diffractionStretchAngle !== null && !isNaN(Number(rawO.diffractionStretchAngle))
        ? Number(rawO.diffractionStretchAngle)
        : undefined,
    diffractionSwirl: num(rawO.diffractionSwirl, 0),
    diffractionFlutter: num(rawO.diffractionFlutter, 0),

    // 3D Rotations & Transforms
    rotation: num(rawO.rotation, 0),
    rotationX: num(rawO.rotationX, 0),
    rotationY: num(rawO.rotationY, rawO.rotation !== undefined ? Number(rawO.rotation) : 0),
    rotationZ: num(rawO.rotationZ, 0),
    flipX: Boolean(rawO.flipX),
    flipZ: Boolean(rawO.flipZ),
    lockAspectRatio: rawO.lockAspectRatio !== false,
    upAxis: rawO.upAxis || 'Y',
    scaleX: num(rawO.scaleX, 1.0),
    scaleY: num(rawO.scaleY, 1.0),
    scaleZ: num(rawO.scaleZ, 1.0),

    // Vector & 2D Contour
    customSvgPath: rawO.customSvgPath,
    customPolygonPoints: Array.isArray(rawO.customPolygonPoints)
      ? rawO.customPolygonPoints.map((p: any) => [Number(p[0]) || 0, Number(p[1]) || 0] as [number, number])
      : undefined,
    customSdfGrid: Array.isArray(rawO.customSdfGrid)
      ? rawO.customSdfGrid.map((v: any) => Number(v) || 0)
      : undefined,
    customSdfRes: num(rawO.customSdfRes, 64),

    // 3D Mesh / CAD Source Data (STL, OBJ, DXF)
    customMeshData:
      rawO.customMeshData && typeof rawO.customMeshData === 'object'
        ? {
            positions: Array.isArray(rawO.customMeshData.positions)
              ? Array.from(rawO.customMeshData.positions).map((n) => Number(n) || 0)
              : [],
            normals: Array.isArray(rawO.customMeshData.normals)
              ? Array.from(rawO.customMeshData.normals).map((n) => Number(n) || 0)
              : undefined,
            indices: Array.isArray(rawO.customMeshData.indices)
              ? Array.from(rawO.customMeshData.indices).map((n) => Number(n) || 0)
              : undefined,
            bbox: rawO.customMeshData.bbox
              ? {
                  minX: num(rawO.customMeshData.bbox.minX, -50),
                  maxX: num(rawO.customMeshData.bbox.maxX, 50),
                  minY: num(rawO.customMeshData.bbox.minY, 0),
                  maxY: num(rawO.customMeshData.bbox.maxY, 50),
                  minZ: num(rawO.customMeshData.bbox.minZ, -50),
                  maxZ: num(rawO.customMeshData.bbox.maxZ, 50),
                }
              : undefined,
            triangleCount:
              rawO.customMeshData.triangleCount !== undefined
                ? Number(rawO.customMeshData.triangleCount)
                : undefined,
            vertexCount:
              rawO.customMeshData.vertexCount !== undefined
                ? Number(rawO.customMeshData.vertexCount)
                : undefined,
          }
        : undefined,
    sourceFormat: rawO.sourceFormat,
    originalFileName: rawO.originalFileName,
    sourceDimensions:
      rawO.sourceDimensions && typeof rawO.sourceDimensions === 'object'
        ? {
            width: num(rawO.sourceDimensions.width, 0),
            height: num(rawO.sourceDimensions.height, 0),
            depth: num(rawO.sourceDimensions.depth, 0),
          }
        : undefined,
  }));

  const brush: BrushConfig | undefined = data.brush
    ? {
        ...data.brush,
        size: num(data.brush.size, 75),
        hardness: num(data.brush.hardness, 0.35),
        opacity: num(data.brush.opacity, 0.65),
        mode: data.brush.mode || 'paint',
      }
    : undefined;

  const view: Partial<ViewConfig> | undefined = data.view
    ? {
        ...data.view,
        material: data.view.material || 'sandstone',
        showObstacleMeshes: data.view.showObstacleMeshes !== false,
        applyObstaclePhysics: data.view.applyObstaclePhysics !== false,
        showZones: Boolean(data.view.showZones),
        showGrid: Boolean(data.view.showGrid),
        showWireframe: Boolean(data.view.showWireframe),
        showMaskOverlay: Boolean(data.view.showMaskOverlay),
        activeTool: data.view.activeTool || 'paint',
        lightingPreset: data.view.lightingPreset || 'desert_sun',
        showWaterPlane: Boolean(data.view.showWaterPlane),
        waterLevel: num(data.view.waterLevel, 5.0),
        waterOpacity: num(data.view.waterOpacity, 0.45),
        waterColor: String(data.view.waterColor || '#0284c7'),
        waterExtents: data.view.waterExtents === 'wide' ? 'wide' : 'fit',
        waterAnimate: Boolean(data.view.waterAnimate),
      }
    : undefined;

  return {
    projectMeta: {
      id: String(data.id || `proj_${Date.now()}`),
      name: String(data.name || 'Zen Sand Project'),
      description: data.description ? String(data.description) : undefined,
      updatedAt: String(data.updatedAt || new Date().toISOString()),
    },
    surface,
    layers,
    obstacles,
    brush,
    view,
  };
}

/**
 * Trigger download of the project JSON file
 */
export function downloadProjectFile(project: ZenProject) {
  const jsonStr = JSON.stringify(project, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const cleanName = project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${cleanName || 'zen-sand-sculpt'}-${dateStr}.json`;

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Read and parse a project file uploaded by user
 */
export function readProjectJsonFile(file: File): Promise<ZenProject> {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file selected.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);
        resolve(parsed);
      } catch (err: any) {
        reject(new Error(`Failed to parse JSON project file: ${err?.message || 'Invalid format'}`));
      }
    };
    reader.onerror = () => reject(new Error('Error reading file.'));
    reader.readAsText(file);
  });
}

// ── LOCAL STORAGE REPOSITORY ──

export function getSavedProjectsList(): SavedProjectSummary[] {
  try {
    const indexRaw = localStorage.getItem(STORAGE_INDEX_KEY);
    if (!indexRaw) return [];
    const list = JSON.parse(indexRaw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('Failed to load project index from localStorage', e);
    return [];
  }
}

export function saveProjectToBrowser(project: ZenProject): SavedProjectSummary[] {
  try {
    // Save project data
    const key = `${STORAGE_KEY_PREFIX}${project.id}`;
    localStorage.setItem(key, JSON.stringify(project));

    // Update index list
    const index = getSavedProjectsList();
    const summary: SavedProjectSummary = {
      id: project.id,
      name: project.name,
      updatedAt: new Date().toISOString(),
      layerCount: project.layers.length,
      obstacleCount: project.obstacles.length,
      dimensions: `${project.surface.width}×${project.surface.length} mm`,
    };

    const filtered = index.filter((p) => p.id !== project.id);
    const updatedIndex = [summary, ...filtered].slice(0, 30); // Keep last 30 projects
    localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(updatedIndex));

    return updatedIndex;
  } catch (e) {
    console.error('Failed to save project to browser storage', e);
    throw new Error('Browser storage full or unavailable.');
  }
}

export function loadProjectFromBrowser(id: string): ZenProject | null {
  try {
    const key = `${STORAGE_KEY_PREFIX}${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to load project ${id} from browser storage`, e);
    return null;
  }
}

export function deleteProjectFromBrowser(id: string): SavedProjectSummary[] {
  try {
    const key = `${STORAGE_KEY_PREFIX}${id}`;
    localStorage.removeItem(key);

    const index = getSavedProjectsList();
    const updatedIndex = index.filter((p) => p.id !== id);
    localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(updatedIndex));
    return updatedIndex;
  } catch (e) {
    console.error(`Failed to delete project ${id}`, e);
    return getSavedProjectsList();
  }
}

export function saveAutoSaveSession(project: ZenProject) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  } catch (e) {
    // Ignore quota errors in background autosave
  }
}

export function getAutoSavedSession(): ZenProject | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// ── CURATED BUILT-IN PRESETS ──

export const PRESET_PROJECTS: Array<{
  id: string;
  name: string;
  badge: string;
  description: string;
  project: ZenProject;
}> = [
  {
    id: 'preset_kelvin_twin_stones',
    name: 'Twin Stone Kelvin Wake & Dunes',
    badge: 'Zen Garden',
    description: 'Two weathered river boulders carving long divergent V-wave wakes across sweeping asymmetric sand dunes.',
    project: {
      version: 2,
      id: 'preset_kelvin_twin_stones',
      name: 'Twin Stone Kelvin Wake & Dunes',
      description: 'Two weathered river boulders with Kelvin wake flow',
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
      surface: {
        width: 1300,
        length: 450,
        cornerRadius: 45,
        baseThickness: 12,
        resolution: 220,
      },
      layers: [
        {
          id: 'layer_main_dune',
          name: 'Primary Sand Flow',
          visible: true,
          opacity: 1.0,
          blendMode: 'add',
          colorTag: '#38bdf8',
          maskWidth: 256,
          maskHeight: 256,
          mode: 'stretched_perlin',
          primaryDir: 12,
          amplitude: 14,
          spacing: 52,
          stretchRatio: 18,
          stretchAngle: 12,
          duneAsymmetry: 0.45,
          sharpness: 0.65,
          crestFlattening: 0,
          warpIntensity: 0.35,
          warpScale: 0.85,
          noiseOctaves: 3,
          noiseSeed: 42,
          microRipples: 0.25,
          microSpacing: 14,
          noiseOverlay: 0.12,
        },
      ],
      obstacles: [
        {
          id: 'stone_upstream',
          name: 'Upstream Boulder',
          shape: 'stone_sphere',
          x: -320,
          z: -40,
          radius: 75,
          height: 85,
          mass: 65,
          displacedSand: 0.85,
          disturbanceRadius: 220,
          disturbanceIntensity: 0.9,
          wakeAngle: 24,
          wakeLength: 850,
          enabled: true,
          visibleMesh: true,
          flattenUnderFootprint: true,
          beddingDepth: 0,
          verticalExtrusion: 0,
          wakeAmplitude: 9.5,
          wakeWavelength: 30,
          wakeDecayRate: 0.85,
          wakeScourDepth: 0,
          wakeTurbulence: 0.15,
          wakeVerticalLift: 2.0,
          bowMoundHeight: 9.0,
          bowMoundDistance: 70,
          diffractionRings: 0.6,
          diffractionSpacing: 32,
          rotation: 15,
          scaleX: 1.15,
          scaleZ: 0.95,
        },
        {
          id: 'stone_leeward',
          name: 'Leeward River Pebble',
          shape: 'organic_pebble',
          x: 240,
          z: 50,
          radius: 55,
          height: 65,
          mass: 45,
          displacedSand: 0.75,
          disturbanceRadius: 180,
          disturbanceIntensity: 0.8,
          wakeAngle: 26,
          wakeLength: 650,
          enabled: true,
          visibleMesh: true,
          flattenUnderFootprint: true,
          beddingDepth: 0,
          verticalExtrusion: 0,
          wakeAmplitude: 7.5,
          wakeWavelength: 26,
          wakeDecayRate: 1.0,
          wakeScourDepth: 0,
          wakeTurbulence: 0.1,
          wakeVerticalLift: 0,
          bowMoundHeight: 6.5,
          bowMoundDistance: 50,
          diffractionRings: 0.5,
          diffractionSpacing: 28,
          rotation: 45,
          scaleX: 1.25,
          scaleZ: 0.85,
        },
      ],
      brush: {
        size: 80,
        hardness: 0.35,
        opacity: 0.7,
        mode: 'paint',
      },
      view: {
        material: 'sandstone',
        showObstacleMeshes: true,
        applyObstaclePhysics: true,
        showZones: false,
        showGrid: false,
        showWireframe: false,
        lightingPreset: 'desert_sun',
      },
    },
  },
  {
    id: 'preset_extruded_bonsai_island',
    name: 'Extruded Bonsai Island & Stepped Plateau',
    badge: 'CNC Architecture',
    description: 'A 15mm vertically extruded monolithic island with chamfered draft angle and dome cap rising out of sculpted dunes.',
    project: {
      version: 2,
      id: 'preset_extruded_bonsai_island',
      name: 'Extruded Bonsai Island & Stepped Plateau',
      description: 'Monolithic raised island with radial ripples',
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
      surface: {
        width: 1200,
        length: 450,
        cornerRadius: 40,
        baseThickness: 14,
        resolution: 200,
      },
      layers: [
        {
          id: 'layer_concentric_sand',
          name: 'Concentric Dune Waves',
          visible: true,
          opacity: 1.0,
          blendMode: 'add',
          colorTag: '#06b6d4',
          maskWidth: 256,
          maskHeight: 256,
          mode: 'concentric',
          primaryDir: 0,
          amplitude: 11,
          spacing: 38,
          stretchRatio: 1.0,
          stretchAngle: 0,
          duneAsymmetry: 0.3,
          sharpness: 0.6,
          crestFlattening: 0,
          warpIntensity: 0.2,
          warpScale: 0.7,
          noiseOctaves: 3,
          noiseSeed: 88,
          microRipples: 0.2,
          microSpacing: 12,
          noiseOverlay: 0.1,
        },
      ],
      obstacles: [
        {
          id: 'extruded_island_center',
          name: 'Raised Bonsai Plateau',
          shape: 'custom_svg',
          x: 0,
          z: 0,
          radius: 95,
          height: 70,
          mass: 80,
          displacedSand: 0.6,
          disturbanceRadius: 260,
          disturbanceIntensity: 0.9,
          wakeAngle: 25,
          wakeLength: 450,
          enabled: true,
          visibleMesh: false,
          flattenUnderFootprint: true,
          beddingDepth: 0,
          verticalExtrusion: 16.0,
          extrusionDraftAngle: 25,
          extrusionBevel: 3.5,
          extrusionCapProfile: 'dome',
          wakeAmplitude: 6.0,
          wakeWavelength: 28,
          wakeDecayRate: 1.0,
          wakeScourDepth: 0,
          wakeTurbulence: 0,
          wakeVerticalLift: 0,
          bowMoundHeight: 5.0,
          bowMoundDistance: 50,
          diffractionRings: 0.7,
          diffractionSpacing: 28,
          rotation: 0,
          scaleX: 1.35,
          scaleZ: 0.9,
        },
      ],
      brush: {
        size: 75,
        hardness: 0.35,
        opacity: 0.65,
        mode: 'paint',
      },
      view: {
        material: 'machined_wood',
        showObstacleMeshes: false,
        applyObstaclePhysics: true,
        showZones: false,
        showGrid: false,
        showWireframe: false,
        lightingPreset: 'cnc_inspection',
      },
    },
  },
  {
    id: 'preset_rolling_ocean_swell',
    name: 'Organic Rolling Swell & River Stones',
    badge: 'Ocean Swell',
    description: 'Smooth, natural rolling ripples with organic wave interference and gentle non-concentric seabed swells.',
    project: {
      version: 2,
      id: 'preset_rolling_ocean_swell',
      name: 'Organic Rolling Swell & River Stones',
      description: 'Natural rolling ripples with organic wave interference',
      createdAt: '2026-09-06T00:00:00.000Z',
      updatedAt: '2026-09-06T00:00:00.000Z',
      surface: {
        width: 1300,
        length: 420,
        cornerRadius: 40,
        baseThickness: 12,
        resolution: 210,
      },
      layers: [
        {
          id: 'layer_rolling_swell',
          name: 'Rolling Ocean Swell',
          visible: true,
          opacity: 1.0,
          blendMode: 'add',
          colorTag: '#06b6d4',
          maskWidth: 256,
          maskHeight: 256,
          mode: 'rolling_ripples',
          primaryDir: 20,
          amplitude: 11,
          spacing: 42,
          stretchRatio: 10,
          stretchAngle: 0,
          duneAsymmetry: 0.35,
          sharpness: 0.4,
          crestFlattening: 0,
          warpIntensity: 0.65,
          warpScale: 0.85,
          noiseOctaves: 4,
          noiseSeed: 108,
          microRipples: 0.18,
          microSpacing: 10,
          noiseOverlay: 0.08,
        },
      ],
      obstacles: [
        {
          id: 'river_stone_center',
          name: 'Natural River Pebble',
          shape: 'organic_pebble',
          x: -120,
          z: -10,
          radius: 70,
          height: 65,
          mass: 50,
          displacedSand: 0.7,
          disturbanceRadius: 210,
          disturbanceIntensity: 0.85,
          wakeAngle: 24,
          wakeLength: 520,
          enabled: true,
          visibleMesh: true,
          flattenUnderFootprint: true,
          beddingDepth: 3.0,
          wakeAmplitude: 6.5,
          wakeWavelength: 30,
          wakeDecayRate: 0.9,
          wakeSoftening: 0.8,
          bowMoundHeight: 6.0,
          bowMoundDistance: 55,
          diffractionRings: 0.45,
          diffractionSpacing: 30,
          rotation: 25,
          scaleX: 1.2,
          scaleZ: 0.85,
        },
      ],
      brush: {
        size: 80,
        hardness: 0.4,
        opacity: 0.7,
        mode: 'paint',
      },
      view: {
        material: 'sandstone',
        showObstacleMeshes: true,
        applyObstaclePhysics: true,
        showZones: false,
        showGrid: false,
        showWireframe: false,
        lightingPreset: 'desert_sun',
      },
    },
  },
  {
    id: 'preset_desert_sand_hummocks',
    name: 'Desert Sand Hummocks & Wind Mounds',
    badge: 'Sand Hummocks',
    description: 'Discrete, non-continuous organic sand lumps and rounded mounds acting like real wind-heaped aeolian desert sand.',
    project: {
      version: 2,
      id: 'preset_desert_sand_hummocks',
      name: 'Desert Sand Hummocks & Wind Mounds',
      description: 'Random non-continuous sand mounds and natural hummocks',
      createdAt: '2026-09-06T00:00:00.000Z',
      updatedAt: '2026-09-06T00:00:00.000Z',
      surface: {
        width: 1200,
        length: 500,
        cornerRadius: 30,
        baseThickness: 14,
        resolution: 200,
      },
      layers: [
        {
          id: 'layer_sand_hummocks',
          name: 'Desert Sand Hummocks',
          visible: true,
          opacity: 1.0,
          blendMode: 'add',
          colorTag: '#f59e0b',
          maskWidth: 256,
          maskHeight: 256,
          mode: 'sand_hummocks',
          primaryDir: 35,
          amplitude: 14,
          spacing: 65,
          stretchRatio: 3.5,
          stretchAngle: 0,
          duneAsymmetry: 0.25,
          sharpness: 0.3,
          crestFlattening: 0,
          warpIntensity: 0.55,
          warpScale: 0.9,
          noiseOctaves: 4,
          noiseSeed: 88,
          microRipples: 0.12,
          microSpacing: 12,
          noiseOverlay: 0.05,
        },
      ],
      obstacles: [],
      brush: {
        size: 80,
        hardness: 0.4,
        opacity: 0.7,
        mode: 'paint',
      },
      view: {
        material: 'sandstone',
        showObstacleMeshes: true,
        applyObstaclePhysics: true,
        showZones: false,
        showGrid: false,
        showWireframe: false,
        lightingPreset: 'desert_sun',
      },
    },
  },
];
