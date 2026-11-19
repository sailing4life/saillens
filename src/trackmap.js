'use strict';
const TrackMap=(()=>{
  const limit=85.05112878;
  function geometry(D){
    if(D._geo)return D._geo;
    const lat=D.ch.Lat,lon=D.ch.Lon;if(!lat||!lon)return null;
    const ref=SL.median(lat.subarray(D.i0,D.i1));
    const k=Math.cos(Math.min(limit,Math.abs(ref))*SL.D2R),x=new Float64Array(D.n).fill(NaN),y=new Float64Array(D.n).fill(NaN);
    const bx=[Infinity,-Infinity],by=[Infinity,-Infinity];let previous;
    for(let i=D.i0;i<D.i1;i++){
      if(!fin(lat[i])||!fin(lon[i])||Math.abs(lat[i])>=90)continue;
      const longitude=previous==null?lon[i]:previous+SL.w180(lon[i]-previous);
      previous=longitude;x[i]=longitude*k;y[i]=-k*Math.asinh(Math.tan(lat[i]*SL.D2R))/SL.D2R;
      bx[0]=Math.min(bx[0],x[i]);bx[1]=Math.max(bx[1],x[i]);by[0]=Math.min(by[0],y[i]);by[1]=Math.max(by[1],y[i]);
    }
    return D._geo={x,y,bx,by,k};
  }
  // Tiles and track share a Mercator plane, locally scaled to nautical miles.
  function visibleTiles({W,H,cx,cy,sc,k,co,si,ox,oy}){
    if(!(sc>0&&k>0))return [];
    const world=360*k,z=Math.max(0,Math.min(19,Math.round(Math.log2(sc*world/256)))),n=2**z,size=world/n;
    const corners=[[0,0],[W,0],[0,H],[W,H]].map(([x,y])=>[(cx+((x-ox)*co-(y-oy)*si)/sc+world/2)/size,(cy+((x-ox)*si+(y-oy)*co)/sc+world/2)/size]);
    const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]),tiles=[],side=size*sc;
    const dx=side*(Math.abs(co)+Math.abs(si))/2;
    const x0=Math.floor(Math.min(...xs)),x1=Math.floor(Math.max(...xs));
    // On a stationary or extremely wide track, avoid repeated copies of the world.
    if(x1-x0>32)return tiles;
    for(let y=Math.max(0,Math.floor(Math.min(...ys)));y<=Math.min(n-1,Math.floor(Math.max(...ys)));y++){
      for(let x=x0;x<=x1;x++){
        const u=(x*size-world/2-cx)*sc,v=(y*size-world/2-cy)*sc;
        const left=ox+u*co+v*si,top=oy-u*si+v*co;
        const mx=left+side*(co+si)/2,my=top+side*(co-si)/2;
        if(mx+dx<0||mx-dx>W||my+dx<0||my-dx>H)continue;
        tiles.push({key:[z,(x%n+n)%n,y].join('/'),left,top,side});
      }
    }
    return tiles;
  }
  const cache=new Map();let repaint=null;
  function release(){repaint=null;}
  function paint(c,transform,onChange){
    repaint=onChange;let ready=0,failed=0;
    const tiles=visibleTiles(transform);
    for(const tile of tiles){
      let entry=cache.get(tile.key);
      if(!entry||(entry.retry&&Date.now()>entry.retry)){
        const img=new Image();entry={img,status:'loading'};cache.set(tile.key,entry);
        img.onload=()=>{entry.status='ready';repaint?.();};
        img.onerror=()=>{entry.status='error';entry.retry=Date.now()+60000;repaint?.();};
        img.referrerPolicy='strict-origin-when-cross-origin';
        img.src='https://tile.openstreetmap.org/'+tile.key+'.png';
      }
      cache.delete(tile.key);cache.set(tile.key,entry);
      if(entry.status==='ready'){
        ready++;c.save();c.translate(tile.left,tile.top);c.rotate(-Math.atan2(transform.si,transform.co));
        c.drawImage(entry.img,0,0,tile.side+.25,tile.side+.25);c.restore();
      }else if(entry.status==='error')failed++;
    }
    while(cache.size>180)cache.delete(cache.keys().next().value);
    return !tiles.length?'Geen kaartdekking':failed?'Kaart deels of geheel niet beschikbaar':ready<tiles.length?'Kaart laden…':'';
  }
  return {geometry,visibleTiles,paint,release};
})();
