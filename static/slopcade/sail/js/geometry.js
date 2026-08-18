// geometry.js — all geometry is generated here at runtime: the ocean grid, the
// lofted hull, spars, sail, buoy, and the noise-shaped island. No imported meshes.

export const ISLAND_R = 22, ISLAND_LOWER = 1.0;
export const ISLAND_POS = { x: 26, z: -30 };

// ---- ocean grid (local x,z; displaced on the GPU) ---------------------------
export function buildOceanGrid(N, size) {
  const pos = new Float32Array(N * N * 2);
  const half = size / 2, step = size / (N - 1);
  let p = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      pos[p++] = -half + i * step;
      pos[p++] = -half + j * step;
    }
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  let q = 0;
  for (let j = 0; j < N - 1; j++)
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      idx[q++]=a; idx[q++]=c; idx[q++]=b;
      idx[q++]=b; idx[q++]=c; idx[q++]=d;
    }
  return { pos, idx, count: idx.length };
}

// ---- procedural lofted hull -------------------------------------------------
// Lofts station cross-sections along the keel -> a real sheer line and fine bow.
export function buildHull() {
  const STATIONS = 16, RING = 10;
  const L = 4.2, keelY = -0.42, deckY = 0.16;
  const rings = [];
  for (let s = 0; s < STATIONS; s++) {
    const t = s / (STATIONS - 1);          // 0 stern .. 1 bow
    const x = -L / 2 + t * L;
    const beam = 0.78 * Math.pow(Math.sin(Math.PI * Math.min(t * 1.04, 1.0)), 0.7)
                 * (0.55 + 0.45 * (1.0 - Math.pow(Math.abs(t - 0.42) * 1.7, 2)));
    const b = Math.max(beam, 0.02);
    const sheer = deckY + 0.10 * Math.pow(t, 2.2);
    const draft = keelY * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(t * 1.05, 1.0)));
    const ring = [];
    for (let r = 0; r < RING; r++) {
      const u = r / (RING - 1);
      const z = b * Math.pow(u, 0.72);
      const y = draft + (sheer - draft) * Math.pow(u, 1.35);
      ring.push([x, y, z]);
    }
    rings.push({ ring, x, sheer, draft });
  }
  const verts = [], faces = [];
  function add(x, y, z) { verts.push([x, y, z]); return verts.length - 1; }
  const grid = [];
  for (let s = 0; s < STATIONS; s++) {
    grid[s] = [];
    for (let r = 0; r < RING; r++) {
      const [x, y, z] = rings[s].ring[r];
      const sb = add(x, y, z);
      const pt = (z < 0.001) ? sb : add(x, y, -z);  // share keel centerline
      grid[s][r] = { sb, pt };
    }
  }
  for (let s = 0; s < STATIONS - 1; s++)
    for (let r = 0; r < RING - 1; r++) {
      const a = grid[s][r], b = grid[s][r + 1], c = grid[s + 1][r], d = grid[s + 1][r + 1];
      faces.push([a.sb, c.sb, b.sb], [b.sb, c.sb, d.sb]);   // starboard
      faces.push([a.pt, b.pt, c.pt], [b.pt, d.pt, c.pt]);   // port (reversed)
    }
  const top = RING - 1;
  for (let s = 0; s < STATIONS - 1; s++) {
    const a = grid[s][top], b = grid[s + 1][top];
    faces.push([a.sb, a.pt, b.sb], [b.sb, a.pt, b.pt]);     // deck
  }
  return finalizeMesh(verts, faces);
}

// ---- procedural spars + buoy as generated cylinders -------------------------
function cylinder(ax, ay, az, bx, by, bz, rad, seg, out) {
  const base = out.verts.length;
  const dx=bx-ax, dy=by-ay, dz=bz-az, len=Math.hypot(dx,dy,dz)||1;
  let ux=dx/len, uy=dy/len, uz=dz/len;
  let px=1, py=0, pz=0;
  if (Math.abs(uy) < 0.99) { px=0; py=1; pz=0; }
  let t1x=uy*pz-uz*py, t1y=uz*px-ux*pz, t1z=ux*py-uy*px;
  let t1l=Math.hypot(t1x,t1y,t1z)||1; t1x/=t1l; t1y/=t1l; t1z/=t1l;
  let t2x=uy*t1z-uz*t1y, t2y=uz*t1x-ux*t1z, t2z=ux*t1y-uy*t1x;
  for (let e = 0; e < 2; e++) {
    const ex=ax+dx*e, ey=ay+dy*e, ez=az+dz*e;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, ca=Math.cos(a), sa=Math.sin(a);
      out.verts.push([ ex + rad*(t1x*ca+t2x*sa), ey + rad*(t1y*ca+t2y*sa), ez + rad*(t1z*ca+t2z*sa) ]);
    }
  }
  for (let i = 0; i < seg; i++) {
    const i2 = (i + 1) % seg;
    const a0=base+i, a1=base+i2, b0=base+seg+i, b1=base+seg+i2;
    out.faces.push([a0, a1, b0], [a1, b1, b0]);
  }
}
export function buildSpars() {
  const out = { verts: [], faces: [] };
  cylinder(-0.25, 0.16, 0, -0.25, 2.5, 0, 0.045, 8, out);   // mast
  cylinder(-0.25, 0.55, 0, 1.55, 0.42, 0, 0.035, 6, out);   // boom toward bow
  return finalizeMesh(out.verts, out.faces);
}
export function buildBuoy() {
  const out = { verts: [], faces: [] };
  cylinder(0, -0.35, 0, 0, 1.0, 0, 0.07, 6, out);   // pole
  cylinder(0, 0.95, 0, 0, 1.35, 0, 0.24, 8, out);   // marker top
  return finalizeMesh(out.verts, out.faces);
}

// ---- procedural sail (billowed parametric surface) --------------------------
export function buildSail() {
  const NU = 10, NV = 8;
  const verts = [], faces = [];
  const mastX = -0.22, mastBase = 0.6, mastTop = 2.45, boomTip = 1.5, boomY = 0.5;
  for (let v = 0; v < NV; v++) {
    const tv = v / (NV - 1);
    for (let u = 0; u < NU; u++) {
      const tu = u / (NU - 1);
      const headTaper = 1.0 - tv;
      const x = mastX + (boomTip - mastX) * tu * headTaper;
      const y = mastBase + (mastTop - mastBase) * tv + (boomY - mastBase) * (1 - tv);
      const billow = Math.sin(tu * Math.PI) * Math.sin(tv * Math.PI) * 0.28 * headTaper;
      verts.push([x, y, billow]);
    }
  }
  for (let v = 0; v < NV - 1; v++)
    for (let u = 0; u < NU - 1; u++) {
      const a=v*NU+u, b=a+1, c=a+NU, d=c+1;
      faces.push([a,c,b],[b,c,d]);
    }
  return finalizeMesh(verts, faces);
}

// ---- procedural island heightfield (value-noise shaped coastline) -----------
export function hash2(i, j) { const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoiseJS(x, z) {
  const xi=Math.floor(x), zi=Math.floor(z), xf=x-xi, zf=z-zi;
  const u=xf*xf*(3-2*xf), v=zf*zf*(3-2*zf);
  const a=hash2(xi,zi), b=hash2(xi+1,zi), c=hash2(xi,zi+1), d=hash2(xi+1,zi+1);
  return a + (b-a)*u + (c-a)*v + (a-b-c+d)*u*v;
}
function fbmJS(x, z) { let s=0, amp=0.5, f=1; for (let i=0;i<4;i++){ s+=amp*vnoiseJS(x*f,z*f); f*=2.0; amp*=0.5; } return s; }
export function islandHeight(lx, lz) {
  const r = Math.hypot(lx, lz);
  const coast = ISLAND_R * (0.72 + 0.42 * fbmJS(lx*0.045 + 5.1, lz*0.045 - 2.3));
  const fall = Math.max(0, 1 - r / coast);
  let h = Math.pow(fall, 1.7) * 6.5;
  h += fbmJS(lx*0.16 + 1.0, lz*0.16 + 4.0) * fall * 2.2;
  return h;
}
export function buildIsland() {
  const N = 96, span = ISLAND_R * 1.7;
  const verts = [], faces = [];
  for (let j=0;j<N;j++) for (let i=0;i<N;i++) {
    const x = -span + 2*span*(i/(N-1)), z = -span + 2*span*(j/(N-1));
    verts.push([x, islandHeight(x,z) - ISLAND_LOWER, z]);
  }
  for (let j=0;j<N-1;j++) for (let i=0;i<N-1;i++) {
    const a=j*N+i, b=a+1, c=a+N, d=c+1;
    faces.push([a,c,b],[b,c,d]);
  }
  return finalizeMesh(verts, faces);
}

// ---- smooth normals + flatten to typed arrays -------------------------------
export function finalizeMesh(verts, faces) {
  const nrm = verts.map(() => [0,0,0]);
  for (const f of faces) {
    const [i0,i1,i2] = f;
    const a=verts[i0], b=verts[i1], c=verts[i2];
    const e1=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
    const e2=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    const n=[e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
    for (const i of f) { nrm[i][0]+=n[0]; nrm[i][1]+=n[1]; nrm[i][2]+=n[2]; }
  }
  const pos = new Float32Array(verts.length*3);
  const nor = new Float32Array(verts.length*3);
  for (let i=0;i<verts.length;i++){
    pos[i*3]=verts[i][0]; pos[i*3+1]=verts[i][1]; pos[i*3+2]=verts[i][2];
    const l=Math.hypot(nrm[i][0],nrm[i][1],nrm[i][2])||1;
    nor[i*3]=nrm[i][0]/l; nor[i*3+1]=nrm[i][1]/l; nor[i*3+2]=nrm[i][2]/l;
  }
  const idx = new Uint32Array(faces.length*3);
  for (let i=0;i<faces.length;i++){ idx[i*3]=faces[i][0]; idx[i*3+1]=faces[i][1]; idx[i*3+2]=faces[i][2]; }
  return { pos, nor, idx, count: idx.length, vcount: verts.length };
}
