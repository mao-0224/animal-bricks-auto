(function(){
  "use strict";
  if(window.AnimalBricksAudio)return;
  const contexts=new Set(),pending=new Set(),attempts=new WeakMap();
  let running=false;
  for(const name of ["AudioContext","webkitAudioContext"]){
    const Native=window[name];
    if(!Native)continue;
    try{
      window[name]=new Proxy(Native,{construct(target,args,newTarget){
        const context=Reflect.construct(target,args,newTarget);
        contexts.add(context);
        context.addEventListener("statechange",()=>{
          if(context.state==="closed")contexts.delete(context);
        });
        return context;
      }});
    }catch{}
  }
  function resume(trusted=false){
    if(document.hidden)return;
    for(const context of contexts){
      if(context.state==="running"||context.state==="closed"||(!trusted&&pending.has(context)))continue;
      if(!trusted&&Date.now()-(attempts.get(context)||0)<5000)continue;
      attempts.set(context,Date.now());pending.add(context);
      try{
        Promise.resolve(context.resume()).catch(()=>{}).finally(()=>pending.delete(context));
      }catch{pending.delete(context);}
    }
  }
  window.AnimalBricksAudio={
    setRunning(value){running=value;if(value)resume();},
    resume,
    snapshot(){return [...contexts].map(c=>({state:c.state,sampleRate:c.sampleRate}));},
  };
  // Unlock using the user's existing gesture, not a synthetic game click.
  for(const event of ["pointerdown","keydown"])
    document.addEventListener(event,e=>{if(e.isTrusted)resume(true);},true);
  document.addEventListener("visibilitychange",()=>{if(running)resume();});
  setInterval(()=>{if(running)resume();},5000);
})();
