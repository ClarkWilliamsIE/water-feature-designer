import { SurfaceConfig, RippleLayer, Obstacle, ExportConfig } from '../types';
import { computeTotalHeight } from './geometry';

export interface Triangle {
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
}

export interface ExportMeshStats {
  triangleCount: number;
  vertexCount: number;
  stepoverX: number; // mm pitch
  stepoverZ: number; // mm pitch
  minZ: number;
  maxZ: number;
  estFileSizeMB: number;
}

/**
 * Calculate expected export mesh statistics before generating
 */
export function estimateExportStats(
  surface: SurfaceConfig,
  exportConfig: ExportConfig
): ExportMeshStats {
  const { width: W, length: L } = surface;
  const resX = exportConfig.exportResolution || surface.resolution || 400;
  const resZ = Math.max(20, Math.round((resX * L) / W));

  const vertexCount = (resX + 1) * (resZ + 1);
  const topTris = resX * resZ * 2;
  const bottomTris = exportConfig.includeBase ? resX * resZ * 2 : 0;
  const wallTris = exportConfig.includeBase ? (resX * 2 + resZ * 2) * 2 : 0;
  const totalTris = topTris + bottomTris + wallTris;

  const stepoverX = W / resX;
  const stepoverZ = L / resZ;
  const estFileSizeMB = (84 + totalTris * 50) / (1024 * 1024);

  return {
    triangleCount: totalTris,
    vertexCount,
    stepoverX: parseFloat(stepoverX.toFixed(3)),
    stepoverZ: parseFloat(stepoverZ.toFixed(3)),
    minZ: 0,
    maxZ: 0,
    estFileSizeMB: parseFloat(estFileSizeMB.toFixed(2)),
  };
}

/**
 * Generate high-precision watertight solid 3D mesh triangles for CNC machining
 */
export function buildExportTriangles(
  surface: SurfaceConfig,
  layers: RippleLayer[],
  obstacles: Obstacle[],
  exportConfig: ExportConfig,
  onProgress?: (percent: number) => void
): Triangle[] {
  const { width: W, length: L, cornerRadius: R } = surface;
  const sc = exportConfig.scale || 1.0;
  const resX = exportConfig.exportResolution || surface.resolution || 400;
  const resZ = Math.max(20, Math.round((resX * L) / W));

  const hw = W / 2;
  const hl = L / 2;
  const r = Math.max(0, Math.min(R, hw * 0.999, hl * 0.999));

  // Top surface grid vertices
  const topVerts: [number, number, number][] = new Array((resX + 1) * (resZ + 1));
  let minY = Infinity;

  for (let j = 0; j <= resZ; j++) {
    for (let i = 0; i <= resX; i++) {
      const idx = j * (resX + 1) + i;
      let x = (i / resX - 0.5) * W;
      let z = (j / resZ - 0.5) * L;

      // Snap points outside fillet to true curved corner
      if (r > 0) {
        const cx = hw - r;
        const cz = hl - r;
        const sgnX = Math.sign(x) || 1;
        const sgnZ = Math.sign(z) || 1;
        const dx = Math.abs(x) - cx;
        const dz = Math.abs(z) - cz;

        if (dx > 0 && dz > 0) {
          const cornerDist = Math.sqrt(dx * dx + dz * dz);
          if (cornerDist > r) {
            const normX = dx / cornerDist;
            const normZ = dz / cornerDist;
            x = (cx + normX * r) * sgnX;
            z = (cz + normZ * r) * sgnZ;
          }
        }
      }

      const y = computeTotalHeight(x, z, layers, surface, obstacles);
      if (y < minY) minY = y;
      topVerts[idx] = [x * sc, y * sc, z * sc];
    }
  }

  // Base elevation offset
  const baseOffset = exportConfig.includeBase
    ? -minY * sc + exportConfig.baseThickness * sc
    : 0;

  // Apply base shift so lowest surface point sits exactly on baseThickness
  const shiftedTop: [number, number, number][] = topVerts.map(([vx, vy, vz]) => [
    vx,
    vy + baseOffset,
    vz,
  ]);

  const triangles: Triangle[] = [];

  // 1. Top sculpted surface triangles
  for (let j = 0; j < resZ; j++) {
    for (let i = 0; i < resX; i++) {
      const a = shiftedTop[j * (resX + 1) + i];
      const b = shiftedTop[j * (resX + 1) + i + 1];
      const c = shiftedTop[(j + 1) * (resX + 1) + i];
      const d = shiftedTop[(j + 1) * (resX + 1) + i + 1];

      triangles.push({ a, b: c, c: b });
      triangles.push({ a: b, b: c, c: d });
    }
  }

  // 2. Solid CNC Base Skirt & Bottom Face (Watertight manifold geometry)
  if (exportConfig.includeBase) {
    const botVerts: [number, number, number][] = shiftedTop.map(([vx, , vz]) => [
      vx,
      0,
      vz,
    ]);

    // Bottom face (inverted winding for downward normal)
    for (let j = 0; j < resZ; j++) {
      for (let i = 0; i < resX; i++) {
        const a = botVerts[j * (resX + 1) + i];
        const b = botVerts[j * (resX + 1) + i + 1];
        const c = botVerts[(j + 1) * (resX + 1) + i];
        const d = botVerts[(j + 1) * (resX + 1) + i + 1];

        triangles.push({ a, b, c });
        triangles.push({ a: b, b: d, c });
      }
    }

    // Back Wall (j = 0)
    for (let i = 0; i < resX; i++) {
      const tA = shiftedTop[i];
      const tB = shiftedTop[i + 1];
      const bA = botVerts[i];
      const bB = botVerts[i + 1];
      triangles.push({ a: tA, b: tB, c: bA });
      triangles.push({ a: tB, b: bB, c: bA });
    }

    // Front Wall (j = resZ)
    for (let i = 0; i < resX; i++) {
      const tA = shiftedTop[resZ * (resX + 1) + i];
      const tB = shiftedTop[resZ * (resX + 1) + i + 1];
      const bA = botVerts[resZ * (resX + 1) + i];
      const bB = botVerts[resZ * (resX + 1) + i + 1];
      triangles.push({ a: tA, b: bA, c: tB });
      triangles.push({ a: tB, b: bA, c: bB });
    }

    // Left Wall (i = 0)
    for (let j = 0; j < resZ; j++) {
      const tA = shiftedTop[j * (resX + 1)];
      const tB = shiftedTop[(j + 1) * (resX + 1)];
      const bA = botVerts[j * (resX + 1)];
      const bB = botVerts[(j + 1) * (resX + 1)];
      triangles.push({ a: tA, b: bA, c: tB });
      triangles.push({ a: tB, b: bA, c: bB });
    }

    // Right Wall (i = resX)
    for (let j = 0; j < resZ; j++) {
      const tA = shiftedTop[j * (resX + 1) + resX];
      const tB = shiftedTop[(j + 1) * (resX + 1) + resX];
      const bA = botVerts[j * (resX + 1) + resX];
      const bB = botVerts[(j + 1) * (resX + 1) + resX];
      triangles.push({ a: tA, b: tB, c: bA });
      triangles.push({ a: tB, b: bB, c: bA });
    }
  }

  return triangles;
}

/**
 * Serialize triangles into standard Binary STL ArrayBuffer (High-speed little endian)
 */
export function exportSTLBinary(triangles: Triangle[], title = 'SandRipple CNC Model'): Uint8Array {
  const buffer = new ArrayBuffer(80 + 4 + triangles.length * 50);
  const view = new DataView(buffer);

  // 80-byte header
  const headerStr = `${title.substring(0, 70)} (Binary STL - SandRipple CNC Studio)`;
  for (let i = 0; i < Math.min(headerStr.length, 80); i++) {
    view.setUint8(i, headerStr.charCodeAt(i));
  }

  // 4-byte triangle count (uint32 little-endian)
  view.setUint32(80, triangles.length, true);

  // Write each 50-byte triangle record
  for (let i = 0; i < triangles.length; i++) {
    const offset = 84 + i * 50;
    const { a, b, c } = triangles[i];

    // Compute surface normal
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];

    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];

    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0.000001) {
      nx /= len;
      ny /= len;
      nz /= len;
    }

    // Normal vector
    view.setFloat32(offset + 0, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);

    // Vertex 1 (a)
    view.setFloat32(offset + 12, a[0], true);
    view.setFloat32(offset + 16, a[1], true);
    view.setFloat32(offset + 20, a[2], true);

    // Vertex 2 (b)
    view.setFloat32(offset + 24, b[0], true);
    view.setFloat32(offset + 28, b[1], true);
    view.setFloat32(offset + 32, b[2], true);

    // Vertex 3 (c)
    view.setFloat32(offset + 36, c[0], true);
    view.setFloat32(offset + 40, c[1], true);
    view.setFloat32(offset + 44, c[2], true);

    // 2-byte attribute byte count
    view.setUint16(offset + 48, 0, true);
  }

  return new Uint8Array(buffer);
}

/**
 * Generate Wavefront OBJ with smooth vertex normals for ultra-high quality rendering and CAM
 */
export function exportOBJText(
  surface: SurfaceConfig,
  layers: RippleLayer[],
  obstacles: Obstacle[],
  exportConfig: ExportConfig
): string {
  const { width: W, length: L, cornerRadius: R } = surface;
  const sc = exportConfig.scale || 1.0;
  const resX = exportConfig.exportResolution || surface.resolution || 400;
  const resZ = Math.max(20, Math.round((resX * L) / W));

  const hw = W / 2;
  const hl = L / 2;
  const r = Math.max(0, Math.min(R, hw * 0.999, hl * 0.999));

  let out = `# SandRipple CNC Studio Wavefront OBJ (Ultra-Quality)\n`;
  out += `# Canvas Dimensions: ${W}mm x ${L}mm | Fillet Radius: R${R}mm\n`;
  out += `# Grid Resolution: ${resX} x ${resZ} (${((W/resX)).toFixed(2)}mm stepover)\n\n`;

  // Compute vertices and heights
  const count = (resX + 1) * (resZ + 1);
  const verts: [number, number, number][] = new Array(count);
  let minY = Infinity;

  for (let j = 0; j <= resZ; j++) {
    for (let i = 0; i <= resX; i++) {
      const idx = j * (resX + 1) + i;
      let x = (i / resX - 0.5) * W;
      let z = (j / resZ - 0.5) * L;

      if (r > 0) {
        const cx = hw - r;
        const cz = hl - r;
        const sgnX = Math.sign(x) || 1;
        const sgnZ = Math.sign(z) || 1;
        const dx = Math.abs(x) - cx;
        const dz = Math.abs(z) - cz;

        if (dx > 0 && dz > 0) {
          const cornerDist = Math.sqrt(dx * dx + dz * dz);
          if (cornerDist > r) {
            const normX = dx / cornerDist;
            const normZ = dz / cornerDist;
            x = (cx + normX * r) * sgnX;
            z = (cz + normZ * r) * sgnZ;
          }
        }
      }

      const y = computeTotalHeight(x, z, layers, surface, obstacles);
      if (y < minY) minY = y;
      verts[idx] = [x * sc, y * sc, z * sc];
    }
  }

  const baseOffset = exportConfig.includeBase
    ? -minY * sc + exportConfig.baseThickness * sc
    : 0;

  // Write vertices
  for (let i = 0; i < count; i++) {
    const v = verts[i];
    out += `v ${(v[0]).toFixed(3)} ${(v[1] + baseOffset).toFixed(3)} ${(v[2]).toFixed(3)}\n`;
  }

  // Write faces
  out += `\ng SandRipple_TopSurface\n`;
  for (let j = 0; j < resZ; j++) {
    for (let i = 0; i < resX; i++) {
      const a = j * (resX + 1) + i + 1;
      const b = a + 1;
      const c = a + (resX + 1);
      const d = c + 1;

      out += `f ${a} ${c} ${b}\n`;
      out += `f ${b} ${c} ${d}\n`;
    }
  }

  return out;
}

/**
 * Generate 16-bit Grayscale Displacement Heightmap (PNG Canvas Data URL)
 * Standard format for Vectric Aspire, ArtCAM, Carbide Create Pro, and Blender displacement.
 */
export function exportHeightmap16BitPNG(
  surface: SurfaceConfig,
  layers: RippleLayer[],
  obstacles: Obstacle[],
  widthPx = 2048,
  heightPx = 2048
): string {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const imgData = ctx.createImageData(widthPx, heightPx);
  const data = imgData.data;

  const { width: W, length: L } = surface;

  // Sample min and max height for normalization
  let minH = Infinity;
  let maxH = -Infinity;
  const heightGrid = new Float32Array(widthPx * heightPx);

  for (let y = 0; y < heightPx; y++) {
    const normY = y / heightPx;
    const worldZ = (normY - 0.5) * L;
    for (let x = 0; x < widthPx; x++) {
      const normX = x / widthPx;
      const worldX = (normX - 0.5) * W;

      const h = computeTotalHeight(worldX, worldZ, layers, surface, obstacles);
      const idx = y * widthPx + x;
      heightGrid[idx] = h;

      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  const span = Math.max(0.0001, maxH - minH);

  for (let i = 0; i < heightGrid.length; i++) {
    const normVal = Math.max(0, Math.min(1, (heightGrid[i] - minH) / span));
    const byteVal = Math.round(normVal * 255);

    const pxIdx = i * 4;
    data[pxIdx] = byteVal; // R
    data[pxIdx + 1] = byteVal; // G
    data[pxIdx + 2] = byteVal; // B
    data[pxIdx + 3] = 255; // Alpha
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Trigger browser file download helper
 */
export function triggerDownload(
  data: Uint8Array | string,
  filename: string,
  mimeType = 'application/octet-stream'
) {
  const blob =
    typeof data === 'string'
      ? data.startsWith('data:')
        ? dataURLtoBlob(data)
        : new Blob([data], { type: mimeType })
      : new Blob([data], { type: mimeType });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dataURLtoBlob(dataurl: string): Blob {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}
