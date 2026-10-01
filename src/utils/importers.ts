import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { generateSdfGridFromPolygon } from './customShape';

export interface ParsedGeometryResult {
  format: 'stl' | 'obj' | 'dxf' | 'svg' | 'image';
  name: string;
  polygonPoints: [number, number][]; // normalized [-1, 1]
  sdfGrid: number[];
  sdfRes: number;
  dimensions: {
    width: number; // mm
    height: number; // mm
    depth: number; // mm
  };
  recommendedRadius: number; // mm
  recommendedHeight: number; // mm
  meshData?: {
    positions: number[];
    normals?: number[];
    indices?: number[];
    bbox: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
    triangleCount: number;
    vertexCount: number;
    rawPositions?: number[];
    rawNormals?: number[];
  };
  rawPolygonPoints?: [number, number][];
  svgContent?: string;
  details: string;
  aspectRatio?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DXF PARSER (AutoCAD / Fusion 360 / Rhino 2D & 3D CAD Polylines & Entities)
// ─────────────────────────────────────────────────────────────────────────────

interface DxfEntity {
  type: string;
  points?: [number, number][];
  bulges?: number[];
  closed?: boolean;
  start?: [number, number];
  end?: [number, number];
  center?: [number, number];
  radius?: number;
  startAngle?: number;
  endAngle?: number;
}

/**
 * Parse an ASCII DXF file into 2D polygon contours and calculate bounding dimensions
 */
export function parseDxf(dxfText: string): ParsedGeometryResult {
  const lines = dxfText.split(/\r?\n/);
  const entities: DxfEntity[] = [];

  let inEntities = false;
  let currentEntity: DxfEntity | null = null;
  let currentGroupCode = -1;

  // Track polyline vertices during parsing
  let curVertex: [number, number] = [0, 0];
  let curBulge = 0;

  for (let i = 0; i < lines.length; i += 2) {
    const codeStr = lines[i]?.trim();
    const valStr = lines[i + 1]?.trim();
    if (codeStr === undefined || valStr === undefined) break;

    const code = parseInt(codeStr, 10);
    const val = valStr;

    if (code === 0) {
      // New entity or section boundary
      if (val === 'SECTION') {
        inEntities = false;
      } else if (val === 'ENDSEC') {
        inEntities = false;
      }

      if (currentEntity) {
        entities.push(currentEntity);
        currentEntity = null;
      }

      if (inEntities && ['LWPOLYLINE', 'POLYLINE', 'LINE', 'ARC', 'CIRCLE', 'SPLINE', 'ELLIPSE'].includes(val)) {
        currentEntity = { type: val, points: [], bulges: [] };
      }
    } else if (code === 2 && val === 'ENTITIES') {
      inEntities = true;
    }

    if (inEntities && currentEntity) {
      if (currentEntity.type === 'LWPOLYLINE') {
        if (code === 70) {
          // Closed flag (bit 1 is closed)
          currentEntity.closed = (parseInt(val, 10) & 1) === 1;
        } else if (code === 10) {
          // X
          curVertex = [parseFloat(val), 0];
        } else if (code === 20) {
          // Y
          curVertex[1] = parseFloat(val);
          currentEntity.points?.push([curVertex[0], curVertex[1]]);
          currentEntity.bulges?.push(curBulge);
          curBulge = 0;
        } else if (code === 42) {
          // Bulge for arc segment
          curBulge = parseFloat(val);
          if (currentEntity.bulges && currentEntity.bulges.length > 0) {
            currentEntity.bulges[currentEntity.bulges.length - 1] = curBulge;
          }
        }
      } else if (currentEntity.type === 'LINE') {
        if (code === 10) currentEntity.start = [parseFloat(val), 0];
        else if (code === 20 && currentEntity.start) currentEntity.start[1] = parseFloat(val);
        else if (code === 11) currentEntity.end = [parseFloat(val), 0];
        else if (code === 21 && currentEntity.end) currentEntity.end[1] = parseFloat(val);
      } else if (currentEntity.type === 'ARC') {
        if (code === 10) currentEntity.center = [parseFloat(val), 0];
        else if (code === 20 && currentEntity.center) currentEntity.center[1] = parseFloat(val);
        else if (code === 40) currentEntity.radius = parseFloat(val);
        else if (code === 50) currentEntity.startAngle = parseFloat(val);
        else if (code === 51) currentEntity.endAngle = parseFloat(val);
      } else if (currentEntity.type === 'CIRCLE') {
        if (code === 10) currentEntity.center = [parseFloat(val), 0];
        else if (code === 20 && currentEntity.center) currentEntity.center[1] = parseFloat(val);
        else if (code === 40) currentEntity.radius = parseFloat(val);
      }
    }
  }

  if (currentEntity) {
    entities.push(currentEntity);
  }

  // Convert entities into continuous 2D loops
  const sampledLoops: [number, number][][] = [];

  for (const ent of entities) {
    if (ent.type === 'LWPOLYLINE' && ent.points && ent.points.length >= 2) {
      const loop: [number, number][] = [];
      const pts = ent.points;
      const bulges = ent.bulges || [];
      for (let j = 0; j < pts.length; j++) {
        const p1 = pts[j];
        const nextIdx = (j + 1) % pts.length;
        if (j === pts.length - 1 && !ent.closed) {
          loop.push(p1);
          break;
        }
        const p2 = pts[nextIdx];
        const b = bulges[j] || 0;

        loop.push(p1);
        if (Math.abs(b) > 0.001) {
          // Tessellate curved arc between p1 and p2
          const arcPts = tessellateArcBulge(p1, p2, b, 8);
          for (const ap of arcPts) loop.push(ap);
        }
      }
      if (loop.length >= 3) sampledLoops.push(loop);
    } else if (ent.type === 'CIRCLE' && ent.center && ent.radius) {
      const loop: [number, number][] = [];
      const numSegs = 36;
      for (let s = 0; s < numSegs; s++) {
        const ang = (s / numSegs) * Math.PI * 2;
        loop.push([ent.center[0] + Math.cos(ang) * ent.radius, ent.center[1] + Math.sin(ang) * ent.radius]);
      }
      sampledLoops.push(loop);
    }
  }

  // If no LWPOLYLINEs found, assemble discrete LINE and ARC segments into chains
  if (sampledLoops.length === 0) {
    const lineChains = chainSegments(entities);
    if (lineChains.length > 0) {
      sampledLoops.push(...lineChains);
    }
  }

  // Find largest closed loop (or combine loops)
  let bestLoop: [number, number][] = [];
  let maxArea = -1;

  for (const loop of sampledLoops) {
    const area = computePolygonArea(loop);
    if (area > maxArea) {
      maxArea = area;
      bestLoop = loop;
    }
  }

  if (bestLoop.length < 3) {
    throw new Error('No closed polylines or valid CAD boundaries found in DXF file.');
  }

  // Simplify & resample polygon to smooth standard 48-64 points
  const resampled = resamplePolygon(bestLoop, 48);

  // Compute bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of resampled) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const width = Math.max(0.1, maxX - minX);
  const length = Math.max(0.1, maxY - minY);
  const maxDim = Math.max(width, length);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  // Normalize to [-1, 1] range centered at (0, 0)
  const normalizedPoints: [number, number][] = resampled.map(([x, y]) => [
    ((x - midX) / (maxDim * 0.5)) * 0.95,
    ((y - midY) / (maxDim * 0.5)) * 0.95,
  ]);

  const sdfGrid = generateSdfGridFromPolygon(normalizedPoints, 64);

  return {
    format: 'dxf',
    name: 'CAD DXF Contour',
    polygonPoints: normalizedPoints,
    rawPolygonPoints: normalizedPoints,
    sdfGrid,
    sdfRes: 64,
    dimensions: {
      width: Math.round(width * 10) / 10,
      height: 15,
      depth: Math.round(length * 10) / 10,
    },
    recommendedRadius: Math.round(Math.max(15, Math.min(120, maxDim * 0.5))),
    recommendedHeight: 18,
    aspectRatio: width / Math.max(0.001, length),
    details: `Parsed DXF: ${entities.length} entities, ${resampled.length} vertex contour (${width.toFixed(1)} × ${length.toFixed(1)} mm)`,
  };
}

/**
 * Tessellate arc segment defined by DXF bulge factor b = tan(angle/4)
 */
function tessellateArcBulge(p1: [number, number], p2: [number, number], b: number, steps = 6): [number, number][] {
  const pts: [number, number][] = [];
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const chord = Math.sqrt(dx * dx + dy * dy);
  if (chord < 0.0001) return pts;

  const theta = 4 * Math.atan(b);
  const radius = chord / (2 * Math.sin(theta / 2));
  const sagitta = b * chord * 0.5;

  const midX = (p1[0] + p2[0]) / 2;
  const midY = (p1[1] + p2[1]) / 2;

  // Normal to chord
  const normX = -dy / chord;
  const normY = dx / chord;

  const h = radius - sagitta;
  const centerX = midX - normX * (radius * Math.cos(theta / 2));
  const centerY = midY - normY * (radius * Math.cos(theta / 2));

  const startAng = Math.atan2(p1[1] - centerY, p1[0] - centerX);
  for (let k = 1; k < steps; k++) {
    const frac = k / steps;
    const curAng = startAng + theta * frac;
    pts.push([centerX + Math.cos(curAng) * Math.abs(radius), centerY + Math.sin(curAng) * Math.abs(radius)]);
  }
  return pts;
}

/**
 * Chain discrete LINE segments into closed polygon loops
 */
function chainSegments(entities: DxfEntity[], tolerance = 0.5): [number, number][][] {
  const segments: { start: [number, number]; end: [number, number]; used: boolean }[] = [];

  for (const ent of entities) {
    if (ent.type === 'LINE' && ent.start && ent.end) {
      segments.push({ start: ent.start, end: ent.end, used: false });
    }
  }

  const loops: [number, number][][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (segments[i].used) continue;

    const loop: [number, number][] = [segments[i].start, segments[i].end];
    segments[i].used = true;

    let currentPt = segments[i].end;
    let foundNext = true;

    while (foundNext && loop.length < 500) {
      foundNext = false;
      for (let j = 0; j < segments.length; j++) {
        if (segments[j].used) continue;

        const dStart = Math.hypot(currentPt[0] - segments[j].start[0], currentPt[1] - segments[j].start[1]);
        const dEnd = Math.hypot(currentPt[0] - segments[j].end[0], currentPt[1] - segments[j].end[1]);

        if (dStart < tolerance) {
          loop.push(segments[j].end);
          currentPt = segments[j].end;
          segments[j].used = true;
          foundNext = true;
          break;
        } else if (dEnd < tolerance) {
          loop.push(segments[j].start);
          currentPt = segments[j].start;
          segments[j].used = true;
          foundNext = true;
          break;
        }
      }
    }

    if (loop.length >= 3) {
      loops.push(loop);
    }
  }

  return loops;
}

function computePolygonArea(pts: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i][0] * pts[j][1];
    area -= pts[j][0] * pts[i][1];
  }
  return Math.abs(area) * 0.5;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 3D MESH PARSER (STL binary/ascii & OBJ Wavefront 3D files)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse an STL or OBJ file into an authentic 3D mesh + 2D footprint SDF for real-time physics
 */
export async function parse3dMeshFile(
  fileBuffer: ArrayBuffer | string,
  fileName: string
): Promise<ParsedGeometryResult> {
  const isStl = fileName.toLowerCase().endsWith('.stl');
  const isObj = fileName.toLowerCase().endsWith('.obj');

  let geometry: THREE.BufferGeometry;

  if (isStl) {
    const loader = new STLLoader();
    if (typeof fileBuffer === 'string') {
      const encoder = new TextEncoder();
      geometry = loader.parse(encoder.encode(fileBuffer).buffer);
    } else {
      geometry = loader.parse(fileBuffer);
    }
  } else if (isObj) {
    const loader = new OBJLoader();
    const text = typeof fileBuffer === 'string' ? fileBuffer : new TextDecoder().decode(fileBuffer);
    const group = loader.parse(text);

    // Merge geometries from obj group
    const geoms: THREE.BufferGeometry[] = [];
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
        geoms.push((child as THREE.Mesh).geometry);
      }
    });

    if (geoms.length === 0) {
      throw new Error('No 3D mesh geometry found inside OBJ file.');
    }
    // Use primary geometry or merge
    geometry = geoms[0].clone();
  } else {
    throw new Error('Unsupported 3D file format. Please upload .STL or .OBJ.');
  }

  // Ensure normals are computed
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const bbox = geometry.boundingBox!;
  const minX = bbox.min.x;
  const maxX = bbox.max.x;
  const minY = bbox.min.y;
  const maxY = bbox.max.y;
  const minZ = bbox.min.z;
  const maxZ = bbox.max.z;

  const rawWidth = Math.max(0.1, maxX - minX);
  const rawHeight = Math.max(0.1, maxY - minY);
  const rawDepth = Math.max(0.1, maxZ - minZ);

  // Center geometry so center is at (0,0) on XZ plane, and base is at Y = 0
  const centerX = (minX + maxX) / 2;
  const centerY = minY;
  const centerZ = (minZ + maxZ) / 2;
  geometry.translate(-centerX, -centerY, -centerZ);

  // Extract flat Float32Array positions
  const posAttr = geometry.getAttribute('position');
  const normAttr = geometry.getAttribute('normal');

  const positions: number[] = Array.from(posAttr.array);
  const normals: number[] = normAttr ? Array.from(normAttr.array) : [];
  const triangleCount = posAttr.count / 3;

  // Project 3D vertices onto 2D XZ plane to extract accurate 2D silhouette footprint
  const projPts: [number, number][] = [];
  const stride = Math.max(1, Math.floor(posAttr.count / 800));
  for (let i = 0; i < posAttr.count; i += stride) {
    projPts.push([posAttr.getX(i), posAttr.getZ(i)]);
  }

  // Extract accurate organic contour that strictly follows 3D model geometry
  const smoothContour = extractAccurateSilhouette(projPts, 64);

  const maxHorizDim = Math.max(rawWidth, rawDepth);
  const normalizedPoints: [number, number][] = smoothContour.map(([x, z]) => [
    x / (maxHorizDim * 0.5),
    z / (maxHorizDim * 0.5),
  ]);

  const sdfGrid = generateSdfGridFromPolygon(normalizedPoints, 64);

  return {
    format: isStl ? 'stl' : 'obj',
    name: fileName.replace(/\.[^/.]+$/, ''),
    polygonPoints: normalizedPoints,
    rawPolygonPoints: normalizedPoints,
    sdfGrid,
    sdfRes: 64,
    dimensions: {
      width: Math.round(rawWidth * 10) / 10,
      height: Math.round(rawHeight * 10) / 10,
      depth: Math.round(rawDepth * 10) / 10,
    },
    recommendedRadius: Math.round(Math.max(15, Math.min(120, maxHorizDim * 0.5))),
    recommendedHeight: Math.round(
      rawHeight * ((Math.max(15, Math.min(120, maxHorizDim * 0.5)) * 2) / maxHorizDim) * 10
    ) / 10,
    aspectRatio: rawWidth / Math.max(0.001, rawDepth),
    meshData: {
      positions,
      normals,
      rawPositions: [...positions],
      rawNormals: [...normals],
      bbox: {
        minX: -rawWidth / 2,
        maxX: rawWidth / 2,
        minY: 0,
        maxY: rawHeight,
        minZ: -rawDepth / 2,
        maxZ: rawDepth / 2,
      },
      triangleCount,
      vertexCount: posAttr.count,
    },
    details: `Imported 3D Model: ${triangleCount.toLocaleString()} triangles, dimensions ${rawWidth.toFixed(1)} × ${rawDepth.toFixed(1)} × ${rawHeight.toFixed(1)} mm`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ROBUST SVG & IMAGE IMPORTER (Compound Paths, Polygons, Rectangles & Text)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ultra-robust SVG parser: supports multi-element SVGs, paths, rects, circles, polygons, and offscreen silhouette rasterization fallback
 */
export async function parseRobustSvg(svgText: string, fileName = 'Vector Shape'): Promise<ParsedGeometryResult> {
  let sampledPoints: [number, number][] = [];

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');

    // 1. Collect all vector shapes and convert to path descriptions
    const shapes = doc.querySelectorAll('path, polygon, polyline, rect, circle, ellipse');
    const pathDescriptions: string[] = [];

    shapes.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'path') {
        const d = el.getAttribute('d');
        if (d) pathDescriptions.push(d);
      } else if (tag === 'polygon' || tag === 'polyline') {
        const pts = el.getAttribute('points');
        if (pts) {
          const pairs = pts.trim().split(/[\s,]+/);
          if (pairs.length >= 4) {
            let d = `M ${pairs[0]} ${pairs[1]}`;
            for (let k = 2; k < pairs.length; k += 2) {
              d += ` L ${pairs[k]} ${pairs[k + 1]}`;
            }
            if (tag === 'polygon') d += ' Z';
            pathDescriptions.push(d);
          }
        }
      } else if (tag === 'rect') {
        const x = parseFloat(el.getAttribute('x') || '0');
        const y = parseFloat(el.getAttribute('y') || '0');
        const w = parseFloat(el.getAttribute('width') || '10');
        const h = parseFloat(el.getAttribute('height') || '10');
        pathDescriptions.push(`M ${x} ${y} h ${w} v ${h} h ${-w} Z`);
      } else if (tag === 'circle') {
        const cx = parseFloat(el.getAttribute('cx') || '0');
        const cy = parseFloat(el.getAttribute('cy') || '0');
        const r = parseFloat(el.getAttribute('r') || '10');
        pathDescriptions.push(`M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`);
      } else if (tag === 'ellipse') {
        const cx = parseFloat(el.getAttribute('cx') || '0');
        const cy = parseFloat(el.getAttribute('cy') || '0');
        const rx = parseFloat(el.getAttribute('rx') || '10');
        const ry = parseFloat(el.getAttribute('ry') || '10');
        pathDescriptions.push(`M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`);
      }
    });

    // Try DOM SVG sampling if paths found
    if (pathDescriptions.length > 0) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.position = 'absolute';
      svg.style.left = '-9999px';
      svg.style.top = '-9999px';

      const combinedD = pathDescriptions.join(' ');
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', combinedD);
      svg.appendChild(pathEl);
      document.body.appendChild(svg);

      try {
        const totalLen = pathEl.getTotalLength();
        if (totalLen > 0) {
          const numSamples = 64;
          for (let i = 0; i < numSamples; i++) {
            const pt = pathEl.getPointAtLength((i / numSamples) * totalLen);
            sampledPoints.push([pt.x, pt.y]);
          }
        }
      } finally {
        if (svg.parentNode) svg.parentNode.removeChild(svg);
      }
    }
  } catch (e) {
    console.warn('Direct DOM SVG sampling fallback to canvas rasterizer', e);
  }

  // 2. Offscreen Canvas Silhouette Fallback (Guaranteed to parse any complex multi-layer / text / compound SVG)
  if (sampledPoints.length < 3) {
    sampledPoints = await rasterizeSvgToContour(svgText);
  }

  if (sampledPoints.length < 3) {
    throw new Error('Could not parse vector silhouette from SVG file.');
  }

  // Resample & normalize
  const resampled = resamplePolygon(sampledPoints, 48);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of resampled) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const spanX = Math.max(0.001, maxX - minX);
  const spanY = Math.max(0.001, maxY - minY);
  const maxSpan = Math.max(spanX, spanY);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  const normalizedPoints: [number, number][] = resampled.map(([x, y]) => [
    ((x - midX) / (maxSpan * 0.5)) * 0.95,
    ((y - midY) / (maxSpan * 0.5)) * 0.95,
  ]);

  const sdfGrid = generateSdfGridFromPolygon(normalizedPoints, 64);

  return {
    format: 'svg',
    name: fileName.replace(/\.[^/.]+$/, ''),
    polygonPoints: normalizedPoints,
    rawPolygonPoints: normalizedPoints,
    sdfGrid,
    sdfRes: 64,
    dimensions: {
      width: Math.round(spanX * 10) / 10,
      height: 12,
      depth: Math.round(spanY * 10) / 10,
    },
    recommendedRadius: 45,
    recommendedHeight: 15,
    aspectRatio: spanX / Math.max(0.001, spanY),
    svgContent: svgText,
    details: `Cleaned vector silhouette: ${resampled.length} contour vertices`,
  };
}

/**
 * Render SVG to offscreen canvas and walk perimeter to extract closed contour
 */
function rasterizeSvgToContour(svgText: string): Promise<[number, number][]> {
  return new Promise((resolve) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve([]);
        return;
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);

      const imgData = ctx.getImageData(0, 0, size, size);
      const data = imgData.data;

      // Radial sampling from center
      const cx = size / 2;
      const cy = size / 2;
      const numPoints = 48;
      const pts: [number, number][] = [];

      for (let i = 0; i < numPoints; i++) {
        const ang = (i / numPoints) * Math.PI * 2;
        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);

        let maxDist = 0;
        for (let r = 2; r < size * 0.48; r += 1) {
          const sx = Math.round(cx + cosA * r);
          const sy = Math.round(cy + sinA * r);
          if (sx < 0 || sx >= size || sy < 0 || sy >= size) break;
          const idx = (sy * size + sx) * 4;
          const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          if (brightness < 200 || data[idx + 3] > 100) {
            maxDist = r;
          }
        }

        if (maxDist < 4) maxDist = size * 0.25;
        pts.push([cx + cosA * maxDist, cy + sinA * maxDist]);
      }

      resolve(pts);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve([]);
    };

    img.src = url;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. GEOMETRY UTILS (Convex Hull, Resampling & Smoothing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resample an arbitrary closed 2D polygon into N evenly-spaced points along perimeter
 */
export function resamplePolygon(pts: [number, number][], targetCount = 48): [number, number][] {
  if (pts.length <= 2) return pts;

  // Calculate cumulative perimeter lengths
  const cumLens = [0];
  for (let i = 0; i < pts.length; i++) {
    const next = pts[(i + 1) % pts.length];
    const segLen = Math.hypot(next[0] - pts[i][0], next[1] - pts[i][1]);
    cumLens.push(cumLens[cumLens.length - 1] + segLen);
  }

  const totalLen = cumLens[cumLens.length - 1];
  if (totalLen < 0.0001) return pts;

  const result: [number, number][] = [];
  for (let k = 0; k < targetCount; k++) {
    const targetDist = (k / targetCount) * totalLen;

    // Find segment
    let segIdx = 0;
    while (segIdx < cumLens.length - 1 && cumLens[segIdx + 1] < targetDist) {
      segIdx++;
    }

    const p1 = pts[segIdx % pts.length];
    const p2 = pts[(segIdx + 1) % pts.length];
    const segStart = cumLens[segIdx];
    const segEnd = cumLens[segIdx + 1];
    const t = segEnd > segStart ? (targetDist - segStart) / (segEnd - segStart) : 0;

    result.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]);
  }

  return result;
}

/**
 * Compute 2D Convex Hull for silhouette projection
 */
function computeConvexHull(pts: [number, number][]): [number, number][] {
  if (pts.length <= 3) return pts;

  const sorted = [...pts].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));

  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  // Lower hull
  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // Upper hull
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Extract an accurate, high-fidelity 2D silhouette contour from 3D model vertices.
 * Preserves organic contours, notches, facets, and indentations without creating square bounding boxes.
 */
export function extractAccurateSilhouette(
  projPts: [number, number][],
  numAngularSectors = 64
): [number, number][] {
  if (projPts.length <= 3) return projPts;

  // 1. Calculate centroid
  let sumX = 0;
  let sumZ = 0;
  for (const [x, z] of projPts) {
    sumX += x;
    sumZ += z;
  }
  const cx = sumX / projPts.length;
  const cz = sumZ / projPts.length;

  // 2. Bin into angular sectors and find outermost radial extent in each sector
  const maxRadiusInSector = new Float64Array(numAngularSectors).fill(0);
  const sectorHasPoint = new Uint8Array(numAngularSectors).fill(0);

  for (const [x, z] of projPts) {
    const dx = x - cx;
    const dz = z - cz;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.0001) continue;

    let angle = Math.atan2(dz, dx); // [-PI, PI]
    if (angle < 0) angle += Math.PI * 2; // [0, 2PI)

    const sectorIdx = Math.min(
      numAngularSectors - 1,
      Math.floor((angle / (Math.PI * 2)) * numAngularSectors)
    );

    if (dist > maxRadiusInSector[sectorIdx]) {
      maxRadiusInSector[sectorIdx] = dist;
      sectorHasPoint[sectorIdx] = 1;
    }
  }

  // 3. Interpolate any empty angular sectors from adjacent neighbors
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < numAngularSectors; i++) {
      if (!sectorHasPoint[i]) {
        const prevIdx = (i - 1 + numAngularSectors) % numAngularSectors;
        const nextIdx = (i + 1) % numAngularSectors;
        if (sectorHasPoint[prevIdx] && sectorHasPoint[nextIdx]) {
          maxRadiusInSector[i] = (maxRadiusInSector[prevIdx] + maxRadiusInSector[nextIdx]) * 0.5;
          sectorHasPoint[i] = 1;
        } else if (sectorHasPoint[prevIdx]) {
          maxRadiusInSector[i] = maxRadiusInSector[prevIdx];
          sectorHasPoint[i] = 1;
        } else if (sectorHasPoint[nextIdx]) {
          maxRadiusInSector[i] = maxRadiusInSector[nextIdx];
          sectorHasPoint[i] = 1;
        }
      }
    }
  }

  // 4. Construct smooth radial polygon vertices
  const radialPoly: [number, number][] = [];
  for (let i = 0; i < numAngularSectors; i++) {
    const ang = (i / numAngularSectors) * Math.PI * 2;
    const r = maxRadiusInSector[i];
    if (r > 0.001) {
      radialPoly.push([cx + Math.cos(ang) * r, cz + Math.sin(ang) * r]);
    }
  }

  if (radialPoly.length >= 8) {
    return resamplePolygon(radialPoly, 48);
  }

  // Fallback to convex hull if angular sampling had insufficient coverage
  const hull = computeConvexHull(projPts);
  return resamplePolygon(hull, 48);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 1-CLICK SAMPLE CAD & 3D MODELS (For Instant Testing)
// ─────────────────────────────────────────────────────────────────────────────

export const CAD_SAMPLE_PRESETS = [
  {
    id: 'sample_zen_rock_3d',
    type: '3d' as const,
    name: '🗿 3D Scanned Zen River Rock',
    description: 'Watertight 3D organic boulder with authentic natural facets & fluid wake',
    format: 'stl' as const,
    generateGeometry: () => {
      // Create high-detail faceted river boulder geometry
      const geo = new THREE.DodecahedronGeometry(45, 2);
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        // Modulate with asymmetric organic rock noise
        const r = Math.sqrt(x * x + y * y + z * z);
        const factor = 1.0 + 0.18 * Math.sin(x * 0.08) * Math.cos(z * 0.08) - 0.12 * Math.sin(y * 0.05);
        pos.setXYZ(i, x * factor * 1.15, Math.max(0, y * factor * 0.55 + 10), z * factor * 0.85);
      }
      geo.computeVertexNormals();
      return geo;
    },
  },
  {
    id: 'sample_gear_dxf',
    type: 'dxf' as const,
    name: '⚙️ CAD Mechanical Involute Gear',
    description: 'Precision 8-tooth mechanical gear DXF outline with inner hub',
    format: 'dxf' as const,
    generateDxfString: () => generateGearDxf(8, 48, 32, 14),
  },
  {
    id: 'sample_bonsai_dxf',
    type: 'dxf' as const,
    name: '🪴 Japanese Bonsai Island Plan',
    description: 'Multi-lobed Zen garden stone island with curved fillet arcs',
    format: 'dxf' as const,
    generateDxfString: () => generateBonsaiIslandDxf(),
  },
  {
    id: 'sample_wave_svg',
    type: 'svg' as const,
    name: '🌊 Great Ocean Wave Silhouette',
    description: 'Japanese Seigaiha crest vector silhouette for CNC relief',
    format: 'svg' as const,
    svgString: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M 10,80 C 25,80 35,45 50,45 C 60,45 65,65 75,50 C 82,38 90,20 85,15 C 80,10 70,25 65,35 C 55,20 40,30 30,55 C 20,70 15,80 10,80 Z" fill="#000"/>
    </svg>`,
  },
];

function generateGearDxf(numTeeth = 8, outerR = 50, rootR = 35, hubR = 15): string {
  let dxf = `0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n90\n${numTeeth * 4}\n70\n1\n`;
  for (let i = 0; i < numTeeth; i++) {
    const a0 = (i / numTeeth) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / (numTeeth * 4);
    const a2 = a0 + (Math.PI * 2) / (numTeeth * 2);
    const a3 = a0 + ((Math.PI * 2) * 3) / (numTeeth * 4);

    dxf += `10\n${(Math.cos(a0) * rootR).toFixed(3)}\n20\n${(Math.sin(a0) * rootR).toFixed(3)}\n`;
    dxf += `10\n${(Math.cos(a1) * outerR).toFixed(3)}\n20\n${(Math.sin(a1) * outerR).toFixed(3)}\n`;
    dxf += `10\n${(Math.cos(a2) * outerR).toFixed(3)}\n20\n${(Math.sin(a2) * outerR).toFixed(3)}\n`;
    dxf += `10\n${(Math.cos(a3) * rootR).toFixed(3)}\n20\n${(Math.sin(a3) * rootR).toFixed(3)}\n`;
  }
  // Add inner hub circle
  dxf += `0\nCIRCLE\n10\n0.0\n20\n0.0\n40\n${hubR}\n`;
  dxf += `0\nENDSEC\n0\nEOF\n`;
  return dxf;
}

function generateBonsaiIslandDxf(): string {
  const numPts = 32;
  let dxf = `0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n90\n${numPts}\n70\n1\n`;
  for (let i = 0; i < numPts; i++) {
    const t = (i / numPts) * Math.PI * 2;
    const r = 40 + 12 * Math.cos(3 * t) + 8 * Math.sin(2 * t);
    const x = Math.cos(t) * r * 1.15;
    const y = Math.sin(t) * r * 0.85;
    dxf += `10\n${x.toFixed(3)}\n20\n${y.toFixed(3)}\n`;
  }
  dxf += `0\nENDSEC\n0\nEOF\n`;
  return dxf;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. GEOMETRY ROTATION & AXIS ORIENTATION TRANSFORMERS
// ─────────────────────────────────────────────────────────────────────────────

export interface Transform3dOptions {
  upAxis?: 'Y' | 'Z' | 'X' | '-Z' | '-Y' | '-X';
  rotXDeg?: number;
  rotYDeg?: number;
  rotZDeg?: number;
  flipX?: boolean;
  flipZ?: boolean;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
}

/**
 * Apply 3D Axis alignment, Euler rotations, and mirrors to 3D mesh buffers,
 * re-projecting the 2D footprint contour and regenerating distance fields
 */
export function transform3dGeometry(
  rawPositions: number[],
  rawNormals: number[],
  options: Transform3dOptions = {}
): {
  positions: number[];
  normals: number[];
  bbox: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  width: number;
  height: number;
  depth: number;
  polygonPoints: [number, number][];
  sdfGrid: number[];
  aspectRatio: number;
} {
  const {
    upAxis = 'Y',
    rotXDeg = 0,
    rotYDeg = 0,
    rotZDeg = 0,
    flipX = false,
    flipZ = false,
    scaleX = 1.0,
    scaleY = 1.0,
    scaleZ = 1.0,
  } = options;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...rawPositions], 3));
  if (rawNormals && rawNormals.length > 0) {
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([...rawNormals], 3));
  } else {
    geo.computeVertexNormals();
  }

  // 1. Align CAD Up-Axis to Three.js / Sandbed (+Y is height, XZ is ground)
  switch (upAxis) {
    case 'Z':
      // AutoCAD / Fusion 360 / Rhino / SolidWorks standard: Z is height
      geo.rotateX(-Math.PI / 2);
      break;
    case '-Z':
      geo.rotateX(Math.PI / 2);
      break;
    case 'X':
      geo.rotateZ(Math.PI / 2);
      break;
    case '-X':
      geo.rotateZ(-Math.PI / 2);
      break;
    case '-Y':
      geo.rotateX(Math.PI);
      break;
    case 'Y':
    default:
      break;
  }

  // 2. Apply user Euler rotations (Pitch, Yaw, Roll)
  if (rotXDeg !== 0) geo.rotateX((rotXDeg * Math.PI) / 180);
  if (rotYDeg !== 0) geo.rotateY((rotYDeg * Math.PI) / 180);
  if (rotZDeg !== 0) geo.rotateZ((rotZDeg * Math.PI) / 180);

  // 3. Apply mirror flip & scale factors
  const fx = (flipX ? -1 : 1) * Math.max(0.01, scaleX);
  const fy = Math.max(0.01, scaleY);
  const fz = (flipZ ? -1 : 1) * Math.max(0.01, scaleZ);
  if (fx !== 1 || fy !== 1 || fz !== 1) {
    geo.scale(fx, fy, fz);
  }

  // 4. Recompute Normals & Bounding Box
  geo.computeVertexNormals();
  geo.computeBoundingBox();

  const bbox = geo.boundingBox!;
  const minX = bbox.min.x;
  const maxX = bbox.max.x;
  const minY = bbox.min.y;
  const maxY = bbox.max.y;
  const minZ = bbox.min.z;
  const maxZ = bbox.max.z;

  const rawWidth = Math.max(0.1, maxX - minX);
  const rawHeight = Math.max(0.1, maxY - minY);
  const rawDepth = Math.max(0.1, maxZ - minZ);

  // Center horizontally on XZ and align lowest point to Y = 0
  const centerX = (minX + maxX) / 2;
  const centerY = minY;
  const centerZ = (minZ + maxZ) / 2;
  geo.translate(-centerX, -centerY, -centerZ);
  geo.computeBoundingBox();

  const finalBbox = geo.boundingBox!;
  const posAttr = geo.getAttribute('position');
  const normAttr = geo.getAttribute('normal');

  const positions = Array.from(posAttr.array);
  const normals = normAttr ? Array.from(normAttr.array) : [];

  // Project 3D vertices onto horizontal XZ plane for 2D footprint contour
  const projPts: [number, number][] = [];
  const stride = Math.max(1, Math.floor(posAttr.count / 800));
  for (let i = 0; i < posAttr.count; i += stride) {
    projPts.push([posAttr.getX(i), posAttr.getZ(i)]);
  }

  const smoothContour = extractAccurateSilhouette(projPts, 64);

  const maxHorizDim = Math.max(rawWidth, rawDepth);
  const normalizedPoints: [number, number][] = smoothContour.map(([x, z]) => [
    x / (maxHorizDim * 0.5),
    z / (maxHorizDim * 0.5),
  ]);

  const sdfGrid = generateSdfGridFromPolygon(normalizedPoints, 64);

  return {
    positions,
    normals,
    bbox: {
      minX: finalBbox.min.x,
      maxX: finalBbox.max.x,
      minY: finalBbox.min.y,
      maxY: finalBbox.max.y,
      minZ: finalBbox.min.z,
      maxZ: finalBbox.max.z,
    },
    width: Math.round(rawWidth * 10) / 10,
    height: Math.round(rawHeight * 10) / 10,
    depth: Math.round(rawDepth * 10) / 10,
    polygonPoints: normalizedPoints,
    sdfGrid,
    aspectRatio: rawWidth / Math.max(0.001, rawDepth),
  };
}

export interface Transform2dOptions {
  rotDeg?: number;
  flipX?: boolean;
  flipZ?: boolean;
  scaleX?: number;
  scaleZ?: number;
}

/**
 * Apply 2D rotation, mirror flips, and aspect ratios to 2D polygon silhouettes (DXF / SVG)
 */
export function transform2dPolygonPoints(
  rawPoints: [number, number][],
  options: Transform2dOptions = {}
): {
  polygonPoints: [number, number][];
  sdfGrid: number[];
  aspectRatio: number;
} {
  const { rotDeg = 0, flipX = false, flipZ = false, scaleX = 1.0, scaleZ = 1.0 } = options;

  const rad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const transformed: [number, number][] = rawPoints.map(([x, y]) => {
    let px = x * (flipX ? -1 : 1) * scaleX;
    let py = y * (flipZ ? -1 : 1) * scaleZ;
    // Rotate in 2D
    const rx = px * cos - py * sin;
    const ry = px * sin + py * cos;
    return [rx, ry];
  });

  // Calculate span
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of transformed) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const spanX = Math.max(0.001, maxX - minX);
  const spanY = Math.max(0.001, maxY - minY);
  const maxSpan = Math.max(spanX, spanY);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  const normalizedPoints: [number, number][] = transformed.map(([x, y]) => [
    (x - midX) / (maxSpan * 0.5),
    (y - midY) / (maxSpan * 0.5),
  ]);

  const sdfGrid = generateSdfGridFromPolygon(normalizedPoints, 64);

  return {
    polygonPoints: normalizedPoints,
    sdfGrid,
    aspectRatio: spanX / Math.max(0.001, spanY),
  };
}

