const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ctx=vm.createContext({});
for(const name of ['core','core2','sessionflow']){
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),ctx);
}
const SL=vm.runInContext('SL',ctx);

test('a tactical tack contributes its TWD jump but no angle-symmetry offset',()=>{
  const leg=(tack,AWA,TWA,TWD)=>({tack,v:{AWA,TWA,TWD,TWS:12},coverage:{AWA:1,TWS:1,TWD:1}});
  const before=leg('Port',-32,-45,3),after=leg('Stbd',26,41,359),pair={type:'Tack'};
  const legacy=SL.windPairEvidence([{pair,before,after}]);
  assert.equal(legacy.alignment[0],3);
  assert.equal(legacy.bands[0].errors[0],4);
  const tactical=SL.windPairEvidence([{pair:{...pair,vmgToVmg:false},before,after}]);
  assert.equal(tactical.alignment.length,0);
  assert.equal(tactical.bands[0].errors[0],4);
  const validation=SL.windPairEvidence([{pair:{...pair,vmgToVmg:false,validation:true},before,after}]);
  assert.equal(validation.bands.length,0);
});
