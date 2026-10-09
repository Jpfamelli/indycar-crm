// Complementos da rodada de 09/10/2026; funções compartilhadas em crm-utils.js.
let ordem = 'recente', filtrosRestaurados = false;
$$('.nav-item').forEach(b=>b.setAttribute('aria-label',TITULOS[b.dataset.view]?.[0] || b.dataset.view));
let geracaoLeads = 0;
function ordenarLeads() {
  ordem = $('#ordemLeads').value;
  LEADS.sort((a,b) => ordem === 'nome' ? String(a.nome).localeCompare(String(b.nome),'pt-BR') : ordem === 'valor' ? Number(b.status === 'concluido' ? b.valor_pago : b.valor_orcado) - Number(a.status === 'concluido' ? a.valor_pago : a.valor_orcado) : ordem === 'antigo' ? String(a.created_at).localeCompare(String(b.created_at)) : String(b.created_at).localeCompare(String(a.created_at)));
}
function salvarFiltros() {
  try {localStorage.setItem('indycar_crm_filtros',JSON.stringify({status:$('#fStatus').value,origem:$('#fOrigem').value,ordem:$('#ordemLeads').value}));} catch {}
}
$('#ordemLeads').addEventListener('change',()=>{ordenarLeads();salvarFiltros();renderTabelaLeads();});
$('#limparFiltros').addEventListener('click',()=>{ $('#fStatus').value='';$('#fOrigem').value='';$('#search').value='';$('#ordemLeads').value='recente';carregarLeads().catch(e=>toast(e.message)); });
$('#exportarLeads').addEventListener('click',()=>{
  const rows = [['Nome','Telefone','Carro','Placa','Serviço','Origem','Status','Orçado','Pago','Entrada'], ...LEADS.map(l=>[l.nome,l.telefone,l.carro_modelo,l.placa,l.servico,LABEL_ORIGEM[l.origem] || l.origem,LABEL_STATUS[l.status] || l.status,l.valor_orcado,l.valor_pago,l.created_at])];
  const url=URL.createObjectURL(new Blob([CrmUtils.csv(rows)],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='leads-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`${LEADS.length} leads exportados`);
});
$('#ecossistema').addEventListener('change',e=>{if(e.target.value)window.open(e.target.value,'_blank','noopener,noreferrer');e.target.value='';});
async function carregarSaude() {
  const el=$('#saudeSistema');
  try {const r=await api('/api/saude');el.hidden=!r.avisos?.length;el.textContent=r.avisos?.length ? 'Atenção no ecossistema: '+r.avisos.map(x=>x.problema).join(' · ') : '';}
  catch {el.hidden=false;el.textContent='Não foi possível conferir a saúde do ecossistema agora.';}
}
const focos=new WeakMap();
function ativarDialogo(bg,titulo) {
  focos.set(bg,document.activeElement);
  const caixa=bg.firstElementChild;caixa.setAttribute('role','dialog');caixa.setAttribute('aria-modal','true');
  if(titulo)caixa.setAttribute('aria-labelledby',titulo.slice(1));else caixa.setAttribute('aria-label','Ficha 360 do cliente');
  $('.sidebar').setAttribute('inert',''); $('main').setAttribute('inert','');
  caixa.scrollTop=0; caixa.querySelector('button,input:not([type=hidden])')?.focus();
}
function restaurarFoco(bg) {$('.sidebar').removeAttribute('inert');$('main').removeAttribute('inert');focos.get(bg)?.focus();}
document.addEventListener('keydown',e=>{
  if(document.body.classList.contains('deslogado'))return;
  const aberto=$('.modal-bg.open');
  if(aberto && e.key==='Tab') {
    const els=$$('button,input,select,textarea,a[href],[tabindex="0"]',aberto).filter(x=>!x.disabled && x.offsetParent!==null);
    if(!els.length)return;
    if(e.shiftKey && document.activeElement===els[0]){e.preventDefault();els.at(-1).focus();}
    if(!e.shiftKey && document.activeElement===els.at(-1)){e.preventDefault();els[0].focus();}
    return;
  }
  if(aberto || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.target.isContentEditable || e.ctrlKey || e.metaKey || e.altKey)return;
  if(e.key.toLowerCase()==='n'){e.preventDefault();abrirModal(null);}
  if(e.key==='/'){e.preventDefault();irPara('leads');$('#search').focus();}
});
document.addEventListener('keydown',e=>{const tr=e.target.closest('#tblLeads tr[data-id],#tblRecent tr[data-id],.kb-card');if(tr && (e.key==='Enter'||e.key===' ')){e.preventDefault();abrirModal(tr.dataset.id);}});
function configurarFichaLead(l) {
  let b=$('#verFichaLead');
  if(!b){b=document.createElement('button');b.id='verFichaLead';b.type='button';b.className='btn btn-ghost';$('#leadForm').prepend(b);}
  b.textContent='Ver ficha 360 · aniversário e mensagens';b.hidden=!l?.cliente_id;
  b.onclick=()=>{fecharModal();abrirFichaCliente(l.cliente_id);};
}
function montarPreferencias(c) {
  const alvo=$('#preferenciasCliente');
  alvo.innerHTML=`<form id="formPreferencias" class="form-vertical"><h4>Aniversário e mensagens</h4>
    <label>Data de nascimento<input id="clienteNascimento" type="date" value="${esc(c.nascimento || '')}" max="${esc(new Date().toISOString().slice(0,10))}" min="1900-01-01"></label>
    <label><input id="semAnoNascimento" type="checkbox" ${c.nascimento?.startsWith('1904')?'checked':''}> Só sei o dia e mês (ano 1904)</label>
    <label><input id="aceitaMensagens" type="checkbox" ${c.aceita_mensagens===true?'checked':''}> Aceita mensagens automáticas</label>
    <p class="muted">${c.aceita_mensagens === null || c.aceita_mensagens === undefined ? 'Preferência ainda não registrada.' : 'Preferência registrada: '+(c.aceita_mensagens?'aceita':'não aceita')}${c.aceita_mensagens_em?' · '+esc(dtAno(c.aceita_mensagens_em)):''}</p>
    <button class="btn btn-primary" type="submit">Salvar preferências</button><p role="status" id="preferenciasMsg"></p></form>`;
  $('#formPreferencias').addEventListener('submit',async e=>{
    e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;
    try {
      let data=$('#clienteNascimento').value;
      if(data && $('#semAnoNascimento').checked)data='1904'+data.slice(4);
      CrmUtils.nascimento(data);
      const nascimento=data || null, aceita_mensagens=$('#aceitaMensagens').checked;
      await api('/api/clientes/'+encodeURIComponent(c.id),{method:'PATCH',body:JSON.stringify({nascimento,aceita_mensagens})});
      $('#preferenciasMsg').textContent='Preferências salvas na base compartilhada.';toast('Preferências salvas');
    }catch(err){$('#preferenciasMsg').textContent=err.message;}finally{btn.disabled=false;}
  });
}
// Observa a primeira montagem dos filtros, sem armazenar termos de busca pessoais.
new MutationObserver(()=>{
  if(filtrosRestaurados || !$('#fStatus').options.length || $('#fStatus').options.length<2)return;
  filtrosRestaurados=true;
  try {const f=JSON.parse(localStorage.getItem('indycar_crm_filtros')||'{}');for(const [id,key] of [['fStatus','status'],['fOrigem','origem'],['ordemLeads','ordem']])if([...$('#'+id).options].some(o=>o.value===f[key]))$('#'+id).value=f[key];}catch{}
}).observe($('#fStatus'),{childList:true});
window.addEventListener('offline',()=>toast('Sem internet. Os dados não serão salvos até a conexão voltar.'));
window.addEventListener('online',()=>toast('Conexão restabelecida.'));
