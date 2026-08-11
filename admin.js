let token=localStorage.getItem("gs_admin_token")||"";
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
async function api(url,opt={}){
 opt.headers={...opt.headers,Authorization:`Bearer ${token}`};
 const r=await fetch(url,opt),d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.error||"Request failed");return d;
}
$("loginForm").onsubmit=async e=>{
 e.preventDefault();
 try{const r=await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:$("username").value,password:$("password").value})});
 const d=await r.json();if(!r.ok)throw new Error(d.error);token=d.token;localStorage.setItem("gs_admin_token",token);showPanel();}catch(x){alert(x.message);}
};
async function showPanel(){
 try{await loadStudents();$("adminLogin").classList.add("hidden");$("adminPanel").classList.remove("hidden");}catch(e){localStorage.removeItem("gs_admin_token");token="";alert("Please log in again.");}
}
async function loadStudents(){
 const rows=await api("/api/admin/students");
 $("stats").innerHTML=`<div class="stat"><small>Students</small><b>${rows.length}</b></div><div class="stat"><small>Active</small><b>${rows.filter(x=>x.status==="active").length}</b></div><div class="stat"><small>Classes</small><b>${new Set(rows.map(x=>x.class_name)).size}</b></div>`;
 $("adminStudents").innerHTML=rows.map(s=>`<div class="notice"><b>${esc(s.admission_no)} — ${esc(s.full_name)}</b><br><small>${esc(s.class_name)} ${s.stream?`• ${esc(s.stream)}`:""} • Parent: ${esc(s.guardian_name||"Not linked")} ${s.telegram_id?`(${esc(s.telegram_id)})`:""}</small></div>`).join("")||"<p class='muted'>No students.</p>";
}
function formData(form){return Object.fromEntries(new FormData(form).entries());}
$("studentForm").onsubmit=async e=>{e.preventDefault();try{await api("/api/admin/students",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(formData(e.target))});e.target.reset();await loadStudents();alert("Student added.");}catch(x){alert(x.message);}};
$("announcementForm").onsubmit=async e=>{e.preventDefault();try{await api("/api/admin/announcements",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(formData(e.target))});e.target.reset();alert("Announcement published.");}catch(x){alert(x.message);}};
if(token)showPanel();
