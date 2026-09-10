import { Base3D, THREE, labelSprite, retintSprite } from './base3d';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { buildEarthTexture } from './earthTexture';
import {
  D2R,
  MECCA,
  angularSeparation,
  greatCircleArc,
  latLonToVec3,
  normalize,
  type Vec3,
} from '../../services/solarGeometry';

export interface QiblaGlobeData {
  latitude: number;
  longitude: number;
  cityName: string;
  /**
   * Degrees you still need to turn to face the Kaaba (positive = to your
   * right). The globe turns with you so the arc points away from you exactly
   * when this reaches zero. Null when there's no compass to follow.
   */
  turnDegrees: number | null;
}

const HOME_COLOR = '#dc2626';

/**
 * Below this separation the two ends of the journey are the same dot on a
 * small globe. The app's fallback location is the Kaaba itself, so this is
 * the state every user sees until their real position resolves.
 */
const COINCIDENT_DEG = 0.5;

/** How much of the view the globe fills — smaller number, bigger globe. */
const FRAMING = 1.12;
/** Label height in world units. */
const LABEL_HEIGHT = 0.11;
/** Screen pixels. The route is the point of this view, so it is drawn boldly. */
const QIBLA_ARC_WIDTH_PX = 4;
/** Labels fade out as they swing this far from the centre of the view. */
const LABEL_FADE_START = Math.cos(52 * D2R);

// Scratch vectors for fadeLabelsNearTheEdge(), which runs once a frame.
const TO_CAMERA = new THREE.Vector3();
const LABEL_WORLD = new THREE.Vector3();
const LABEL_FADE_END = Math.cos(78 * D2R);

const v3 = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * A globe carrying a real coastline map, with the great-circle line from the
 * user to the Kaaba. When a compass heading is supplied the globe turns with
 * the phone, so lining the arc up on screen means facing the Kaaba in life.
 */
export class QiblaGlobe extends Base3D<QiblaGlobeData> {
  private globe!: THREE.Group;
  private routeGroup!: THREE.Group;

  private shellMat!: THREE.MeshBasicMaterial;
  private arcMat!: LineMaterial;
  private homeMat!: THREE.MeshBasicMaterial;
  private kaabaMat!: THREE.MeshBasicMaterial;

  private homeLabel?: THREE.Sprite;
  private meccaLabel?: THREE.Sprite;
  private routeKey = '';

  /** Rotation about the view axis that puts the arc pointing straight up. */
  private alignRoll = 0;
  private baseQuat = new THREE.Quaternion();
  private textureToken = 0;

  protected build(): void {
    const C = this.colors;
    this.globe = new THREE.Group();
    this.scene.add(this.globe);

    // Flat-shaded so the map reads the same all over rather than falling into
    // shadow down one side.
    this.shellMat = new THREE.MeshBasicMaterial({ color: C.card });
    this.globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.995, 96, 64), this.shellMat));
    this.refreshTexture();

    // Vertex-coloured so the line brightens as it approaches Makkah — the
    // arc reads as a direction of travel rather than a drawn connection. Drawn
    // as a fat line: WebGL ignores LineBasicMaterial's linewidth, so the route
    // was a single device pixel and all but invisible on the pale globe.
    this.arcMat = new LineMaterial({ vertexColors: true, linewidth: QIBLA_ARC_WIDTH_PX });
    this.updateArcResolution();
    this.homeMat = new THREE.MeshBasicMaterial({ color: HOME_COLOR });
    this.kaabaMat = new THREE.MeshBasicMaterial({ color: C.primary });

    this.routeGroup = new THREE.Group();
    this.globe.add(this.routeGroup);

    this.camera.position.set(0, 0.12, 3.75);
    this.rebuildRoute();
  }

  protected configureControls(): void {
    this.controls.autoRotate = this.data.turnDegrees === null;
    this.controls.autoRotateSpeed = 0.35;
  }

  protected onData(): void {
    this.rebuildRoute();
    this.applyHeading();
    // Only drift on its own when there's no compass driving it.
    this.controls.autoRotate = this.data.turnDegrees === null && !this.isAdjusted();
  }

  protected onReset(): void {
    // Hand the globe back to the compass.
    this.applyHeading(true);
    this.controls.autoRotate = this.data.turnDegrees === null;
  }

  /** Frame by whichever axis is tighter so tall cards never crop the globe. */
  protected resize(): void {
    super.resize();
    const vFov = this.camera.fov * D2R;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distance = FRAMING / Math.sin(Math.min(vFov, hFov) / 2);
    this.setFramedDistance(distance);
    if (!this.isAdjusted()) this.camera.position.setLength(distance);
    this.updateArcResolution();
  }

  protected tick(): void {
    this.fadeLabelsNearTheEdge();
  }

  protected applyColors(): void {
    const C = this.colors;
    this.kaabaMat.color.set(C.primary);
    // The arc's gradient and the markers' rings are baked per theme.
    this.routeKey = '';
    this.rebuildRoute();
    if (this.homeLabel) retintSprite(this.homeLabel, C.text, 46, LABEL_HEIGHT);
    if (this.meccaLabel) retintSprite(this.meccaLabel, C.primary, 46, LABEL_HEIGHT);
    this.refreshTexture();
  }

  /** Redraw the map in the current theme's colours. */
  private refreshTexture(): void {
    const C = this.colors;
    const token = ++this.textureToken;
    buildEarthTexture({ ocean: C.card, land: C.muted, coast: C.muted, graticule: C.muted })
      .then((texture) => {
        // buildEarthTexture is genuinely async — it dynamically imports
        // topojson-client and world-atlas on the first call — so the overlay
        // can be closed before it lands. The staleness token only catches a
        // *newer* request overtaking this one; without the disposed check a
        // 4096x2048 texture (~32MB decoded) got assigned to a material nobody
        // owns, once per open/close cycle, and nothing ever freed it.
        if (this.isDisposed() || token !== this.textureToken) {
          texture.dispose();
          return;
        }
        this.shellMat.map?.dispose();
        this.shellMat.map = texture;
        // The texture carries the colour now, so stop tinting it.
        this.shellMat.color.set('#ffffff');
        this.shellMat.needsUpdate = true;
        // The loop may have parked while this was in flight.
        this.wake();
      })
      .catch((err) => console.warn('map texture unavailable', err));
  }

  /**
   * Turn the globe so the arc points up the screen when the phone faces the
   * Kaaba, and swings the way the world does as you turn.
   */
  private applyHeading(force = false): void {
    if (this.isAdjusted() && !force) return;
    const turn = this.data.turnDegrees;
    const roll = this.alignRoll - (turn ?? 0) * D2R;
    this.globe.quaternion
      .setFromAxisAngle(Z_AXIS, roll)
      .multiply(this.baseQuat);
  }

  /** Keep labels from being clipped as they swing towards the horizon. */
  private fadeLabelsNearTheEdge(): void {
    if (!this.sprites.length) return;
    // Scratch vectors rather than a clone and a fresh allocation: this runs
    // every frame the qibla globe is on screen.
    const toCamera = TO_CAMERA.copy(this.camera.position).normalize();
    const world = LABEL_WORLD;
    for (const sprite of this.sprites) {
      sprite.getWorldPosition(world);
      const facing = world.normalize().dot(toCamera);
      const t = (facing - LABEL_FADE_END) / (LABEL_FADE_START - LABEL_FADE_END);
      sprite.material.opacity = Math.max(0, Math.min(1, t));
      sprite.visible = sprite.material.opacity > 0.02;
    }
  }

  /**
   * A thin ring lying flat on the surface at a point, the way a survey mark
   * sits on the ground. Reads as placed on the globe rather than floating.
   */
  private surveyRing(point: THREE.Vector3, material: THREE.MeshBasicMaterial): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.036, 0.044, 48),
      new THREE.MeshBasicMaterial({
        color: material.color,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
      })
    );
    ring.position.copy(point).multiplyScalar(1.006);
    // Face the ring straight out from the centre of the earth.
    ring.lookAt(point.clone().multiplyScalar(2));
    return ring;
  }

  /** Arc colours running from quiet at home to full strength at Makkah. */
  /** Fat lines size themselves in screen pixels, so they need the canvas size. */
  private updateArcResolution(): void {
    const size = this.renderer?.getSize(new THREE.Vector2());
    if (size) this.arcMat?.resolution.set(size.x, size.y);
  }

  private arcColors(count: number): number[] {
    const from = new THREE.Color(this.colors.muted);
    const to = new THREE.Color(this.colors.primary);
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const c = from.clone().lerp(to, i / Math.max(1, count - 1));
      out.push(c.r, c.g, c.b);
    }
    return out;
  }

  private rebuildRoute(): void {
    const { latitude, longitude, cityName } = this.data;
    const key = `${latitude}|${longitude}|${cityName}`;
    if (key === this.routeKey) return;
    this.routeKey = key;

    this.clearRouteGroup();

    const home = normalize(latLonToVec3(latitude, longitude));
    const kaaba = normalize(latLonToVec3(MECCA.latitude, MECCA.longitude));
    const atDestination = angularSeparation({ latitude, longitude }, MECCA) < COINCIDENT_DEG;

    const kaabaDot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 20, 16), this.kaabaMat);
    kaabaDot.position.copy(v3(kaaba)).multiplyScalar(1.01);
    this.routeGroup.add(kaabaDot);
    this.routeGroup.add(this.surveyRing(v3(kaaba), this.kaabaMat));

    this.meccaLabel = labelSprite('Makkah', this.colors.primary, 46, LABEL_HEIGHT);
    this.meccaLabel.position.copy(v3(kaaba)).multiplyScalar(1.13);
    this.routeGroup.add(this.meccaLabel);
    this.sprites = [this.meccaLabel];

    if (atDestination) {
      // Standing at the Kaaba: there is no journey to draw, and a second
      // label would sit on top of the first.
      this.baseQuat.setFromUnitVectors(v3(kaaba).normalize(), Z_AXIS);
      this.alignRoll = 0;
      this.applyHeading(true);
      return;
    }

    const arc = greatCircleArc({ latitude, longitude }, MECCA, 128, 1.008);
    const flat: number[] = [];
    for (const p of arc) flat.push(p.x, p.y, p.z);
    const arcGeometry = new LineGeometry();
    arcGeometry.setPositions(flat);
    arcGeometry.setColors(this.arcColors(arc.length));
    this.routeGroup.add(new Line2(arcGeometry, this.arcMat));

    const homeDot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 20, 16), this.homeMat);
    homeDot.position.copy(v3(home)).multiplyScalar(1.01);
    this.routeGroup.add(homeDot);
    this.routeGroup.add(this.surveyRing(v3(home), this.homeMat));

    this.homeLabel = labelSprite(cityName, this.colors.text, 46, LABEL_HEIGHT);
    this.homeLabel.position.copy(v3(home)).multiplyScalar(1.13);
    this.routeGroup.add(this.homeLabel);
    this.sprites = [this.homeLabel, this.meccaLabel];

    // Face the midpoint of the arc, then roll so the arc runs bottom to top.
    const midpoint = new THREE.Vector3().copy(v3(home)).add(v3(kaaba));
    this.baseQuat = midpoint.lengthSq() > 1e-6
      ? new THREE.Quaternion().setFromUnitVectors(midpoint.normalize(), Z_AXIS)
      : new THREE.Quaternion();

    const homeOnScreen = v3(home).applyQuaternion(this.baseQuat);
    const kaabaOnScreen = v3(kaaba).applyQuaternion(this.baseQuat);
    const heading = Math.atan2(kaabaOnScreen.y - homeOnScreen.y, kaabaOnScreen.x - homeOnScreen.x);
    this.alignRoll = Math.PI / 2 - heading;

    this.applyHeading(true);
  }

  private clearRouteGroup(): void {
    for (const child of [...this.routeGroup.children]) {
      this.routeGroup.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
      if (child instanceof THREE.Sprite) {
        child.material.map?.dispose();
        child.material.dispose();
      } else if (
        child instanceof THREE.Mesh
        && child.material !== this.homeMat
        && child.material !== this.kaabaMat
        // Line2 is a Mesh, and the arc's material is long-lived like the dots'.
        && child.material !== this.arcMat
      ) {
        // Survey rings own their material; the dots share long-lived ones.
        (child.material as THREE.Material).dispose();
      }
    }
    this.homeLabel = undefined;
    this.meccaLabel = undefined;
    this.sprites = [];
  }
}
