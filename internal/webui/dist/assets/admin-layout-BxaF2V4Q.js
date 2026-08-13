import{u as x,j as e,N as y,c as r,L as h,O as m}from"./index-DwknAjdv.js";import{u as p}from"./hooks-Bg7KuHFR.js";import{c as s}from"./createLucideIcon-CS2or1Zn.js";/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u=[["path",{d:"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",key:"169zse"}]],k=s("Activity",u);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=[["path",{d:"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z",key:"1s6t7t"}],["circle",{cx:"16.5",cy:"7.5",r:".5",fill:"currentColor",key:"w0ekpg"}]],g=s("KeyRound",f);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const v=[["path",{d:"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z",key:"zw3jo"}],["path",{d:"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12",key:"1wduqc"}],["path",{d:"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17",key:"kqbvx6"}]],b=s("Layers",v);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const j=[["rect",{width:"20",height:"8",x:"2",y:"2",rx:"2",ry:"2",key:"ngkwjq"}],["rect",{width:"20",height:"8",x:"2",y:"14",rx:"2",ry:"2",key:"iecqi9"}],["line",{x1:"6",x2:"6.01",y1:"6",y2:"6",key:"16zg32"}],["line",{x1:"6",x2:"6.01",y1:"18",y2:"18",key:"nzw8ys"}]],N=s("Server",j);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const w=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["path",{d:"M16 3.13a4 4 0 0 1 0 7.75",key:"1da9ce"}]],_=s("Users",w);/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const L=[["circle",{cx:"12",cy:"4.5",r:"2.5",key:"r5ysbb"}],["path",{d:"m10.2 6.3-3.9 3.9",key:"1nzqf6"}],["circle",{cx:"4.5",cy:"12",r:"2.5",key:"jydg6v"}],["path",{d:"M7 12h10",key:"b7w52i"}],["circle",{cx:"19.5",cy:"12",r:"2.5",key:"1piiel"}],["path",{d:"m13.8 17.7 3.9-3.9",key:"1wyg1y"}],["circle",{cx:"12",cy:"19.5",r:"2.5",key:"13o1pw"}]],M=s("Waypoints",L),z=[{to:"/admin/overview",label:"总览",icon:k},{to:"/admin/users",label:"用户",icon:_},{to:"/admin/providers",label:"上游钥匙",icon:N},{to:"/admin/pools",label:"渠道池",icon:b},{to:"/admin/channels",label:"渠",icon:M},{to:"/admin/keys",label:"虚拟钥匙",icon:g}];function H(){var c,o;const{operator:t,logout:i}=x(),n=p();return e.jsxs("div",{className:"flex min-h-screen",children:[e.jsxs("aside",{className:"sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border bg-card/60 px-3 py-6",children:[e.jsxs("div",{className:"px-3",children:[e.jsx("p",{className:"font-mono text-[10px] uppercase tracking-[0.28em] text-ember-400/80",children:"Token Hub"}),e.jsx("div",{className:"font-serif text-lg",children:"编目"})]}),e.jsx("nav",{className:"mt-8 space-y-1",children:z.map(a=>{const l=a.icon;return e.jsxs(y,{to:a.to,className:({isActive:d})=>r("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",d?"bg-accent text-foreground":"text-muted-foreground hover:text-foreground"),children:[e.jsx(l,{size:14}),a.label]},a.to)})}),e.jsxs("div",{className:"mt-auto space-y-2 px-3 text-sm",children:[e.jsx(h,{to:"/app",className:"block text-muted-foreground transition-colors hover:text-foreground",children:"我的工作台"}),e.jsx("button",{onClick:()=>void i(),className:"text-muted-foreground transition-colors hover:text-foreground",children:"退出"})]})]}),e.jsxs("main",{className:"min-w-0 flex-1 px-8 py-8",children:[e.jsx("div",{className:"mb-6 flex items-center justify-end",children:e.jsxs("span",{className:"flex items-center gap-2 font-mono text-xs text-muted-foreground",children:[e.jsx("span",{className:r("h-1.5 w-1.5 rounded-full",(c=n.data)!=null&&c.ok?"bg-emerald-400":"bg-white/20")}),(o=n.data)!=null&&o.ok?"healthy":"health unknown"]})}),e.jsx("p",{className:"sr-only",children:(t==null?void 0:t.name)||(t==null?void 0:t.phone)}),e.jsx(m,{})]})]})}export{H as default};
