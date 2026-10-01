import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Waves,
  ChevronDown,
  ChevronUp,
  Sliders,
  Minimize2,
  X,
  Box,
  RotateCw,
  RotateCcw,
  Sparkles,
  Move,
  Maximize2,
  SlidersHorizontal,
  Ruler,
  Crosshair,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  SurfaceConfig,
  RippleLayer,
  Obstacle,
  ViewConfig,
  BrushConfig,
} from '../types';
import {
  buildSurfaceGeometry,
  updateSurfacePositions,
  computeBasinElevation,
} from '../utils/geometry';
import { applyBrushToMask } from '../utils/mask';

// ── PRECISION 3D BOUNDING BOX HELPERS ──

/**
 * Creates high-contrast 3D billboard text sprites showing precise mm measurements
 */
function createMeasurementLabelSprite(
  text: string,
  accentColor: string = '#f59e0b',
  badgeBg: string = 'rgba(15, 23, 42, 0.92)'
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Sprite();

  ctx.clearRect(0, 0, 384, 72);

  // Rounded badge background
  const x = 4, y = 4, w = 376, h = 64, r = 14;
  ctx.fillStyle = badgeBg;
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Accent circular pip
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(32, 36, 9, 0, Math.PI * 2);
  ctx.fill();

  // Text label
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 24px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 52, 36);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 9999;
  sprite.scale.set(34, 6.5, 1);
  return sprite;
}

/**
 * Creates precision CAD corner brackets for bounding box inspection
 */
function createCornerBracketsGeometry(
  w: number,
  h: number,
  d: number,
  cx: number,
  cy: number,
  cz: number
): THREE.BufferGeometry {
  const minX = cx - w / 2;
  const maxX = cx + w / 2;
  const minY = cy - h / 2;
  const maxY = cy + h / 2;
  const minZ = cz - d / 2;
  const maxZ = cz + d / 2;

  const lx = Math.min(w * 0.22, 14);
  const ly = Math.min(h * 0.22, 14);
  const lz = Math.min(d * 0.22, 14);

  const pts: number[] = [];
  const xs = [minX, maxX];
  const ys = [minY, maxY];
  const zs = [minZ, maxZ];

  for (const x of xs) {
    const dx = x === minX ? lx : -lx;
    for (const y of ys) {
      const dy = y === minY ? ly : -ly;
      for (const z of zs) {
        const dz = z === minZ ? lz : -lz;
        // Segment along X
        pts.push(x, y, z, x + dx, y, z);
        // Segment along Y
        pts.push(x, y, z, x, y + dy, z);
        // Segment along Z
        pts.push(x, y, z, x, y, z + dz);
      }
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geom;
}

interface ViewportProps {
  surface: SurfaceConfig;
  layers: RippleLayer[];
  selectedLayerId: string | null;
  onUpdateLayerMask: (layerId: string, newMask: Float32Array) => void;
  obstacles: Obstacle[];
  selectedObsId: string | null;
  onSelectObstacle: (id: string | null) => void;
  onUpdateObstaclePos: (id: string, x: number, z: number) => void;
  onUpdateObstacle?: (id: string, updates: Partial<Obstacle>) => void;
  onOpenCadImport?: () => void;
  view: ViewConfig;
  brush: BrushConfig;
  onUpdateView?: (updates: Partial<ViewConfig>) => void;
}

export const Viewport: React.FC<ViewportProps> = ({
  surface,
  layers,
  selectedLayerId,
  onUpdateLayerMask,
  obstacles,
  selectedObsId,
  onSelectObstacle,
  onUpdateObstaclePos,
  onUpdateObstacle,
  onOpenCadImport,
  view,
  brush,
  onUpdateView,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Three.js instances refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Mesh & Groups refs
  const surfaceMeshRef = useRef<THREE.Mesh | null>(null);
  const wireframeOverlayRef = useRef<THREE.LineSegments | null>(null);
  const obstacleGroupRef = useRef<THREE.Group | null>(null);
  const zonesGroupRef = useRef<THREE.Group | null>(null);
  const boundingBoxGroupRef = useRef<THREE.Group | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);

  // Water level plane 3D refs (visual guide only)
  const waterGroupRef = useRef<THREE.Group | null>(null);
  const waterGeoRef = useRef<THREE.PlaneGeometry | null>(null);

  // Keep fresh view reference for render animation loop
  const viewRef = useRef<ViewConfig>(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Floating Water Level Controller HUD state
  const [isWaterHudMinimized, setIsWaterHudMinimized] = useState<boolean>(false);
  const [showAppearanceOptions, setShowAppearanceOptions] = useState<boolean>(false);

  // Selected Obstacle & Cradle HUD state
  const selectedObs = obstacles.find((o) => o.id === selectedObsId) || null;
  const [isCradleHudMinimized, setIsCradleHudMinimized] = useState<boolean>(false);
  const [cradleHudTab, setCradleHudTab] = useState<'immersion' | 'rotation' | 'position' | 'caliper'>('immersion');

  // Computed dimensions for the selected obstacle
  const selectedObsDims = React.useMemo(() => {
    if (!selectedObs) return null;
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
    return { dimW, dimD, dimH };
  }, [selectedObs]);

  // Clean, thin minimalist 3D Brush Projector
  const brushCursorRef = useRef<THREE.Group | null>(null);
  const innerRingMeshRef = useRef<THREE.Mesh | null>(null);

  // State refs for active interaction
  const isPaintingRef = useRef<boolean>(false);
  const isDraggingObsRef = useRef<boolean>(false);
  const dragObsIdRef = useRef<string | null>(null);

  const [stats, setStats] = useState<{ minH: number; maxH: number; spanH: number }>({
    minH: 0,
    maxH: 0,
    spanH: 0,
  });

  // Active layer getter
  const getActiveLayer = useCallback(() => {
    return layers.find((l) => l.id === selectedLayerId) || layers[0] || null;
  }, [layers, selectedLayerId]);

  // 1. CREATE MATERIAL
  const getSurfaceMaterial = useCallback((): THREE.Material => {
    switch (view.material) {
      case 'sandstone':
        return new THREE.MeshStandardMaterial({
          color: 0xc8a46e,
          roughness: 0.86,
          metalness: 0.04,
          side: THREE.DoubleSide,
        });
      case 'fine_sand':
        return new THREE.MeshStandardMaterial({
          color: 0xdfcb9f,
          roughness: 0.95,
          metalness: 0.0,
          side: THREE.DoubleSide,
        });
      case 'desert_gold':
        return new THREE.MeshStandardMaterial({
          color: 0xd98a3b,
          roughness: 0.8,
          metalness: 0.08,
          side: THREE.DoubleSide,
        });
      case 'granite':
        return new THREE.MeshStandardMaterial({
          color: 0x767f8d,
          roughness: 0.72,
          metalness: 0.15,
          side: THREE.DoubleSide,
        });
      case 'machined_wood':
        return new THREE.MeshStandardMaterial({
          color: 0xb5814c,
          roughness: 0.65,
          metalness: 0.02,
          side: THREE.DoubleSide,
        });
      case 'elevation_heatmap': {
        return new THREE.MeshStandardMaterial({
          color: 0x22d3ee,
          roughness: 0.5,
          metalness: 0.1,
          side: THREE.DoubleSide,
        });
      }
      case 'slope_analysis':
        return new THREE.MeshNormalMaterial({
          side: THREE.DoubleSide,
        });
      default:
        return new THREE.MeshStandardMaterial({
          color: 0xc8a46e,
          roughness: 0.86,
          metalness: 0.04,
          side: THREE.DoubleSide,
        });
    }
  }, [view.material]);

  // 2. INITIALIZE THREE.JS SCENE
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d14);
    scene.fog = new THREE.FogExp2(0x0a0d14, 0.00007);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 10, 35000);
    camera.position.set(0, 850, 1350);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 100;
    controls.maxDistance = 12000;
    controls.maxPolarAngle = Math.PI / 2 + 0.05;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xdce7f5, 0.7);
    scene.add(ambientLight);

    const sun = new THREE.DirectionalLight(0xfff3db, 2.6);
    sun.position.set(700, 1500, 600);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 100;
    sun.shadow.camera.far = 6000;
    sun.shadow.camera.left = -1200;
    sun.shadow.camera.right = 1200;
    sun.shadow.camera.top = 1200;
    sun.shadow.camera.bottom = -1200;
    sun.shadow.bias = -0.0003;
    scene.add(sun);

    const fillLight = new THREE.DirectionalLight(0x7ea8e6, 0.75);
    fillLight.position.set(-800, 600, -700);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffa866, 0.4);
    rimLight.position.set(0, 300, -1000);
    scene.add(rimLight);

    // Groups
    const obstacleGroup = new THREE.Group();
    obstacleGroupRef.current = obstacleGroup;
    scene.add(obstacleGroup);

    const zonesGroup = new THREE.Group();
    zonesGroupRef.current = zonesGroup;
    scene.add(zonesGroup);

    const boundingBoxGroup = new THREE.Group();
    boundingBoxGroupRef.current = boundingBoxGroup;
    scene.add(boundingBoxGroup);

    // ── CLEAN, CRISP 3D BRUSH CURSOR (Zero white space / no distracting halos) ──
    const brushGroup = new THREE.Group();
    brushGroup.renderOrder = 9999;

    // 1. Outer Perimeter Ring (exact brush radius)
    const outerRingGeo = new THREE.RingGeometry(0.97, 1.0, 64);
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4, // Clean Cyan
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRing.rotation.x = -Math.PI / 2;
    brushGroup.add(outerRing);

    // 2. Inner Hardness Core Indicator
    const innerRingGeo = new THREE.RingGeometry(0.48, 0.52, 48);
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b, // Amber
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
      depthTest: false,
      depthWrite: false,
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.rotation.x = -Math.PI / 2;
    brushGroup.add(innerRing);
    innerRingMeshRef.current = innerRing;

    brushGroup.visible = false;
    brushCursorRef.current = brushGroup;
    scene.add(brushGroup);

    // Water level plane visual container
    const waterGroup = new THREE.Group();
    scene.add(waterGroup);
    waterGroupRef.current = waterGroup;

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    });
    resizeObserver.observe(containerRef.current);

    // Render loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (controlsRef.current) {
        controlsRef.current.update();
      }

      // Animated wave ripple shimmer if enabled
      if (
        waterGeoRef.current &&
        viewRef.current.showWaterPlane &&
        viewRef.current.waterAnimate
      ) {
        const time = performance.now() * 0.0018;
        const pos = waterGeoRef.current.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const u = pos.getX(i);
          const v = pos.getZ(i);
          const wave = Math.sin(u * 0.02 + time) * Math.cos(v * 0.025 + time * 0.7) * 0.35;
          pos.setY(i, wave);
        }
        pos.needsUpdate = true;
        waterGeoRef.current.computeVertexNormals();
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      renderer.dispose();
    };
  }, []);

  // 3. REBUILD SURFACE GEOMETRY WHEN PARAMETERS CHANGE
  useEffect(() => {
    if (!sceneRef.current) return;

    if (surfaceMeshRef.current) {
      sceneRef.current.remove(surfaceMeshRef.current);
      surfaceMeshRef.current.geometry.dispose();
      surfaceMeshRef.current = null;
    }
    if (wireframeOverlayRef.current) {
      sceneRef.current.remove(wireframeOverlayRef.current);
      wireframeOverlayRef.current.geometry.dispose();
      wireframeOverlayRef.current = null;
    }

    const geo = buildSurfaceGeometry(surface, layers, obstacles);
    const mat = getSurfaceMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    sceneRef.current.add(mesh);
    surfaceMeshRef.current = mesh;

    // Wireframe overlay
    if (view.showWireframe) {
      const wireGeo = new THREE.WireframeGeometry(geo);
      const wireMat = new THREE.LineBasicMaterial({
        color: 0x1e3a5f,
        transparent: true,
        opacity: 0.35,
      });
      const wireMesh = new THREE.LineSegments(wireGeo, wireMat);
      wireMesh.position.y += 0.2;
      sceneRef.current.add(wireMesh);
      wireframeOverlayRef.current = wireMesh;
    }

    // Compute stats
    const pos = geo.attributes.position as THREE.BufferAttribute;
    let minH = Infinity;
    let maxH = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minH) minH = y;
      if (y > maxH) maxH = y;
    }
    setStats({
      minH: parseFloat(minH.toFixed(2)),
      maxH: parseFloat(maxH.toFixed(2)),
      spanH: parseFloat((maxH - minH).toFixed(2)),
    });
  }, [
    surface,
    layers,
    obstacles,
    view.material,
    view.showWireframe,
    getSurfaceMaterial,
  ]);

  // 4. UPDATE OBSTACLE VISUALS (Allow hiding visual 3D mesh while keeping physics active!)
  useEffect(() => {
    if (!obstacleGroupRef.current || !zonesGroupRef.current) return;

    obstacleGroupRef.current.clear();
    zonesGroupRef.current.clear();
    if (boundingBoxGroupRef.current) {
      boundingBoxGroupRef.current.clear();
    }

    obstacles.forEach((obs) => {
      // 1. Visual 3D Stone Mesh (Only if showObstacleMeshes is TRUE and obs.visibleMesh !== false)
      if (view.showObstacleMeshes && obs.visibleMesh !== false) {
        let geo: THREE.BufferGeometry;
        const sx = obs.scaleX || 1.0;
        const sz = obs.scaleZ || 1.0;
        let sy = 1.0;

        switch (obs.shape) {
          case 'stone_sphere':
            geo = new THREE.SphereGeometry(obs.radius, 28, 20);
            sy = obs.scaleY || 1.0;
            break;
          case 'stone_boulder':
            geo = new THREE.DodecahedronGeometry(obs.radius, 1);
            sy = obs.scaleY || 1.0;
            break;
          case 'box':
            geo = new THREE.BoxGeometry(obs.radius * 2, obs.height, obs.radius * 2);
            sy = obs.scaleY || 1.0;
            break;
          case 'custom_3d': {
            if (obs.customMeshData && obs.customMeshData.positions.length > 0) {
              geo = new THREE.BufferGeometry();
              geo.setAttribute(
                'position',
                new THREE.Float32BufferAttribute(obs.customMeshData.positions, 3)
              );
              if (obs.customMeshData.normals && obs.customMeshData.normals.length > 0) {
                geo.setAttribute(
                  'normal',
                  new THREE.Float32BufferAttribute(obs.customMeshData.normals, 3)
                );
              } else {
                geo.computeVertexNormals();
              }
              const bbox = obs.customMeshData.bbox;
              if (bbox) {
                const maxHoriz = Math.max(0.1, Math.max(bbox.maxX - bbox.minX, bbox.maxZ - bbox.minZ));
                const uniformScale = (obs.radius * 2) / maxHoriz;
                // Scale 3D mesh uniformly 1:1:1 across all axes so vertical height is NEVER squashed
                geo.scale(uniformScale, uniformScale, uniformScale);

                // Handle stretch if aspect ratio is unlocked
                if (obs.lockAspectRatio !== false) {
                  sy = obs.scaleY || 1.0;
                } else {
                  if (obs.scaleY !== undefined) {
                    sy = obs.scaleY;
                  } else if (obs.height) {
                    const origH = Math.max(0.1, bbox.maxY - bbox.minY);
                    sy = obs.height / (origH * uniformScale);
                  }
                }
              }
            } else {
              geo = new THREE.DodecahedronGeometry(obs.radius, 1);
              sy = obs.scaleY || 1.0;
            }
            break;
          }
          case 'custom_dxf':
          case 'organic_pebble':
          case 'custom_svg':
          case 'custom_mask': {
            if (obs.customPolygonPoints && obs.customPolygonPoints.length >= 3) {
              const shape = new THREE.Shape();
              const pts = obs.customPolygonPoints;
              shape.moveTo(pts[0][0] * obs.radius, pts[0][1] * obs.radius);
              for (let i = 1; i < pts.length; i++) {
                shape.lineTo(pts[i][0] * obs.radius, pts[i][1] * obs.radius);
              }
              shape.closePath();

              const bevelDim = Math.min(obs.radius * 0.06, obs.height * 0.15, 3.0);
              geo = new THREE.ExtrudeGeometry(shape, {
                depth: Math.max(1, obs.height - bevelDim * 2),
                bevelEnabled: true,
                bevelSegments: 3,
                steps: 1,
                bevelSize: bevelDim,
                bevelThickness: bevelDim,
              });
              // Rotate so 2D contour lies in XZ plane and extrudes upward in +Y
              geo.rotateX(-Math.PI / 2);
              geo.computeBoundingBox();
              if (geo.boundingBox) {
                const cx = (geo.boundingBox.min.x + geo.boundingBox.max.x) / 2;
                const cz = (geo.boundingBox.min.z + geo.boundingBox.max.z) / 2;
                const minY = geo.boundingBox.min.y;
                geo.translate(-cx, -minY, -cz);
              }
            } else {
              geo = new THREE.SphereGeometry(obs.radius, 28, 16);
              geo.scale(1.15, 0.45, 0.85);
            }
            break;
          }
          case 'cylinder':
          default:
            geo = new THREE.CylinderGeometry(obs.radius * 0.92, obs.radius, obs.height, 28);
            geo.translate(0, obs.height * 0.5, 0);
            break;
        }

        const isSelected = obs.id === selectedObsId;
        const mat = new THREE.MeshStandardMaterial({
          color: isSelected ? 0x60a5fa : 0x78869c,
          roughness: 0.8,
          metalness: 0.1,
          emissive: isSelected ? new THREE.Color(0x1d4ed8) : new THREE.Color(0x000000),
          emissiveIntensity: isSelected ? 0.35 : 0,
        });

        const mesh = new THREE.Mesh(geo, mat);
        const basinElev = computeBasinElevation(obs.x, obs.z, surface);
        const isImported3d =
          obs.shape === 'custom_3d' ||
          Boolean(obs.customMeshData) ||
          obs.sourceFormat === 'stl' ||
          obs.sourceFormat === 'obj';
        let baseY = isImported3d ? 0 : ((obs.beddingDepth || 0) + (obs.verticalExtrusion || 0));
        if (obs.shape === 'stone_sphere' || obs.shape === 'stone_boulder' || obs.shape === 'box') {
          baseY += obs.height * 0.5;
        }
        if (obs.elevation !== undefined) {
          baseY += obs.elevation;
        }
        const yOffset = baseY + basinElev;

        mesh.position.set(obs.x, yOffset, obs.z);
        const finalSx = (obs.flipX ? -1 : 1) * sx;
        const finalSz = (obs.flipZ ? -1 : 1) * sz;
        mesh.scale.set(finalSx, sy, finalSz);

        const rotX = ((obs.rotationX || 0) * Math.PI) / 180;
        const rotY = -((obs.rotation || obs.rotationY || 0) * Math.PI) / 180;
        const rotZ = ((obs.rotationZ || 0) * Math.PI) / 180;
        mesh.rotation.set(rotX, rotY, rotZ, 'YXZ');

        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { obsId: obs.id };
        obstacleGroupRef.current?.add(mesh);

        // ── 3. VISUAL 3D BOUNDING BOX & PRECISION CALIPER CAGE ──
        const isObsSelected = obs.id === selectedObsId;
        const isSingleObs = obstacles.length === 1;
        const shouldShowBox =
          (view.showBoundingBox && (isObsSelected || obs.showBoundingBox || isSingleObs)) ||
          obs.showBoundingBox === true;

        if (shouldShowBox && boundingBoxGroupRef.current && geo) {
          geo.computeBoundingBox();
          const bbox = geo.boundingBox;
          if (bbox) {
            const rawW = Math.max(0.1, bbox.max.x - bbox.min.x);
            const rawH = Math.max(0.1, bbox.max.y - bbox.min.y);
            const rawD = Math.max(0.1, bbox.max.z - bbox.min.z);
            const cx = (bbox.min.x + bbox.max.x) / 2;
            const cy = (bbox.min.y + bbox.max.y) / 2;
            const cz = (bbox.min.z + bbox.max.z) / 2;

            const dimW = rawW * Math.abs(finalSx);
            const dimH = rawH * sy;
            const dimD = rawD * Math.abs(finalSz);

            const boxMode = view.boundingBoxMode || 'oriented';

            // A) ORIENTED BOUNDING BOX (Local Object Cage - rotates with the stone)
            if (boxMode === 'oriented' || boxMode === 'both') {
              const obbGroup = new THREE.Group();
              obbGroup.position.set(obs.x, yOffset, obs.z);
              obbGroup.scale.set(finalSx, sy, finalSz);
              obbGroup.rotation.set(rotX, rotY, rotZ, 'YXZ');

              const boxGeom = new THREE.BoxGeometry(rawW, rawH, rawD);
              boxGeom.translate(cx, cy, cz);

              // Translucent tinted glass volume
              const glassMat = new THREE.MeshBasicMaterial({
                color: isObsSelected ? 0x0284c7 : 0x0f766e,
                transparent: true,
                opacity: isObsSelected ? 0.08 : 0.04,
                side: THREE.DoubleSide,
                depthWrite: false,
              });
              obbGroup.add(new THREE.Mesh(boxGeom, glassMat));

              // Wireframe perimeter cage
              const edgesGeom = new THREE.EdgesGeometry(boxGeom);
              const edgeMat = new THREE.LineBasicMaterial({
                color: isObsSelected ? 0x38bdf8 : 0x64748b,
                transparent: true,
                opacity: isObsSelected ? 0.85 : 0.45,
                depthTest: true,
              });
              obbGroup.add(new THREE.LineSegments(edgesGeom, edgeMat));

              // Sharp corner inspection brackets
              const cornerGeom = createCornerBracketsGeometry(rawW, rawH, rawD, cx, cy, cz);
              const cornerMat = new THREE.LineBasicMaterial({
                color: isObsSelected ? 0x00f0ff : 0x22d3ee,
                linewidth: 2,
                transparent: true,
                opacity: 0.95,
              });
              obbGroup.add(new THREE.LineSegments(cornerGeom, cornerMat));

              // Center coordinate cross ticks
              const crossLen = Math.min(rawW, rawH, rawD) * 0.15;
              const crossPts: number[] = [
                // X axis (Coral)
                cx - crossLen, cy, cz, cx + crossLen, cy, cz,
                // Y axis (Emerald)
                cx, cy - crossLen, cz, cx, cy + crossLen, cz,
                // Z axis (Cyan)
                cx, cy, cz - crossLen, cx, cy, cz + crossLen,
              ];
              const crossGeom = new THREE.BufferGeometry();
              crossGeom.setAttribute('position', new THREE.Float32BufferAttribute(crossPts, 3));
              const crossMat = new THREE.LineBasicMaterial({
                color: 0x94a3b8,
                transparent: true,
                opacity: 0.7,
              });
              obbGroup.add(new THREE.LineSegments(crossGeom, crossMat));

              boundingBoxGroupRef.current.add(obbGroup);

              // 3D Billboard Dimension Sprites (positioned at midpoints of box edges in world space)
              if (view.showDimensionLabels !== false && isObsSelected) {
                obbGroup.updateMatrixWorld(true);

                // 1. Width (Local X-Axis)
                const localPtW = new THREE.Vector3(cx, bbox.min.y, bbox.max.z + rawD * 0.08);
                const worldPtW = localPtW.clone().applyMatrix4(obbGroup.matrixWorld);
                const spriteW = createMeasurementLabelSprite(`↔ Width: ${dimW.toFixed(1)} mm`, '#f43f5e');
                spriteW.position.copy(worldPtW);
                boundingBoxGroupRef.current.add(spriteW);

                // 2. Height (Local Y-Axis)
                const localPtH = new THREE.Vector3(bbox.max.x + rawW * 0.08, cy, bbox.max.z + rawD * 0.08);
                const worldPtH = localPtH.clone().applyMatrix4(obbGroup.matrixWorld);
                const spriteH = createMeasurementLabelSprite(`↕ Height: ${dimH.toFixed(1)} mm`, '#10b981');
                spriteH.position.copy(worldPtH);
                boundingBoxGroupRef.current.add(spriteH);

                // 3. Depth (Local Z-Axis)
                const localPtD = new THREE.Vector3(bbox.max.x + rawW * 0.08, bbox.min.y, cz);
                const worldPtD = localPtD.clone().applyMatrix4(obbGroup.matrixWorld);
                const spriteD = createMeasurementLabelSprite(`⤢ Depth: ${dimD.toFixed(1)} mm`, '#06b6d4');
                spriteD.position.copy(worldPtD);
                boundingBoxGroupRef.current.add(spriteD);
              }
            }

            // B) WORLD FOOTPRINT PROJECTION (Sand bed envelope on plane)
            if (boxMode === 'footprint' || boxMode === 'both') {
              mesh.updateMatrixWorld(true);
              const worldBox = new THREE.Box3().setFromObject(mesh);
              const fpW = worldBox.max.x - worldBox.min.x;
              const fpD = worldBox.max.z - worldBox.min.z;
              const fpY = basinElev + 0.35;
              const fpCenterX = (worldBox.min.x + worldBox.max.x) / 2;

              const fpPts = [
                new THREE.Vector3(worldBox.min.x, fpY, worldBox.min.z),
                new THREE.Vector3(worldBox.max.x, fpY, worldBox.min.z),
                new THREE.Vector3(worldBox.max.x, fpY, worldBox.max.z),
                new THREE.Vector3(worldBox.min.x, fpY, worldBox.max.z),
                new THREE.Vector3(worldBox.min.x, fpY, worldBox.min.z),
              ];
              const fpGeom = new THREE.BufferGeometry().setFromPoints(fpPts);
              const fpMat = new THREE.LineBasicMaterial({
                color: 0xf59e0b, // Amber
                linewidth: 2,
                transparent: true,
                opacity: 0.9,
              });
              boundingBoxGroupRef.current.add(new THREE.Line(fpGeom, fpMat));

              // Footprint corner ticks
              const cLen = Math.min(fpW, fpD) * 0.15;
              const cornerPts: number[] = [
                worldBox.min.x, fpY, worldBox.min.z, worldBox.min.x + cLen, fpY, worldBox.min.z,
                worldBox.min.x, fpY, worldBox.min.z, worldBox.min.x, fpY, worldBox.min.z + cLen,

                worldBox.max.x, fpY, worldBox.min.z, worldBox.max.x - cLen, fpY, worldBox.min.z,
                worldBox.max.x, fpY, worldBox.min.z, worldBox.max.x, fpY, worldBox.min.z + cLen,

                worldBox.max.x, fpY, worldBox.max.z, worldBox.max.x - cLen, fpY, worldBox.max.z,
                worldBox.max.x, fpY, worldBox.max.z, worldBox.max.x, fpY, worldBox.max.z - cLen,

                worldBox.min.x, fpY, worldBox.max.z, worldBox.min.x + cLen, fpY, worldBox.max.z,
                worldBox.min.x, fpY, worldBox.max.z, worldBox.min.x, fpY, worldBox.max.z - cLen,
              ];
              const cGeom = new THREE.BufferGeometry();
              cGeom.setAttribute('position', new THREE.Float32BufferAttribute(cornerPts, 3));
              boundingBoxGroupRef.current.add(new THREE.LineSegments(cGeom, new THREE.LineBasicMaterial({ color: 0xfbbf24, linewidth: 2 })));

              if (view.showDimensionLabels !== false && isObsSelected) {
                const spriteFp = createMeasurementLabelSprite(
                  `📐 Footprint: ${fpW.toFixed(1)} × ${fpD.toFixed(1)} mm`,
                  '#f59e0b'
                );
                spriteFp.position.set(fpCenterX, fpY + 1.0, worldBox.max.z + 10);
                boundingBoxGroupRef.current.add(spriteFp);
              }
            }
          }
        }
      }

      // 2. Disturbance Zone Indicator Rings (Optional helper rings)
      if (view.showZones && obs.enabled !== false) {
        const basinElev = computeBasinElevation(obs.x, obs.z, surface);
        const ringGeo = new THREE.RingGeometry(obs.radius, obs.disturbanceRadius, 48);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(obs.x, 0.4 + basinElev, obs.z);
        zonesGroupRef.current?.add(ring);

        const borderGeo = new THREE.RingGeometry(
          obs.disturbanceRadius - 1.5,
          obs.disturbanceRadius + 1.5,
          48
        );
        const borderMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
        });
        const borderMesh = new THREE.Mesh(borderGeo, borderMat);
        borderMesh.rotation.x = -Math.PI / 2;
        borderMesh.position.set(obs.x, 0.5 + basinElev, obs.z);
        zonesGroupRef.current?.add(borderMesh);
      }
    });
  }, [
    obstacles,
    selectedObsId,
    view.showObstacleMeshes,
    view.showZones,
    view.showBoundingBox,
    view.boundingBoxMode,
    view.showDimensionLabels,
    surface,
  ]);

  // 5. UPDATE GRID
  useEffect(() => {
    if (!sceneRef.current) return;
    if (gridHelperRef.current) {
      sceneRef.current.remove(gridHelperRef.current);
      gridHelperRef.current.dispose();
      gridHelperRef.current = null;
    }

    if (view.showGrid) {
      const maxDim = Math.max(surface.width, surface.length) * 1.5;
      const grid = new THREE.GridHelper(maxDim, Math.round(maxDim / 50), 0x1e3a5f, 0x0f1e2f);
      grid.position.y = -1;
      sceneRef.current.add(grid);
      gridHelperRef.current = grid;
    }
  }, [view.showGrid, surface.width, surface.length]);

  // 5b. UPDATE WATER LEVEL PLANE (Visual reference only - excluded from CNC export)
  useEffect(() => {
    if (!waterGroupRef.current || !sceneRef.current) return;

    // Clear previous children
    while (waterGroupRef.current.children.length > 0) {
      const child = waterGroupRef.current.children[0];
      waterGroupRef.current.remove(child);
      if ((child as THREE.Mesh).geometry) {
        (child as THREE.Mesh).geometry.dispose();
      }
      if ((child as THREE.Mesh).material) {
        const m = (child as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach((mat) => mat.dispose());
        else m.dispose();
      }
    }
    waterGeoRef.current = null;

    if (!view.showWaterPlane) {
      waterGroupRef.current.visible = false;
      return;
    }

    waterGroupRef.current.visible = true;

    const isWide = view.waterExtents === 'wide';
    const w = isWide ? surface.width * 1.35 : surface.width;
    const l = isWide ? surface.length * 1.35 : surface.length;
    const elevation = view.waterLevel ?? 5.0;
    const segments = view.waterAnimate ? 48 : 2;

    const geo = new THREE.PlaneGeometry(w, l, segments, segments);
    geo.rotateX(-Math.PI / 2);
    waterGeoRef.current = geo;

    const opacity = view.waterOpacity ?? 0.45;
    const colorHex = view.waterColor || '#0284c7';

    // Translucent water material with subtle specular reflection
    const waterMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex),
      roughness: 0.08,
      metalness: 0.12,
      transparent: true,
      opacity: opacity,
      depthWrite: false, // Allows seeing underwater dunes and stones without clipping
      side: THREE.DoubleSide,
    });

    const waterMesh = new THREE.Mesh(geo, waterMat);
    waterMesh.position.set(0, elevation, 0);
    waterMesh.receiveShadow = true;
    waterGroupRef.current.add(waterMesh);

    // Glowing waterline rim
    const edges = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: Math.min(1.0, opacity + 0.35),
    });
    const edgeLines = new THREE.LineSegments(edges, edgeMat);
    edgeLines.position.set(0, elevation, 0);
    waterGroupRef.current.add(edgeLines);

    // ── 3D Corner Elevation Gauge Pole ──
    const gaugeGroup = new THREE.Group();
    const cornerX = -surface.width / 2 - 25;
    const cornerZ = surface.length / 2 + 25;
    gaugeGroup.position.set(cornerX, 0, cornerZ);

    // Vertical ruler post
    const rodHeight = 65;
    const rodGeo = new THREE.CylinderGeometry(1.2, 1.2, rodHeight, 16);
    const rodMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.5,
      metalness: 0.5,
    });
    const rodMesh = new THREE.Mesh(rodGeo, rodMat);
    rodMesh.position.y = rodHeight / 2 - 10;
    gaugeGroup.add(rodMesh);

    // Graduation rings
    for (let h = -10; h <= 45; h += 5) {
      const isZero = h === 0;
      const isMajor = h % 10 === 0;
      const ringGeo = new THREE.TorusGeometry(isZero ? 2.5 : isMajor ? 2.0 : 1.5, 0.2, 8, 20);
      ringGeo.rotateX(Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: isZero ? 0x38bdf8 : isMajor ? 0x94a3b8 : 0x64748b,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.y = h;
      gaugeGroup.add(ringMesh);
    }

    // Active Water Level indicator ring on the ruler
    const floatRingGeo = new THREE.TorusGeometry(3.2, 0.6, 12, 28);
    floatRingGeo.rotateX(Math.PI / 2);
    const floatMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex),
      emissive: new THREE.Color(colorHex),
      emissiveIntensity: 0.7,
      roughness: 0.2,
    });
    const floatRing = new THREE.Mesh(floatRingGeo, floatMat);
    floatRing.position.y = elevation;
    gaugeGroup.add(floatRing);

    waterGroupRef.current.add(gaugeGroup);
  }, [
    view.showWaterPlane,
    view.waterLevel,
    view.waterOpacity,
    view.waterColor,
    view.waterExtents,
    view.waterAnimate,
    surface.width,
    surface.length,
  ]);

  // 6. UPDATE 3D BRUSH CURSOR SCALE & COLOR
  useEffect(() => {
    if (!brushCursorRef.current) return;

    const isPaintMode = view.activeTool === 'paint';
    brushCursorRef.current.visible = isPaintMode;

    const r = brush.size;
    brushCursorRef.current.scale.set(r, 1, r);

    // Inner hardness indicator
    if (innerRingMeshRef.current) {
      const hRadius = Math.max(0.1, brush.hardness);
      innerRingMeshRef.current.scale.set(hRadius, hRadius, hRadius);
    }
  }, [brush.size, brush.hardness, view.activeTool]);

  // 7. RAYCASTING HELPER (Projects onto surface mesh or plane)
  const getRaycastIntersection = useCallback(
    (e: React.PointerEvent) => {
      if (!canvasRef.current || !cameraRef.current) return null;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);

      // 1. Try hitting the actual surface mesh
      if (surfaceMeshRef.current) {
        const hits = raycaster.intersectObject(surfaceMeshRef.current, false);
        if (hits.length > 0) {
          return { point: hits[0].point, isDirect: true };
        }
      }

      // 2. Fallback to ground plane at y = 0
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hitPoint = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, hitPoint)) {
        return { point: hitPoint, isDirect: false };
      }

      return null;
    },
    []
  );

  // 8. REAL-TIME BRUSH APPLICATION & IMMEDIATE MESH UPDATE
  const applyBrushStroke = useCallback(
    (hitPoint: THREE.Vector3) => {
      const activeLayer = getActiveLayer();
      if (!activeLayer) return;

      const u = (hitPoint.x + surface.width / 2) / surface.width;
      const v = (hitPoint.z + surface.length / 2) / surface.length;

      const radiusU = brush.size / surface.width;
      const radiusV = brush.size / surface.length;

      const newMask = applyBrushToMask(
        activeLayer.maskData,
        activeLayer.maskWidth,
        activeLayer.maskHeight,
        u,
        v,
        radiusU,
        radiusV,
        brush.hardness,
        brush.opacity,
        brush.mode
      );

      // Update state
      onUpdateLayerMask(activeLayer.id, newMask);

      // Fast in-place geometry position update for instant visual feedback!
      if (surfaceMeshRef.current) {
        activeLayer.maskData = newMask;
        updateSurfacePositions(
          surfaceMeshRef.current.geometry,
          surface,
          layers,
          obstacles
        );
      }
    },
    [getActiveLayer, surface, layers, obstacles, brush, onUpdateLayerMask]
  );

  // Pointer Handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;

    // Check Obstacle click
    if (
      (view.activeTool === 'move_obstacle' || view.activeTool === 'orbit') &&
      view.showObstacleMeshes
    ) {
      if (!canvasRef.current || !cameraRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);

      if (obstacleGroupRef.current) {
        const hits = raycaster.intersectObjects(obstacleGroupRef.current.children, true);
        if (hits.length > 0) {
          let target = hits[0].object;
          while (target && !target.userData?.obsId && target.parent) {
            target = target.parent as THREE.Object3D;
          }
          if (target && target.userData?.obsId) {
            const obsId = target.userData.obsId;
            onSelectObstacle(obsId);
            isDraggingObsRef.current = true;
            dragObsIdRef.current = obsId;
            if (controlsRef.current) controlsRef.current.enabled = false;
            return;
          }
        }
      }
    }

    // Check Paint Mode
    if (view.activeTool === 'paint') {
      const hit = getRaycastIntersection(e);
      if (hit) {
        if (controlsRef.current) controlsRef.current.enabled = false;
        isPaintingRef.current = true;
        applyBrushStroke(hit.point);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const hit = getRaycastIntersection(e);
    if (!hit) return;

    // Position 3D Brush Cursor directly at the intersection point on the surface
    if (brushCursorRef.current) {
      brushCursorRef.current.position.set(hit.point.x, hit.point.y + 0.8, hit.point.z);
      brushCursorRef.current.visible = view.activeTool === 'paint';
    }

    // Continuous dragging stroke
    if (isPaintingRef.current && view.activeTool === 'paint') {
      applyBrushStroke(hit.point);
    }

    // Dragging Obstacle
    if (isDraggingObsRef.current && dragObsIdRef.current) {
      const hw = surface.width / 2;
      const hl = surface.length / 2;
      const clampedX = Math.max(-hw, Math.min(hw, hit.point.x));
      const clampedZ = Math.max(-hl, Math.min(hl, hit.point.z));
      onUpdateObstaclePos(dragObsIdRef.current, clampedX, clampedZ);
    }
  };

  const handlePointerUp = () => {
    if (isPaintingRef.current) {
      isPaintingRef.current = false;
    }
    if (isDraggingObsRef.current) {
      isDraggingObsRef.current = false;
      dragObsIdRef.current = null;
    }
    if (controlsRef.current) {
      controlsRef.current.enabled = true;
    }
  };

  const handlePointerLeave = () => {
    handlePointerUp();
    if (brushCursorRef.current) {
      brushCursorRef.current.visible = false;
    }
  };

  // Camera preset shortcuts
  const setCameraPreset = (preset: 'top' | 'isometric' | 'front' | 'side') => {
    if (!cameraRef.current || !controlsRef.current) return;
    const maxDim = Math.max(surface.width, surface.length);

    switch (preset) {
      case 'top':
        cameraRef.current.position.set(0, maxDim * 1.35, 0.1);
        break;
      case 'isometric':
        cameraRef.current.position.set(maxDim * 0.7, maxDim * 0.7, maxDim * 0.85);
        break;
      case 'front':
        cameraRef.current.position.set(0, maxDim * 0.25, maxDim * 1.15);
        break;
      case 'side':
        cameraRef.current.position.set(maxDim * 1.15, maxDim * 0.25, 0);
        break;
    }
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-neutral-950 overflow-hidden select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair" />

      {/* Floating Viewport Overlay: Dimensions & Depth Stats */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2 pointer-events-none">
        <div className="bg-neutral-900/80 backdrop-blur-md border border-neutral-800/80 rounded-lg px-3 py-1.5 text-xs text-neutral-300 flex items-center gap-3 shadow-lg">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono font-medium text-neutral-200">
              {surface.width} × {surface.length} mm
            </span>
          </div>
          <span className="text-neutral-600">|</span>
          <div className="flex items-center gap-1 text-neutral-400">
            <span>Fillet:</span>
            <span className="font-mono text-cyan-400 font-medium">R{surface.cornerRadius}mm</span>
          </div>
          <span className="text-neutral-600">|</span>
          <div className="flex items-center gap-1 text-neutral-400">
            <span>Depth Span:</span>
            <span className="font-mono text-amber-400 font-medium">{stats.spanH}mm</span>
            <span className="text-neutral-500 text-[10px]">
              ({stats.minH > 0 ? `+${stats.minH}` : stats.minH} to +{stats.maxH})
            </span>
          </div>
          {(surface.basinLift || 0) > 0 && (
            <>
              <span className="text-neutral-600">|</span>
              <div className="flex items-center gap-1">
                <span className="text-sky-400 font-medium">Basin:</span>
                <span className="font-mono text-sky-300 font-bold">+{surface.basinLift}mm</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Floating Viewport Camera Presets */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1 bg-neutral-900/80 backdrop-blur-md border border-neutral-800/80 p-1 rounded-lg shadow-lg">
        <button
          onClick={() => setCameraPreset('isometric')}
          className="px-2 py-1 text-xs font-medium text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded transition-colors"
          title="Perspective / Isometric View"
        >
          Iso
        </button>
        <button
          onClick={() => setCameraPreset('top')}
          className="px-2 py-1 text-xs font-medium text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded transition-colors"
          title="Top Plan View (2D CNC inspection)"
        >
          Top
        </button>
        <button
          onClick={() => setCameraPreset('front')}
          className="px-2 py-1 text-xs font-medium text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded transition-colors"
          title="Front Profile View"
        >
          Front
        </button>
        <button
          onClick={() => setCameraPreset('side')}
          className="px-2 py-1 text-xs font-medium text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded transition-colors"
          title="Side Profile View"
        >
          Side
        </button>
      </div>

      {/* ── FLOATING PRECISION BOUNDING BOX & CALIPER BADGE ── */}
      {view.showBoundingBox && selectedObs && selectedObsDims && (
        <div className="absolute top-16 left-4 z-10 pointer-events-auto">
          <div className="bg-neutral-900/90 backdrop-blur-md border border-amber-500/40 rounded-xl p-2.5 shadow-xl text-neutral-200 text-xs space-y-1.5 max-w-xs">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                <Box className="w-3.5 h-3.5 text-amber-400" />
                <span className="truncate max-w-[130px]">{selectedObs.name}</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/30">
                {view.boundingBoxMode === 'footprint' ? 'Footprint' : view.boundingBoxMode === 'both' ? 'Box + Footprint' : 'Oriented Box'}
              </span>
            </div>

            {/* 3D Caliper Dimensions */}
            <div className="grid grid-cols-3 gap-1 py-1 px-1.5 bg-neutral-950/70 rounded-lg font-mono text-[11px] border border-neutral-800 text-center">
              <div>
                <span className="text-[9px] text-rose-400 block font-sans">Width (X)</span>
                <span className="font-semibold text-neutral-100">{selectedObsDims.dimW.toFixed(1)}</span>
                <span className="text-[9px] text-neutral-500"> mm</span>
              </div>
              <div>
                <span className="text-[9px] text-cyan-400 block font-sans">Depth (Z)</span>
                <span className="font-semibold text-neutral-100">{selectedObsDims.dimD.toFixed(1)}</span>
                <span className="text-[9px] text-neutral-500"> mm</span>
              </div>
              <div>
                <span className="text-[9px] text-emerald-400 block font-sans">Height (Y)</span>
                <span className="font-semibold text-emerald-300">{selectedObsDims.dimH.toFixed(1)}</span>
                <span className="text-[9px] text-neutral-500"> mm</span>
              </div>
            </div>

            {/* Quick Mode Toggle & 3D Tags */}
            <div className="flex items-center justify-between pt-0.5 text-[10px]">
              <div className="flex items-center gap-1">
                {(['oriented', 'footprint', 'both'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onUpdateView?.({ boundingBoxMode: m })}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors cursor-pointer ${
                      (view.boundingBoxMode || 'oriented') === m
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {m === 'oriented' ? 'Box' : m === 'footprint' ? 'Footprint' : 'Both'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onUpdateView?.({ showDimensionLabels: !view.showDimensionLabels })}
                className={`px-1.5 py-0.5 rounded text-[9px] transition-colors cursor-pointer border ${
                  view.showDimensionLabels !== false
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-500/40'
                    : 'text-neutral-500 border-neutral-800'
                }`}
                title="Toggle 3D dimension tag sprites in viewport"
              >
                {view.showDimensionLabels !== false ? '3D Tags: ON' : '3D Tags: OFF'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FLOATING 3D OBJECT TRANSFORM & PLANE CRADLE HUD ── */}
      {selectedObs && onUpdateObstacle && (
        <div className="absolute bottom-16 left-4 z-20 flex flex-col items-start pointer-events-auto select-none max-w-[calc(100vw-32px)] sm:max-w-md">
          {isCradleHudMinimized ? (
            /* Minimized Quick Pill */
            <button
              onClick={() => setIsCradleHudMinimized(false)}
              className="flex items-center gap-2 bg-neutral-900/95 backdrop-blur-md border border-cyan-500/60 hover:border-cyan-400 text-neutral-200 px-3 py-2 rounded-xl shadow-2xl shadow-cyan-950/60 transition-all hover:scale-102 cursor-pointer group"
              title="Expand 3D Cradle & Transform HUD"
            >
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <Box className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-semibold text-neutral-200 max-w-36 truncate">
                {selectedObs.name}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40">
                {(selectedObs.elevation || 0) < 0
                  ? `Cradled ${selectedObs.elevation}mm`
                  : `${selectedObs.elevation || 0}mm`}
              </span>
              <ChevronUp className="w-3.5 h-3.5 text-neutral-400 group-hover:text-neutral-200" />
            </button>
          ) : (
            /* Full 3D Object Position & Plane Cradle Card */
            <div className="w-80 sm:w-92 bg-neutral-900/95 backdrop-blur-xl border border-cyan-500/40 rounded-2xl p-3.5 shadow-2xl shadow-neutral-950/80 text-neutral-200 space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-1.5 rounded-lg bg-cyan-950/90 border border-cyan-500/40 text-cyan-400 flex-shrink-0">
                    <Box className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-xs text-neutral-100 tracking-wide truncate">
                        {selectedObs.name}
                      </span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-cyan-950 border border-cyan-500/40 text-cyan-300 flex-shrink-0">
                        3D Cradle
                      </span>
                    </div>
                    <p className="text-[10px] text-neutral-400">Position, 3-axis rotation & plane wrapping</p>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Quick Bounding Box Toggle */}
                  <button
                    onClick={() => {
                      if (onUpdateView) {
                        onUpdateView({ showBoundingBox: !view.showBoundingBox });
                      }
                    }}
                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                      view.showBoundingBox
                        ? 'bg-amber-950/80 border-amber-500/50 text-amber-300'
                        : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/80 border-transparent'
                    }`}
                    title="Toggle 3D Bounding Box & Precision Caliper Measurements"
                  >
                    <Box className="w-3.5 h-3.5" />
                  </button>

                  {onOpenCadImport && (
                    <button
                      onClick={onOpenCadImport}
                      className="p-1.5 text-neutral-400 hover:text-cyan-300 hover:bg-neutral-800/80 rounded-lg transition-colors cursor-pointer"
                      title="Import New 3D / CAD Model (.STL, .OBJ, .DXF)"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => setIsCradleHudMinimized(true)}
                    className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/80 rounded-lg transition-colors cursor-pointer"
                    title="Minimize"
                  >
                    <Minimize2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onSelectObstacle(null)}
                    className="p-1.5 text-neutral-400 hover:text-rose-300 hover:bg-neutral-800/80 rounded-lg transition-colors cursor-pointer"
                    title="Deselect Object"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Sub-Tabs: Cradle Immersion | 3-Axis Rotation | Position | Caliper Box */}
              <div className="grid grid-cols-4 gap-1 p-0.5 bg-neutral-950 rounded-lg border border-neutral-800 text-[10px] font-medium">
                <button
                  onClick={() => setCradleHudTab('immersion')}
                  className={`py-1 px-1 rounded transition-colors text-center cursor-pointer ${
                    cradleHudTab === 'immersion'
                      ? 'bg-neutral-800 text-cyan-300 shadow-xs border border-neutral-700'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  Plane Cradle
                </button>
                <button
                  onClick={() => setCradleHudTab('rotation')}
                  className={`py-1 px-1 rounded transition-colors text-center cursor-pointer ${
                    cradleHudTab === 'rotation'
                      ? 'bg-neutral-800 text-cyan-300 shadow-xs border border-neutral-700'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  3-Axis Rot
                </button>
                <button
                  onClick={() => setCradleHudTab('position')}
                  className={`py-1 px-1 rounded transition-colors text-center cursor-pointer ${
                    cradleHudTab === 'position'
                      ? 'bg-neutral-800 text-cyan-300 shadow-xs border border-neutral-700'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  Move (X, Z)
                </button>
                <button
                  onClick={() => setCradleHudTab('caliper')}
                  className={`py-1 px-1 rounded transition-colors text-center cursor-pointer ${
                    cradleHudTab === 'caliper'
                      ? 'bg-neutral-800 text-amber-300 shadow-xs border border-neutral-700 font-semibold'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                  title="Bounding Box & Caliper Measurements"
                >
                  📦 Box & Size
                </button>
              </div>

              {/* ── TAB 1: PLANE CRADLE & IMMERSION ── */}
              {cradleHudTab === 'immersion' && (
                <div className="space-y-2.5">
                  {/* Real-time Cradle Status Readout */}
                  <div className="flex items-center justify-between p-2 rounded-lg bg-neutral-950/70 border border-neutral-800/80">
                    <span className="text-[11px] text-neutral-300">Immersion / Cradle Depth:</span>
                    <span
                      className={`font-mono text-xs font-semibold px-2 py-0.5 rounded ${
                        (selectedObs.elevation || 0) < 0
                          ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40'
                          : 'bg-neutral-800 text-neutral-300'
                      }`}
                    >
                      {(selectedObs.elevation || 0) < 0
                        ? `Cradled ${Math.abs(selectedObs.elevation || 0).toFixed(1)} mm`
                        : `${(selectedObs.elevation || 0).toFixed(1)} mm (Resting)`}
                    </span>
                  </div>

                  {/* Elevation / Immersion Slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-neutral-400">Vertical Plane Immersion</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="-50"
                          max="100"
                          step="0.5"
                          value={selectedObs.elevation ?? 0}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) {
                              onUpdateObstacle(selectedObs.id, {
                                elevation: val,
                                cradleEnabled: true,
                              });
                            }
                          }}
                          className="w-14 px-1 py-0.5 text-right font-mono text-[10px] bg-neutral-950 border border-neutral-700 rounded text-cyan-300 focus:border-cyan-400 focus:outline-none"
                        />
                        <span className="font-mono text-cyan-400 font-medium">mm</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="-50"
                      max="60"
                      step="0.5"
                      value={selectedObs.elevation ?? 0}
                      onChange={(e) =>
                        onUpdateObstacle(selectedObs.id, {
                          elevation: parseFloat(e.target.value),
                          cradleEnabled: true,
                        })
                      }
                      className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                    <div className="flex justify-between text-[8px] text-neutral-500 font-mono">
                      <span>-50mm</span>
                      <span>0mm</span>
                      <span>+25mm</span>
                      <span>+50mm</span>
                      <span>+60mm</span>
                    </div>
                  </div>

                  {/* Quick Immersion Presets & Micro-Nudges */}
                  <div className="grid grid-cols-6 gap-1 text-[10px]">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateObstacle(selectedObs.id, {
                          elevation: Math.round(((selectedObs.elevation || 0) - 1) * 10) / 10,
                          cradleEnabled: true,
                        })
                      }
                      className="py-1 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 rounded font-mono transition-colors"
                      title="Sink 1mm deeper"
                    >
                      -1mm
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateObstacle(selectedObs.id, {
                          elevation: 0,
                        })
                      }
                      className={`py-1 rounded font-mono transition-colors ${
                        (selectedObs.elevation || 0) === 0
                          ? 'bg-cyan-500/25 border border-cyan-400 text-cyan-200 font-bold'
                          : 'bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300'
                      }`}
                      title="Flush with surface"
                    >
                      0mm
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateObstacle(selectedObs.id, {
                          elevation: 10,
                          cradleEnabled: true,
                        })
                      }
                      className={`py-1 rounded font-mono transition-colors ${
                        (selectedObs.elevation || 0) === 10
                          ? 'bg-cyan-500/25 border border-cyan-400 text-cyan-200 font-bold'
                          : 'bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300'
                      }`}
                      title="Raise +10mm"
                    >
                      +10
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateObstacle(selectedObs.id, {
                          elevation: 25,
                          cradleEnabled: true,
                        })
                      }
                      className={`py-1 rounded font-mono transition-colors ${
                        (selectedObs.elevation || 0) === 25
                          ? 'bg-cyan-500/25 border border-cyan-400 text-cyan-200 font-bold'
                          : 'bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300'
                      }`}
                      title="Raise +25mm"
                    >
                      +25
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateObstacle(selectedObs.id, {
                          elevation: 50,
                          cradleEnabled: true,
                        })
                      }
                      className={`py-1 rounded font-mono transition-colors ${
                        (selectedObs.elevation || 0) === 50
                          ? 'bg-cyan-500/25 border border-cyan-400 text-cyan-200 font-bold'
                          : 'bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-cyan-300 font-semibold'
                      }`}
                      title="Raise +50mm"
                    >
                      +50
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateObstacle(selectedObs.id, {
                          elevation: Math.round(((selectedObs.elevation || 0) + 1) * 10) / 10,
                        })
                      }
                      className="py-1 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 rounded font-mono transition-colors"
                      title="Lift 1mm up"
                    >
                      +1mm
                    </button>
                  </div>

                  {/* Conformal Cradle Toggle Switch */}
                  <label className="flex items-start gap-2.5 p-2 rounded-xl bg-neutral-950/60 border border-neutral-800/80 cursor-pointer hover:border-neutral-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedObs.cradleEnabled !== false}
                      onChange={(e) =>
                        onUpdateObstacle(selectedObs.id, {
                          cradleEnabled: e.target.checked,
                        })
                      }
                      className="mt-0.5 rounded bg-neutral-800 border-neutral-700 text-cyan-500 focus:ring-0 cursor-pointer"
                    />
                    <div className="text-[11px] leading-snug">
                      <span className="font-medium text-neutral-200 block">
                        Wrap Plane Around Underside
                      </span>
                      <span className="text-[10px] text-neutral-400">
                        Sand plane cups around shape below the plane; wake emanates from the waterline.
                      </span>
                    </div>
                  </label>
                </div>
              )}

              {/* ── TAB 2: 3-AXIS 3D ROTATION ── */}
              {cradleHudTab === 'rotation' && (
                <div className="space-y-2.5">
                  {/* Pitch Tilt (X-Axis) */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-neutral-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> Pitch Tilt (X-Axis)
                      </span>
                      <span className="font-mono text-rose-400 font-medium">
                        {selectedObs.rotationX ?? 0}°
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
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
                        className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-rose-400"
                      />
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateObstacle(selectedObs.id, {
                              rotationX: (((selectedObs.rotationX || 0) - 15 + 180) % 360) - 180,
                            })
                          }
                          className="px-1.5 py-0.5 text-[9px] bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded font-mono"
                        >
                          -15°
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateObstacle(selectedObs.id, {
                              rotationX: (((selectedObs.rotationX || 0) + 15 + 180) % 360) - 180,
                            })
                          }
                          className="px-1.5 py-0.5 text-[9px] bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded font-mono"
                        >
                          +15°
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Yaw Spin (Y-Axis / Ground) */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-neutral-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" /> Yaw Rotation (Y-Axis)
                      </span>
                      <span className="font-mono text-cyan-400 font-medium">
                        {selectedObs.rotation ?? 0}°
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
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
                        className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      />
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateObstacle(selectedObs.id, {
                              rotation: ((selectedObs.rotation || 0) - 15 + 360) % 360,
                              rotationY: ((selectedObs.rotationY || selectedObs.rotation || 0) - 15 + 360) % 360,
                            })
                          }
                          className="px-1.5 py-0.5 text-[9px] bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded font-mono"
                        >
                          -15°
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateObstacle(selectedObs.id, {
                              rotation: ((selectedObs.rotation || 0) + 15) % 360,
                              rotationY: ((selectedObs.rotationY || selectedObs.rotation || 0) + 15) % 360,
                            })
                          }
                          className="px-1.5 py-0.5 text-[9px] bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded font-mono"
                        >
                          +15°
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Roll Tilt (Z-Axis) */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-neutral-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Roll Tilt (Z-Axis)
                      </span>
                      <span className="font-mono text-blue-400 font-medium">
                        {selectedObs.rotationZ ?? 0}°
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
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
                        className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-blue-400"
                      />
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateObstacle(selectedObs.id, {
                              rotationZ: (((selectedObs.rotationZ || 0) - 15 + 180) % 360) - 180,
                            })
                          }
                          className="px-1.5 py-0.5 text-[9px] bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded font-mono"
                        >
                          -15°
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateObstacle(selectedObs.id, {
                              rotationZ: (((selectedObs.rotationZ || 0) + 15 + 180) % 360) - 180,
                            })
                          }
                          className="px-1.5 py-0.5 text-[9px] bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded font-mono"
                        >
                          +15°
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Reset All Rotations Button */}
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObstacle(selectedObs.id, {
                        rotation: 0,
                        rotationX: 0,
                        rotationY: 0,
                        rotationZ: 0,
                      })
                    }
                    className="w-full py-1.5 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded-lg text-neutral-300 text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors"
                  >
                    <RotateCcw className="w-3 h-3 text-cyan-400" />
                    <span>Level All 3 Axes (Reset to 0°)</span>
                  </button>
                </div>
              )}

              {/* ── TAB 3: POSITION ON CANVAS (X, Z) ── */}
              {cradleHudTab === 'position' && (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-neutral-400">Position X</span>
                        <span className="font-mono text-cyan-400 font-medium">
                          {selectedObs.x.toFixed(0)} mm
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-surface.width / 2}
                        max={surface.width / 2}
                        step="1"
                        value={selectedObs.x}
                        onChange={(e) =>
                          onUpdateObstacle(selectedObs.id, { x: parseFloat(e.target.value) })
                        }
                        className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-neutral-400">Position Z</span>
                        <span className="font-mono text-cyan-400 font-medium">
                          {selectedObs.z.toFixed(0)} mm
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-surface.length / 2}
                        max={surface.length / 2}
                        step="1"
                        value={selectedObs.z}
                        onChange={(e) =>
                          onUpdateObstacle(selectedObs.id, { z: parseFloat(e.target.value) })
                        }
                        className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      />
                    </div>
                  </div>

                  <p className="text-[10px] text-neutral-500 italic text-center">
                    💡 Tip: Click and drag the stone directly on the 3D sand bed to position it intuitively!
                  </p>
                </div>
              )}

              {/* ── TAB 4: BOUNDING BOX & PRECISION CALIPER MEASUREMENTS ── */}
              {cradleHudTab === 'caliper' && (
                <div className="space-y-2.5">
                  {/* Master Toggle */}
                  <div className="flex items-center justify-between p-2 rounded-xl bg-neutral-950/80 border border-neutral-800">
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded-md bg-amber-500/20 text-amber-300">
                        <Box className="w-3.5 h-3.5" />
                      </div>
                      <div className="text-[11px]">
                        <span className="font-semibold text-neutral-200 block">3D Bounding Box Cage</span>
                        <span className="text-[10px] text-neutral-400">Shows exact bounding volume & millimeter calipers</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onUpdateView?.({ showBoundingBox: !view.showBoundingBox })}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold font-mono transition-colors cursor-pointer border ${
                        view.showBoundingBox
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                          : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {view.showBoundingBox ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  {/* Mode Selector: Oriented vs Footprint vs Both */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-semibold text-neutral-400">Measurement Box Mode:</span>
                    <div className="grid grid-cols-3 gap-1 text-[10px]">
                      <button
                        type="button"
                        onClick={() => onUpdateView?.({ boundingBoxMode: 'oriented' })}
                        className={`p-1.5 rounded-lg border text-center transition-colors cursor-pointer ${
                          (view.boundingBoxMode || 'oriented') === 'oriented'
                            ? 'bg-amber-950/80 border-amber-500/50 text-amber-300 font-semibold'
                            : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                        }`}
                        title="Local caliper cage that moves & rotates with the stone (matches real physical measurements)"
                      >
                        Oriented (Caliper)
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateView?.({ boundingBoxMode: 'footprint' })}
                        className={`p-1.5 rounded-lg border text-center transition-colors cursor-pointer ${
                          view.boundingBoxMode === 'footprint'
                            ? 'bg-amber-950/80 border-amber-500/50 text-amber-300 font-semibold'
                            : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                        }`}
                        title="Canvas footprint boundary projected on sand bed"
                      >
                        Sand Footprint
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateView?.({ boundingBoxMode: 'both' })}
                        className={`p-1.5 rounded-lg border text-center transition-colors cursor-pointer ${
                          view.boundingBoxMode === 'both'
                            ? 'bg-amber-950/80 border-amber-500/50 text-amber-300 font-semibold'
                            : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                        }`}
                        title="Show both local caliper cage and sand bed footprint simultaneously"
                      >
                        Both Boxes
                      </button>
                    </div>
                  </div>

                  {/* Dimension Readouts */}
                  {selectedObsDims && (
                    <div className="p-2.5 bg-neutral-950/80 rounded-xl border border-neutral-800/80 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-neutral-300 flex items-center gap-1">
                          <Ruler className="w-3.5 h-3.5 text-amber-400" />
                          Stone Dimensions:
                        </span>
                        <span className="font-mono text-emerald-400 font-bold">
                          {selectedObsDims.dimW.toFixed(1)} × {selectedObsDims.dimD.toFixed(1)} × {selectedObsDims.dimH.toFixed(1)} mm
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 text-center font-mono text-[10px]">
                        <div className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800">
                          <span className="text-[9px] text-rose-400 block font-sans">Width (X)</span>
                          <span className="font-bold text-neutral-100">{selectedObsDims.dimW.toFixed(1)}</span>
                          <span className="text-neutral-500 text-[9px]"> mm</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800">
                          <span className="text-[9px] text-cyan-400 block font-sans">Depth (Z)</span>
                          <span className="font-bold text-neutral-100">{selectedObsDims.dimD.toFixed(1)}</span>
                          <span className="text-neutral-500 text-[9px]"> mm</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800">
                          <span className="text-[9px] text-emerald-400 block font-sans">Height (Y)</span>
                          <span className="font-bold text-emerald-300">{selectedObsDims.dimH.toFixed(1)}</span>
                          <span className="text-neutral-500 text-[9px]"> mm</span>
                        </div>
                      </div>

                      <div className="flex justify-between text-[10px] text-neutral-400 pt-1 border-t border-neutral-800/60">
                        <span>Max Span Footprint: <strong className="text-neutral-200">Ø {(selectedObs.radius * 2).toFixed(1)} mm</strong></span>
                        <span>Elevation: <strong className="text-cyan-300">{((selectedObs.elevation || 0) < 0 ? `Cradled ${selectedObs.elevation}mm` : `${selectedObs.elevation || 0}mm`)}</strong></span>
                      </div>
                    </div>
                  )}

                  {/* 3D Dimension Tag Toggle */}
                  <label className="flex items-center justify-between p-2 rounded-lg bg-neutral-950/60 border border-neutral-800 cursor-pointer">
                    <span className="text-[11px] text-neutral-300">Show 3D Measurement Tags</span>
                    <input
                      type="checkbox"
                      checked={view.showDimensionLabels !== false}
                      onChange={(e) => onUpdateView?.({ showDimensionLabels: e.target.checked })}
                      className="rounded bg-neutral-800 border-neutral-700 text-amber-500 focus:ring-0 cursor-pointer"
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── FLOATING WATER LEVEL CONTROLLER HUD (Visual aid while designing) ── */}
      {view.showWaterPlane && (
        <div className="absolute bottom-16 right-4 z-20 flex flex-col items-end pointer-events-auto select-none">
          {isWaterHudMinimized ? (
            /* Minimized Quick Pill */
            <button
              onClick={() => setIsWaterHudMinimized(false)}
              className="flex items-center gap-2 bg-neutral-900/95 backdrop-blur-md border border-sky-500/60 hover:border-sky-400 text-neutral-200 px-3 py-2 rounded-xl shadow-2xl shadow-sky-950/60 transition-all hover:scale-102 cursor-pointer group"
              title="Expand Water Level Controller"
            >
              <div className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
              <Waves className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-semibold font-mono text-sky-300">
                Water {((view.waterLevel ?? 5) > 0 ? `+${(view.waterLevel ?? 5)}` : (view.waterLevel ?? 5))} mm
              </span>
              <ChevronUp className="w-3.5 h-3.5 text-neutral-400 group-hover:text-neutral-200" />
            </button>
          ) : (
            /* Full Water Level Controller Card */
            <div className="w-76 sm:w-84 bg-neutral-900/95 backdrop-blur-xl border border-sky-500/40 rounded-2xl p-3.5 shadow-2xl shadow-neutral-950/80 text-neutral-200 space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-sky-950/90 border border-sky-500/40 text-sky-400">
                    <Waves className="w-4 h-4 animate-pulse" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-xs text-neutral-100 tracking-wide">
                        Water Level Plane
                      </span>
                      <span className="text-[9px] px-1.5 py-0.2 font-mono rounded bg-sky-950 text-sky-300 border border-sky-700/50">
                        Visual Only
                      </span>
                    </div>
                    <p className="text-[10px] text-neutral-400">
                      Visual guide only • Excluded from STL export
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setIsWaterHudMinimized(true)}
                    className="p-1 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors cursor-pointer"
                    title="Minimize Controller"
                  >
                    <Minimize2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onUpdateView?.({ showWaterPlane: false })}
                    className="p-1 rounded-md text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 transition-colors cursor-pointer"
                    title="Hide Water Plane"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Current Elevation Readout & Direct Numeric Input */}
              <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-neutral-400">Plane Elevation (Y)</span>
                  <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-700/80 rounded-lg px-2 py-0.5">
                    <input
                      type="number"
                      step={0.5}
                      value={view.waterLevel ?? 5.0}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) onUpdateView?.({ waterLevel: val });
                      }}
                      className="w-14 bg-transparent text-right font-mono font-bold text-sm text-sky-300 focus:outline-none"
                    />
                    <span className="text-[11px] font-mono text-neutral-500">mm</span>
                  </div>
                </div>

                {/* Elevation Slider */}
                <div className="pt-1">
                  <input
                    type="range"
                    min={Math.min(-10, Math.floor(stats.minH - 5))}
                    max={Math.max(45, Math.ceil(stats.maxH + 15))}
                    step={0.2}
                    value={view.waterLevel ?? 5.0}
                    onChange={(e) =>
                      onUpdateView?.({ waterLevel: parseFloat(e.target.value) })
                    }
                    className="w-full accent-sky-400 cursor-pointer h-1.5 bg-neutral-800 rounded-lg"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-neutral-500 mt-0.5">
                    <span>{Math.min(-10, Math.floor(stats.minH - 5))}mm</span>
                    <span className="text-neutral-400">0mm Base</span>
                    <span>+{Math.max(45, Math.ceil(stats.maxH + 15))}mm</span>
                  </div>
                </div>

                {/* Sand relation status */}
                <div className="text-[10px] flex items-center justify-between text-neutral-400 pt-1 border-t border-neutral-800/60">
                  <span>Sand Span:</span>
                  <span className="font-mono text-neutral-300">
                    {stats.minH > 0 ? `+${stats.minH}` : stats.minH}mm (troughs) → +{stats.maxH}mm (crests)
                  </span>
                </div>
              </div>

              {/* Quick Snap Presets */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium text-neutral-400 flex items-center justify-between">
                  <span>Quick Snap Elevation</span>
                  <span className="text-neutral-500 text-[9px]">Click to align</span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  <button
                    onClick={() => onUpdateView?.({ waterLevel: 0 })}
                    className={`py-1 px-1.5 text-[10px] rounded-lg font-mono font-medium transition-colors text-center cursor-pointer ${
                      (view.waterLevel ?? 5) === 0
                        ? 'bg-sky-500 text-neutral-950 font-bold'
                        : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                    }`}
                    title="Align with Base Plane (0.0mm)"
                  >
                    0mm Base
                  </button>
                  <button
                    onClick={() => onUpdateView?.({ waterLevel: stats.minH })}
                    className={`py-1 px-1.5 text-[10px] rounded-lg font-mono font-medium transition-colors text-center cursor-pointer ${
                      Math.abs((view.waterLevel ?? 5) - stats.minH) < 0.1
                        ? 'bg-sky-500 text-neutral-950 font-bold'
                        : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                    }`}
                    title={`Align with Sand Trough (${stats.minH}mm)`}
                  >
                    Trough
                  </button>
                  <button
                    onClick={() =>
                      onUpdateView?.({
                        waterLevel: parseFloat(((stats.minH + stats.maxH) / 2).toFixed(1)),
                      })
                    }
                    className={`py-1 px-1.5 text-[10px] rounded-lg font-mono font-medium transition-colors text-center cursor-pointer ${
                      Math.abs((view.waterLevel ?? 5) - (stats.minH + stats.maxH) / 2) < 0.2
                        ? 'bg-sky-500 text-neutral-950 font-bold'
                        : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                    }`}
                    title="Align with Mid-Tide Height"
                  >
                    Mid-Tide
                  </button>
                  <button
                    onClick={() => onUpdateView?.({ waterLevel: stats.maxH })}
                    className={`py-1 px-1.5 text-[10px] rounded-lg font-mono font-medium transition-colors text-center cursor-pointer ${
                      Math.abs((view.waterLevel ?? 5) - stats.maxH) < 0.1
                        ? 'bg-sky-500 text-neutral-950 font-bold'
                        : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                    }`}
                    title={`Align with Dune Crests (+${stats.maxH}mm)`}
                  >
                    Crests
                  </button>
                </div>
              </div>

              {/* Nudge Step Buttons */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-neutral-500 mr-0.5">Nudge:</span>
                <button
                  onClick={() =>
                    onUpdateView?.({
                      waterLevel: parseFloat(((view.waterLevel ?? 5) - 5).toFixed(1)),
                    })
                  }
                  className="flex-1 py-1 text-[10px] font-mono bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 transition-colors cursor-pointer"
                >
                  -5mm
                </button>
                <button
                  onClick={() =>
                    onUpdateView?.({
                      waterLevel: parseFloat(((view.waterLevel ?? 5) - 1).toFixed(1)),
                    })
                  }
                  className="flex-1 py-1 text-[10px] font-mono bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 transition-colors cursor-pointer"
                >
                  -1mm
                </button>
                <button
                  onClick={() =>
                    onUpdateView?.({
                      waterLevel: parseFloat(((view.waterLevel ?? 5) + 1).toFixed(1)),
                    })
                  }
                  className="flex-1 py-1 text-[10px] font-mono bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 transition-colors cursor-pointer"
                >
                  +1mm
                </button>
                <button
                  onClick={() =>
                    onUpdateView?.({
                      waterLevel: parseFloat(((view.waterLevel ?? 5) + 5).toFixed(1)),
                    })
                  }
                  className="flex-1 py-1 text-[10px] font-mono bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 transition-colors cursor-pointer"
                >
                  +5mm
                </button>
              </div>

              {/* Appearance & Material Options Accordion */}
              <div className="border-t border-neutral-800/80 pt-2 space-y-2">
                <button
                  onClick={() => setShowAppearanceOptions(!showAppearanceOptions)}
                  className="w-full flex items-center justify-between text-[10px] font-medium text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <Sliders className="w-3 h-3 text-sky-400" />
                    <span>Water Transparency & Appearance</span>
                  </span>
                  {showAppearanceOptions ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {showAppearanceOptions && (
                  <div className="space-y-2.5 pt-1 bg-neutral-950/60 p-2.5 rounded-xl border border-neutral-800/60">
                    {/* Opacity */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-neutral-400">
                        <span>Transparency / Opacity:</span>
                        <span className="font-mono text-sky-300">
                          {Math.round((view.waterOpacity ?? 0.45) * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={0.85}
                        step={0.05}
                        value={view.waterOpacity ?? 0.45}
                        onChange={(e) =>
                          onUpdateView?.({ waterOpacity: parseFloat(e.target.value) })
                        }
                        className="w-full accent-sky-400 cursor-pointer h-1.5 bg-neutral-800 rounded"
                      />
                    </div>

                    {/* Tint color swatches */}
                    <div className="space-y-1">
                      <span className="text-[10px] text-neutral-400">Water Tint:</span>
                      <div className="flex items-center gap-2">
                        {[
                          { name: 'Aqua Blue', color: '#0284c7' },
                          { name: 'Lagoon Cyan', color: '#06b6d4' },
                          { name: 'Deep Ocean', color: '#1e3a8a' },
                          { name: 'Spring Emerald', color: '#0d9488' },
                          { name: 'Slate Frosted', color: '#475569' },
                        ].map((preset) => (
                          <button
                            key={preset.color}
                            onClick={() => onUpdateView?.({ waterColor: preset.color })}
                            style={{ backgroundColor: preset.color }}
                            className={`w-5 h-5 rounded-full border transition-transform cursor-pointer ${
                              (view.waterColor || '#0284c7') === preset.color
                                ? 'border-white scale-115 ring-2 ring-sky-400/60'
                                : 'border-neutral-700 hover:scale-105 opacity-70 hover:opacity-100'
                            }`}
                            title={preset.name}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Extent and Wave Ripples */}
                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      <button
                        onClick={() =>
                          onUpdateView?.({
                            waterExtents: view.waterExtents === 'wide' ? 'fit' : 'wide',
                          })
                        }
                        className={`py-1 px-1.5 rounded text-[9px] font-medium border text-center transition-colors cursor-pointer ${
                          view.waterExtents === 'wide'
                            ? 'bg-neutral-800 border-sky-500/50 text-sky-300'
                            : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        {view.waterExtents === 'wide' ? '🌊 Expansive Pool' : '📐 Fit Sand Stock'}
                      </button>

                      <button
                        onClick={() =>
                          onUpdateView?.({
                            waterAnimate: !view.waterAnimate,
                          })
                        }
                        className={`py-1 px-1.5 rounded text-[9px] font-medium border text-center transition-colors cursor-pointer ${
                          view.waterAnimate
                            ? 'bg-sky-950 border-sky-500 text-sky-300'
                            : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        {view.waterAnimate ? '✨ Wave Shimmer: ON' : '⏸ Wave Shimmer: Flat'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Viewport Bottom Interaction Hint */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        <div className="bg-neutral-900/80 backdrop-blur-md border border-neutral-800/80 rounded-full px-4 py-1.5 text-xs text-neutral-300 flex items-center gap-2 shadow-lg">
          {view.activeTool === 'paint' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <span>
                <strong className="text-cyan-300">Paint Active:</strong> Click & drag to sculpt dunes onto the canvas • <kbd className="px-1.5 py-0.5 bg-neutral-800 border border-neutral-700 rounded text-[11px] text-neutral-200">Shift</kbd> Erase • <kbd className="px-1.5 py-0.5 bg-neutral-800 border border-neutral-700 rounded text-[11px] text-neutral-200">[ / ]</kbd> Brush Size
              </span>
            </>
          ) : (
            <span>
              <strong className="text-neutral-200">Orbit View:</strong> Left-drag rotate • Right-drag pan • Scroll zoom • Switch to <strong>Paint Mask</strong> to paint
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
