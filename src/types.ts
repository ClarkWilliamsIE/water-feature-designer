export type RippleMode =
  | 'stretched_perlin'
  | 'warped_perlin'
  | 'ridged_crests'
  | 'windblown_drift'
  | 'concentric'
  | 'tidal_flats'
  | 'rolling_ripples'
  | 'sand_hummocks';

export type BlendMode = 'add' | 'max' | 'multiply' | 'replace';

export type ElevationLiftMode = 'positive_lift' | 'centered' | 'carved_groove';

export interface RippleLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0.0 - 1.0
  blendMode: BlendMode;
  colorTag: string;
  
  // Mask properties (256x256 normalized float array, 1.0 = full weight, 0.0 = no effect)
  maskWidth: number;
  maskHeight: number;
  maskData: Float32Array;

  // Parametric controls
  mode: RippleMode;
  primaryDir: number; // 0 - 360°
  amplitude: number; // mm
  spacing: number; // mm wavelength
  
  // Elevation Direction & Polarity (Lift Up vs Carved Down / Invert)
  invert?: boolean; // Invert elevation polarity (flips crests to troughs or vice versa)
  liftMode?: ElevationLiftMode; // 'positive_lift' (rises up 0..+Height), 'centered' (-Height..+Height), 'carved_groove' (-Height..0)

  // Extended Stretched Dune controls
  stretchRatio: number; // 1.0 to 50.0x elongated dunes
  stretchAngle: number; // 0 - 360°
  duneAsymmetry: number; // 0.0 - 1.0 (stoss vs steep slip face)
  sharpness: number; // 0.0 - 1.0 (crest sharpness)
  crestFlattening: number; // 0.0 - 1.0 (mesa plateau vs peak)
  
  // Meander & Turbulence
  warpIntensity: number; // 0.0 - 2.0 (domain warp S-curves)
  warpScale: number; // 0.2 - 3.0 (scale of sweep meanders)
  noiseOctaves: number; // 1 - 6
  noiseSeed: number;
  
  // Secondary Grain & Micro Dunes
  microRipples: number; // 0.0 - 1.0
  microSpacing: number; // mm
  noiseOverlay: number; // 0.0 - 1.0 (organic grain)
}

export interface SurfaceConfig {
  width: number; // mm (e.g. 1300)
  length: number; // mm (e.g. 400)
  cornerRadius: number; // mm (physical corner fillet cut!)
  baseThickness: number; // mm (solid bottom CNC substrate)
  resolution: number; // mesh grid samples (e.g. 200)

  // Gentle Basin Edge Bowing (raises perimeter rim so surface dishes downward to middle)
  basinLift?: number; // mm elevation lift at perimeter edge (0 = flat, >0 = concave basin)
  basinMargin?: number; // mm margin from edge where bowing occurs (0 = full surface dish spanning to center)
  basinProfile?: 'conformal' | 'radial'; // 'conformal' = follows canvas edges & fillets evenly, 'radial' = elliptical bowl
  basinCurvature?: number; // 1 = linear, 2 = smooth cosine (default), 3 = soft parabolic
}

export interface Obstacle {
  id: string;
  name: string;
  shape:
    | 'stone_sphere'
    | 'stone_boulder'
    | 'cylinder'
    | 'box'
    | 'organic_pebble'
    | 'custom_svg'
    | 'custom_dxf'
    | 'custom_3d'
    | 'custom_mask';
  x: number; // mm
  z: number; // mm
  radius: number; // mm (primary radius / half-width)
  height: number; // mm (3D stone height)
  mass: number; // kg
  displacedSand: number; // rim scale (0 to 2.0)
  disturbanceRadius: number; // mm
  disturbanceIntensity: number; // 0 - 1
  wakeAngle: number; // degrees
  wakeLength: number; // mm
  enabled?: boolean; // physical effect on/off
  visibleMesh?: boolean; // visual 3D mesh rendering on/off

  // ── VERTICAL EXTRUSION & CONFORMAL CRADLE (Wrapping Plane Around Underside of Shape) ──
  elevation?: number; // mm: Vertical height of the shape relative to the plane (negative sinks into plane)
  cradleEnabled?: boolean; // true = sand surface wraps around underside of shape, cradling it in place
  cradleClearance?: number; // mm: Machining tolerance / gap between shape and cradle (0 = snug fit)
  cradleBlendMargin?: number; // mm: Smooth fillet where sand meets the shape at the plane
  cradleDepthGrid?: number[]; // precomputed underside depth grid
  cradleGridRes?: number; // grid resolution (e.g. 64)
  cradleBBox?: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
  cradleWaterlineContour?: [number, number][]; // normalized waterline profile at the plane
  hasSurfaceContact?: boolean; // false = stone is elevated in the air and does not touch the sand bed plane
  flattenCradleAnomalies?: boolean; // true = identify spikes, voids & upward penetrations in cradle and flatten them off
  cradleCeilingClamp?: number; // mm: maximum elevation ceiling for the cradle (default 0.0 to stay at or below sand plane)

  flattenUnderFootprint?: boolean; // true = flatten or extrude surface under footprint
  beddingDepth?: number; // mm (base floor elevation)
  verticalExtrusion?: number; // mm: Vertical height of the extruded stone island/plateau above sand (0 = flush pocket, >0 = raised monolithic pillar/plateau)
  extrusionDraftAngle?: number; // degrees: Draft angle/slope of the extruded vertical sidewall (0° = vertical cliff, 45° = chamfered ramp)
  extrusionBevel?: number; // mm: Radius/fillet of the top plateau rim edge
  extrusionCapProfile?: 'flat' | 'dome' | 'pyramid' | 'stepped'; // shape of the extruded top

  // ── EXTENDED WAKE DYNAMICS & VARIABLES ──
  wakeAmplitude?: number; // mm: Peak wave crest height of the V-wake arms (e.g. 2 - 25mm)
  wakeWavelength?: number; // mm: Crest-to-crest spacing of the wake ripples (e.g. 10 - 80mm)
  wakeDecayRate?: number; // 0.2 to 2.5: Linear/exponential attenuation speed with distance
  wakeScourDepth?: number; // mm: Depth of the central aerodynamic scour trough behind the stone
  wakeTurbulence?: number; // 0 to 1: Secondary chaotic eddy ripples / eddy shedding in the wake
  wakeVerticalLift?: number; // mm: Leeward sand accumulation slope (ramps the wake dunes upward)
  wakeSoftening?: number; // 0.1 to 1.0: Feathering & blend smoothness where wake joins sand & stone perimeter (default 0.75)
  bowMoundHeight?: number; // mm: Upstream windward sand accumulation dune height
  bowMoundDistance?: number; // mm: Upstream bow shock stand-off distance
  diffractionRings?: number; // 0 to 5.0+: Intensity multiplier of concentric radial diffraction ripple rings (0% to 500%+)
  diffractionSpacing?: number; // mm: Wavelength of diffraction ripples
  diffractionPinch?: number; // -1.0 to 1.0: Directional backdraft pinch / teardrop cusp distortion
  diffractionPinchAngle?: number; // degrees: Direction of backdraft pinch (0-360, default aligns with wake)
  diffractionStretch?: number; // 0.3 to 3.0: Elliptical elongation of diffraction rings
  diffractionStretchAngle?: number; // degrees: Direction of elliptical elongation (0-360)
  diffractionSwirl?: number; // -2.0 to 2.0: Spiral vortex twist / eddy circulation
  diffractionFlutter?: number; // 0 to 1.0: Organic turbulent ripple warp / water flutter

  // Custom Shape attributes & 3D Transform
  rotation?: number; // degrees (0 - 360, Yaw / Y-axis)
  rotationX?: number; // degrees (-180 to +180, Pitch / X-axis)
  rotationY?: number; // degrees (0 - 360, Yaw / Y-axis)
  rotationZ?: number; // degrees (-180 to +180, Roll / Z-axis)
  flipX?: boolean; // Mirror horizontally
  flipZ?: boolean; // Mirror vertically / depth
  lockAspectRatio?: boolean; // Preserve 1:1 proportion on scale
  upAxis?: 'Y' | 'Z' | 'X' | '-Z' | '-Y' | '-X'; // CAD origin orientation
  scaleX?: number; // stretch factor along X (default 1.0)
  scaleY?: number; // stretch factor along Y / vertical height (default 1.0)
  scaleZ?: number; // stretch factor along Z (default 1.0)
  customSvgPath?: string; // SVG path string
  customPolygonPoints?: [number, number][]; // normalized contour vertices [[x,z], ...] (-1 to 1)
  customSdfGrid?: number[]; // precomputed distance field array
  customSdfRes?: number; // resolution of distance field (e.g. 64)

  // 3D Mesh / CAD Source Data (STL, OBJ, DXF)
  customMeshData?: {
    positions: number[]; // Flat array of [x, y, z, ...]
    normals?: number[]; // Flat array of [nx, ny, nz, ...]
    indices?: number[]; // Optional triangle index buffer
    bbox?: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
    triangleCount?: number;
    vertexCount?: number;
  };
  sourceFormat?: 'svg' | 'dxf' | 'stl' | 'obj' | 'image' | 'preset';
  originalFileName?: string;
  sourceDimensions?: { width: number; height: number; depth: number }; // original CAD/3D size in mm
  showBoundingBox?: boolean; // individual toggle for 3D bounding box & caliper cage
}

export type BrushMode = 'paint' | 'erase' | 'smooth';

export interface BrushConfig {
  size: number; // mm radius in 3D world space
  hardness: number; // 0.0 (soft Gaussian) to 1.0 (hard edge)
  opacity: number; // 0.05 - 1.0
  mode: BrushMode;
}

export type MaterialType =
  | 'sandstone'
  | 'fine_sand'
  | 'desert_gold'
  | 'granite'
  | 'machined_wood'
  | 'elevation_heatmap'
  | 'slope_analysis';

export type InteractionMode = 'orbit' | 'paint' | 'move_obstacle';

export interface ViewConfig {
  material: MaterialType;
  showObstacleMeshes: boolean; // toggle visual 3D stone mesh without disabling its physics effect!
  applyObstaclePhysics: boolean; // toggle whether obstacles alter sand elevation
  showZones: boolean;
  showGrid: boolean;
  showWireframe: boolean;
  showMaskOverlay: boolean;
  activeTool: InteractionMode;
  lightingPreset: 'desert_sun' | 'studio_soft' | 'dramatic_rim' | 'cnc_inspection';
  // Water level plane (purely visual reference while designing - never exported to STL)
  showWaterPlane?: boolean;
  waterLevel?: number; // mm elevation relative to base (y = 0)
  waterOpacity?: number; // 0.1 to 0.9 (default 0.45)
  waterColor?: string; // hex string (default '#0284c7')
  waterExtents?: 'fit' | 'wide'; // 'fit' stock dimensions vs 'wide' pool
  waterAnimate?: boolean; // gentle dynamic wave animation
  // 3D Bounding box & precision measurements
  showBoundingBox?: boolean; // toggle visual 3D bounding box & caliper cage
  boundingBoxMode?: 'oriented' | 'footprint' | 'both'; // 'oriented' = caliper box around rotated stone, 'footprint' = sand bed projection, 'both' = dual
  showDimensionLabels?: boolean; // show mm measurement tags on box edges
}

export interface SerializedRippleLayer extends Omit<RippleLayer, 'maskData'> {
  maskData?: number[];
}

export interface ZenProject {
  version: number;
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  surface: SurfaceConfig;
  layers: SerializedRippleLayer[];
  obstacles: Obstacle[];
  brush?: BrushConfig;
  view?: Partial<ViewConfig>;
}

export interface SavedProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  layerCount: number;
  obstacleCount: number;
  dimensions: string;
}


export interface ExportConfig {
  includeBase: boolean;
  baseThickness: number;
  scale: number; // 1.0 = mm, 0.1 = cm, 0.03937 = inches
  unit: 'mm' | 'cm' | 'inch';
  exportObstacles: boolean;
  exportResolution: number; // e.g. 200 to 2000 for ultra-fine high-density machining meshes
}
