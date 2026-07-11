// ==================== LIQUID ETHER FLUID SIMULATION ====================
(function () {
  const container = document.getElementById("liquid-ether-bg");
  if (!container || !window.THREE) return;

  const colors = ["#5227FF", "#FF9FFC", "#B497CF"];
  const mouseForce = 20;
  const cursorSize = 100;
  const isViscous = false;
  const viscous = 30;
  const iterationsViscous = 32;
  const iterationsPoisson = 32;
  const dt = 0.014;
  const BFECC = true;
  const resolution = 0.5;
  const isBounce = false;
  const autoDemo = true;
  const autoSpeed = 0.5;
  const autoIntensity = 2.2;
  const takeoverDuration = 0.25;
  const autoResumeDelay = 3000;
  const autoRampDuration = 0.6;

  function makePaletteTexture(stops) {
    let arr =
      Array.isArray(stops) && stops.length > 0
        ? stops.length === 1
          ? [stops[0], stops[0]]
          : stops
        : ["#ffffff", "#ffffff"];
    const w = arr.length;
    const data = new Uint8Array(w * 4);
    for (let i = 0; i < w; i++) {
      const c = new THREE.Color(arr[i]);
      data[i * 4 + 0] = Math.round(c.r * 255);
      data[i * 4 + 1] = Math.round(c.g * 255);
      data[i * 4 + 2] = Math.round(c.b * 255);
      data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, w, 1, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  const paletteTex = makePaletteTexture(colors);
  const bgVec4 = new THREE.Vector4(0, 0, 0, 0);

  const Common = {
    width: 0,
    height: 0,
    aspect: 1,
    pixelRatio: 1,
    time: 0,
    delta: 0,
    container: null,
    renderer: null,
    clock: null,
    init(cont) {
      this.container = cont;
      this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      this.resize();
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.autoClear = false;
      this.renderer.setClearColor(new THREE.Color(0x000000), 0);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setSize(this.width, this.height);
      this.renderer.domElement.style.width = "100%";
      this.renderer.domElement.style.height = "100%";
      this.renderer.domElement.style.display = "block";
      this.clock = new THREE.Clock();
      this.clock.start();
      cont.appendChild(this.renderer.domElement);
    },
    resize() {
      if (!this.container) return;
      const rect = this.container.getBoundingClientRect();
      this.width = Math.max(1, Math.floor(rect.width));
      this.height = Math.max(1, Math.floor(rect.height));
      this.aspect = this.width / this.height;
      if (this.renderer) this.renderer.setSize(this.width, this.height, false);
    },
    update() {
      this.delta = this.clock.getDelta();
      this.time += this.delta;
    },
  };

  const Mouse = {
    mouseMoved: false,
    coords: new THREE.Vector2(),
    coords_old: new THREE.Vector2(),
    diff: new THREE.Vector2(),
    timer: null,
    container: null,
    isHoverInside: false,
    hasUserControl: false,
    isAutoActive: false,
    autoIntensity: 2.0,
    takeoverActive: false,
    takeoverStartTime: 0,
    takeoverDuration: 0.25,
    takeoverFrom: new THREE.Vector2(),
    takeoverTo: new THREE.Vector2(),
    onInteract: null,
    init(container) {
      this.container = container;
      const onMove = (e) => {
        if (!this.updateHoverState(e.clientX, e.clientY)) return;
        if (this.onInteract) this.onInteract();
        if (this.isAutoActive && !this.hasUserControl && !this.takeoverActive) {
          const rect = this.container.getBoundingClientRect();
          const nx = (e.clientX - rect.left) / rect.width;
          const ny = (e.clientY - rect.top) / rect.height;
          this.takeoverFrom.copy(this.coords);
          this.takeoverTo.set(nx * 2 - 1, -(ny * 2 - 1));
          this.takeoverStartTime = performance.now();
          this.takeoverActive = true;
          this.hasUserControl = true;
          this.isAutoActive = false;
          return;
        }
        this.setCoords(e.clientX, e.clientY);
        this.hasUserControl = true;
      };
      const onTouchStart = (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        if (!this.updateHoverState(t.clientX, t.clientY)) return;
        if (this.onInteract) this.onInteract();
        this.setCoords(t.clientX, t.clientY);
        this.hasUserControl = true;
      };
      const onTouchMove = (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        if (!this.updateHoverState(t.clientX, t.clientY)) return;
        if (this.onInteract) this.onInteract();
        this.setCoords(t.clientX, t.clientY);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("touchstart", onTouchStart, { passive: true });
      window.addEventListener("touchmove", onTouchMove, { passive: true });
      window.addEventListener("touchend", () => {
        this.isHoverInside = false;
      });
    },
    isPointInside(clientX, clientY) {
      if (!this.container) return false;
      const rect = this.container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    },
    updateHoverState(clientX, clientY) {
      this.isHoverInside = this.isPointInside(clientX, clientY);
      return this.isHoverInside;
    },
    setCoords(x, y) {
      if (!this.container) return;
      if (this.timer) clearTimeout(this.timer);
      const rect = this.container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const nx = (x - rect.left) / rect.width;
      const ny = (y - rect.top) / rect.height;
      this.coords.set(nx * 2 - 1, -(ny * 2 - 1));
      this.mouseMoved = true;
      this.timer = setTimeout(() => {
        this.mouseMoved = false;
      }, 100);
    },
    setNormalized(nx, ny) {
      this.coords.set(nx, ny);
      this.mouseMoved = true;
    },
    update() {
      if (this.takeoverActive) {
        const t =
          (performance.now() - this.takeoverStartTime) /
          (this.takeoverDuration * 1000);
        if (t >= 1) {
          this.takeoverActive = false;
          this.coords.copy(this.takeoverTo);
          this.coords_old.copy(this.coords);
          this.diff.set(0, 0);
        } else {
          const k = t * t * (3 - 2 * t);
          this.coords.copy(this.takeoverFrom).lerp(this.takeoverTo, k);
        }
      }
      this.diff.subVectors(this.coords, this.coords_old);
      this.coords_old.copy(this.coords);
      if (this.coords_old.x === 0 && this.coords_old.y === 0)
        this.diff.set(0, 0);
      if (this.isAutoActive && !this.takeoverActive)
        this.diff.multiplyScalar(this.autoIntensity);
    },
  };

  class AutoDriver {
    constructor(mouse, manager, opts) {
      this.mouse = mouse;
      this.manager = manager;
      this.enabled = opts.enabled;
      this.speed = opts.speed;
      this.resumeDelay = opts.resumeDelay || 3000;
      this.rampDurationMs = (opts.rampDuration || 0) * 1000;
      this.active = false;
      this.current = new THREE.Vector2(0, 0);
      this.target = new THREE.Vector2();
      this.lastTime = performance.now();
      this.activationTime = 0;
      this.margin = 0.2;
      this._tmpDir = new THREE.Vector2();
      this.pickNewTarget();
    }
    pickNewTarget() {
      const r = Math.random;
      this.target.set(
        (r() * 2 - 1) * (1 - this.margin),
        (r() * 2 - 1) * (1 - this.margin),
      );
    }
    forceStop() {
      this.active = false;
      this.mouse.isAutoActive = false;
    }
    update() {
      if (!this.enabled) return;
      const now = performance.now();
      const idle = now - this.manager.lastUserInteraction;
      if (idle < this.resumeDelay) {
        if (this.active) this.forceStop();
        return;
      }
      if (this.mouse.isHoverInside) {
        if (this.active) this.forceStop();
        return;
      }
      if (!this.active) {
        this.active = true;
        this.current.copy(this.mouse.coords);
        this.lastTime = now;
        this.activationTime = now;
      }
      if (!this.active) return;
      this.mouse.isAutoActive = true;
      let dtSec = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (dtSec > 0.2) dtSec = 0.016;
      const dir = this._tmpDir.subVectors(this.target, this.current);
      const dist = dir.length();
      if (dist < 0.01) {
        this.pickNewTarget();
        return;
      }
      dir.normalize();
      let ramp = 1;
      if (this.rampDurationMs > 0) {
        const t = Math.min(
          1,
          (now - this.activationTime) / this.rampDurationMs,
        );
        ramp = t * t * (3 - 2 * t);
      }
      const step = this.speed * dtSec * ramp;
      const move = Math.min(step, dist);
      this.current.addScaledVector(dir, move);
      this.mouse.setNormalized(this.current.x, this.current.y);
    }
  }

  const face_vert = `attribute vec3 position;uniform vec2 px;uniform vec2 boundarySpace;varying vec2 uv;precision highp float;void main(){vec3 pos=position;vec2 scale=1.0-boundarySpace*2.0;pos.xy=pos.xy*scale;uv=vec2(0.5)+(pos.xy)*0.5;gl_Position=vec4(pos,1.0);}`;
  const line_vert = `attribute vec3 position;uniform vec2 px;precision highp float;varying vec2 uv;void main(){vec3 pos=position;uv=0.5+pos.xy*0.5;vec2 n=sign(pos.xy);pos.xy=abs(pos.xy)-px*1.0;pos.xy*=n;gl_Position=vec4(pos,1.0);}`;
  const mouse_vert = `precision highp float;attribute vec3 position;attribute vec2 uv;uniform vec2 center;uniform vec2 scale;uniform vec2 px;varying vec2 vUv;void main(){vec2 pos=position.xy*scale*2.0*px+center;vUv=uv;gl_Position=vec4(pos,0.0,1.0);}`;
  const advection_frag = `precision highp float;uniform sampler2D velocity;uniform float dt;uniform bool isBFECC;uniform vec2 fboSize;uniform vec2 px;varying vec2 uv;void main(){vec2 ratio=max(fboSize.x,fboSize.y)/fboSize;if(isBFECC==false){vec2 vel=texture2D(velocity,uv).xy;vec2 uv2=uv-vel*dt*ratio;vec2 newVel=texture2D(velocity,uv2).xy;gl_FragColor=vec4(newVel,0.0,0.0);}else{vec2 spot_new=uv;vec2 vel_old=texture2D(velocity,uv).xy;vec2 spot_old=spot_new-vel_old*dt*ratio;vec2 vel_new1=texture2D(velocity,spot_old).xy;vec2 spot_new2=spot_old+vel_new1*dt*ratio;vec2 error=spot_new2-spot_new;vec2 spot_new3=spot_new-error/2.0;vec2 vel_2=texture2D(velocity,spot_new3).xy;vec2 spot_old2=spot_new3-vel_2*dt*ratio;vec2 newVel2=texture2D(velocity,spot_old2).xy;gl_FragColor=vec4(newVel2,0.0,0.0);}}`;
  const color_frag = `precision highp float;uniform sampler2D velocity;uniform sampler2D palette;uniform vec4 bgColor;varying vec2 uv;void main(){vec2 vel=texture2D(velocity,uv).xy;float lenv=clamp(length(vel),0.0,1.0);vec3 c=texture2D(palette,vec2(lenv,0.5)).rgb;vec3 outRGB=mix(bgColor.rgb,c,lenv);float outA=mix(bgColor.a,1.0,lenv);gl_FragColor=vec4(outRGB,outA);}`;
  const divergence_frag = `precision highp float;uniform sampler2D velocity;uniform float dt;uniform vec2 px;varying vec2 uv;void main(){float x0=texture2D(velocity,uv-vec2(px.x,0.0)).x;float x1=texture2D(velocity,uv+vec2(px.x,0.0)).x;float y0=texture2D(velocity,uv-vec2(0.0,px.y)).y;float y1=texture2D(velocity,uv+vec2(0.0,px.y)).y;float divergence=(x1-x0+y1-y0)/2.0;gl_FragColor=vec4(divergence/dt);}`;
  const externalForce_frag = `precision highp float;uniform vec2 force;uniform vec2 center;uniform vec2 scale;uniform vec2 px;varying vec2 vUv;void main(){vec2 circle=(vUv-0.5)*2.0;float d=1.0-min(length(circle),1.0);d*=d;gl_FragColor=vec4(force*d,0.0,1.0);}`;
  const poisson_frag = `precision highp float;uniform sampler2D pressure;uniform sampler2D divergence;uniform vec2 px;varying vec2 uv;void main(){float p0=texture2D(pressure,uv+vec2(px.x*2.0,0.0)).r;float p1=texture2D(pressure,uv-vec2(px.x*2.0,0.0)).r;float p2=texture2D(pressure,uv+vec2(0.0,px.y*2.0)).r;float p3=texture2D(pressure,uv-vec2(0.0,px.y*2.0)).r;float div=texture2D(divergence,uv).r;float newP=(p0+p1+p2+p3)/4.0-div;gl_FragColor=vec4(newP);}`;
  const pressure_frag = `precision highp float;uniform sampler2D pressure;uniform sampler2D velocity;uniform vec2 px;uniform float dt;varying vec2 uv;void main(){float step=1.0;float p0=texture2D(pressure,uv+vec2(px.x*step,0.0)).r;float p1=texture2D(pressure,uv-vec2(px.x*step,0.0)).r;float p2=texture2D(pressure,uv+vec2(0.0,px.y*step)).r;float p3=texture2D(pressure,uv-vec2(0.0,px.y*step)).r;vec2 v=texture2D(velocity,uv).xy;vec2 gradP=vec2(p0-p1,p2-p3)*0.5;v=v-gradP*dt;gl_FragColor=vec4(v,0.0,1.0);}`;
  const viscous_frag = `precision highp float;uniform sampler2D velocity;uniform sampler2D velocity_new;uniform float v;uniform vec2 px;uniform float dt;varying vec2 uv;void main(){vec2 old=texture2D(velocity,uv).xy;vec2 new0=texture2D(velocity_new,uv+vec2(px.x*2.0,0.0)).xy;vec2 new1=texture2D(velocity_new,uv-vec2(px.x*2.0,0.0)).xy;vec2 new2=texture2D(velocity_new,uv+vec2(0.0,px.y*2.0)).xy;vec2 new3=texture2D(velocity_new,uv-vec2(0.0,px.y*2.0)).xy;vec2 newv=4.0*old+v*dt*(new0+new1+new2+new3);newv/=4.0*(1.0+v*dt);gl_FragColor=vec4(newv,0.0,0.0);}`;

  class ShaderPass {
    constructor(props) {
      this.props = props || {};
      this.uniforms = this.props.material ? this.props.material.uniforms : null;
      this.scene = null;
      this.camera = null;
      this.material = null;
      this.geometry = null;
      this.plane = null;
    }
    init() {
      this.scene = new THREE.Scene();
      this.camera = new THREE.Camera();
      if (this.uniforms) {
        this.material = new THREE.RawShaderMaterial(this.props.material);
        this.geometry = new THREE.PlaneGeometry(2.0, 2.0);
        this.plane = new THREE.Mesh(this.geometry, this.material);
        this.scene.add(this.plane);
      }
    }
    update() {
      Common.renderer.setRenderTarget(this.props.output || null);
      Common.renderer.render(this.scene, this.camera);
      Common.renderer.setRenderTarget(null);
    }
  }

  class Advection extends ShaderPass {
    constructor(simProps) {
      super({
        material: {
          vertexShader: face_vert,
          fragmentShader: advection_frag,
          uniforms: {
            boundarySpace: { value: simProps.cellScale },
            px: { value: simProps.cellScale },
            fboSize: { value: simProps.fboSize },
            velocity: { value: simProps.src.texture },
            dt: { value: simProps.dt },
            isBFECC: { value: true },
          },
        },
        output: simProps.dst,
      });
      this.uniforms = this.props.material.uniforms;
      this.init();
    }
    init() {
      super.init();
      const boundaryG = new THREE.BufferGeometry();
      const vertices_boundary = new Float32Array([
        -1, -1, 0, -1, 1, 0, -1, 1, 0, 1, 1, 0, 1, 1, 0, 1, -1, 0, 1, -1, 0, -1,
        -1, 0,
      ]);
      boundaryG.setAttribute(
        "position",
        new THREE.BufferAttribute(vertices_boundary, 3),
      );
      const boundaryM = new THREE.RawShaderMaterial({
        vertexShader: line_vert,
        fragmentShader: advection_frag,
        uniforms: this.uniforms,
      });
      this.line = new THREE.LineSegments(boundaryG, boundaryM);
      this.scene.add(this.line);
    }
    update(opts) {
      this.uniforms.dt.value = opts.dt;
      this.line.visible = opts.isBounce;
      this.uniforms.isBFECC.value = opts.BFECC;
      super.update();
    }
  }

  class ExternalForce extends ShaderPass {
    constructor(simProps) {
      super({ output: simProps.dst });
      this.init(simProps);
    }
    init(simProps) {
      super.init();
      const mouseG = new THREE.PlaneGeometry(1, 1);
      const mouseM = new THREE.RawShaderMaterial({
        vertexShader: mouse_vert,
        fragmentShader: externalForce_frag,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: {
          px: { value: simProps.cellScale },
          force: { value: new THREE.Vector2(0.0, 0.0) },
          center: { value: new THREE.Vector2(0.0, 0.0) },
          scale: {
            value: new THREE.Vector2(
              simProps.cursor_size,
              simProps.cursor_size,
            ),
          },
        },
      });
      this.mouse = new THREE.Mesh(mouseG, mouseM);
      this.scene.add(this.mouse);
    }
    update(props) {
      const forceX = (Mouse.diff.x / 2) * props.mouse_force;
      const forceY = (Mouse.diff.y / 2) * props.mouse_force;
      const cursorSizeX = props.cursor_size * props.cellScale.x;
      const cursorSizeY = props.cursor_size * props.cellScale.y;
      const centerX = Math.min(
        Math.max(Mouse.coords.x, -1 + cursorSizeX + props.cellScale.x * 2),
        1 - cursorSizeX - props.cellScale.x * 2,
      );
      const centerY = Math.min(
        Math.max(Mouse.coords.y, -1 + cursorSizeY + props.cellScale.y * 2),
        1 - cursorSizeY - props.cellScale.y * 2,
      );
      const uniforms = this.mouse.material.uniforms;
      uniforms.force.value.set(forceX, forceY);
      uniforms.center.value.set(centerX, centerY);
      uniforms.scale.value.set(props.cursor_size, props.cursor_size);
      super.update();
    }
  }

  class Viscous extends ShaderPass {
    constructor(simProps) {
      super({
        material: {
          vertexShader: face_vert,
          fragmentShader: viscous_frag,
          uniforms: {
            boundarySpace: { value: simProps.boundarySpace },
            velocity: { value: simProps.src.texture },
            velocity_new: { value: simProps.dst_.texture },
            v: { value: simProps.viscous },
            px: { value: simProps.cellScale },
            dt: { value: simProps.dt },
          },
        },
        output: simProps.dst,
        output0: simProps.dst_,
        output1: simProps.dst,
      });
      this.init();
    }
    update(opts) {
      let fbo_in, fbo_out;
      this.uniforms.v.value = opts.viscous;
      for (let i = 0; i < opts.iterations; i++) {
        if (i % 2 === 0) {
          fbo_in = this.props.output0;
          fbo_out = this.props.output1;
        } else {
          fbo_in = this.props.output1;
          fbo_out = this.props.output0;
        }
        this.uniforms.velocity_new.value = fbo_in.texture;
        this.props.output = fbo_out;
        this.uniforms.dt.value = opts.dt;
        super.update();
      }
      return fbo_out;
    }
  }

  class Divergence extends ShaderPass {
    constructor(simProps) {
      super({
        material: {
          vertexShader: face_vert,
          fragmentShader: divergence_frag,
          uniforms: {
            boundarySpace: { value: simProps.boundarySpace },
            velocity: { value: simProps.src.texture },
            px: { value: simProps.cellScale },
            dt: { value: simProps.dt },
          },
        },
        output: simProps.dst,
      });
      this.init();
    }
    update(opts) {
      this.uniforms.velocity.value = opts.vel.texture;
      super.update();
    }
  }

  class Poisson extends ShaderPass {
    constructor(simProps) {
      super({
        material: {
          vertexShader: face_vert,
          fragmentShader: poisson_frag,
          uniforms: {
            boundarySpace: { value: simProps.boundarySpace },
            pressure: { value: simProps.dst_.texture },
            divergence: { value: simProps.src.texture },
            px: { value: simProps.cellScale },
          },
        },
        output: simProps.dst,
        output0: simProps.dst_,
        output1: simProps.dst,
      });
      this.init();
    }
    update(opts) {
      let p_in, p_out;
      for (let i = 0; i < opts.iterations; i++) {
        if (i % 2 === 0) {
          p_in = this.props.output0;
          p_out = this.props.output1;
        } else {
          p_in = this.props.output1;
          p_out = this.props.output0;
        }
        this.uniforms.pressure.value = p_in.texture;
        this.props.output = p_out;
        super.update();
      }
      return p_out;
    }
  }

  class Pressure extends ShaderPass {
    constructor(simProps) {
      super({
        material: {
          vertexShader: face_vert,
          fragmentShader: pressure_frag,
          uniforms: {
            boundarySpace: { value: simProps.boundarySpace },
            pressure: { value: simProps.src_p.texture },
            velocity: { value: simProps.src_v.texture },
            px: { value: simProps.cellScale },
            dt: { value: simProps.dt },
          },
        },
        output: simProps.dst,
      });
      this.init();
    }
    update(opts) {
      this.uniforms.velocity.value = opts.vel.texture;
      this.uniforms.pressure.value = opts.pressure.texture;
      super.update();
    }
  }

  class Simulation {
    constructor(options) {
      this.options = Object.assign(
        {
          iterations_poisson: 32,
          iterations_viscous: 32,
          mouse_force: 20,
          resolution: 0.5,
          cursor_size: 100,
          viscous: 30,
          isBounce: false,
          dt: 0.014,
          isViscous: false,
          BFECC: true,
        },
        options,
      );
      this.fbos = {
        vel_0: null,
        vel_1: null,
        vel_viscous0: null,
        vel_viscous1: null,
        div: null,
        pressure_0: null,
        pressure_1: null,
      };
      this.fboSize = new THREE.Vector2();
      this.cellScale = new THREE.Vector2();
      this.boundarySpace = new THREE.Vector2();
      this.init();
    }
    init() {
      this.calcSize();
      this.createAllFBO();
      this.createShaderPass();
    }
    getFloatType() {
      const isIOS = /(iPad|iPhone|iPod)/i.test(navigator.userAgent);
      return isIOS ? THREE.HalfFloatType : THREE.FloatType;
    }
    createAllFBO() {
      const type = this.getFloatType();
      const opts = {
        type,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
      };
      for (let key in this.fbos) {
        this.fbos[key] = new THREE.WebGLRenderTarget(
          this.fboSize.x,
          this.fboSize.y,
          opts,
        );
      }
    }
    createShaderPass() {
      this.advection = new Advection({
        cellScale: this.cellScale,
        fboSize: this.fboSize,
        dt: this.options.dt,
        src: this.fbos.vel_0,
        dst: this.fbos.vel_1,
      });
      this.externalForce = new ExternalForce({
        cellScale: this.cellScale,
        cursor_size: this.options.cursor_size,
        dst: this.fbos.vel_1,
      });
      this.viscous = new Viscous({
        cellScale: this.cellScale,
        boundarySpace: this.boundarySpace,
        viscous: this.options.viscous,
        src: this.fbos.vel_1,
        dst: this.fbos.vel_viscous1,
        dst_: this.fbos.vel_viscous0,
        dt: this.options.dt,
      });
      this.divergence = new Divergence({
        cellScale: this.cellScale,
        boundarySpace: this.boundarySpace,
        src: this.fbos.vel_viscous0,
        dst: this.fbos.div,
        dt: this.options.dt,
      });
      this.poisson = new Poisson({
        cellScale: this.cellScale,
        boundarySpace: this.boundarySpace,
        src: this.fbos.div,
        dst: this.fbos.pressure_1,
        dst_: this.fbos.pressure_0,
      });
      this.pressure = new Pressure({
        cellScale: this.cellScale,
        boundarySpace: this.boundarySpace,
        src_p: this.fbos.pressure_0,
        src_v: this.fbos.vel_viscous0,
        dst: this.fbos.vel_0,
        dt: this.options.dt,
      });
    }
    calcSize() {
      const width = Math.max(
        1,
        Math.round(this.options.resolution * Common.width),
      );
      const height = Math.max(
        1,
        Math.round(this.options.resolution * Common.height),
      );
      this.cellScale.set(1.0 / width, 1.0 / height);
      this.fboSize.set(width, height);
    }
    resize() {
      this.calcSize();
      for (let key in this.fbos) {
        this.fbos[key].setSize(this.fboSize.x, this.fboSize.y);
      }
    }
    update() {
      if (this.options.isBounce) this.boundarySpace.set(0, 0);
      else this.boundarySpace.copy(this.cellScale);
      this.advection.update({
        dt: this.options.dt,
        isBounce: this.options.isBounce,
        BFECC: this.options.BFECC,
      });
      this.externalForce.update({
        cursor_size: this.options.cursor_size,
        mouse_force: this.options.mouse_force,
        cellScale: this.cellScale,
      });
      let vel = this.fbos.vel_1;
      if (this.options.isViscous) {
        vel = this.viscous.update({
          viscous: this.options.viscous,
          iterations: this.options.iterations_viscous,
          dt: this.options.dt,
        });
      }
      this.divergence.update({ vel });
      const pressure = this.poisson.update({
        iterations: this.options.iterations_poisson,
      });
      this.pressure.update({ vel, pressure });
    }
  }

  class Output {
    constructor() {
      this.init();
    }
    init() {
      this.simulation = new Simulation();
      this.scene = new THREE.Scene();
      this.camera = new THREE.Camera();
      this.output = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.RawShaderMaterial({
          vertexShader: face_vert,
          fragmentShader: color_frag,
          transparent: true,
          depthWrite: false,
          uniforms: {
            velocity: { value: this.simulation.fbos.vel_0.texture },
            boundarySpace: { value: new THREE.Vector2() },
            palette: { value: paletteTex },
            bgColor: { value: bgVec4 },
          },
        }),
      );
      this.scene.add(this.output);
    }
    resize() {
      this.simulation.resize();
    }
    render() {
      Common.renderer.setRenderTarget(null);
      Common.renderer.render(this.scene, this.camera);
    }
    update() {
      this.simulation.update();
      this.render();
    }
  }

  class WebGLManager {
    constructor(props) {
      this.props = props;
      Common.init(props.$wrapper);
      Mouse.init(props.$wrapper);
      Mouse.autoIntensity = props.autoIntensity;
      Mouse.takeoverDuration = props.takeoverDuration;
      this.lastUserInteraction = performance.now();
      Mouse.onInteract = () => {
        this.lastUserInteraction = performance.now();
        if (this.autoDriver) this.autoDriver.forceStop();
      };
      this.autoDriver = new AutoDriver(Mouse, this, {
        enabled: props.autoDemo,
        speed: props.autoSpeed,
        resumeDelay: props.autoResumeDelay,
        rampDuration: props.autoRampDuration,
      });
      this.init();
      this._loop = this.loop.bind(this);
      this._resize = this.resize.bind(this);
      window.addEventListener("resize", this._resize);
      this._onVisibility = () => {
        if (document.hidden) this.pause();
        else this.start();
      };
      document.addEventListener("visibilitychange", this._onVisibility);
      this.running = false;
      this.rafId = null;
    }
    init() {
      this.output = new Output();
    }
    resize() {
      Common.resize();
      this.output.resize();
    }
    render() {
      if (this.autoDriver) this.autoDriver.update();
      Mouse.update();
      Common.update();
      this.output.update();
    }
    loop() {
      if (!this.running) return;
      this.render();
      this.rafId = requestAnimationFrame(this._loop);
    }
    start() {
      if (this.running) return;
      this.running = true;
      this._loop();
    }
    pause() {
      this.running = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }
    dispose() {
      window.removeEventListener("resize", this._resize);
      document.removeEventListener("visibilitychange", this._onVisibility);
      if (Common.renderer) {
        const canvas = Common.renderer.domElement;
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        Common.renderer.dispose();
        Common.renderer.forceContextLoss();
      }
    }
  }

  const webgl = new WebGLManager({
    $wrapper: container,
    autoDemo,
    autoSpeed,
    autoIntensity,
    takeoverDuration,
    autoResumeDelay,
    autoRampDuration,
  });
  webgl.start();

  const ro = new ResizeObserver(() => {
    webgl.resize();
  });
  ro.observe(container);
  window._liquidEther = webgl;
})();

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

// ==================== FPS ====================
let lastFrameTime = performance.now(),
  frameCount = 0,
  fps = 60;
function updateFPS() {
  const now = performance.now();
  frameCount++;
  if (now - lastFrameTime >= 1000) {
    fps = frameCount;
    frameCount = 0;
    lastFrameTime = now;
    const ms = (1000 / fps).toFixed(1);
    const el = document.getElementById("fps-hud");
    if (el) el.textContent = `${fps} FPS · ${ms}ms`;
  }
  requestAnimationFrame(updateFPS);
}
updateFPS();

// ==================== TIME ====================
function updateTime() {
  const now = new Date();
  const el = document.getElementById("local-time");
  if (el) {
    el.textContent = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  const hour = now.getHours();
  const root = document.documentElement;
  if (hour >= 6 && hour < 18) root.style.setProperty("--accent", "#c9a96e");
  else root.style.setProperty("--accent", "#a8b8d8");
}
setInterval(updateTime, 1000);
updateTime();

// ==================== CURSOR ====================
const cursor = document.getElementById("cursor");
const cursorLabel = document.getElementById("cursor-label");
let mouseX = 0,
  mouseY = 0,
  cursorX = 0,
  cursorY = 0;
document.addEventListener("mousemove", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});
function animateCursor() {
  if (!cursor) return;
  cursorX += (mouseX - cursorX) * 0.15;
  cursorY += (mouseY - cursorY) * 0.15;
  cursor.style.left = cursorX + "px";
  cursor.style.top = cursorY + "px";
  if (cursorLabel) {
    cursorLabel.style.left = cursorX + "px";
    cursorLabel.style.top = cursorY - 40 + "px";
  }
  requestAnimationFrame(animateCursor);
}
if (cursor && !window.matchMedia("(pointer: coarse)").matches) {
  animateCursor();
} else if (cursor) {
  cursor.style.display = "none";
  if (cursorLabel) cursorLabel.style.display = "none";
}
document
  .querySelectorAll(
    "a, button, .project-card, .cert-item, .skill-tag, .exp-card, .exp-filter",
  )
  .forEach((el) => {
    el.addEventListener("mouseenter", () => {
      if (!cursor) return;
      const label = el.getAttribute("data-cursor");
      if (label && cursorLabel) {
        cursorLabel.textContent = label;
        cursorLabel.classList.add("active");
        cursor.classList.add("hover");
      } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        cursor.classList.add("text");
      } else {
        cursor.classList.add("hover");
      }
    });
    el.addEventListener("mouseleave", () => {
      if (!cursor) return;
      cursor.classList.remove("hover", "text");
      if (cursorLabel) cursorLabel.classList.remove("active");
    });
  });

// ==================== TEXT SCRAMBLE ====================
class TextScramble {
  constructor(el) {
    this.el = el;
    this.chars = "!<>-_\\/[]{}—=+*^?#________";
    this.update = this.update.bind(this);
  }
  setText(newText) {
    const oldText = this.el.innerText;
    const length = Math.max(oldText.length, newText.length);
    const promise = new Promise((resolve) => (this.resolve = resolve));
    this.queue = [];
    for (let i = 0; i < length; i++) {
      const from = oldText[i] || "";
      const to = newText[i] || "";
      const start = Math.floor(Math.random() * 40);
      const end = start + Math.floor(Math.random() * 40);
      this.queue.push({ from, to, start, end });
    }
    cancelAnimationFrame(this.frameRequest);
    this.frame = 0;
    this.update();
    return promise;
  }
  update() {
    let output = "";
    let complete = 0;
    for (let i = 0, n = this.queue.length; i < n; i++) {
      let { from, to, start, end, char } = this.queue[i];
      if (this.frame >= end) {
        complete++;
        output += to;
      } else if (this.frame >= start) {
        if (!char || Math.random() < 0.28) {
          char = this.randomChar();
          this.queue[i].char = char;
        }
        output += `<span style="color: var(--dim)">${char}</span>`;
      } else {
        output += from;
      }
    }
    this.el.innerHTML = output;
    if (complete === this.queue.length) this.resolve();
    else {
      this.frameRequest = requestAnimationFrame(this.update);
      this.frame++;
    }
  }
  randomChar() {
    return this.chars[Math.floor(Math.random() * this.chars.length)];
  }
}
const scrambleEl = document.getElementById("scramble");
if (scrambleEl) {
  const fx = new TextScramble(scrambleEl);
  const roles = [
    "AI Engineer",
    "Software Developer",
    "Systems Designer",
    "Database Management",
    "Builder",
  ];
  let counter = 0;
  const next = () => {
    fx.setText(roles[counter]).then(() => setTimeout(next, 2500));
    counter = (counter + 1) % roles.length;
  };
  setTimeout(next, 1500);
}

// ==================== HERO ====================
gsap.set(".hero-label", { y: 30, opacity: 0 });
gsap.set(".role", { opacity: 0 });
gsap.set(".meta", { opacity: 0, y: 20 });
gsap.set(".scroll-ind", { opacity: 0 });
const heroTl = gsap.timeline({ defaults: { ease: "power4.out" } });
heroTl
  .to(".hero-label", { y: 0, opacity: 1, duration: 1, delay: 0.2 })
  .to(".line-inner", { y: 0, duration: 1.2, stagger: 0.1 }, "-=0.6")
  .to(".role", { opacity: 1, duration: 0.8 }, "-=0.8")
  .to(".meta", { opacity: 1, y: 0, duration: 1 }, "-=0.6")
  .to(".scroll-ind", { opacity: 1, duration: 1 }, "-=0.4");

gsap.to(".bg-text", {
  y: 300,
  ease: "none",
  scrollTrigger: {
    trigger: "#hero",
    start: "top top",
    end: "bottom top",
    scrub: true,
  },
});

// ==================== LINE DIVIDERS ====================
document.querySelectorAll(".line-divider").forEach((line) => {
  gsap.to(line, {
    width: "100%",
    duration: 1.5,
    ease: "power3.inOut",
    scrollTrigger: {
      trigger: line,
      start: "top 80%",
      toggleActions: "play none none reverse",
    },
  });
});

// ==================== PROFILE ====================
if (document.querySelector(".profile-heading")) {
  const profileHeading = new SplitType(".profile-heading", { types: "words" });
  gsap.from(profileHeading.words, {
    y: 50,
    opacity: 0,
    duration: 1,
    stagger: 0.05,
    ease: "power3.out",
    scrollTrigger: { trigger: ".profile-heading", start: "top 80%" },
  });
}
gsap.from(".profile-text", {
  y: 30,
  opacity: 0,
  duration: 1,
  stagger: 0.2,
  ease: "power3.out",
  scrollTrigger: { trigger: ".bio", start: "top 70%" },
});
gsap.from(".stat", {
  y: 40,
  opacity: 0,
  duration: 0.8,
  stagger: 0.1,
  ease: "power3.out",
  scrollTrigger: { trigger: ".stats", start: "top 85%" },
});
gsap.from(".skill-tag", {
  scale: 0.8,
  opacity: 0,
  duration: 0.6,
  stagger: 0.03,
  ease: "back.out(1.7)",
  scrollTrigger: { trigger: ".skill-cloud", start: "top 85%" },
});
document.querySelectorAll("[data-count]").forEach((counterEl) => {
  const target = parseInt(counterEl.getAttribute("data-count"));
  ScrollTrigger.create({
    trigger: counterEl,
    start: "top 85%",
    onEnter: () => {
      gsap.to(counterEl, {
        innerText: target,
        duration: 2,
        snap: { innerText: 1 },
        ease: "power2.out",
      });
    },
    once: true,
  });
});

// ==================== TEXT SCRAMBLE EFFECT ====================
(function initTextScramble() {
  const scrambleText = (element, finalText, duration = 1000) => {
    const chars = "!<>-_\\/[]{}—=+*^?#________";
    let iterations = 0;

    const interval = setInterval(() => {
      element.innerText = finalText
        .split("")
        .map((letter, index) => {
          if (index < iterations) {
            return finalText[index];
          }
          return chars[Math.floor(Math.random() * chars.length)];
        })
        .join("");

      if (iterations >= finalText.length) {
        clearInterval(interval);
      }

      iterations += 1 / 3;
    }, 30);
  };

  // Apply scramble on hover to section headings
  const headings = document.querySelectorAll(".display");
  headings.forEach((heading) => {
    heading.addEventListener("mouseenter", () => {
      const originalText = heading.innerText;
      scrambleText(heading, originalText, 500);
    });
  });
})();

// ==================== MAGNETIC BUTTON EFFECT ====================
(function initMagneticButtons() {
  const buttons = document.querySelectorAll(".nav-link, #audio-toggle");

  buttons.forEach((button) => {
    button.addEventListener("mousemove", (e) => {
      const rect = button.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;

      gsap.to(button, {
        x: x * 0.3,
        y: y * 0.3,
        duration: 0.3,
        ease: "power2.out",
      });
    });

    button.addEventListener("mouseleave", () => {
      gsap.to(button, {
        x: 0,
        y: 0,
        duration: 0.5,
        ease: "elastic.out(1, 0.3)",
      });
    });
  });
})();

// ==================== BOUNCE CARDS EFFECT ====================
(function initBounceCards() {
  const projectCards = document.querySelectorAll(".project-card");

  projectCards.forEach((card, index) => {
    gsap.from(card, {
      y: 100,
      opacity: 0,
      scale: 0.8,
      duration: 0.8,
      delay: index * 0.1,
      ease: "elastic.out(1, 0.5)",
      scrollTrigger: {
        trigger: card,
        start: "top 85%",
        toggleActions: "play none none reverse",
      },
    });
  });
})();

// ==================== BLUR TEXT EFFECT ====================
(function initBlurText() {
  const blurElements = document.querySelectorAll(
    ".profile-heading, .exp-role, .project-title",
  );

  blurElements.forEach((el) => {
    el.classList.add("blur-text");

    ScrollTrigger.create({
      trigger: el,
      start: "top 80%",
      onEnter: () => el.classList.add("visible"),
      once: true,
    });
  });
})();

// ==================== CLICK SPARK EFFECT ====================
(function initClickSpark() {
  const sparkColors = ["#c9a96e", "#5227FF", "#FF9FFC", "#4ade80", "#ffb000"];

  function createSpark(x, y) {
    const spark = document.createElement("div");
    spark.className = "click-spark";
    spark.style.left = x + "px";
    spark.style.top = y + "px";
    document.body.appendChild(spark);

    // Create particles
    for (let i = 0; i < 12; i++) {
      const particle = document.createElement("div");
      particle.className = "spark-particle";
      const angle = (i / 12) * Math.PI * 2;
      const velocity = 50 + Math.random() * 50;
      const tx = Math.cos(angle) * velocity;
      const ty = Math.sin(angle) * velocity;

      particle.style.backgroundColor =
        sparkColors[Math.floor(Math.random() * sparkColors.length)];
      particle.style.transform = `translate(0, 0) scale(1)`;
      spark.appendChild(particle);

      gsap.to(particle, {
        x: tx,
        y: ty,
        opacity: 0,
        scale: 0,
        duration: 0.8 + Math.random() * 0.4,
        ease: "power2.out",
      });
    }

    // Remove spark after animation
    gsap.to(spark, {
      opacity: 0,
      duration: 0.8,
      delay: 0.3,
      onComplete: () => spark.remove(),
    });
  }

  document.addEventListener("click", (e) => {
    createSpark(e.clientX, e.clientY);
  });
})();

// ==================== EXPERIENCE TIMELINE ====================
(function initExperienceTimeline() {
  const timeline = document.getElementById("exp-timeline");
  const counterEl = document.getElementById("exp-counter");
  const totalEl = document.getElementById("exp-total");
  const filters = document.querySelectorAll(".exp-filter");
  const progressEl = document.querySelector(".timeline-progress");

  if (!timeline) return;

  const items = Array.from(timeline.querySelectorAll(".exp-item"));

  function updateCounter(visibleCount) {
    const total =
      visibleCount ??
      items.filter((i) => !i.classList.contains("is-hidden")).length;
    if (totalEl)
      totalEl.textContent = String(Math.max(total, 1)).padStart(2, "0");
    if (counterEl) counterEl.textContent = "01";
  }
  updateCounter(items.length);

  // Filters
  filters.forEach((btn) => {
    btn.addEventListener("click", () => {
      filters.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const filter = btn.getAttribute("data-filter");
      let visible = 0;

      items.forEach((item) => {
        const type = item.getAttribute("data-type") || "";
        const show = filter === "all" || type === filter;
        item.classList.toggle("is-hidden", !show);
        if (show) visible++;
      });

      updateCounter(visible);
      if (window.ScrollTrigger) ScrollTrigger.refresh();
    });
  });

  // Scroll-driven progress line
  if (progressEl) {
    ScrollTrigger.create({
      trigger: timeline,
      start: "top 70%",
      end: "bottom 30%",
      scrub: 0.5,
      onUpdate: (self) => {
        progressEl.style.height = self.progress * 100 + "%";
      },
    });
  }

  // Card entrance animations — animate FROM hidden TO visible
  items.forEach((item, i) => {
    const isLeft = i % 2 === 0;
    const card = item.querySelector(".exp-card");
    const node = item.querySelector(".timeline-node");
    const yearBg = item.querySelector(".timeline-year-bg");

    // Animate from offset position
    gsap.from(item, {
      x: isLeft ? -40 : 40,
      opacity: 0.5,
      duration: 0.8,
      ease: "power3.out",
      scrollTrigger: {
        trigger: item,
        start: "top 85%",
        toggleActions: "play none none reverse",
      },
    });

    if (node) {
      gsap.from(node, {
        scale: 0,
        opacity: 0,
        duration: 0.5,
        ease: "back.out(2)",
        scrollTrigger: {
          trigger: item,
          start: "top 80%",
          toggleActions: "play none none reverse",
        },
      });
    }

    // Active state management
    ScrollTrigger.create({
      trigger: item,
      start: "top 55%",
      end: "bottom 45%",
      onEnter: () => {
        item.classList.add("is-active");
        const visibleItems = Array.from(
          timeline.querySelectorAll(".exp-item:not(.is-hidden)"),
        );
        const index = visibleItems.indexOf(item);
        if (counterEl && !item.classList.contains("is-hidden")) {
          counterEl.textContent = String(index + 1).padStart(2, "0");
        }
      },
      onLeave: () => item.classList.remove("is-active"),
      onEnterBack: () => {
        item.classList.add("is-active");
        const visibleItems = Array.from(
          timeline.querySelectorAll(".exp-item:not(.is-hidden)"),
        );
        const index = visibleItems.indexOf(item);
        if (counterEl && !item.classList.contains("is-hidden")) {
          counterEl.textContent = String(index + 1).padStart(2, "0");
        }
      },
      onLeaveBack: () => item.classList.remove("is-active"),
    });

    // Parallax on year background
    if (yearBg) {
      gsap.to(yearBg, {
        y: -30,
        ease: "none",
        scrollTrigger: {
          trigger: item,
          start: "top bottom",
          end: "bottom top",
          scrub: 1,
        },
      });
    }
  });

  // Journey end animation
  const timelineEnd = document.getElementById("timeline-end");
  if (timelineEnd) {
    gsap.from(timelineEnd, {
      y: 20,
      opacity: 0,
      duration: 0.8,
      ease: "power3.out",
      scrollTrigger: {
        trigger: timelineEnd,
        start: "top 90%",
        toggleActions: "play none none none",
      },
    });
  }
})();

// ==================== CREDENTIALS ====================
gsap.from(".cert-item", {
  x: -30,
  opacity: 0,
  duration: 0.8,
  stagger: 0.1,
  ease: "power3.out",
  scrollTrigger: { trigger: ".cert-list", start: "top 80%" },
});

// ==================== CONTACT ====================
// Form submission via Web3Forms API - NO redirect, NO page reload

function resetForm() {
  var contactForm = document.getElementById("contact-form");
  var submitBtn = document.getElementById("submit-btn");
  var successOverlay = document.getElementById("contact-success");
  if (contactForm) contactForm.reset();
  if (submitBtn) {
    submitBtn.classList.remove("sent");
    submitBtn.disabled = false;
  }
  if (successOverlay) successOverlay.classList.remove("active");
}

// Contact section entrance animations
// ==================== NAV ====================
let lastScrollY = 0;
var isNavScrolling = false;
const nav = document.getElementById("main-nav");
ScrollTrigger.create({
  onUpdate: (self) => {
    if (!nav) return;
    if (isNavScrolling) {
      lastScrollY = self.scroll();
      return;
    }
    if (self.scroll() > lastScrollY && self.scroll() > 200)
      nav.classList.add("hidden-nav");
    else nav.classList.remove("hidden-nav");
    lastScrollY = self.scroll();
  },
});

// Navigation scroll handler — forces same-page scroll, never opens new tab
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const href = this.getAttribute("href");
    if (!href || href === "#") return;
    const target = document.querySelector(href);
    if (target) {
      isNavScrolling = true;
      if (nav) nav.classList.remove("hidden-nav");
      gsap.killTweensOf(window);
      gsap.to(window, {
        duration: 1.0,
        scrollTo: { y: target, offsetY: 80, autoKill: true },
        ease: "power3.inOut",
        overwrite: "auto",
        onComplete: () => {
          isNavScrolling = false;
          if (history.replaceState) {
            history.replaceState(null, null, href);
          }
        },
        onInterrupt: () => {
          isNavScrolling = false;
        },
      });
    }
  });
});

document.querySelectorAll("a, button").forEach((el) => {
  el.addEventListener("mousemove", (e) => {
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    el.style.transform = `translate(${x * 0.2}px, ${y * 0.2}px)`;
  });
  el.addEventListener("mouseleave", () => {
    el.style.transform = "translate(0, 0)";
  });
});

// ==================== CASE STUDIES ====================
const caseStudies = [
  {
    title: "NeuralVision",
    image:
      "https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=1600&h=900&fit=crop",
    year: "2024",
    tags: ["PyTorch", "FastAPI", "OpenCV"],
    challenge:
      "Real-time object detection on edge devices with limited compute.",
    solution:
      "Custom YOLOv8 architecture with quantization-aware training and TensorRT optimization.",
    result: "120 FPS on Jetson Nano, 40% better mAP than baseline.",
    arch: "camera → preprocessor → yolo8 → nms → api → client",
  },
  {
    title: "ChatGenius AI",
    image:
      "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1600&h=900&fit=crop",
    year: "2024",
    tags: ["React", "Node.js", "Pinecone"],
    challenge:
      "Building a conversational AI that remembers context across long sessions.",
    solution:
      "RAG architecture with Pinecone vector store, custom chunking strategy, and fine-tuned reranker.",
    result: "50K+ monthly conversations, 94% user satisfaction.",
    arch: "user → react → node → openai → pinecone → response",
  },
  {
    title: "CloudScale",
    image:
      "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&h=900&fit=crop",
    year: "2023",
    tags: ["Next.js", "Go", "Kubernetes"],
    challenge: "Reducing cloud infrastructure costs for microservices.",
    solution:
      "Predictive auto-scaling based on request patterns and custom K8s operators.",
    result: "40% cost reduction, 99.99% uptime.",
    arch: "ingress → go-api → k8s → hpa → prometheus → alert",
  },
  {
    title: "VisionAR",
    image:
      "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=1600&h=900&fit=crop",
    year: "2024",
    tags: ["Unity", "C#", "ARKit"],
    challenge: "Real-time AR overlay with accurate world positioning.",
    solution:
      "Custom SLAM pipeline with CV-based feature detection and Unity render integration.",
    result: "Featured in campus showcase, 10K+ downloads.",
    arch: "camera → slam → unity → render → overlay → user",
  },
  {
    title: "Ivory CV Builder",
    image:
      "https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=1600&h=900&fit=crop",
    year: "2025",
    tags: ["Next.js", "TypeScript", "Tailwind"],
    challenge:
      "Creating an intuitive resume builder that generates professional CVs without design expertise.",
    solution:
      "AI-assisted content suggestions, real-time PDF preview engine, and a modular template system with drag-and-drop customization.",
    result:
      "Streamlined resume creation for users, reducing build time from hours to minutes.",
    arch: "user → editor → preview → pdf-engine → download",
  },
];

function openCaseStudy(index) {
  const study = caseStudies[index];
  const modal = document.getElementById("case-modal");
  const content = document.getElementById("case-content");
  if (!modal || !content) return;
  content.innerHTML = `
    <div class="case-hero">
      <img src="${study.image}" alt="${study.title}">
      <div class="case-title">${study.title}</div>
    </div>
    <div class="case-body">
      <div class="case-meta">
        <div class="case-meta-item"><div class="label">Year</div><p>${study.year}</p></div>
        <div class="case-meta-item"><div class="label">Stack</div><p>${study.tags.join(", ")}</p></div>
        <div class="case-meta-item"><div class="label">Status</div><p>Production</p></div>
      </div>
      <h3>The Challenge</h3><p>${study.challenge}</p>
      <h3>The Solution</h3><p>${study.solution}</p>
      <div class="case-arch"><svg viewBox="0 0 800 300" preserveAspectRatio="xMidYMid meet">${generateArchSVG(study.arch)}</svg></div>
      <h3>The Result</h3><p>${study.result}</p>
    </div>`;
  modal.classList.add("active");
  document.body.style.overflow = "hidden";
  gsap.from(".case-hero img", {
    scale: 1.1,
    duration: 1.5,
    ease: "power3.out",
  });
  gsap.from(".case-title", {
    y: 50,
    opacity: 0,
    duration: 1,
    delay: 0.3,
    ease: "power3.out",
  });
  gsap.from(".case-body > *", {
    y: 30,
    opacity: 0,
    duration: 0.8,
    stagger: 0.1,
    delay: 0.5,
    ease: "power3.out",
  });
}
function closeCaseStudy() {
  const modal = document.getElementById("case-modal");
  if (modal) modal.classList.remove("active");
  document.body.style.overflow = "";
}
function generateArchSVG(arch) {
  const nodes = arch.split(" → ");
  const gap = 800 / (nodes.length + 1);
  let svg = "";
  nodes.forEach((node, i) => {
    const x = gap * (i + 1);
    const y = 150;
    svg += `<rect x="${x - 60}" y="${y - 25}" width="120" height="50" rx="4" class="arch-node" />`;
    svg += `<text x="${x}" y="${y + 5}" text-anchor="middle" class="arch-label">${node}</text>`;
    if (i < nodes.length - 1) {
      svg += `<line x1="${x + 60}" y1="${y}" x2="${gap * (i + 2) - 60}" y2="${y}" class="arch-line" />`;
      svg += `<polygon points="${gap * (i + 2) - 60},${y - 5} ${gap * (i + 2) - 50},${y} ${gap * (i + 2) - 60},${y + 5}" fill="var(--dim)" />`;
    }
  });
  return svg;
}

// ==================== COMMAND PALETTE ====================
const palette = document.getElementById("command-palette");
const paletteInput = document.getElementById("palette-input");
const paletteResults = document.getElementById("palette-results");
let selectedIndex = 0;
const paletteCommands = [
  {
    title: "Go to Profile",
    desc: "Navigate to about section",
    icon: "user",
    action: () => scrollTo("#profile"),
    shortcut: "G P",
  },
  {
    title: "Go to Work",
    desc: "View experience",
    icon: "briefcase",
    action: () => scrollTo("#experience"),
    shortcut: "G W",
  },
  {
    title: "Go to Credentials",
    desc: "View certificates",
    icon: "award",
    action: () => scrollTo("#credentials"),
    shortcut: "G C",
  },
  {
    title: "Go to Contact",
    desc: "Send a message",
    icon: "mail",
    action: () => scrollTo("#contact"),
    shortcut: "G M",
  },
  {
    title: "Open NeuralVision",
    desc: "View case study",
    icon: "eye",
    action: () => openCaseStudy(0),
    shortcut: "1",
  },
  {
    title: "Open ChatGenius",
    desc: "View case study",
    icon: "message-circle",
    action: () => openCaseStudy(1),
    shortcut: "2",
  },
  {
    title: "Open CloudScale",
    desc: "View case study",
    icon: "cloud",
    action: () => openCaseStudy(2),
    shortcut: "3",
  },
  {
    title: "Open VisionAR",
    desc: "View case study",
    icon: "glasses",
    action: () => openCaseStudy(3),
    shortcut: "4",
  },
  {
    title: "Toggle Audio",
    desc: "Ambient drone",
    icon: "volume-2",
    action: toggleAudio,
    shortcut: "A",
  },
  {
    title: "Admin Terminal",
    desc: "Secure shell",
    icon: "terminal",
    action: openAdmin,
    shortcut: "Cmd+.",
  },
  {
    title: "Open Ivory CV",
    desc: "View case study",
    icon: "file-text",
    action: () => openCaseStudy(4),
    shortcut: "5",
  },
];
function scrollTo(sel) {
  isNavScrolling = true;
  if (nav) nav.classList.remove("hidden-nav");
  gsap.to(window, {
    duration: 1.5,
    scrollTo: { y: sel, offsetY: 80 },
    ease: "power3.inOut",
    onComplete: () => {
      isNavScrolling = false;
    },
    onInterrupt: () => {
      isNavScrolling = false;
    },
  });
  closePalette();
}
function openPalette() {
  if (!palette) return;
  palette.classList.add("active");
  if (paletteInput) {
    paletteInput.value = "";
    paletteInput.focus();
  }
  renderPalette("");
  selectedIndex = 0;
}
function closePalette() {
  if (palette) palette.classList.remove("active");
}
function renderPalette(query) {
  if (!paletteResults) return;
  const filtered = query
    ? paletteCommands.filter(
        (c) =>
          c.title.toLowerCase().includes(query.toLowerCase()) ||
          c.desc.toLowerCase().includes(query.toLowerCase()),
      )
    : paletteCommands;
  paletteResults.innerHTML = filtered.length
    ? filtered
        .map(
          (c, i) => `
      <div class="palette-item ${i === selectedIndex ? "selected" : ""}" onclick="runPaletteAction(${paletteCommands.indexOf(c)})">
        <div class="palette-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${getIconSvg(c.icon)}</svg></div>
        <div class="palette-text"><div class="palette-title">${c.title}</div><div class="palette-desc">${c.desc}</div></div>
        <div class="palette-shortcut">${c.shortcut}</div>
      </div>`,
        )
        .join("")
    : '<div class="palette-empty">No results found</div>';
}
function getIconSvg(name) {
  const icons = {
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
    briefcase:
      '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>',
    award:
      '<circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>',
    mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>',
    "message-circle":
      '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>',
    cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>',
    glasses:
      '<circle cx="6" cy="15" r="4"></circle><circle cx="18" cy="15" r="4"></circle><path d="M14 15a2 2 0 0 0-2-2 2 2 0 0 0-2 2"></path>',
    "volume-2":
      '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>',
    terminal:
      '<polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>',
    "file-text":
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline>',
  };
  return icons[name] || "";
}
function runPaletteAction(index) {
  paletteCommands[index].action();
}
if (paletteInput) {
  paletteInput.addEventListener("input", (e) => {
    selectedIndex = 0;
    renderPalette(e.target.value);
  });
}
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    openPalette();
  }
  if (e.key === "Escape") {
    closePalette();
    closeCaseStudy();
    closeAdmin();
  }
  if (!palette || !palette.classList.contains("active")) return;
  if (e.key === "ArrowDown") {
    selectedIndex = Math.min(
      selectedIndex + 1,
      paletteResults.children.length - 1,
    );
    renderPalette(paletteInput.value);
  }
  if (e.key === "ArrowUp") {
    selectedIndex = Math.max(selectedIndex - 1, 0);
    renderPalette(paletteInput.value);
  }
  if (e.key === "Enter") {
    const items = paletteResults.querySelectorAll(".palette-item");
    if (items[selectedIndex]) items[selectedIndex].click();
  }
});

// ==================== CONTEXT MENU ====================
const ctxMenu = document.getElementById("custom-context");
if (ctxMenu) {
  document.addEventListener("contextmenu", (e) => {
    if (e.target.closest("input") || e.target.closest("textarea")) return;
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 250);
    ctxMenu.style.left = x + "px";
    ctxMenu.style.top = y + "px";
    ctxMenu.classList.add("active");
  });
  document.addEventListener("click", () => ctxMenu.classList.remove("active"));
}
function ctxAction(action) {
  if (action === "reload") location.reload();
  if (action === "palette") openPalette();
  if (action === "contact") scrollTo("#contact");
  if (action === "source") {
    const w = window.open();
    w.document.write(
      "<pre>" +
        document.documentElement.outerHTML
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;") +
        "</pre>",
    );
  }
  if (action === "admin") openAdmin();
  if (ctxMenu) ctxMenu.classList.remove("active");
}

// ==================== KONAMI ====================
const konamiSequence = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];
let konamiIndex = 0;
document.addEventListener("keydown", (e) => {
  if (e.key === konamiSequence[konamiIndex]) {
    konamiIndex++;
    if (konamiIndex === konamiSequence.length) {
      triggerMatrix();
      konamiIndex = 0;
    }
  } else {
    konamiIndex = 0;
  }
});
function triggerMatrix() {
  const canvas = document.getElementById("matrix-canvas");
  if (!canvas) return;
  canvas.classList.add("active");
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const chars =
    "01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
  const fontSize = 14;
  const columns = canvas.width / fontSize;
  const drops = Array(Math.floor(columns)).fill(1);
  function drawMatrix() {
    if (!canvas.classList.contains("active")) return;
    ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0F0";
    ctx.font = fontSize + "px monospace";
    for (let i = 0; i < drops.length; i++) {
      const text = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(text, i * fontSize, drops[i] * fontSize);
      if (drops[i] * fontSize > canvas.height && Math.random() > 0.975)
        drops[i] = 0;
      drops[i]++;
    }
    requestAnimationFrame(drawMatrix);
  }
  drawMatrix();
  setTimeout(() => {
    canvas.classList.remove("active");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, 8000);
}

// ==================== ADMIN ====================
const adminTerm = document.getElementById("admin-terminal");
const termBody = document.getElementById("term-body");
const termInput = document.getElementById("term-input");
let isAdmin = false;
function openAdmin() {
  if (!adminTerm) return;
  adminTerm.classList.add("active");
  document.body.style.overflow = "hidden";
  if (termInput) termInput.focus();
}
function closeAdmin() {
  if (!adminTerm) return;
  adminTerm.classList.remove("active");
  document.body.style.overflow = "";
}
if (termInput) {
  termInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const cmd = termInput.value.trim();
      termInput.value = "";
      appendTerm(`<span class="term-prompt">root@portfolio:~$</span> ${cmd}`);
      processCommand(cmd);
    }
  });
}
function appendTerm(html) {
  if (!termBody) return;
  const line = document.createElement("div");
  line.className = "term-line";
  line.innerHTML = html;
  const inputLine = termBody.querySelector(".term-input-line");
  if (inputLine) termBody.insertBefore(line, inputLine);
  else termBody.appendChild(line);
  termBody.scrollTop = termBody.scrollHeight;
}
function processCommand(cmd) {
  const parts = cmd.split(" ");
  const base = parts[0].toLowerCase();
  if (base === "help")
    appendTerm("Commands: help, login, projects, certs, messages, clear, exit");
  else if (base === "login") {
    if (parts[1] === "admin123") {
      isAdmin = true;
      appendTerm(
        '<span style="color:var(--terminal-amber)">Authentication successful. Welcome, Administrator.</span>',
      );
    } else {
      appendTerm(
        '<span style="color:#ff4444">Authentication failed. Usage: login [password]</span>',
      );
    }
  } else if (base === "projects") {
    caseStudies.forEach((p, i) =>
      appendTerm(`[${i + 1}] ${p.title} (${p.year}) — ${p.tags.join(", ")}`),
    );
  } else if (base === "certs") {
    appendTerm("TensorFlow Developer — Google (2024)");
    appendTerm("Azure AI Engineer — Microsoft (2024)");
    appendTerm("AWS Solutions Architect — Amazon (2023)");
    appendTerm("Deep Learning Spec — Coursera (2023)");
  } else if (base === "messages") {
    if (!isAdmin) {
      appendTerm(
        '<span style="color:#ff4444">Access denied. Login required.</span>',
      );
      return;
    }
    appendTerm("No new messages.");
  } else if (base === "clear") {
    if (termBody)
      termBody.querySelectorAll(".term-line").forEach((l) => l.remove());
  } else if (base === "exit") {
    closeAdmin();
  } else if (cmd) {
    appendTerm(`<span style="color:#ff4444">Command not found: ${cmd}</span>`);
  }
}

// ==================== 3D ID CARD ====================
(function () {
  const card = document.getElementById("id-card-3d");
  const wrapper = document.getElementById("id-card-3d-wrapper");
  if (!card || !wrapper) return;

  let bounds,
    mX = 0,
    mY = 0,
    currentX = 0,
    currentY = 0;
  let isHovering = false;

  function updateBounds() {
    bounds = wrapper.getBoundingClientRect();
  }
  function lerp(start, end, factor) {
    return start + (end - start) * factor;
  }
  function animate() {
    const targetX = isHovering ? (mY / bounds.height - 0.5) * -25 : 0;
    const targetY = isHovering ? (mX / bounds.width - 0.5) * 25 : 0;
    currentX = lerp(currentX, targetX, 0.08);
    currentY = lerp(currentY, targetY, 0.08);
    card.style.transform = `rotateX(${currentX}deg) rotateY(${currentY}deg)`;
    const shadow = card.querySelector(".id-card-shadow");
    if (shadow) {
      const shadowX = currentY * -0.8;
      const shadowScale = 1 + Math.abs(currentX) * 0.01;
      shadow.style.transform = `translateX(calc(-50% + ${shadowX}px)) scale(${shadowScale})`;
    }
    requestAnimationFrame(animate);
  }

  wrapper.addEventListener("mouseenter", () => {
    isHovering = true;
    updateBounds();
  });
  wrapper.addEventListener("mouseleave", () => {
    isHovering = false;
  });
  wrapper.addEventListener("mousemove", (e) => {
    mX = e.clientX - bounds.left;
    mY = e.clientY - bounds.top;
  });
  wrapper.addEventListener(
    "touchstart",
    (e) => {
      isHovering = true;
      updateBounds();
      const t = e.touches[0];
      mX = t.clientX - bounds.left;
      mY = t.clientY - bounds.top;
    },
    { passive: true },
  );
  wrapper.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      mX = t.clientX - bounds.left;
      mY = t.clientY - bounds.top;
    },
    { passive: true },
  );
  wrapper.addEventListener("touchend", () => {
    isHovering = false;
  });

  window.addEventListener("resize", updateBounds);
  updateBounds();
  animate();

  // ===== END OF JOURNEY ANIMATION =====
  const timelineEnd = document.getElementById("timeline-end");
  if (timelineEnd) {
    ScrollTrigger.create({
      trigger: timelineEnd,
      start: "top 90%",
      onEnter: () => {
        timelineEnd.classList.add("is-visible");
        gsap.from(timelineEnd.querySelector(".end-line"), {
          scaleY: 0,
          transformOrigin: "top center",
          duration: 1,
          ease: "power3.out",
        });
        gsap.from(timelineEnd.querySelector(".end-text"), {
          y: 20,
          opacity: 0,
          duration: 0.8,
          delay: 0.3,
          ease: "power3.out",
        });
        gsap.from(timelineEnd.querySelector(".end-subtext"), {
          y: 15,
          opacity: 0,
          duration: 0.8,
          delay: 0.5,
          ease: "power3.out",
        });
      },
      once: true,
    });
  }

  // ===== KEYBOARD NAVIGATION =====
  let focusedIndex = -1;
  const visibleItems = () =>
    Array.from(timeline.querySelectorAll(".exp-item:not(.is-hidden)"));

  timeline.addEventListener("keydown", (e) => {
    const items = visibleItems();
    if (!items.length) return;

    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      focusedIndex = Math.min(focusedIndex + 1, items.length - 1);
      items[focusedIndex].querySelector(".exp-card")?.focus();
      items[focusedIndex].scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, 0);
      items[focusedIndex].querySelector(".exp-card")?.focus();
      items[focusedIndex].scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    } else if (e.key === "Home") {
      e.preventDefault();
      focusedIndex = 0;
      items[0].querySelector(".exp-card")?.focus();
      items[0].scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (e.key === "End") {
      e.preventDefault();
      focusedIndex = items.length - 1;
      items[focusedIndex].querySelector(".exp-card")?.focus();
      items[focusedIndex].scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  });

  // Make cards focusable
  items.forEach((item, i) => {
    const card = item.querySelector(".exp-card");
    if (card) {
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "article");
      card.addEventListener("focus", () => {
        focusedIndex = i;
        item.classList.add("is-active");
      });
      card.addEventListener("blur", () => {
        item.classList.remove("is-active");
      });
    }
  });
})();

// ==================== WEB3FORMS CONTACT HANDLER ====================
// Global function called via inline onclick

function handleContactSubmit() {
  "use strict";

  // CRITICAL: Key defined INSIDE function to avoid scope issues
  var WEB3FORMS_KEY = "33dc593c-6a92-4aa2-8adf-ee0cea50932a";

  var form = document.getElementById("contact-form");
  var submitBtn = document.getElementById("submit-btn");
  var successOverlay = document.getElementById("contact-success");

  if (!form) {
    console.error("[Web3Forms] Form not found");
    return false;
  }
  if (!submitBtn) {
    console.error("[Web3Forms] Button not found");
    return false;
  }

  if (submitBtn.disabled) return false;

  var nameField = document.getElementById("cf-name");
  var emailField = document.getElementById("cf-email");
  var msgField = document.getElementById("cf-message");

  if (!nameField || !emailField || !msgField) {
    console.error("[Web3Forms] Fields not found");
    return false;
  }

  var name = nameField.value.trim();
  var email = emailField.value.trim();
  var message = msgField.value.trim();

  if (!name) {
    alert("Please enter your name.");
    nameField.focus();
    return false;
  }
  if (!email) {
    alert("Please enter your email.");
    emailField.focus();
    return false;
  }
  if (!message) {
    alert("Please enter your message.");
    msgField.focus();
    return false;
  }

  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert("Please enter a valid email address.");
    emailField.focus();
    return false;
  }

  // Show sending state
  submitBtn.disabled = true;
  submitBtn.classList.add("sending");

  // DEBUG: Log key value
  console.log("[Web3Forms] Key:", WEB3FORMS_KEY);
  console.log("[Web3Forms] Sending...");

  // Build JSON payload
  var payload = {
    access_key: WEB3FORMS_KEY,
    name: name,
    email: email,
    message: message,
    subject: "New Portfolio Message from " + name,
    from_name: "Portfolio Contact Form",
  };

  console.log("[Web3Forms] Payload:", JSON.stringify(payload));

  fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  })
    .then(function (response) {
      console.log("[Web3Forms] Status:", response.status);
      return response.json();
    })
    .then(function (data) {
      console.log("[Web3Forms] Response:", data);
      submitBtn.classList.remove("sending");
      submitBtn.disabled = false;

      if (data.success) {
        console.log("[Web3Forms] SUCCESS!");
        submitBtn.classList.add("sent");
        if (successOverlay) successOverlay.classList.add("active");
        form.reset();
      } else {
        console.error("[Web3Forms] Failed:", data);
        alert("Failed to send: " + (data.message || "Unknown error"));
      }
    })
    .catch(function (err) {
      console.error("[Web3Forms] Error:", err);
      submitBtn.classList.remove("sending");
      submitBtn.disabled = false;
      alert("Network error. Please check your connection and try again.");
    });

  return false;
}

// ==================== MOOD SWINGER VIDEO PLAYER ====================
// Videos are now directly embedded in HTML (meme1.mp4 & meme2.mp4)
// No dynamic loading needed - native HTML5 video elements with controls

// ==================== MOOD SWINGER VIDEO PLAYER ====================
// Click thumbnail → hide image + play button → show video

function playMoodVideo(id) {
  var thumb = document.getElementById("mood-thumb-" + id);
  var video = document.getElementById("mood-video-" + id);
  if (!thumb || !video) return;

  // Show video, hide thumbnail
  thumb.classList.add("is-playing");
  video.classList.add("is-playing");
  video.setAttribute("preload", "auto");

  // Add close button if not exists
  if (!thumb.querySelector(".mood-close-btn")) {
    var closeBtn = document.createElement("button");
    closeBtn.className = "mood-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.setAttribute("aria-label", "Close video");
    closeBtn.onclick = function (e) {
      e.stopPropagation();
      closeMoodVideo(id);
    };
    thumb.appendChild(closeBtn);
  }

  // Try to play
  try {
    video.play();
  } catch (e) {
    console.log("[Mood] Auto-play prevented:", e);
  }
}

function closeMoodVideo(id) {
  var thumb = document.getElementById("mood-thumb-" + id);
  var video = document.getElementById("mood-video-" + id);
  if (!thumb || !video) return;

  video.pause();
  video.currentTime = 0;
  video.classList.remove("is-playing");
  thumb.classList.remove("is-playing");

  // Remove close button
  var closeBtn = thumb.querySelector(".mood-close-btn");
  if (closeBtn) closeBtn.remove();
}

// ==================== MOOD SWINGER ANIMATIONS ====================
(function () {
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined")
    return;
  gsap.from("#mood-swinger .section-header", {
    y: 50,
    opacity: 0,
    duration: 1,
    ease: "power3.out",
    scrollTrigger: { trigger: "#mood-swinger", start: "top 80%" },
  });
  gsap.from(".mood-tile", {
    y: 80,
    opacity: 0,
    scale: 0.9,
    duration: 0.8,
    stagger: 0.2,
    ease: "power3.out",
    scrollTrigger: { trigger: ".mood-grid", start: "top 85%" },
  });
})();
