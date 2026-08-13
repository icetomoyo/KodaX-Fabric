import{r as o,j as e,B as r,c as i}from"./index-Cg2OWzXI.js";import{C as n}from"./check-D0SIuWEr.js";import{c as p}from"./createLucideIcon-IhxO4hEC.js";/**
 * @license lucide-react v0.474.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const l=[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]],m=p("Copy",l);function y({value:t,className:a}){const[c,s]=o.useState(!1);return e.jsxs("span",{className:i("inline-flex items-center gap-1.5 font-mono",a),children:[e.jsx("span",{className:"truncate",children:t}),e.jsx(r,{type:"button",variant:"ghost",size:"icon",className:"h-6 w-6 shrink-0","aria-label":"复制",onClick:async()=>{try{await navigator.clipboard.writeText(t),s(!0),setTimeout(()=>s(!1),1500)}catch{}},children:c?e.jsx(n,{className:"h-3.5 w-3.5 text-emerald-400"}):e.jsx(m,{className:"h-3.5 w-3.5"})})]})}export{y as C};
