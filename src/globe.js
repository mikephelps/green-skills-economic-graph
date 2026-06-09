import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Lat/lon for cities referenced in connections but absent from data.json
const EXTRA_COORDS = {
  'Dublin':   [53.3498,  -6.2603],
  'Paris':    [48.8566,   2.3522],
  'Tokyo':    [35.6762, 139.6503],
  'New York': [40.7128,  -74.006],
  'Auckland': [-36.8485, 174.7633],
  'Lisbon':   [38.7223,  -9.1393],
};

export class Globe {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.onCityHover  = callbacks.onCityHover  ?? null;
    this.onCitySelect = callbacks.onCitySelect ?? null;
    this.onDeselect   = callbacks.onDeselect   ?? null;

    this.RADIUS = 1;
    this.markers = [];       // { mesh, core, halo, data }
    this.activeArcs = [];
    this._allCities = [];

    // Interaction state
    this.hoveredMarker  = null;
    this.selectedCity   = null;
    this.mouseDownPos   = null;
    this.isDragging     = false;
    this.DRAG_THRESHOLD = 5;

    // Camera fly-to state
    this._flying    = false;
    this._flyStart  = null;
    this._flyTarget = null;
    this._flyT      = 0;

    this._init();
  }

  // ─── Bootstrap ──────────────────────────────────────────────────────────────

  _init() {
    this._setupRenderer();
    this._setupLights();
    this._setupGlobe();
    this._setupAtmosphere();
    this._setupOrbitRings();
    this._setupGroups();
    this._setupControls();
    this._setupEvents();
    this._loop();
  }

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 0); // transparent — gradient comes from CSS body

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 0, 3.2);
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0x111122, 1.2));
    const sun = new THREE.DirectionalLight(0x88aaff, 1.0);
    sun.position.set(4, 2, 3);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x00cfff, 0.7);
    rim.position.set(-3, 1, -4);
    this.scene.add(rim);
  }

  _setupGlobe() {
    const tex = new THREE.TextureLoader().load('/earth-night.jpg');
    const geo = new THREE.SphereGeometry(this.RADIUS, 64, 64);
    const mat = new THREE.MeshPhongMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: new THREE.Color(0x553322),
      emissiveIntensity: 0.28,
      specular: new THREE.Color(0x223344),
      shininess: 25,
    });
    this.globe = new THREE.Mesh(geo, mat);
    // Rotate equirectangular texture so prime meridian (lon=0) faces the camera (+Z)
    this.globe.rotation.y = -Math.PI / 2;
    this.scene.add(this.globe);

    // Lat/lon grid lines
    const gridMat = new THREE.LineBasicMaterial({ color: 0x1a3a6a, transparent: true, opacity: 0.12 });
    const gridGroup = new THREE.Group();
    for (let lat = -80; lat <= 80; lat += 20) {
      const pts = [];
      for (let lon = 0; lon <= 360; lon += 2) pts.push(this._ll(lat, lon, this.RADIUS + 0.002));
      gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }
    for (let lon = 0; lon < 360; lon += 20) {
      const pts = [];
      for (let lat = -90; lat <= 90; lat += 2) pts.push(this._ll(lat, lon, this.RADIUS + 0.002));
      gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }
    this.scene.add(gridGroup);
  }

  _setupAtmosphere() {
    // Thin inner haze
    const atmMat = new THREE.MeshPhongMaterial({
      color: 0x0088ff, emissive: 0x002266,
      transparent: true, opacity: 0.05,
      side: THREE.FrontSide, depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(this.RADIUS * 1.05, 64, 64), atmMat));

    // Tight outer rim — deep blue → gold gradient (BackSide Fresnel)
    const glowMat = new THREE.ShaderMaterial({
      uniforms: {
        colorTop:    { value: new THREE.Color(0x0033cc) },
        colorBottom: { value: new THREE.Color(0xffaa00) },
      },
      vertexShader: `
        varying float intensity;
        varying float vY;
        void main() {
          vec3 vN = normalize(normalMatrix * normal);
          vec3 vE = normalize(vec3(modelViewMatrix * vec4(position, 1.0)));
          intensity = pow(0.75 - dot(vN, vE), 2.8);
          vY = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 colorTop;
        uniform vec3 colorBottom;
        varying float intensity;
        varying float vY;
        void main() {
          float t = clamp(vY * 0.5 + 0.5, 0.0, 1.0);
          vec3 color = mix(colorBottom, colorTop, t);
          gl_FragColor = vec4(color, intensity * 0.88);
        }`,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(this.RADIUS * 1.08, 64, 64), glowMat));
  }

  _setupOrbitRings() {
    // Shared dot sprite texture
    const dc = document.createElement('canvas');
    dc.width = dc.height = 16;
    const dctx = dc.getContext('2d');
    const dg = dctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    dg.addColorStop(0, 'rgba(255,255,255,1)');
    dg.addColorStop(1, 'rgba(255,255,255,0)');
    dctx.fillStyle = dg;
    dctx.fillRect(0, 0, 16, 16);
    const dotTex = new THREE.CanvasTexture(dc);

    const makeRing = (tiltX, tiltZ, r, n, color, opacity) => {
      const pos = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        map: dotTex, color: new THREE.Color(color),
        size: 0.026, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      }));
      pts.rotation.x = tiltX;
      pts.rotation.z = tiltZ;
      const grp = new THREE.Group();
      grp.add(pts);
      this.scene.add(grp);
      return grp;
    };

    this._ring1 = makeRing(0.30,  0.08, this.RADIUS * 1.36, 200, 0x88ccff, 0.42);
    this._ring2 = makeRing(-0.18, 0.22, this.RADIUS * 1.44, 140, 0xaaddff, 0.18);
  }

  _setupGroups() {
    this.markerGroup = new THREE.Group();
    this.scene.add(this.markerGroup);
    this.arcGroup = new THREE.Group();
    this.scene.add(this.arcGroup);
  }

  _setupControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping  = true;
    this.controls.dampingFactor  = 0.06;
    this.controls.minDistance    = 1.5;
    this.controls.maxDistance    = 6;
    this.controls.enablePan      = false;
    this.controls.autoRotate     = true;
    this.controls.autoRotateSpeed = 0.4;
  }

  _setupEvents() {
    window.addEventListener('mousedown', e => {
      this.mouseDownPos = { x: e.clientX, y: e.clientY };
      this.isDragging = false;
    });

    window.addEventListener('mousemove', e => {
      if (this.mouseDownPos) {
        const dx = e.clientX - this.mouseDownPos.x;
        const dy = e.clientY - this.mouseDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > this.DRAG_THRESHOLD) this.isDragging = true;
      }
      if (!this.isDragging) this._onHover(e);
    });

    window.addEventListener('mouseup', e => {
      if (!this.isDragging) this._onClick(e);
      this.mouseDownPos = null;
      this.isDragging   = false;
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Touch support for mobile city-dot selection
    let touchStart = null;
    let touchDragged = false;
    this.renderer.domElement.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touchDragged = false;
    }, { passive: true });
    this.renderer.domElement.addEventListener('touchmove', e => {
      if (!touchStart || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - touchStart.x;
      const dy = e.touches[0].clientY - touchStart.y;
      if (dx * dx + dy * dy > this.DRAG_THRESHOLD * this.DRAG_THRESHOLD) touchDragged = true;
    }, { passive: true });
    this.renderer.domElement.addEventListener('touchend', e => {
      if (touchDragged || !touchStart || e.changedTouches.length !== 1) {
        touchStart = null; touchDragged = false; return;
      }
      const t = e.changedTouches[0];
      this._onTap(t.clientX, t.clientY);
      touchStart = null; touchDragged = false;
    }, { passive: true });
  }

  _onTap(clientX, clientY) {
    const hit = this._raycast({ clientX, clientY, target: this.canvas });
    if (hit) {
      const marker = this.markers.find(m => m.mesh === hit);
      if (marker) { this.selectCity(marker.data); return; }
    }
    if (this.selectedCity) this.deselect();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  addMarkers(cities) {
    this._allCities = cities;
    cities.forEach(city => {
      const [lat, lon] = city.coordinates;
      const pos = this._ll(lat, lon, this.RADIUS + 0.01);

      // Invisible sphere for raycasting
      const hitMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.038, 8, 8),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hitMesh.position.copy(pos);
      hitMesh.userData = city;
      this.markerGroup.add(hitMesh);

      // Core bright sprite
      // depthTest:false — prevents the opaque globe mesh from hard-clipping
      // the halo at the sphere limb during rotation. Visibility is managed
      // manually each frame via _isVisible() instead.
      const core = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._glowTex(city.statusColor, 64),
        blending: THREE.AdditiveBlending,
        transparent: true, opacity: 0.95,
        depthTest: false, depthWrite: false,
      }));
      core.position.copy(pos);
      core.scale.setScalar(0.072);
      this.markerGroup.add(core);

      // Outer pulsing halo
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._glowTex(city.statusColor, 128),
        blending: THREE.AdditiveBlending,
        transparent: true, opacity: 0.5,
        depthTest: false, depthWrite: false,
      }));
      halo.position.copy(pos);
      halo.scale.setScalar(0.22);
      this.markerGroup.add(halo);

      this.markers.push({ mesh: hitMesh, core, halo, data: city });
    });
  }

  selectCity(city) {
    this.selectedCity = city;
    this._flying = false;          // cancel any previous animation
    this.controls.autoRotate = false;
    this._flyTo(city.coordinates[0], city.coordinates[1]);
    this._showArcs(city);
    this._highlightMarker(city);

    // Capture screen position of the marker at the moment of selection
    const marker = this.markers.find(m => m.data.city === city.city);
    const screenPos = marker ? this._projectToScreen(marker.mesh.position) : null;
    this.onCitySelect?.(city, screenPos);
  }

  _projectToScreen(worldPos) {
    this.camera.updateMatrixWorld();
    const p = worldPos.clone().project(this.camera);
    return {
      x: Math.round((p.x + 1) / 2 * window.innerWidth),
      y: Math.round((1 - p.y) / 2 * window.innerHeight),
    };
  }

  deselect() {
    this.selectedCity = null;
    this._flying = false;
    this.controls.enabled = true;
    this.controls.autoRotate = true;
    this._clearArcs();
    this._resetMarkers();
    this.onDeselect?.();
  }

  // ─── Camera fly-to ───────────────────────────────────────────────────────────

  _flyTo(lat, lon) {
    // Clear accumulated autoRotate damping delta so it doesn't fight animation
    this.controls._sphericalDelta.set(0, 0, 0);

    const dist = this.camera.position.length();

    // Store start/end as plain spherical angles — avoids any slerpVectors issues
    const cx = this.camera.position.x, cy = this.camera.position.y, cz = this.camera.position.z;
    this._flyStartAngles = {
      theta: Math.atan2(cx, cz),
      phi:   Math.acos(Math.max(-1, Math.min(1, cy / dist))),
      dist,
    };

    const target = this._ll(lat, lon, 1);
    const td = target.length() || 1;
    // Compute shortest angular delta for theta (handle wrap-around)
    let dTheta = Math.atan2(target.x / td, target.z / td) - this._flyStartAngles.theta;
    if (dTheta >  Math.PI) dTheta -= 2 * Math.PI;
    if (dTheta < -Math.PI) dTheta += 2 * Math.PI;
    this._flyDelta = {
      dTheta,
      dPhi: Math.acos(Math.max(-1, Math.min(1, target.y / td))) - this._flyStartAngles.phi,
    };

    this._flyT      = 0;
    this._flying    = true;
    this.controls.enabled = false;
  }

  // ─── Interaction ─────────────────────────────────────────────────────────────

  _onHover(e) {
    const hit = this._raycast(e);
    const marker = hit ? this.markers.find(m => m.mesh === hit) : null;

    if (marker && this.hoveredMarker !== marker) {
      this.hoveredMarker = marker;
      this.canvas.style.cursor = 'pointer';
      this.onCityHover?.(marker.data);
    } else if (!marker && this.hoveredMarker) {
      this.hoveredMarker = null;
      this.canvas.style.cursor = 'default';
    }
  }

  _onClick(e) {
    // Ignore clicks that originated on UI elements — they have their own handlers
    if (e.target !== this.canvas) return;

    const hit = this._raycast(e);
    if (hit) {
      const marker = this.markers.find(m => m.mesh === hit);
      if (marker) {
        this.selectCity(marker.data);
        return;
      }
    }
    // Click on empty canvas — deselect
    if (this.selectedCity) this.deselect();
  }

  // ─── Raycasting + occlusion ──────────────────────────────────────────────────

  _raycast(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      ((e.clientY - rect.top)  / rect.height) * -2 + 1,
    );
    const ray = new THREE.Raycaster();
    this.camera.updateMatrixWorld();
    ray.setFromCamera(mouse, this.camera);

    // Only test markers that are on the visible hemisphere (occlusion guard)
    const visible = this.markers
      .filter(m => this._isVisible(m.mesh.position))
      .map(m => m.mesh);

    const hits = ray.intersectObjects(visible);
    return hits.length > 0 ? hits[0].object : null;
  }

  // A surface point P is visible from camera C if the angle between P and C
  // (from origin) is less than the horizon angle arccos(R / |C|).
  // Equivalent: dot(normalize(P), normalize(C)) > R / |C|
  _isVisible(worldPos) {
    const threshold = this.RADIUS / this.camera.position.length();
    return worldPos.clone().normalize().dot(this.camera.position.clone().normalize()) > threshold + 0.05;
  }

  // ─── Connection arcs ─────────────────────────────────────────────────────────

  _showArcs(city) {
    this._clearArcs();
    const coordMap = {};
    this._allCities.forEach(c => { coordMap[c.city] = c.coordinates; });
    Object.assign(coordMap, EXTRA_COORDS);

    city.connections.forEach(name => {
      if (!coordMap[name]) return;
      const arc = this._buildArc(city.coordinates, coordMap[name], city.statusColor);
      this.activeArcs.push(arc);
      this._fadeArc(arc.mat, 0, 0.72);
    });
  }

  _clearArcs() {
    this.activeArcs.forEach(({ line, mat }) => {
      this._fadeArc(mat, mat.opacity, 0, () => this.arcGroup.remove(line));
    });
    this.activeArcs = [];
  }

  _buildArc(fromLL, toLL, color) {
    const from = this._ll(fromLL[0], fromLL[1], this.RADIUS);
    const to   = this._ll(toLL[0],   toLL[1],   this.RADIUS);
    const mid  = from.clone().add(to).multiplyScalar(0.5);
    mid.normalize().multiplyScalar(this.RADIUS + from.distanceTo(to) * 0.55);
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const geo   = new THREE.BufferGeometry().setFromPoints(curve.getPoints(80));
    const mat   = new THREE.LineBasicMaterial({
      color: new THREE.Color(color), transparent: true, opacity: 0, depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    this.arcGroup.add(line);
    return { line, mat };
  }

  _fadeArc(mat, from, to, onDone) {
    const start = performance.now();
    const tick = () => {
      const t = Math.min((performance.now() - start) / 350, 1);
      mat.opacity = from + (to - from) * this._ease(t);
      t < 1 ? requestAnimationFrame(tick) : onDone?.();
    };
    requestAnimationFrame(tick);
  }

  // ─── Marker highlight ────────────────────────────────────────────────────────

  _highlightMarker(city) {
    this.markers.forEach(({ core, halo, data }) => {
      const active = data.city === city.city;
      core.material.opacity = active ? 1.0 : 0.45;
      halo.material.opacity = active ? 0.7 : 0.18;
      halo.scale.setScalar(active ? 0.30 : 0.14);
    });
  }

  _resetMarkers() {
    this.markers.forEach(({ core, halo }) => {
      core.material.opacity = 0.95;
      halo.material.opacity = 0.5;
      halo.scale.setScalar(0.22);
    });
  }

  // ─── Render loop ─────────────────────────────────────────────────────────────

  _loop() {
    const clock = new THREE.Clock();
    const tick  = () => {
      requestAnimationFrame(tick);
      const t = clock.getElapsedTime();

      // Per-frame visibility + pulse — replaces depth-test occlusion
      this.markers.forEach(({ mesh, core, halo }) => {
        const vis = this._isVisible(mesh.position);
        core.visible = vis;
        halo.visible = vis;
        if (vis && !this.selectedCity) {
          halo.material.opacity = 0.38 + 0.18 * Math.abs(Math.sin(t * 1.6));
          halo.scale.setScalar(0.19 + 0.05 * Math.abs(Math.sin(t * 1.6)));
        }
      });

      // Counter-rotating orbit rings
      this._ring1.rotation.y += 0.0025;
      this._ring2.rotation.y -= 0.0018;

      // Camera fly-to: spherical angle interpolation, no slerpVectors
      if (this._flying) {
        this._flyT = Math.min(this._flyT + 0.016, 1);
        const ease  = this._ease(this._flyT);
        const theta = this._flyStartAngles.theta + this._flyDelta.dTheta * ease;
        const phi   = this._flyStartAngles.phi   + this._flyDelta.dPhi   * ease;
        const dist  = this._flyStartAngles.dist;
        const sinPhi = Math.sin(phi);
        this.camera.position.set(
          dist * sinPhi * Math.sin(theta),
          dist * Math.cos(phi),
          dist * sinPhi * Math.cos(theta),
        );
        this.camera.lookAt(0, 0, 0);
        if (this._flyT >= 1) {
          this._flying = false;
          this.controls.enabled = true;
        }
      }

      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  // ─── Utilities ───────────────────────────────────────────────────────────────

  // Convert lat/lon → Vector3 on sphere of radius r
  // Uses coordinate system where lon=0 (prime meridian) faces +Z (camera)
  _ll(lat, lon, r) {
    const phi   = (90 - lat) * (Math.PI / 180);
    const theta = lon         * (Math.PI / 180);
    return new THREE.Vector3(
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.cos(theta),
    );
  }

  _ease(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  // Radial gradient canvas texture for glow sprites
  _glowTex(hexColor, size) {
    const c   = document.createElement('canvas');
    c.width   = c.height = size;
    const ctx = c.getContext('2d');
    const r   = size / 2;
    const g   = ctx.createRadialGradient(r, r, 0, r, r, r);
    const col = new THREE.Color(hexColor);
    const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
    g.addColorStop(0,    'rgba(255,255,255,1)');
    g.addColorStop(0.12, `rgba(${rgb},0.95)`);
    g.addColorStop(0.35, `rgba(${rgb},0.55)`);
    g.addColorStop(0.65, `rgba(${rgb},0.12)`);
    g.addColorStop(1,    `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }
}
