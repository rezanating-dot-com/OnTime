import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * How long the loop keeps drawing after something last changed the scene,
 * before it parks. Long enough to cover OrbitControls' damping settle
 * (dampingFactor 0.08) plus a comfortable margin.
 */
const SETTLE_MS = 900;

// Scratch vectors for the per-frame paths below. Allocating inside the render
// loop is steady GC pressure on a device that is already rendering WebGL on
// battery; these are reused instead. Each is private to the one method named
// in its comment, so nothing can alias another's value across a frame.
/** facing() only. */
const FACING_EYE = new THREE.Vector3();
/** facing() only. */
const FACING_POINT = new THREE.Vector3();
/** normalizeSprites() only. */
const SPRITE_WORLD = new THREE.Vector3();

export interface Palette {
  primary: string;
  text: string;
  muted: string;
  card: string;
  border: string;
  /** Cheap identity for change detection. */
  key: string;
}

/**
 * Shared lifecycle for the app's WebGL views.
 *
 * Subclasses implement `build()` and may implement `applyColors()`,
 * `configureControls()` and `tick()`. Colours come from the CSS custom
 * properties on the host element, so every view follows the active theme
 * without being told which one it is.
 *
 * The render loop is suspended whenever the view is off-screen or the app is
 * backgrounded — these run on phones, and a permanently spinning rAF on the
 * home screen is a battery leak. It also parks when nothing has changed for
 * SETTLE_MS: gating only on visibility still meant a full rAF and a full
 * render pass for as long as the Qibla overlay stayed open, on a scene that
 * was completely static. Everything that can change what is on screen calls
 * wake(); a view whose tick() animates on its own clock opts out of parking
 * with animatesContinuously().
 */
export abstract class Base3D<TData = unknown> {
  protected host: HTMLElement;
  protected renderer!: THREE.WebGLRenderer;
  protected scene!: THREE.Scene;
  protected camera!: THREE.PerspectiveCamera;
  protected controls!: OrbitControls;
  protected colors!: Palette;
  protected data: TData;
  /** Sprites kept at a constant on-screen size regardless of depth. */
  protected sprites: THREE.Sprite[] = [];

  /** Called when the user has moved the view away from its default. */
  onAdjustedChange?: (adjusted: boolean) => void;
  private homeCamera?: THREE.Vector3;
  private homeTarget?: THREE.Vector3;
  private adjusted = false;

  private raf = 0;
  /** False once the loop has parked for want of anything to draw. */
  private awake = true;
  private idleTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private ro?: ResizeObserver;
  private io?: IntersectionObserver;
  private start = 0;
  private visible = true;
  private onScreen = true;
  private disposed = false;
  private themeObserver?: MutationObserver;
  private onVisibility = () => {
    this.visible = !document.hidden;
    if (this.visible) this.wake();
    else this.syncLoop();
  };

  constructor(host: HTMLElement, data: TData) {
    this.host = host;
    this.data = data;
  }

  mount(): void {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    this.host.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.start = performance.now();

    this.colors = this.readColors();
    this.build();

    this.controls = new OrbitControls(this.camera, canvas);
    // 10% gentler than the default, which overshoots on a phone-sized canvas.
    this.controls.rotateSpeed = 0.9;
    this.controls.enableZoom = true;
    this.controls.zoomSpeed = 0.8;
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // One finger turns the globe, two pinch to zoom.
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.configureControls();

    this.homeCamera = this.camera.position.clone();
    this.homeTarget = this.controls.target.clone();
    this.controls.addEventListener('start', () => this.wake());
    this.controls.addEventListener('start', () => this.markAdjusted(true));
    // Fired for every camera move, including each frame of a damping settle
    // and of autoRotate — so this one listener covers the whole of "the user
    // is still interacting with it".
    this.controls.addEventListener('change', () => {
      this.wake();
      if (!this.homeCamera) return;
      // Zoom fires 'change' without 'start' on a trackpad or wheel.
      if (Math.abs(this.camera.position.length() - this.homeCamera.length()) > 0.02) {
        this.markAdjusted(true);
      }
    });

    this.ro = new ResizeObserver(() => {
      this.resize();
      this.wake();
    });
    this.ro.observe(this.host);
    this.resize();

    this.io = new IntersectionObserver(
      ([entry]) => {
        // An element still being laid out measures as zero-sized and reports
        // "not intersecting"; pausing on that would freeze the view for good,
        // since nothing would move it back on screen.
        const hasArea = entry.boundingClientRect.width > 0 && entry.boundingClientRect.height > 0;
        this.onScreen = entry.isIntersecting || !hasArea;
        // Coming back on screen has to draw at least one frame: whatever
        // changed underneath while it was hidden has never been painted.
        if (this.onScreen) this.wake();
        else this.syncLoop();
      },
      { threshold: 0 }
    );
    this.io.observe(this.host);

    document.addEventListener('visibilitychange', this.onVisibility);

    // Themes are a class swap on <html>. Watch for it directly: polling from
    // the render loop missed the change whenever the loop was paused.
    this.themeObserver = new MutationObserver(() => this.refreshColors());
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });

    this.wake();
  }

  /**
   * Draw now, and keep drawing for a moment, then park again. Subclasses call
   * this whenever async work (a texture, a geometry rebuild) lands after the
   * loop may already have gone quiet.
   */
  protected wake(ms = SETTLE_MS): void {
    if (this.disposed) return;
    this.awake = true;
    this.syncLoop();
    this.scheduleIdlePause(ms);
  }

  private scheduleIdlePause(ms: number): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = 0;
    // A view that animates on its own clock never goes quiet, so don't churn
    // a timer per frame trying to park it.
    if (this.keepsRendering()) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = 0;
      this.awake = false;
      this.syncLoop();
    }, ms);
  }

  /** True while something in the scene is still moving of its own accord. */
  private keepsRendering(): boolean {
    return this.animatesContinuously() || !!this.controls?.autoRotate;
  }

  /**
   * Override to true in a view whose tick() animates on a clock rather than
   * only in response to input or new data — SunDome's pulsing halo, say.
   * Such a view never parks.
   */
  protected animatesContinuously(): boolean {
    return false;
  }

  /** True once the user has dragged or zoomed away from the default view. */
  isAdjusted(): boolean {
    return this.adjusted;
  }

  /** True after dispose() — async work must check this before touching GL state. */
  protected isDisposed(): boolean {
    return this.disposed;
  }

  /** Put the camera back where it started and hand control back to the app. */
  resetView(): void {
    if (!this.homeCamera || !this.homeTarget) return;
    this.camera.position.copy(this.homeCamera);
    this.controls.target.copy(this.homeTarget);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.onReset();
    this.markAdjusted(false);
    this.wake();
  }

  protected markAdjusted(value: boolean): void {
    if (this.adjusted === value) return;
    this.adjusted = value;
    this.onAdjustedChange?.(value);
  }

  /** Distance the framing logic wants the camera at, ignoring user zoom. */
  protected get framedDistance(): number {
    return this.homeCamera?.length() ?? this.camera.position.length();
  }

  protected setFramedDistance(distance: number, minFactor = 0.45, maxFactor = 1.15): void {
    this.homeCamera?.setLength(distance);
    this.controls.minDistance = distance * minFactor;
    this.controls.maxDistance = distance * maxFactor;
  }

  /** Push fresh app data into a mounted view. */
  update(data: TData): void {
    this.data = data;
    if (this.disposed || !this.renderer) return;
    this.onData(data);
    this.wake();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = 0;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.themeObserver?.disconnect();
    this.ro?.disconnect();
    this.io?.disconnect();
    this.controls?.dispose();
    this.scene?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => disposeMaterial(x));
      else if (m) disposeMaterial(m);
    });
    this.renderer?.dispose();
    // Dropping the JavaScript objects is not enough. The WebGL context holds
    // its own allocation in the GPU driver, and on Android that allocation
    // survives dispose() and the canvas being removed — every open of a scene
    // that had been closed added its whole graphics cost again, permanently.
    // Losing the context is what actually hands the memory back.
    this.renderer?.forceContextLoss();
    this.renderer?.domElement?.remove();
  }

  // ── subclass hooks ──────────────────────────────────────────────────────
  protected abstract build(): void;
  /**
   * How squarely a point faces the viewer: 1 dead centre, 0 at the silhouette,
   * negative round the back. Used to let the far side of an instrument recede
   * instead of showing through it.
   */
  protected facing(worldPosition: THREE.Vector3): number {
    // Scratch vectors, not clones: subclasses call this once per marker per
    // frame, and these views run on a phone's battery. Neither may be a vector
    // a caller passed in, so they are private to this method.
    const eye = FACING_EYE.copy(this.camera.position).sub(this.controls.target).normalize();
    return FACING_POINT.copy(worldPosition).sub(this.controls.target).normalize().dot(eye);
  }

  /**
   * Map a facing value onto an opacity. The far side recedes rather than
   * vanishing — it still has to be readable once you turn the instrument
   * round, and a hard cut flickers while the view drifts.
   */
  protected depthOpacity(facing: number, back = 0.3, front = 1): number {
    const t = Math.max(0, Math.min(1, (facing + 0.55) / 0.95));
    // Ease so most of the change happens around the silhouette.
    const eased = t * t * (3 - 2 * t);
    return back + (front - back) * eased;
  }

  protected applyColors(): void {}
  protected configureControls(): void {}
  protected tick(seconds: number): void {
    void seconds;
  }
  protected onData(data: TData): void {
    void data;
  }
  /** Subclass hook fired by resetView, before the adjusted flag clears. */
  protected onReset(): void {}

  // ── internals ───────────────────────────────────────────────────────────
  protected readColors(): Palette {
    const s = getComputedStyle(this.host);
    const g = (n: string, fallback: string) => (s.getPropertyValue(n) || '').trim() || fallback;
    const c = {
      primary: g('--color-primary', '#6B8AFF'),
      text: g('--color-text', '#F5F6F8'),
      muted: g('--color-muted', '#9CA3AF'),
      card: g('--color-card', '#16181D'),
      border: g('--color-border', '#2A2E38'),
    };
    return { ...c, key: [c.primary, c.text, c.muted, c.card, c.border].join('|') };
  }

  protected resize(): void {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private syncLoop(): void {
    const shouldRun =
      this.visible && this.onScreen && !this.disposed && (this.awake || this.keepsRendering());
    if (shouldRun && !this.raf) {
      this.raf = requestAnimationFrame(this.loop);
    } else if (!shouldRun && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  /** Re-read the palette and repaint if it actually changed. */
  private refreshColors(): void {
    if (this.disposed || !this.renderer) return;
    const next = this.readColors();
    if (next.key === this.colors.key) return;
    this.colors = next;
    this.applyColors();
    // Repaint immediately: the loop may be paused while off-screen.
    this.renderer.render(this.scene, this.camera);
    this.wake();
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.normalizeSprites();
    this.tick((performance.now() - this.start) / 1000);
    this.renderer.render(this.scene, this.camera);
  };

  private normalizeSprites(): void {
    if (!this.sprites.length) return;
    const ref = this.camera.position.length() || 1;
    const wp = SPRITE_WORLD;
    for (const sp of this.sprites) {
      sp.getWorldPosition(wp);
      const k = this.camera.position.distanceTo(wp) / ref;
      const base = sp.userData.base as { x: number; y: number };
      sp.scale.set(base.x * k, base.y * k, 1);
    }
  }
}

function disposeMaterial(m: THREE.Material): void {
  const withMap = m as THREE.Material & { map?: THREE.Texture };
  withMap.map?.dispose();
  m.dispose();
}

/** A text label drawn to a canvas texture, sized in world units. */
export function labelSprite(
  text: string,
  color: string,
  px = 46,
  worldHeight = 0.16,
  haloColor?: string
): THREE.Sprite {
  const pad = 8;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = `600 ${px}px Ubuntu, system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.width = w;
  c.height = px + pad * 2;

  // Resizing the canvas resets the context, so restate the font.
  ctx.font = font;
  ctx.textBaseline = 'middle';
  // A soft halo in the card colour keeps text legible where it crosses the
  // instrument's own lines. Blurred rather than stroked — an outline reads as
  // embossing on the light themes, where the halo is near-white.
  ctx.fillStyle = color;
  if (haloColor) {
    ctx.shadowColor = haloColor;
    ctx.shadowBlur = px * 0.4;
    ctx.fillText(text, pad, c.height / 2);
    ctx.fillText(text, pad, c.height / 2);
    ctx.shadowBlur = 0;
  }
  ctx.fillText(text, pad, c.height / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set((w / c.height) * worldHeight, worldHeight, 1);
  sp.userData.base = { x: sp.scale.x, y: sp.scale.y };
  sp.userData.label = text;
  return sp;
}

/**
 * A label with the name and its value set differently — the name in the
 * stronger colour with a touch of tracking, the value quieter beside it.
 * Reads as engraving rather than a caption.
 */
export function dualLabelSprite(
  name: string,
  value: string,
  nameColor: string,
  valueColor: string,
  px = 38,
  worldHeight = 0.09,
  haloColor?: string
): THREE.Sprite {
  const pad = 10;
  const gap = px * 0.42;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;

  const nameFont = `600 ${px}px Ubuntu, system-ui, sans-serif`;
  const valueFont = `500 ${px * 0.94}px Ubuntu, system-ui, sans-serif`;
  const tracking = `${Math.round(px * 0.06)}px`;

  const measure = () => {
    ctx.letterSpacing = tracking;
    ctx.font = nameFont;
    const nameWidth = ctx.measureText(name).width;
    ctx.letterSpacing = '0px';
    ctx.font = valueFont;
    return { nameWidth, valueWidth: ctx.measureText(value).width };
  };

  let { nameWidth, valueWidth } = measure();
  c.width = Math.ceil(nameWidth + gap + valueWidth) + pad * 2;
  c.height = px + pad * 2;

  // Resizing clears the context, so restate everything.
  ({ nameWidth, valueWidth } = measure());
  ctx.textBaseline = 'middle';
  const valueX = pad + nameWidth + gap;
  const mid = c.height / 2;

  const draw = (halo: boolean) => {
    ctx.shadowColor = halo ? haloColor! : 'transparent';
    ctx.shadowBlur = halo ? px * 0.45 : 0;
    ctx.letterSpacing = tracking;
    ctx.font = nameFont;
    ctx.fillStyle = nameColor;
    ctx.fillText(name, pad, mid);
    ctx.letterSpacing = '0px';
    ctx.font = valueFont;
    ctx.fillStyle = valueColor;
    ctx.fillText(value, valueX, mid);
  };

  // Two blurred passes build up a soft ground under the text, then the crisp
  // glyphs go on top.
  if (haloColor) {
    draw(true);
    draw(true);
  }
  draw(false);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  sp.scale.set((c.width / c.height) * worldHeight, worldHeight, 1);
  sp.userData.base = { x: sp.scale.x, y: sp.scale.y };
  sp.userData.label = `${name} ${value}`;
  sp.userData.parts = { name, value, px, worldHeight };
  return sp;
}

/**
 * Line material whose opacity falls away on the far side of the instrument.
 *
 * The graticule, the horizon and the sun's track are each one object, so they
 * can't be faded per-object the way markers are. This works out how far each
 * pixel faces the viewer on the GPU instead, so the back of the dome sinks
 * away and stops tangling with the front.
 */
export function depthFadedLineMaterial(
  color: string,
  front: number,
  back: number
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uFront: { value: front },
      uBack: { value: back },
    },
    vertexShader: `
      varying float vFacing;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vFacing = dot(normalize(world.xyz), normalize(cameraPosition));
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uFront;
      uniform float uBack;
      varying float vFacing;
      void main() {
        float t = smoothstep(-0.45, 0.3, vFacing);
        gl_FragColor = vec4(uColor, mix(uBack, uFront, t));
      }
    `,
  });
}

/** Repaint a depth-faded material. */
export function setFadedColor(material: THREE.ShaderMaterial, color: string): void {
  (material.uniforms.uColor.value as THREE.Color).set(color);
}

/** A disc that fades towards its rim — a ground plane, not a plate. */
export function softDiscTexture(color: string, centreAlpha = 0.5, size = 512): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  const a = Math.round(centreAlpha * 255)
    .toString(16)
    .padStart(2, '0');
  gradient.addColorStop(0, `${color}${a}`);
  gradient.addColorStop(0.72, `${color}${a}`);
  gradient.addColorStop(1, `${color}00`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A soft disc of light, for the sun. Reads as glow rather than a ball. */
export function glowSprite(color: string, size = 256): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.32, color);
  gradient.addColorStop(0.55, `${color}59`);
  gradient.addColorStop(1, `${color}00`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  return sp;
}

/** Repaint an existing label sprite in a new colour. */
export function retintSprite(
  sp: THREE.Sprite,
  color: string,
  px = 46,
  worldHeight = 0.16,
  haloColor?: string
): void {
  const fresh = labelSprite(sp.userData.label as string, color, px, worldHeight, haloColor);
  sp.material.map?.dispose();
  sp.material.map = fresh.material.map;
  sp.material.needsUpdate = true;
  fresh.material.dispose();
}

export { THREE };
