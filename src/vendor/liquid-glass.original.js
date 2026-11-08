/** LiquidGlass — dependency-free Web Component, MIT license.
 * Shapes: rounded, ellipse, capsule, diamond, hexagon, star, custom.
 * width/height override legacy size. points contains normalized 0..100 pairs.
 * Parent must be positioned. Optional .source = origin-clean backgroundCanvas
 * enables refraction; canvas must align with and cover the parent. Otherwise
 * CSS backdrop-filter is used. .setPosition(x,y), .render(), positionchange.
 */
const vertex = `attribute vec2 a_position; varying vec2 v_uv;
void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}`;
const fragment = `precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform vec2 u_scene,u_position,u_dimensions;
uniform float u_radius,u_strength,u_blur,u_chromatic,u_shape;
uniform int u_count;
uniform vec2 u_points[16];
float polygonSdf(vec2 p){
  float distanceSquared=1.0e10;float signValue=1.;
  for(int i=0;i<16;i++){
    if(i>=u_count)break;
    vec2 a=u_points[i]*u_dimensions;vec2 b=u_points[0]*u_dimensions;
    for(int j=0;j<16;j++){if(j==i+1 && j<u_count)b=u_points[j]*u_dimensions;}
    vec2 edge=b-a;vec2 rel=p-a;
    vec2 closest=rel-edge*clamp(dot(rel,edge)/max(dot(edge,edge),.0001),0.,1.);
    distanceSquared=min(distanceSquared,dot(closest,closest));
    if((a.y>p.y)!=(b.y>p.y)){
      if(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)signValue=-signValue;
    }
  }
  return signValue*sqrt(distanceSquared);
}
float sdf(vec2 p){
  if(u_shape>1.5)return polygonSdf(p+u_dimensions*.5);
  if(u_shape>.5){
    vec2 axes=u_dimensions*.5;float k0=length(p/axes);float k1=length(p/(axes*axes));
    return k1<.00001?-min(axes.x,axes.y):k0*(k0-1.)/k1;
  }
  vec2 q=abs(p)-(u_dimensions*.5-u_radius);
  return length(max(q,0.))+min(max(q.x,q.y),0.)-u_radius;
}
vec3 sampleScene(vec2 p){
  vec2 uv=clamp(p/u_scene,vec2(.001),vec2(.999));uv.y=1.-uv.y;
  vec2 b=vec2(u_blur)/u_scene;vec3 c=texture2D(u_image,uv).rgb*.24;
  c+=texture2D(u_image,uv+vec2(b.x,0.)).rgb*.12;c+=texture2D(u_image,uv-vec2(b.x,0.)).rgb*.12;
  c+=texture2D(u_image,uv+vec2(0.,b.y)).rgb*.12;c+=texture2D(u_image,uv-vec2(0.,b.y)).rgb*.12;
  c+=texture2D(u_image,uv+b*.707).rgb*.07;c+=texture2D(u_image,uv-b*.707).rgb*.07;
  c+=texture2D(u_image,uv+vec2(b.x,-b.y)*.707).rgb*.07;c+=texture2D(u_image,uv+vec2(-b.x,b.y)*.707).rgb*.07;
  return c;
}
void main(){
  vec2 q=vec2(v_uv.x,1.-v_uv.y)*u_dimensions;vec2 p=q-u_dimensions*.5;
  float d=sdf(p);float alpha=1.-smoothstep(-.8,.5,d);if(alpha<.01)discard;
  vec2 n=normalize(vec2(sdf(p+vec2(.5,0.))-sdf(p-vec2(.5,0.)),sdf(p+vec2(0.,.5))-sdf(p-vec2(0.,.5)))+vec2(.00001));
  float depth=max(0.,-d);float rim=exp(-depth/13.);
  float bend=sin(clamp(depth/32.,0.,1.)*1.5708);float offset=(1.-bend)*u_strength*.64;
  vec2 at=u_position+u_dimensions*.5+p/(1.+u_strength*.00045)-n*offset;
  vec3 color=sampleScene(at);float ca=u_chromatic*rim*u_strength*.045;
  color.r=sampleScene(at+n*ca).r;color.b=sampleScene(at-n*ca).b;
  float light=dot(n,normalize(vec2(-.7,-.9)));float line=exp(-depth/1.15);float inner=exp(-abs(depth-3.)/2.5);
  color=mix(color,vec3(.90,.97,1.),.025+u_blur*.008);
  color+=pow(max(light,0.),3.)*(line*.60+rim*.15);color+=pow(max(-light,0.),5.)*line*.29;
  color-=inner*max(-light,0.)*.065;color+=vec3(.7,.85,1.)*rim*.045;
  gl_FragColor=vec4(color,alpha);
}`;

const shapes=['rounded','ellipse','capsule','diamond','hexagon','star','custom'];
const defaultPoints=[[15,10],[85,10],[95,60],[60,95],[10,80]];
const number=(v,fallback)=>v===null||v===''||!Number.isFinite(Number(v))?fallback:Number(v);
function validPolygon(points){
  if(!Array.isArray(points)||points.length<3||points.length>16)return false;
  if(points.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||n<0||n>100)))return false;
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const on=(p,q,r)=>Math.abs(cross(p,q,r))<1e-7&&r[0]>=Math.min(p[0],q[0])-1e-7&&r[0]<=Math.max(p[0],q[0])+1e-7&&r[1]>=Math.min(p[1],q[1])-1e-7&&r[1]<=Math.max(p[1],q[1])+1e-7;
  let area=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if(Math.hypot(a[0]-b[0],a[1]-b[1])<.5)return false;
    area+=a[0]*b[1]-b[0]*a[1];
    for(let j=i+1;j<points.length;j++){
      if(j===i+1||(i===0&&j===points.length-1))continue;
      const c=points[j],d=points[(j+1)%points.length];
      if((cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return false;
    }
  }
  return Math.abs(area)>50;
}
function pointsForShape(shape,raw=''){
  if(shape==='diamond')return [[50,0],[100,50],[50,100],[0,50]];
  if(shape==='hexagon')return [[25,0],[75,0],[100,50],[75,100],[25,100],[0,50]];
  if(shape==='star')return Array.from({length:10},(_,i)=>{const a=i*Math.PI/5-Math.PI/2,r=i%2?23:50;return [50+Math.cos(a)*r,50+Math.sin(a)*r];});
  if(shape==='custom'){
    const points=raw.trim().split(/\s+/).map(p=>p.split(',').map(Number));
    return validPolygon(points)?points:defaultPoints.map(p=>[...p]);
  }
  return [];
}

class LiquidGlass extends HTMLElement {
  static observedAttributes=['size','width','height','shape','points','radius','refraction','blur','chromatic'];
  constructor(){
    super();this._x=0;this._y=0;this.attachShadow({mode:'open'});
    this.shadowRoot.innerHTML=`<style>
      :host{display:block;position:absolute;left:0;top:0;width:240px;height:240px;border-radius:64px;isolation:isolate;touch-action:none;user-select:none;cursor:grab;box-shadow:0 22px 45px -12px #0005,0 5px 12px -3px #0003;outline-offset:5px}
      :host([dragging]){cursor:grabbing}
      .surface{position:absolute;inset:0;overflow:hidden;border-radius:inherit;backdrop-filter:blur(var(--glass-blur,2px)) saturate(1.4);-webkit-backdrop-filter:blur(var(--glass-blur,2px)) saturate(1.4);background:linear-gradient(135deg,#ffffff1c,#ffffff03 45%,#ffffff0d);box-shadow:inset 1px 1px 1px #ffffffa0,inset -1px -1px 1px #ffffff60,inset 0 0 12px #ffffff10}
      .surface.rendered{backdrop-filter:none;-webkit-backdrop-filter:none;background:transparent;box-shadow:none}
      canvas{width:100%;height:100%;display:none}.rendered canvas{display:block}
      .content{position:absolute;inset:0;border-radius:inherit;display:grid;place-items:center;pointer-events:none}
      ::slotted(*){max-width:100%;box-sizing:border-box;pointer-events:auto}
    </style><div class="surface"><canvas></canvas></div><div class="content"><slot></slot></div>`;
    this._canvas=this.shadowRoot.querySelector('canvas');this._surface=this.shadowRoot.querySelector('.surface');
    for(const name of ['_down','_move','_up','_key'])this[name]=this[name].bind(this);
    this._handlers={pointerdown:this._down,pointermove:this._move,pointerup:this._up,pointercancel:this._up,lostpointercapture:this._up,keydown:this._key};
  }
  connectedCallback(){
    if(!this.hasAttribute('tabindex'))this.tabIndex=0;
    this._sync();for(const [event,handler] of Object.entries(this._handlers))this.addEventListener(event,handler);
    this._resize=new ResizeObserver(()=>this.setPosition(this._x,this._y));
    if(this.parentElement)this._resize.observe(this.parentElement);
  }
  disconnectedCallback(){
    this._resize?.disconnect();for(const [event,handler] of Object.entries(this._handlers))this.removeEventListener(event,handler);
    if(this._gl){this._gl.deleteTexture(this._texture);this._gl.deleteBuffer(this._buffer);this._gl.deleteProgram(this._program);this._gl=null;}
    this._surface.classList.remove('rendered');
  }
  get size(){return Math.max(60,number(this.getAttribute('size'),240));}
  get width(){return Math.max(60,number(this.getAttribute('width'),this.size));}
  get height(){return Math.max(60,number(this.getAttribute('height'),this.size));}
  get shape(){return shapes.includes(this.getAttribute('shape'))?this.getAttribute('shape'):'rounded';}
  get radius(){return Math.max(0,Math.min(Math.min(this.width,this.height)/2,this.shape==='capsule'?Infinity:number(this.getAttribute('radius'),64)));}
  set source(canvas){this._source=canvas;this.render();}
  get source(){return this._source;}
  attributeChangedCallback(){if(this._surface)this._sync();}
  _sync(){
    this.style.width=`${this.width}px`;this.style.height=`${this.height}px`;
    this._points=pointsForShape(this.shape,this.getAttribute('points')||'');
    this.style.borderRadius=this.shape==='ellipse'?'50%':this._points.length?'0':`${this.radius}px`;
    this.style.clipPath=this._points.length?`polygon(${this._points.map(p=>p.map(v=>v+'%').join(' ')).join(',')})`:'none';
    this.style.setProperty('--glass-blur',`${number(this.getAttribute('blur'),0)}px`);
    this.setPosition(this._x,this._y);
  }
  setPosition(x,y){
    const p=this.parentElement;
    this._x=Math.max(0,Math.min(number(x,0),(p?.clientWidth||this.width)-this.width));
    this._y=Math.max(0,Math.min(number(y,0),(p?.clientHeight||this.height)-this.height));
    this.style.transform=`translate3d(${this._x}px,${this._y}px,0)`;this.render();
    this.dispatchEvent(new CustomEvent('positionchange',{detail:{x:this._x,y:this._y}}));
  }
  _down(e){
    if(e.button!==0||e.target.closest('button,a,input,select,textarea')||this.getAttribute('draggable')==='false')return;
    this._drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:this._x,top:this._y};
    this.setPointerCapture(e.pointerId);this.setAttribute('dragging','');this.focus({preventScroll:true});e.preventDefault();
  }
  _move(e){if(this._drag?.id===e.pointerId)this.setPosition(this._drag.left+e.clientX-this._drag.x,this._drag.top+e.clientY-this._drag.y);}
  _up(){this._drag=null;this.removeAttribute('dragging');}
  _key(e){
    if(this.getAttribute('draggable')==='false')return;
    const move={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
    if(!move)return;e.preventDefault();let step=e.shiftKey?20:5;this.setPosition(this._x+move[0]*step,this._y+move[1]*step);
  }
  _init(){
    const gl=this._canvas.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:true});if(!gl)return false;
    const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error(message);}return s;};
    const program=gl.createProgram(),vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    this._buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this._buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const a=gl.getAttribLocation(program,'a_position');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
    this._texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this._texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);this._gl=gl;this._program=program;this._uniforms={};
    for(const k of ['scene','position','dimensions','radius','strength','blur','chromatic','shape','count'])this._uniforms[k]=gl.getUniformLocation(program,'u_'+k);
    this._uniforms.points=gl.getUniformLocation(program,'u_points[0]');return true;
  }
  render(){
    if(!this._source||!this.isConnected){this._surface?.classList.remove('rendered');return;}
    try{
      if(!this._gl&&!this._init())return;const gl=this._gl;
      if(gl.isContextLost()){this._surface.classList.remove('rendered');return;}
      const dpr=Math.min(devicePixelRatio||1,2),w=Math.round(this.width*dpr),h=Math.round(this.height*dpr);
      if(this._canvas.width!==w||this._canvas.height!==h){this._canvas.width=w;this._canvas.height=h;}
      gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(this._program);
      gl.bindTexture(gl.TEXTURE_2D,this._texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this._source);
      const u=this._uniforms,points=new Float32Array(32);this._points.forEach((p,i)=>{points[i*2]=p[0]/100;points[i*2+1]=p[1]/100;});
      gl.uniform2f(u.scene,this.parentElement.clientWidth,this.parentElement.clientHeight);
      gl.uniform2f(u.position,this._x,this._y);gl.uniform2f(u.dimensions,this.width,this.height);gl.uniform1f(u.radius,this.radius);
      gl.uniform1f(u.strength,number(this.getAttribute('refraction'),0));gl.uniform1f(u.blur,number(this.getAttribute('blur'),0));
      gl.uniform1f(u.chromatic,this.hasAttribute('chromatic')?1:0);gl.uniform1f(u.shape,this._points.length?2:this.shape==='ellipse'?1:0);
      gl.uniform1i(u.count,this._points.length);gl.uniform2fv(u.points,points);gl.drawArrays(gl.TRIANGLES,0,6);
      this._surface.classList.add('rendered');
    }catch(e){this._surface.classList.remove('rendered');if(!this._warned){console.warn('LiquidGlass: CSS fallback active.',e);this._warned=true;}}
  }
}
if(!customElements.get('liquid-glass'))customElements.define('liquid-glass',LiquidGlass);
// Expose helpers for the optional classic-script shape editor.
globalThis.LiquidGlass=LiquidGlass;
globalThis.validPolygon=validPolygon;
globalThis.pointsForShape=pointsForShape;
