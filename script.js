const container = document.getElementById('node-container');
const editor = document.getElementById('code-editor');
const log = document.getElementById('log');
const status = document.getElementById('status');
const connectionsSvg = document.getElementById('connections');
const nodeTemplate = document.getElementById('node-template');

// Global State
let nodes = [];
let connections = [];
let selectedNode = null;
let nextNodeId = 1;

// WebGL Context
const sharedCanvas = document.createElement('canvas'); // Hidden master canvas
sharedCanvas.width = 512; 
sharedCanvas.height = 512;
const gl = sharedCanvas.getContext('webgl2', { preserveDrawingBuffer: true });

if (!gl) {
    alert('WebGL 2 not supported - required for multi-target layout');
}

// Full-screen quad
const vertices = new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1,
]);

const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

const vsSource = `#version 300 es
in vec4 position;
void main() {
    gl_Position = position;
}
`;

const defaultFsSource = `#version 300 es
precision mediump float;

out vec4 fragColor;

// Input texture is available as:
// uniform sampler2D iChannel0;

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord/iResolution.xy;
    
    // Example: Sample input texture
    // vec4 tex = texture(iChannel0, uv);
    
    vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));
    
    // Mix with texture if you want:
    // col = mix(col, tex.rgb, 0.5);

    fragColor = vec4(col,1.0);
}

void main() {
    mainImage(fragColor, gl_FragCoord.xy);
}
`;

class ShaderNode {
    constructor(id, x, y, code = defaultFsSource) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.code = code;
        this.program = null;
        this.texture = null;
        this.framebuffer = null;
        this.inputs = []; // List of node IDs connected to input
        
        // UI Elements
        this.element = this.createUI();
        this.canvas = this.element.querySelector('canvas');
        this.ctx2d = this.canvas.getContext('2d');
        
        // Init GL Resources
        this.initResources();
        this.compile();
    }

    createUI() {
        const clone = nodeTemplate.content.cloneNode(true);
        const el = clone.querySelector('.node');
        el.style.left = this.x + 'px';
        el.style.top = this.y + 'px';
        el.id = 'node-' + this.id;
        
        el.querySelector('.node-title').textContent = 'Shader Node ' + this.id;
        
        // Handling selection
        el.addEventListener('mousedown', (e) => {
            if (e.target.closest('.socket')) return; // Ignore if clicking socket
            selectNode(this);
            startDrag(e, this);
        });

        // Close button
        el.querySelector('.node-close').addEventListener('click', (e) => {
            e.stopPropagation();
            removeNode(this);
        });

        container.appendChild(el);
        return el;
    }

    initResources() {
        // Create a texture to render to
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // Framebuffer
        this.framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    compile() {
        let prefix = `#version 300 es
precision mediump float;
uniform float iTime;
uniform vec2 iResolution;
uniform vec4 iMouse;
`;
        // Add inputs
        prefix += `uniform sampler2D iChannel0;\n`;

        // Strip version from user code if present
        let userCode = this.code.replace(/#version\s+300\s+es(\s*precision\s+mediump\s+float;)?/, '');
        
        // Remove standard uniforms if present in user code to avoid redefinition
        userCode = userCode.replace(/uniform\s+float\s+iTime;/, '');
        userCode = userCode.replace(/uniform\s+vec2\s+iResolution;/, '');
        userCode = userCode.replace(/uniform\s+vec4\s+iMouse;/, '');

        const fsSource = prefix + userCode;
        
        const vs = compileShader(gl, vsSource, gl.VERTEX_SHADER);
        const fs = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);
        
        if (!vs || !fs) return;

        if (this.program) gl.deleteProgram(this.program);
        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error(gl.getProgramInfoLog(this.program));
            return;
        }
    }

    render(time) {
        if (!this.program) return;

        gl.useProgram(this.program);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, 512, 512);

        // Uniforms
        const locTime = gl.getUniformLocation(this.program, 'iTime');
        if (locTime) gl.uniform1f(locTime, time);
        
        const locRes = gl.getUniformLocation(this.program, 'iResolution');
        if (locRes) gl.uniform2f(locRes, 512, 512);
        
        // Bind Inputs
        // Force bind to texture unit 0
        gl.activeTexture(gl.TEXTURE0);
        if (this.inputs.length > 0) {
            const inputNode = nodes.find(n => n.id === this.inputs[0]);
            if (inputNode && inputNode.texture) {
                gl.bindTexture(gl.TEXTURE_2D, inputNode.texture);
            } else {
                 gl.bindTexture(gl.TEXTURE_2D, null);
            }
        } else {
             gl.bindTexture(gl.TEXTURE_2D, null);
        }
        
        // Always set uSampler
        const locCh0 = gl.getUniformLocation(this.program, 'iChannel0');
        if (locCh0) gl.uniform1i(locCh0, 0);


        // Draw
        const positionLocation = gl.getAttribLocation(this.program, 'position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Copy to Canvas 2D
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        drawTexture(this.texture);
        this.ctx2d.drawImage(sharedCanvas, 0, 0, this.canvas.width, this.canvas.height);
    }
}

// Helper to draw a texture to screen (simple pass-through)
const displayProgramVs = `#version 300 es
in vec4 position;
out vec2 vUv;
void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = position;
}`;
const displayProgramFs = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() {
    outColor = texture(uTex, vUv);
}`;

let displayProgram = null;
function initDisplayProgram() {
    const vs = compileShader(gl, displayProgramVs, gl.VERTEX_SHADER);
    const fs = compileShader(gl, displayProgramFs, gl.FRAGMENT_SHADER);
    displayProgram = gl.createProgram();
    gl.attachShader(displayProgram, vs);
    gl.attachShader(displayProgram, fs);
    gl.linkProgram(displayProgram);
}

function drawTexture(tex) {
    if (!displayProgram) initDisplayProgram();
    gl.useProgram(displayProgram);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(displayProgram, 'uTex'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// -- Graph Management --

function addNode() {
    const node = new ShaderNode(nextNodeId++, 50 + (nodes.length * 30), 50 + (nodes.length * 30));
    nodes.push(node);
    selectNode(node);
}

function removeNode(node) {
    // Cleanup GL
    if(node.texture) gl.deleteTexture(node.texture);
    if(node.framebuffer) gl.deleteFramebuffer(node.framebuffer);
    if(node.program) gl.deleteProgram(node.program);
    
    // Remove UI
    node.element.remove();
    
    // Remove from array
    nodes = nodes.filter(n => n !== node);
    
    // Remove input references
    nodes.forEach(n => {
        n.inputs = n.inputs.filter(id => id !== node.id);
    });

    if (selectedNode === node) {
        selectedNode = null;
        editor.value = '';
        document.getElementById('current-node-name').textContent = 'Select a Node';
    }
    updateConnections();
}

function selectNode(node) {
    selectedNode = node;
    nodes.forEach(n => n.element.classList.remove('selected'));
    node.element.classList.add('selected');
    
    editor.value = node.code;
    document.getElementById('current-node-name').textContent = 'Node ' + node.id;
}

// -- Interaction (Drag & Connect) --
let dragNode = null;
let dragOffset = {x:0, y:0};

function startDrag(e, node) {
    dragNode = node;
    dragOffset.x = e.clientX - node.x;
    dragOffset.y = e.clientY - node.y;
    
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
}

function onDrag(e) {
    if (!dragNode) return;
    dragNode.x = e.clientX - dragOffset.x;
    dragNode.y = e.clientY - dragOffset.y;
    dragNode.element.style.left = dragNode.x + 'px';
    dragNode.element.style.top = dragNode.y + 'px';
    updateConnections();
}

function endDrag() {
    dragNode = null;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', endDrag);
}

// Simple connection Logic (Click Output -> Click Input)
let connectionStart = null; // { nodeId, type }

document.addEventListener('click', (e) => {
    // Check if clicking on socket
    let target = e.target;
    if (!target.classList.contains('socket')) return;

    const nodeEl = target.closest('.node');
    const nodeId = parseInt(nodeEl.id.split('-')[1]);
    const node = nodes.find(n => n.id === nodeId);
    const type = target.classList.contains('input') ? 'input' : 'output';

    if (!connectionStart) {
        // Start connection
        if (type === 'output') {
            connectionStart = { node, element: target };
            target.style.background = '#fff'; // Highlight
        }
    } else {
        // Complete connection
        if (type === 'input' && connectionStart.node.id !== node.id) {
            // Node A (Output) -> Node B (Input)
            node.inputs = [connectionStart.node.id];
            console.log(`Connected ${connectionStart.node.id} to ${node.id}`);
            updateConnections();
        }
        
        // Reset state
        if(connectionStart.element) connectionStart.element.style.background = ''; // Remove highlight
        connectionStart = null;
    }
});

function updateConnections() {
    // Re-draw SVG lines
    connectionsSvg.innerHTML = ''; // clear
    nodes.forEach(targetNode => {
        targetNode.inputs.forEach(sourceId => {
            const sourceNode = nodes.find(n => n.id === sourceId);
            if (sourceNode) {
                drawLine(sourceNode, targetNode);
            }
        });
    });
}

function drawLine(n1, n2) {
    const p1 = n1.element.querySelector('.socket.output').getBoundingClientRect();
    const p2 = n2.element.querySelector('.socket.input').getBoundingClientRect();
    
    // Since SVG is absolute full screen, and nodes are absolute within node-container (which is full screen)
    // Client rects are screen space. path coordinates need to be relative to SVG.
    // SVG is at 0,0 of #workspace (relative), but #workspace is usually 0,0 of body.
    // Let's assume SVG covers full screen for MVP.
    
    const x1 = p1.left + p1.width/2;
    const y1 = p1.top + p1.height/2;
    const x2 = p2.left + p2.width/2;
    const y2 = p2.top + p2.height/2;
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = `M ${x1} ${y1} C ${x1+50} ${y1}, ${x2-50} ${y2}, ${x2} ${y2}`;
    path.setAttribute('d', d);
    connectionsSvg.appendChild(path);
}

// -- Main Loop --

function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

let startTime = Date.now();
function loop() {
    const time = (Date.now() - startTime) / 1000;
    
    nodes.forEach(node => {
        node.render(time);
    });

    requestAnimationFrame(loop);
}

// Init
document.getElementById('add-node-btn').addEventListener('click', addNode);
document.getElementById('run-btn').addEventListener('click', () => {
    if (selectedNode) {
        selectedNode.code = editor.value;
        selectedNode.compile();
    }
});

// Start with one node
addNode();
loop();

// Initial resize to fit window
window.addEventListener('resize', updateConnections);
