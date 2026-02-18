// Glass Marble with Static Ribbon
// Input: Connect a Texture to iChannel0 for environment mapping (optional)
out vec4 fragColor;
// --- Ray Marching & SDFs ---

// SDF for the internal ribbon (Static, wider at center, thin at ends)
float sdRibbon(vec3 p) {
    // 1. Static Twist
    float twistAmount = 6.5; // Twist frequency
    float ang = p.y * twistAmount;
    float c = cos(ang);
    float s = sin(ang);
    mat2 m = mat2(c, -s, s, c);
    vec3 q = p;
    q.xz = m * q.xz; // Twist domain
    
    // 2. Shape Definition
    // Width profile: Widest at y=0, thins out towards poles (radius ~1.0)
    // Using cos(asin(p.y)) which is sqrt(1 - y^2) matches sphere profile roughly
    float widthProfile = sqrt(max(0.0, 1.0 - p.y*p.y)); 
    
    // Make it much thinner than the sphere width to look like a ribbon
    float ribbonWidth = 0.1 * widthProfile; 
    
    // Thickness (very thin plate)
    float thickness = 0.001 * widthProfile; // Also thins out at ends? Or constant? Let's make it constant-ish or slight tape.
    
    // SDF for precise box/plate
    // q.x is the broad side (width), q.z is the thickness side
    
    // We want a flat shape in the twisted space.
    // Distance to the "sheet": abs(q.z) - thickness
    // Bounded by width in X: abs(q.x) - ribbonWidth
    // Bounded by height in Y: abs(q.y) - 0.95 (stay inside sphere)
    
    float dBox = max(abs(q.z) - thickness, abs(q.x) - ribbonWidth);
    float dHeight = abs(q.y) - 0.95;
    
    return max(dBox, dHeight);
}

// Simple environment mapping
vec3 getEnvironment(vec3 dir) {
    if (iChannelResolution[0].x > 0.0) {
        vec2 uv = vec2(0.5 + atan(dir.z, dir.x) / (2.0 * 3.14159), 0.5 - asin(dir.y) / 3.14159);
        return texture(iChannel0, uv).rgb;
    }
    // Procedural Studio Lighting
    float t = 0.5 * (dir.y + 1.0);
    return mix(vec3(0.05), vec3(0.4), t); 
}

// Get ribbon color
vec3 getRibbonColor(vec3 p) {
    // Twist coordinate to keep strips aligned with geometry
    float twistAmount = 4.0;
    float ang = p.y * twistAmount;
    vec2 rotXZ = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p.xz;
    
    // Color strips logic along the width of the ribbon (which is now in rotXZ.x)
    float stripPos = rotXZ.x * 5.0; // Scale frequency of strips
    
    vec3 col1 = texture(iChannel1,vec2(0.5)).rgb;//vec3(1.0, 0.05, 0.05); // Red
    vec3 col2 = texture(iChannel2,vec2(0.5)).rgb;//vec3(0.05, 0.9, 0.1);  // Green
    vec3 col3 = texture(iChannel3,vec2(0.5)).rgb;//vec3(0.1, 0.2, 1.0);   // Blue
    
    // Mix colors based on width position
    // Center: Green, Sides: Red/Blue
    float w = smoothstep(0.0, 1.0, abs(rotXZ.x) / 0.06); // Approximate normalized width 
    
    vec3 c = mix(col2, (rotXZ.x > 0.0 ? col1 : col3), w);
    return c;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Correct UV calculation to maintain aspect ratio
    // This ensures a circle remains a circle regardless of resolution
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / min(iResolution.x, iResolution.y);
    
    // Mouse Interaction
    vec2 mo = iMouse.xy / iResolution.xy;
    float rotX = mo.x * 6.28;
    float rotY = (mo.y - 0.5) * 3.0;

    // Camera with DoF
    vec3 ro = vec3(0.0, 0.0, 3.5);
    if (iMouse.z > 0.0) {
        ro.yz = mat2(cos(rotY), -sin(rotY), sin(rotY), cos(rotY)) * ro.yz;
        ro.xz = mat2(cos(rotX), -sin(rotX), sin(rotX), cos(rotX)) * ro.xz;
    }
    
    vec3 ta = vec3(0.0);
    vec3 cw = normalize(ta - ro);
    vec3 cp = vec3(0.0, 1.0, 0.0);
    vec3 cu = normalize(cross(cw, cp));
    vec3 cv = normalize(cross(cu, cw));

    // DoF Parameters
    float focalLength = length(ta - ro); // Focus on target (approx 3.5)
    float aperture = 0.05; // Aperture size
    
    // Jitter camera position based on aperture
    vec3 colAcc = vec3(0.0);
    const int SAMPLES = 12; // Quality setting
    
    for(int k=0; k<SAMPLES; k++)
    {
        // Random point on aperture (hexagonal or disk distribution)
        // Simple hash based random for jitter
        vec2 p = vec2(float(k), float(k)*1.618);
        vec2 r2 = fract(sin(p)*43758.5453);
        vec2 offset = aperture * (r2 - 0.5); // Square aperture for simplicity
        
        // Correct DoF Logic:
        // 1. Determine focal point for the primary ray
        vec3 focalPoint = ro + focalLength * normalize(uv.x*cu + uv.y*cv + 3.0*cw);
        
        // 2. Shift origin
        vec3 ro_dof = ro + offset.x*cu + offset.y*cv;
        
        // 3. New direction points to the SAME focal point
        vec3 rd_dof = normalize(focalPoint - ro_dof); 

        // --- Render Scene for this ray ---
        vec3 srd = rd_dof;
        vec3 sro = ro_dof;
        
        // Sphere Config
        vec3 sc = vec3(0.0);
        float sr = 0.3;

        // --- Intersect Sphere (Exterior) ---
        vec3 oc = sro - sc;
        float b = dot(oc, srd);
        float c = dot(oc, oc) - sr*sr;
        float h = b*b - c;

        vec3 sampleCol = vec3(0.0);

        if( h < 0.0 ) {
            sampleCol = getEnvironment(srd);
        } else {
            // Hit outer glass surface
            float t = -b - sqrt(h);
            vec3 pos = sro + t*srd;
            vec3 nor = normalize(pos - sc);
            
            float ior = 1.45; // Refraction index
            
            // 1. Reflection (Fresnel)
            vec3 refDir = reflect(srd, nor);
            vec3 envRef = getEnvironment(refDir);
            float fresnel = pow(1.0 + dot(srd, nor), 3.0);
            fresnel = mix(0.1, 1.0, fresnel);
            
            // 2. Refraction (Inside the marble)
            vec3 refrDir = refract(srd, nor, 1.0/ior);
            
            // Trace Ray INSIDE the sphere
            vec3 internalCol = vec3(0.0);
            
            bool hitRibbon = false;
            vec3 p_curr = pos + refrDir * 0.01; // nudge in
            
            // Ray Marching inside
            for(int i=0; i<60; i++) { // Reduce steps for performance
                float d = sdRibbon(p_curr);
                
                // Intersection threshold
                if (d < 0.002) {
                    hitRibbon = true;
                    
                    // Normal
                    vec2 e = vec2(0.001, 0.0);
                    vec3 ribNor = normalize(vec3(
                        sdRibbon(p_curr + e.xyy) - sdRibbon(p_curr - e.xyy),
                        sdRibbon(p_curr + e.yxy) - sdRibbon(p_curr - e.yxy),
                        sdRibbon(p_curr + e.yyx) - sdRibbon(p_curr - e.yyx)
                    ));
                    
                    vec3 ribColor = getRibbonColor(p_curr);
                    
                    // Internal Lighting
                    vec3 lightDir = normalize(vec3(0.5, 1.0, 1.0));
                    float diff = max(dot(ribNor, lightDir), 0.1);
                    float spec = pow(max(dot(reflect(-lightDir, ribNor), -refrDir), 0.0), 32.0);
                    
                    internalCol = ribColor * (diff * 0.8 + 0.2) + spec * 0.5;
                    break;
                }
                
                // Step limit to avoid skipping
                if (d > 0.05) d = 0.05; 
                
                p_curr += refrDir * d;
                
                // Exit condition (dist from center > radius)
                if (length(p_curr - sc) > sr) break;
            }
            
            if (!hitRibbon) {
                // Visualize transparence
                // Approximate exit mapping
                internalCol = getEnvironment(refrDir) * vec3(0.95); 
            }
            
            // Combine Reflection and Internal
            sampleCol = mix(internalCol, envRef, fresnel);
            
            // Specular on glass shell
            vec3 sunDir = normalize(vec3(1.0, 1.0, 1.0));
            float sunSpec = pow(max(dot(reflect(-sunDir, nor), -srd), 0.0), 60.0);
            sampleCol += sunSpec * vec3(1.0);
        }
        
        colAcc += sampleCol;
    }
    
    vec3 col = colAcc / float(SAMPLES);

    // Tone mapping
    col = col / (1.0 + col);
    col = pow(col, vec3(0.4545));

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(fragColor, gl_FragCoord.xy);
}