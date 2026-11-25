const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

test('tack-angle summary uses selected VMG pairs, keeps controls reviewable and preserves selected detail source',()=>{
  const dom=new JSDOM('<main></main>',{runScripts:'outside-only'}),w=dom.window;
  try{
    const code=['core','ui','app1','tackangleview'].map(name=>fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8')).join('\n');
    const render=w.eval(code+'\nSL.renderTackAngles'),main=w.document.querySelector('main');
    function row(key,angle,flags={}){
      const m={angle,twaSum:88,halfResidual:(angle-88)/2,closure:.3,twaPort:-43,twaStbd:45,leewayPort:2,leewayStbd:-5,
        targetHalf:43,twdSource:'derived',twd:358,axis:2,port:40,stbd:324,nPort:20,nStbd:21,twdDelta:2};
      return {key,t:1700000000000,sail:'J1',tws:12,vmgToVmg:true,targetSource:'log',direction:'Stbd → Port',...flags,
        active:{HDG:{...m,angle:angle+6,halfResidual:m.halfResidual+3},Course:m,COG:null},proposed:{HDG:m,Course:m,COG:null}};
    }
    const rows=[row('a',80),row('b',90),row('check',110,{validation:true}),row('tactical',140,{vmgToVmg:false})];
    rows[1].active.Course.targetHalf=NaN;
    let opened;
    const draw=(view={})=>render(main,{rows},view,key=>opened=key);
    const cells=r=>Array.from(r.cells,c=>c.textContent);
    const summary=()=>main.querySelector('table').tBodies[0].rows;
    const shown={visiblePairs:rows,series:'active'};
    draw(shown);
    assert.deepEqual(cells(summary()[1]),['Course · door het water','2','85,0°','42,5°','44,0°','43,0° (1/2)','−1,5°','0,3°']);
    assert.deepEqual(cells(summary()[2]).slice(1),['0','—','—','—','—','—','—']);
    const choose=(selector,value)=>{
      const input=main.querySelector(selector);input.value=value;input.dispatchEvent(new w.Event('change'));
    };
    main.querySelector('details').open=true;
    choose('[data-tack-source]','Course');choose('[data-tack-mode]','wind');
    const perTack=()=>main.querySelector('details table').tBodies[0];
    assert.equal(perTack().rows.length,4);
    assert.equal(cells(perTack().rows[0])[3],'+2,0° / −5,0°');
    assert.equal(cells(perTack().rows[3])[1],'Tactisch');
    assert.equal(cells(perTack().rows[0])[7],'HDG + TWA');
    assert.match(main.textContent,/SailLens berekende TWD/);
    perTack().rows[2].querySelector('button').click();assert.equal(opened,'check');
    draw({...shown,series:'proposed',visiblePairs:[rows[0],rows[2]]});
    assert.equal(main.querySelector('details').open,true);
    assert.equal(main.querySelector('[data-tack-source]').value,'Course');
    assert.equal(main.querySelector('[data-tack-mode]').value,'wind');
    assert.equal(perTack().rows.length,2);assert.equal(cells(summary()[0])[2],'80,0°');
    draw({visiblePairs:[]});assert.match(main.textContent,/Geen goedgekeurde aandewindse tackparen/);
    draw({visiblePairs:[rows[2]]});assert.equal(cells(summary()[0])[1],'0');
    assert.match(main.textContent,/alleen controle- of tactische paren/);
  }finally{w.close();}
});
