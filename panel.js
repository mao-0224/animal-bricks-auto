(function(){
  "use strict";
  if(window.__animalBricksPanel)return;
  window.__animalBricksPanel=true;
  const C=window.AnimalBricksCore;
  const audio=window.AnimalBricksAudio;
  const originalRAF=window.requestAnimationFrame.bind(window);
  let captureJob=null,captureFlight=null;
  // Capture after the game's render callback, before the WebGL buffer is cleared.
  window.requestAnimationFrame=function(callback){
    return originalRAF(time=>{
      try{return callback(time);}
      finally{if(captureJob)captureJob();}
    });
  };
  function gameCanvas(){
    return [...document.querySelectorAll("canvas")].filter(c=>c.width>100&&c.height>100)
      .sort((a,b)=>b.width*b.height-a.width*a.height)[0];
  }
  function capture(){
    if(captureFlight)return captureFlight;
    captureFlight=captureOnce().finally(()=>{captureFlight=null;});
    return captureFlight;
  }
  function captureOnce(){
    return new Promise((resolve,reject)=>{
      const source=gameCanvas();
      if(!source){reject(Error("游戏尚未加载"));return;}
      const target=document.createElement("canvas");
      target.width=Math.min(800,source.width);
      target.height=Math.round(source.height*target.width/source.width);
      const ctx=target.getContext("2d",{willReadFrequently:true});
      let attempts=0;
      const job=()=>{
        readFrame();
      };
      const timer=setTimeout(()=>{
        if(captureJob===job)captureJob=null;
        reject(Error("取帧超时"));
      },8000);
      const readFrame=()=>{
        try{
          ctx.drawImage(source,0,0,target.width,target.height);
          const im=ctx.getImageData(0,0,target.width,target.height);
          let bright=0,opaque=0;
          for(let i=0;i<im.data.length;i+=400){bright+=im.data[i]+im.data[i+1]+im.data[i+2];opaque+=im.data[i+3];}
          if((bright<im.data.length*.01||opaque<im.data.length*.01)&&attempts++<30)return;
          if(captureJob===job)captureJob=null;clearTimeout(timer);
          if(bright<im.data.length*.01){reject(Error("无法读取游戏画面"));return;}
          resolve(im);
        }catch(error){if(captureJob===job)captureJob=null;clearTimeout(timer);reject(error);}
      };
      captureJob=job;
      originalRAF(()=>{if(captureJob===job)job();});
    });
  }
  const KEY="animal-bricks-web-v2";
  let config=null,verified=false,running=false,policy=null,selection=null,deadline=0,actions=0;
  let runId=0;
  let recoveryAt=0,captureFailures=0,wakeLock=null;
  let transitioning=false,nextAttempts=0,nextClickAt=0,transitionUntil=0;
  let dialogClickAt=0,dialogName=null;
  let dialogAttempts=0;
  let restartAttempts=0,restartClickAt=0;
  const unlockFlow=new C.UnlockFlow();
  let certificateClickAt=0;
  let templates={},lastTemplate=0,retries=0,lastShape=null;
  let lastFrame=null,lastObservation=null,lastFrameAt=null;
  const history=[];
  function record(type,detail){
    history.push({time:new Date().toISOString(),type,...detail});
    if(history.length>120)history.shift();
  }
  function remember(im,o){
    lastFrame=im;lastFrameAt=new Date().toISOString();lastObservation=o;
  }
  try{
    const stored=JSON.parse(localStorage.getItem(KEY)||"null");
    if(stored){config=stored.config?.guards?stored.config:null;templates=stored.templates||{};}
  }catch{}
  let host,shadow,status,startButton,verifyButton,overlay,columns,hours,countText,tools;
  const icons=window.AnimalBricksIcons;
  const icon=name=>`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  const button=(id,name,title)=>`<button id="${id}" type="button" aria-label="${title}" title="${title}">${icon(name)}<span class="tip">${title}</span></button>`;
  function message(text){if(status)status.textContent=text;}
  function compact(value){
    const panel=shadow?.querySelector(".panel");
    if(!panel)return;
    panel.classList.toggle("compact",value);
    const toggle=shadow.getElementById("collapse");
    toggle.setAttribute("aria-expanded",String(!value));
    toggle.title=value?"展开搬砖助手":"隐藏搬砖助手";
  }
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({config,templates}));}catch{message("存储空间不足，本次定位仅临时保留");}}
  function stop(text="已暂停"){
    running=false;verified=false;runId++;
    audio?.setRunning(false);
    if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}
    record("stop",{reason:text});
    if(startButton){startButton.innerHTML=icon("play")+'<span class="tip">开始</span>';startButton.disabled=false;}
    message(text);
  }
  function cancelSelection(){selection=null;if(overlay)overlay.remove();overlay=null;}
  function clearMarks(){shadow.querySelectorAll(".mark").forEach(e=>e.remove());}
  function drawMarks(im,obs){
    clearMarks();
    const source=gameCanvas();if(!source)return;
    const rect=source.getBoundingClientRect();
    const add=(p,color,label)=>{
      const el=document.createElement("div");el.className="mark";el.textContent=label;
      el.style.cssText=`left:${rect.left+p[0]/im.width*rect.width}px;top:${rect.top+p[1]/im.height*rect.height}px;border-color:${color};color:${color}`;
      shadow.appendChild(el);
    };
    config.slots.forEach((p,i)=>add(p,obs.empty.includes(i)?"#147d43":"#c32d44",`${i+1}`));
    obs.boxes.forEach(b=>add(b.p,"#1759c4",`${obs.scores[b.label]}`));
  }
  async function locate(){
    stop();cancelSelection();clearMarks();
    const im=await capture();
    const n=Number(columns.value);
    try{config=C.automatic(im,n);}
    catch(error){
      if(!error.message.includes("列数不匹配"))throw error;
      config=C.automatic(im);
    }
    columns.value=String(config.columns);persist();
    const o=C.observe(im,config);drawMarks(im,o);
    message("定位完成 · 请确认标记");verifyButton.disabled=false;
  }
  const prompts=["砖区左上角","砖区右下角","砖区下方纯地面","第一个黑色空工位中心",
    "最后一个黑色空工位中心","前排第一个箱子中心","前排最后一个箱子中心","第二排第一个箱子中心"];
  function choose(prompts,done){
    stop();cancelSelection();clearMarks();
    const points=[];selection={prompts,points,done};
    overlay=document.createElement("div");overlay.className="picker";
    shadow.appendChild(overlay);message(`定位 1/${prompts.length} · ${prompts[0]}`);
    overlay.addEventListener("pointerdown",async event=>{
      event.preventDefault();event.stopPropagation();
      const source=gameCanvas();if(!source)return message("游戏尚未加载");
      const rect=source.getBoundingClientRect();
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)
        return message("请选游戏画面内的位置");
      const width=Math.min(800,source.width),height=Math.round(source.height*width/source.width);
      points.push([(event.clientX-rect.left)/rect.width*width,
        (event.clientY-rect.top)/rect.height*height]);
      if(points.length<prompts.length)message(`定位 ${points.length+1}/${prompts.length} · ${prompts[points.length]}`);
      else{
        cancelSelection();
        try{await done(points,await capture());}catch(error){message(error.message);}
      }
    });
  }
  function manual(){
    const n=Number(columns.value);
    const slotCount=config?.slots.length||5;
    choose(prompts,async (p,im)=>{
      config=C.finalize(im,{
        size:[im.width,im.height],columns:n,board:[...p[0],p[1][0]-p[0][0],p[1][1]-p[0][1]],
        ground:p[2],slots:Array.from({length:slotCount},(_,i)=>[
          p[3][0]+(p[4][0]-p[3][0])*i/(slotCount-1),p[3][1]+(p[4][1]-p[3][1])*i/(slotCount-1)]),
        first:p[5],pitch:[(p[6][0]-p[5][0])/(n-1),p[7][1]-p[5][1]],
        radius:Math.max(3,Math.round((p[4][0]-p[3][0])/(slotCount-1)*.13)),
      });
      persist();drawMarks(im,C.observe(im,config));
      message("定位完成 · 请确认标记");verifyButton.disabled=false;
    });
  }
  async function verify(){
    cancelSelection();stop();
    const im=await capture();
    if(C.nextLevel(im)){
      remember(im,null);verified=true;startButton.disabled=false;
      message("已确认下一关按钮");return;
    }
    let o=null;
    if(config){
      try{o=C.observe(im,config);}catch{}
    }
    if(!o||!C.canRun(o)){
      try{
        const candidate=C.automatic(im),observed=C.observe(im,candidate);
        if(C.canRun(observed)){
          config=candidate;o=observed;columns.value=String(candidate.columns);persist();
        }
      }catch{}
    }
    if(!config||!o)throw Error("请先定位");
    remember(im,o);
    drawMarks(im,o);
    if(!C.canRun(o))throw Error("当前画面无法运行，请等待或重新定位");
    verified=true;startButton.disabled=false;
    message(`已确认 · ${o.empty.length} 个空位 · ${o.boxes.length} 个前排箱子`);
  }
  async function tap(p,im,holdMs=250,active=()=>true,inputMode="mouse"){
    const source=gameCanvas(),rect=source.getBoundingClientRect();
    const x=rect.left+p[0]/im.width*rect.width,y=rect.top+p[1]/im.height*rect.height;
    if(x<0||y<0||x>innerWidth||y>innerHeight)throw Error("箱子不在可见范围");
    let hit=document.elementFromPoint(x,y);
    if(hit===host){
      const panel=shadow.querySelector(".panel"),bounds=panel.getBoundingClientRect();
      const corners=[
        [Math.max(8,innerWidth-bounds.width-8),8],
        [8,8],
        [Math.max(8,innerWidth-bounds.width-8),Math.max(8,innerHeight-bounds.height-8)],
        [8,Math.max(8,innerHeight-bounds.height-8)],
      ];
      const corner=corners.find(([left,top])=>
        x<left-8||x>left+bounds.width+8||y<top-8||y>top+bounds.height+8);
      if(corner){
        Object.assign(panel.style,{left:`${corner[0]}px`,top:`${corner[1]}px`,
          right:"auto",bottom:"auto"});
        record("panel-moved",{left:corner[0],top:corner[1]});
        hit=document.elementFromPoint(x,y);
      }
    }
    record("tap",{point:[...p],cssPoint:[x,y],imageSize:[im.width,im.height],
      canvasRect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},
      hitCanvas:hit===source,holdMs,settleMs:80,inputMode});
    if(hit!==source)throw Error("箱子被其他元素遮挡");
    const common={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,view:window};
    const touch={identifier:71,target:source,clientX:x,clientY:y,
      pageX:x+window.scrollX,pageY:y+window.scrollY,
      screenX:window.screenX+x,screenY:window.screenY+y};
    const sendTouch=(type,ended=false)=>{
      // The shipped Emscripten handler reads and annotates TouchList entries.
      const event=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperties(event,{
        touches:{value:ended?[]:[{...touch}]},
        targetTouches:{value:ended?[]:[{...touch}]},
        changedTouches:{value:[{...touch}]},
        ctrlKey:{value:false},shiftKey:{value:false},altKey:{value:false},metaKey:{value:false},
      });
      source.dispatchEvent(event);
      record("input",{event:type,point:[x,y],identifier:touch.identifier});
    };
    const pointer={pointerId:71,pointerType:"mouse",isPrimary:true};
    const EventType=inputMode==="pointer"?PointerEvent:MouseEvent;
    const prefix=inputMode==="pointer"?"pointer":"mouse";
    const send=(suffix,buttons)=>{
      source.dispatchEvent(new EventType(prefix+suffix,{...common,
        ...(inputMode==="pointer"?pointer:{}),buttons}));
      record("input",{event:prefix+suffix,buttons,point:[x,y]});
    };
    if(!source.hasAttribute("tabindex"))source.setAttribute("tabindex","-1");
    source.focus({preventScroll:true});
    record("focus",{canvas:document.activeElement===source,document:document.hasFocus()});
    if(inputMode!=="touch")send("move",0);
    // Let the engine consume the cursor position before polling the press.
    await new Promise(resolve=>setTimeout(resolve,80));
    if(!active())return;
    const current=source.getBoundingClientRect();
    if(Math.abs(current.left-rect.left)>2||Math.abs(current.top-rect.top)>2||
      Math.abs(current.width-rect.width)>2||Math.abs(current.height-rect.height)>2)
      throw Error("点击前页面位置改变，请重新确认");
    if(document.elementFromPoint(x,y)!==source)throw Error("箱子被其他元素遮挡");
    if(inputMode==="touch")sendTouch("touchstart");
    else send("down",1);
    try{
      await new Promise(resolve=>setTimeout(resolve,holdMs));
    }finally{
      if(inputMode==="touch")sendTouch("touchend",true);
      else send("up",0);
    }
  }
  async function loop(id){
    const active=()=>running&&runId===id;
    if(!active())return;
    let nextDelay=900;
    try{
      if(Date.now()>deadline)return stop("已达到运行时限");
      if(document.hidden){
        message("页面在后台 · 等待返回");
        setTimeout(()=>loop(id),2000);return;
      }
      const im=await capture();
      if(!active())return;
      captureFailures=0;
      remember(im,null);
      const shape=gameCanvas().getBoundingClientRect();
      if(lastShape&&(Math.abs(shape.width-lastShape.width)>2||Math.abs(shape.height-lastShape.height)>2)){
        recoveryAt=Date.now();policy=new C.Policy();lastShape=shape;
      }
      let matched=null;
      for(const name of ["stop","retry","start"]){
        const t=templates[name];
        if(t&&t.size[0]===im.width&&t.size[1]===im.height &&
          C.difference(C.patch(im,t.rect),t.pixels)<8){matched={name,t};break;}
      }
      const confirm=matched?.name==="stop"?null:C.certificateConfirm(im);
      const restart=matched?.name==="stop"?null:C.restartButton?.(im);
      if(restart){
        if(Date.now()-restartClickAt>=4000){
          if(restartAttempts>=3)return stop("重新开始按钮未响应 · 已停止重复点击");
          if(!restartAttempts&&typeof unlockFlow!=="undefined")unlockFlow.reset();
          clearMarks();await tap(restart,im,250,active,restartAttempts?"touch":"mouse");
          if(!active())return;
          restartClickAt=Date.now();restartAttempts++;actions++;retries++;
          policy=new C.Policy();transitioning=true;transitionUntil=Date.now()+20000;
          recoveryAt=Date.now()+2000;
          record("restart-attempt",{point:restart,attempt:restartAttempts});
        }
        message("已尝试重新开始 · 等待游戏画面确认");
        countText.textContent=`${actions} 次`;
        if(active())setTimeout(()=>loop(id),900);
        return;
      }
      restartAttempts=0;
      if(matched?.name!=="stop"&&typeof unlockFlow!=="undefined"){
        const get=C.getSlotButton(im),buttons=get?[]:C.unlockButtons(im);
        if(get||buttons.length||unlockFlow.pending){
          let current=config;
          if(!get){
            try{current=C.automatic(im);}catch{
              const restored=C.refreshSupply(im,config);
              current=C.extendSlots(im,restored||config)||config;
            }
          }
          const slots=current?.slots.length||5;
          const u=unlockFlow.decide({get,buttons,slots},Date.now());
          if(u.stop){record("unlock-failed",{reason:u.stop});return stop(u.stop);}
          if(!u.ready){
            if(current&&current!==config&&!get){
              config=current;columns.value=String(config.columns);persist();
              policy=new C.Policy();recoveryAt=0;lastShape=shape;
            }
            if(u.point){
              clearMarks();await tap(u.point,im,250,active,u.mode);
              if(!active())return;
              unlockFlow.clicked(u,slots,Date.now());actions++;
              record("unlock-attempt",{...u,slots});
            }
            if(u.confirmed){
              policy=new C.Policy();record("slot-added",{slots});
              message(`已确认 ${slots} 个工位 · 检查另一侧解锁`);
            }else message(u.wait|| (u.kind==="get"?"已尝试获取 · 等待槽位增加":"已尝试解锁 · 等待弹窗"));
            countText.textContent=`${actions} 次`;
            if(active())setTimeout(()=>loop(id),900);
            return;
          }
        }
      }
      if(confirm){
        if(Date.now()-certificateClickAt>=4000){
          clearMarks();await tap(confirm,im,250,active);
          if(!active())return;
          certificateClickAt=Date.now();actions++;policy=new C.Policy();
          if(typeof unlockFlow!=="undefined")unlockFlow.reset();
          transitioning=true;transitionUntil=Date.now()+20000;
          recoveryAt=Date.now()+2000;dialogName=null;
          record("certificate-confirm",{point:confirm});
        }
        message("已点击确定 · 等待新关卡加载");
        countText.textContent=`${actions} 次`;
        if(active())setTimeout(()=>loop(id),900);
        return;
      }
      const dialog=matched?.name==="stop"?null:C.failureDialog(im);
      if(dialog){
        if(dialog.name!==dialogName)dialogAttempts=0;
        if(dialog.name!==dialogName||Date.now()-dialogClickAt>=4000){
          if(dialogAttempts>=3){
            record("dialog-unresponsive",{name:dialog.name,attempts:dialogAttempts});
            return stop("弹窗未响应 · 已停止重复点击，尚未取消成功");
          }
          const close=dialog.name==="cancel"&&dialogAttempts===2?C.failureClose?.(im):null;
          const point=close||dialog.point,inputMode=dialogAttempts>=1?"touch":"mouse";
          clearMarks();await tap(point,im,250,active,inputMode);
          if(!active())return;
          dialogName=dialog.name;dialogClickAt=Date.now();actions++;dialogAttempts++;
          policy=new C.Policy();recoveryAt=Date.now()+2000;transitioning=false;
          record("failure-dialog",{name:dialog.name,point,attempt:dialogAttempts,inputMode,close:!!close});
        }
        message(dialog.name==="cancel"?"已尝试关闭复活 · 等待画面确认":"已尝试放弃挑战 · 等待画面确认");
        countText.textContent=`${actions} 次`;
        if(active())setTimeout(()=>loop(id),900);
        return;
      }
      if(dialogName)record("dialog-disappeared",{name:dialogName});
      dialogName=null;dialogAttempts=0;
      const next=matched?.name==="stop"?null:C.nextLevel(im);
      if(next){
        if(!transitioning){transitioning=true;nextAttempts=0;nextClickAt=0;if(typeof unlockFlow!=="undefined")unlockFlow.reset();}
        if(Date.now()-nextClickAt>=4000){
          if(nextAttempts>=3){
            nextAttempts=0;nextClickAt=Date.now()+26000;
            message("下一关暂未响应 · 自动等待重试");
            setTimeout(()=>loop(id),2000);return;
          }
          clearMarks();await tap(next,im,250,active,nextAttempts>=1?"touch":"mouse");
          if(!active())return;
          nextAttempts++;actions++;nextClickAt=Date.now();transitionUntil=Date.now()+20000;
          record("next-level",{point:next,attempt:nextAttempts});
        }
        message("已点击下一关 · 等待加载");
        countText.textContent=`${actions} 次`;
        if(active())setTimeout(()=>loop(id),900);
        return;
      }
      if(transitioning&&!matched){
        try{
          const restored=C.automatic(im);
          if(!C.canRun(C.observe(im,restored)))throw Error("新关卡尚未就绪");
          config=restored;persist();policy=new C.Policy();transitioning=false;recoveryAt=0;
          audio?.resume();
          columns.value=String(restored.columns);
          lastShape=shape;record("level-ready",{size:restored.size});
        }catch(error){
          if(Date.now()>transitionUntil)transitionUntil=Date.now()+20000;
          message("等待新关卡空位和箱子");
          if(active())setTimeout(()=>loop(id),900);
          return;
        }
      }
      if(!matched&&(!config||recoveryAt)){
        if(recoveryAt>Date.now()){
          message("等待游戏恢复 · 稍后自动继续");
          if(active())setTimeout(()=>loop(id),2000);return;
        }
        let restored=null;
        if(!restored){
          try{
            const c=C.automatic(im);
            if(C.canRun(C.observe(im,c)))restored=c;
          }catch{}
        }
        if(!restored)restored=C.refreshSupply?.(im,config)||null;
        if(restored){
          config=restored;columns.value=String(restored.columns);persist();
        }else{
          let valid=false;
          if(config){try{valid=C.canRun(C.observe(im,config));}catch{}}
          if(!valid){
            recoveryAt=Date.now()+3000;message("等待可识别游戏画面 · 自动定位中");
            if(active())setTimeout(()=>loop(id),2000);return;
          }
        }
        recoveryAt=0;policy=new C.Policy();lastShape=shape;
      }
      if(matched){
        if(matched.name==="stop")return stop("已到停止画面");
        if(Date.now()-lastTemplate>8000){
          await tap(matched.t.point,im,250,active);if(!active())return;lastTemplate=Date.now();actions++;
          if(matched.name==="retry")retries++;
          policy=new C.Policy();recoveryAt=Date.now()+2000;
        }
        message("已匹配录入按钮");
      }else{
        const o=C.observe(im,config),a=policy.decide(o,Date.now());
        lastObservation=o;
        record("decision",{empty:[...o.empty],boxes:o.boxes,scores:o.scores,
          guard:o.guard,count:o.count,action:a,
          pending:policy.pending?{col:policy.pending.col,empty:policy.pending.empty,
            until:policy.pending.until}:null});
        if(a.stop){
          record("recovery",{reason:a.stop});
          policy=new C.Policy();recoveryAt=Date.now()+20000;
          message(`${a.stop} · 自动等待恢复`);
          if(active())setTimeout(()=>loop(id),2000);return;
        }
        const detail=`空位 ${o.empty.length}/${o.slotCount||config.slots?.length||5} · 箱子 ${o.boxes.length}`;
        if(a.box){clearMarks();await tap(a.box.p,im,250,active,policy.failed>=1?"touch":"mouse");if(!active())return;policy.clicked(a.box,o,Date.now());actions++;message(`已尝试选箱 · ${detail}`);}
        else message(`${a.wait} · ${detail}`);
        if(a.wait==="箱子已入位")nextDelay=150;
      }
      countText.textContent=`${actions} 次`;
    }catch(error){
      if(active()){
        captureFailures++;
        record("recovery",{reason:error.message,attempt:captureFailures});
        message(`${error.message} · 自动重试 ${captureFailures}`);
        nextDelay=Math.min(10000,1000*2**Math.min(captureFailures,4));
        recoveryAt=recoveryAt||Date.now();
      }
    }
    if(active())setTimeout(()=>loop(id),captureFailures?nextDelay:policy?.pending?250:nextDelay);
  }
  async function start(){
    if(running){stop();return;}
    clearMarks();running=true;compact(true);audio?.setRunning(true);const id=++runId;policy=new C.Policy();actions=0;retries=0;
    recoveryAt=Date.now();captureFailures=0;
    transitioning=false;nextAttempts=0;nextClickAt=0;
    dialogName=null;dialogAttempts=0;dialogClickAt=0;
    restartAttempts=0;restartClickAt=0;
    unlockFlow.reset();
    deadline=Date.now()+Number(hours.value)*60000;lastShape=gameCanvas()?.getBoundingClientRect()||null;
    requestWakeLock(id);
    startButton.innerHTML=icon("pause")+'<span class="tip">暂停</span>';message("运行中");
    loop(id);
  }
  async function requestWakeLock(id){
    if(!navigator.wakeLock||document.hidden||wakeLock)return;
    try{
      const lock=await navigator.wakeLock.request("screen");
      if(!running||runId!==id){await lock.release();return;}
      wakeLock=lock;
      lock.addEventListener("release",()=>{if(wakeLock===lock)wakeLock=null;});
    }catch{}
  }
  function template(name){
    choose([`${name==="stop"?"停止画面":name==="retry"?"重试按钮":"开始按钮"}左上角`,"同一区域右下角"],
      async (p,im)=>{
        const rect=[...p[0],p[1][0]-p[0][0],p[1][1]-p[0][1]];
        if(rect[2]<12||rect[3]<12)throw Error("选择范围至少 12×12");
        const pixels=C.patch(im,rect),mean=pixels.reduce((s,v)=>s+v,0)/pixels.length;
        if(Math.sqrt(pixels.reduce((s,v)=>s+(v-mean)**2,0)/pixels.length)<12)
          throw Error("区域过于单一，请包含完整文字或图案");
        templates[name]={rect,pixels,point:[(p[0][0]+p[1][0])/2,(p[0][1]+p[1][1])/2],size:[im.width,im.height]};
        persist();message("画面已录入");tools.hidden=true;
      });
  }
  async function exportSettings(){
    let captureError=null;
    if(!running){
      try{
        const im=await capture();
        remember(im,null);
        if(config)lastObservation=C.observe(im,config);
      }catch(error){captureError=error.message;}
    }
    let image=null;
    if(lastFrame){
      const canvas=document.createElement("canvas");
      canvas.width=lastFrame.width;canvas.height=lastFrame.height;
      canvas.getContext("2d").putImageData(lastFrame,0,0);
      image=canvas.toDataURL("image/png");
    }
    const observation=lastObservation?{...lastObservation,signature:undefined,supply:undefined}:null;
    const diagnostic={version:"0.2.28",time:new Date().toISOString(),status:status.textContent,
      running,actions,frameTime:lastFrameAt,image,observation,captureError,history:[...history]};
    const url=URL.createObjectURL(new Blob([JSON.stringify({config,templates,diagnostic},null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download="animal-bricks-settings.json";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function mount(){
    if(!document.body)return setTimeout(mount,20);
    host=document.createElement("div");host.id="animal-bricks-assistant";
    host.style.cssText="position:fixed;inset:0;z-index:2147483646;pointer-events:none";
    shadow=host.attachShadow({mode:"open"});
    shadow.innerHTML=`<style>
      *{box-sizing:border-box;letter-spacing:0} .panel{position:fixed;left:8px;bottom:max(8px,env(safe-area-inset-bottom));width:272px;max-width:calc(100vw - 16px);background:#fff;color:#24272b;border:1px solid #bfc6cc;border-radius:6px;box-shadow:0 3px 16px #0003;font:13px system-ui,sans-serif;pointer-events:auto;padding:10px}
      header{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:650;margin-bottom:8px}
      .row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.settings{margin-top:8px}label{display:flex;gap:5px;align-items:center}
      button{position:relative;width:34px;height:36px;background:#f4f6f7;border:1px solid #c4ccd1;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;color:#25313a;cursor:pointer;flex:none}
      button:disabled{opacity:.35;cursor:default}#start{background:#16804a;color:white;border-color:#16804a}button:focus-visible,select:focus-visible{outline:2px solid #276fe0;outline-offset:2px}
      select{height:30px;font:inherit;color:inherit;background:white;border:1px solid #c4ccd1;border-radius:4px;max-width:100px}
      .tip{position:absolute;bottom:calc(100% + 6px);left:0;background:#24272b;color:white;padding:4px 7px;border-radius:3px;white-space:nowrap;display:none}
      button:hover .tip,button:focus-visible .tip{display:block}#status{margin-top:8px;line-height:1.5;overflow-wrap:anywhere;min-height:20px}.muted{font-size:12px;color:#63717a;font-weight:400}
      .picker{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;background:#0000000a;touch-action:none}
      .mark{position:fixed;width:24px;height:24px;transform:translate(-50%,-50%);border:2px solid;border-radius:50%;font:bold 11px system-ui;text-align:center;line-height:20px;background:#ffffffcf;pointer-events:none}
      .tools{display:flex;gap:4px;flex-direction:column;margin-top:8px}.tools[hidden]{display:none}.tools button{width:100%;justify-content:flex-start;padding:0 8px;gap:6px}.panel{z-index:2}
      .panel.compact{width:32px;max-width:32px;height:32px;padding:0;border:0;background:transparent;box-shadow:none;opacity:.18}
      .compact .body,.compact header>span{display:none}.compact header{margin:0;display:block}
      .compact #collapse{width:32px;height:32px;border:0;background:#ffffffb3}
      .compact:hover,.compact:focus-within{opacity:.85}
      @media(max-width:480px){.panel{width:244px;padding:8px;top:max(8px,env(safe-area-inset-top));bottom:auto}button{width:32px;height:34px}.row{gap:5px}.tip{bottom:auto;top:calc(100% + 6px)}}
    </style>
    <section class="panel compact"><header><span>搬砖助手 0.2.28</span><span id="count" class="muted">0 次</span>${button("collapse","chevron","展开搬砖助手")}</header>
      <div class="body"><div class="row">${button("locate","locate","自动定位")}${button("manual","hand","手动定位")}${button("verify","check","确认定位")}${button("start","play","开始或暂停")}${button("templates","image","画面设置")}${button("export","download","导出现场诊断")}</div>
      <div class="row settings"><label>箱子<select id="columns"><option value="3">3 列</option><option value="4">4 列</option><option value="5">5 列</option></select></label>
      <label>时限<select id="hours"><option value="1080">18 小时</option><option value="5">5 分钟</option><option value="30">30 分钟</option><option value="60">1 小时</option><option value="1440">24 小时</option></select></label></div>
      <div id="status" role="status" aria-live="polite">等待定位</div>
      <div class="tools" hidden><button id="t-start">录入开始按钮</button><button id="t-retry">录入重试按钮</button><button id="t-stop">录入停止画面</button><button id="t-clear">清除画面</button><button id="cancel">取消定位</button></div></div></section>`;
    document.body.appendChild(host);
    const get=id=>shadow.getElementById(id);
    status=get("status");startButton=get("start");verifyButton=get("verify");
    columns=get("columns");hours=get("hours");countText=get("count");tools=shadow.querySelector(".tools");
    startButton.disabled=false;verifyButton.disabled=!config;
    if(config){columns.value=String(config.columns);message("已恢复定位 · 等待确认");}
    const bind=(id,fn)=>get(id).addEventListener("click",()=>Promise.resolve().then(fn).catch(e=>{stop(e.message);}));
    bind("locate",locate);bind("manual",manual);bind("verify",verify);bind("start",start);
    compact(true);
    bind("collapse",()=>compact(!shadow.querySelector(".panel").classList.contains("compact")));
    bind("templates",()=>{tools.hidden=!tools.hidden;});
    bind("export",exportSettings);
    bind("t-start",()=>template("start"));bind("t-retry",()=>template("retry"));bind("t-stop",()=>template("stop"));
    bind("t-clear",()=>{templates={};persist();message("已清除画面");});
    bind("cancel",()=>{cancelSelection();stop("定位已取消");});
    columns.addEventListener("change",()=>{stop("列数改变，请重新定位");config=null;verifyButton.disabled=true;persist();clearMarks();});
    document.addEventListener("visibilitychange",()=>{if(!document.hidden&&running)requestWakeLock(runId);});
    document.addEventListener("pointerdown",e=>{
      if(e.isTrusted&&e.target===gameCanvas()){
        const r=e.target.getBoundingClientRect();
        record("manual-input",{cssPoint:[e.clientX,e.clientY],rect:{
          left:r.left,top:r.top,width:r.width,height:r.height},pointerType:e.pointerType});
        if(running)stop("手动操作，已暂停");
      }
    },true);
    window.addEventListener("resize",()=>{
      if(running){recoveryAt=Date.now();message("窗口变化 · 自动重新定位");}
      else stop("窗口变化");
      cancelSelection();clearMarks();
    });
    document.addEventListener("keydown",e=>{if(e.key==="Escape"){cancelSelection();stop("已暂停");}});
  }
  mount();
})();
