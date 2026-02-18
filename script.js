// ==========================================
// ShaderToy Lab - Main Script
// Refactored for Clarity and Structure
// ==========================================

// -- Constants & DOM Elements --
const DOM = {
    container: document.getElementById('node-container'),
    editor: document.getElementById('code-editor'),
    connectionsSvg: document.getElementById('connections'),
    nodeTemplate: document.getElementById('node-template'),
    inputs: {
        name: document.getElementById('node-name-input'),
        type: document.getElementById('node-type-select'),
        width: document.getElementById('node-res-w'),
        height: document.getElementById('node-res-h'),
        resContainer: document.getElementById('node-res-container'),
        colorContainer: document.getElementById('node-color-container'),
        colorPicker: document.getElementById('node-color-picker'),
        texture: document.getElementById('texture-input')
    },
    buttons: {
        upload: document.getElementById('upload-btn'),
        run: document.getElementById('run-btn'),
        addNode: document.getElementById('add-node-btn'),
        save: document.getElementById('save-btn') // Not implemented yet
    }
};

// -- Global State --
const AppState = {
    nodes: [],
    selectedNode: null,
    nextNodeId: 1,
    dragNode: null,
    dragOffset: { x: 0, y: 0 },
    connectionStart: null,
    startTime: Date.now()
};

// -- WebGL Context Setup --
const sharedCanvas = document.createElement('canvas'); // Hidden master canvas for rendering
sharedCanvas.width = 512;
sharedCanvas.height = 512;
const gl = sharedCanvas.getContext('webgl2', { preserveDrawingBuffer: true });

if (!gl) {
    alert('WebGL 2 not supported - required for multi-target layout');
}

// Full-screen quad buffer
const quadBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

// -- Shader Source Constants --
const SHADER_SOURCES = {
    DEFAULT_VS: `#version 300 es
        in vec4 position;
        void main() { gl_Position = position; }`,
    DEFAULT_FS: `#version 300 es
        precision mediump float;
        out vec4 fragColor;
        void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
            vec2 uv = fragCoord/iResolution.xy;
            vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));
            fragColor = vec4(col,1.0);
        }
        void main() { mainImage(fragColor, gl_FragCoord.xy); }`,
    DISPLAY_VS: `#version 300 es
        in vec4 position;
        out vec2 vUv;
        void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = position; }`,
    DISPLAY_FS: `#version 300 es
        precision mediump float;
        uniform sampler2D uTex;
        in vec2 vUv;
        out vec4 outColor;
        void main() { outColor = texture(uTex, vUv); }`
};

const UNIFORM_BLOCK = `
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrame;
uniform vec4 iMouse;
uniform vec4 iDate;
uniform float iSampleRate;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec3 iChannelResolution[4];
`;

// -- Helper Functions --

function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader Compile Error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

let displayProgram = null;
function getDisplayProgram() {
    if (displayProgram) return displayProgram;
    const vs = compileShader(gl, SHADER_SOURCES.DISPLAY_VS, gl.VERTEX_SHADER);
    const fs = compileShader(gl, SHADER_SOURCES.DISPLAY_FS, gl.FRAGMENT_SHADER);
    displayProgram = gl.createProgram();
    gl.attachShader(displayProgram, vs);
    gl.attachShader(displayProgram, fs);
    gl.linkProgram(displayProgram);
    return displayProgram;
}

function drawTexture(tex) {
    const prog = getDisplayProgram();
    gl.useProgram(prog);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    const posLoc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// -- ShaderNode Class --

class ShaderNode {
    constructor(id, x, y, code = SHADER_SOURCES.DEFAULT_FS, type = 'shader', width = 512, height = 512) {
        this.id = id;
        this.name = 'Node ' + id;
        this.x = x;
        this.y = y;
        this.code = code;
        this.type = type; // 'shader', 'texture', 'const'
        this.width = width;
        this.height = height;

        this.program = null;
        this.texture = null;
        this.framebuffer = null;
        this.inputs = []; // Array of Node IDs
        
        // UI Elements
        this.element = this.createUI();
        this.canvas = this.element.querySelector('canvas');
        this.ctx2d = this.canvas.getContext('2d');
        
        this.initResources();
        if (this.type === 'shader' || this.type === 'const') {
             this.compile();
        }
    }

    createUI() {
        const clone = DOM.nodeTemplate.content.cloneNode(true);
        const el = clone.querySelector('.node');
        el.style.left = this.x + 'px';
        el.style.top = this.y + 'px';
        el.id = 'node-' + this.id;
        
        this.updateTitle(el);
        
        el.addEventListener('mousedown', (e) => {
            if (e.target.closest('.socket')) return; 
            selectNode(this);
            startDrag(e, this);
        });

        el.querySelector('.node-close').addEventListener('click', (e) => {
            e.stopPropagation();
            removeNode(this);
        });

        DOM.container.appendChild(el);
        return el;
    }

    updateTitle(el = this.element) {
        if(el) el.querySelector('.node-title').textContent = `${this.name} (${this.type})`;
    }

    // Resource Management
    initResources() {
        // For Texture nodes, we preserve existing texture if possible
        if (this.type === 'texture') {
             if (!this.texture) {
                 this.texture = gl.createTexture();
                 gl.bindTexture(gl.TEXTURE_2D, this.texture);
                 gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
             }
             return;
        }

        // Cleanup old resources for renderable nodes
        if(this.texture) gl.deleteTexture(this.texture);
        if(this.framebuffer) gl.deleteFramebuffer(this.framebuffer);

        // Create main texture
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // Create Framebuffer
        this.framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    loadTexture(img) {
        this.width = img.width;
        this.height = img.height;
        
        // Update UI if selected
        if (AppState.selectedNode === this) {
            DOM.inputs.width.value = this.width;
            DOM.inputs.height.value = this.height;
        }

        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        
        gl.generateMipmap(gl.TEXTURE_2D);
        this.display(); 
    }

    compile() {
        if (this.type === 'texture') {
             this.program = null;
             return;
        }

        const vs = compileShader(gl, SHADER_SOURCES.DEFAULT_VS, gl.VERTEX_SHADER);
        if (!vs) return;

        let source = this.code;
        // Auto-inject uniforms
        if (!source.includes('uniform vec3 iResolution;')) {
             if (source.includes('precision mediump float;')) {
                 source = source.replace('precision mediump float;', 'precision mediump float;\n' + UNIFORM_BLOCK);
             } else if (source.includes('precision highp float;')) {
                 source = source.replace('precision highp float;', 'precision highp float;\n' + UNIFORM_BLOCK);
             } else if (source.includes('#version')) {
                 source = source.replace(/#version .*\n/, match => match + 'precision mediump float;\n' + UNIFORM_BLOCK);
             } else {
                 source = 'precision mediump float;\n' + UNIFORM_BLOCK + source;
             }
        }

        const fs = compileShader(gl, source, gl.FRAGMENT_SHADER);
        if (!fs) return;
        
        if (this.program) gl.deleteProgram(this.program);
        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error("Link Error:", gl.getProgramInfoLog(this.program));
            gl.deleteProgram(this.program);
            this.program = null;
        }
    }

    render(time) {
        if (this.type === 'texture') {
             this.display();
             return;
        }

        if (!this.program) return;

        gl.useProgram(this.program);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, this.width, this.height);

        // -- Set Uniforms --
        const locTime = gl.getUniformLocation(this.program, 'iTime');
        if (locTime) gl.uniform1f(locTime, time);
        
        const locRes = gl.getUniformLocation(this.program, 'iResolution');
        if (locRes) gl.uniform3f(locRes, this.width, this.height, 1.0);
        
        // -- Bind Inputs & Channel Resolutions --
        const channelResolutions = new Float32Array(12);

        for (let i = 0; i < 4; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            let tex = null;
            let w = 0, h = 0;

            if (i < this.inputs.length) {
                const inputNode = AppState.nodes.find(n => n.id === this.inputs[i]);
                if (inputNode && inputNode.texture) {
                    tex = inputNode.texture;
                    w = inputNode.width;
                    h = inputNode.height;
                }
            }
            
            gl.bindTexture(gl.TEXTURE_2D, tex); // Binds null if no input
            
            const loc = gl.getUniformLocation(this.program, 'iChannel' + i);
            if (loc) gl.uniform1i(loc, i);
            
            channelResolutions[i*3] = w;
            channelResolutions[i*3+1] = h;
            channelResolutions[i*3+2] = 1.0; 
        }

        const locChanRes = gl.getUniformLocation(this.program, 'iChannelResolution');
        if (locChanRes) gl.uniform3fv(locChanRes, channelResolutions);
        
        // Draw Fullscreen Quad
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer); // Re-bind to be safe
        const posLoc = gl.getAttribLocation(this.program, 'position');
        if(posLoc !== -1) {
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        }
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // -- Display Result --
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.display();
    }

    display() {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Ensure sharedCanvas matches buffer size 
        if (sharedCanvas.width !== this.width || sharedCanvas.height !== this.height) {
             sharedCanvas.width = this.width;
             sharedCanvas.height = this.height;
        }

        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(0,0,0,0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        drawTexture(this.texture);

        // Copy to 2D Canvas
        this.ctx2d.drawImage(sharedCanvas, 0, 0, this.width, this.height, 0, 0, this.canvas.width, this.canvas.height);
    }
}

// -- Graph Management --

function addNode() {
    const node = new ShaderNode(AppState.nextNodeId++, 50 + (AppState.nodes.length * 30), 50 + (AppState.nodes.length * 30));
    AppState.nodes.push(node);
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
    AppState.nodes = AppState.nodes.filter(n => n !== node);
    
    // Remove input references
    AppState.nodes.forEach(n => {
        n.inputs = n.inputs.filter(id => id !== node.id);
    });

    if (AppState.selectedNode === node) {
        AppState.selectedNode = null;
        DOM.editor.value = '';
    }
    updateConnections();
}

function selectNode(node) {
    AppState.selectedNode = node;
    AppState.nodes.forEach(n => n.element.classList.remove('selected'));
    node.element.classList.add('selected');
    
    // Update Property Panel
    DOM.inputs.name.value = node.name;
    DOM.inputs.type.value = node.type;
    DOM.inputs.width.value = node.width;
    DOM.inputs.height.value = node.height;
    
    updateUIForType(node.type);
}

function updateUIForType(type) {
    // Reset visibility
    DOM.buttons.upload.style.display = 'none';
    if(DOM.inputs.colorContainer) DOM.inputs.colorContainer.style.display = 'none';
    if(DOM.inputs.resContainer) DOM.inputs.resContainer.style.display = 'inline-block';
    
    if (type === 'texture') {
        DOM.buttons.run.style.display = 'none';
        DOM.buttons.upload.style.display = 'inline-block';
        DOM.editor.disabled = true;
        DOM.editor.value = "// Texture Node: Upload an image using the button above.";
    } else if (type === 'const') {
        DOM.buttons.run.style.display = 'none';
        if(DOM.inputs.colorContainer) DOM.inputs.colorContainer.style.display = 'inline-block';
        if(DOM.inputs.resContainer) DOM.inputs.resContainer.style.display = 'none';
        DOM.editor.disabled = true;
        DOM.editor.value = "// Const Node: Pick a color using the input above.";
        
        // Sync Color Picker
        if (AppState.selectedNode && AppState.selectedNode.code) {
             const match = /vec4\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(AppState.selectedNode.code);
             if (match) {
                 const r = Math.round(parseFloat(match[1]) * 255);
                 const g = Math.round(parseFloat(match[2]) * 255);
                 const b = Math.round(parseFloat(match[3]) * 255);
                 const hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
                 if(DOM.inputs.colorPicker) DOM.inputs.colorPicker.value = hex;
             }
        }
    } else {
        DOM.buttons.run.style.display = 'inline-block';
        DOM.editor.disabled = false;
        if (AppState.selectedNode) DOM.editor.value = AppState.selectedNode.code;
    }
}

// -- User Inputs & Events --

DOM.inputs.width.addEventListener('change', () => {
    if (AppState.selectedNode) {
        AppState.selectedNode.width = parseInt(DOM.inputs.width.value) || 512;
        AppState.selectedNode.canvas.width = AppState.selectedNode.width;
        AppState.selectedNode.initResources();
        AppState.selectedNode.display();
    }
});

DOM.inputs.height.addEventListener('change', () => {
    if (AppState.selectedNode) {
        AppState.selectedNode.height = parseInt(DOM.inputs.height.value) || 512;
        AppState.selectedNode.canvas.height = AppState.selectedNode.height;
        AppState.selectedNode.initResources();
        AppState.selectedNode.display();
    }
});

DOM.inputs.name.addEventListener('input', () => {
    if (AppState.selectedNode) {
        AppState.selectedNode.name = DOM.inputs.name.value;
        AppState.selectedNode.updateTitle();
    }
});

DOM.inputs.type.addEventListener('change', () => {
    if (AppState.selectedNode) {
        AppState.selectedNode.type = DOM.inputs.type.value;
        AppState.selectedNode.updateTitle();
        
        if (AppState.selectedNode.type === 'const') {
             // Init Default Const shader if empty
             if (!AppState.selectedNode.code || AppState.selectedNode.code === SHADER_SOURCES.DEFAULT_FS) {
                 AppState.selectedNode.code = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() {
    fragColor = vec4(1.0, 1.0, 1.0, 1.0);
}`;
             }
             if (!AppState.selectedNode.program) AppState.selectedNode.compile();
        } else if (AppState.selectedNode.type === 'shader') {
             if (!AppState.selectedNode.program) AppState.selectedNode.compile();
        }
        
        updateUIForType(AppState.selectedNode.type);
        AppState.selectedNode.initResources();
        AppState.selectedNode.display();
    }
});

DOM.buttons.upload.addEventListener('click', () => {
    DOM.inputs.texture.click();
});

DOM.inputs.texture.addEventListener('change', (e) => {
    if (AppState.selectedNode && e.target.files.length > 0) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => AppState.selectedNode.loadTexture(img);
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

DOM.inputs.colorPicker.addEventListener('input', () => {
    if (AppState.selectedNode && AppState.selectedNode.type === 'const') {
        const hex = DOM.inputs.colorPicker.value;
        const r = parseInt(hex.slice(1,3), 16) / 255;
        const g = parseInt(hex.slice(3,5), 16) / 255;
        const b = parseInt(hex.slice(5,7), 16) / 255;
        
        AppState.selectedNode.code = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() {
    fragColor = vec4(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)}, 1.0);
}`;
        AppState.selectedNode.compile(); 
    }
});

DOM.buttons.run.addEventListener('click', () => {
    if (AppState.selectedNode) {
        AppState.selectedNode.code = DOM.editor.value;
        AppState.selectedNode.compile();
    }
});

DOM.buttons.addNode.addEventListener('click', addNode);

// -- Interaction (Drag & Connect) --

function startDrag(e, node) {
    AppState.dragNode = node;
    AppState.dragOffset.x = e.clientX - node.x;
    AppState.dragOffset.y = e.clientY - node.y;
    
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
}

function onDrag(e) {
    if (!AppState.dragNode) return;
    AppState.dragNode.x = e.clientX - AppState.dragOffset.x;
    AppState.dragNode.y = e.clientY - AppState.dragOffset.y;
    AppState.dragNode.element.style.left = AppState.dragNode.x + 'px';
    AppState.dragNode.element.style.top = AppState.dragNode.y + 'px';
    updateConnections();
}

function endDrag() {
    AppState.dragNode = null;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', endDrag);
}

document.addEventListener('click', (e) => {
    let target = e.target;
    if (!target.classList.contains('socket')) return;

    const nodeEl = target.closest('.node');
    const nodeId = parseInt(nodeEl.id.split('-')[1]);
    const node = AppState.nodes.find(n => n.id === nodeId);
    const type = target.classList.contains('input') ? 'input' : 'output';

    if (!AppState.connectionStart) {
        if (type === 'output') {
            AppState.connectionStart = { node, element: target };
            target.style.background = '#fff'; 
        }
    } else {
        if (type === 'input' && AppState.connectionStart.node.id !== node.id) {
            node.inputs = [AppState.connectionStart.node.id];
            updateConnections();
        }
        if(AppState.connectionStart.element) AppState.connectionStart.element.style.background = '';
        AppState.connectionStart = null;
    }
});

function updateConnections() {
    DOM.connectionsSvg.innerHTML = ''; 
    AppState.nodes.forEach(targetNode => {
        targetNode.inputs.forEach(sourceId => {
            const sourceNode = AppState.nodes.find(n => n.id === sourceId);
            if (sourceNode) {
                drawLine(sourceNode, targetNode);
            }
        });
    });
}

function drawLine(n1, n2) {
    // Assuming socket positions are relatively static within node structure
    const p1 = n1.element.querySelector('.socket.output').getBoundingClientRect();
    const p2 = n2.element.querySelector('.socket.input').getBoundingClientRect();
    
    const x1 = p1.left + p1.width/2;
    const y1 = p1.top + p1.height/2;
    const x2 = p2.left + p2.width/2;
    const y2 = p2.top + p2.height/2;
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = `M ${x1} ${y1} C ${x1+50} ${y1}, ${x2-50} ${y2}, ${x2} ${y2}`;
    path.setAttribute('d', d);
    DOM.connectionsSvg.appendChild(path);
}

window.addEventListener('resize', updateConnections);

// -- Main Loop --

function loop() {
    const time = (Date.now() - AppState.startTime) / 1000;
    
    AppState.nodes.forEach(node => {
        node.render(time);
    });

    requestAnimationFrame(loop);
}

// -- Boot --
addNode();
loop();
