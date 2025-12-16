import {
  Engine,
  Render,
  Runner,
  World,
  Bodies,
  Body,
  Composite,
  Mouse,
  MouseConstraint,
  Events,
  Bounds,
  Vertices
} from 'https://cdn.skypack.dev/matter-js';

const PHYSICS_PRESETS = {
  Rubber: { restitution: 0.9, friction: 0.05, frictionAir: 0.005, density: 0.001, frictionStatic: 0.2 },
  Ice: { restitution: 0.3, friction: 0.01, frictionAir: 0.001, density: 0.001, frictionStatic: 0.05 },
  Wood: { restitution: 0.2, friction: 0.2, frictionAir: 0.01, density: 0.0012, frictionStatic: 0.5 },
  Metal: { restitution: 0.05, friction: 0.3, frictionAir: 0.002, density: 0.003, frictionStatic: 0.9 },
  Balloon: { restitution: 0.8, friction: 0.01, frictionAir: 0.06, density: 0.0006, frictionStatic: 0.05 }
};

const VISUAL_PRESETS = {
  Neon: { fill: '#0ea5e9', stroke: '#67e8f9', strokeWidth: 3, opacity: 1, renderMode: 'solid' },
  Wireframe: { fill: '#0f172a', stroke: '#f3f4f6', strokeWidth: 2, opacity: 1, renderMode: 'outline' },
  Paper: { fill: '#fef3c7', stroke: '#78350f', strokeWidth: 2, opacity: 0.95, renderMode: 'solid' },
  Glass: { fill: '#7dd3fc', stroke: '#e0f2fe', strokeWidth: 2, opacity: 0.35, renderMode: 'gradient' }
};

const DEFAULT_PHYSICS = {
  restitution: 0.2,
  friction: 0.1,
  frictionAir: 0.01,
  frictionStatic: 0.5,
  density: 0.001
};

const DEFAULT_VISUAL = {
  fill: '#4f46e5',
  stroke: '#111827',
  strokeWidth: 2,
  opacity: 1,
  renderMode: 'solid'
};

const TOOL_HINTS = {
  select: 'Click a shape to select. Drag with physics. Shift-click to multi-select.',
  circle: 'Click to drop a circle, or drag to size it.',
  rectangle: 'Click to add, drag to define width & height.',
  polygon: 'Drag to size polygon. Adjust sides in inspector.',
  wall: 'Drag to create static wall.',
  sensor: 'Drag to add a ghost sensor (no collisions).'
};

class Playground {
  constructor() {
    this.engine = Engine.create({ enableSleeping: true });
    this.runner = Runner.create();
    this.renderHost = document.getElementById('renderHost');
    this.render = Render.create({
      element: this.renderHost,
      engine: this.engine,
      options: {
        width: window.innerWidth,
        height: window.innerHeight - 56,
        wireframes: false,
        background: 'transparent',
        pixelRatio: window.devicePixelRatio
      }
    });

    this.ghostCanvas = document.getElementById('ghostCanvas');
    this.ghostCtx = this.ghostCanvas.getContext('2d');

    this.mouse = Mouse.create(this.render.canvas);
    this.mouseConstraint = MouseConstraint.create(this.engine, {
      mouse: this.mouse,
      constraint: {
        stiffness: 0.12,
        render: { visible: false }
      }
    });
    World.add(this.engine.world, this.mouseConstraint);

    this.objects = [];
    this.bodyMap = new Map();
    this.selectedIds = [];
    this.tool = 'select';
    this.isDrawing = false;
    this.dragStart = null;
    this.history = [];
    this.historyIndex = -1;
    this.nextId = 1;

    this.bindUI();
    this.resize();
    this.addBounds();
    this.commitHistory();
    this.registerEvents();

    Events.on(this.engine, 'afterUpdate', () => this.syncModelTransforms());

    Render.run(this.render);
    Runner.run(this.runner, this.engine);
  }

  resize() {
    const height = window.innerHeight - 56;
    this.render.canvas.width = window.innerWidth;
    this.render.canvas.height = height;
    this.ghostCanvas.width = window.innerWidth;
    this.ghostCanvas.height = height;
    Render.lookAt(this.render, {
      min: { x: 0, y: 0 },
      max: { x: window.innerWidth, y: height }
    });
  }

  addBounds() {
    const w = window.innerWidth;
    const h = window.innerHeight - 56;
    const thickness = 80;
    const walls = [
      Bodies.rectangle(w / 2, h + thickness / 2, w, thickness, { isStatic: true }),
      Bodies.rectangle(w / 2, -thickness / 2, w, thickness, { isStatic: true }),
      Bodies.rectangle(-thickness / 2, h / 2, thickness, h, { isStatic: true }),
      Bodies.rectangle(w + thickness / 2, h / 2, thickness, h, { isStatic: true })
    ];
    World.add(this.engine.world, walls);
  }

  registerEvents() {
    window.addEventListener('resize', () => this.resize());

    Events.on(this.mouseConstraint, 'mousedown', (event) => {
      if (this.tool !== 'select') return;
      const body = event.source.body || this.getBodyAtPointer(event.mouse.position);
      if (body && body.plugin && body.plugin.modelId) {
        this.handleSelection(body.plugin.modelId, event.mouse.sourceEvents.mousedown.shiftKey);
      } else {
        this.clearSelection();
      }
    });

    Events.on(this.mouseConstraint, 'startdrag', (event) => {
      const body = event.body;
      if (body?.plugin?.locked) {
        this.mouseConstraint.body = null;
      } else if (body?.plugin?.modelId) {
        this.handleSelection(body.plugin.modelId, event.source.mouse.sourceEvents.mousedown.shiftKey);
      }
    });

    this.render.canvas.addEventListener('mousedown', (e) => this.handleCanvasDown(e));
    window.addEventListener('mousemove', (e) => this.handleCanvasMove(e));
    window.addEventListener('mouseup', (e) => this.handleCanvasUp(e));
    window.addEventListener('keydown', (e) => this.handleKey(e));
  }

  bindUI() {
    this.inspector = document.getElementById('inspector');
    this.inspectorTitle = document.getElementById('inspectorTitle');

    document.getElementById('toolButtons').addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      const tool = button.dataset.tool;
      if (tool) {
        this.tool = tool;
        this.updateToolButtons(tool);
        this.showHint(TOOL_HINTS[tool]);
      }
      const action = button.dataset.action;
      if (action === 'duplicate') this.duplicateSelection();
      if (action === 'delete') this.deleteSelection();
    });

    document.getElementById('collapseTools').addEventListener('click', () => {
      document.getElementById('toolbelt').classList.toggle('collapsed');
    });

    document.getElementById('undoBtn').addEventListener('click', () => this.undo());
    document.getElementById('redoBtn').addEventListener('click', () => this.redo());
    document.getElementById('saveSceneBtn').addEventListener('click', () => this.showSave());
    document.getElementById('closeDialog').addEventListener('click', () => this.hideSave());
    document.getElementById('copyScene').addEventListener('click', () => this.copyScene());
    document.getElementById('loadSceneInput').addEventListener('change', (e) => this.loadScene(e));

    document.getElementById('closeInspector').addEventListener('click', () => this.clearSelection());

    this.setupPills('bodyTypePills', (type) => this.updateSelection({ bodyType: type }));
    this.setupPills('shapePills', (shape) => this.changeShape(shape));
    this.setupPills('renderModes', (renderMode) => this.updateVisual({ renderMode }));
    this.populatePresetRow('behaviorPresets', PHYSICS_PRESETS, (name) => {
      this.updatePhysics(PHYSICS_PRESETS[name]);
    });
    this.populatePresetRow('visualPresets', VISUAL_PRESETS, (name) => {
      this.updateVisual(VISUAL_PRESETS[name]);
    });

    this.linkSlider('restitution', 'restitutionValue', (v) => this.updatePhysics({ restitution: v }));
    this.linkSlider('friction', 'frictionValue', (v) => this.updatePhysics({ friction: v }));
    this.linkSlider('air', 'airValue', (v) => this.updatePhysics({ frictionAir: v }));
    this.linkSlider('density', 'densityValue', (v) => this.updatePhysics({ density: v }));
    this.linkSlider('frictionStatic', 'frictionStaticValue', (v) => this.updatePhysics({ frictionStatic: v }));

    this.linkSlider('strokeWidth', 'strokeWidthValue', (v) => this.updateVisual({ strokeWidth: v }));
    this.linkSlider('opacity', 'opacityValue', (v) => this.updateVisual({ opacity: v }));
    this.linkSlider('polygonSides', 'polygonSidesValue', (v) => this.changePolygonSides(Math.round(v)));

    document.getElementById('fill').addEventListener('change', (e) => this.updateVisual({ fill: e.target.value }));
    document.getElementById('stroke').addEventListener('change', (e) => this.updateVisual({ stroke: e.target.value }));
    document.getElementById('lockToggle').addEventListener('change', (e) => this.toggleLock(e.target.checked));
  }

  setupPills(id, onClick) {
    document.getElementById(id).addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      [...e.currentTarget.children].forEach((b) => b.classList.toggle('active', b === btn));
      onClick(btn.dataset.type || btn.dataset.shape || btn.dataset.render);
    });
  }

  populatePresetRow(id, presetMap, onClick) {
    const row = document.getElementById(id);
    row.innerHTML = '';
    Object.keys(presetMap).forEach((name) => {
      const btn = document.createElement('button');
      btn.className = 'pill';
      btn.textContent = name;
      btn.addEventListener('click', () => onClick(name));
      row.appendChild(btn);
    });
  }

  linkSlider(id, valueId, onChange) {
    const input = document.getElementById(id);
    const label = document.getElementById(valueId);
    const format = (v) => Number(v).toFixed(v < 0.1 ? 3 : 2);
    label.textContent = format(input.value);
    input.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      label.textContent = format(v);
      onChange(v);
    });
  }

  handleCanvasDown(event) {
    if (this.tool === 'select') return;
    const rect = this.render.canvas.getBoundingClientRect();
    this.isDrawing = true;
    this.dragStart = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  handleCanvasMove(event) {
    if (!this.isDrawing || this.tool === 'select') return;
    const rect = this.render.canvas.getBoundingClientRect();
    const current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    this.drawGhost(this.dragStart, current, this.tool);
  }

  handleCanvasUp(event) {
    if (!this.isDrawing || this.tool === 'select') return;
    const rect = this.render.canvas.getBoundingClientRect();
    const end = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const start = this.dragStart;
    this.isDrawing = false;
    this.clearGhost();

    const minSize = 32;
    const width = Math.max(Math.abs(end.x - start.x), 12);
    const height = Math.max(Math.abs(end.y - start.y), 12);
    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

    const shape = (() => {
      if (this.tool === 'circle' || this.tool === 'sensor') {
        const radius = Math.max(Math.hypot(end.x - start.x, end.y - start.y) / 2, minSize / 2);
        return { type: 'circle', radius };
      }
      if (this.tool === 'polygon') {
        const radius = Math.max(Math.hypot(end.x - start.x, end.y - start.y) / 2, minSize / 2);
        return { type: 'polygon', sides: Math.round(document.getElementById('polygonSides').value), radius };
      }
      return { type: 'rectangle', width: Math.max(width, minSize), height: Math.max(height, minSize) };
    })();

    const bodyType = this.tool === 'wall' ? 'static' : this.tool === 'sensor' ? 'sensor' : 'dynamic';
    const model = this.createModel({
      position: center,
      shape,
      bodyType
    });
    this.addModelToWorld(model);
    this.commitHistory();
    this.handleSelection(model.id);
  }

  drawGhost(start, end, tool) {
    this.clearGhost();
    const ctx = this.ghostCtx;
    ctx.save();
    ctx.strokeStyle = 'rgba(34,211,238,0.8)';
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 2;
    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const radius = Math.max(Math.hypot(end.x - start.x, end.y - start.y) / 2, 16);
    if (tool === 'circle' || tool === 'sensor') {
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tool === 'polygon') {
      const sides = Math.round(document.getElementById('polygonSides').value);
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        const x = center.x + radius * Math.cos(angle);
        const y = center.y + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.strokeRect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y));
    }
    ctx.restore();
  }

  clearGhost() {
    this.ghostCtx.clearRect(0, 0, this.ghostCanvas.width, this.ghostCanvas.height);
  }

  createModel({ position, shape, bodyType }) {
    const id = `obj-${this.nextId++}`;
    return {
      id,
      label: shape.type,
      position,
      angle: 0,
      bodyType,
      locked: false,
      shape,
      physics: { ...DEFAULT_PHYSICS },
      visual: { ...DEFAULT_VISUAL }
    };
  }

  addModelToWorld(model) {
    this.objects.push(model);
    const body = this.buildBody(model);
    World.add(this.engine.world, body);
    this.bodyMap.set(model.id, body);
  }

  buildBody(model) {
    const opts = {
      restitution: model.physics.restitution,
      friction: model.physics.friction,
      frictionAir: model.physics.frictionAir,
      frictionStatic: model.physics.frictionStatic,
      density: model.physics.density,
      isStatic: model.bodyType === 'static',
      isSensor: model.bodyType === 'sensor',
      render: this.renderOptionsFor(model.visual)
    };
    let body;
    const { shape } = model;
    if (shape.type === 'circle') {
      body = Bodies.circle(model.position.x, model.position.y, shape.radius, opts);
    } else if (shape.type === 'rectangle') {
      body = Bodies.rectangle(model.position.x, model.position.y, shape.width, shape.height, opts);
    } else {
      const sides = Math.max(3, shape.sides || 5);
      body = Bodies.polygon(model.position.x, model.position.y, sides, shape.radius, opts);
    }
    if (model.angle) Body.setAngle(body, model.angle);
    body.plugin = { modelId: model.id, locked: model.locked };
    return body;
  }

  renderOptionsFor(visual) {
    const base = {
      fillStyle: visual.fill,
      strokeStyle: visual.stroke,
      lineWidth: visual.strokeWidth,
      opacity: visual.opacity
    };
    if (visual.renderMode === 'outline') {
      base.fillStyle = 'transparent';
    }
    if (visual.renderMode === 'gradient') {
      base.fillStyle = this.gradientFor(visual);
    }
    return base;
  }

  gradientFor(visual) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const gctx = c.getContext('2d');
    const grad = gctx.createLinearGradient(0, 0, 64, 64);
    grad.addColorStop(0, visual.fill);
    grad.addColorStop(1, visual.stroke);
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 64, 64);
    return gctx.createPattern(c, 'repeat');
  }

  handleSelection(id, additive = false) {
    if (additive) {
      if (!this.selectedIds.includes(id)) this.selectedIds.push(id);
    } else {
      this.selectedIds = [id];
    }
    this.updateSelectionVisuals();
    this.showInspector();
  }

  clearSelection() {
    this.selectedIds = [];
    this.updateSelectionVisuals();
    this.inspector.classList.add('hidden');
  }

  updateSelectionVisuals() {
    this.bodyMap.forEach((body, id) => {
      const model = this.objects.find((o) => o.id === id);
      if (!model) return;
      const visual = { ...model.visual };
      if (this.selectedIds.includes(id)) {
        visual.strokeWidth = (visual.strokeWidth || 2) + 2;
        visual.stroke = '#f472b6';
      }
      body.render = { ...body.render, ...this.renderOptionsFor(visual) };
    });
    if (this.selectedIds.length) {
      const primary = this.objects.find((o) => o.id === this.selectedIds[0]);
      this.inspectorTitle.textContent = `${this.selectedIds.length} selected • ${primary?.label || ''}`;
      this.syncInspector(primary);
    }
  }

  syncInspector(model) {
    if (!model) return;
    this.inspector.classList.remove('hidden');
    this.setActivePill('bodyTypePills', model.bodyType);
    this.setActivePill('shapePills', model.shape.type);
    this.setActivePill('renderModes', model.visual.renderMode);
    document.getElementById('polygonSides').value = model.shape.sides || 5;
    document.getElementById('polygonSidesValue').textContent = model.shape.sides || 5;
    document.getElementById('restitution').value = model.physics.restitution;
    document.getElementById('restitutionValue').textContent = Number(model.physics.restitution).toFixed(2);
    document.getElementById('friction').value = model.physics.friction;
    document.getElementById('frictionValue').textContent = Number(model.physics.friction).toFixed(2);
    document.getElementById('air').value = model.physics.frictionAir;
    document.getElementById('airValue').textContent = Number(model.physics.frictionAir).toFixed(3);
    document.getElementById('density').value = model.physics.density;
    document.getElementById('densityValue').textContent = Number(model.physics.density).toFixed(3);
    document.getElementById('frictionStatic').value = model.physics.frictionStatic;
    document.getElementById('frictionStaticValue').textContent = Number(model.physics.frictionStatic).toFixed(2);
    document.getElementById('fill').value = model.visual.fill;
    document.getElementById('stroke').value = model.visual.stroke;
    document.getElementById('strokeWidth').value = model.visual.strokeWidth;
    document.getElementById('strokeWidthValue').textContent = Number(model.visual.strokeWidth).toFixed(1);
    document.getElementById('opacity').value = model.visual.opacity;
    document.getElementById('opacityValue').textContent = Number(model.visual.opacity).toFixed(2);
    document.getElementById('lockToggle').checked = model.locked;
  }

  setActivePill(groupId, value) {
    [...document.getElementById(groupId).children].forEach((btn) => {
      const candidate = btn.dataset.type || btn.dataset.shape || btn.dataset.render;
      btn.classList.toggle('active', candidate === value);
    });
  }

  updatePhysics(patch) {
    if (!this.selectedIds.length) return;
    this.selectedIds.forEach((id) => {
      const model = this.objects.find((o) => o.id === id);
      if (!model) return;
      model.physics = { ...model.physics, ...patch };
      this.rebuildBody(model);
    });
    this.commitHistory();
  }

  updateVisual(patch) {
    if (!this.selectedIds.length) return;
    this.selectedIds.forEach((id) => {
      const model = this.objects.find((o) => o.id === id);
      if (!model) return;
      model.visual = { ...model.visual, ...patch };
      const body = this.bodyMap.get(id);
      if (body) body.render = { ...body.render, ...this.renderOptionsFor(model.visual) };
    });
    this.updateSelectionVisuals();
    this.commitHistory();
  }

  updateSelection(patch) {
    if (!this.selectedIds.length) return;
    this.selectedIds.forEach((id) => {
      const model = this.objects.find((o) => o.id === id);
      if (!model) return;
      Object.assign(model, patch);
      this.rebuildBody(model);
    });
    this.commitHistory();
  }

  changeShape(shapeType) {
    if (!this.selectedIds.length) return;
    this.selectedIds.forEach((id) => {
      const model = this.objects.find((o) => o.id === id);
      if (!model) return;
      const body = this.bodyMap.get(id);
      if (!body) return;
      const bounds = body.bounds;
      const size = {
        width: bounds.max.x - bounds.min.x,
        height: bounds.max.y - bounds.min.y
      };
      const radius = Math.max(size.width, size.height) / 2;
      const newShape = this.shapeDefaults(shapeType, { size, radius });
      model.shape = { ...newShape };
      model.position = { x: body.position.x, y: body.position.y };
      model.label = shapeType;
      this.rebuildBody(model);
    });
    this.commitHistory();
  }

  shapeDefaults(type, dims = { size: { width: 90, height: 60 }, radius: 48 }) {
    if (type === 'circle') return { type, radius: dims.radius };
    if (type === 'polygon') return { type, sides: 5, radius: dims.radius };
    return { type: 'rectangle', width: dims.size.width, height: dims.size.height };
  }

  changePolygonSides(sides) {
    if (!this.selectedIds.length) return;
    this.selectedIds.forEach((id) => {
      const model = this.objects.find((o) => o.id === id);
      if (model && model.shape.type === 'polygon') {
        model.shape.sides = sides;
        this.rebuildBody(model);
      }
    });
    this.commitHistory();
  }

  toggleLock(lock) {
    this.selectedIds.forEach((id) => {
      const model = this.objects.find((o) => o.id === id);
      if (model) {
        model.locked = lock;
        const body = this.bodyMap.get(id);
        if (body) body.plugin.locked = lock;
      }
    });
    this.updateSelectionVisuals();
    this.commitHistory();
  }

  rebuildBody(model) {
    const existing = this.bodyMap.get(model.id);
    if (!existing) return;
    const state = {
      position: { ...existing.position },
      velocity: { ...existing.velocity },
      angularVelocity: existing.angularVelocity,
      angle: existing.angle
    };
    World.remove(this.engine.world, existing);
    const body = this.buildBody(model);
    Body.setPosition(body, state.position);
    Body.setVelocity(body, state.velocity);
    Body.setAngularVelocity(body, state.angularVelocity);
    Body.setAngle(body, state.angle);
    World.add(this.engine.world, body);
    this.bodyMap.set(model.id, body);
    this.updateSelectionVisuals();
  }

  handleKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selectedIds.length) {
        e.preventDefault();
        this.deleteSelection();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.duplicateSelection();
    }
  }

  duplicateSelection() {
    if (!this.selectedIds.length) return;
    const newIds = [];
    this.selectedIds.forEach((id) => {
      const model = this.objects.find((o) => o.id === id);
      if (!model) return;
      const clone = structuredClone(model);
      clone.id = `obj-${this.nextId++}`;
      clone.position = { x: model.position.x + 20, y: model.position.y - 20 };
      this.objects.push(clone);
      const body = this.buildBody(clone);
      World.add(this.engine.world, body);
      this.bodyMap.set(clone.id, body);
      newIds.push(clone.id);
    });
    this.commitHistory();
    if (newIds.length) this.handleSelection(newIds[0]);
  }

  deleteSelection() {
    if (!this.selectedIds.length) return;
    this.selectedIds.forEach((id) => {
      const body = this.bodyMap.get(id);
      if (body) World.remove(this.engine.world, body);
      this.bodyMap.delete(id);
      this.objects = this.objects.filter((o) => o.id !== id);
    });
    this.clearSelection();
    this.commitHistory();
  }

  getBodyAtPointer(pos) {
    const bodies = Composite.allBodies(this.engine.world);
    const found = bodies.filter((b) => Bounds.contains(b.bounds, pos));
    for (const body of found) {
      if (Vertices.contains(body.vertices, pos)) return body;
    }
    return null;
  }

  showInspector() {
    if (!this.selectedIds.length) return;
    const model = this.objects.find((o) => o.id === this.selectedIds[0]);
    if (model) this.syncInspector(model);
  }

  showHint(text) {
    if (!this.hint) {
      this.hint = document.createElement('div');
      this.hint.className = 'hint';
      document.querySelector('.canvas-wrapper').appendChild(this.hint);
    }
    this.hint.textContent = text;
  }

  commitHistory() {
    this.syncModelTransforms();
    const snapshot = JSON.parse(JSON.stringify({ objects: this.objects, nextId: this.nextId }));
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snapshot);
    this.historyIndex = this.history.length - 1;
  }

  applySnapshot(snapshot) {
    this.objects = JSON.parse(JSON.stringify(snapshot.objects));
    this.nextId = snapshot.nextId;
    this.selectedIds = [];
    this.bodyMap.forEach((body) => World.remove(this.engine.world, body));
    this.bodyMap.clear();
    this.objects.forEach((model) => {
      const body = this.buildBody(model);
      World.add(this.engine.world, body);
      this.bodyMap.set(model.id, body);
    });
    this.updateSelectionVisuals();
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.applySnapshot(this.history[this.historyIndex]);
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.applySnapshot(this.history[this.historyIndex]);
  }

  showSave() {
    const dialog = document.getElementById('saveDialog');
    const text = document.getElementById('sceneText');
    text.value = JSON.stringify({ objects: this.objects }, null, 2);
    dialog.classList.remove('hidden');
  }

  hideSave() {
    document.getElementById('saveDialog').classList.add('hidden');
  }

  copyScene() {
    const text = document.getElementById('sceneText').value;
    navigator.clipboard.writeText(text);
    document.getElementById('copyScene').textContent = 'Copied!';
    setTimeout(() => (document.getElementById('copyScene').textContent = 'Copy JSON'), 1200);
  }

  loadScene(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.objects) throw new Error('Invalid scene');
        const nextId = data.nextId || this.inferNextId(data.objects);
        this.applySnapshot({ objects: data.objects, nextId });
        this.commitHistory();
      } catch (err) {
        alert('Failed to load scene: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  syncModelTransforms() {
    this.objects.forEach((model) => {
      const body = this.bodyMap.get(model.id);
      if (!body) return;
      model.position = { x: body.position.x, y: body.position.y };
      model.angle = body.angle;
    });
  }

  inferNextId(objs) {
    const ids = objs.map((o) => parseInt((o.id || '').split('-')[1], 10)).filter((n) => !Number.isNaN(n));
    return (Math.max(-1, ...ids) || 0) + 1;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const playground = new Playground();
  playground.showHint(TOOL_HINTS.select);
});
