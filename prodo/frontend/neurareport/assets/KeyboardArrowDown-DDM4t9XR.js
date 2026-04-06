import{a8 as b,a9 as C,r as w,aa as k,j as h,ab as x,ac as S,N as R,at as $,bV as u,k as f,g as M}from"./index-tNjrNcyx.js";function U(t){return String(t).match(/[\d.\-+]*\s*(.*)/)[1]||""}function A(t){return parseFloat(t)}function j(t){return b("MuiSkeleton",t)}C("MuiSkeleton",["root","text","rectangular","rounded","circular","pulse","wave","withChildren","fitContent","heightAuto"]);const K=t=>{const{classes:e,variant:a,animation:n,hasChildren:s,width:i,height:o}=t;return S({root:["root",a,n,s&&"withChildren",s&&!i&&"fitContent",s&&!o&&"heightAuto"]},j,e)},r=f`
  0% {
    opacity: 1;
  }

  50% {
    opacity: 0.4;
  }

  100% {
    opacity: 1;
  }
`,l=f`
  0% {
    transform: translateX(-100%);
  }

  50% {
    /* +0.5s of delay between each loop */
    transform: translateX(100%);
  }

  100% {
    transform: translateX(100%);
  }
`,X=typeof r!="string"?u`
        animation: ${r} 2s ease-in-out 0.5s infinite;
      `:null,I=typeof l!="string"?u`
        &::after {
          animation: ${l} 2s linear 0.5s infinite;
        }
      `:null,N=R("span",{name:"MuiSkeleton",slot:"Root",overridesResolver:(t,e)=>{const{ownerState:a}=t;return[e.root,e[a.variant],a.animation!==!1&&e[a.animation],a.hasChildren&&e.withChildren,a.hasChildren&&!a.width&&e.fitContent,a.hasChildren&&!a.height&&e.heightAuto]}})($(({theme:t})=>{const e=U(t.shape.borderRadius)||"px",a=A(t.shape.borderRadius);return{display:"block",backgroundColor:t.vars?t.vars.palette.Skeleton.bg:t.alpha(t.palette.text.primary,t.palette.mode==="light"?.11:.13),height:"1.2em",variants:[{props:{variant:"text"},style:{marginTop:0,marginBottom:0,height:"auto",transformOrigin:"0 55%",transform:"scale(1, 0.60)",borderRadius:`${a}${e}/${Math.round(a/.6*10)/10}${e}`,"&:empty:before":{content:'"\\00a0"'}}},{props:{variant:"circular"},style:{borderRadius:"50%"}},{props:{variant:"rounded"},style:{borderRadius:(t.vars||t).shape.borderRadius}},{props:({ownerState:n})=>n.hasChildren,style:{"& > *":{visibility:"hidden"}}},{props:({ownerState:n})=>n.hasChildren&&!n.width,style:{maxWidth:"fit-content"}},{props:({ownerState:n})=>n.hasChildren&&!n.height,style:{height:"auto"}},{props:{animation:"pulse"},style:X||{animation:`${r} 2s ease-in-out 0.5s infinite`}},{props:{animation:"wave"},style:{position:"relative",overflow:"hidden",WebkitMaskImage:"-webkit-radial-gradient(white, black)","&::after":{background:`linear-gradient(
                90deg,
                transparent,
                ${(t.vars||t).palette.action.hover},
                transparent
              )`,content:'""',position:"absolute",transform:"translateX(-100%)",bottom:0,left:0,right:0,top:0}}},{props:{animation:"wave"},style:I||{"&::after":{animation:`${l} 2s linear 0.5s infinite`}}}]}})),D=w.forwardRef(function(e,a){const n=k({props:e,name:"MuiSkeleton"}),{animation:s="pulse",className:i,component:o="span",height:p,style:m,variant:g="text",width:y,...d}=n,c={...n,animation:s,component:o,variant:g,hasChildren:!!d.children},v=K(c);return h.jsx(N,{as:o,ref:a,className:x(v.root,i),ownerState:c,...d,style:{width:y,height:p,...m}})}),E=M(h.jsx("path",{d:"M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"}));export{E as K,D as S};
