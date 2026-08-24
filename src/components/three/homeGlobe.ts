import { Base3D, THREE } from './base3d';
import { buildEarthTexture } from './earthTexture';
import { subSolarPoint, latLonToVec3, normalize, type Vec3 } from '../../services/solarGeometry';
import { getCloudImagery, extractCloudAlpha } from '../../services/cloudImagery';

export interface HomeGlobeData {
  now: Date;
}

const STAR_COUNT = 1400;
const STAR_RADIUS = 40;
const NIGHT_COLOR = new THREE.Color('#0a1020');
/** Radians per second — a full rotation takes roughly 6.5 minutes. Slow, ambient. */
const EARTH_SPIN_SPEED = 0.016;

const v3 = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);

/** A 1x1 neutral-gray placeholder so the day/night shader always has a valid sampler bound. */
function placeholderTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([80, 80, 80, 255]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Full-page ambient globe for the Home screen: a starfield, a rotating earth
 * with real coastlines, and a live day/night terminator computed from the
 * actual sun position. No qibla/compass logic — this is the ambient view,
 * not a direction-finding tool (see QiblaGlobe for that).
 */
export class HomeGlobe extends Base3D<HomeGlobeData> {
  private earth!: THREE.Mesh;
  private earthMaterial!: THREE.ShaderMaterial;
  private cloudMesh!: THREE.Mesh;
  private cloudMaterial!: THREE.MeshBasicMaterial;
  private textureToken = 0;
  private cloudToken = 0;

  protected build(): void {
    this.camera.position.set(0, 0.15, 3.4);
    this.buildStarfield();
    this.buildEarth();
    this.buildCloudShell();
    this.refreshClouds();
  }

  protected configureControls(): void {
    // Ambient background view, not interactive: on the real mobile target the
    // full-screen content column always sits above the canvas, so drag-to-orbit
    // is unreachable anyway. Disabling outright keeps behavior consistent
    // between that (real) case and a wide desktop browser where it would
    // otherwise still be draggable.
    this.controls.enabled = false;
  }

  protected tick(seconds: number): void {
    this.earth.rotation.y = seconds * EARTH_SPIN_SPEED;
    this.cloudMesh.rotation.y = seconds * EARTH_SPIN_SPEED;
    this.updateSunDirection();
  }

  protected onData(): void {
    this.updateSunDirection();
  }

  protected applyColors(): void {
    this.refreshEarthTexture();
  }

  private buildStarfield(): void {
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      // Uniform random point on a sphere shell (Marsaglia-style: uniform u,v avoids pole clustering).
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      positions[i * 3] = STAR_RADIUS * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = STAR_RADIUS * Math.cos(phi);
      positions[i * 3 + 2] = STAR_RADIUS * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: '#ffffff', size: 0.045, sizeAttenuation: true });
    this.scene.add(new THREE.Points(geometry, material));
  }

  private buildEarth(): void {
    this.earthMaterial = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: placeholderTexture() },
        sunDirection: { value: new THREE.Vector3(0, 0, 1) },
        nightColor: { value: NIGHT_COLOR },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        void main() {
          vUv = uv;
          vNormal = normal;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D dayMap;
        uniform vec3 sunDirection;
        uniform vec3 nightColor;
        varying vec2 vUv;
        varying vec3 vNormal;
        void main() {
          vec4 dayColor = texture2D(dayMap, vUv);
          float ndotl = dot(normalize(vNormal), normalize(sunDirection));
          float lightAmount = smoothstep(-0.15, 0.15, ndotl);
          vec3 color = mix(nightColor, dayColor.rgb, lightAmount);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.earthMaterial);
    this.scene.add(this.earth);
    this.refreshEarthTexture();
  }

  /** Redraw the coastline map in the current theme's colours. */
  private refreshEarthTexture(): void {
    const C = this.colors;
    const token = ++this.textureToken;
    buildEarthTexture({ ocean: C.card, land: C.muted, coast: C.muted, graticule: C.muted })
      .then((texture) => {
        if (token !== this.textureToken) {
          texture.dispose();
          return;
        }
        const prev = this.earthMaterial.uniforms.dayMap.value as THREE.Texture;
        prev?.dispose();
        this.earthMaterial.uniforms.dayMap.value = texture;
        this.earthMaterial.needsUpdate = true;
      })
      .catch((err) => console.warn('earth texture unavailable', err));
  }

  private buildCloudShell(): void {
    this.cloudMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 64), this.cloudMaterial);
    this.scene.add(this.cloudMesh);
  }

  /**
   * Fetches (or reuses the day's cached) real satellite imagery and extracts
   * a cloud-only alpha mask from it. Called once per mount — a decorative
   * feature doesn't need to re-check within a session; the next app launch
   * re-checks naturally. Fails silently (clouds just stay invisible) since
   * the globe must never block or error on network conditions.
   */
  private refreshClouds(): void {
    const token = ++this.cloudToken;
    getCloudImagery(this.data.now)
      .then((result) => {
        if (token !== this.cloudToken) return;
        if (result.source === 'procedural' || !result.base64Jpeg) {
          this.cloudMaterial.opacity = 0;
          return;
        }
        const img = new Image();
        img.onload = () => {
          if (token !== this.cloudToken) return;
          const canvas = extractCloudAlpha(img);
          const texture = new THREE.CanvasTexture(canvas);
          this.cloudMaterial.map?.dispose();
          this.cloudMaterial.map = texture;
          this.cloudMaterial.opacity = 1;
          this.cloudMaterial.needsUpdate = true;
        };
        img.onerror = () => {
          console.warn('cloud image failed to decode');
        };
        img.src = `data:image/jpeg;base64,${result.base64Jpeg}`;
      })
      .catch((err) => console.warn('cloud imagery unavailable', err));
  }

  /** Recompute the sun direction in the earth mesh's current (spinning) local frame. */
  private updateSunDirection(): void {
    const { latitude, longitude } = subSolarPoint(this.data.now);
    const worldSun = v3(normalize(latLonToVec3(latitude, longitude)));
    const localSun = worldSun.clone().applyQuaternion(this.earth.quaternion.clone().invert());
    this.earthMaterial.uniforms.sunDirection.value.copy(localSun);
  }

  /**
   * Base3D.dispose() generically disposes each mesh's `.material.map`, but
   * this earth's texture lives in a ShaderMaterial uniform instead — the
   * generic path never sees it, so it would leak GPU memory on every
   * Home-screen unmount otherwise.
   */
  dispose(): void {
    (this.earthMaterial?.uniforms.dayMap.value as THREE.Texture | undefined)?.dispose();
    super.dispose();
  }
}
