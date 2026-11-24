const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

test('wind plot pagination and controls keep the correction scope independent of display choices',()=>{
  const dom=new JSDOM('<body><main></main></body>',{runScripts:'outside-only'});
  const w=dom.window;
  try{
    w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{
      get:(obj,key)=>obj[key]||(()=>{}),set:(obj,key,val)=>{obj[key]=val;return true;}
    });
    const code=['core','ui','app1','windplots'].map(s=>fs.readFileSync(path.join(__dirname,'../src',s+'.js'),'utf8')).join('\n');
    const plots=w.eval(code+'\nWindPlots');
    const main=w.document.querySelector('main'),id='windplot-mhu';
    const base={active:{AWA:3,TWA:2,TWD:-2},proposed:{AWA:1,TWA:2,TWD:-1},sail:'J1',tws:12,type:'Tack'};
    const pairs=Array.from({length:12},(_,i)=>({...base,t:1.8e12+i*30000,key:'m'+i,validation:i===10,vmgToVmg:i!==11}));
    pairs[9].sail='J2';
    const phase={...base,mode:'up',side:'Port',t:1.8e12,i:0,i1:30};
    const data={kind:'mhu',hasProposal:true,channels:['TWA','AWA'],pairs,phases:[phase]};
    const view={};let report,key;
    const query=s=>main.querySelector(s);
    const change=(id,value,event='change')=>{const e=query('#'+id);e.value=value;e.dispatchEvent(new w.Event(event));};
    plots.render(main,data,view,k=>key=k,r=>report=r);
    assert.equal(report.channel,'AWA');assert.equal(report.series,'proposed');assert.equal(report.pairs.length,10);
    assert.equal(main.querySelectorAll('.windplot-row').length,7);query('[aria-label="Volgende tacks"]').click();
    assert.equal(report.pairs.length,10);query('.windplot-row').click();assert.equal(key,'m7');
    query('#'+id+'-validation').click();assert.equal(report.pairs.length,10);
    change(id+'-sail','J2');assert.deepEqual(report.pairs.map(p=>p.key),['m9']);
    change(id+'-min','13','input');assert.equal(report.pairs.length,0);assert.equal(query('.windplot-row'),null);
    change(id+'-min','','input');change(id+'-series','active');assert.equal(report.series,'active');
    plots.render(main,{...data,kind:'twa'},{},null,r=>report=r);
    assert.equal(report.pairs.length,11);assert.equal(report.channel,'TWA');
  }finally{w.close();}
});
