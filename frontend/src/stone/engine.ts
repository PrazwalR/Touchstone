import { beginAnnotations } from "./annotations.ts";

// The stone: one ray-marched WebGL context shared by every illustration on the page, with a Canvas2D fallback.
// Ported from frontend/design (Main.dc.html). Every picture it draws is illustrative; none of it reads the chain.

export type V2 = [number, number];
export type V3 = [number, number, number];
export type V4 = [number, number, number, number];
/** A point on the stone's top face, [x, z], optionally with the time it was drawn. */
export type Pt = number[];

export interface View {
  pos: V3;
  target: V3;
  focal: number;
  shift?: V2;
}

/** Shader inputs for one frame of one stage. */
export interface Scene {
  view: View;
  pulse?: V4;
  ripple?: V4;
  keyN?: V3;
  cold?: number;
  thaw?: number;
  ref?: number;
  exposure?: number;
  mode?: number;
  rot?: number;
  sel?: number;
  dial?: number;
  beam?: number;
  float?: number;
}

export type Project = (x: number, y: number, z: number) => V2 | null;

export interface Camera {
  pos: V3;
  f: V3;
  r: V3;
  u: V3;
  focal: number;
  shift: V2;
  w: number;
  h: number;
  project: Project;
  pick(mx: number, my: number, planeY: number): V2 | null;
}

export interface StageDef {
  scene(t: number, s: Stage): Scene;
  paint?(g: CanvasRenderingContext2D, t: number, P: Scene): void;
  overlay?(c: CanvasRenderingContext2D, proj: Project, t: number, P: Scene): void;
  maxDpr?: number;
  scale?: number;
  /** Canvas2D fallback placement of the stone: [x, y, width] in device pixels, or null to centre it. */
  flatFit?(w: number, h: number): V3 | null;
  /** A still frame: drawn once per resize, never animated. */
  fixed?: boolean;
}

export interface Stage extends StageDef {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  visible: boolean;
  dirty: boolean;
  animating: boolean;
  cssW: number;
  cssH: number;
  cam?: Camera;
  flat?: { ox: number; oy: number; sw: number; sh: number };
  io?: IntersectionObserver;
  ro?: ResizeObserver;
}

// Half-extents of the stone slab in world units, and the texture sizes painted onto its top face.
export const HX = 1.6;
export const HY = 0.07;
export const HZ = 1.0;
const TW = 1024;
const TH = 512;
const EW = 2048;
const EH = 1024;

const VS = "attribute vec2 aP;void main(){gl_Position=vec4(aP,0.,1.);}";
const FS = [
  "precision highp float;",
  "uniform vec2 uRes;uniform float uTime;uniform vec3 uCamPos,uCamF,uCamR,uCamU;uniform float uFocal;uniform vec2 uShift;",
  "uniform sampler2D uStreak,uEngr,uFacet;uniform vec4 uPulse,uRipple;uniform vec3 uKeyN;",
  "uniform float uCold,uThaw,uRef,uExposure,uMode,uRot,uSel,uDial,uBeam,uFloat;uniform vec2 uDialC;",
  "const vec3 H=vec3(1.6,0.07,1.0);const float RB=0.03;",
  "const vec3 GOLDL=vec3(0.807,0.456,0.069);const vec3 HOTL=vec3(1.0,0.644,0.195);const vec3 CYANL=vec3(0.111,0.888,0.753);",
  "float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}",
  "float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}",
  "float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*noise(p);p=p*2.03+17.1;a*=.5;}return s;}",
  "vec3 vor(vec2 x){vec2 n=floor(x),f=fract(x);float f1=8.,f2=8.,id=0.;for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 g=vec2(float(i),float(j));vec2 o=vec2(hash(n+g),hash(n+g+19.7));vec2 r=g+o-f;float d=dot(r,r);if(d<f1){f2=f1;f1=d;id=hash(n+g+3.1);}else if(d<f2){f2=d;}}return vec3(sqrt(f1),sqrt(f2),id);}",
  "float sdRB(vec3 p,vec3 b,float r){vec3 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.)-r;}",
  "vec3 rotY(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);}",
  "float artK(float y){return mix(1.0,0.66,clamp((y+0.72)/1.44,0.,1.));}",
  "float sdArt(vec3 p){p.y-=uFloat;p=rotY(p,uRot);float k=artK(p.y);vec3 q=vec3(p.x/k,p.y,p.z/k);return sdRB(q,vec3(0.66,0.72,0.66),0.045)*k*0.86;}",
  "float map(vec3 p){return uMode<0.5?sdRB(p,H,RB):sdArt(p);}",
  "vec3 calcN(vec3 p){vec2 e=vec2(0.0011,-0.0011);return normalize(e.xyy*map(p+e.xyy)+e.yyx*map(p+e.yyx)+e.yxy*map(p+e.yxy)+e.xxx*map(p+e.xxx));}",
  "vec2 boxHit(vec3 ro,vec3 rd,vec3 b){vec3 m=1./(rd+vec3(1e-6));vec3 n=m*ro;vec3 k=abs(m)*b;vec3 t1=-n-k,t2=-n+k;return vec2(max(max(t1.x,t1.y),t1.z),min(min(t2.x,t2.y),t2.z));}",
  "vec3 env(vec3 r,float rough){float w=0.018+rough*0.20;float s=dot(r,uKeyN);float strip=exp(-s*s/(w*w))*smoothstep(-0.15,0.3,r.y);",
  " vec3 ax=normalize(cross(uKeyN,vec3(0.,1.,0.)));strip*=smoothstep(1.05,0.25,abs(dot(r,ax)));float en=1./(1.+rough*7.);",
  " vec3 kc=mix(vec3(1.0,0.90,0.76),vec3(0.74,0.84,1.0),uCold);vec3 c=kc*strip*1.9*en;c+=kc*exp(-s*s/0.02)*smoothstep(-0.15,0.3,r.y)*0.035;",
  " c+=mix(vec3(0.0045,0.0040,0.0036),vec3(0.0035,0.0045,0.006),uCold)*smoothstep(-0.3,1.0,r.y);",
  " c+=vec3(0.8,0.84,0.92)*pow(max(0.,dot(r,normalize(vec3(0.15,0.10,-1.)))),60.)*0.6*en;",
  " c+=vec3(1.,0.86,0.66)*pow(max(0.,dot(r,normalize(vec3(-1.,0.25,0.3)))),10.)*0.22*en;c+=vec3(1.,0.9,0.8)*pow(max(0.,dot(r,normalize(vec3(-0.5,0.42,0.75)))),5.)*0.10*en;return c;}",
  "vec3 bgCol(vec3 ro,vec3 rd,vec2 fc){vec3 base=vec3(0.00303,0.00303,0.00335);vec3 c=base;vec2 q=fc/uRes;",
  " float edgeFade=smoothstep(0.,0.18,q.x)*smoothstep(1.,0.82,q.x)*smoothstep(0.,0.2,q.y)*smoothstep(1.,0.8,q.y);",
  " float gy=uMode<0.5?-H.y-0.46:-1.05;if(rd.y<0.){float tg=(gy-ro.y)/rd.y;vec3 g=ro+rd*tg;",
  "  float sd=uMode<0.5?length(max(abs(g.xz)-H.xz*vec2(0.97,0.94),0.)):max(length(g.xz)-0.55,0.);float sh=smoothstep(0.,1.1,sd);",
  "  float bd=dot(g.xz,normalize(vec2(0.42,1.)))-uBeam;float pool=exp(-bd*bd/0.35)*exp(-dot(g.xz,g.xz)*0.05);",
  "  vec3 fl=mix(vec3(0.010,0.0088,0.0072),vec3(0.006,0.0075,0.0095),uCold)*pool*1.4*sh;",
  "  c+=fl*exp(-0.06*tg)*edgeFade;c-=base*(1.-sh)*0.6*edgeFade;}",
  " float hz=exp(-pow(dot(q-0.5,normalize(vec2(1.,-0.55)))*3.2+0.2,2.))*0.0035;c+=mix(vec3(1.,0.86,0.66),vec3(0.7,0.8,1.),uCold)*hz*edgeFade;return max(c,vec3(0.));}",
  "vec3 shade(vec3 p,vec3 rd){vec3 n=calcN(p);vec3 V=-rd;float rough=0.16;vec3 alb=vec3(0.023,0.025,0.031);float spec=0.065;",
  " vec3 emis=vec3(0.);float metal=0.;vec3 gF0=vec3(0.96,0.64,0.22);bool top=false;vec2 tuv=vec2(0.);float groove=0.,inlay=0.,refm=0.;",
  " vec2 px=vec2(1./1024.,1./512.);vec2 pe=vec2(1./2048.,1./1024.);vec2 wxz=p.xz;float heatD=0.;float dark=0.;",
  " float bands=sin((p.x*0.9+p.z*2.2)*6.0+fbm(p.xz*1.2+uMode*7.)*5.0);alb*=0.94+0.06*bands;rough=mix(0.12,0.18,0.5+0.5*bands);",
  " if(uMode<0.5){top=n.y>0.97;tuv=vec2((p.x+H.x)/(2.*H.x),(p.z+H.z)/(2.*H.z));",
  "  if(!top&&abs(n.y)<0.2&&max(abs(p.x)-H.x,abs(p.z)-H.z)>-0.004){rough=0.26;alb*=1.4;}",
  "  if(top){vec2 wv=vec2(fbm(p.xz*1.1+3.),fbm(p.xz*1.1+9.))-0.5;n=normalize(n+vec3(wv.x,0.,wv.y)*0.007);",
  "   vec4 e=texture2D(uEngr,tuv);groove=e.r;inlay=e.g;refm=e.b;",
  "   float gx=texture2D(uEngr,tuv+vec2(pe.x,0.)).r-texture2D(uEngr,tuv-vec2(pe.x,0.)).r;float gz=texture2D(uEngr,tuv+vec2(0.,pe.y)).r-texture2D(uEngr,tuv-vec2(0.,pe.y)).r;",
  "   n=normalize(n+vec3(gx,0.,gz)*0.35);alb*=1.-0.55*groove;spec*=1.-0.4*groove;emis+=groove*vec3(0.024,0.028,0.036);}",
  " }else{vec3 q=rotY(vec3(p.x,p.y-uFloat,p.z),uRot);vec3 nq=rotY(n,uRot);",
  "  if(abs(nq.y)<0.75){float fi;vec2 fu;float k=artK(q.y);float hv=(q.y+0.72)/1.44;",
  "   if(abs(nq.z)>abs(nq.x)){if(nq.z>0.){fi=0.;fu=vec2(q.x/k*0.758+0.5,hv);}else{fi=2.;fu=vec2(-q.x/k*0.758+0.5,hv);}}",
  "   else{if(nq.x>0.){fi=1.;fu=vec2(-q.z/k*0.758+0.5,hv);}else{fi=3.;fu=vec2(q.z/k*0.758+0.5,hv);}}",
  "   vec2 tile=vec2(mod(fi,2.),floor(fi/2.));vec2 auv=(tile+vec2(fu.x,1.-fu.y))*0.5;",
  "   if(fu.x>0.02&&fu.x<0.98&&fu.y>0.02&&fu.y<0.98){vec4 e=texture2D(uFacet,auv);groove=e.r;inlay=e.g;",
  "    float gx=texture2D(uFacet,auv+vec2(0.0012,0.)).r-texture2D(uFacet,auv-vec2(0.0012,0.)).r;n=normalize(n+rotY(vec3(gx,0.,0.),-uRot)*0.6);",
  "    alb*=1.-0.55*groove;float selF=1.-step(0.5,abs(fi-uSel));float pulseF=0.5+0.5*sin(uTime*2.1);",
  "    emis+=inlay*GOLDL*(0.30+selF*(0.4+0.08*pulseF));emis+=groove*vec3(0.022,0.026,0.034)+groove*selF*GOLDL*0.08;}}",
  "  if(q.y<-0.6)rough=0.45;if(nq.y<-0.25)dark=1.;wxz=q.xz;}",
  " if(top){vec4 s=texture2D(uStreak,tuv);float core=s.r,heat=s.g,halo=s.b;heatD=halo;",
  "  core*=0.72+0.28*noise(tuv*vec2(1500.,750.));float gm=smoothstep(0.06,0.5,core);float cx=texture2D(uStreak,tuv+vec2(px.x,0.)).r-texture2D(uStreak,tuv-vec2(px.x,0.)).r;",
  "  float cz=texture2D(uStreak,tuv+vec2(0.,px.y)).r-texture2D(uStreak,tuv-vec2(0.,px.y)).r;n=normalize(n-vec3(cx,0.,cz)*0.8*gm);",
  "  metal=max(gm,inlay*0.9);rough=mix(rough,0.14+0.25*heat,metal);",
  "  emis+=pow(heat,1.4)*mix(GOLDL,HOTL,heat)*2.4+pow(heat,5.)*vec3(1.,0.93,0.8)*2.2;",
  "  emis+=halo*vec3(0.9,0.42,0.08)*0.20;emis+=GOLDL*0.04*metal;",
  "  float d=length(p.xz-uPulse.xy);float ring=exp(-pow((d-uPulse.z)/0.0042,2.));float ring2=exp(-pow((d-uPulse.z+0.022)/0.0025,2.));float wake=exp(-pow((d-uPulse.z+0.05)/0.05,2.))*step(d,uPulse.z);",
  "  emis+=uPulse.w*(ring*vec3(1.,0.88,0.66)*1.5+ring2*vec3(1.,0.8,0.5)*0.35+wake*vec3(1.,0.78,0.45)*0.012);",
  "  float lit=exp(-pow((d-uPulse.z)/0.10,2.))*uPulse.w;emis+=(groove*0.9+inlay)*lit*GOLDL*1.5;",
  "  float d2=length(p.xz-uRipple.xy);emis+=uRipple.w*exp(-pow((d2-uRipple.z)/0.008,2.))*vec3(1.,0.88,0.7)*0.7;",
  "  vec2 dc=p.xz-uDialC;float dr=length(dc);float a=fract(atan(dc.x,-dc.y)/6.2831853+1.);",
  "  float rm=exp(-pow((dr-0.36)/0.0055,2.));emis+=step(a,uDial)*rm*GOLDL*1.9;",
  "  emis+=exp(-dr*dr/0.00025)*uDial*HOTL*1.6;emis+=refm*uRef*CYANL*1.25;emis+=refm*(1.-uRef)*0.015;",
  "  float bd=dot(p.xz,normalize(vec2(0.42,1.)))-uBeam;float beam=exp(-bd*bd/0.05);",
  "  vec3 nm=normalize(vec3(noise(p.xz*240.)-0.5,0.55,noise(p.xz*240.+7.)-0.5));float sp=pow(max(0.,dot(nm,normalize(vec3(-0.8,0.25,-0.5)))),24.);",
  "  emis+=beam*(vec3(0.0035,0.0031,0.0027)+sp*0.10*vec3(1.,0.92,0.8)+groove*vec3(0.05,0.045,0.04)+metal*GOLDL*0.12);}",
  " float NoV=max(dot(n,V),0.);vec3 r=reflect(rd,n);",
  " if(heatD>0.01){r=normalize(r+(vec3(noise(tuv*90.+uTime*2.3),0.,noise(tuv*90.-uTime*2.1+5.))-0.5)*0.05*heatD);}",
  " vec3 F0=mix(vec3(spec),gF0,metal);vec3 F=F0+(1.-F0)*pow(1.-NoV,5.)*(1.-metal*0.6);",
  " vec3 c=alb*(1.-metal)*(0.55+0.16*max(n.y,0.))+F*env(r,rough)+emis;",
  " if(top&&uCold>0.001){vec2 fq=p.xz;float fr=fbm(fq*6.+fbm(fq*2.5)*2.);float feather=smoothstep(0.30,0.78,fr);vec3 vr=vor(fq*4.2);",
  "  float edge=1.-smoothstep(0.,0.016,vr.y-vr.x);float melt=smoothstep(uThaw*1.3-0.25,uThaw*1.3,0.25+0.5*vr.z+0.25*fr);float fa=uCold*(0.30+0.70*feather)*melt;",
  "  vec3 ri=reflect(rd,normalize(vec3((fr-0.5)*0.10,1.,(noise(fq*9.)-0.5)*0.10)));vec3 iceRef=env(ri,0.10)*0.07*vec3(0.85,0.93,1.0);",
  "  float spark=pow(noise(fq*190.),16.)*2.;vec3 ice=vec3(0.36,0.43,0.52)*(0.010+0.035*feather)+spark*vec3(0.6,0.72,0.85)*0.06;",
  "  c=mix(c,c*0.5+ice,fa)+iceRef*fa;c+=edge*fa*vec3(0.45,0.56,0.72)*0.025;",
  "  float opening=edge*uCold*smoothstep(0.,0.2,uThaw)*(1.-smoothstep(0.75,1.,uThaw))*(1.-melt*0.6);c+=opening*HOTL*0.32;}",
  " if(dark>0.5)c*=0.12;return c;}",
  "vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-0.055,step(0.0031308,c));}",
  "void main(){vec2 fc=gl_FragCoord.xy;vec2 uv=(fc-0.5*uRes)/uRes.y-uShift;vec3 rd=normalize(uCamF*uFocal+uCamR*uv.x+uCamU*uv.y);vec3 ro=uCamPos;",
  " vec3 bb=uMode<0.5?H+0.004:vec3(0.74,0.78,0.74);vec3 ro2=uMode<0.5?ro:ro-vec3(0.,uFloat,0.);vec2 tb=boxHit(ro2,rd,bb);float t=max(tb.x,0.);bool hit=false;float minD=1e3;float tm=0.;",
  " if(tb.x<tb.y&&tb.y>0.){for(int i=0;i<64;i++){vec3 p=ro+rd*t;float d=map(p);if(d<minD){minD=d;tm=t;}if(d<0.00035*t){hit=true;break;}t+=d*(uMode<0.5?1.:0.75);if(t>tb.y+0.02)break;}}",
  " vec3 bg=bgCol(ro,rd,fc);vec3 col=bg;",
  " if(hit){col=shade(ro+rd*t,rd);}else if(minD<0.03){float pix=1.6*tm/(uFocal*uRes.y);float cov=1.-smoothstep(0.,pix,minD);if(cov>0.001){col=mix(bg,shade(ro+rd*tm,rd),cov);}}",
  " col*=uExposure;col=col/(1.+col*0.55);col=srgb(col);col+=(hash(fc+fract(uTime*7.))-0.5)/255.;gl_FragColor=vec4(col,1.);}",
].join("\n");

/* ---------- camera ---------- */
function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function camera(v: View, w: number, h: number): Camera {
  const f = norm([v.target[0] - v.pos[0], v.target[1] - v.pos[1], v.target[2] - v.pos[2]]);
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const focal = v.focal || 1.6;
  const shift: V2 = v.shift ?? [0, 0];
  return {
    pos: v.pos,
    f,
    r,
    u,
    focal,
    shift,
    w,
    h,
    project(x, y, z) {
      const d: V3 = [x - v.pos[0], y - v.pos[1], z - v.pos[2]];
      const zz = dot(d, f);
      if (zz <= 0.01) return null;
      const sx = (dot(d, r) / zz) * focal + shift[0];
      const sy = (dot(d, u) / zz) * focal + shift[1];
      return [sx * h + 0.5 * w, 0.5 * h - sy * h];
    },
    pick(mx, my, planeY) {
      const ux = (mx - 0.5 * w) / h - shift[0];
      const uy = (0.5 * h - my) / h - shift[1];
      const rd = norm([
        f[0] * focal + r[0] * ux + u[0] * uy,
        f[1] * focal + r[1] * ux + u[1] * uy,
        f[2] * focal + r[2] * ux + u[2] * uy,
      ]);
      if (Math.abs(rd[1]) < 1e-5) return null;
      const t = (planeY - v.pos[1]) / rd[1];
      if (t < 0) return null;
      return [v.pos[0] + rd[0] * t, v.pos[2] + rd[2] * t];
    },
  };
}

/* ---------- painting the top-face textures (world xz to texture pixels) ---------- */
function worldXf(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.setTransform(w / (2 * HX), 0, 0, h / (2 * HZ), w / 2, h / 2);
}

export function cubic(p0: V2, p1: V2, p2: V2, p3: V2, s: number): V2 {
  const a = 1 - s;
  return [
    a * a * a * p0[0] + 3 * a * a * s * p1[0] + 3 * a * s * s * p2[0] + s * s * s * p3[0],
    a * a * a * p0[1] + 3 * a * a * s * p1[1] + 3 * a * s * s * p2[1] + s * s * s * p3[1],
  ];
}

export type Curve = [V2, V2, V2, V2];

export const PATHS: Record<"toVault" | "toTrader" | "demo", Curve> = {
  toVault: [[-0.86, 0.3], [-0.4, 0.92], [0.7, 0.9], [0.97, 0.22]],
  toTrader: [[-1.22, 0.24], [-1.36, 0.22], [-1.48, 0.36], [-1.62, 0.5]],
  demo: [[-0.74, -0.46], [-0.52, -0.66], [-0.18, -0.7], [0.04, -0.6]],
};
export const LAYOUT: Record<"dial" | "deposit" | "vault" | "trader", V2> = {
  dial: [0.14, -0.04],
  deposit: [-1.04, 0.24],
  vault: [1.13, 0.1],
  trader: [-1.58, 0.5],
};

type Channel = "r" | "g" | "b";
function channel(ch: Channel, a: number): string {
  return ch === "r" ? `rgba(255,0,0,${a})` : ch === "g" ? `rgba(0,255,0,${a})` : `rgba(0,0,255,${a})`;
}

/** One polyline in one texture channel: r is presence, g heat, b halo. */
export function strokePath(ctx: CanvasRenderingContext2D, pts: Pt[], ch: Channel, a: number, width: number): void {
  if (pts.length < 2 || a <= 0.002) return;
  ctx.strokeStyle = channel(ch, a);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

/** A streak with presence, heat and halo; short chunks keep per-segment heat without bead artefacts. */
export function paintStreak(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  heatFn: (pt: Pt) => number,
  presence: number,
  coreW = 0.014,
): void {
  if (pts.length < 2) return;
  strokePath(ctx, pts, "r", presence, coreW);
  const CH = 6;
  for (let i = 0; i < pts.length - 1; i += CH) {
    const seg = pts.slice(i, Math.min(pts.length, i + CH + 1));
    const h = heatFn(seg[Math.floor(seg.length / 2)]);
    if (h > 0.01) {
      strokePath(ctx, seg, "g", Math.min(1, h), coreW * 0.75);
      strokePath(ctx, seg, "b", 0.16 * h, coreW * 3.2);
      strokePath(ctx, seg, "b", 0.06 * h, coreW * 7);
    }
  }
}

export function sampleCubic(c: Curve, n: number, s0: number, s1: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) out.push(cubic(c[0], c[1], c[2], c[3], s0 + ((s1 - s0) * i) / n));
  return out;
}

export function wobble(pts: V2[], amp: number, seed: number): V2[] {
  return pts.map((p, i) => {
    const k = Math.sin(i * 0.9 + seed) * 0.6 + Math.sin(i * 2.3 + seed * 3.1) * 0.4;
    return [p[0], p[1] + k * amp];
  });
}

/** Particles travelling along a path: short bright dashes with a faint halo. */
export function paintFlow(
  ctx: CanvasRenderingContext2D,
  path: Curve,
  s: number,
  count: number,
  spread: number,
  bright: number,
  width = 0.011,
): void {
  for (let i = 0; i < count; i++) {
    const si = s - i * spread;
    if (si <= 0 || si >= 1) continue;
    const a = cubic(path[0], path[1], path[2], path[3], Math.max(0, si - 0.025));
    const b = cubic(path[0], path[1], path[2], path[3], si);
    strokePath(ctx, [a, b], "r", 0.9 * bright, width);
    strokePath(ctx, [a, b], "g", 0.95 * bright, width * 0.8);
    strokePath(ctx, [a, b], "b", 0.22 * bright, width * 6);
  }
}

function paintEngraving(c: HTMLCanvasElement, fontMono: string): void {
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = "#000";
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "lighter";
  worldXf(g, c.width, c.height);
  g.lineCap = "round";
  g.lineJoin = "round";
  const K = 1 / 320; // one design pixel in world units
  const circ = (x: number, z: number, r: number, ch: Channel, w: number, a: number) => {
    g.strokeStyle = channel(ch, a);
    g.lineWidth = w * K;
    g.beginPath();
    g.arc(x, z, r, 0, Math.PI * 2);
    g.stroke();
  };
  const line = (x1: number, z1: number, x2: number, z2: number, ch: Channel, w: number, a: number) =>
    strokePath(g, [[x1, z1], [x2, z2]], ch, a, w * K);
  const text = (str: string, x: number, z: number, px: number, weight = 500) => {
    g.save();
    g.translate(x, z);
    g.scale(K, K);
    g.fillStyle = channel("r", 0.42);
    g.textBaseline = "middle";
    g.font = `${weight} ${px}px ${fontMono}`;
    g.fillText(str, 0, 0);
    g.restore();
  };
  const D = LAYOUT.dial;
  circ(D[0], D[1], 0.42, "r", 2.0, 0.9);
  circ(D[0], D[1], 0.3, "r", 1.3, 0.8);
  circ(D[0], D[1], 0.36, "r", 0.9, 0.4);
  for (let i = 0; i < 60; i++) {
    const an = (i / 60) * Math.PI * 2;
    const ca = Math.sin(an);
    const sa = -Math.cos(an);
    const L = i % 5 === 0 ? 0.055 : 0.025;
    line(D[0] + ca * 0.43, D[1] + sa * 0.43, D[0] + ca * (0.43 + L), D[1] + sa * (0.43 + L), "r", i % 5 === 0 ? 2.0 : 1.2, 0.85);
  }
  line(D[0], D[1] - 0.29, D[0], D[1] - 0.5, "b", 2.2, 1);
  line(D[0] - 0.02, D[1] - 0.52, D[0] + 0.02, D[1] - 0.52, "b", 2.0, 1);
  line(D[0], D[1] - 0.29, D[0], D[1] - 0.5, "r", 2.2, 0.7);
  circ(D[0], D[1], 0.012, "g", 3, 1);
  const P = LAYOUT.deposit;
  g.strokeStyle = channel("r", 0.9);
  g.lineWidth = 1.7 * K;
  g.beginPath();
  g.roundRect(P[0] - 0.17, P[1] - 0.065, 0.34, 0.13, 0.065);
  g.stroke();
  g.setLineDash([0.01, 0.016]);
  circ(P[0], P[1], 0.21, "r", 0.9, 0.55);
  circ(P[0], P[1], 0.26, "r", 0.9, 0.35);
  g.setLineDash([]);
  const Vt = LAYOUT.vault;
  [0.08, 0.16, 0.24, 0.33].forEach((r, k) => circ(Vt[0], Vt[1], r, "r", k === 0 ? 2.2 : 1.2, 0.85 - k * 0.08));
  circ(Vt[0], Vt[1], 0.08, "g", 1.5, 0.9);
  strokePath(g, sampleCubic(PATHS.toVault, 80, 0, 1), "r", 0.5, 1.0 * K);
  strokePath(g, sampleCubic(PATHS.toTrader, 40, 0, 1), "r", 0.5, 1.0 * K);
  for (let s2 = 0.06; s2 < 1; s2 += 0.08) {
    const q = cubic(PATHS.toVault[0], PATHS.toVault[1], PATHS.toVault[2], PATHS.toVault[3], s2);
    circ(q[0], q[1], 0.005, "g", 1.8, 0.7);
  }
  g.strokeStyle = channel("r", 0.8);
  g.lineWidth = 1.3 * K;
  g.strokeRect(-1.48, -0.9, 0.3, 0.12);
  text("T  S", -1.42, -0.84, 15, 600);
  text("P*", D[0] + 0.03, D[1] - 0.52, 12, 600);
  text("DEPOSIT", P[0] - 0.13, P[1] + 0.33, 17);
  text("LPs", Vt[0] - 0.06, Vt[1] + 0.41, 17);
  for (let k = 0; k <= 32; k++) {
    const xx = -1.5 + k * 0.09375;
    line(xx, -0.97, xx, k % 4 === 0 ? -0.93 : -0.95, "r", 0.9, 0.5);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

function paintFacets(c: HTMLCanvasElement, fontSerif: string, fontMono: string): void {
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, 1024, 1024);
  g.fillStyle = "#000";
  g.fillRect(0, 0, 1024, 1024);
  g.globalCompositeOperation = "lighter";
  g.lineCap = "round";
  g.lineJoin = "round";
  const R = "rgba(255,0,0,0.9)";
  const G = "rgba(0,255,0,1)";
  const names = ["CLAWBACK", "LICENCE", "REBATES", "QUOTE"];
  for (let i = 0; i < 4; i++) {
    g.save();
    g.translate((i % 2) * 512, Math.floor(i / 2) * 512);
    g.strokeStyle = R;
    g.lineWidth = 2;
    g.strokeRect(70, 60, 372, 392);
    g.fillStyle = R;
    g.font = `400 120px ${fontSerif}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(`0${i + 1}`, 256, 160);
    g.font = `500 34px ${fontMono}`;
    g.fillStyle = G;
    g.fillText(names[i], 256, 400);
    g.strokeStyle = G;
    g.lineWidth = 3;
    g.beginPath();
    if (i === 0) {
      g.moveTo(130, 300);
      g.bezierCurveTo(200, 250, 300, 330, 382, 270);
      g.stroke();
      g.strokeStyle = R;
      g.lineWidth = 1.5;
      g.strokeRect(120, 268, 272, 24);
    }
    if (i === 1) {
      g.arc(256, 290, 46, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(256, 290);
      g.lineTo(330, 290);
      g.lineTo(330, 306);
      g.moveTo(310, 290);
      g.lineTo(310, 302);
      g.stroke();
      g.strokeStyle = R;
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(256, 290, 66, 0, Math.PI * 2);
      g.stroke();
    }
    if (i === 2) {
      for (const x of [130, 190, 322, 382]) {
        g.moveTo(x, 240);
        g.lineTo(256, 300);
      }
      g.moveTo(256, 300);
      g.lineTo(256, 350);
      g.stroke();
      g.beginPath();
      g.arc(256, 300, 8, 0, Math.PI * 2);
      g.stroke();
    }
    if (i === 3) {
      g.moveTo(130, 270);
      g.lineTo(382, 270);
      g.moveTo(130, 314);
      g.lineTo(382, 314);
      g.stroke();
      g.strokeStyle = R;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(256, 250);
      g.lineTo(256, 334);
      g.stroke();
    }
    g.restore();
  }
}

/** A stroke the visitor drew on the hero stone; kept so the closing stone can show it again. */
export interface UserStroke {
  pts: Pt[];
  last: number;
}

type UniformName =
  | "uRes" | "uTime" | "uCamPos" | "uCamF" | "uCamR" | "uCamU" | "uFocal" | "uShift" | "uStreak" | "uEngr" | "uFacet"
  | "uPulse" | "uRipple" | "uKeyN" | "uCold" | "uThaw" | "uRef" | "uExposure" | "uMode" | "uRot" | "uSel" | "uDial"
  | "uBeam" | "uFloat" | "uDialC";
const UNIFORMS: UniformName[] = [
  "uRes", "uTime", "uCamPos", "uCamF", "uCamR", "uCamU", "uFocal", "uShift", "uStreak", "uEngr", "uFacet", "uPulse",
  "uRipple", "uKeyN", "uCold", "uThaw", "uRef", "uExposure", "uMode", "uRot", "uSel", "uDial", "uBeam", "uFloat", "uDialC",
];

function canvas2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("Canvas2D is unavailable");
  return g;
}

export class Engine {
  readonly t0 = performance.now();
  readonly userStrokes: UserStroke[] = [];
  private stages: Stage[] = [];
  private raf = 0;
  private quality = 1;
  private ok = false;
  private ema: number | null = null;
  private frames = 0;
  private readonly streakC: HTMLCanvasElement;
  private readonly sctx: CanvasRenderingContext2D;
  private readonly engrC: HTMLCanvasElement;
  private readonly facetC: HTMLCanvasElement;
  private readonly fonts = { mono: '"JetBrains Mono", ui-monospace, monospace', serif: '"Manrope", system-ui, sans-serif' };
  private glc: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private U = {} as Record<UniformName, WebGLUniformLocation | null>;
  private tex: { streak: WebGLTexture; engr: WebGLTexture; facet: WebGLTexture } | null = null;
  private engrTint: HTMLCanvasElement | null = null;
  private engrTintStale = true;
  private tintCache = new Map<string, HTMLCanvasElement>();

  constructor() {
    this.streakC = document.createElement("canvas");
    this.streakC.width = TW;
    this.streakC.height = TH;
    this.sctx = canvas2d(this.streakC);
    this.engrC = document.createElement("canvas");
    this.engrC.width = EW;
    this.engrC.height = EH;
    this.facetC = document.createElement("canvas");
    this.facetC.width = 1024;
    this.facetC.height = 1024;
    paintEngraving(this.engrC, this.fonts.mono);
    paintFacets(this.facetC, this.fonts.serif, this.fonts.mono);
    try {
      this.initGL();
    } catch {
      this.ok = false;
    }
    // The engraving uses the web fonts; repaint once they have loaded.
    void document.fonts.ready.then(() => {
      paintEngraving(this.engrC, this.fonts.mono);
      paintFacets(this.facetC, this.fonts.serif, this.fonts.mono);
      this.engrTintStale = true;
      this.uploadStatic();
      this.invalidate();
    });
  }

  private initGL(): void {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 4;
    const gl = c.getContext("webgl", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    if (!gl) return;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) throw new Error("shader allocation failed");
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram();
    if (!p) throw new Error("program allocation failed");
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, "aP");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of UNIFORMS) this.U[n] = gl.getUniformLocation(p, n);
    this.glc = c;
    this.gl = gl;
    this.tex = { streak: this.mkTex(0), engr: this.mkTex(1), facet: this.mkTex(2) };
    gl.uniform1i(this.U.uStreak, 0);
    gl.uniform1i(this.U.uEngr, 1);
    gl.uniform1i(this.U.uFacet, 2);
    this.uploadStatic();
    c.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.ok = false;
      this.invalidate();
    });
    this.ok = true;
  }

  private mkTex(unit: number): WebGLTexture {
    const gl = this.gl;
    if (!gl) throw new Error("no WebGL context");
    const t = gl.createTexture();
    if (!t) throw new Error("texture allocation failed");
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const an = gl.getExtension("EXT_texture_filter_anisotropic");
    if (an) {
      const max = gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private uploadStatic(): void {
    if (!this.tex) return;
    this.upload(1, this.tex.engr, this.engrC);
    this.upload(2, this.tex.facet, this.facetC);
  }

  // Upload through the pixel data. Handing WebGL the canvas element directly can give it a stale snapshot in
  // some Chrome configurations, which froze old streaks on the stone.
  private upload(unit: number, tex: WebGLTexture, cnv: HTMLCanvasElement): void {
    const gl = this.gl;
    if (!gl) return;
    const img = canvas2d(cnv).getImageData(0, 0, cnv.width, cnv.height);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cnv.width, cnv.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(img.data.buffer));
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  add(canvas: HTMLCanvasElement, def: StageDef, animating: boolean): Stage {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas2D is unavailable");
    const stage: Stage = { ...def, canvas, ctx, visible: true, dirty: true, animating, cssW: 0, cssH: 0 };
    this.stages.push(stage);
    stage.io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          stage.visible = e.isIntersecting;
          if (e.isIntersecting) {
            stage.dirty = true;
            this.kick();
          }
        }
      },
      { rootMargin: "120px" },
    );
    stage.io.observe(canvas);
    stage.ro = new ResizeObserver(() => {
      stage.dirty = true;
      this.kick();
    });
    stage.ro.observe(canvas);
    this.kick();
    return stage;
  }

  remove(stage: Stage): void {
    stage.io?.disconnect();
    stage.ro?.disconnect();
    this.stages = this.stages.filter((s) => s !== stage);
  }

  invalidate(): void {
    for (const s of this.stages) s.dirty = true;
    this.kick();
  }

  kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  now(): number {
    return (performance.now() - this.t0) / 1000;
  }

  private loop = (now: number): void => {
    this.raf = 0;
    const t = (now - this.t0) / 1000;
    let any = false;
    const t1 = performance.now();
    for (const s of this.stages) {
      if (!s.visible) continue;
      if (s.animating || s.dirty) {
        this.renderStage(s, t);
        s.dirty = false;
      }
      if (s.animating) any = true;
    }
    if (!any) return;
    // Adaptive resolution: hold the render cost near 40 fps, and recover slowly when there is headroom.
    const dt = performance.now() - t1;
    this.ema = this.ema === null ? dt : this.ema * 0.85 + dt * 0.15;
    this.frames += 1;
    if (this.frames % 8 === 0) {
      if (this.ema > 26 && this.quality > 0.4) {
        this.quality = Math.max(0.4, this.quality * 0.8);
        this.invalidate();
      } else if (this.ema < 9 && this.quality < 1) {
        this.quality = Math.min(1, this.quality * 1.08);
      }
    }
    if (this.ema > 45 && this.quality <= 0.41) setTimeout(() => this.kick(), 40);
    else this.kick();
  };

  private size(s: Stage): V2 {
    const rect = s.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, s.maxDpr ?? 1.5) * (s.scale ?? 1);
    const w = Math.max(2, Math.round(rect.width * dpr));
    const h = Math.max(2, Math.round(rect.height * dpr));
    if (s.canvas.width !== w || s.canvas.height !== h) {
      s.canvas.width = w;
      s.canvas.height = h;
    }
    s.cssW = rect.width;
    s.cssH = rect.height;
    return [w, h];
  }

  private renderStage(s: Stage, t: number): void {
    const [w, h] = this.size(s);
    if (s.cssW < 2 || s.cssH < 2) return;
    const P = s.scene(t, s);
    const cam = camera(P.view, w, h);
    s.cam = camera(P.view, s.cssW, s.cssH);
    const g = this.sctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, TW, TH);
    g.fillStyle = "#000";
    g.fillRect(0, 0, TW, TH);
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    g.lineJoin = "round";
    worldXf(g, TW, TH);
    s.paint?.(g, t, P);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.ok) this.renderGL(s, P, cam, w, h, t);
    else this.render2D(s, P, w, h);
    const cssCam = s.cam;
    const proj: Project = (x, y, z) => (this.ok ? cssCam.project(x, y, z) : this.projectTop(s, x, z));
    if (s.overlay) {
      s.ctx.save();
      s.ctx.scale(w / s.cssW, h / s.cssH);
      beginAnnotations(s.ctx);
      s.overlay(s.ctx, proj, t, P);
      s.ctx.restore();
    }
  }

  private renderGL(s: Stage, P: Scene, cam: Camera, w: number, h: number, t: number): void {
    const gl = this.gl;
    const c = this.glc;
    const U = this.U;
    if (!gl || !c || !this.tex) return;
    // Only the expensive shader adapts resolution. Canvas annotations remain at device resolution.
    const rw = Math.max(2, Math.round(w * this.quality));
    const rh = Math.max(2, Math.round(h * this.quality));
    if (c.width < rw || c.height < rh) {
      c.width = Math.max(c.width, rw);
      c.height = Math.max(c.height, rh);
    }
    gl.viewport(0, 0, rw, rh);
    this.upload(0, this.tex.streak, this.streakC);
    gl.uniform2f(U.uRes, rw, rh);
    gl.uniform1f(U.uTime, t);
    gl.uniform3fv(U.uCamPos, cam.pos);
    gl.uniform3fv(U.uCamF, cam.f);
    gl.uniform3fv(U.uCamR, cam.r);
    gl.uniform3fv(U.uCamU, cam.u);
    gl.uniform1f(U.uFocal, cam.focal);
    gl.uniform2fv(U.uShift, cam.shift);
    gl.uniform4fv(U.uPulse, P.pulse ?? [0, 0, 0, 0]);
    gl.uniform4fv(U.uRipple, P.ripple ?? [0, 0, 0, 0]);
    gl.uniform3fv(U.uKeyN, norm(P.keyN ?? [0.3, -0.36, 0.88]));
    gl.uniform1f(U.uCold, P.cold ?? 0);
    gl.uniform1f(U.uThaw, P.thaw ?? 0);
    gl.uniform1f(U.uRef, P.ref ?? 0);
    gl.uniform1f(U.uExposure, P.exposure ?? 1);
    gl.uniform1f(U.uMode, P.mode ?? 0);
    gl.uniform1f(U.uRot, P.rot ?? 0);
    gl.uniform1f(U.uSel, P.sel ?? -1);
    gl.uniform1f(U.uDial, P.dial ?? 0);
    gl.uniform1f(U.uBeam, P.beam ?? 0.1);
    gl.uniform1f(U.uFloat, P.float ?? 0);
    gl.uniform2fv(U.uDialC, LAYOUT.dial);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    s.ctx.globalCompositeOperation = "copy";
    s.ctx.drawImage(c, 0, c.height - rh, rw, rh, 0, 0, w, h);
    s.ctx.globalCompositeOperation = "source-over";
  }

  // Channel data converted to alpha, so the gold and the engraving read on a dark stone without WebGL.
  private tinted(src: HTMLCanvasElement, key: string, fn: (o: Uint8ClampedArray, i: number) => void): HTMLCanvasElement {
    let c = this.tintCache.get(key);
    if (!c) {
      c = document.createElement("canvas");
      this.tintCache.set(key, c);
    }
    if (c.width !== src.width) {
      c.width = src.width;
      c.height = src.height;
    }
    const d = canvas2d(src).getImageData(0, 0, src.width, src.height);
    for (let i = 0; i < d.data.length; i += 4) fn(d.data, i);
    canvas2d(c).putImageData(d, 0, 0);
    return c;
  }

  // Canvas2D fallback: a flat, top-down stone with the same streak texture and exact pointer mapping.
  private render2D(s: Stage, P: Scene, w: number, h: number): void {
    const g = s.ctx;
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#0A0A0B";
    g.fillRect(0, 0, w, h);
    if ((P.mode ?? 0) > 0.5) {
      const R = Math.min(w, h) * 0.32;
      g.save();
      g.translate(w / 2, h / 2);
      const gr0 = g.createLinearGradient(-R, -R, R, R);
      gr0.addColorStop(0, "#17171a");
      gr0.addColorStop(1, "#0c0c0e");
      g.fillStyle = gr0;
      g.strokeStyle = "rgba(232,180,74,0.5)";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(-R, R);
      g.lineTo(-R * 0.66, -R);
      g.lineTo(R * 0.66, -R);
      g.lineTo(R, R);
      g.closePath();
      g.fill();
      g.stroke();
      if (P.sel !== undefined && P.sel >= 0) {
        g.fillStyle = "#E8B44A";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `400 ${Math.round(R * 0.55)}px ${this.fonts.serif}`;
        g.fillText(`0${P.sel + 1}`, 0, -R * 0.15);
      }
      g.restore();
      return;
    }
    const fit = s.flatFit ? s.flatFit(w, h) : null;
    const sw = fit ? fit[2] : Math.min(w * 0.9, h * 0.9 * 1.6);
    const sh = sw / 1.6;
    const ox = fit ? fit[0] : (w - sw) / 2;
    const oy = fit ? fit[1] : (h - sh) / 2;
    s.flat = { ox, oy, sw, sh };
    const gr = g.createLinearGradient(ox, oy, ox + sw, oy + sh);
    gr.addColorStop(0, "#282a32");
    gr.addColorStop(0.45, "#1c1e25");
    gr.addColorStop(0.52, "#33343a");
    gr.addColorStop(0.6, "#1c1e25");
    gr.addColorStop(1, "#0c0c0e");
    g.fillStyle = gr;
    g.fillRect(ox, oy, sw, sh);
    g.strokeStyle = "rgba(243,239,231,0.12)";
    g.lineWidth = 1;
    g.strokeRect(ox + 0.5, oy + 0.5, sw - 1, sh - 1);
    if (!this.engrTint || this.engrTintStale) {
      this.engrTint = this.tinted(this.engrC, "engr", (o, i) => {
        const r = o[i];
        const gg = o[i + 1];
        o[i + 3] = Math.max(r * 0.42, gg);
        o[i] = gg ? 232 : 190;
        o[i + 1] = gg ? 180 : 184;
        o[i + 2] = gg ? 74 : 172;
      });
      this.engrTintStale = false;
    }
    g.drawImage(this.engrTint, ox, oy, sw, sh);
    const st = this.tinted(this.streakC, "streak", (o, i) => {
      const r = o[i];
      const gg = o[i + 1] / 255;
      const b = o[i + 2];
      o[i + 3] = Math.min(255, Math.max(r, b * 1.4));
      o[i] = 232 + 23 * gg;
      o[i + 1] = 180 + 30 * gg;
      o[i + 2] = 74 + 48 * gg;
    });
    g.drawImage(st, ox, oy, sw, sh);
    if ((P.ref ?? 0) > 0.5) {
      const dx = ox + ((LAYOUT.dial[0] + HX) / (2 * HX)) * sw;
      const dy = oy + ((LAYOUT.dial[1] - 0.4 + HZ) / (2 * HZ)) * sh;
      g.strokeStyle = "#5EF2E1";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(dx, dy - (0.1 * sh) / 2);
      g.lineTo(dx, dy + (0.05 * sh) / 2);
      g.stroke();
    }
    if (P.pulse && P.pulse[3] > 0) {
      const px = ox + ((P.pulse[0] + HX) / (2 * HX)) * sw;
      const py = oy + ((P.pulse[1] + HZ) / (2 * HZ)) * sh;
      g.save();
      g.beginPath();
      g.rect(ox, oy, sw, sh);
      g.clip();
      g.strokeStyle = `rgba(255,236,200,${0.7 * P.pulse[3]})`;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(px, py, (P.pulse[2] / (2 * HX)) * sw, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    if ((P.cold ?? 0) > 0) {
      g.fillStyle = `rgba(150,170,195,${0.22 * (P.cold ?? 0) * (1 - (P.thaw ?? 0))})`;
      g.fillRect(ox, oy, sw, sh);
    }
  }

  /** The world point on the top face under a client-space pointer, for a stage. */
  pickTop(s: Stage, clientX: number, clientY: number): V2 | null {
    const rect = s.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    if (!this.ok && s.flat) {
      const k = s.canvas.width / rect.width;
      return [((mx * k - s.flat.ox) / s.flat.sw) * 2 * HX - HX, ((my * k - s.flat.oy) / s.flat.sh) * 2 * HZ - HZ];
    }
    return s.cam ? s.cam.pick(mx, my, HY) : null;
  }

  private projectTop(s: Stage, x: number, z: number): V2 | null {
    if (!s.cam) return null;
    if (!this.ok && s.flat) {
      const k = s.canvas.width / s.cssW;
      return [(s.flat.ox + ((x + HX) / (2 * HX)) * s.flat.sw) / k, (s.flat.oy + ((z + HZ) / (2 * HZ)) * s.flat.sh) / k];
    }
    return s.cam.project(x, HY, z);
  }

  inside(p: V2 | null): p is V2 {
    return p !== null && Math.abs(p[0]) < HX - 0.03 && Math.abs(p[1]) < HZ - 0.03;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const s of this.stages.slice()) this.remove(s);
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
    this.ok = false;
  }
}

let instance: Engine | null = null;

/** The page's single engine; WebGL contexts are scarce, so every stage shares one. */
export function engine(): Engine {
  instance ??= new Engine();
  return instance;
}
