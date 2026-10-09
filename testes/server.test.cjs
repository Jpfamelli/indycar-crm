const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const http=require('node:http');
test('servidor real com banco e login falsos: porteiro, JSON, limites, cache e preferências',async()=>{
 let servidor, chamadas=0, preferencias;
 const store={getStats:async()=>{chamadas++;return {total:1};},createLead:async d=>({...d,id:'teste'}),updateLead:async(id,d)=>({id,...d}),atualizarPreferenciasCliente:async(id,d)=>{preferencias={id,...d};return preferencias;}};
 const sb={from:()=>({select(){return this;},then(r){return Promise.resolve({data:[{problema:'Aviso fictício',desde:'2026-10-09',ultimo_resumo:'não publicar'}]}).then(r);}})};
 const sandbox={require:n=>n==='node:http'?{createServer:fn=>(servidor=http.createServer(fn))}:n==='./db-supabase'?store:n==='@supabase/supabase-js'?{createClient:()=>sb}:n==='./ia'?{}:n==='./public/crm-utils'?require('../public/crm-utils'):require(n),__dirname:require('node:path').resolve(__dirname,'..'),Buffer,URL,AbortSignal,console:{log(){},warn(){},error(){}},process:{env:{SUPABASE_URL:'http://falso',SUPABASE_ANON_KEY:'ficticia',SUPABASE_SERVICE_ROLE_KEY:'ficticia',PORT:'0'},loadEnvFile(){}},fetch:async url=>({ok:true,json:async()=>url.includes('/user')?{id:'teste'}:[{ativo:true,papel:'admin'}]})};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8'),sandbox);
 await new Promise(r=>servidor.once('listening',r));const base=`http://127.0.0.1:${servidor.address().port}`;
 const req=(p,opts={})=>fetch(base+p,{...opts,headers:{Authorization:'Bearer ficticio','Content-Type':'application/json',...opts.headers}});
 try {
  assert.equal((await fetch(base+'/api/leads')).status,401);
  assert.equal((await req('/api/leads',{method:'POST',body:'{'})).status,400);
  assert.equal((await req('/api/leads',{method:'POST',body:JSON.stringify({nome:'Teste',telefone:'123'})})).status,400);
  assert.equal((await req('/api/leads',{method:'POST',body:JSON.stringify({nome:'Teste',telefone:'12900000001',observacoes:'a'.repeat(66000)})})).status,413);
  const st=await req('/api/stats');assert.equal(st.headers.get('cache-control'),'no-store');assert.equal(st.headers.get('x-content-type-options'),'nosniff');await req('/api/stats');assert.equal(chamadas,1);
  assert.equal((await req('/api/leads',{method:'POST',body:JSON.stringify({nome:'Teste',telefone:'12900000001'})})).status,201);await req('/api/stats');assert.equal(chamadas,2);
  const saude=await(await req('/api/saude')).json();assert.equal(saude.avisos.length,1);assert.equal(saude.avisos[0].ultimo_resumo,undefined);
  const id='11111111-1111-4111-8111-111111111111';assert.equal((await req('/api/clientes/'+id,{method:'PATCH',body:JSON.stringify({aceita_mensagens:false})})).status,200);assert.equal(preferencias.id,id);
 } finally {await new Promise(r=>servidor.close(r));}
});
