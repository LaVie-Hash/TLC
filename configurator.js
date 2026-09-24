(() => {
  const host = document.querySelector('#car-viewer');
  if (!host || !window.RS7_GLB_BASE64) return;
  const status = host.querySelector('.viewer-message');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Lokales 3D-Modell des Audi RS7 Sportback 2020. Mit Maus oder Finger drehen.');
  host.appendChild(canvas);
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) { if (status) status.textContent = '3D-ANSICHT WIRD VON DIESEM BROWSER NICHT UNTERSTÜTZT'; return; }
  host.querySelector('.car-fallback')?.remove(); status?.remove();

  const vertexSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat4 uMVP;
    varying vec3 vNormal;
    void main() { vNormal = aNormal; gl_Position = uMVP * vec4(aPosition, 1.0); }
  `;
  const fragmentSource = `
    precision mediump float;
    uniform vec4 uColor;
    uniform vec2 uSurface;
    varying vec3 vNormal;
    void main() {
      vec3 n = normalize(vNormal);
      vec3 lightDirection = normalize(vec3(-0.45, 0.86, 0.55));
      vec3 viewDirection = normalize(vec3(0.22, 0.34, 1.0));
      float diffuse = max(dot(n, lightDirection), 0.0);
      float shine = pow(max(dot(n, normalize(lightDirection + viewDirection)), 0.0), mix(14.0, 72.0, 1.0 - uSurface.y));
      vec3 color = uColor.rgb * (0.31 + diffuse * 0.72) + vec3(shine * (0.035 + uSurface.x * 0.42));
      gl_FragColor = vec4(color, uColor.a);
    }
  `;
  function compile(type, source) {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  let program;
  try {
    program = gl.createProgram(); gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch {
    if (status) { status.textContent = 'DAS LOKALE 3D-MODELL KONNTE NICHT GEZEIGT WERDEN'; status.style.display = 'block'; }
    return;
  }
  const uintIndexSupport = gl.getExtension('OES_element_index_uint');
  const locations = { position: gl.getAttribLocation(program, 'aPosition'), normal: gl.getAttribLocation(program, 'aNormal'), mvp: gl.getUniformLocation(program, 'uMVP'), color: gl.getUniformLocation(program, 'uColor'), surface: gl.getUniformLocation(program, 'uSurface') };

  function readGlb(base64) {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    if (view.getUint32(0, true) !== 0x46546c67) throw new Error('GLB signature missing');
    const jsonLength = view.getUint32(12, true);
    const doc = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
    const binHeader = 20 + jsonLength;
    const binLength = view.getUint32(binHeader, true);
    const binary = bytes.subarray(binHeader + 8, binHeader + 8 + binLength);
    const meshes = [];
    for (const node of doc.nodes) {
      if (node.mesh === undefined) continue;
      const mesh = doc.meshes[node.mesh];
      for (const primitive of mesh.primitives) {
        const positionAccessor = doc.accessors[primitive.attributes.POSITION];
        const normalAccessor = doc.accessors[primitive.attributes.NORMAL];
        const indexAccessor = doc.accessors[primitive.indices];
        const positionView = doc.bufferViews[positionAccessor.bufferView];
        const normalView = doc.bufferViews[normalAccessor.bufferView];
        const indexView = doc.bufferViews[indexAccessor.bufferView];
        const positions = new Float32Array(binary.buffer, binary.byteOffset + (positionView.byteOffset || 0) + (positionAccessor.byteOffset || 0), positionAccessor.count * 3).slice();
        const normals = new Float32Array(binary.buffer, binary.byteOffset + (normalView.byteOffset || 0) + (normalAccessor.byteOffset || 0), normalAccessor.count * 3).slice();
        const indexComponent = indexAccessor.componentType;
        if (indexComponent === 5125 && !uintIndexSupport) throw new Error('32-bit indices are not supported');
        const IndexArray = indexComponent === 5125 ? Uint32Array : Uint16Array;
        const indexType = indexComponent === 5125 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        const indices = new IndexArray(binary.buffer, binary.byteOffset + (indexView.byteOffset || 0) + (indexAccessor.byteOffset || 0), indexAccessor.count).slice();
        const positionBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer); gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        const normalBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer); gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
        const indexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        const material = doc.materials?.[primitive.material] || {};
        const surface = material.pbrMetallicRoughness || {};
        const mode = [gl.POINTS, gl.LINES, gl.LINE_LOOP, gl.LINE_STRIP, gl.TRIANGLES, gl.TRIANGLE_STRIP, gl.TRIANGLE_FAN][primitive.mode ?? 4] || gl.TRIANGLES;
        meshes.push({ name: mesh.name || node.name || '', materialName: material.name || '', color: surface.baseColorFactor || [0.8, 0.82, 0.84, 1], metallic: surface.metallicFactor ?? 0, roughness: surface.roughnessFactor ?? 0.7, positionBuffer, normalBuffer, indexBuffer, count: indices.length, indexType, mode });
      }
    }
    return meshes;
  }

  let model;
  try { model = readGlb(window.RS7_GLB_BASE64); }
  catch {
    if (status) { status.textContent = 'DAS LOKALE 3D-MODELL IST BESCHÄDIGT'; status.style.display = 'block'; }
    return;
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), out = new Float32Array(16);
    out[0] = f / aspect; out[5] = f; out[10] = (far + near) / (near - far); out[11] = -1; out[14] = (2 * far * near) / (near - far); return out;
  }
  function normalize(v) { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/n, v[1]/n, v[2]/n]; }
  function cross(a,b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  function dot(a,b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
  function lookAt(eye, center, up) {
    const z=normalize([eye[0]-center[0],eye[1]-center[1],eye[2]-center[2]]),x=normalize(cross(up,z)),y=cross(z,x),out=new Float32Array(16);
    out[0]=x[0];out[1]=y[0];out[2]=z[0];out[3]=0;out[4]=x[1];out[5]=y[1];out[6]=z[1];out[7]=0;out[8]=x[2];out[9]=y[2];out[10]=z[2];out[11]=0;out[12]=-dot(x,eye);out[13]=-dot(y,eye);out[14]=-dot(z,eye);out[15]=1;return out;
  }
  function multiply(a,b) {
    const out=new Float32Array(16);
    for(let c=0;c<4;c++)for(let r=0;r<4;r++)out[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];
    return out;
  }
  function drawMesh(mesh, mvp, colorOverride, surfaceOverride) {
    gl.uniformMatrix4fv(locations.mvp, false, mvp);
    const color = colorOverride || mesh.color; gl.uniform4fv(locations.color, color);
    const surface = surfaceOverride || [mesh.metallic ?? 0, mesh.roughness ?? 0.7]; gl.uniform2fv(locations.surface, surface);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer); gl.enableVertexAttribArray(locations.position); gl.vertexAttribPointer(locations.position,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer); gl.enableVertexAttribArray(locations.normal); gl.vertexAttribPointer(locations.normal,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer); gl.drawElements(mesh.mode || gl.TRIANGLES,mesh.count,mesh.indexType || gl.UNSIGNED_SHORT,0);
  }

  function makeStaticMesh(name, positions, normals, indices, color, mode=gl.TRIANGLES) {
    const positionBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,positionBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(positions),gl.STATIC_DRAW);
    const normalBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,normalBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(normals),gl.STATIC_DRAW);
    const indexBuffer=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    return {name,color,metallic:0,roughness:.84,positionBuffer,normalBuffer,indexBuffer,count:indices.length,indexType:gl.UNSIGNED_SHORT,mode};
  }
  const ground=makeStaticMesh('ground',[-14,-.045,-14, 14,-.045,-14, 14,-.045,14, -14,-.045,14],Array(4).fill([0,1,0]).flat(),[0,3,2,0,2,1],[.07,.10,.12,1]);
  const gridPositions=[],gridNormals=[],gridIndices=[];
  for(let line=-12;line<=12;line+=2){gridPositions.push(-13,-.04,line,13,-.04,line,line,-.04,-13,line,-.04,13);gridNormals.push(0,1,0,0,1,0,0,1,0,0,1,0);const start=gridIndices.length/1;gridIndices.push(start,start+1,start+2,start+3);}
  const gridMesh=makeStaticMesh('grid',gridPositions,gridNormals,gridIndices,[.095,.14,.17,1],gl.LINES);

  let azimuth=.68,elevation=.32,distance=7.2,dragging=false,lastX=0,lastY=0,rideOffset=0;
  canvas.addEventListener('pointerdown',event=>{dragging=true;lastX=event.clientX;lastY=event.clientY;canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{if(!dragging)return;azimuth+=(event.clientX-lastX)*.009;elevation=Math.max(.08,Math.min(.9,elevation+(event.clientY-lastY)*.006));lastX=event.clientX;lastY=event.clientY;});
  canvas.addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointercancel',()=>dragging=false);
  canvas.addEventListener('wheel',event=>{event.preventDefault();distance=Math.max(5.2,Math.min(10.5,distance+event.deltaY*.006));},{passive:false});
  const resize=()=>{const rect=host.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(rect.width*dpr));canvas.height=Math.max(1,Math.round(rect.height*dpr));gl.viewport(0,0,canvas.width,canvas.height);};
  new ResizeObserver(resize).observe(host);resize();
  gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.useProgram(program);
  const swatches=[...document.querySelectorAll('.paint-swatch')],wheelSelect=document.querySelector('#wheel-style'),heightInput=document.querySelector('#ride-height');
  const wheelNames={satin:'Satin Silver',black:'Gloss Black',bronze:'Warm Bronze'};
  const wheelColors={satin:[.72,.77,.82,1],black:[.055,.065,.075,1],bronze:[.47,.24,.105,1]};
  function hexRgba(hex){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).concat(1);}
  function updateLabels(){const selected=swatches.find(s=>s.classList.contains('active')),drop=Number(heightInput.value);rideOffset=-drop*.001;
    document.querySelector('#paint-name').textContent=selected.dataset.name;document.querySelector('#color-display').textContent=selected.dataset.name.toUpperCase();document.querySelector('#ride-value').textContent=drop?`−${drop} mm`:'STANDARD';document.querySelector('#setup-summary').textContent=`${selected.dataset.name} · ${wheelNames[wheelSelect.value]} · ${drop?`−${drop} mm`:'Standard'}`;
  }
  swatches.forEach(button=>button.addEventListener('click',()=>{swatches.forEach(s=>s.classList.remove('active'));button.classList.add('active');updateLabels();}));wheelSelect.addEventListener('change',updateLabels);heightInput.addEventListener('input',updateLabels);
  document.querySelector('#reset-config').addEventListener('click',()=>{swatches.forEach(s=>s.classList.toggle('active',s.dataset.name==='Electric Blue'));wheelSelect.value='satin';heightInput.value=20;updateLabels();});
  document.querySelector('#send-config').addEventListener('click',()=>{const field=document.querySelector('#message'),setup=`Mein RS7 Build: ${document.querySelector('#setup-summary').textContent}`;field.value=field.value?`${field.value}\n\n${setup}`:setup;document.querySelector('#kontakt').scrollIntoView({behavior:'smooth'});window.setTimeout(()=>field.focus({preventScroll:true}),450);});
  updateLabels();
  function render(){
    const aspect=canvas.width/Math.max(canvas.height,1),projection=perspective(42*Math.PI/180,aspect,.1,60);
    const target=[0,.78,0],eye=[distance*Math.cos(elevation)*Math.sin(azimuth),target[1]+distance*Math.sin(elevation),distance*Math.cos(elevation)*Math.cos(azimuth)];
    const view=lookAt(eye,target,[0,1,0]),bodyMatrix=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,rideOffset,0,1]),mvp=multiply(projection,view),loweredMvp=multiply(mvp,bodyMatrix);
    gl.clearColor(.065,.095,.12,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const selected=swatches.find(s=>s.classList.contains('active')),paintColor=hexRgba(selected.dataset.color),wheelColor=wheelColors[wheelSelect.value];
    const worldMvp=multiply(projection,view);drawMesh(ground,worldMvp);drawMesh(gridMesh,worldMvp);
    for(const mesh of model){
      const lowerName=mesh.name.toLowerCase(),materialName=mesh.materialName.toLowerCase();
      const isPaint=materialName.includes('car_paint'),isWheel=lowerName.includes('wheel'),isWheelMetal=isWheel&&(materialName.includes('metal')||materialName.includes('chrome'));
      const carBody=lowerName.includes('body')||lowerName.includes('lights');
      drawMesh(mesh,carBody?loweredMvp:mvp,isPaint?paintColor:(isWheelMetal?wheelColor:null));
    }
    requestAnimationFrame(render);
  }
  render();
})();
