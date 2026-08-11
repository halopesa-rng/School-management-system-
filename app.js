const tg = window.Telegram?.WebApp;
let initData = tg?.initData || "";
let me = null;

if (tg) { tg.ready(); tg.expand(); }

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function money(v){return new Intl.NumberFormat("en-KE",{style:"currency",currency:"KES",maximumFractionDigits:0}).format(Number(v||0));}
function toast(msg){const t=$("toast");t.textContent=msg;t.style.display="block";setTimeout(()=>t.style.display="none",2500);}
async function api(url, options={}) {
  options.headers = {...options.headers, "x-telegram-init-data":initData};
  const r=await fetch(url,options); const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||"Request failed"); return data;
}

async function boot(){
  try{
    if(!initData){
      $("loginText").textContent="Open this page from Telegram to use your parent account.";
      $("demoBtn").classList.remove("hidden");
      return;
    }
    await api("/api/auth/telegram",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({initData})});
    me=await api("/api/me");
    render();
  }catch(e){$("loginText").textContent=e.message;}
}
function render(){
  $("loginCard").classList.add("hidden");$("app").classList.remove("hidden");
  const u=me.user||{};$("userName").textContent=[u.first_name,u.last_name].filter(Boolean).join(" ")||"Parent";
  $("avatar").textContent=(u.first_name||"G").slice(0,1).toUpperCase();
  $("accountStatus").textContent=me.linked===false?"Student linking required":"Account active";
  renderStudents();renderAnnouncements();
  populateSelects();
}
function renderStudents(){
  $("students").innerHTML=me.students.length?me.students.map(s=>`
  <div class="card student-card" onclick="selectStudent(${s.id})">
    <small>${esc(s.admission_no)}</small><h3>${esc(s.full_name)}</h3>
    <p>${esc(s.class_name)} ${s.stream?`• ${esc(s.stream)}`:""}</p>
    <span class="badge">${esc(s.status)}</span>
  </div>`).join(""):`<div class="card"><b>No linked student yet.</b><p class="muted">Ask the school administrator to link your Telegram ID to your student's record.</p></div>`;
}
function renderAnnouncements(){
  $("announcements").innerHTML=(me.announcements||[]).map(a=>`<div class="notice"><b>${esc(a.title)}</b><p>${esc(a.body)}</p><small class="muted">${new Date(a.created_at).toLocaleString()}</small></div>`).join("")||"<p class='muted'>No announcements.</p>";
}
function populateSelects(){
  for(const id of ["studentResultsSelect","studentFeesSelect","studentAttendanceSelect"]){
    $(id).innerHTML=me.students.map(s=>`<option value="${s.id}">${esc(s.full_name)} — ${esc(s.class_name)}</option>`).join("");
    $(id).onchange=()=>loadSection(id);
  }
  if(me.students.length){loadSection("studentResultsSelect");}
}
async function loadSection(type){
  const sid=$(type).value;
  try{
    if(type==="studentResultsSelect"){
      const rows=await api(`/api/students/${sid}/results`);
      $("resultsBox").innerHTML=rows.length?`<div class="card"><table><tr><th>Subject</th><th>Score</th><th>Grade</th><th>Term</th></tr>${rows.map(r=>`<tr><td>${esc(r.subject)}</td><td>${r.score}</td><td>${esc(r.grade||"-")}</td><td>${esc(r.term)} ${r.year}</td></tr>`).join("")}</table></div>`:"<p class='muted'>No results available.</p>";
    }
    if(type==="studentFeesSelect"){
      const d=await api(`/api/students/${sid}/fees`), due=Number(d.totals.due),paid=Number(d.totals.paid);
      $("feesBox").innerHTML=`<div class="card"><div class="kpis"><div class="kpi"><small>Due</small><b>${money(due)}</b></div><div class="kpi"><small>Paid</small><b>${money(paid)}</b></div><div class="kpi"><small>Balance</small><b>${money(due-paid)}</b></div></div></div>
      <div class="card"><table><tr><th>Term</th><th>Due</th><th>Paid</th><th>Ref</th></tr>${d.records.map(r=>`<tr><td>${esc(r.term)} ${r.year}</td><td>${money(r.amount_due)}</td><td>${money(r.amount_paid)}</td><td>${esc(r.reference||"-")}</td></tr>`).join("")}</table></div>`;
    }
    if(type==="studentAttendanceSelect"){
      const rows=await api(`/api/students/${sid}/attendance`);
      $("attendanceBox").innerHTML=rows.length?`<div class="card"><table><tr><th>Date</th><th>Status</th><th>Remark</th></tr>${rows.map(r=>`<tr><td>${esc(r.attendance_date)}</td><td>${esc(r.status)}</td><td>${esc(r.remark||"-")}</td></tr>`).join("")}</table></div>`:"<p class='muted'>No attendance records available.</p>";
    }
  }catch(e){toast(e.message);}
}
window.selectStudent=id=>{$("studentResultsSelect").value=id;loadSection("studentResultsSelect");document.querySelector('[data-tab="results"]').click();};
window.showTeachers=async()=>{const rows=await api("/api/teachers");$("moreBox").innerHTML=`<div class="card"><h3>Teachers</h3>${rows.map(t=>`<p><b>${esc(t.full_name)}</b><br><span class="muted">${esc(t.subject||"")} • ${esc(t.phone||"")}</span></p>`).join("")}</div>`;};
window.showAssignments=async()=>{if(!me.students.length)return toast("No student linked");const rows=await api(`/api/students/${me.students[0].id}/assignments`);$("moreBox").innerHTML=`<div class="card"><h3>Assignments</h3>${rows.map(a=>`<div class="notice"><b>${esc(a.subject)} — ${esc(a.title)}</b><p>${esc(a.description||"")}</p><small>Due: ${esc(a.due_date||"Not specified")}</small></div>`).join("")||"<p class='muted'>No assignments.</p>"}`;};
window.showAnnouncements=()=>{$("moreBox").innerHTML=`<div class="card">${(me.announcements||[]).map(a=>`<div class="notice"><b>${esc(a.title)}</b><p>${esc(a.body)}</p></div>`).join("")}</div>`};
window.openAdmin=()=>location.href="/admin.html";

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
 document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");
 document.querySelectorAll(".tabpage").forEach(x=>x.classList.add("hidden"));$(b.dataset.tab).classList.remove("hidden");
});
$("refreshBtn").onclick=async()=>{me=await api("/api/me");render();toast("Updated");};
$("themeBtn").onclick=()=>document.body.classList.toggle("dark");
$("demoBtn").onclick=()=>toast("Demo login is intentionally disabled for security. Use Telegram.");
boot();
