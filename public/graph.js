import * as THREE from "/vendor/three.js";
import { normalizeTheme } from "./theme.js";

const colors = {
  completed: 0xb88aff,
  running: 0x36d9ff,
  starting: 0x36d9ff,
  waiting: 0xffc34f,
  queued: 0xffc34f,
  failed: 0xff647f,
  disconnected: 0xff647f,
  idle: 0x8fafff,
  history: 0x958c9f,
  unknown: 0x958c9f,
  interrupted: 0xb2a99b,
  folder: 0xff9e44,
  file: 0x49ecb7,
};
export class WorkspaceGlobe {
  constructor(canvas, labels, onSelect) {
    this.canvas = canvas;
    this.labels = labels;
    this.onSelect = onSelect;
    this.visible = false;
    this.theme = normalizeTheme();
    this.halos = [];
    this.animTimer = null;
    this.showLabels = true;
    this.selected = null;
    this.nodes = [];
    this.meshes = [];
    this.frame = null;
    this.theta = 0.25;
    this.phi = 1.35;
    this.distance = 18.5;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.scene.add(new THREE.AmbientLight(0xb6c9ff, 1.4));
    const light = new THREE.DirectionalLight(0xffffff, 3.5);
    light.position.set(4, 7, 10);
    this.scene.add(light);
    this.base = new THREE.Group();
    this.scene.add(this.base);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    const starPositions = [], starColors = [];
    for (let i = 0; i < 340; i++) {
      const a = i * 2.399963, y = 1 - (i + 0.5) / 170, r = Math.sqrt(1-y*y), d = 25 + 4 * Math.sin(i * 31.7);
      starPositions.push(Math.cos(a) * r * d, y * d, Math.sin(a) * r * d);
      const c = new THREE.Color(i % 3 ? 0xaad8ff : 0xffd0a1); starColors.push(c.r,c.g,c.b);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
    starGeo.setAttribute("color", new THREE.Float32BufferAttribute(starColors, 3));
    this.base.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.04, vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false })));
    const glowCanvas = document.createElement("canvas"); glowCanvas.width = glowCanvas.height = 128;
    const ctx = glowCanvas.getContext("2d"), gradient = ctx.createRadialGradient(64,64,0,64,64,64);
    gradient.addColorStop(0,"#ffffff"); gradient.addColorStop(0.2,"#ffffffaa"); gradient.addColorStop(0.5,"#ffffff22"); gradient.addColorStop(1,"#ffffff00");
    ctx.fillStyle = gradient; ctx.fillRect(0,0,128,128); this.glowTexture = new THREE.CanvasTexture(glowCanvas);
    const ringGeo = new THREE.BufferGeometry().setFromPoints(
      Array.from(
        { length: 101 },
        (_, i) =>
          new THREE.Vector3(
            Math.cos((i / 100) * Math.PI * 2) * 4.82,
            0,
            Math.sin((i / 100) * Math.PI * 2) * 4.82,
          ),
      ),
    );
    const ring = new THREE.Line(
      ringGeo,
      new THREE.LineBasicMaterial({
        color: 0x409fff,
        transparent: true,
        opacity: 0.17,
      }),
    );
    this.base.add(ring);
    for (let i = 1; i < 3; i++) { const orbit = ring.clone(); orbit.rotation.z = i * 0.72; orbit.rotation.x = i * 0.5; this.base.add(orbit); }
    this.nodeGeo = new THREE.SphereGeometry(0.23, 22, 14);
    this.folderGeo = new THREE.SphereGeometry(0.34, 22, 14);
    this.fileGeo = new THREE.SphereGeometry(0.09, 12, 8);
    this.cameraPosition();
    let down = null;
    canvas.addEventListener("pointerdown", (e) => {
      down = {
        x: e.clientX,
        y: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (down) {
        const dx = e.clientX - down.lastX,
          dy = e.clientY - down.lastY;
        down.lastX = e.clientX;
        down.lastY = e.clientY;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4)
          down.moved = true;
        this.theta -= dx * 0.006;
        this.phi = Math.max(
          0.15,
          Math.min(Math.PI - 0.15, this.phi + dy * 0.006),
        );
        this.cameraPosition();
        this.invalidate();
      } else {
        const hit = this.hit(e);
        canvas.style.cursor = hit ? "pointer" : "grab";
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      if (down && !down.moved) {
        const node = this.hit(e);
        if (node) this.onSelect(node.id);
      }
      down = null;
    });
    canvas.addEventListener("pointercancel", () => (down = null));
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.distance = Math.max(
          6.7,
          Math.min(30, this.distance + e.deltaY * 0.012),
        );
        this.cameraPosition();
        this.invalidate();
      },
      { passive: false },
    );
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement);
    this.resize();
  }
  cameraPosition() {
    this.camera.position.set(
      this.distance * Math.sin(this.phi) * Math.sin(this.theta),
      this.distance * Math.cos(this.phi),
      this.distance * Math.sin(this.phi) * Math.cos(this.theta),
    );
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }
  setVisible(visible) {
    this.visible = visible;
    if (visible) {
      this.resize();
      this.invalidate();
    } else if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    if (!visible) { clearTimeout(this.animTimer); this.animTimer = null; }
  }
  setTheme(value) {
    this.theme = normalizeTheme(value);
    if (this.data) { const data = this.data; this.signature = null; this.setData(data); }
    this.invalidate();
  }
  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    this.renderer.setSize(box.width, box.height, false);
    this.camera.aspect = box.width / box.height;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }
  setLabels(value) {
    this.showLabels = value;
    this.invalidate();
  }
  setData(data) {
    this.data = data;
    const signature = JSON.stringify(data);
    if (this.signature === signature) return;
    this.signature = signature;
    for (const object of [...this.group.children]) {
      this.group.remove(object);
      if (!this.meshes.includes(object) && !object.isSprite) object.geometry?.dispose();
      object.material?.dispose();
    }
    this.meshes = [];
    this.halos = [];
    this.labels.replaceChildren();
    this.nodes = [...data.nodes]
      .sort(
        (a, b) =>
          ({ task: 0, folder: 1, file: 2 })[a.kind] -
          { task: 0, folder: 1, file: 2 }[b.kind],
      )
      .slice(0, 220)
      .map((n) => ({ ...n }));
    const tasks = this.nodes.filter((n) => n.kind === "task"),
      folders = this.nodes.filter((n) => n.kind === "folder"),
      files = this.nodes.filter((n) => n.kind === "file");
    const positions = new Map();
    tasks.forEach((n, i) => {
      let hash = 2166136261;
      for (const c of n.id)
        hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
      const y = 1 - (hash % 100000) / 50000,
        r = Math.sqrt(1 - y * y),
        angle = ((hash >>> 12) / 1048576) * Math.PI * 2;
      positions.set(
        n.id,
        new THREE.Vector3(
          Math.cos(angle) * r * 4.8,
          y * 4.8,
          Math.sin(angle) * r * 4.8,
        ),
      );
    });
    folders.forEach((n, i) => {
      const connected = data.edges
        .filter((e) => e.from === n.id)
        .map((e) => positions.get(e.to))
        .filter(Boolean);
      const p = connected.reduce((sum, p) => sum.add(p), new THREE.Vector3());
      if (p.length() < 0.01) p.set(Math.sin(i * 2.4), 0.5, Math.cos(i * 2.4));
      p.normalize().multiplyScalar(2.6);
      positions.set(n.id, p);
    });
    files.forEach((n, i) => {
      const related = data.edges.find(
        (e) => e.to === n.id && positions.has(e.from),
      );
      const base = positions.get(related?.from) || new THREE.Vector3(4, 0, 0);
      const offset = new THREE.Vector3(
        Math.sin(i * 2.4),
        Math.cos(i * 1.7),
        Math.cos(i * 2.4),
      ).multiplyScalar(0.7);
      positions.set(n.id, base.clone().multiplyScalar(1.16).add(offset));
    });
    for (const n of this.nodes) {
      const pos = positions.get(n.id) || new THREE.Vector3();
      const color = n.state === "completed" || n.state === "idle" ? new THREE.Color(this.theme.accent) : new THREE.Color(colors[n.state] || 0x8fafff);
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.36,
        metalness: 0.22,
        emissive: color,
        emissiveIntensity: n.kind === "folder" ? 0.6 : 0.16 + this.theme.glow * 0.2,
      });
      const mesh = new THREE.Mesh(
        n.kind === "task"
          ? this.nodeGeo
          : n.kind === "folder"
            ? this.folderGeo
            : this.fileGeo,
        material,
      );
      mesh.position.copy(pos);
      mesh.userData.node = n;
      this.group.add(mesh);
      this.meshes.push(mesh);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture, color, transparent: true, opacity: this.theme.glow * 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.position.copy(pos);
      const haloSize = n.kind === "folder" ? 2.2 : n.kind === "task" ? 1.45 : 0.55;
      halo.scale.setScalar(haloSize); halo.userData.size = haloSize; halo.userData.phase = this.halos.length * 1.7;
      this.halos.push(halo); this.group.add(halo);
      if (n.kind === "folder" || n.state === "running") {
        const orbit = new THREE.Mesh(new THREE.RingGeometry(n.kind === "folder" ? 0.5 : 0.33, n.kind === "folder" ? 0.72 : 0.38, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.48, side: THREE.DoubleSide, depthWrite: false }));
        orbit.position.copy(pos); orbit.rotation.set(1.1, 0.3, 0.2 + this.meshes.length * 0.3); this.group.add(orbit);
      }
      n.pos = pos;
      const label = document.createElement("button");
      label.className = "node-label";
      label.textContent = n.label;
      label.title = n.label;
      label.setAttribute("aria-label", n.label + " · " + n.kind);
      label.addEventListener("click", () => this.onSelect(n.id));
      this.labels.append(label);
      n.labelElement = label;
    }
    for (const e of data.edges) {
      const from = positions.get(e.from),
        to = positions.get(e.to);
      if (!from || !to) continue;
      const important = ["dependency", "fork", "delegates"].includes(e.kind);
      const selected = e.from === this.selected || e.to === this.selected;
      const middle = from.clone().add(to).multiplyScalar(0.5); middle.add(middle.clone().normalize().multiplyScalar(important ? 0.65 : 0.18));
      const curve = new THREE.QuadraticBezierCurve3(from, middle, to);
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(28));
      const material = new THREE.LineBasicMaterial({
        color:
          e.kind === "dependency"
            ? 0xffc34f
            : e.kind === "fork"
              ? 0xff77c8
              : 0x56bce8,
        transparent: true,
        opacity: selected ? 0.95 : important ? 0.7 : 0.3,
      });
      const line = new THREE.Line(geometry, material);
      this.group.add(line);
      if (important) {
        const direction = new THREE.Vector3().subVectors(to, from).normalize();
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.055, 0.18, 5),
          new THREE.MeshBasicMaterial({
            color: e.kind === "dependency" ? 0xe5c88e : 0xcfc0e8,
            transparent: true,
            opacity: 0.7,
          }),
        );
        cone.position.copy(to).addScaledVector(direction, -0.32);
        cone.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          direction,
        );
        this.group.add(cone);
      }
    }
    this.invalidate();
  }
  select(id) {
    this.selected = id;
    for (const mesh of this.meshes) {
      const selected = mesh.userData.node.id === id;
      mesh.scale.setScalar(selected ? 1.6 : 1);
      mesh.material.emissiveIntensity = selected ? 0.8 : 0.16 + this.theme.glow * 0.2;
    }
    this.invalidate();
  }
  hit(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.meshes)[0]?.object.userData
      .node;
  }
  reset() {
    this.theta = 0.25;
    this.phi = 1.35;
    this.distance = 18.5;
    this.cameraPosition();
    this.invalidate();
  }
  invalidate() {
    if (!this.visible || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }
  render() {
    const animate = this.theme.motion && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const halo of this.halos) {
      const pulse = animate ? 1 + Math.sin(performance.now() * 0.0014 + halo.userData.phase) * 0.09 : 1;
      halo.scale.setScalar(halo.userData.size * pulse); halo.material.opacity = this.theme.glow * 0.5 * pulse;
    }
    this.renderer.render(this.scene, this.camera);
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    const cameraDirection = this.camera.position.clone().normalize();
    for (const n of this.nodes) {
      const projected = n.pos.clone().project(this.camera),
        front = n.pos.clone().normalize().dot(cameraDirection),
        label = n.labelElement;
      const visible =
        this.showLabels &&
        (n.kind === "task" || n.id === this.selected) &&
        projected.z < 1 &&
        projected.z > -1;
      label.hidden = !visible;
      if (visible) {
        label.style.left = (projected.x * 0.5 + 0.5) * width + "px";
        label.style.top = (-projected.y * 0.5 + 0.5) * height + 19 + "px";
        label.style.opacity =
          n.id === this.selected
            ? "1"
            : String(Math.max(0.78, (front + 1) / 2));
        label.classList.toggle("selected", n.id === this.selected);
      }
    }
    if (animate && this.visible && !this.animTimer) this.animTimer = setTimeout(() => { this.animTimer = null; this.invalidate(); }, 66);
  }
}
