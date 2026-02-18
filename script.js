const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl');
const editor = document.getElementById('code-editor');
const log = document.getElementById('log');
const status = document.getElementById('status');

// Handle basic GL setup
if (!gl) {
    alert('WebGL not supported');
}

// Full-screen quad attributes and VBO
const vertices = new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1,
]);

const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

// Vertex shader source (fixed)
const vsSource = `
attribute vec2 position;
void main() {
    gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Default Fragment shader source (user editable)
const defaultFsSource = `
#ifdef GL_ES
precision mediump float;
#endif

uniform float iTime;
uniform vec2 iResolution;
uniform vec4 iMouse;

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord/iResolution.xy;

    // Time varying pixel color
    vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));

    // Output to screen
    fragColor = vec4(col,1.0);
}
`;

// Helper to compile a shader
function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        log.textContent = 'Error compiling shader:\n' + info;
        log.classList.add('show');
        status.textContent = 'Compilation Error';
        status.style.color = '#ff6b6b';
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

let program = null;
let startTime = Date.now();
let mouse = { x: 0, y: 0, z: 0, w: 0 }; // x, y, clickX, clickY

function initShaders(fsSource) {
    // Clear previous errors
    log.textContent = '';
    log.classList.remove('show');
    status.textContent = 'Running...';
    status.style.color = '#4caf50';

    const vs = compileShader(gl, vsSource, gl.VERTEX_SHADER);
    
    // Auto-append main() if not present, to match ShaderToy style
    let fullFsSource = fsSource;
    if (!/void\s+main\s*\(/.test(fsSource)) {
        fullFsSource += "\nvoid main() { mainImage(gl_FragColor, gl_FragCoord.xy); }";
    }
    const fs = compileShader(gl, fullFsSource, gl.FRAGMENT_SHADER);

    if (!vs || !fs) return;

    if (program) {
        gl.deleteProgram(program);
    }

    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        log.textContent = 'Error linking program:\n' + gl.getProgramInfoLog(program);
        log.classList.add('show');
        status.textContent = 'Link Error';
        status.style.color = '#ff6b6b';
        return;
    }

    gl.useProgram(program);
    
    // Set up attributes
    const positionLocation = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    startTime = Date.now(); // Reset time on reload? Maybe nice
}

function render() {
    if (!program) {
        requestAnimationFrame(render);
        return;
    }

    // Update canvas size
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    gl.useProgram(program);

    // Set uniforms
    const iTimeLocation = gl.getUniformLocation(program, 'iTime');
    const iResolutionLocation = gl.getUniformLocation(program, 'iResolution');
    const iMouseLocation = gl.getUniformLocation(program, 'iMouse');

    const currentTime = (Date.now() - startTime) / 1000.0;
    
    if (iTimeLocation !== -1) gl.uniform1f(iTimeLocation, currentTime);
    if (iResolutionLocation !== -1) gl.uniform2f(iResolutionLocation, canvas.width, canvas.height);
    if (iMouseLocation !== -1) gl.uniform4f(iMouseLocation, mouse.x, mouse.y, mouse.z, mouse.w);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(render);
}

// Mouse handling
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = canvas.height - (e.clientY - rect.top); // Flip Y
    if (mouse.z > 0) { // Dragging
        mouse.z = mouse.x;
        mouse.w = mouse.y;
    }
});

canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.z = e.clientX - rect.left;
    mouse.w = canvas.height - (e.clientY - rect.top);
});

canvas.addEventListener('mouseup', () => {
    mouse.z = -Math.abs(mouse.z); // released
    mouse.w = -Math.abs(mouse.w);
});


// Editor setup
editor.value = defaultFsSource;
editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + "    " + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 4;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        initShaders(editor.value);
    }
});

// Controls
document.getElementById('run-btn').addEventListener('click', () => {
    initShaders(editor.value);
});

document.getElementById('load-btn').addEventListener('click', () => {
    // Ideally load from file or predefined list, for now just reset
    if (confirm('Reset to default shader?')) {
        editor.value = defaultFsSource;
        initShaders(defaultFsSource);
    }
});

// Initial run
initShaders(defaultFsSource);
requestAnimationFrame(render);
