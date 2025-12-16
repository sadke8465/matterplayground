# Matter Playground

A playful-yet-precise Matter.js sandbox focused on a Create → Select → Edit workflow. Add shapes with ghost previews, tweak physics and visuals independently, and save/restore scenes.

## Running locally

This project is framework-free and uses CDN-loaded Matter.js. You can run it with any static file server; for example:

```bash
python -m http.server 8000
```

Then open http://localhost:8000/ in your browser and start experimenting.

## Key interactions

- **Tools:** Select, Circle, Rectangle, Polygon, Static Wall, Sensor, Duplicate, Delete.
- **Ghost placement:** Drag to preview before dropping a body.
- **Selection:** Click to select, Shift-click for multi-select. Drag selected bodies with physics constraints.
- **Inspector:** Auto-opens on selection with Type & Shape, Behavior (physics), Appearance (visuals), presets, and advanced sliders.
- **Shape switching:** Swap circle/rectangle/polygon while preserving position, velocity, angle, and IDs.
- **Physics presets:** Rubber, Ice, Wood, Metal, Balloon.
- **Visual presets:** Neon, Wireframe, Paper, Glass. Render modes: solid, outline, gradient.
- **Scene management:** Undo/redo, lock objects from drag, duplicate, delete, save/load scenes as JSON.
