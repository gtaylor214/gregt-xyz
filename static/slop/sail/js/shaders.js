// shaders.js — all GLSL is generated here. buildShaders(nw) bakes the wave count
// into the ocean program; everything else is static. Returned as one object.

export function buildShaders(nw) {
  const GERSTNER = `
    const int NW = ${nw};
    uniform vec4 uWaveA[NW];
    uniform vec4 uWaveB[NW];
    uniform float uTime;
    vec3 gerstner(vec2 base){
      vec3 p = vec3(base.x, 0.0, base.y);
      for(int i=0;i<NW;i++){
        vec2 D = uWaveA[i].xy; float A=uWaveA[i].z, k=uWaveA[i].w;
        float w=uWaveB[i].x, Q=uWaveB[i].y, ph0=uWaveB[i].z;
        float ph = k*dot(D,base) - w*uTime + ph0;
        float c=cos(ph), s=sin(ph);
        p.x += Q*A*D.x*c; p.z += Q*A*D.y*c; p.y += A*s;
      }
      return p;
    }`;

  const VS_OCEAN = `#version 300 es
    ${GERSTNER}
    uniform mat4 uProj, uView; uniform vec2 uOffset;
    in vec2 aXZ; out vec3 vN; out float vH; out vec3 vW;
    void main(){
      vec2 base = aXZ + uOffset;
      vec3 p = gerstner(base);
      vec2 e = vec2(0.13, 0.0);
      vec3 pX = gerstner(base + e.xy);
      vec3 pZ = gerstner(base + e.yx);
      vN = normalize(cross(pZ - p, pX - p));
      vH = p.y; vW = p;
      gl_Position = uProj * uView * vec4(p, 1.0);
    }`;

  const FS_OCEAN = `#version 300 es
    precision highp float;
    in vec3 vN; in float vH; in vec3 vW;
    uniform vec3 uSun, uCam, uDeep, uCrest, uFoam, uLight, uShadow, uSkyH;
    out vec4 frag;
    void main(){
      vec3 N = normalize(vN);
      vec3 V = normalize(uCam - vW);
      float ndl = dot(N, uSun)*0.5 + 0.5;
      float ramp = smoothstep(0.42, 0.58, ndl);
      vec3 shade = mix(uShadow, uLight, ramp);
      float crest = clamp(vH*0.9 + 0.5, 0.0, 1.0);
      vec3 base = mix(uDeep, uCrest, crest);
      vec3 col = base * shade * 1.7;
      float fres = pow(1.0 - max(dot(N,V),0.0), 5.0);
      col = mix(col, uSkyH*shade, fres*0.4);
      float steep = 1.0 - N.y;
      float foam = smoothstep(0.32, 0.52, steep*1.4 + max(vH,0.0)*0.4);
      col = mix(col, uFoam*shade, foam);
      float dist = length(uCam - vW);
      col = mix(col, uSkyH, smoothstep(40.0, 150.0, dist)*0.9);
      frag = vec4(col, 1.0);
    }`;

  const VS_SOLID = `#version 300 es
    uniform mat4 uProj, uView, uModel;
    in vec3 aPos; in vec3 aNormal;
    out vec3 vN; out vec3 vW;
    void main(){
      vec4 w = uModel * vec4(aPos,1.0);
      vN = mat3(uModel) * aNormal; vW = w.xyz;
      gl_Position = uProj * uView * w;
    }`;

  const FS_SOLID = `#version 300 es
    precision highp float;
    in vec3 vN; in vec3 vW;
    uniform vec3 uSun, uColor, uLight, uShadow, uCam;
    out vec4 frag;
    void main(){
      vec3 N = normalize(vN);
      float ndl = dot(N, uSun)*0.5 + 0.5;
      float ramp = smoothstep(0.4, 0.6, ndl);
      vec3 shade = mix(uShadow, uLight, ramp);
      vec3 col = uColor * shade * 1.7;
      float fres = pow(1.0 - max(dot(N, normalize(uCam-vW)),0.0), 4.0);
      col = mix(col, col*0.35, fres*0.3);
      frag = vec4(col, 1.0);
    }`;

  const VS_SKY = `#version 300 es
    in vec2 aPos; out vec2 vUv;
    void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;
  const FS_SKY = `#version 300 es
    precision highp float; in vec2 vUv; out vec4 frag;
    uniform vec3 uSkyTop, uSkyH;
    void main(){ frag = vec4(mix(uSkyH, uSkyTop, smoothstep(0.35,0.95,vUv.y)), 1.0); }`;

  const VS_WAKE = `#version 300 es
    uniform mat4 uProj, uView; in vec3 aPos; in float aA; out float vA;
    void main(){ vA = aA; gl_Position = uProj * uView * vec4(aPos, 1.0); }`;
  const FS_WAKE = `#version 300 es
    precision highp float; in float vA; uniform vec3 uFoam; out vec4 frag;
    void main(){ frag = vec4(uFoam, vA); }`;

  const VS_ISLAND = `#version 300 es
    uniform mat4 uProj, uView, uModel; in vec3 aPos; in vec3 aNormal;
    out vec3 vN; out vec3 vW; out float vY;
    void main(){ vec4 w = uModel*vec4(aPos,1.0); vN = mat3(uModel)*aNormal; vW = w.xyz; vY = w.y; gl_Position = uProj*uView*w; }`;
  const FS_ISLAND = `#version 300 es
    precision highp float; in vec3 vN; in vec3 vW; in float vY;
    uniform vec3 uSun, uLight, uShadow, uCam, uFoam, uSkyH;
    out vec4 frag;
    void main(){
      vec3 N = normalize(vN);
      float ramp = smoothstep(0.4, 0.6, dot(N,uSun)*0.5+0.5);
      vec3 shade = mix(uShadow, uLight, ramp);
      vec3 sand=vec3(0.82,0.74,0.55), grass=vec3(0.33,0.45,0.26), rock=vec3(0.40,0.36,0.30);
      vec3 c = mix(sand, grass, smoothstep(0.4,1.4,vY));
      c = mix(c, rock, smoothstep(3.6,5.6,vY));
      c = mix(c, rock, smoothstep(0.62,0.34,N.y)*0.6);
      vec3 col = c * shade * 1.7;
      float shore = smoothstep(0.35, 0.0, abs(vY - 0.05));
      col = mix(col, uFoam, shore*0.5);
      float dist = length(uCam - vW);
      col = mix(col, uSkyH, smoothstep(60.0, 170.0, dist)*0.9);
      frag = vec4(col, 1.0);
    }`;

  return { VS_OCEAN, FS_OCEAN, VS_SOLID, FS_SOLID, VS_SKY, FS_SKY, VS_WAKE, FS_WAKE, VS_ISLAND, FS_ISLAND };
}
