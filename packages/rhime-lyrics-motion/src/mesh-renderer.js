/* Same WebGL pigment field as Rhime Mesh Gradient 1.11. */
function createLyricsMeshRenderer(canvas){
  const M=AlbumMesh;
  const shaders={
    vertex:'attribute vec2 aPosition; varying vec2 vUV; void main(){vUV=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}',
    fragment:`precision highp float;
varying vec2 vUV; uniform vec3 uLab[10]; uniform vec2 uAnchors[10]; uniform vec3 uShape[10]; uniform vec4 uWarp; uniform vec4 uFlow; uniform vec4 uPhase; uniform float uContrast; uniform vec2 uSize;
float solve(float v,float k){float p=v;for(int i=0;i<7;i++){p-=(p+k*sin(3.14159265*p)-v)/(1.+k*3.14159265*cos(3.14159265*p));}return p;}
vec2 unwarp(vec2 p,vec4 w){if(p.x<=0.||p.x>=1.||p.y<=0.||p.y>=1.)return p;float y=solve(p.y,w.y*sin(3.14159265*p.x)*sin(6.2831853*p.x+w.w));return vec2(solve(p.x,w.x*sin(3.14159265*y)*sin(6.2831853*y+w.z)),y);}
vec2 pigment(vec2 p){float b=uFlow.x,v=uFlow.y,d=uFlow.z,n=uFlow.w;vec2 c=p-vec2(.52,.48);float spread=d*.48*exp(-dot(c,c)*1.5);return p-vec2(.32*b*sin(uPhase.x+p.y*1.7)+.14*v*sin(uPhase.y+p.y*1.2+p.x*.8)+.24*n*sin(uPhase.w+p.y*.9)+c.x*spread,.12*b*cos(uPhase.x+p.x*1.1)+.32*v*sin(uPhase.y+p.x*1.3)+.21*n*cos(uPhase.w+p.x*1.8)+c.y*spread+.07*d*sin(uPhase.z+p.x*2.1));}
vec3 srgb(vec3 x){return clamp(mix(12.92*x,1.055*pow(max(x,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),x)),0.,1.);}
vec3 color(vec3 v){float l=v.x+.3963377774*v.y+.2158037573*v.z;float m=v.x-.1055613458*v.y-.0638541728*v.z;float s=v.x-.0894841775*v.y-1.291485548*v.z;l=l*l*l;m=m*m*m;s=s*s*s;return srgb(vec3(4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s));}
float wrapped(float d,float inverseRadiusSquared,float period){d-=floor(d/period+.5)*period;float w=0.;for(int k=-2;k<=2;k++){float t=d+float(k)*period;w+=exp(-t*t*inverseRadiusSquared);}return w;}
void main(){vec2 p=(vec2(vUV.x,1.-vUV.y)*(uSize+vec2(24.,48.))-vec2(12.,24.))/uSize;p=pigment(unwarp(p,uWarp));vec3 c=vec3(0.);float total=0.;for(int i=0;i<10;i++){vec2 d=p-uAnchors[i];float w=pow(uShape[i].z*wrapped(d.x,uShape[i].x,1.65)*wrapped(d.y,uShape[i].y,1.64)+.00001,uContrast);c+=uLab[i]*w;total+=w;}gl_FragColor=vec4(color(c/total),1.);}`
  };

  const gl=canvas.getContext('webgl',{alpha:false,preserveDrawingBuffer:true,antialias:false});
  if(!gl)return null;
  function compile(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('Mesh 렌더러를 초기화하지 못했습니다.');return s;}
  const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,shaders.vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,shaders.fragment));gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Mesh 렌더러를 연결하지 못했습니다.');
  gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const attr=gl.getAttribLocation(program,'aPosition');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
  const u={};['uLab[0]','uAnchors[0]','uShape[0]','uSize','uWarp','uFlow','uPhase','uContrast'].forEach(n=>u[n]=gl.getUniformLocation(program,n));
  return {draw(settings,snapshot,width,height){
    const w=Math.round(width+24),h=Math.round(height+48);if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;gl.viewport(0,0,canvas.width,canvas.height);gl.useProgram(program);
    const palette=M.ambientPalette(settings.palette),pts=M.anchors(settings.seed),labs=pts.flatMap(p=>M.toLab(palette[p.colorIndex%palette.length]));
    gl.uniform3fv(u['uLab[0]'],labs);gl.uniform2fv(u['uAnchors[0]'],pts.flatMap(p=>[p.x,p.y]));gl.uniform3fv(u['uShape[0]'],pts.flatMap(p=>[1/p.rx**2,1/p.ry**2,p.weight]));
    gl.uniform2f(u.uSize,width,height);gl.uniform4fv(u.uWarp,M.layoutWarp(settings));const a=snapshot.strength/100;
    gl.uniform4fv(u.uFlow,[snapshot.bass*a,snapshot.vocal*a,snapshot.hit*a,snapshot.instruments*a]);gl.uniform4fv(u.uPhase,snapshot.phases);gl.uniform1f(u.uContrast,M.FIELD_CONTRAST);gl.drawArrays(gl.TRIANGLES,0,6);
  }};
}
