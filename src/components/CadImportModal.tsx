import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import {
  X,
  Upload,
  Box,
  Sparkles,
  Check,
  AlertCircle,
  Sliders,
  Scale,
  RefreshCw,
  RotateCw,
  Compass,
  Lock,
  Unlock,
  FlipHorizontal,
  FlipVertical,
  Maximize2,
  Minimize2,
  Eye,
} from 'lucide-react';
import {
  ParsedGeometryResult,
  parse3dMeshFile,
  parseDxf,
  parseRobustSvg,
  transform3dGeometry,
  transform2dPolygonPoints,
  extractAccurateSilhouette,
  CAD_SAMPLE_PRESETS,
} from '../utils/importers';
import { imageToPolygon, generateSdfGridFromPolygon } from '../utils/customShape';
import { Obstacle } from '../types';

interface CadImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportGeometry: (result: ParsedGeometryResult, asNewObstacle: boolean) => void;
  selectedObstacle: Obstacle | null;
  surfaceWidth: number;
  surfaceLength: number;
}

export const CadImportModal: React.FC<CadImportModalProps> = ({
  isOpen,
  onClose,
  onImportGeometry,
  selectedObstacle,
  surfaceWidth,
  surfaceLength,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const previewSceneRef = useRef<THREE.Scene | null>(null);
  const previewCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const previewMeshGroupRef = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Raw unrotated parsed geometry
  const [rawParsedResult, setRawParsedResult] = useState<ParsedGeometryResult | null>(null);
  // Current actively transformed geometry
  const [activeResult, setActiveResult] = useState<ParsedGeometryResult | null>(null);

  // 3D Transform and Orientation State
  const [upAxis, setUpAxis] = useState<'Y' | 'Z' | 'X' | '-Z' | '-Y' | '-X'>('Z'); // Default Z-Up for CAD/STL
  const [rotX, setRotX] = useState<number>(0);
  const [rotY, setRotY] = useState<number>(0);
  const [rotZ, setRotZ] = useState<number>(0);
  const [flipX, setFlipX] = useState<boolean>(false);
  const [flipZ, setFlipZ] = useState<boolean>(false);

  // Scaling & Aspect Ratio State
  const [lockAspectRatio, setLockAspectRatio] = useState<boolean>(true);
  const [scaleX, setScaleX] = useState<number>(1.0);
  const [scaleY, setScaleY] = useState<number>(1.0);
  const [scaleZ, setScaleZ] = useState<number>(1.0);
  const [targetRadius, setTargetRadius] = useState<number>(45);
  const [targetHeight, setTargetHeight] = useState<number>(18);
  const [importMode, setImportMode] = useState<'replace' | 'new'>('replace');
  const [showPreviewBoundingBox, setShowPreviewBoundingBox] = useState<boolean>(true);

  // Preview turntable drag
  const isOrbitingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const orbitAngleRef = useRef({ theta: 0.6, phi: 0.8 });

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      if (!selectedObstacle) {
        setImportMode('new');
      }
    }
  }, [isOpen, selectedObstacle]);

  // Recalculate transformed geometry whenever orientation or scale changes
  const applyTransform = useCallback(
    (base: ParsedGeometryResult) => {
      if (!base) return;

      if (base.meshData && base.meshData.rawPositions && base.meshData.rawPositions.length > 0) {
        // 3D Mesh transformation
        const transformed = transform3dGeometry(
          base.meshData.rawPositions,
          base.meshData.rawNormals || [],
          {
            upAxis,
            rotXDeg: rotX,
            rotYDeg: rotY,
            rotZDeg: rotZ,
            flipX,
            flipZ,
            scaleX: lockAspectRatio ? 1.0 : scaleX,
            scaleY: lockAspectRatio ? 1.0 : scaleY,
            scaleZ: lockAspectRatio ? 1.0 : scaleZ,
          }
        );

        setActiveResult({
          ...base,
          polygonPoints: transformed.polygonPoints,
          sdfGrid: transformed.sdfGrid,
          dimensions: {
            width: transformed.width,
            height: transformed.height,
            depth: transformed.depth,
          },
          aspectRatio: transformed.aspectRatio,
          meshData: {
            ...base.meshData,
            positions: transformed.positions,
            normals: transformed.normals,
            bbox: transformed.bbox,
          },
        });

        // Automatically maintain accurate vertical height in 1:1 proportion to footprint radius
        if (lockAspectRatio) {
          const maxHoriz = Math.max(0.1, Math.max(transformed.width, transformed.depth));
          const naturalHeight = Math.round((targetRadius * 2) * (transformed.height / maxHoriz) * 10) / 10;
          setTargetHeight(naturalHeight);
        }
      } else if (base.rawPolygonPoints && base.rawPolygonPoints.length >= 3) {
        // 2D Contour transformation (DXF / SVG)
        const transformed = transform2dPolygonPoints(base.rawPolygonPoints, {
          rotDeg: rotY,
          flipX,
          flipZ,
          scaleX: lockAspectRatio ? 1.0 : scaleX,
          scaleZ: lockAspectRatio ? 1.0 : scaleZ,
        });

        setActiveResult({
          ...base,
          polygonPoints: transformed.polygonPoints,
          sdfGrid: transformed.sdfGrid,
          aspectRatio: transformed.aspectRatio,
        });
      } else {
        setActiveResult(base);
      }
    },
    [upAxis, rotX, rotY, rotZ, flipX, flipZ, lockAspectRatio, scaleX, scaleY, scaleZ, targetRadius]
  );

  useEffect(() => {
    if (rawParsedResult) {
      applyTransform(rawParsedResult);
    }
  }, [rawParsedResult, applyTransform]);

  // 3D Mini Preview WebGL Setup & Animation Loop
  useEffect(() => {
    if (!isOpen || !previewCanvasRef.current) return;

    const canvas = previewCanvasRef.current;
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 240;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    previewRendererRef.current = renderer;

    const scene = new THREE.Scene();
    previewSceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
    previewCameraRef.current = camera;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xfff5e6, 1.6);
    dirLight.position.set(60, 100, 70);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x60a5fa, 0.6);
    fillLight.position.set(-60, 40, -50);
    scene.add(fillLight);

    // Floor Grid & Base Plate
    const grid = new THREE.GridHelper(120, 24, 0x38bdf8, 0x1e293b);
    grid.position.y = 0;
    scene.add(grid);

    // Coordinate Axes Guide: Red=X (Width), Green=Y (Height), Blue=Z (Depth)
    const axes = new THREE.AxesHelper(30);
    axes.position.set(-50, 0.2, -50);
    scene.add(axes);

    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    previewMeshGroupRef.current = meshGroup;

    // Render loop
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);

      if (camera && renderer && scene) {
        const radius = 110;
        const theta = orbitAngleRef.current.theta;
        const phi = Math.max(0.15, Math.min(Math.PI / 2 - 0.05, orbitAngleRef.current.phi));

        camera.position.x = radius * Math.sin(phi) * Math.sin(theta);
        camera.position.y = radius * Math.cos(phi);
        camera.position.z = radius * Math.sin(phi) * Math.cos(theta);
        camera.lookAt(0, 8, 0);

        renderer.render(scene, camera);
      }
    };
    animate();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      renderer.dispose();
      previewRendererRef.current = null;
      previewSceneRef.current = null;
      previewCameraRef.current = null;
    };
  }, [isOpen]);

  // Update Mini Preview Geometry
  useEffect(() => {
    if (!previewMeshGroupRef.current || !activeResult) return;

    previewMeshGroupRef.current.clear();

    let geo: THREE.BufferGeometry | null = null;

    if (activeResult.meshData && activeResult.meshData.positions.length > 0) {
      geo = new THREE.BufferGeometry();
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(activeResult.meshData.positions, 3)
      );
      if (activeResult.meshData.normals && activeResult.meshData.normals.length > 0) {
        geo.setAttribute(
          'normal',
          new THREE.Float32BufferAttribute(activeResult.meshData.normals, 3)
        );
      } else {
        geo.computeVertexNormals();
      }

      // Normalize scale uniformly to fit nicely in preview viewport without distortion
      const bbox = activeResult.meshData.bbox;
      if (bbox) {
        const maxDim = Math.max(
          0.1,
          bbox.maxX - bbox.minX,
          bbox.maxY - bbox.minY,
          bbox.maxZ - bbox.minZ
        );
        const previewScale = 60 / maxDim;
        geo.scale(previewScale, previewScale, previewScale);
      }
    } else if (activeResult.polygonPoints && activeResult.polygonPoints.length >= 3) {
      const shape = new THREE.Shape();
      const pts = activeResult.polygonPoints;
      const r = 26;
      shape.moveTo(pts[0][0] * r, pts[0][1] * r);
      for (let i = 1; i < pts.length; i++) {
        shape.lineTo(pts[i][0] * r, pts[i][1] * r);
      }
      shape.closePath();

      geo = new THREE.ExtrudeGeometry(shape, {
        depth: 14,
        bevelEnabled: true,
        bevelSegments: 3,
        steps: 1,
        bevelSize: 1.5,
        bevelThickness: 1.5,
      });
      geo.rotateX(-Math.PI / 2);
      geo.computeBoundingBox();
      if (geo.boundingBox) {
        const cx = (geo.boundingBox.min.x + geo.boundingBox.max.x) / 2;
        const cz = (geo.boundingBox.min.z + geo.boundingBox.max.z) / 2;
        const minY = geo.boundingBox.min.y;
        geo.translate(-cx, -minY, -cz);
      }
    }

    if (geo) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        roughness: 0.5,
        metalness: 0.15,
        wireframe: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      previewMeshGroupRef.current.add(mesh);

      // Add subtle wireframe overlay for CAD inspection
      const wireMat = new THREE.MeshBasicMaterial({
        color: 0x93c5fd,
        wireframe: true,
        transparent: true,
        opacity: 0.25,
      });
      const wireMesh = new THREE.Mesh(geo, wireMat);
      previewMeshGroupRef.current.add(wireMesh);

      // Add Visual 3D Bounding Box Cage in turntable preview
      if (showPreviewBoundingBox) {
        geo.computeBoundingBox();
        const bbox = geo.boundingBox;
        if (bbox) {
          const bw = bbox.max.x - bbox.min.x;
          const bh = bbox.max.y - bbox.min.y;
          const bd = bbox.max.z - bbox.min.z;
          const bcx = (bbox.min.x + bbox.max.x) / 2;
          const bcy = (bbox.min.y + bbox.max.y) / 2;
          const bcz = (bbox.min.z + bbox.max.z) / 2;

          const boxGeom = new THREE.BoxGeometry(bw, bh, bd);
          boxGeom.translate(bcx, bcy, bcz);

          // Translucent tinted glass volume
          const glassMat = new THREE.MeshBasicMaterial({
            color: 0xf59e0b,
            transparent: true,
            opacity: 0.08,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          previewMeshGroupRef.current.add(new THREE.Mesh(boxGeom, glassMat));

          // Box perimeter wireframe edges
          const edges = new THREE.EdgesGeometry(boxGeom);
          const edgeMat = new THREE.LineBasicMaterial({
            color: 0xf59e0b,
            transparent: true,
            opacity: 0.85,
          });
          previewMeshGroupRef.current.add(new THREE.LineSegments(edges, edgeMat));
        }
      }
    }
  }, [activeResult, showPreviewBoundingBox]);

  // Orbit controls for mini preview canvas
  const handlePreviewPointerDown = (e: React.PointerEvent) => {
    isOrbitingRef.current = true;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePreviewPointerMove = (e: React.PointerEvent) => {
    if (!isOrbitingRef.current) return;
    const dx = e.clientX - lastPointerRef.current.x;
    const dy = e.clientY - lastPointerRef.current.y;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };

    orbitAngleRef.current.theta -= dx * 0.012;
    orbitAngleRef.current.phi = Math.max(
      0.15,
      Math.min(Math.PI / 2 - 0.05, orbitAngleRef.current.phi + dy * 0.012)
    );
  };

  const handlePreviewPointerUp = () => {
    isOrbitingRef.current = false;
  };

  const handleFileProcess = async (file: File) => {
    setIsLoading(true);
    setErrorMessage(null);
    setRawParsedResult(null);
    setActiveResult(null);

    const name = file.name.toLowerCase();

    try {
      if (name.endsWith('.stl') || name.endsWith('.obj')) {
        const buffer = await file.arrayBuffer();
        const result = await parse3dMeshFile(buffer, file.name);
        setRawParsedResult(result);
        setTargetRadius(result.recommendedRadius);
        setTargetHeight(result.recommendedHeight);
        // Default CAD files are Z-Up
        setUpAxis('Z');
        setRotX(0);
        setRotY(0);
        setRotZ(0);
        setFlipX(false);
        setFlipZ(false);
        setScaleX(1.0);
        setScaleY(1.0);
        setScaleZ(1.0);
        setLockAspectRatio(true);
      } else if (name.endsWith('.dxf')) {
        const text = await file.text();
        const result = parseDxf(text);
        result.name = file.name.replace(/\.[^/.]+$/, '');
        setRawParsedResult(result);
        setTargetRadius(result.recommendedRadius);
        setTargetHeight(result.recommendedHeight);
        setUpAxis('Y');
        setRotX(0);
        setRotY(0);
        setRotZ(0);
        setFlipX(false);
        setFlipZ(false);
        setScaleX(1.0);
        setScaleY(1.0);
        setScaleZ(1.0);
        setLockAspectRatio(true);
      } else if (name.endsWith('.svg') || file.type === 'image/svg+xml') {
        const text = await file.text();
        const result = await parseRobustSvg(text, file.name);
        setRawParsedResult(result);
        setTargetRadius(result.recommendedRadius);
        setTargetHeight(result.recommendedHeight);
        setUpAxis('Y');
        setRotX(0);
        setRotY(0);
        setRotZ(0);
        setFlipX(false);
        setFlipZ(false);
        setScaleX(1.0);
        setScaleY(1.0);
        setScaleZ(1.0);
        setLockAspectRatio(true);
      } else if (/\.(png|jpe?g|webp)$/i.test(name)) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const pts = imageToPolygon(img, 128, 48);
            const sdf = generateSdfGridFromPolygon(pts, 64);
            const result: ParsedGeometryResult = {
              format: 'image',
              name: file.name.replace(/\.[^/.]+$/, ''),
              polygonPoints: pts,
              rawPolygonPoints: pts,
              sdfGrid: sdf,
              sdfRes: 64,
              dimensions: { width: 50, height: 12, depth: 50 },
              recommendedRadius: 40,
              recommendedHeight: 14,
              aspectRatio: 1.0,
              details: `Silhouette extracted from ${img.naturalWidth}×${img.naturalHeight} image`,
            };
            setRawParsedResult(result);
            setTargetRadius(result.recommendedRadius);
            setTargetHeight(result.recommendedHeight);
            setIsLoading(false);
          };
          img.src = e.target?.result as string;
        };
        reader.readAsDataURL(file);
        return;
      } else {
        throw new Error(
          `Unsupported file format "${file.name}". Supported: .STL, .OBJ, .DXF, .SVG, .PNG, .JPG`
        );
      }
    } catch (err: any) {
      console.error('Error processing CAD/3D file:', err);
      setErrorMessage(err?.message || 'Failed to parse file.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileProcess(files[0]);
    }
  };

  const handleSelectPreset = async (preset: typeof CAD_SAMPLE_PRESETS[0]) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      if (preset.type === '3d' && preset.generateGeometry) {
        const geo = preset.generateGeometry();
        const posAttr = geo.getAttribute('position');
        const normAttr = geo.getAttribute('normal');
        geo.computeBoundingBox();
        const bbox = geo.boundingBox!;
        const w = bbox.max.x - bbox.min.x;
        const h = bbox.max.y - bbox.min.y;
        const d = bbox.max.z - bbox.min.z;

        const positions = Array.from(posAttr.array);
        const normals = normAttr ? Array.from(normAttr.array) : [];

        const pts2d: [number, number][] = [];
        for (let i = 0; i < posAttr.count; i++) {
          pts2d.push([posAttr.getX(i), posAttr.getZ(i)]);
        }
        const poly = extractAccurateSilhouette(pts2d, 64);
        const maxHoriz = Math.max(w, d) * 0.5;
        const normPoly: [number, number][] = poly.map(([px, pz]) => [
          (px / maxHoriz) * 0.95,
          (pz / maxHoriz) * 0.95,
        ]);
        const sdf = generateSdfGridFromPolygon(normPoly, 64);

        const recRadius = Math.round(Math.max(w, d) * 0.5);
        const recHeight = Math.round(h * ((recRadius * 2) / Math.max(w, d)) * 10) / 10;

        const result: ParsedGeometryResult = {
          format: 'stl',
          name: 'Zen River Rock 3D',
          polygonPoints: normPoly,
          rawPolygonPoints: normPoly,
          sdfGrid: sdf,
          sdfRes: 64,
          dimensions: { width: Math.round(w), height: Math.round(h), depth: Math.round(d) },
          recommendedRadius: recRadius,
          recommendedHeight: recHeight,
          aspectRatio: w / Math.max(0.1, d),
          meshData: {
            positions,
            normals,
            rawPositions: [...positions],
            rawNormals: [...normals],
            bbox: { minX: -w / 2, maxX: w / 2, minY: 0, maxY: h, minZ: -d / 2, maxZ: d / 2 },
            triangleCount: posAttr.count / 3,
            vertexCount: posAttr.count,
          },
          details: 'Built-in 3D Scanned River Stone Mesh with authentic natural facets & Kelvin wake',
        };
        setRawParsedResult(result);
        setUpAxis('Y');
        setRotX(0);
        setRotY(0);
        setRotZ(0);
        setFlipX(false);
        setFlipZ(false);
        setScaleX(1.0);
        setScaleY(1.0);
        setScaleZ(1.0);
        setLockAspectRatio(true);
        setTargetRadius(recRadius);
        setTargetHeight(recHeight);
      } else if (preset.type === 'dxf' && preset.generateDxfString) {
        const dxf = preset.generateDxfString();
        const result = parseDxf(dxf);
        result.name = preset.name.replace(/^[^\w]+/, '').trim();
        setRawParsedResult(result);
        setUpAxis('Y');
        setRotX(0);
        setRotY(0);
        setRotZ(0);
        setFlipX(false);
        setFlipZ(false);
        setScaleX(1.0);
        setScaleY(1.0);
        setScaleZ(1.0);
        setLockAspectRatio(true);
        setTargetRadius(result.recommendedRadius);
        setTargetHeight(result.recommendedHeight);
      } else if (preset.type === 'svg' && preset.svgString) {
        const result = await parseRobustSvg(preset.svgString, preset.name);
        result.name = preset.name.replace(/^[^\w]+/, '').trim();
        setRawParsedResult(result);
        setUpAxis('Y');
        setRotX(0);
        setRotY(0);
        setRotZ(0);
        setFlipX(false);
        setFlipZ(false);
        setScaleX(1.0);
        setScaleY(1.0);
        setScaleZ(1.0);
        setLockAspectRatio(true);
        setTargetRadius(result.recommendedRadius);
        setTargetHeight(result.recommendedHeight);
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Failed to load sample preset.');
    } finally {
      setIsLoading(false);
    }
  };

  // Quick 90-degree step rotations
  const rotateStep = (axis: 'X' | 'Y' | 'Z', delta: number) => {
    if (axis === 'X') setRotX((prev) => (prev + delta + 360) % 360);
    if (axis === 'Y') setRotY((prev) => (prev + delta + 360) % 360);
    if (axis === 'Z') setRotZ((prev) => (prev + delta + 360) % 360);
  };

  const resetAllTransforms = () => {
    setRotX(0);
    setRotY(0);
    setRotZ(0);
    setFlipX(false);
    setFlipZ(false);
    setScaleX(1.0);
    setScaleY(1.0);
    setScaleZ(1.0);
    setLockAspectRatio(true);
  };

  const handleApplyImport = () => {
    if (!activeResult) return;
    const finalResult = {
      ...activeResult,
      recommendedRadius: targetRadius,
      recommendedHeight: targetHeight,
    };
    const asNew = importMode === 'new' || !selectedObstacle;
    onImportGeometry(finalResult, asNew);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-neutral-900 border border-neutral-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-950/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
              <Box className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-neutral-100 flex items-center gap-2">
                <span>3D Mesh & CAD Importer + Axis Rotation</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  Orientation & Scale
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Import 3D models (.STL, .OBJ), AutoCAD drawings (.DXF), or vector silhouettes (.SVG) with full 3-axis rotation & aspect ratio locking
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Format Badges */}
          <div className="flex items-center gap-2 text-[11px] text-neutral-400 flex-wrap">
            <span className="font-semibold text-neutral-300">Supported Formats:</span>
            <span className="px-2 py-0.5 bg-blue-950/70 text-blue-300 border border-blue-800/80 rounded-md font-mono">
              .STL (3D Mesh)
            </span>
            <span className="px-2 py-0.5 bg-indigo-950/70 text-indigo-300 border border-indigo-800/80 rounded-md font-mono">
              .OBJ (Wavefront 3D)
            </span>
            <span className="px-2 py-0.5 bg-amber-950/70 text-amber-300 border border-amber-800/80 rounded-md font-mono">
              .DXF (AutoCAD Polylines)
            </span>
            <span className="px-2 py-0.5 bg-emerald-950/70 text-emerald-300 border border-emerald-800/80 rounded-md font-mono">
              .SVG (Vector Paths)
            </span>
            <span className="px-2 py-0.5 bg-neutral-800 text-neutral-300 rounded-md font-mono">
              .PNG / .JPG (Alpha Silhouettes)
            </span>
          </div>

          {/* Upload Drop Zone & Sample Presets (If not loaded yet or to change file) */}
          {!rawParsedResult && (
            <>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-150 ${
                  isDragging
                    ? 'border-cyan-400 bg-cyan-500/10 scale-[0.99]'
                    : 'border-neutral-700 bg-neutral-950/50 hover:bg-neutral-850 hover:border-neutral-600'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".stl,.obj,.dxf,.svg,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFileProcess(e.target.files[0]);
                    }
                  }}
                  className="hidden"
                />
                <div className="flex flex-col items-center gap-2">
                  <div className="p-3 bg-neutral-900 border border-neutral-700/80 rounded-full text-cyan-400 shadow-md">
                    {isLoading ? (
                      <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
                    ) : (
                      <Upload className="w-6 h-6" />
                    )}
                  </div>
                  <div className="font-semibold text-sm text-neutral-200">
                    {isLoading
                      ? 'Processing CAD & 3D Geometry...'
                      : 'Click or Drag & Drop CAD / 3D File Here'}
                  </div>
                  <div className="text-xs text-neutral-400 max-w-md">
                    Drop your 3D rock scan (.stl, .obj), AutoCAD contours (.dxf), or Illustrator vector outlines (.svg)
                  </div>
                </div>
              </div>

              {/* 1-Click CAD Sample Presets */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Quick Test with CAD & 3D Sample Presets
                  </span>
                  <span className="text-[10px] text-neutral-500">Instant 1-Click Load</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {CAD_SAMPLE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className="p-2.5 rounded-xl border border-neutral-800 bg-neutral-950/80 hover:bg-neutral-850 hover:border-neutral-700 text-left transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-neutral-200 group-hover:text-cyan-300 transition-colors">
                          {preset.name}
                        </span>
                        <span className="text-[9px] uppercase px-1.5 py-0.2 rounded font-mono bg-neutral-800 text-neutral-400">
                          {preset.format}
                        </span>
                      </div>
                      <div className="text-[10px] text-neutral-400 mt-1 line-clamp-1">
                        {preset.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3 bg-rose-950/60 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Active Geometry Inspector & Live 3D Rotation Studio */}
          {activeResult && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left Column: Live 3D Viewport Preview */}
              <div className="lg:col-span-5 flex flex-col space-y-3">
                <div className="relative w-full aspect-4/3 bg-neutral-950 rounded-xl border border-neutral-700 overflow-hidden shadow-inner flex items-center justify-center">
                  <canvas
                    ref={previewCanvasRef}
                    onPointerDown={handlePreviewPointerDown}
                    onPointerMove={handlePreviewPointerMove}
                    onPointerUp={handlePreviewPointerUp}
                    onPointerLeave={handlePreviewPointerUp}
                    className="w-full h-full block cursor-grab active:cursor-grabbing"
                  />

                  {/* Overlay Coordinates & Orbit Hint */}
                  <div className="absolute top-2 left-2 flex items-center gap-1.5">
                    <div className="px-2 py-1 bg-neutral-900/80 backdrop-blur-md rounded border border-neutral-800 text-[10px] text-neutral-300 flex items-center gap-1.5">
                      <span className="text-neutral-400 font-mono">Box:</span>
                      <span className="font-mono text-cyan-300 font-semibold">
                        {activeResult.dimensions.width.toFixed(1)} × {activeResult.dimensions.depth.toFixed(1)} × {activeResult.dimensions.height.toFixed(1)} mm
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPreviewBoundingBox(!showPreviewBoundingBox)}
                      className={`px-1.5 py-1 rounded border text-[10px] flex items-center gap-1 cursor-pointer transition-colors ${
                        showPreviewBoundingBox
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-semibold'
                          : 'bg-neutral-900/80 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                      }`}
                      title="Toggle visual bounding box cage in turntable preview"
                    >
                      <Box className="w-3 h-3 text-amber-400" />
                      <span>{showPreviewBoundingBox ? 'Box ON' : 'Box OFF'}</span>
                    </button>
                  </div>

                  <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-neutral-900/80 backdrop-blur-md rounded border border-neutral-800 text-[9px] text-neutral-400 pointer-events-none">
                    Drag to Orbit Preview
                  </div>

                  <div className="absolute top-2 right-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2 py-1 bg-neutral-900/90 hover:bg-neutral-800 text-neutral-300 border border-neutral-700 rounded text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                      title="Load a different file"
                    >
                      <Upload className="w-3 h-3 text-cyan-400" />
                      Replace File
                    </button>
                  </div>
                </div>

                {/* Info & Stats Strip */}
                <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-neutral-200 truncate max-w-[200px]">
                      {activeResult.name}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 uppercase">
                      {activeResult.format}
                    </span>
                  </div>
                  <div className="text-[11px] text-neutral-400 flex items-center justify-between">
                    <span>
                      {activeResult.meshData
                        ? `${activeResult.meshData.triangleCount.toLocaleString()} Triangles`
                        : `${activeResult.polygonPoints.length} Contour Vertices`}
                    </span>
                    <span className="font-mono text-neutral-300">
                      Aspect: {activeResult.aspectRatio?.toFixed(2) || '1.00'}:1
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Column: Axis Orientation, 3D Rotation & Scaling Controls */}
              <div className="lg:col-span-7 space-y-4">
                {/* 1. UP-AXIS ORIENTATION (Fixes sideways / standing CAD models) */}
                {activeResult.meshData && (
                  <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                        <Compass className="w-3.5 h-3.5 text-cyan-400" />
                        CAD Up-Axis Alignment
                      </span>
                      <span className="text-[10px] text-cyan-400 font-mono">
                        {upAxis === 'Z' ? 'AutoCAD / Fusion 360 (Z-Up)' : upAxis === 'Y' ? 'Blender / Three.js (Y-Up)' : `${upAxis}-Up`}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setUpAxis('Z')}
                        className={`p-2 rounded-lg border text-center transition-all cursor-pointer font-medium ${
                          upAxis === 'Z'
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-xs'
                            : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                        }`}
                      >
                        <div className="font-semibold text-xs">Z-Up (CAD)</div>
                        <div className="text-[9px] text-neutral-400">Fusion 360 / STL</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setUpAxis('Y')}
                        className={`p-2 rounded-lg border text-center transition-all cursor-pointer font-medium ${
                          upAxis === 'Y'
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-xs'
                            : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                        }`}
                      >
                        <div className="font-semibold text-xs">Y-Up (OpenGL)</div>
                        <div className="text-[9px] text-neutral-400">Standard 3D</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setUpAxis('X')}
                        className={`p-2 rounded-lg border text-center transition-all cursor-pointer font-medium ${
                          upAxis === 'X'
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-xs'
                            : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                        }`}
                      >
                        <div className="font-semibold text-xs">X-Up (Side)</div>
                        <div className="text-[9px] text-neutral-400">Transverse</div>
                      </button>
                    </div>
                  </div>
                )}

                {/* 2. 3-AXIS ROTATION & 90° STEP FLIP BUTTONS */}
                <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                      <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
                      3D Orientation & Rotation
                    </span>
                    <button
                      type="button"
                      onClick={resetAllTransforms}
                      className="text-[10px] text-neutral-400 hover:text-neutral-200 underline cursor-pointer"
                    >
                      Reset All
                    </button>
                  </div>

                  {/* Quick 90° Flip Buttons */}
                  <div className="grid grid-cols-4 gap-1.5 text-xs">
                    {activeResult.meshData && (
                      <button
                        type="button"
                        onClick={() => rotateStep('X', 90)}
                        className="px-2 py-1.5 bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 rounded-lg text-neutral-300 text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        title="Rotate 90° around X axis (Pitch forward)"
                      >
                        <RotateCw className="w-3 h-3 text-rose-400" />
                        <span>X +90°</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => rotateStep('Y', 90)}
                      className="px-2 py-1.5 bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 rounded-lg text-neutral-300 text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors"
                      title="Rotate 90° around Y axis (Yaw / Plan)"
                    >
                      <RotateCw className="w-3 h-3 text-emerald-400" />
                      <span>Y +90°</span>
                    </button>

                    {activeResult.meshData && (
                      <button
                        type="button"
                        onClick={() => rotateStep('Z', 90)}
                        className="px-2 py-1.5 bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 rounded-lg text-neutral-300 text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        title="Rotate 90° around Z axis (Roll side)"
                      >
                        <RotateCw className="w-3 h-3 text-blue-400" />
                        <span>Z +90°</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setFlipX((f) => !f)}
                      className={`px-2 py-1.5 border rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                        flipX
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                          : 'bg-neutral-900 hover:bg-neutral-850 border-neutral-800 text-neutral-300'
                      }`}
                      title="Mirror Horizontally (Flip X)"
                    >
                      <FlipHorizontal className="w-3 h-3" />
                      <span>Flip X</span>
                    </button>
                  </div>

                  {/* Fine Rotation Sliders */}
                  <div className="space-y-2.5 pt-1">
                    {/* Y Rotation (Yaw / Ground Plan) */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-neutral-400">Ground Rotation (Yaw / Y)</span>
                        <span className="font-mono text-cyan-400 font-semibold">{rotY}°</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="360"
                        step="5"
                        value={rotY}
                        onChange={(e) => setRotY(parseInt(e.target.value, 10))}
                        className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      />
                    </div>

                    {/* X Rotation (Pitch) - only for 3D meshes */}
                    {activeResult.meshData && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-400">Tilt Front/Back (Pitch / X)</span>
                          <span className="font-mono text-rose-400 font-semibold">{rotX}°</span>
                        </div>
                        <input
                          type="range"
                          min="-180"
                          max="180"
                          step="5"
                          value={rotX}
                          onChange={(e) => setRotX(parseInt(e.target.value, 10))}
                          className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-rose-400"
                        />
                      </div>
                    )}

                    {/* Z Rotation (Roll) - only for 3D meshes */}
                    {activeResult.meshData && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-neutral-400">Roll Left/Right (Roll / Z)</span>
                          <span className="font-mono text-blue-400 font-semibold">{rotZ}°</span>
                        </div>
                        <input
                          type="range"
                          min="-180"
                          max="180"
                          step="5"
                          value={rotZ}
                          onChange={(e) => setRotZ(parseInt(e.target.value, 10))}
                          className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-400"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. ASPECT RATIO & SCALING SLIDERS */}
                <div className="p-3.5 bg-neutral-950 rounded-xl border border-neutral-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                      <Scale className="w-3.5 h-3.5 text-amber-400" />
                      Scale & Proportions
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextLock = !lockAspectRatio;
                        setLockAspectRatio(nextLock);
                        if (nextLock) {
                          setScaleX(1.0);
                          setScaleY(1.0);
                          setScaleZ(1.0);
                        }
                      }}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                        lockAspectRatio
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                      }`}
                      title={lockAspectRatio ? 'Locked to original CAD aspect ratio (1:1:1)' : 'Free non-uniform stretching'}
                    >
                      {lockAspectRatio ? (
                        <>
                          <Lock className="w-3 h-3" />
                          <span>Locked Aspect Ratio</span>
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3 h-3" />
                          <span>Unlocked Stretch</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Footprint Placement Radius */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-300">Footprint Radius</span>
                      <span className="font-mono text-cyan-400 font-semibold">
                        {targetRadius} mm (Ø {targetRadius * 2} mm)
                      </span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max={Math.min(surfaceWidth, surfaceLength) * 0.45}
                      step="1"
                      value={targetRadius}
                      onChange={(e) => {
                        const newR = parseFloat(e.target.value);
                        setTargetRadius(newR);
                        if (lockAspectRatio && activeResult) {
                          const maxHoriz = Math.max(0.1, Math.max(activeResult.dimensions.width, activeResult.dimensions.depth));
                          const newH = Math.round((newR * 2) * (activeResult.dimensions.height / maxHoriz) * 10) / 10;
                          setTargetHeight(newH);
                        }
                      }}
                      className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                  </div>

                  {/* 3D Height */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-neutral-300">3D Height / Thickness</span>
                      <span className="font-mono text-amber-400 font-semibold">
                        {targetHeight} mm
                      </span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="300"
                      step="1"
                      value={targetHeight}
                      onChange={(e) => {
                        const newH = parseFloat(e.target.value);
                        setTargetHeight(newH);
                        if (lockAspectRatio && activeResult) {
                          const maxHoriz = Math.max(0.1, Math.max(activeResult.dimensions.width, activeResult.dimensions.depth));
                          const hRatio = activeResult.dimensions.height / maxHoriz;
                          if (hRatio > 0.01) {
                            const newR = Math.round((newH / (2 * hRatio)) * 10) / 10;
                            setTargetRadius(newR);
                          }
                        }
                      }}
                      className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                    />
                  </div>

                  {/* Optional Non-Uniform Stretch sliders (if aspect ratio unlocked) */}
                  {!lockAspectRatio && (
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-neutral-800">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-neutral-400">Stretch X</span>
                          <span className="font-mono text-cyan-400">{scaleX.toFixed(2)}x</span>
                        </div>
                        <input
                          type="range"
                          min="0.3"
                          max="3.0"
                          step="0.05"
                          value={scaleX}
                          onChange={(e) => setScaleX(parseFloat(e.target.value))}
                          className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-neutral-400">Stretch Y</span>
                          <span className="font-mono text-amber-400">{scaleY.toFixed(2)}x</span>
                        </div>
                        <input
                          type="range"
                          min="0.3"
                          max="3.0"
                          step="0.05"
                          value={scaleY}
                          onChange={(e) => setScaleY(parseFloat(e.target.value))}
                          className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-neutral-400">Stretch Z</span>
                          <span className="font-mono text-cyan-400">{scaleZ.toFixed(2)}x</span>
                        </div>
                        <input
                          type="range"
                          min="0.3"
                          max="3.0"
                          step="0.05"
                          value={scaleZ}
                          onChange={(e) => setScaleZ(parseFloat(e.target.value))}
                          className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Import Mode: Replace vs New */}
                {selectedObstacle && (
                  <div className="pt-2 border-t border-neutral-800/80 flex items-center justify-between text-xs">
                    <span className="text-neutral-400">Import Destination:</span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer text-neutral-300">
                        <input
                          type="radio"
                          name="importMode"
                          checked={importMode === 'replace'}
                          onChange={() => setImportMode('replace')}
                          className="text-cyan-500 focus:ring-cyan-500 bg-neutral-800"
                        />
                        <span>Replace "{selectedObstacle.name}"</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-neutral-300">
                        <input
                          type="radio"
                          name="importMode"
                          checked={importMode === 'new'}
                          onChange={() => setImportMode('new')}
                          className="text-cyan-500 focus:ring-cyan-500 bg-neutral-800"
                        />
                        <span>Add as New Stone</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-800 bg-neutral-950/90">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            disabled={!activeResult || isLoading}
            onClick={handleApplyImport}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold shadow-md transition-all cursor-pointer ${
              activeResult && !isLoading
                ? 'bg-cyan-600 hover:bg-cyan-500 text-white hover:shadow-cyan-500/25'
                : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
            }`}
          >
            <Check className="w-4 h-4" />
            {importMode === 'new' || !selectedObstacle
              ? 'Add 3D / CAD Shape to Canvas'
              : 'Apply Geometry to Selected Stone'}
          </button>
        </div>
      </div>
    </div>
  );
};
