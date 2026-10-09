import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const statuses=['novo','contato','orcamento','agendado','em_servico','concluido','perdido'];
const origens=['meta','google','organico','whatsapp','indicacao','passagem'];
const cliente={id:'11111111-1111-4111-8111-111111111111',nome:'CLIENTE FICTÍCIO <teste>',telefone:'12900000001',carro_modelo:'Carro de teste',placa:'ABC1D23',created_at:'2026-10-01T12:00:00Z',nascimento:'1904-02-29',aceita_mensagens:false};
let leads=[{...cliente,id:'22222222-2222-4222-8222-222222222222',cliente_id:cliente.id,status:'novo',origem:'organico',servico:'Diagnóstico',valor_orcado:100,valor_pago:0}];
const resumo=()=>({total:leads.length,ganhos:0,perdidos:0,faturamento:0,emAberto:100,ticket:0,conversao:0,porOrigem:[],porStatus:Object.fromEntries(statuses.map(s=>[s,leads.filter(l=>l.status===s).length]))});
const auth=`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'ficticio'}}}),signOut:async()=>({}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})};`;
export function criarMock() {
 return http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
  let body='';for await(const c of req)body+=c;
  const d=body?JSON.parse(body):{};
  if(url.pathname.startsWith('/api/')){
   if(url.pathname==='/api/config')return json({configurado:true,supabaseUrl:'http://localhost',supabaseAnonKey:'ficticia'});
   if(url.pathname==='/api/perfil')return json({id:'ficticio',nome:'Equipe de teste',papel:'admin'});
   if(url.pathname==='/api/stats')return json({semana:resumo(),geral:resumo(),comparativo:{leads:{atual:1,anterior:0},faturamento:{atual:0,anterior:0}},dominios:{STATUSES:statuses,ORIGENS:origens}});
   if(url.pathname==='/api/saude')return json({avisos:[{problema:'Aviso fictício: integração em manutenção',desde:'2026-10-09'}]});
   if(url.pathname==='/api/leads' && req.method==='POST'){const l={...d,id:crypto.randomUUID(),created_at:new Date().toISOString()};leads.unshift(l);return json(l,201);}
   if(url.pathname==='/api/leads')return json(leads);
   if(url.pathname.startsWith('/api/leads/')){const id=url.pathname.split('/').at(-1),l=leads.find(x=>x.id===id);if(req.method==='PATCH')Object.assign(l,d);if(req.method==='DELETE')leads=leads.filter(x=>x.id!==id);return json(l || {ok:true});}
   if(url.pathname==='/api/clientes')return json({clientes:[{...cliente,gasto:0,emAberto:100,servicos:0,ultimoContato:cliente.created_at}],total:1,totalBase:1,faturamento:0,faturamentoBase:0});
   if(url.pathname.startsWith('/api/clientes/')){if(req.method==='PATCH'){Object.assign(cliente,d);return json({cliente});}return json({cliente,resumo:{gasto:0,emAberto:100,servicosFeitos:0,ticket:0,leads:1,agendamentos:0,faltas:0,ultimoServico:null},leads,agendamentos:[],servicos:[]});}
   if(url.pathname==='/api/catalogo')return json({servicos:[],souAdmin:true});
   if(url.pathname==='/api/equipe')return json({equipe:[],souAdmin:true});
   return json({erro:'Rota fictícia não implementada'},404);
  }
  const rel=url.pathname==='/'?'index.html':url.pathname.slice(1);const f=path.resolve(root,rel);
  if(!f.startsWith(root+path.sep))return json({erro:'Proibido'},403);
  try {let data=fs.readFileSync(f);if(rel==='index.html')data=Buffer.from(data.toString().replace(/<script src="https:\/\/cdn.jsdelivr[^>]+><\/script>/,`<script>${auth}</script>`).replace(/if \('serviceWorker' in navigator\)/,"if (false)"));
   res.writeHead(200,{'Content-Type':{'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8'}[path.extname(f)]||'application/octet-stream'});res.end(data);
  }catch{return json({erro:'Arquivo não encontrado'},404);}
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url))criarMock().listen(3101,'127.0.0.1',()=>console.log('CRM fictício em http://127.0.0.1:3101'));
