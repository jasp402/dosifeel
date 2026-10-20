import React,{useEffect,useRef} from 'react';
import{createRoot}from'react-dom/client';
import{gsap}from'gsap';
import{ScrollTrigger}from'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);
// React Bits AnimatedContent-inspired, adapted for DosiFeel with reduced-motion cleanup.
function AnimatedContent({children,distance=24,duration=.55,delay=0,className=''}) {
 const ref=useRef(null);
 useEffect(()=>{const el=ref.current;if(!el)return;const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;if(reduced)return;
 const ctx=gsap.context(()=>{gsap.fromTo(el,{autoAlpha:0,y:distance},{autoAlpha:1,y:0,duration,delay,ease:'power3.out',scrollTrigger:{trigger:el,start:'top 95%',once:true},clearProps:'transform,opacity,visibility'})},el);
 return()=>ctx.revert()},[distance,duration,delay]);
 return <div ref={ref} className={className}>{children}</div>
}
function CountUp({value=0}){const ref=useRef(null);
 useEffect(()=>{if(!ref.current)return;const end=Number(value)||0;ref.current.textContent=String(end);
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 let obj={v:0};const anim=gsap.to(obj,{v:end,duration:.85,ease:'power2.out',onUpdate:()=>{if(ref.current)ref.current.textContent=Math.round(obj.v).toLocaleString('es')}});return()=>anim.kill()},[value]);
 return <span ref={ref}>{value}</span>
}
function Progress({taken=0,total=0}){const ratio=total?Math.max(0,Math.min(100,taken/total*100)):0;return <AnimatedContent className="df-progress"><div className="df-progress-head"><div><span className="df-progress-caption">TU CONSTANCIA HOY</span><h3>{total===0?'Tu día, a tu ritmo':taken===total?'¡Objetivo completo!':'Cada toma cuenta'}</h3></div><div className="df-progress-counter"><CountUp value={taken}/><small> / {total}</small></div></div><div className="df-track" role="progressbar" aria-label="Cumplimiento de hoy" aria-valuenow={taken} aria-valuemin="0" aria-valuemax={total||1}><span style={{width:ratio+'%'}}/></div><p>{total===0?'Tus próximas tomas aparecerán cuando tengas productos asignados.':taken===total?'¡Muy bien! Hoy cumpliste lo programado.':'Ya has avanzado '+Math.round(ratio)+'% de tus tomas programadas.'}</p></AnimatedContent>}
const roots=new WeakMap();
export function mount(root,opts){if(!root)return;let r=roots.get(root);if(!r){r=createRoot(root);roots.set(root,r)}r.render(<Progress taken={Number(opts?.taken)||0} total={Number(opts?.total)||0}/>)}
window.DosiFeelBits={mount};
