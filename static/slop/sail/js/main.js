// main.js — entry point. Wires the generated geometry, shaders and shared wave
// spectrum into a WebGL2 renderer + sailing sim. CPU buoyancy samples the SAME
// spectrum that displaces the GPU surface ("two views of one spectrum").

import { M4 } from './math.js';
import { WIND_ANGLE, WAVE_DEFS, STEEP, precomputeWaves, waveHeight } from './waves.js';
import {
  ISLAND_LOWER, ISLAND_POS,
  buildOceanGrid, buildHull, buildSpars, buildSail, buildBuoy, buildIsland,
  islandHeight, hash2,
} from './geometry.js';
import { buildShaders } from './shaders.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function boot() {
  const canvas = document.getElementById('gl');
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) { document.getElementById('fail').style.display = 'grid'; return; }

  const waves = precomputeWaves(WAVE_DEFS, WIND_ANGLE);
  const waveA = new Float32Array(waves.length * 4), waveB = new Float32Array(waves.length * 4);
  waves.forEach((w, i) => { waveA.set([w.dx, w.dz, w.A, w.k], i*4); waveB.set([w.w, w.Q, w.phase, 0], i*4); });

  const S = buildShaders(waves.length);

  function sh(type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){ console.error(gl.getShaderInfoLog(s), src); throw 'shader'; } return s; }
  function prog(vs, fs){ const p=gl.createProgram(); gl.attachShader(p,sh(gl.VERTEX_SHADER,vs)); gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs));
    gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)){ console.error(gl.getProgramInfoLog(p)); throw 'link'; } return p; }
  function loc(p, names){ const o={}; names.forEach(n=>o[n]=gl.getUniformLocation(p,n)); return o; }

  let pOcean, pSolid, pSky, pWake, pIsland;
  try {
    pOcean = prog(S.VS_OCEAN, S.FS_OCEAN);
    pSolid = prog(S.VS_SOLID, S.FS_SOLID);
    pSky   = prog(S.VS_SKY, S.FS_SKY);
    pWake  = prog(S.VS_WAKE, S.FS_WAKE);
    pIsland= prog(S.VS_ISLAND, S.FS_ISLAND);
  } catch(e){ document.getElementById('fail').style.display='grid'; return; }

  const uO = loc(pOcean, ['uProj','uView','uOffset','uTime','uWaveA','uWaveB','uSun','uCam','uDeep','uCrest','uFoam','uLight','uShadow','uSkyH']);
  const uS = loc(pSolid, ['uProj','uView','uModel','uSun','uColor','uLight','uShadow','uCam']);
  const uK = loc(pSky, ['uSkyTop','uSkyH']);
  const uW = loc(pWake, ['uProj','uView','uFoam']);
  const uI = loc(pIsland, ['uProj','uView','uModel','uSun','uLight','uShadow','uCam','uFoam','uSkyH']);

  function buf(data, target){ const b=gl.createBuffer(); target=target||gl.ARRAY_BUFFER; gl.bindBuffer(target,b); gl.bufferData(target,data,gl.STATIC_DRAW); return b; }

  const ocean = buildOceanGrid(176, 240);
  const oVbo = buf(ocean.pos), oIbo = buf(ocean.idx, gl.ELEMENT_ARRAY_BUFFER);
  const oVao = gl.createVertexArray(); gl.bindVertexArray(oVao);
  gl.bindBuffer(gl.ARRAY_BUFFER,oVbo); const aXZ=gl.getAttribLocation(pOcean,'aXZ');
  gl.enableVertexAttribArray(aXZ); gl.vertexAttribPointer(aXZ,2,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,oIbo); gl.bindVertexArray(null);

  function makeSolidVao(mesh, program){
    program = program || pSolid;
    const vbo=buf(mesh.pos), nbo=buf(mesh.nor), ibo=buf(mesh.idx, gl.ELEMENT_ARRAY_BUFFER);
    const vao=gl.createVertexArray(); gl.bindVertexArray(vao);
    const ap=gl.getAttribLocation(program,'aPos'), an=gl.getAttribLocation(program,'aNormal');
    gl.bindBuffer(gl.ARRAY_BUFFER,vbo); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,nbo); gl.enableVertexAttribArray(an); gl.vertexAttribPointer(an,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ibo); gl.bindVertexArray(null);
    return { vao, count: mesh.count };
  }
  const hullMesh = buildHull(), sparMesh = buildSpars(), sailMesh = buildSail(), buoyMesh = buildBuoy(), islandMesh = buildIsland();
  const hull = makeSolidVao(hullMesh), spar = makeSolidVao(sparMesh), sail = makeSolidVao(sailMesh), buoy = makeSolidVao(buoyMesh);
  const island = makeSolidVao(islandMesh, pIsland);

  // wake ribbon: dynamic, rebuilt each frame from boat position history
  const WAKE_MAX = 140;
  const wakeArr = new Float32Array(WAKE_MAX * 2 * 4);
  const wakeVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, wakeVbo); gl.bufferData(gl.ARRAY_BUFFER, wakeArr.byteLength, gl.DYNAMIC_DRAW);
  const wakeVao = gl.createVertexArray(); gl.bindVertexArray(wakeVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, wakeVbo);
  const aWp = gl.getAttribLocation(pWake,'aPos'), aWa = gl.getAttribLocation(pWake,'aA');
  gl.enableVertexAttribArray(aWp); gl.vertexAttribPointer(aWp,3,gl.FLOAT,false,16,0);
  gl.enableVertexAttribArray(aWa); gl.vertexAttribPointer(aWa,1,gl.FLOAT,false,16,12);
  gl.bindVertexArray(null);
  const wake = [];

  const skyVbo = buf(new Float32Array([-1,-1, 3,-1, -1,3]));
  const skyVao = gl.createVertexArray(); gl.bindVertexArray(skyVao);
  gl.bindBuffer(gl.ARRAY_BUFFER,skyVbo); const aSky=gl.getAttribLocation(pSky,'aPos');
  gl.enableVertexAttribArray(aSky); gl.vertexAttribPointer(aSky,2,gl.FLOAT,false,0,0); gl.bindVertexArray(null);

  const totalVerts = ocean.pos.length/2 + hullMesh.vcount + sparMesh.vcount + sailMesh.vcount + buoyMesh.vcount + islandMesh.vcount;

  const COL = {
    deep:[0.15,0.29,0.30], crest:[0.44,0.60,0.55], foam:[0.93,0.89,0.81],
    light:[1.0,0.95,0.84], shadow:[0.33,0.42,0.45], skyTop:[0.61,0.71,0.69], skyH:[0.91,0.86,0.76],
    hull:[0.40,0.24,0.15], deck:[0.62,0.45,0.28], spar:[0.20,0.13,0.09], sail:[0.90,0.86,0.78],
  };
  const sun = (()=>{ const e=0.5,a=2.2; return [Math.cos(e)*Math.cos(a), Math.sin(e), Math.cos(e)*Math.sin(a)]; })();

  // ---- sim state ----
  const boat = { x:0, z:0, yaw:0, speed:0, sail:0.6, y:0, pitch:0, roll:0, boom:0 };
  const wind = { angle: WIND_ANGLE, dir:[Math.cos(WIND_ANGLE), Math.sin(WIND_ANGLE)], speed:1.0 };

  // wind is configurable at runtime; waves re-orient AND change sea state with it
  function rebuildWaves(){
    const s = wind.speed;
    const amp = Math.min(1.8, Math.pow(s, 0.75));               // wave height grows with wind
    const hf  = Math.min(1.1, Math.max(0, s - 0.6) * 0.45);     // windier => choppier short waves
    const base = precomputeWaves(WAVE_DEFS, wind.angle);
    waves.length = 0;
    base.forEach((w,i)=>{
      const t = i/(base.length-1);
      const A = w.A * amp * (1 + hf*t);
      const Q = Math.min(1.0, STEEP*(0.8 + 0.45*Math.min(s,2.2)) / (w.k * A * base.length));
      waves.push({ dx:w.dx, dz:w.dz, A, k:w.k, w:w.w, Q, phase:w.phase });
    });
    waves.forEach((w,i)=>{ waveA.set([w.dx,w.dz,w.A,w.k], i*4); waveB.set([w.w,w.Q,w.phase,0], i*4); });
  }
  function setWind(angle){ wind.angle = angle; wind.dir = [Math.cos(angle), Math.sin(angle)]; rebuildWaves(); }

  // boat-local starboard (right) in (x,z); used by the compass, the drag inverse,
  // and the sail trim so they all agree with the world the waves live in.
  const starboard = (yaw) => [-(-Math.sin(yaw)), Math.cos(yaw)];  // = [sin yaw, cos yaw]

  const wsvg = document.getElementById('windsvg');
  let windDrag = false;
  function setWindFromPointer(e){
    const r = wsvg.getBoundingClientRect();
    const cx = e.clientX - (r.left + r.width/2), cy = e.clientY - (r.top + r.height/2);
    const len = Math.hypot(cx, cy); if (len < 1) return;
    const wr = cx/len, wf = -cy/len;                       // invert the compass display mapping
    const f2 = [Math.cos(boat.yaw), -Math.sin(boat.yaw)];
    const fr = starboard(boat.yaw);
    setWind(Math.atan2(wf*f2[1] + wr*fr[1], wf*f2[0] + wr*fr[0]));
  }
  if (wsvg){
    wsvg.addEventListener('pointerdown', e=>{ windDrag=true; try{ wsvg.setPointerCapture(e.pointerId); }catch(_){} setWindFromPointer(e); e.preventDefault(); });
    wsvg.addEventListener('pointermove', e=>{ if(windDrag){ setWindFromPointer(e); e.preventDefault(); } });
    wsvg.addEventListener('pointerup',   ()=>{ windDrag=false; });
    wsvg.addEventListener('pointercancel',()=>{ windDrag=false; });
  }
  const wspdEl = document.getElementById('w-speed'), wspdTxt = document.getElementById('w-spd');
  if (wspdEl) wspdEl.addEventListener('input', ()=>{ wind.speed = parseFloat(wspdEl.value); if(wspdTxt) wspdTxt.textContent = wind.speed.toFixed(1); rebuildWaves(); });
  if (wspdTxt) wspdTxt.textContent = wind.speed.toFixed(1);
  rebuildWaves();   // apply initial sea state

  const keys = {};
  addEventListener('keydown', e=>{ keys[e.key.toLowerCase()]=true; if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault(); });
  addEventListener('keyup', e=>{ keys[e.key.toLowerCase()]=false; });
  const touch = { left:false, right:false, up:false, down:false };
  function bindHold(id, prop){ const el=document.getElementById(id); if(!el) return;
    el.addEventListener('pointerdown', e=>{ touch[prop]=true; e.preventDefault(); });
    el.addEventListener('pointerup',   ()=>{ touch[prop]=false; });
    el.addEventListener('pointercancel',()=>{ touch[prop]=false; });
    el.addEventListener('pointerleave',()=>{ touch[prop]=false; });
  }
  bindHold('t-left','left'); bindHold('t-right','right'); bindHold('t-up','up'); bindHold('t-down','down');
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.body.classList.add('touch');

  const hullPts = [[1.9,0,0],[-1.9,0,0],[0,0,0.55],[0,0,-0.55]]; // bow,stern,stbd,port (local)
  const HUD = { speed:document.getElementById('h-speed'), pos:document.getElementById('h-pos'),
    power:document.getElementById('h-power'), verts:document.getElementById('h-verts'),
    fps:document.getElementById('h-fps'), ms:document.getElementById('h-ms'),
    tris:document.getElementById('h-tris'), draws:document.getElementById('h-draws'),
    wind:document.getElementById('w-arrow') };
  if (HUD.verts) HUD.verts.textContent = totalVerts.toLocaleString();

  let time=0, last=performance.now();
  let drawCalls=0, tris=0, fpsCount=0, fpsT=0;

  function update(dt){
    time += dt;
    let rudder = ((keys['a']||keys['arrowleft']||touch.left)?1:0) - ((keys['d']||keys['arrowright']||touch.right)?1:0);
    boat.sail += (((keys['w']||keys['arrowup']||touch.up)?1:0) - ((keys['s']||keys['arrowdown']||touch.down)?1:0)) * dt * 0.7;
    boat.sail = Math.min(1, Math.max(0, boat.sail));
    const fwd = [Math.cos(boat.yaw), -Math.sin(boat.yaw)];
    const wn = Math.hypot(wind.dir[0],wind.dir[1])||1;
    const wd = [wind.dir[0]/wn, wind.dir[1]/wn];
    const pointing = fwd[0]*wd[0] + fwd[1]*wd[1];     // 1 dead downwind, -1 dead upwind
    // polar model: true wind angle 0 = in irons, 180 = dead run; speed peaks on the reach
    const twa = Math.acos(Math.max(-1, Math.min(1, -pointing))) * 180/Math.PI;
    let polar = 0;
    if (twa > 43) {
      const rise = smooth(43, 72, twa);
      const reach = Math.exp(-Math.pow((twa - 105) / 52, 2));
      polar = rise * (0.58 + 0.42 * reach);
    }
    const thrust = polar * boat.sail * wind.speed * 4.6;
    boat.speed += (thrust - boat.speed*1.3) * dt;
    boat.speed = Math.max(0, boat.speed);
    boat.yaw += rudder * 1.4 * dt * Math.min(1, 0.25 + boat.speed*0.25);
    boat.x += fwd[0]*boat.speed*dt;
    boat.z += fwd[1]*boat.speed*dt;
    // island collision: if the boat reaches the shallows, push it back to deep water
    {
      const lx = boat.x - ISLAND_POS.x, lz = boat.z - ISLAND_POS.z;
      if (islandHeight(lx, lz) - ISLAND_LOWER > -0.7) {
        const r = Math.hypot(lx, lz) || 1, nx = lx/r, nz = lz/r;
        let px = boat.x, pz = boat.z, guard = 0;
        while (islandHeight(px - ISLAND_POS.x, pz - ISLAND_POS.z) - ISLAND_LOWER > -0.7 && guard++ < 28) { px += nx*0.5; pz += nz*0.5; }
        boat.x = px; boat.z = pz; boat.speed *= 0.25;
      }
    }
    // natural sail trim: boom falls to the lee (starboard/port) side, damped
    const fr = starboard(boat.yaw);
    const localR = wd[0]*fr[0] + wd[1]*fr[1];
    const tBoom = (pointing + 1) * 0.5;
    const targetBoom = (localR >= 0 ? 1 : -1) * (0.18 + tBoom * 1.25);
    boat.boom += (targetBoom - boat.boom) * Math.min(1, dt * 3.0);
    // wake history
    wake.push({ x: boat.x - fwd[0]*1.9, z: boat.z - fwd[1]*1.9, rx: fwd[1], rz: -fwd[0], age: 0, a0: Math.min(1, boat.speed/2.4) });
    for (const wp of wake) wp.age += dt;
    while (wake.length && wake[0].age > 2.0) wake.shift();
    if (wake.length > WAKE_MAX) wake.splice(0, wake.length - WAKE_MAX);
    // buoyancy: sample the SAME spectrum at hull points
    const ws=[];
    for(const p of hullPts){
      const wx = boat.x + Math.cos(boat.yaw)*p[0] - Math.sin(boat.yaw)*p[2];
      const wz = boat.z - Math.sin(boat.yaw)*p[0] - Math.cos(boat.yaw)*p[2];
      ws.push(waveHeight(waves, wx, wz, time));
    }
    const tgtY = (ws[0]+ws[1]+ws[2]+ws[3])/4 + 0.12;
    const tgtPitch = Math.atan2(ws[0]-ws[1], 3.8) * 0.9;
    const tgtRoll  = Math.atan2(ws[2]-ws[3], 1.1) * 0.7;
    boat.y += (tgtY - boat.y) * Math.min(1, dt*8);
    boat.pitch += (tgtPitch - boat.pitch) * Math.min(1, dt*6);
    boat.roll  += (tgtRoll  - boat.roll)  * Math.min(1, dt*6);
    if(HUD.speed) HUD.speed.textContent = boat.speed.toFixed(1);
    if(HUD.power) HUD.power.textContent = Math.round(boat.sail*100) + '%';
    if(HUD.pos){ HUD.pos.textContent = polar < 0.02 ? 'no-go' :
      ((twa < 72 ? 'close-hauled' : twa < 110 ? 'reach' : twa < 150 ? 'broad reach' : 'running')
       + ' \u00b7 ' + Math.round(polar*100) + '%'); }
  }

  function render(){
    const w=canvas.width, h=canvas.height;
    gl.viewport(0,0,w,h);
    drawCalls=0; tris=0;
    const fwd=[Math.cos(boat.yaw),0,-Math.sin(boat.yaw)];
    const eye=[boat.x-fwd[0]*9, boat.y+4.2, boat.z-fwd[2]*9];
    const ctr=[boat.x+fwd[0]*2, boat.y+0.8, boat.z+fwd[2]*2];
    const proj=M4.perspective(1.05, w/h, 0.1, 400);
    const view=M4.lookAt(eye, ctr, [0,1,0]);

    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(pSky); gl.bindVertexArray(skyVao);
    gl.uniform3fv(uK.uSkyTop, COL.skyTop); gl.uniform3fv(uK.uSkyH, COL.skyH);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.enable(gl.DEPTH_TEST);

    gl.useProgram(pOcean); gl.bindVertexArray(oVao);
    gl.uniformMatrix4fv(uO.uProj,false,proj); gl.uniformMatrix4fv(uO.uView,false,view);
    gl.uniform2f(uO.uOffset, Math.round(boat.x), Math.round(boat.z));
    gl.uniform1f(uO.uTime, time);
    gl.uniform4fv(uO.uWaveA, waveA); gl.uniform4fv(uO.uWaveB, waveB);
    gl.uniform3fv(uO.uSun, sun); gl.uniform3fv(uO.uCam, eye);
    gl.uniform3fv(uO.uDeep,COL.deep); gl.uniform3fv(uO.uCrest,COL.crest); gl.uniform3fv(uO.uFoam,COL.foam);
    gl.uniform3fv(uO.uLight,COL.light); gl.uniform3fv(uO.uShadow,COL.shadow); gl.uniform3fv(uO.uSkyH,COL.skyH);
    gl.drawElements(gl.TRIANGLES, ocean.count, gl.UNSIGNED_INT, 0);
    drawCalls++; tris += ocean.count/3;

    if (wake.length >= 2) {
      let n = 0;
      for (let i = 0; i < wake.length; i++) {
        const wp = wake[i];
        const y = waveHeight(waves, wp.x, wp.z, time) + 0.05;
        const hw = 0.35 + wp.age * 0.6;
        const av = Math.max(0, wp.a0 * (1 - wp.age / 2.0)) * 0.6;
        wakeArr[n++]=wp.x+wp.rx*hw; wakeArr[n++]=y; wakeArr[n++]=wp.z+wp.rz*hw; wakeArr[n++]=av;
        wakeArr[n++]=wp.x-wp.rx*hw; wakeArr[n++]=y; wakeArr[n++]=wp.z-wp.rz*hw; wakeArr[n++]=av;
      }
      gl.useProgram(pWake); gl.bindVertexArray(wakeVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, wakeVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, wakeArr.subarray(0, wake.length*2*4));
      gl.uniformMatrix4fv(uW.uProj,false,proj); gl.uniformMatrix4fv(uW.uView,false,view); gl.uniform3fv(uW.uFoam, COL.foam);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, wake.length*2);
      gl.depthMask(true); gl.disable(gl.BLEND);
      drawCalls++; tris += wake.length*2 - 2;
    }

    const model = M4.mulAll(M4.translation(boat.x, boat.y, boat.z), M4.rotY(boat.yaw), M4.rotX(boat.pitch), M4.rotZ(boat.roll));
    gl.useProgram(pSolid);
    gl.uniformMatrix4fv(uS.uProj,false,proj); gl.uniformMatrix4fv(uS.uView,false,view);
    gl.uniform3fv(uS.uSun,sun); gl.uniform3fv(uS.uLight,COL.light); gl.uniform3fv(uS.uShadow,COL.shadow); gl.uniform3fv(uS.uCam,eye);
    function drawPart(part, m, color){ gl.uniformMatrix4fv(uS.uModel,false,m); gl.uniform3fv(uS.uColor,color);
      gl.bindVertexArray(part.vao); gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_INT, 0);
      drawCalls++; tris += part.count/3; }
    drawPart(hull, model, COL.hull);
    drawPart(spar, model, COL.spar);
    const reef = 0.32 + 0.68 * boat.sail;
    const tx = -0.22, ty = 0.6;
    const sailModel = M4.mulAll(model,
      M4.translation(-0.22,0,0), M4.rotY(boat.boom), M4.translation(0.22,0,0),
      M4.translation(tx,ty,0), M4.scale(reef,reef,reef), M4.translation(-tx,-ty,0));
    drawPart(sail, sailModel, COL.sail);

    // buoy field
    const D=26, R=115;
    gl.bindVertexArray(buoy.vao); gl.uniform3fv(uS.uColor, [0.76,0.30,0.18]);
    for (let gi=Math.floor((boat.x-R)/D); gi<=Math.ceil((boat.x+R)/D); gi++)
      for (let gj=Math.floor((boat.z-R)/D); gj<=Math.ceil((boat.z+R)/D); gj++){
        const bx=gi*D + (hash2(gi,gj)-0.5)*15, bz=gj*D + (hash2(gi+7.3,gj-3.1)-0.5)*15;
        const dx=bx-boat.x, dz=bz-boat.z; if(dx*dx+dz*dz > R*R) continue;
        const by=waveHeight(waves,bx,bz,time);
        const m=M4.mulAll(M4.translation(bx,by,bz), M4.rotZ(Math.sin(time*0.8+gi)*0.07), M4.rotX(Math.cos(time*0.7+gj)*0.05));
        gl.uniformMatrix4fv(uS.uModel,false,m);
        gl.drawElements(gl.TRIANGLES, buoy.count, gl.UNSIGNED_INT, 0);
        drawCalls++; tris += buoy.count/3;
      }
    gl.bindVertexArray(null);

    // island
    gl.useProgram(pIsland);
    const im = M4.translation(ISLAND_POS.x, 0, ISLAND_POS.z);
    gl.uniformMatrix4fv(uI.uProj,false,proj); gl.uniformMatrix4fv(uI.uView,false,view); gl.uniformMatrix4fv(uI.uModel,false,im);
    gl.uniform3fv(uI.uSun,sun); gl.uniform3fv(uI.uLight,COL.light); gl.uniform3fv(uI.uShadow,COL.shadow);
    gl.uniform3fv(uI.uCam,eye); gl.uniform3fv(uI.uFoam,COL.foam); gl.uniform3fv(uI.uSkyH,COL.skyH);
    gl.bindVertexArray(island.vao); gl.drawElements(gl.TRIANGLES, island.count, gl.UNSIGNED_INT, 0);
    drawCalls++; tris += island.count/3;
    gl.bindVertexArray(null);

    if (HUD.tris) HUD.tris.textContent = Math.round(tris).toLocaleString();
    if (HUD.draws) HUD.draws.textContent = drawCalls;

    // wind compass: bow up, arrow points where the wind blows (and the swell rolls)
    if (HUD.wind) {
      const f2=[Math.cos(boat.yaw),-Math.sin(boat.yaw)];
      const fr=starboard(boat.yaw);
      const wn2=Math.hypot(wind.dir[0],wind.dir[1])||1, wdx=wind.dir[0]/wn2, wdz=wind.dir[1]/wn2;
      const wf=wdx*f2[0]+wdz*f2[1], wr=wdx*fr[0]+wdz*fr[1];
      const rot=Math.atan2(-wf, wr)*180/Math.PI + 90;
      HUD.wind.setAttribute('transform', 'rotate('+rot.toFixed(1)+')');
    }
  }

  function frame(now){
    let dt=(now-last)/1000; last=now; dt=Math.min(dt,0.05);
    update(dt); render();
    fpsCount++; fpsT+=dt;
    if (fpsT >= 0.5) {
      if (HUD.fps) HUD.fps.textContent = Math.round(fpsCount/fpsT);
      if (HUD.ms)  HUD.ms.textContent  = (fpsT/fpsCount*1000).toFixed(1) + ' ms';
      fpsCount=0; fpsT=0;
    }
    requestAnimationFrame(frame);
  }
  function resize(){ const dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.floor(innerWidth*dpr); canvas.height=Math.floor(innerHeight*dpr); }
  addEventListener('resize',resize); resize();
  requestAnimationFrame(frame);
}

window.addEventListener('DOMContentLoaded', boot);
