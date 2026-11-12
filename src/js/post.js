/* post.js — renderer + bloom/grade pipeline (render to HalfFloat target, then ACES + sRGB by hand). */
(function (global) {
  'use strict';

  const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  const BRIGHT = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tMap;
    uniform float uThreshold, uKnee;
    void main(){
      vec3 c = texture2D(tMap, vUv).rgb;
      float l = max(c.r, max(c.g, c.b));
      float s = clamp((l - uThreshold) / max(uKnee, 1e-4), 0.0, 1.0);
      gl_FragColor = vec4(c * s * s, 1.0);
    }`;

  const BLUR = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tMap;
    uniform vec2 uDir;
    void main(){
      vec3 s = texture2D(tMap, vUv).rgb * 0.2270270;
      s += (texture2D(tMap, vUv + uDir * 1.3846154).rgb + texture2D(tMap, vUv - uDir * 1.3846154).rgb) * 0.3162162;
      s += (texture2D(tMap, vUv + uDir * 3.2307692).rgb + texture2D(tMap, vUv - uDir * 3.2307692).rgb) * 0.0702703;
      gl_FragColor = vec4(s, 1.0);
    }`;

  const COMP = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tScene, tBloomA, tBloomB;
    uniform float uBloom, uExposure, uTime, uGrade, uGrain, uVig;
    uniform vec2 uRes;
    uniform vec3 uHurt;
    vec3 aces(vec3 x){
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c){
      return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
    }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      // subtle lateral chromatic aberration at the frame edges
      float ca = 0.00055 * r2;
      vec3 c;
      c.r = texture2D(tScene, uv + d * ca).r;
      c.g = texture2D(tScene, uv).g;
      c.b = texture2D(tScene, uv - d * ca).b;

      vec3 bl = texture2D(tBloomA, uv).rgb * 0.62 + texture2D(tBloomB, uv).rgb * 0.85;
      c += bl * uBloom;

      c *= uExposure;
      c = aces(c);

      // grade: cool shadows, warm highlights, a touch of saturation
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.94, 1.0, 1.10);
      vec3 highTint = vec3(1.06, 1.0, 0.93);
      c *= mix(shadowTint, highTint, smoothstep(0.05, 0.75, l));
      c = mix(vec3(l), c, 1.0 + uGrade);
      c = (c - 0.5) * 1.045 + 0.5;
      c = max(c, vec3(0.0));

      c = mix(c, c * vec3(1.25, 0.62, 0.55), uHurt * 0.55);

      // vignette
      c *= 1.0 - uVig * smoothstep(0.18, 0.95, r2 * 1.55);

      c = toSRGB(c);

      // film grain
      float g = hash(uv * uRes + fract(uTime * 13.7) * 91.0) - 0.5;
      c += g * uGrain;

      gl_FragColor = vec4(c, 1.0);
    }`;

  function mat(frag, uniforms) {
    return new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: frag, uniforms: uniforms,
      depthTest: false, depthWrite: false, transparent: false, toneMapped: false
    });
  }

  class PostFX {
    constructor(renderer) {
      this.r = renderer;
      this.enabled = true;
      this.bloom = true;
      this.scale = 1;
      this.grade = 0.12;
      this.grain = 0.022;
      this.vig = 0.5;
      this.exposure = 1.05;
      this.hurt = 0;

      this.scene = new THREE.Scene();
      this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.geo = new THREE.PlaneGeometry(2, 2);
      this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial());
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);

      this.mBright = mat(BRIGHT, { tMap: { value: null }, uThreshold: { value: 1.0 }, uKnee: { value: 0.7 } });
      this.mBlur = mat(BLUR, { tMap: { value: null }, uDir: { value: new THREE.Vector2() } });
      this.mComp = mat(COMP, {
        tScene: { value: null }, tBloomA: { value: null }, tBloomB: { value: null },
        uBloom: { value: 0.55 }, uExposure: { value: 1.0 }, uTime: { value: 0 },
        uGrade: { value: this.grade }, uGrain: { value: this.grain }, uVig: { value: this.vig },
        uRes: { value: new THREE.Vector2(1, 1) }, uHurt: { value: new THREE.Vector3() }
      });

      this.w = 1; this.h = 1;
      this.buildTargets(2, 2);
    }

    buildTargets(w, h) {
      const dispose = (t) => { if (t) t.dispose(); };
      dispose(this.rtScene); dispose(this.rtA); dispose(this.rtB); dispose(this.rtC); dispose(this.rtD);
      const half = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false };
      this.w = Math.max(2, w | 0); this.h = Math.max(2, h | 0);
      const W = this.w, H = this.h;
      this.rtScene = new THREE.WebGLRenderTarget(W, H, half);
      this.rtA = new THREE.WebGLRenderTarget(Math.max(2, W >> 1), Math.max(2, H >> 1), { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });
      this.rtB = new THREE.WebGLRenderTarget(Math.max(2, W >> 1), Math.max(2, H >> 1), { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });
      this.rtC = new THREE.WebGLRenderTarget(Math.max(2, W >> 2), Math.max(2, H >> 2), { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });
      this.rtD = new THREE.WebGLRenderTarget(Math.max(2, W >> 2), Math.max(2, H >> 2), { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });
      for (const t of [this.rtScene, this.rtA, this.rtB, this.rtC, this.rtD]) {
        t.texture.minFilter = THREE.LinearFilter;
        t.texture.magFilter = THREE.LinearFilter;
        t.texture.generateMipmaps = false;
      }
      this.mComp.uniforms.uRes.value.set(W, H);
    }

    resize(w, h) {
      this.buildTargets(w, h);
    }

    pass(material, target) {
      this.mesh.material = material;
      this.r.setRenderTarget(target);
      this.r.render(this.scene, this.cam);
    }

    render(scene, camera, time) {
      const r = this.r;
      if (!this.enabled) {
        r.setRenderTarget(null);
        r.render(scene, camera);
        return;
      }
      r.setRenderTarget(this.rtScene);
      r.clear();
      r.render(scene, camera);

      if (this.bloom) {
        this.mBright.uniforms.tMap.value = this.rtScene.texture;
        this.pass(this.mBright, this.rtA);

        this.mBlur.uniforms.tMap.value = this.rtA.texture;
        this.mBlur.uniforms.uDir.value.set(1.6 / this.rtA.width, 0);
        this.pass(this.mBlur, this.rtB);

        this.mBlur.uniforms.tMap.value = this.rtB.texture;
        this.mBlur.uniforms.uDir.value.set(0, 1.6 / this.rtA.height);
        this.pass(this.mBlur, this.rtA);

        this.mBlur.uniforms.tMap.value = this.rtA.texture;
        this.mBlur.uniforms.uDir.value.set(1.3 / this.rtC.width, 0);
        this.pass(this.mBlur, this.rtC);

        this.mBlur.uniforms.tMap.value = this.rtC.texture;
        this.mBlur.uniforms.uDir.value.set(0, 1.3 / this.rtC.height);
        this.pass(this.mBlur, this.rtD);
      }

      const u = this.mComp.uniforms;
      u.tScene.value = this.rtScene.texture;
      u.tBloomA.value = this.rtA.texture;
      u.tBloomB.value = this.rtD.texture;
      u.uBloom.value = this.bloom ? 0.52 : 0;
      u.uExposure.value = this.exposure;
      u.uTime.value = time;
      u.uGrade.value = this.grade;
      u.uGrain.value = this.grain;
      u.uVig.value = this.vig;
      u.uHurt.value.set(this.hurt, 0, 0);
      this.pass(this.mComp, null);
    }
  }

  global.PostFX = PostFX;
})(window);
