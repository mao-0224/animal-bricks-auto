(function (scope) {
  "use strict";
  const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  function lab(rgb) {
    const v = rgb.map(n => {
      n /= 255;
      return n > .04045 ? ((n + .055) / 1.055) ** 2.4 : n / 12.92;
    });
    const f = n => n > .008856 ? Math.cbrt(n) : 7.787 * n + 16 / 116;
    const x = f((v[0]*.4124 + v[1]*.3576 + v[2]*.1805) / .95047);
    const y = f(v[0]*.2126 + v[1]*.7152 + v[2]*.0722);
    const z = f((v[0]*.0193 + v[1]*.1192 + v[2]*.9505) / 1.08883);
    return [116*y-16, 500*(x-y), 200*(y-z)];
  }
  function pixel(im, x, y) {
    x = Math.max(0, Math.min(im.width - 1, Math.round(x)));
    y = Math.max(0, Math.min(im.height - 1, Math.round(y)));
    const i = (y*im.width+x)*4;
    return [im.data[i], im.data[i+1], im.data[i+2]];
  }
  function sample(im, p, radius = 3) {
    const values = [[], [], []];
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      const c = pixel(im, p[0]+x, p[1]+y);
      c.forEach((n, i) => values[i].push(n));
    }
    return values.map(a => a.sort((a,b) => a-b)[Math.floor(a.length/2)]);
  }
  function patch(im, rect) {
    const [x, y, w, h] = rect.map(Math.round);
    const out = [];
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++)
      out.push(...pixel(im, x+xx, y+yy));
    return out;
  }
  function difference(a, b) {
    if (!a || a.length !== b.length) return Infinity;
    return a.reduce((s, v, i) => s + Math.abs(v-b[i]), 0)/a.length;
  }
  function components(im, predicate, erosion=0) {
    const w = im.width, h = im.height, mask = new Uint8Array(w*h);
    for (let i = 0; i < mask.length; i++) {
      const k=i*4;
      mask[i] = predicate(im.data[k], im.data[k+1], im.data[k+2]) ? 1 : 0;
    }
    if(erosion){
      const original=mask.slice();
      for(let y=erosion;y<h-erosion;y++)for(let x=erosion;x<w-erosion;x++){
        const i=y*w+x;
        if(original[i]&&(!original[i-erosion]||!original[i+erosion]||
          !original[i-erosion*w]||!original[i+erosion*w])) mask[i]=0;
      }
    }
    const results = [], stack = [];
    for (let i=0; i<mask.length; i++) {
      if (!mask[i]) continue;
      mask[i]=0; stack.push(i);
      let minx=w, maxx=0, miny=h, maxy=0, area=0;
      while (stack.length) {
        const n=stack.pop(), x=n%w, y=Math.floor(n/w);
        area++; minx=Math.min(minx,x); maxx=Math.max(maxx,x);
        miny=Math.min(miny,y); maxy=Math.max(maxy,y);
        for (const next of [x>0?n-1:-1, x<w-1?n+1:-1, y>0?n-w:-1, y<h-1?n+w:-1]) {
          if (next>=0 && mask[next]) {mask[next]=0; stack.push(next);}
        }
      }
      if (area>8) results.push({x:minx,y:miny,w:maxx-minx+1,h:maxy-miny+1,area});
    }
    return results;
  }
  function automatic(im, columns) {
    const dark = components(im, (r,g,b) => Math.max(r,g,b)<70,3);
    const candidates = dark.filter(c => c.w>12 && c.h>12 && c.w/c.h>.5 &&
      c.w/c.h<1.8 && c.area/(c.w*c.h)>.45 && c.y>im.height*.45);
    let slots;
    for (const first of candidates) {
      const row=candidates.filter(c => Math.abs(c.y-first.y)<first.h*.3 &&
        Math.abs(c.h-first.h)<first.h*.4).sort((a,b)=>a.x-b.x);
      for(const n of [7,6,5])for(let j=0;j<=row.length-n;j++) {
        const group=row.slice(j,j+n), pitch=(group.at(-1).x-group[0].x)/(n-1);
        if((!slots||n>slots.length)&&group.every((c,i)=>
          Math.abs(c.x-group[0].x-i*pitch)<pitch*.2))slots=group;
      }
    }
    if (!slots) throw Error("未找到完整的 5 至 7 个空工位，请等待箱子耗尽或使用手动定位");
    const slotY=slots[0].y, slotH=slots[0].h;
    const blue=components(im,(r,g,b)=>b>r+25 && b>g+8 && b>80);
    const bases=blue.filter(c=>c.y>slotY+slotH && c.w>slots[0].w*.35 &&
      c.h<c.w*1.1 && c.x>slots[0].x-slots[0].w &&
      c.x<slots.at(-1).x+slots.at(-1).w).sort((a,b)=>a.y-b.y);
    let row=bases.length?bases.filter(c=>Math.abs(c.y-bases[0].y)<slotH*.3).sort((a,b)=>a.x-b.x):[];
    // Blue box faces join their bases; horizontal base strips stay separated.
    const slotPitch=(slots.at(-1).x-slots[0].x)/(slots.length-1);
    let strip=null;
    for(let yy=Math.round(slotY+slotH+slotPitch*.8);
      yy<Math.min(im.height,slotY+slotH+slotPitch*1.8);yy++){
      const runs=[];let start=-1;
      const left=Math.max(0,Math.floor(slots[0].x)),right=Math.min(im.width-1,slots.at(-1).x+slots.at(-1).w);
      for(let xx=left;xx<=right;xx++){
        const [r,g,b]=pixel(im,xx,yy),isBlue=b>r+25&&b>g+8&&b>80;
        if(isBlue&&start<0)start=xx;
        if((!isBlue||xx===right)&&start>=0){
          if(xx-start>slotPitch*.5)runs.push({x:start,y:yy,w:xx-start,h:1});
          start=-1;
        }
      }
      if(runs.length<3||runs.length>5)continue;
      const pitch=(runs.at(-1).x-runs[0].x)/(runs.length-1);
      if(!runs.every((r,i)=>Math.abs(r.x-runs[0].x-i*pitch)<pitch*.12))continue;
      // Use the top of the base, not its wider lower bevel.
      if(runs.some(r=>r.w<slotPitch*.65))continue;
      if(!strip||runs.length>strip.runs.length)strip={runs};
    }
    if(strip&&strip.runs.length>row.length)row=strip.runs;
    if(!row.length)throw Error("未找到箱子底部，请使用手动定位");
    if(columns&&row.length!==columns) throw Error("箱子列数不匹配，请选择正确列数");
    columns=row.length;
    const pitch=(row.at(-1).x-row[0].x)/(columns-1);
    const next=row[0].h===1?null:bases.find(c=>c.y>row[0].y+slotH*.55);
    const dy=next ? next.y-row[0].y : pitch*1.08;
    const rails=[];
    for(let x=0;x<im.width;x++){
      let first=-1,last=-1,total=0;
      for(let y=0;y<slotY*.8;y++){
        const [r,g,b]=pixel(im,x,y);
        const colored=(b>r+20&&b>g)||(g>r+12&&g>b+6);
        if(colored){if(first<0)first=y;last=y;total++;}
      }
      if(total>slotY*.35&&first<slotY*.3){
        const best={x,y:first,w:1,h:last-first+1};
        const previous=rails.at(-1);
        if(previous&&previous.x+previous.w===x){previous.w++;previous.h=Math.min(previous.h,best.h);}
        else rails.push(best);
      }
    }
    const left=rails.find(c=>c.x<row[0].x);
    const right=[...rails].reverse().find(c=>c.x>row.at(-1).x);
    if(!left||!right) throw Error("砖区边界未找到，请使用手动定位");
    const x=left.x+left.w, y=Math.min(left.y,right.y)+8;
    const bottom=Math.min(left.y+left.h,right.y+right.h)-8;
    const config={
      size:[im.width,im.height], columns,
      slots:slots.map(c=>[c.x+c.w/2,c.y+c.h/2]), radius:Math.max(3,Math.round(slotH*.13)),
      first:[row[0].x+row[0].w/2,row[0].y-dy*.36],
      pitch:[pitch,dy], board:[x,y,right.x-x,bottom-y],
      ground:[right.x+right.w+12, bottom],
    };
    return finalize(im,config);
  }
  function finalize(im, config) {
    const [w,h]=config.size;
    const inside=p=>p[0]>=0&&p[1]>=0&&p[0]<w&&p[1]<h;
    if (!config.slots.every(inside)||!inside(config.first)||!inside(config.ground))
      throw Error("定位点超出游戏画面");
    if(config.pitch.some(n=>n<10)) throw Error("箱子间距太小");
    const [x,y,bw,bh]=config.board;
    if(x<0||y<0||bw<20||bh<20||x+bw>w||y+bh>h) throw Error("砖区范围无效");
    config.background=sample(im,config.ground);
    config.empty=config.slots.map(p=>patch(im,[p[0]-config.radius,p[1]-config.radius,
      config.radius*2+1,config.radius*2+1]));
    if(config.empty.some(a=>a.reduce((s,v)=>s+v,0)/a.length>85))
      throw Error("工位不是全空，请等待后重新定位");
    // Sample fixed rims, not brick-side ground that changes with board art.
    const slotPitch=(config.slots.at(-1)[0]-config.slots[0][0])/(config.slots.length-1);
    const positions=config.slots.map(p=>[p[0]+slotPitch*.43,p[1]+slotPitch*.35]);
    positions.push([Math.max(5,config.slots[0][0]-slotPitch*.7),config.slots[0][1]],
      [Math.min(w-6,config.slots.at(-1)[0]+slotPitch*.7),config.slots.at(-1)[1]]);
    config.guards=positions.map(p=>{
      const rect=[Math.round(p[0])-2,Math.round(p[1])-2,5,5];
      return {rect,pixels:patch(im,rect)};
    });
    delete config.guardRect;
    delete config.guard;
    return config;
  }
  function observe(im,c) {
    if(im.width!==c.size[0]||im.height!==c.size[1]) throw Error("画面尺寸改变，请重新定位");
    const empty=c.slots.map((p,i)=>difference(patch(im,[p[0]-c.radius,p[1]-c.radius,
      c.radius*2+1,c.radius*2+1]),c.empty[i])<20 ? i : -1).filter(i=>i>=0);
    const palette=[],boxes=[];
    const supply=Array.from({length:c.columns},(_,col)=>{
      const p=[c.first[0]+col*c.pitch[0],c.first[1]];
      const w=Math.max(8,Math.round(c.pitch[0]*.48));
      const h=Math.max(8,Math.round(c.pitch[1]*.48));
      return patch(im,[p[0]-w/2,p[1]-h/2,w,h]);
    });
    for(let row=0;row<2;row++) for(let col=0;col<c.columns;col++) {
      const p=[c.first[0]+col*c.pitch[0],c.first[1]+row*c.pitch[1]];
      if(p[1]+c.pitch[1]*.47>=im.height) continue;
      const base=sample(im,[p[0],p[1]+c.pitch[1]*.45],2);
      if(!(base[2]>base[0]+20 && base[2]>base[1]+8)) continue;
      // The side edge is shaded. Read the face header above the numeral.
      const color=sample(im,[p[0],p[1]-c.pitch[1]*.32],2);
      const l=lab(color);
      let label=palette.findIndex(q=>distance(q.lab,l)<14);
      if(label<0){label=palette.length;palette.push({lab:l,color});}
      if(row===0) boxes.push({p,col,label,color});
    }
    const scores=palette.map(()=>0), bg=lab(c.background);
    const [bx,by,bw,bh]=c.board, step=Math.max(2,Math.round(bw/160));
    let count=0;
    // Repeated brick colors share the same Lab conversion and palette match.
    const matches=new Map();
    const classify=rgb=>{
      const key=(rgb[0]<<16)|(rgb[1]<<8)|rgb[2];
      if(matches.has(key))return matches.get(key);
      const l=lab(rgb);
      let best=-1,d=18;
      if(distance(l,bg)>=12)
        palette.forEach((p,i)=>{const n=distance(l,p.lab);if(n<d){d=n;best=i;}});
      const result={label:best,lab:l};
      matches.set(key,result);return result;
    };
    const signature=[];
    for(let x=bx;x<bx+bw;x+=step) {
      const localGround=lab(sample(im,[x,by+bh+8],2));
      let bottom=-1,run=0;
      for(let y=by+bh-1;y>=by;y-=step) {
        const result=classify(pixel(im,x,y)),best=result.label;
        const occupied=distance(result.lab,localGround)>=18;
        // Unavailable colors still block the matching colors above them.
        run=occupied?run+1:0;
        if(bottom<0&&run>=3)bottom=y+step*2;
        if(best>=0) {
          count++;
          if(bottom>=0&&bottom-y<Math.max(8,bw/24)) scores[best]++;
        }
      }
    }
    for(let y=by;y<by+bh;y+=Math.max(1,bh/20))
      for(let x=bx;x<bx+bw;x+=Math.max(1,bw/20)) signature.push(...pixel(im,x,y));
    const stable=c.guards ? c.guards.filter(g=>difference(patch(im,g.rect),g.pixels)<18).length : 0;
    return {empty,boxes,scores,count,signature,supply,slotCount:c.slots.length,
      guard:!!c.guards&&stable>=Math.ceil(c.guards.length*.7)};
  }
  class Policy {
    constructor(){this.pending=null;this.blocked={};this.failed=0;this.change=0;this.last=null;this.bad=0;this.blank=0;}
    decide(o,now) {
      if(!this.last||difference(this.last,o.signature)>1.2)this.change=now;
      this.last=o.signature;
      this.bad=o.guard?0:this.bad+1;
      if(this.bad>=2)return {stop:"画面被遮挡或已变化"};
      if(!o.guard)return {wait:"等待画面"};
      this.blank=o.count<1&&o.empty.length===(o.slotCount||5)?this.blank+1:0;
      if(this.blank>=5)return {stop:"砖区结束或无法识别"};
      if(now-this.change>120000)return {stop:"两分钟没有搬砖进展"};
      if(this.pending){
        const p=this.pending;
        const current=o.supply?.[p.col];
        const sourceChanged=p.source&&current&&difference(p.source,current)>12;
        const sourceSettled=sourceChanged&&p.previous&&difference(p.previous,current)<3;
        p.previous=sourceChanged?[...current]:null;
        // A different box can run out while the selected box fills a slot.
        if(p.empty.some(i=>!o.empty.includes(i))||sourceSettled){
          this.pending=null;this.failed=0;delete this.blocked[p.col];return {wait:"箱子已入位"};
        }
        if(now<p.until)return {wait:"确认箱子入位"};
        this.blocked[p.col]=now+12000;this.pending=null;this.failed++;
        if(this.failed>=3)return {stop:"点击未生效，请手动确认"};
        return {wait:"未确认入位"};
      }
      if(!o.empty.length)return {wait:"工位已满，等待消耗"};
      // Fill every available slot; demand only sets the order of placement.
      const b=o.boxes.filter(b=>!(this.blocked[b.col]>now))
        .sort((a,b)=>(o.scores[b.label]||0)-(o.scores[a.label]||0))[0];
      return b?{box:b}:{wait:o.boxes.length?"等待箱子冷却":"等待可用箱子"};
    }
    clicked(b,o,now){
      this.pending={col:b.col,empty:[...o.empty],until:now+5000,
        source:o.supply?.[b.col]?[...o.supply[b.col]]:null,previous:null};
      this.blocked[b.col]=now+1500;
    }
  }
  function canRun(o){
    return !!o.guard&&(!o.empty.length||(o.boxes.length>0&&o.count>0));
  }
  function refreshSupply(im,previous){
    if(!previous?.guards)return null;
    const sx=im.width/previous.size[0],sy=im.height/previous.size[1];
    const point=p=>[p[0]*sx,p[1]*sy];
    const c={...previous,size:[im.width,im.height],slots:previous.slots.map(point),
      first:point(previous.first),pitch:point(previous.pitch),
      board:[previous.board[0]*sx,previous.board[1]*sy,previous.board[2]*sx,previous.board[3]*sy],
      ground:point(previous.ground),
      guards:previous.guards.map(g=>({...g,rect:[
        (g.rect[0]+2)*sx-2,(g.rect[1]+2)*sy-2,5,5]}))};
    // Keep recorded empty/rim colors; never learn occupied slots as empty.
    if(!observe(im,c).guard)return null;
    const pitch=(c.slots.at(-1)[0]-c.slots[0][0])/(c.slots.length-1);
    let best=null;
    for(let y=Math.round(c.slots[0][1]+pitch*1.1);
      y<Math.min(im.height,c.slots[0][1]+pitch*2.1);y++){
      const runs=[];let start=-1;
      const left=Math.max(0,Math.floor(c.slots[0][0]-pitch*.5));
      const right=Math.min(im.width-1,Math.ceil(c.slots.at(-1)[0]+pitch*.5));
      for(let x=left;x<=right;x++){
        const [r,g,b]=pixel(im,x,y),blue=b>r+25&&b>g+8&&b>80;
        if(blue&&start<0)start=x;
        if((!blue||x===right)&&start>=0){
          if(x-start>=pitch*.65)runs.push({x:start,w:x-start});
          start=-1;
        }
      }
      if(runs.length<3||runs.length>5)continue;
      const dx=(runs.at(-1).x-runs[0].x)/(runs.length-1);
      if(!runs.every((r,i)=>Math.abs(r.x-runs[0].x-i*dx)<dx*.12))continue;
      if(!best||runs.length>best.runs.length)best={runs,y,dx};
    }
    if(!best)return null;
    if(best.runs.length!==c.columns){
      c.columns=best.runs.length;
      c.pitch=[best.dx,best.dx*1.08];
      c.first=[best.runs[0].x+best.runs[0].w/2,best.y-c.pitch[1]*.36];
    }
    return canRun(observe(im,c))?c:null;
  }
  const nextGlyph=[
    "011111111000000000000100010",
    "000010000000000000000100100",
    "000010000000000000001111111",
    "000011100011111111000001000",
    "000010110011111111011111111",
    "000010000000000000000011000",
    "000010000000000000000110100",
    "000010000000000000001100011",
    "000010000000000000000000000",
  ];
  function nextLevel(im){
    const candidates=components(im,(r,g,b)=>r>225&&g>225&&b>225)
      .filter(c=>c.y>im.height*.6&&c.w>im.width*.12&&c.w/c.h>3.2&&c.w/c.h<4.4);
    for(const c of candidates){
      for(const sx of [-.5,0,.5])for(const sy of [-.5,0,.5]){
      let overlap=0,expected=0,actual=0;
      for(let y=0;y<9;y++)for(let x=0;x<27;x++){
        const dark=pixel(im,c.x+(x+18.5+sx)*c.w/64,c.y+(y+5.5+sy)*c.h/18)[0]<120;
        const target=nextGlyph[y][x]==="1";
        if(dark)actual++;if(target)expected++;if(dark&&target)overlap++;
      }
      if(overlap/expected>.68&&overlap/Math.max(1,actual)>.68)
        return [c.x+c.w/2,c.y+c.h/2];
      }
    }
    return null;
  }
  const cancelMask=[
    "000000000000000001011110000100100000000000000000",
    "000000000000000001111000000000000000000000000000",
    "000000000000000001010010010100100000000000000000",
    "000000000000000001110110000111100000000000000000",
    "000000000000000001010100000100100000000000000000",
    "000000000000000011110110010100100000000000000000",
    "000000000000000000011010000100100000000000000000",
  ];
  const abandonMask=[
    "000000000001001000001000010100000001000000000000",
    "000000000000001001111110010100000001000000000000",
    "000000000001000100010100110100000001000000000000",
    "000000000001111100111010010100000001000000000000",
    "000000000001001100010100110101000000000000000000",
    "000000000000100000010100011100000000100000000000",
    "000000000000101100100100010000101101110000000000",
  ];
  function failureDialog(im){
    const red=(r,g,b)=>r>180&&g<80&&b<80;
    const revive=components(im,red).filter(c=>c.w>im.width*.15&&c.w/c.h>3.3&&c.w/c.h<4.5);
    if(!revive.length)return null;
    for(const [name,mask,predicate,offset] of [
      ["cancel",cancelMask,(r,g,b)=>r>235&&g>235&&b>235,4],
      ["abandon",abandonMask,(r,g,b)=>r<30&&g<30&&b<30,3],
    ]){
      const candidates=components(im,predicate).filter(c=>c.y>im.height*.6&&
        c.w>im.width*.15&&c.w/c.h>3.2&&c.w/c.h<4.5);
      for(const c of candidates){
        if(!revive.some(r=>Math.abs(r.x+r.w/2-c.x-c.w/2)<c.w*.08&&
          c.y-r.y>c.h*1.1&&c.y-r.y<c.h*2.2))continue;
        const inset=name==="abandon";
        const x=c.x+(inset?c.w*.015:0),y=c.y+(inset?c.h*.054:0);
        const w=c.w*(inset?.97:1),h=c.h*(inset?.882:1);
        for(const sx of [-.5,0,.5])for(const sy of [-.4,0,.4]){
          let expected=0,actual=0,overlap=0;
          for(let yy=0;yy<7;yy++)for(let xx=0;xx<48;xx++){
            const rgb=pixel(im,x+(xx+.5+sx)*w/48,y+(yy+offset+.5+sy)*h/14);
            const value=inset?rgb[0]>110&&rgb[0]>rgb[1]*1.8&&rgb[0]>rgb[2]*1.8:Math.max(...rgb)<100;
            const target=mask[yy][xx]==="1";
            if(value)actual++;if(target)expected++;if(value&&target)overlap++;
          }
          if(overlap/expected>.55&&overlap/Math.max(1,actual)>.55)
            return {name,point:[c.x+c.w/2,c.y+c.h/2]};
        }
      }
    }
    return null;
  }
  function failureClose(im){
    if(failureDialog(im)?.name!=="cancel")return null;
    const whites=components(im,(r,g,b)=>r>235&&g>235&&b>235);
    const sheet=whites.find(c=>c.h>im.height*.4&&c.w>im.width*.25&&
      c.y<im.height*.4&&c.h/c.w>1.2&&c.area>c.w*c.h*.4);
    if(!sheet)return null;
    for(const c of components(im,(r,g,b)=>r>170&&g>170&&b>170)){
      if(c.w<5||c.h<5||c.w>sheet.w*.1||c.h>sheet.w*.1||
        Math.abs(c.x+c.w/2-sheet.x-sheet.w)>sheet.w*.06||
        Math.abs(c.y+c.h/2-sheet.y)>sheet.w*.07)continue;
      let diagonals=0;
      for(const t of [.15,.3,.5,.7,.85])
        for(const x of [t,1-t]){
          const rgb=pixel(im,c.x+x*(c.w-1),c.y+t*(c.h-1));
          if(Math.min(...rgb)>170)diagonals++;
        }
      const p=[c.x+c.w/2,c.y+c.h/2];
      if(diagonals>=7&&Math.max(...pixel(im,p[0]-c.w*.8,p[1]))<70)return p;
    }
    return null;
  }
  const certificateMask=[
    "0000000000000011000000010000000000000000",
    "0000000000000010111001111100000000000000",
    "0000000000000010111000000100000000000000",
    "0000000000000011100000010000000000000000",
    "0000000000000011111001010000000000000000",
    "0000000000000011111001011000000000000000",
    "0000000000000011100000010000000000000000",
    "0000000000000010001010111100000000000000",
  ];
  function certificateConfirm(im){
    const whites=components(im,(r,g,b)=>r>235&&g>235&&b>235);
    const sheets=whites.filter(c=>c.y<im.height*.4&&c.h>im.height*.3&&c.h/c.w>1.1);
    if(!sheets.length)return null;
    const candidates=whites.filter(c=>c.y>im.height*.8&&c.w>im.width*.12&&
      c.w/c.h>3.2&&c.w/c.h<4.5);
    for(const c of candidates){
      if(!sheets.some(s=>Math.abs(s.x+s.w/2-c.x-c.w/2)<s.w*.15&&s.y+s.h<c.y))continue;
      // A certificate has a black backdrop; ordinary gameplay buttons do not.
      if(Math.max(...sample(im,[c.x+c.w/2,c.y-c.h*.45],2))>55)continue;
      for(const sx of [-.4,0,.4])for(const sy of [-.3,0,.3]){
        let expected=0,actual=0,overlap=0;
        for(let y=0;y<8;y++)for(let x=0;x<40;x++){
          const dark=Math.max(...pixel(im,c.x+(x+.5+sx)*c.w/40,
            c.y+(y+3.5+sy)*c.h/14))<110;
          const target=certificateMask[y][x]==="1";
          if(dark)actual++;if(target)expected++;if(dark&&target)overlap++;
        }
        if(overlap/expected>.56&&overlap/Math.max(1,actual)>.56)
          return [c.x+c.w/2,c.y+c.h/2];
      }
    }
    return null;
  }
  const restartMask=[
    "0000000000000000000000000000000000000000",
    "0000000000111000000000000000010000000000",
    "0000000000000001110000000000000000000000",
    "0000000000000000010000000011001000000000",
    "0000000001000011111100000011111000000000",
    "0000000001000011110001000011111000000000",
    "0000000000000000110001000001101000000000",
    "0000000000000000010001000001101000000000",
    "0000000001111101000010000010111000000000",
    "0000000000000000000000000000000000000000",
  ];
  function restartButton(im){
    const red=components(im,(r,g,b)=>r>200&&g<60&&b<60);
    const title=red.filter(c=>c.y<im.height*.25&&c.h>im.height*.03);
    if(title.length<4||Math.max(...title.map(c=>c.x+c.w))-Math.min(...title.map(c=>c.x))<im.width*.2)return null;
    const whites=components(im,(r,g,b)=>r>220&&g>220&&b>220);
    for(const c of red.filter(c=>c.y>im.height*.65&&c.w>im.width*.15&&c.w/c.h>3.2&&c.w/c.h<4.4)){
      if(!whites.some(w=>Math.abs(w.x+w.w/2-c.x-c.w/2)<c.w*.08&&
        w.y>c.y+c.h*1.1&&w.y<c.y+c.h*2.6&&Math.abs(w.w-c.w)<c.w*.1))continue;
      for(const sx of [-.3,0,.3])for(const sy of [-.3,0,.3]){
        let expected=0,actual=0,overlap=0;
        for(let y=0;y<10;y++)for(let x=0;x<40;x++){
          const bright=Math.min(...pixel(im,c.x+(x+.5+sx)*c.w/40,c.y+(y+3.5+sy)*c.h/16))>180;
          const target=restartMask[y][x]==="1";
          if(bright)actual++;if(target)expected++;if(bright&&target)overlap++;
        }
        if(overlap/expected>.6&&overlap/Math.max(1,actual)>.6)return [c.x+c.w/2,c.y+c.h/2];
      }
    }
    return null;
  }
  const getSlotMask=[
    "00001111000000000000110000000000",
    "00011111000000000000111100000000",
    "00011111100000010010110000000000",
    "00011011100000010000110000000000",
    "00011001100000000000110100000000",
    "00011011100000010100110100000000",
    "00011111000000000010010100000000",
    "00001111000000010000010000000000",
  ];
  function getSlotButton(im){
    const plus=components(im,(r,g,b)=>g>180&&r<70&&b<70).filter(c=>
      c.y<im.height*.5&&c.w>im.width*.035&&c.h>im.width*.035&&
      c.w/c.h>.7&&c.w/c.h<1.3);
    if(!plus.length)return null;
    const red=components(im,(r,g,b)=>r>200&&g<60&&b<60)
      .filter(c=>c.y>im.height*.55&&c.w>im.width*.15&&c.w/c.h>3.2&&c.w/c.h<4.5);
    const white=components(im,(r,g,b)=>r>225&&g>225&&b>225);
    for(const c of red){
      if(!plus.some(p=>Math.abs(p.x+p.w/2-c.x-c.w/2)<c.w*.15)||
        !white.some(w=>w.y>c.y+c.h*1.1&&w.y<c.y+c.h*2.4&&
          Math.abs(w.x+w.w/2-c.x-c.w/2)<c.w*.1&&Math.abs(w.w-c.w)<c.w*.1))continue;
      for(const sx of [-.4,0,.4])for(const sy of [-.3,0,.3]){
        let expected=0,actual=0,overlap=0;
        for(let y=0;y<8;y++)for(let x=0;x<32;x++){
          const v=Math.min(...pixel(im,c.x+(x+.5+sx)*c.w/32,c.y+(y+3.5+sy)*c.h/14))>180;
          const target=getSlotMask[y][x]==="1";
          if(v)actual++;if(target)expected++;if(v&&target)overlap++;
        }
        if(overlap/expected>.65&&overlap/Math.max(1,actual)>.65)return [c.x+c.w/2,c.y+c.h/2];
      }
    }
    return null;
  }
  function unlockButtons(im){
    const gold=components(im,(r,g,b)=>r>170&&g>100&&g<210&&b<135)
      .filter(c=>c.y>im.height*.5&&c.y<im.height*.87&&c.w>im.width*.045&&
        c.w<im.width*.15&&c.w/c.h>.8&&c.w/c.h<1.15&&c.area/(c.w*c.h)>.4);
    // Require the white video glyph inside the gold, striped unlock tile.
    return gold.filter(c=>{
      let total=0,white=0;
      for(let y=c.y+c.h*.13;y<c.y+c.h*.5;y+=2)
        for(let x=c.x+c.w*.23;x<c.x+c.w*.77;x+=2){
          total++;if(Math.min(...pixel(im,x,y))>225)white++;
        }
      return white/total>.4;
    }).sort((a,b)=>a.x-b.x).map(c=>({point:[c.x+c.w/2,c.y+c.h/2],side:c.x+c.w/2<im.width/2?"left":"right"}));
  }
  class UnlockFlow {
    constructor(){this.pending=null;this.completed=new Set();}
    reset(){this.pending=null;this.completed.clear();}
    decide({get,buttons,slots},now){
      const p=this.pending;
      if(p){
        if(get){
          if(now-p.at<4000)return {wait:"等待获取槽位响应"};
          if(p.getAttempts>=3)return {stop:"获取槽位未响应"};
          return {point:get,kind:"get",mode:p.getAttempts?"touch":"mouse"};
        }
        if(p.getAttempts){
          if(slots>p.slots){
            this.completed.add(p.side);this.pending=null;
            return {confirmed:true};
          }
          if(now-p.at<120000)return {wait:"等待槽位增加或广告结束"};
          return {stop:"未确认槽位增加，停止重复获取"};
        }
        if(now-p.at<4000)return {wait:"等待解锁弹窗"};
        if(now-p.at>20000)return {stop:"未识别到解锁弹窗"};
        if(p.attempts>=3)return {stop:"解锁按钮未响应"};
        const b=buttons.find(b=>b.side===p.side);
        return b?{point:b.point,kind:"unlock",side:b.side,mode:"touch"}:{wait:"等待解锁画面"};
      }
      if(get)return {point:get,kind:"get",mode:"mouse"};
      const b=buttons.find(b=>!this.completed.has(b.side));
      return b&&slots<7?{point:b.point,kind:"unlock",side:b.side,mode:"mouse"}:{ready:true};
    }
    clicked(a,slots,now){
      if(!this.pending)this.pending={side:a.side,slots,attempts:0,getAttempts:0,at:now};
      if(a.kind==="get")this.pending.getAttempts++;
      else this.pending.attempts++;
      this.pending.at=now;
    }
  }
  function extendSlots(im,c){
    if(!c||c.size[0]!==im.width||c.size[1]!==im.height||!observe(im,c).guard)return null;
    const slots=c.slots.map(p=>[...p]),empty=c.empty.map(p=>[...p]);
    const pitch=(slots.at(-1)[0]-slots[0][0])/(slots.length-1);
    const add=left=>{
      if(slots.length>=7)return;
      const end=left?slots[0]:slots.at(-1),p=[end[0]+(left?-pitch:pitch),end[1]];
      if(p[0]<pitch*.5||p[0]>im.width-pitch*.5)return;
      const pixels=patch(im,[p[0]-c.radius,p[1]-c.radius,c.radius*2+1,c.radius*2+1]);
      if(difference(pixels,c.empty[0])>=20)return;
      // An unlocked empty slot has a broad dark center, not a gold video button.
      if(Math.max(...sample(im,p,Math.round(pitch*.23)))>80)return;
      if(left){slots.unshift(p);empty.unshift(pixels);}else{slots.push(p);empty.push(pixels);}
    };
    add(true);add(false);
    return slots.length>c.slots.length?{...c,slots,empty}:c;
  }
  const api={lab,pixel,sample,patch,difference,automatic,finalize,observe,Policy,components,canRun,refreshSupply,nextLevel,failureDialog,failureClose,certificateConfirm,restartButton,getSlotButton,unlockButtons,UnlockFlow,extendSlots};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  else scope.AnimalBricksCore=api;
})(typeof window!=="undefined"?window:this);
