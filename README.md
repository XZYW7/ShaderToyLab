# ShaderToy Lab

ShaderToy Lab is a lightweight, local environment for experimenting with GLSL shaders, similar to ShaderToy.

## Features

- **Live Editing**: Write GLSL code and see updates instantly (Ctrl+Enter to compile).
- **Standard Uniforms**:
    - `iTime` (float): Time in seconds since start.
    - `iResolution` (vec2): Canvas resolution in pixels.
    - `iMouse` (vec4): Mouse coordinates (xy = current, zw = click).

## Getting Started

1. Open `index.html` in a modern web browser.
   - Or run a local server: `python server.py` and go to `http://localhost:8000`.

2. Start editing the shader code in the right panel.

3. Press **Ctrl+Enter** or click **Run** to compile and view your changes.

## Directory Structure

- `index.html`: The main application entry point.
- `script.js`: WebGL logic and editor handling.
- `style.css`: Basic styling.
- `shaders/`: Directory to save your shader experiments (manually for now).

## Tips

- The shader entry point is `mainImage(out vec4 fragColor, in vec2 fragCoord)`.
- Use the standard ShaderToy conventions.
