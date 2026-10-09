const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
test('camada Supabase limita colunas e registra apenas mudanças de consentimento',async()=>{
 let patch,atual={aceita_mensagens:false};
 const sb={from:table=>{assert.equal(table,'clientes');let gravando=false;return {select(){return this;},eq(k,id){assert.equal(k,'id');assert.equal(id,'cliente-ficticio');return this;},update(v){patch=v;gravando=true;return this;},async maybeSingle(){return {data:gravando?{id:'cliente-ficticio',...patch}:atual,error:null};}};}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../db-supabase.js'),'utf8'),{module,exports:module.exports,process:{env:{SUPABASE_URL:'http://falso',SUPABASE_SERVICE_ROLE_KEY:'ficticia'}},require:n=>n==='@supabase/supabase-js'?{createClient:()=>sb}:require('../public/crm-utils'),console,Date});
 const editar=module.exports.atualizarPreferenciasCliente;
 await editar('cliente-ficticio',{nascimento:'1904-02-29',aceita_mensagens:false,service_role:'não gravar'});
 assert.deepEqual(Object.keys(patch).sort(),['aceita_mensagens','nascimento']);
 await editar('cliente-ficticio',{aceita_mensagens:true});assert.ok(patch.aceita_mensagens_em);assert.equal(patch.aceita_mensagens,true);
 await assert.rejects(editar('cliente-ficticio',{aceita_mensagens:'sim'}));await assert.rejects(editar('cliente-ficticio',{nascimento:'2025-02-29'}));
 atual=null;assert.equal(await editar('cliente-ficticio',{aceita_mensagens:true}),null);
});
