// Petit moteur : run([[délai_ms, fonction], ...])
const $=s=>document.querySelector(s);
function cap(h){const c=$('.cap');c.classList.add('h');setTimeout(()=>{c.innerHTML=h;c.classList.remove('h')},300)}
function on(s){document.querySelectorAll(s).forEach(e=>e.classList.add('on'))}
function off(s){document.querySelectorAll(s).forEach(e=>e.classList.remove('on'))}
function run(steps){let t=0;for(const [d,f] of steps){t+=d;setTimeout(f,t)}}
