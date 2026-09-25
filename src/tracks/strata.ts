import * as THREE from 'three';

/**
 * Sedimentary rock shading: horizontal bands in world space (warped by noise so they follow
 * the rock like real strata), with grain and a few darker "desert varnish" layers.
 * Works on plain and instanced meshes; replaces the material's base colour.
 */
export function stratify(mat: THREE.MeshStandardMaterial, palette: [string, string, string, string], freq = 0.22) {
  const u = {
    uS0: { value: new THREE.Color(palette[0]) },
    uS1: { value: new THREE.Color(palette[1]) },
    uS2: { value: new THREE.Color(palette[2]) },
    uS3: { value: new THREE.Color(palette[3]) },
    uSFreq: { value: freq },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSP;').replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      {
        vec4 sp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          sp = instanceMatrix * sp;
        #endif
        vSP = (modelMatrix * sp).xyz;
      }`,
    );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vSP;
uniform vec3 uS0;
uniform vec3 uS1;
uniform vec3 uS2;
uniform vec3 uS3;
uniform float uSFreq;
float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), w.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), w.x), w.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float warp = sNoise(vSP.xz * 0.018) * 7.0 + sNoise(vSP.xz * 0.09) * 1.6;
  float t = (vSP.y + warp) * uSFreq;
  float id = floor(t);
  float h = fract(sin(id * 12.9898 + 4.1) * 43758.5453);
  vec3 c = mix(uS0, uS1, smoothstep(0.2, 0.6, h));
  c = mix(c, uS2, step(0.7, h));
  c = mix(c, uS3, step(0.9, h));
  // Soft band edges + fine grain.
  float e = fract(t);
  c *= 0.92 + 0.12 * smoothstep(0.0, 0.15, e) * smoothstep(1.0, 0.8, e);
  c *= 0.86 + 0.28 * sNoise(vec2(vSP.x + vSP.z, vSP.y * 3.0) * 1.1);
  // Dark vertical varnish streaks.
  c *= 1.0 - 0.14 * smoothstep(0.62, 0.9, sNoise(vec2((vSP.x - vSP.z) * 0.35, vSP.y * 0.03)));
  diffuseColor.rgb = c;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'prism-strata-1';
  return mat;
}
