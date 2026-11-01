/* 左右吸边：独立几何 + 单宠物状态机。坐标统一为渲染端 CSS 像素。 */
'use strict';
var EdgePeek = (() => {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function polygon(r, degrees = 0) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]].map(([x,y]) => ({x:cx+(x-cx)*c-(y-cy)*s,y:cy+(x-cx)*s+(y-cy)*c}));
  }
  function boxOf(points) {
    const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
    return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
  }
  function contains(points, x, y) {
    let sign = 0;
    for (let i=0;i<points.length;i++) {
      const a=points[i],b=points[(i+1)%points.length],cross=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);
      if (Math.abs(cross)<1e-7) continue;
      if (sign && Math.sign(cross)!==sign) return false;
      sign=Math.sign(cross);
    }
    return points.length>=3;
  }
  function inverse(r, degrees, p) {
    const cx=r.x+r.w/2,cy=r.y+r.h/2,a=-degrees*Math.PI/180;
    return {x:cx+(p.x-cx)*Math.cos(a)-(p.y-cy)*Math.sin(a),y:cy+(p.x-cx)*Math.sin(a)+(p.y-cy)*Math.cos(a)};
  }
  const valid = a => a && [a.x,a.y,a.width,a.height].every(Number.isFinite) && a.width>0 && a.height>0;
  function nearest(areas, x, y) {
    return areas.filter(valid).reduce((best,a)=> {
      const dist=b=>Math.hypot(x-clamp(x,b.x,b.x+b.width),y-clamp(y,b.y,b.y+b.height));
      return !best || dist(a)<dist(best)?a:best;
    },null);
  }
  function angleFor(side) { return side==='left'?45:-45; }
  function pose({dock, hit, angle, expanded=false}) {
    const b=boxOf(polygon(hit,angle)),a=dock.area;
    const pad=Math.min(12,a.width*.01);
    // 探头露出约四成；展开后整个身体留在屏内。纵向按工作区避开任务栏。
    const x=expanded ? (dock.side==='left'?a.x+pad-hit.x:a.x+a.width-pad-hit.x-hit.w)
      : (dock.side==='left'?dock.edge-b.x-b.w*.58:dock.edge-b.x-b.w*.42);
    const y=clamp(dock.centerY-b.h/2,a.y+4,Math.max(a.y+4,a.y+a.height-b.h-4))-b.y;
    return {x,y,angle};
  }
  function detect({pos,hit,panels,areas}) {
    const centerY=pos.y+hit.y+hit.h/2,threshold=clamp(hit.w*.08,12,32),found=[];
    panels.forEach((panel,index)=> {
      if (!valid(panel) || centerY<panel.y-threshold || centerY>panel.y+panel.height+threshold) return;
      const area=valid(areas[index])?areas[index]:panel;
      for(const side of ['left','right']) {
        const edge=side==='left'?panel.x:panel.x+panel.width;
        const near=side==='left'?pos.x+hit.x:pos.x+hit.x+hit.w;
        if (Math.abs(near-edge)>hit.w*.8+threshold) continue;
        if (side==='left' && near>edge+threshold || side==='right' && near<edge-threshold) continue;
        const dock={side,edge,area:{...area},centerY};
        const angle=angleFor(side),target=pose({dock,hit,angle});
        const b=boxOf(polygon(hit,angle)),top=target.y+b.y,bottom=top+b.h;
        // 屏幕接缝不是吸边位置；探头高度范围内有相邻屏时不向接缝吸附。
        const joined=panels.some((p,i)=>i!==index && valid(p) && p.y<bottom && p.y+p.height>top &&
          (side==='left'?p.x<edge && p.x+p.width>=edge-2:p.x<=edge+2 && p.x+p.width>edge));
        if(!joined)found.push({dock,distance:Math.abs(near-edge)});
      }
    });
    return found.sort((a,b)=>a.distance-b.distance)[0]?.dock || null;
  }
  class Controller {
    constructor(sprite, env) { this.s=sprite;this.env=env;this.enabled=false;this.dock=null;this.expanded=false;this.angle=0;this.ref=null;this.timer=null;this.token=0; }
    cancel() { this.token++;if(this.ref!==null)this.env.cancelFrame(this.ref);if(this.timer!==null)this.env.clearTimer(this.timer);this.ref=this.timer=null; }
    remember() { const v=this.env.view();this.s.customPos={rx:(this.s.pos.x+this.s.halfW)/v.w,ry:(this.s.pos.y+this.s.halfH)/v.h}; }
    render(x,y,angle) {
      this.angle=angle;
      const s=this.s,r=s.hitRect;
      s.stage.style.transformOrigin=(r.x+r.w/2)+'px '+(r.y-s.bottomPad+r.h/2)+'px';
      s.stage.style.transform='translateY('+s.bottomPad+'px) rotate('+angle+'deg)';
      s.sendBounds(x,y);s.syncInputRegions();
    }
    move(target, animate=true) {
      this.cancel();this.s.setTip(false);
      animate = animate && !this.env.reducedMotion?.();
      const start={...this.s.pos,angle:this.angle},began=this.env.now(),token=this.token;
      const step=()=> {
        if(token!==this.token)return;
        const p=animate?clamp((this.env.now()-began)/240,0,1):1,q=p*p*(3-2*p);
        this.render(start.x+(target.x-start.x)*q,start.y+(target.y-start.y)*q,start.angle+(target.angle-start.angle)*q);
        this.remember();
        if(p<1)this.ref=this.env.frame(step);else this.ref=null;
      };
      step();
    }
    setEnabled(active) { const next=active===true;if(next===this.enabled)return;this.enabled=next;if(!next)this.release(true); }
    attach(pos=this.s.pos) {
      if(!this.enabled || this.s.dragSettings?.lockPosition || this.s.suspended || this.s.forcedPassThrough || this.s.riceActive || this.s.feedingBusy)return false;
      const dock=detect({pos,hit:this.s.hitRect,panels:this.env.panels(),areas:this.env.areas()});
      if(!dock)return false;
      this.s.stopThrow();this.s.stopSquash();this.s.stopMove();
      this.layoutKey=JSON.stringify([this.env.view(),this.env.panels(),this.env.areas()]);
      this.dock=dock;this.expanded=false;this.s.facing=dock.side==='left'?'right':'left';
      this.s.playOnce(this.s.animations.idle[0]);
      this.move(pose({dock,hit:this.s.hitRect,angle:angleFor(dock.side)}));return true;
    }
    schedule() {
      if(this.timer!==null)this.env.clearTimer(this.timer);
      this.timer=null;
      if(!this.dock || !this.expanded || this.s.suspended || this.s.forcedPassThrough)return;
      this.timer=this.env.setTimer(()=> {
        this.timer=null;
        if(!this.dock || !this.expanded)return;
        if(this.s.inputBusy() || this.s.feedingBusy || this.s.riceActive){this.schedule();return;}
        this.expanded=false;
        this.s.stopSquash();this.s.stopMove();this.s.playOnce(this.s.animations.idle[0]);
        this.move(pose({dock:this.dock,hit:this.s.hitRect,angle:angleFor(this.dock.side)}));
      },5000);
    }
    expand(animate=true) {
      if(!this.dock)return false;
      this.expanded=true;
      this.move(pose({dock:this.dock,hit:this.s.hitRect,angle:0,expanded:true}),animate);
      this.schedule();return true;
    }
    detachForDrag(d) {
      if(!this.dock)return;
      const v=this.env.view(),p=inverse(this.s.hitRect,this.angle,{x:d.sx-v.x-this.s.pos.x,y:d.sy-v.y-this.s.pos.y});
      this.cancel();this.dock=null;this.expanded=false;this.angle=0;
      // 抓住旋转身体的同一个点，拍平后仍跟手；不把宠物强拉到展开位置。
      d.petX=d.sx-v.x-p.x;d.petY=d.sy-v.y-(p.y-this.s.bottomPad);
      this.s.stage.style.transformOrigin='';
    }
    release(restore=true) {
      const dock=this.dock;this.cancel();if(!dock && !this.angle)return;this.dock=null;this.expanded=false;
      if(restore && dock) {
        const areas=this.env.areas();
        const a=nearest(areas,this.s.pos.x+this.s.halfW,this.s.pos.y+this.s.halfH);
        if(a) {
          const hit=this.s.hitRect;
          this.render(clamp(this.s.pos.x,a.x+8-hit.x,Math.max(a.x+8-hit.x,a.x+a.width-hit.x-hit.w-8)),
            clamp(this.s.pos.y,a.y+4-hit.y,Math.max(a.y+4-hit.y,a.y+a.height-hit.y-hit.h-4)),0);
          this.remember();
        }
      }
      this.angle=0;this.s.stage.style.transform='translateY('+this.s.bottomPad+'px)';this.s.stage.style.transformOrigin='';
      this.s.syncInputRegions();
    }
    lifecycle() {
      if(!this.dock)return;
      this.cancel();
      // 隐藏/穿透前直接收回，恢复时不延续旧计时器或半途的动画。
      this.expanded=false;this.move(pose({dock:this.dock,hit:this.s.hitRect,angle:angleFor(this.dock.side)}),false);
    }
    reflow() { if(this.dock && this.layoutKey!==JSON.stringify([this.env.view(),this.env.panels(),this.env.areas()]))this.release(true); }
    dispose() { this.cancel();this.dock=null; }
  }
  return {polygon,boxOf,contains,inverse,nearest,angleFor,pose,detect,Controller};
})();
if(typeof module!=='undefined' && module.exports)module.exports=EdgePeek;
