import{r as e,j as n,B as l,n as c,f as u,k as f}from"./index-tNjrNcyx.js";const p=f`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.8;
  }
  100% {
    transform: scale(1);
    opacity: 0;
  }
`;function m({trigger:r,onComplete:t}){const[a,s]=e.useState(!1),o=e.useRef(t);return e.useEffect(()=>{o.current=t}),e.useEffect(()=>{if(!r){s(!1);return}s(!0);const i=setTimeout(()=>{s(!1),o.current?.()},1500);return()=>clearTimeout(i)},[r]),a?n.jsx(l,{sx:{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%, -50%)",width:80,height:80,borderRadius:"50%",bgcolor:c[900],display:"flex",alignItems:"center",justifyContent:"center",animation:`${p} 1.5s ease-out forwards`,zIndex:9999,pointerEvents:"none",boxShadow:`0 0 40px ${u(c[900],.4)}`},children:n.jsx(l,{component:"svg",viewBox:"0 0 24 24",sx:{width:40,height:40,color:"white"},children:n.jsx("path",{fill:"currentColor",d:"M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"})})}):null}function d(){const[r,t]=e.useState(!1),a=e.useCallback(()=>{t(!0)},[]),s=e.useCallback(()=>{t(!1)},[]);return{celebrating:r,celebrate:a,onComplete:s}}export{m as S,d as u};
