// Captain's log. Firebase settings live in firebase-config.js.
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, setDoc, getDoc, deleteDoc,
  onSnapshot, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
if(!firebaseConfig||!firebaseConfig.apiKey||firebaseConfig.apiKey.startsWith('PASTE')){
  document.getElementById('app').innerHTML='<div class="loading">Almost there. Paste your Firebase settings into firebase-config.js (setup guide, step 3).</div>';
  throw new Error('Firebase config missing');
}
const fbApp=initializeApp(firebaseConfig);
const auth=getAuth(fbApp);
const db=initializeFirestore(fbApp,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
const LS='caplog:v1', PK='caplog:photos', THEME_KEY='caplog:theme';
const $=s=>document.querySelector(s);
const app=$('#app'),dlg=$('#sheet'),sheetBody=$('#sheetBody'),askDlg=$('#ask');
let mode='loading',profile={},entries=[],baseRef=null,col=null,ready={p:false,e:false};
let view='today',daysShown=3,S={};

/* ---------- helpers ---------- */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));
const num=v=>{const n=parseFloat(v);return isFinite(n)?n:0};
const clean=o=>JSON.parse(JSON.stringify(o));
function dur(ms){ms=Math.max(0,ms);const m=Math.floor(ms/6e4);if(m<1)return '<1m';if(m<60)return m+'m';const h=Math.floor(m/60);if(h<24)return h+'h'+(m%60?' '+(m%60)+'m':'');return Math.floor(h/24)+'d '+(h%24)+'h'}
function clock(ms){ms=Math.max(0,ms);const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0')}
const hm=ms=>{const m=Math.max(0,Math.floor(ms/6e4));return Math.floor(m/60)+'h '+(m%60)+'m'};
const fmtTime=ts=>new Date(ts).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
const shortTime=ts=>{const d=new Date(ts);let h=d.getHours();const ap=h<12?'a':'p';h=h%12||12;return h+':'+String(d.getMinutes()).padStart(2,'0')+ap};
const fmtDate=ts=>new Date(ts).toLocaleDateString([], {month:'short',day:'numeric'});
const isoDate=ts=>{const d=new Date(ts);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const dayStart=ts=>{const d=new Date(ts);d.setHours(0,0,0,0);return d.getTime()};
const addDays=(ts,n)=>{const d=new Date(ts);d.setDate(d.getDate()+n);return d.getTime()};
const toInput=ts=>{const d=new Date(ts);return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,16)};
const fromInput=v=>{if(!v)return null;const t=new Date(v).getTime();return isFinite(t)?t:null};
function dayLabel(k){const t=dayStart(Date.now());if(k===t)return 'Today';if(k===addDays(t,-1))return 'Yesterday';return new Date(k).toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})}
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toast.h);toast.h=setTimeout(()=>t.classList.remove('show'),2300)}
const sorted=()=>entries.slice().sort((a,b)=>b.ts-a.ts);
const habitsList=()=>profile.habits&&profile.habits.length?profile.habits:['Drink 8 glasses of water','Stretch','Read'];
const medsList=()=>profile.meds||[];
const MOODS=['😞','🙁','😐','🙂','😄'], ENERGY=['🪫','▂','▄','▆','🔋'];
const CAF=['Coffee','Tea','Energy drink','Soda','Espresso'];
const WORK=['Walk','Run','Gym','Yoga','Bike','Swim'];
const MEALS=[['breakfast','Breakfast'],['lunch','Lunch'],['dinner','Dinner'],['snack','Snack']];
function mealGuess(ts){const h=new Date(ts).getHours();return h<11?'breakfast':h<15?'lunch':h<17?'snack':h<21?'dinner':'snack'}
const ICON={note:'✏️',meal:'🍽️',water:'💧',caffeine:'☕',sleep:'🌙',mood:'🙂',workout:'🏃',med:'💊',habit:'✅'};

function describe(e){
  switch(e.type){
    case 'note':return [e.text||'',''];
    case 'meal':return [(MEALS.find(m=>m[0]===e.meal)||[0,'Meal'])[1]+(e.food?': '+e.food:''),''];
    case 'water':return ['Water'+(e.amount?', '+e.amount:''),''];
    case 'caffeine':return [e.drink||'Caffeine',''];
    case 'sleep':return e.end?['Slept '+dur(e.end-e.ts),fmtTime(e.ts)+' to '+fmtTime(e.end)+(e.quality?', felt '+e.quality+'/5 rested':'')]:['Asleep',''];
    case 'mood':return [[e.mood?'Mood '+MOODS[e.mood-1]+' '+e.mood+'/5':'',e.energy?'energy '+e.energy+'/5':''].filter(Boolean).join(', '),''];
    case 'workout':return [(e.kind||'Workout')+(e.minutes?', '+e.minutes+' min':''),''];
    case 'med':return [(e.med||'Medicine')+(e.dose?' ('+e.dose+')':''),''];
    case 'habit':return ['Done: '+(e.habit||''),''];
  }
  return ['',''];
}

/* ---------- storage ---------- */
let writeChain=Promise.resolve();
function queue(fn){return Promise.resolve().then(fn).catch(err=>{console.error(err);toast("Couldn't save. Check your connection and try again.")});return writeChain}
function lsSave(){try{localStorage.setItem(LS,JSON.stringify({profile,entries}))}catch(e){toast('This browser is out of space. Download a backup from settings.')}}
function saveEntry(e){e=clean(e);const i=entries.findIndex(x=>x.id===e.id);
  if(mode==='local'){if(i>=0)entries[i]=e;else entries.push(e);lsSave();render();return}
  const {id,...body}=e;queue(()=>col.doc(id).set(body))}
function deleteEntry(id){if(mode==='local'){entries=entries.filter(x=>x.id!==id);lsSave();render();return}queue(()=>col.doc(id).delete())}
function saveProfile(p){profile=clean(p);render();if(mode==='local'){lsSave();return}const body=clean(profile);queue(()=>baseRef.set(body))}
/* ---------- Firebase ---------- */
function wrapDoc(ref){return {
  set:b=>setDoc(ref,b),delete:()=>deleteDoc(ref),
  get:async()=>{const s=await getDoc(ref);return {exists:s.exists(),data:()=>s.data()}},
  onSnapshot:(cb,err)=>onSnapshot(ref,s=>cb({exists:s.exists(),data:()=>s.data()}),err),
  collection:name=>wrapCol(collection(ref,name))}}
function wrapCol(c){return {doc:id=>wrapDoc(doc(c,id)),
  orderBy:(f,d)=>({limit:n=>({onSnapshot:(cb,err)=>onSnapshot(query(c,orderBy(f,d),limit(n)),s=>cb({docs:s.docs.map(x=>({id:x.id,data:()=>x.data()}))}),err)})})}}
let user=null,authReady=false,subs=[],screen='';
function initStore(){
  onAuthStateChanged(auth,u=>{
    subs.forEach(f=>{try{f()}catch(e){}});subs=[];
    user=u;authReady=true;ready={p:false,e:false};profile={};entries=[];
    if(!u){render();return}
    baseRef=wrapDoc(doc(db,'caplogs',u.uid));col=baseRef.collection('entries');mode='cloud';
    subs.push(baseRef.onSnapshot(s=>{profile=s.exists?{...s.data()}:{};ready.p=true;render()},err=>{console.error(err);ready.p=true;render();toast('Couldn’t load your log. Check the setup guide, step 8.')}));
    subs.push(col.orderBy('ts','desc').limit(2000).onSnapshot(s=>{entries=s.docs.map(d=>({...d.data(),id:d.id}));ready.e=true;render()},err=>{console.error(err);ready.e=true;render()}));
    render();
  });
}
const AUTH_ERR={'auth/invalid-credential':'Email or password is incorrect.','auth/wrong-password':'Email or password is incorrect.','auth/user-not-found':'No account uses that email. Create one instead.',
  'auth/email-already-in-use':'An account already uses that email. Sign in instead.','auth/weak-password':'Use a password with at least 6 characters.','auth/invalid-email':'Enter a valid email address.',
  'auth/too-many-requests':'Too many attempts. Wait a few minutes and try again.','auth/network-request-failed':'You’re offline. Connect to the internet and try again.','auth/unauthorized-domain':'This web address isn’t approved in Firebase yet. See step 4 of the setup guide.'};
async function account(a){
  const em=($('#authEmail')||{}).value?.trim()||'',pw=($('#authPass')||{}).value||'';
  try{
    if(a==='google'){const p=new GoogleAuthProvider();try{await signInWithPopup(auth,p)}catch(e){if(e.code==='auth/popup-blocked'||e.code==='auth/operation-not-supported-in-this-environment')await signInWithRedirect(auth,p);else if(e.code!=='auth/popup-closed-by-user'&&e.code!=='auth/cancelled-popup-request')throw e}}
    if(a==='signIn')await signInWithEmailAndPassword(auth,em,pw);
    if(a==='signUp')await createUserWithEmailAndPassword(auth,em,pw);
    if(a==='forgot'){if(!em)return toast('Enter your email first.');await sendPasswordResetEmail(auth,em);toast('Check your email for a reset link.')}
    if(a==='signOut'){closeSheet();await signOut(auth)}
  }catch(e){console.error(e);toast(AUTH_ERR[e&&e.code]||'Something went wrong. Try again.')}
}
const signInHTML=()=>`<div class="top"><div><h1>Captain’s log</h1><p class="date">Sign in to open your log</p></div></div>
  <p style="margin:0 0 16px;color:var(--muted)">Your log is private to your account and syncs across your devices.</p>
  <button class="btn wide" data-act="google">Continue with Google</button><p style="color:var(--muted);margin:14px 0">or use your email</p>
  <label class="field"><span>Email</span><input id="authEmail" type="email" autocomplete="email"></label>
  <label class="field"><span>Password</span><input id="authPass" type="password" autocomplete="current-password"></label>
  <div class="actions"><button class="btn ghost" data-act="signUp">Create account</button><button class="btn" data-act="signIn">Sign in</button></div>
  <p><button class="btn ghost" style="border:0;color:var(--muted);text-decoration:underline" data-act="forgot">Forgot password?</button></p>`;

/* ---------- photos ---------- */
const photoCache={};
function lsPhotos(){try{return JSON.parse(localStorage.getItem(PK))||{}}catch(e){return {}}}
async function getPhoto(id){if(id in photoCache)return photoCache[id];let d=null;
  try{if(mode==='cloud'){const s=await baseRef.collection('photos').doc(id).get();d=s.exists?s.data().data:null}else d=lsPhotos()[id]||null}catch(e){console.error(e)}
  return photoCache[id]=d}
function setPhoto(id,data){photoCache[id]=data;if(mode==='cloud')return queue(()=>baseRef.collection('photos').doc(id).set({data}));
  const m=lsPhotos();m[id]=data;try{localStorage.setItem(PK,JSON.stringify(m))}catch(e){toast('This browser is out of space for photos.')}}
function delPhoto(id){delete photoCache[id];if(mode==='cloud')return queue(()=>baseRef.collection('photos').doc(id).delete());const m=lsPhotos();delete m[id];try{localStorage.setItem(PK,JSON.stringify(m))}catch(e){}}
function compress(file){return new Promise((res,rej)=>{const fr=new FileReader();fr.onerror=rej;fr.onload=()=>{const img=new Image();img.onerror=rej;img.onload=()=>{
  const go=(max,q)=>{const k=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/jpeg',q)};
  let d=go(1000,.75);if(d.length>230000)d=go(760,.65);if(d.length>230000)d=go(560,.6);res(d)};img.src=fr.result};fr.readAsDataURL(file)})}
function photoPreview(){const e=S.entry;let src=S.photo;if(src===undefined)src=e&&e.hasPhoto?photoCache[e.id]:null;
  if(src===undefined)return '<p class="hint">Loading photo…</p>';
  if(src)return `<img class="pv" src="${src}" alt="Attached photo"><div class="actions"><button class="btn ghost" data-act="addPhoto">Change photo</button><button class="btn ghost" data-act="removePhoto">Remove photo</button></div>`;
  return '<button class="btn ghost wide" data-act="addPhoto">Add a photo</button>'}
const photoField=()=>`<div style="margin-bottom:14px"><span class="lbl">Photo (optional)</span><div id="photoBox">${photoPreview()}</div><input type="file" id="photoInput" accept="image/*" hidden></div>`;
function refreshPhotoBox(){const b=sheetBody.querySelector('#photoBox');if(b)b.innerHTML=photoPreview()}
function applyPhoto(out,e){if(S.photo===undefined){if(e&&e.hasPhoto)out.hasPhoto=true;return}
  if(S.photo===null){if(e&&e.hasPhoto)delPhoto(out.id);delete out.hasPhoto;return}out.hasPhoto=true;setPhoto(out.id,S.photo)}
function hydratePhotos(){document.querySelectorAll('img[data-photo]').forEach(img=>{const id=img.dataset.photo,set=d=>{if(d)img.src=d;else img.remove()};if(id in photoCache)set(photoCache[id]);else getPhoto(id).then(set)})}

/* ---------- confirm & theme ---------- */
function ask(msg,ok='Delete'){return new Promise(res=>{
  askDlg.innerHTML=`<p>${esc(msg)}</p><div class="actions"><button class="btn ghost" data-a="no">Cancel</button><button class="btn danger" data-a="yes">${esc(ok)}</button></div>`;
  let done=false;const fin=v=>{if(done)return;done=true;if(askDlg.open)askDlg.close();res(v)};
  askDlg.onclick=ev=>{const b=ev.target.closest('[data-a]');if(b)fin(b.dataset.a==='yes');else if(ev.target===askDlg)fin(false)};
  askDlg.oncancel=ev=>{ev.preventDefault();fin(false)};askDlg.showModal()})}
const PAPERS=[["classic", "Classic", "#FCFCF7", "#C7D6EA", "#E39A9A", "#1A2130", "#2A3550", "#7A3B47"], ["legal", "Legal pad", "#FFF6B0", "#A9C4E0", "#D9534F", "#2A2716", "#4A4626", "#8A3A36"], ["graph", "Graph pad", "#EEF6EA", "#B9D8B0", "#5E9C66", "#15201A", "#26392C", "#3E6B48"], ["kraft", "Kraft", "#E6D5B8", "#C9B48F", "#9C4A3A", "#2A231B", "#43382B", "#7A3D31"], ["blush", "Blush", "#FCEFF3", "#EBC6D3", "#B24A72", "#24161D", "#3E2633", "#8A3B5D"]];
let paperPref='classic';try{paperPref=localStorage.getItem('caplog:paper')||'classic'}catch(e){}
function swatchesHTML(){const dk=document.documentElement.dataset.theme==='dark';
  return PAPERS.map(([k,l,lp,lr,lm,dp,dr,dm])=>{const p=dk?dp:lp,r=dk?dr:lr,m=dk?dm:lm;
    return `<button data-act="paper" data-v="${k}" aria-pressed="${paperPref===k}"><i style="background:linear-gradient(90deg,transparent 11px,${m} 11px,${m} 13px,transparent 13px),repeating-linear-gradient(${p} 0,${p} 7px,${r} 7px,${r} 8px)"></i>${l}</button>`}).join('')}
let themePref='auto';try{themePref=localStorage.getItem(THEME_KEY)||'auto'}catch(e){}
const darkMQ=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;
function applyTheme(){document.documentElement.dataset.paper=paperPref;document.documentElement.dataset.theme=(themePref==='dark'||(themePref==='auto'&&darkMQ&&darkMQ.matches))?'dark':'light'}
if(darkMQ&&darkMQ.addEventListener)darkMQ.addEventListener('change',applyTheme);applyTheme();

/* ---------- patterns ---------- */
function median(a){if(a.length<5)return null;a=a.slice().sort((x,y)=>x-y);return Math.round(a[Math.floor(a.length/2)]/9e5)*9e5}
function usualGap(type){const since=Date.now()-14*864e5,ts=entries.filter(e=>e.type===type&&e.ts>since).map(e=>e.ts).sort((a,b)=>a-b),g=[];
  for(let i=1;i<ts.length;i++){const d=ts[i]-ts[i-1];if(d>20*6e4&&d<10*36e5)g.push(d)}return median(g)}
function streak(test){let k=dayStart(Date.now()),n=0;if(!test(k))k=addDays(k,-1);while(test(k)){n++;k=addDays(k,-1)}return n}

/* ---------- render ---------- */
function render(){
  if(!authReady||(user&&(!ready.p||!ready.e))){if(screen!=='loading'){screen='loading';app.innerHTML='<div class="loading">Opening your log…</div>'}return}
  if(!user){if(screen!=='signin'){screen='signin';app.innerHTML=signInHTML()}return}
  screen='app';
  const now=Date.now(),list=sorted();
  const title=profile.name?`Captain ${esc(profile.name)}’s log`:'Captain’s log';
  let h=`<div class="top"><div><h1>${title}</h1><p class="date">${new Date().toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})}</p></div><button class="iconbtn" data-act="settings" aria-label="Settings">⚙︎</button></div>`;
  h+=`<div class="views" role="group" aria-label="View"><button data-act="view" data-k="today" aria-pressed="${view==='today'}">Today’s page</button><button data-act="view" data-k="trends" aria-pressed="${view==='trends'}">Trends</button></div>`;
  h+=view==='trends'?renderTrends(list,now):renderToday(list,now);
  h+=`<p class="foot">${mode==='cloud'?'Synced to your account on every device you sign in on.':'Saved in this browser only. Download a backup from settings now and then.'}</p>`;
  const q=$('#quickNote'),qv=q?q.value:'',qf=q&&document.activeElement===q,qs=q?q.selectionStart:0;
  app.innerHTML=h;hydratePhotos();
  const q2=$('#quickNote');if(q2&&qv){q2.value=qv;if(qf){q2.focus();try{q2.setSelectionRange(qs,qs)}catch(e){}}}
  autosize();
}

function renderToday(list,now){
  let h='';const t=profile.timer;
  if(t&&t.kind==='sleep')h+=`<div class="timerbar"><div class="lbl"><strong data-clock="${t.start}">${clock(now-t.start)}</strong><span>Asleep since ${fmtTime(t.start)}</span></div><button class="btn ghost" data-act="open" data-k="sleep">Edit</button><button class="btn" data-act="wake">I’m up</button></div>`;
  const last=type=>list.find(e=>e.type===type);
  const items=[['meal','🍽️','since you ate'],['water','💧','since water'],['caffeine','☕','since caffeine']];
  let since='',nudge='';
  items.forEach(([type,ic,label])=>{const l=last(type);if(!l)return;const el=now-l.ts,u=usualGap(type),due=u&&el>=u&&!(t&&t.kind==='sleep')&&type!=='caffeine';
    since+=`<span class="${due?'due':''}">${ic} <b data-since="${l.ts}">${dur(el)}</b> ${label}</span>`;
    if(due&&!nudge&&profile.nudges!==false)nudge=type==='meal'?`It’s been ${dur(el)} since you ate. You usually eat about every ${dur(u)}.`:`It’s been ${dur(el)} since your last glass of water. You usually have one about every ${dur(u)}.`});
  const ls=list.find(e=>e.type==='sleep'&&e.end);
  if(t&&t.kind==='sleep')since+=`<span>🌙 asleep <b data-since="${t.start}">${dur(now-t.start)}</b></span>`;else if(ls)since+=`<span>🌙 awake <b data-since="${ls.end}">${dur(now-ls.end)}</b></span>`;
  if(since)h+=`<div class="since">${since}</div>`;
  if(nudge)h+=`<p class="nudge">${esc(nudge)}</p>`;
  h+=`<div class="compose"><label for="quickNote" style="position:absolute;left:-9999px">New entry</label><textarea id="quickNote" rows="1" placeholder="What’s happening?"></textarea><button class="btn" data-act="quickNote">Log it</button></div>`;
  const tabs=[['note','✏️','Note'],['meal','🍽️','Meal'],['water','💧','Water'],['caffeine','☕','Caffeine'],['sleep','🌙',t&&t.kind==='sleep'?'Sleeping':'Sleep'],['mood','🙂','Mood'],['workout','🏃','Workout'],['med','💊','Meds'],['habit','✅','Habits']];
  h+=`<div class="tabs" role="group" aria-label="Log something">${tabs.map(([k,ic,l])=>`<button class="t-${k==='caffeine'?'caffeine':k}" data-act="${k==='water'?'water':'open'}" data-k="${k}"><span class="ic">${ic}</span>${l}</button>`).join('')}</div>`;
  const t0=dayStart(now),today=list.filter(e=>e.ts>=t0),c=type=>today.filter(e=>e.type===type);
  const doneToday=new Set(c('habit').map(e=>e.habit));
  h+=`<div class="habits" role="group" aria-label="Today’s habits">${habitsList().map(x=>`<button data-act="habit" data-v="${esc(x)}" aria-pressed="${doneToday.has(x)}">${doneToday.has(x)?'✓ ':''}${esc(x)}</button>`).join('')}</div>`;
  const moods=c('mood').filter(e=>e.mood),wm=c('workout').reduce((s,e)=>s+(e.minutes||0),0);
  const lastNight=list.find(e=>e.type==='sleep'&&e.end&&e.end>=addDays(t0,0)-6*36e5);
  const tally=[[c('water').length,'water'],[c('caffeine').length,'caffeine'],[c('meal').length,'meals'],wm?[wm+'m','workout']:null,moods.length?[MOODS[Math.round(moods.reduce((s,e)=>s+e.mood,0)/moods.length)-1],'mood']:null,lastNight?[dur(lastNight.end-lastNight.ts),'sleep']:null].filter(Boolean);
  h+=`<div class="tally">${tally.map(([v,l])=>`<span><b>${v}</b> ${l}</span>`).join('')}</div>`;
  // the page
  h+='<div class="page">';
  if(!list.length)h+=`<p class="dayh">Today</p><p class="empty">Nothing logged yet. Write your first entry above, or tap a tab.</p><p class="empty">&nbsp;</p>`;
  else{
    const groups=[];list.forEach(e=>{const k=dayStart(e.ts);let g=groups[groups.length-1];if(!g||g.k!==k){g={k,items:[]};groups.push(g)}g.items.push(e)});
    if(groups[0].k!==t0)h+=`<p class="dayh">Today</p><p class="empty">Nothing yet today.</p>`;
    groups.slice(0,daysShown).forEach(g=>{
      h+=`<p class="dayh">${dayLabel(g.k)}</p>`;
      g.items.forEach(e=>{const d=describe(e),k=e.type;h+=`<button class="ln t-${k}" data-act="edit" data-id="${esc(e.id)}"><time datetime="${new Date(e.ts).toISOString()}">${shortTime(e.ts)}</time><span class="k" aria-hidden="true">${ICON[k]||''}</span>${esc(d[0])}${d[1]?` <span class="sub">${esc(d[1])}</span>`:''}${e.note&&k!=='note'?` <span class="sub">${esc(e.note)}</span>`:''}${e.hasPhoto?`<img data-photo="${esc(e.id)}" alt="">`:''}</button>`});
    });
    if(groups.length>daysShown)h+=`<button class="btn ghost more" data-act="moredays">Turn back a few pages</button>`;
  }
  h+='<p class="empty">&nbsp;</p></div>';
  return h;
}

function bars(title,sub,vals,labels,color,fmt=v=>v,fixedMax,emptyMsg){
  if(emptyMsg&&!vals.some(v=>v>0))return `<div class="chart"><h3>${title}</h3><p>${emptyMsg}</p></div>`;
  const W=340,H=150,L=8,R=8,T=18,B=22,max=fixedMax||Math.max(1,...vals),bw=(W-L-R)/vals.length;
  let g='';vals.forEach((v,i)=>{const bh=(H-T-B)*(v/max),x=L+i*bw+bw*.18,y=H-B-bh;
    g+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw*.64).toFixed(1)}" height="${Math.max(v?2:0,bh).toFixed(1)}" rx="3" style="fill:var(${color})"><title>${labels[i]}: ${fmt(v)}</title></rect>`;
    if(i%2===0||vals.length<8)g+=`<text x="${(x+bw*.32).toFixed(1)}" y="${H-6}" text-anchor="middle" font-size="10" style="fill:var(--muted)">${labels[i]}</text>`});
  g+=`<line x1="${L}" x2="${W-R}" y1="${H-B}" y2="${H-B}" style="stroke:var(--rule)"/>`;
  return `<div class="chart"><h3>${title}</h3><p>${sub}</p><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title} for the last two weeks">${g}</svg></div>`;
}
function renderTrends(list,now){
  const days=[...Array(14)].map((_,i)=>addDays(dayStart(now),i-13)),lab=days.map(d=>new Date(d).getDate());
  const per=(type,fn)=>days.map(d=>fn(list.filter(e=>e.type===type&&e.ts>=d&&e.ts<addDays(d,1))));
  const sleep=days.map(d=>{const e=addDays(d,1);return list.filter(x=>x.type==='sleep'&&x.end&&x.end>=d&&x.end<e).reduce((s,x)=>s+(x.end-x.ts),0)/36e5});
  const water=per('water',a=>a.length),caf=per('caffeine',a=>a.length),work=per('workout',a=>a.reduce((s,e)=>s+(e.minutes||0),0));
  const mood=per('mood',a=>{const m=a.filter(e=>e.mood);return m.length?m.reduce((s,e)=>s+e.mood,0)/m.length:0});
  const avg=a=>{const f=a.filter(v=>v>0);return f.length?f.reduce((s,v)=>s+v,0)/f.length:0};
  let h='';
  h+=bars('Sleep',`Average ${avg(sleep).toFixed(1)} hours on nights you logged`,sleep.map(v=>Math.round(v*10)/10),lab,'--c-sleep',v=>v+'h',0,'Log your sleep to see it here.');
  h+=bars('Water',`Average ${avg(water).toFixed(1)} glasses a day`,water,lab,'--c-water',v=>v+' glasses',0,'Tap Water on today’s page to see it here.');
  h+=bars('Caffeine',`Average ${avg(caf).toFixed(1)} a day`,caf,lab,'--c-caf',v=>v,0,'Log caffeine to see it here.');
  h+=bars('Mood',avg(mood)?`Average ${avg(mood).toFixed(1)} out of 5`:'Log your mood to see it here',mood.map(v=>Math.round(v*10)/10),lab,'--c-mood',v=>v+'/5',5,'Log your mood to see it here.');
  h+=bars('Workouts',`${work.reduce((s,v)=>s+v,0)} minutes in two weeks`,work,lab,'--c-workout',v=>v+' min',0,'Log a workout to see it here.');
  const st=habitsList().map(x=>[x,streak(k=>list.some(e=>e.type==='habit'&&e.habit===x&&dayStart(e.ts)===k))]).filter(s=>s[1]>0);
  h+=`<div class="chart"><h3>Habit streaks</h3>${st.length?`<div class="streaks">${st.map(([x,n])=>`<span>${esc(x)}: <b>${n}</b> ${n===1?'day':'days in a row'}</span>`).join('')}</div>`:'<p>Check off a habit on today’s page to start a streak.</p>'}</div>`;
  return h;
}

/* ---------- sheets ---------- */
const field=(id,label,type,val,extra='')=>`<label class="field"><span>${label}</span><input id="${id}" type="${type}" value="${esc(val??'')}" ${extra}></label>`;
const noteField=(v,label='Note (optional)')=>`<label class="field"><span>${label}</span><textarea id="note">${esc(v||'')}</textarea></label>`;
const whenField=ts=>field('when','Time','datetime-local',toInput(ts));
const head=t=>`<div class="sheet-head"><h2>${t}</h2><button class="iconbtn" data-act="close" aria-label="Close">✕</button></div>`;
const actions=isEdit=>`<div class="actions">${isEdit?'<button class="btn danger" data-act="del">Delete</button>':''}<button class="btn" data-act="save">Save</button></div>`;
const seg=(key,opts,cur)=>`<div class="seg" role="group">${opts.map(([v,l])=>`<button type="button" data-act="seg" data-key="${key}" data-v="${v}" aria-pressed="${cur===v}">${l}</button>`).join('')}</div>`;
const scale=(key,icons,cur,lo,hi,cls)=>`<div class="scale ${cls}" role="group">${icons.map((ic,i)=>`<button type="button" data-act="seg" data-key="${key}" data-v="${i+1}" aria-pressed="${String(cur)===String(i+1)}" aria-label="${i+1} of 5">${ic}</button>`).join('')}</div><div class="scale-ends"><span>${lo}</span><span>${hi}</span></div>`;
const val=id=>{const el=sheetBody.querySelector('#'+id);return el?el.value.trim():''};

function openSheet(kind,entry){
  const e=entry||null;S={kind:e?e.type:kind,entry:e,ts:e?e.ts:Date.now(),photo:undefined,
    meal:e&&e.meal||mealGuess(Date.now()),mood:e&&e.mood?String(e.mood):null,energy:e&&e.energy?String(e.energy):null,quality:e&&e.quality?String(e.quality):null};
  renderSheet();if(!dlg.open)dlg.showModal();
  if(e&&e.hasPhoto&&!(e.id in photoCache))getPhoto(e.id).then(()=>{if(S.entry===e)refreshPhotoBox()});
  if(S.kind==='sleep')updateSleepTotal();
}
function closeSheet(){if(dlg.open)dlg.close()}
function renderSheet(){
  const e=S.entry,isEdit=!!e,ts=S.ts;let h='';
  switch(S.kind){
    case 'note':h+=head(isEdit?'Edit entry':'New entry')+`<label class="field"><span>Entry</span><textarea id="text" style="min-height:120px">${esc(e?e.text:'')}</textarea></label>`+whenField(ts)+photoField()+actions(isEdit);break;
    case 'meal':h+=head(isEdit?'Edit meal':'Meal')+seg('meal',MEALS,S.meal)+field('food','What you ate','text',e&&e.food||'','autocomplete="off" placeholder="e.g. eggs and toast"')+whenField(ts)+noteField(e&&e.note)+photoField()+actions(isEdit);break;
    case 'water':h+=head('Edit water')+field('amount','Amount (optional)','text',e&&e.amount||'','placeholder="e.g. 16 oz"')+whenField(ts)+actions(true);break;
    case 'caffeine':h+=head(isEdit?'Edit caffeine':'Caffeine');
      if(!isEdit)h+=`<p class="hint" style="margin:0 0 10px">Tap one to log it now.</p><div class="picks t-caffeine">${CAF.map(x=>`<button data-act="quickCaf" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div><p class="hint">Or type your own:</p>`;
      h+=field('drink','Drink','text',e&&e.drink||'','autocomplete="off"')+whenField(ts)+actions(isEdit);break;
    case 'mood':h+=head(isEdit?'Edit check-in':'How are you doing?')+`<span class="lbl">Mood</span>`+scale('mood',MOODS,S.mood,'Rough','Great','t-mood')+`<span class="lbl">Energy</span>`+scale('energy',ENERGY,S.energy,'Drained','Charged','t-mood')+noteField(e&&e.note,'What’s going on? (optional)')+whenField(ts)+actions(isEdit);break;
    case 'workout':h+=head(isEdit?'Edit workout':'Workout')+`<div class="picks t-workout">${WORK.map(x=>`<button data-act="pickWork" data-v="${x}">${x}</button>`).join('')}</div>`+`<div class="row">${field('kind','What you did','text',e&&e.kind||'','autocomplete="off"')}${field('minutes','Minutes','number',e&&e.minutes||'','min="0" inputmode="numeric"')}</div>`+whenField(ts)+noteField(e&&e.note)+actions(isEdit);break;
    case 'med':h+=head(isEdit?'Edit medicine':'Meds and vitamins');
      if(!isEdit&&medsList().length)h+=`<p class="hint" style="margin:0 0 10px">Tap one to log it now.</p><div class="picks t-med">${medsList().map(x=>`<button data-act="quickMed" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div><p class="hint">Or add another:</p>`;
      h+=`<div class="row">${field('med','Name','text',e&&e.med||'','autocomplete="off"')}${field('dose','Dose (optional)','text',e&&e.dose||'','autocomplete="off"')}</div>`+whenField(ts)+actions(isEdit);
      if(!isEdit&&!medsList().length)h+=`<p class="hint" style="margin-top:12px">Add the ones you take regularly in settings to log them with one tap.</p>`;break;
    case 'habit':
      if(isEdit){h+=head('Edit habit')+`<p>${esc(e.habit)}</p>`+whenField(ts)+actions(true);break}
      h+=head('Habits')+`<p class="hint" style="margin:0 0 12px">Tap a habit on today’s page to check it off. Change your list here.</p>`+`<label class="field"><span>Your habits (separate with commas)</span><textarea id="habits">${esc(habitsList().join(', '))}</textarea></label><div class="actions"><button class="btn" data-act="saveHabits">Save</button></div>`;break;
    case 'sleep':{
      const t=profile.timer,running=!isEdit&&t&&t.kind==='sleep',st=isEdit?e.ts:(running?t.start:null),en=isEdit?e.end:null;
      h+=head(isEdit?'Edit sleep':'Sleep')+`<div class="bigtime"><strong id="sleepTotal">0h 0m</strong><small id="sleepNote"></small></div>`;
      if(running)h+=`<button class="btn wide" data-act="stopSleep" style="margin-bottom:14px">Stop timer (I’m up now)</button>`;else if(!isEdit)h+=`<button class="btn wide" data-act="startSleep" style="margin-bottom:14px">Start timer</button>`;
      h+=field('when','Fell asleep','datetime-local',st?toInput(st):'')+field('end','Woke up','datetime-local',en?toInput(en):'');
      if(!isEdit)h+=`<p class="hint">Add only when you fell asleep and tap Save to keep a timer running from then. Add both times to log a finished night.</p>`;
      h+=`<span class="lbl">How rested do you feel? (optional)</span>`+scale('quality',['😵','🥱','😐','🙂','✨'],S.quality,'Exhausted','Refreshed','t-sleep')+noteField(isEdit?e.note:(running?t.note:''))+actions(isEdit);break}
    case 'settings':{
      h+=head('Settings')+field('name','Your name (optional)','text',profile.name||'','autocomplete="off" placeholder="Shows as Captain ___’s log"');
      h+=`<label class="field"><span>Habits to check off each day (separate with commas)</span><textarea id="habits">${esc(habitsList().join(', '))}</textarea></label>`;
      h+=`<label class="field"><span>Meds and vitamins you take regularly (separate with commas)</span><textarea id="meds" placeholder="e.g. Vitamin D, Multivitamin">${esc(medsList().join(', '))}</textarea></label>`;
      h+=`<span class="lbl">Gentle reminders</span><p class="hint" style="margin:0 0 8px">Highlights when it’s been longer than usual since you ate or had water, based on your own pattern.</p>`+seg('nudges',[['on','On'],['off','Off']],S.nudges);
      h+=`<div class="actions"><button class="btn" data-act="saveSettings">Save</button></div>`;
      h+=`<hr class="divider"><h3>Appearance</h3><p class="hint" style="margin:0 0 8px">Saved on this device.</p>`+seg('theme',[['auto','Match phone'],['light','Light'],['dark','Dark']],themePref)+`<span class="lbl">Paper</span><div class="swatches" id="paperSw" role="group" aria-label="Paper style">${swatchesHTML()}</div>`;
      h+=`<hr class="divider"><h3>Spreadsheet and backup</h3><p class="hint" style="margin:0 0 12px">The spreadsheet has a tab for each kind of entry. A backup holds everything, including photos, and can be restored here.</p>
        <div style="display:grid;gap:10px"><button class="btn ghost wide" data-act="export">Download spreadsheet (.xlsx)</button><div class="actions"><button class="btn ghost" data-act="backup">Download backup</button><button class="btn ghost" data-act="restore">Restore from backup</button></div></div><input type="file" id="restoreFile" accept=".json,application/json" hidden>
        <hr class="divider"><button class="btn ghost wide" data-act="signOut">Sign out${user&&user.email?' ('+esc(user.email)+')':''}</button>`;
      break}
  }
  sheetBody.innerHTML=h;
}

/* ---------- sleep ---------- */
function readStart(){const v=val('when'),e=S.entry,t=profile.timer;
  if(e&&v===toInput(e.ts))return e.ts;if(!e&&t&&t.kind==='sleep'&&v===toInput(t.start))return t.start;return fromInput(v)}
function updateSleepTotal(){const out=sheetBody.querySelector('#sleepTotal'),note=sheetBody.querySelector('#sleepNote');if(!out)return;
  const a=readStart(),b=fromInput(val('end')),n=Date.now();
  if(!a){out.textContent='0h 0m';note.textContent='Add when you fell asleep, or tap Start timer';return}
  if(b&&b<=a){out.textContent='0h 0m';note.textContent='Woke up is before fell asleep';return}
  if(b){out.textContent=hm(b-a);note.textContent=fmtTime(a)+' to '+fmtTime(b);return}
  out.textContent=clock(n-a);note.textContent='Counting from '+fmtTime(a)}
function startTimer(a,keepOpen){const n=Date.now();if(a>n+6e4)return toast('That time hasn’t happened yet.');if(n-a>24*36e5)return toast('Timers can go back up to 24 hours.');
  const t0=profile.timer||{},timer=clean({kind:'sleep',start:Math.min(a,n),entryId:t0.entryId||uid(),note:val('note')||undefined});
  saveProfile({...profile,timer});if(keepOpen){renderSheet();updateSleepTotal();toast('Timer started');return}closeSheet();toast(t0.kind?'Timer updated':'Timer started')}
function saveSleep(endNow){const e=S.entry,t=profile.timer,running=!e&&t&&t.kind==='sleep',n=Date.now();
  const a=readStart(),b=endNow?n:fromInput(val('end'));
  if(!a)return toast('Add when you fell asleep, or tap Start timer.');if(a>n+6e4)return toast('That time hasn’t happened yet.');
  if(!b){if(e)return toast('Add when you woke up.');return startTimer(a)}
  if(b<=a)return toast('Woke up needs to be after fell asleep.');if(b>n+6e4)return toast('That time hasn’t happened yet.');
  const out=clean({id:e?e.id:(running&&t.entryId)||uid(),type:'sleep',ts:a,end:b,quality:S.quality?+S.quality:undefined,note:val('note')||undefined});
  if(running){const p={...profile};delete p.timer;saveProfile(p)}saveEntry(out);closeSheet();toast(e?'Changes saved':'Sleep saved')}
function wake(){const t=profile.timer;if(!t)return;const p={...profile};delete p.timer;saveProfile(p);
  saveEntry(clean({id:t.entryId||uid(),type:'sleep',ts:t.start,end:Date.now(),note:t.note||undefined}));toast('Good morning. Sleep saved.')}

/* ---------- save ---------- */
function doSave(){
  const e=S.entry,base={id:e?e.id:uid(),note:val('note')||undefined},ts=fromInput(val('when'))||Date.now();let out;
  switch(S.kind){
    case 'sleep':return saveSleep();
    case 'note':{const t=val('text');if(!t&&!S.photo)return toast('Write something first.');out={id:base.id,type:'note',ts,text:t};break}
    case 'meal':out={...base,type:'meal',ts,meal:S.meal,food:val('food')||undefined};break;
    case 'water':out={id:base.id,type:'water',ts,amount:val('amount')||undefined};break;
    case 'caffeine':{const d=val('drink');if(!d)return toast('Enter the drink.');out={id:base.id,type:'caffeine',ts,drink:d};break}
    case 'mood':if(!S.mood&&!S.energy)return toast('Tap your mood or energy.');out={...base,type:'mood',ts,mood:S.mood?+S.mood:undefined,energy:S.energy?+S.energy:undefined};break;
    case 'workout':{const k=val('kind');if(!k)return toast('Enter what you did.');out={...base,type:'workout',ts,kind:k,minutes:num(val('minutes'))||undefined};break}
    case 'med':{const m=val('med');if(!m)return toast('Enter the name.');out={id:base.id,type:'med',ts,med:m,dose:val('dose')||undefined};break}
    case 'habit':out={...e,ts};break;
  }
  applyPhoto(out,e);saveEntry(out);closeSheet();toast(e?'Changes saved':'Logged');
}

/* ---------- files ---------- */
async function saveFile(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}
const fileErr=e=>{if(!e||e.code!=='declined')toast(e&&e.code==='unavailable'?'Downloading isn’t available in this view.':'Couldn’t create the file. Try again.')};
function loadXLSX(){if(window.XLSX)return Promise.resolve();return new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s)})}
async function exportXlsx(btn){btn.disabled=true;btn.textContent='Preparing…';
  try{await loadXLSX();const X=window.XLSX,wb=X.utils.book_new(),L=sorted().reverse(),by=t=>L.filter(e=>e.type===t);
    const add=(n,cols,rows)=>{const ws=X.utils.aoa_to_sheet([cols,...rows]);ws['!cols']=cols.map(c=>({wch:Math.max(12,c.length+2)}));X.utils.book_append_sheet(wb,ws,n)};
    const dt=e=>[isoDate(e.ts),fmtTime(e.ts)];
    add('Log',['Date','Time','Type','Entry','Note'],L.map(e=>[...dt(e),e.type,describe(e).filter(Boolean).join(', '),e.type==='note'?'':e.note||'']));
    add('Notes',['Date','Time','Entry'],by('note').map(e=>[...dt(e),e.text||'']));
    add('Meals',['Date','Time','Meal','What','Note'],by('meal').map(e=>[...dt(e),(MEALS.find(m=>m[0]===e.meal)||[0,''])[1],e.food||'',e.note||'']));
    add('Water',['Date','Time','Amount'],by('water').map(e=>[...dt(e),e.amount||'1 glass']));
    add('Caffeine',['Date','Time','Drink'],by('caffeine').map(e=>[...dt(e),e.drink||'']));
    add('Sleep',['Fell asleep','Woke up','Hours','Rested (1-5)','Note'],by('sleep').filter(e=>e.end).map(e=>[isoDate(e.ts)+' '+fmtTime(e.ts),isoDate(e.end)+' '+fmtTime(e.end),Math.round((e.end-e.ts)/36e3)/100,e.quality||'',e.note||'']));
    add('Mood',['Date','Time','Mood (1-5)','Energy (1-5)','Note'],by('mood').map(e=>[...dt(e),e.mood||'',e.energy||'',e.note||'']));
    add('Workouts',['Date','Time','Workout','Minutes','Note'],by('workout').map(e=>[...dt(e),e.kind||'',e.minutes||'',e.note||'']));
    add('Meds',['Date','Time','Name','Dose'],by('med').map(e=>[...dt(e),e.med||'',e.dose||'']));
    add('Habits',['Date','Time','Habit'],by('habit').map(e=>[...dt(e),e.habit||'']));
    await saveFile('Captains log '+isoDate(Date.now())+'.xlsx',new Blob([X.write(wb,{bookType:'xlsx',type:'array'})]));
  }catch(e){console.error(e);fileErr(e)}finally{btn.disabled=false;btn.textContent='Download spreadsheet (.xlsx)'}}
async function exportBackup(){toast('Preparing backup…');const photos={};for(const e of entries.filter(x=>x.hasPhoto)){const d=await getPhoto(e.id);if(d)photos[e.id]=d}
  const p={...profile};delete p.timer;
  try{await saveFile('Captains log backup '+isoDate(Date.now())+'.json',new Blob([JSON.stringify({app:'caplog',version:1,exported:new Date().toISOString(),profile:p,entries:sorted(),photos})],{type:'application/json'}))}catch(e){fileErr(e)}}
async function restoreBackup(file){let d;try{d=JSON.parse(await file.text())}catch(e){return toast('That file isn’t a Captain’s log backup.')}
  if(!d||d.app!=='caplog'||!Array.isArray(d.entries))return toast('That file isn’t a Captain’s log backup.');
  const have=new Set(entries.map(e=>e.id)),fresh=d.entries.filter(e=>e&&e.id&&e.type&&isFinite(e.ts)),added=fresh.filter(e=>!have.has(e.id)).length;
  if(!await ask(`Restore ${fresh.length} entries? ${added} are new. Anything already in your log stays.`,'Restore'))return;closeSheet();
  const ph=Object.entries(d.photos||{}).filter(([,v])=>typeof v==='string'&&v.startsWith('data:image/'));
  if(!profile.habits&&d.profile){const p={...d.profile,...profile};delete p.timer;saveProfile(p)}
  if(mode==='local'){const m=new Map(entries.map(e=>[e.id,e]));fresh.forEach(e=>m.set(e.id,clean(e)));entries=[...m.values()];lsSave();ph.forEach(([id,v])=>setPhoto(id,v));render();return toast('Backup restored')}
  toast('Restoring…');for(const e of fresh){const {id,...b}=clean(e);await queue(()=>col.doc(id).set(b))}for(const [id,v] of ph)await setPhoto(id,v);toast('Backup restored')}

/* ---------- events ---------- */
function autosize(){const t=$('#quickNote');if(!t)return;t.style.height='auto';t.style.height=Math.min(180,t.scrollHeight)+'px'}
function quickNote(){const t=$('#quickNote');const v=t?t.value.trim():'';if(!v){t&&t.focus();return toast('Write something first.')}t.value='';saveEntry({id:uid(),type:'note',ts:Date.now(),text:v});toast('Logged at '+fmtTime(Date.now()))}
async function onClick(ev){
  const b=ev.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(['google','signIn','signUp','forgot','signOut'].includes(a))return account(a);
  switch(a){
    case 'open':return openSheet(b.dataset.k);
    case 'close':return closeSheet();
    case 'view':view=b.dataset.k;render();return window.scrollTo(0,0);
    case 'edit':{const e=entries.find(x=>x.id===b.dataset.id);if(e)openSheet(e.type,e);return}
    case 'moredays':daysShown+=7;return render();
    case 'quickNote':return quickNote();
    case 'water':{const n=entries.filter(e=>e.type==='water'&&e.ts>=dayStart(Date.now())).length+1;saveEntry({id:uid(),type:'water',ts:Date.now()});return toast(`Water logged. ${n} today.`)}
    case 'habit':{const v=b.dataset.v,ex=entries.find(e=>e.type==='habit'&&e.habit===v&&e.ts>=dayStart(Date.now()));if(ex){deleteEntry(ex.id);return toast('Unchecked')}saveEntry({id:uid(),type:'habit',habit:v,ts:Date.now()});return toast('Nice. '+v+' done.')}
    case 'quickCaf':saveEntry({id:uid(),type:'caffeine',drink:b.dataset.v,ts:fromInput(val('when'))||Date.now()});closeSheet();return toast(b.dataset.v+' logged');
    case 'quickMed':saveEntry({id:uid(),type:'med',med:b.dataset.v,ts:fromInput(val('when'))||Date.now()});closeSheet();return toast(b.dataset.v+' logged');
    case 'pickWork':{const i=sheetBody.querySelector('#kind');i.value=b.dataset.v;return sheetBody.querySelector('#minutes').focus()}
    case 'seg':{const k=b.dataset.key;S[k]=b.dataset.v;b.parentElement.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.v===S[k]));
      if(k==='theme'){themePref=S[k];try{localStorage.setItem(THEME_KEY,themePref)}catch(e){}applyTheme();const sw=sheetBody.querySelector('#paperSw');if(sw)sw.innerHTML=swatchesHTML()}return}
    case 'paper':{paperPref=b.dataset.v;try{localStorage.setItem('caplog:paper',paperPref)}catch(e){}applyTheme();const sw=sheetBody.querySelector('#paperSw');if(sw)sw.innerHTML=swatchesHTML();return}
    case 'save':return doSave();
    case 'del':{if(!await ask('Delete this entry?'))return;const e=S.entry;if(e.hasPhoto)delPhoto(e.id);deleteEntry(e.id);closeSheet();return toast('Deleted')}
    case 'startSleep':{const v=fromInput(val('when'));return startTimer(v||Date.now(),true)}
    case 'stopSleep':return saveSleep(true);
    case 'wake':return wake();
    case 'addPhoto':return sheetBody.querySelector('#photoInput').click();
    case 'removePhoto':S.photo=null;return refreshPhotoBox();
    case 'saveHabits':{const l=val('habits').split(',').map(x=>x.trim()).filter(Boolean);saveProfile({...profile,habits:l});closeSheet();return toast('Habits saved')}
    case 'settings':S={kind:'settings',nudges:profile.nudges===false?'off':'on'};renderSheet();return dlg.showModal();
    case 'saveSettings':{const l=s=>val(s).split(',').map(x=>x.trim()).filter(Boolean);
      saveProfile({...profile,name:val('name')||undefined,habits:l('habits'),meds:l('meds'),nudges:S.nudges==='off'?false:undefined});closeSheet();return toast('Saved')}
    case 'export':return exportXlsx(b);
    case 'backup':return exportBackup();
    case 'restore':return sheetBody.querySelector('#restoreFile').click();
  }
}
app.addEventListener('click',onClick);sheetBody.addEventListener('click',onClick);
dlg.addEventListener('click',ev=>{if(ev.target===dlg)closeSheet()});
app.addEventListener('input',ev=>{if(ev.target.id==='quickNote')autosize()});
app.addEventListener('keydown',ev=>{if(ev.target.id==='quickNote'&&ev.key==='Enter'&&(ev.metaKey||ev.ctrlKey)){ev.preventDefault();quickNote()}});
sheetBody.addEventListener('input',ev=>{if(S.kind==='sleep'&&(ev.target.id==='when'||ev.target.id==='end'))updateSleepTotal()});
sheetBody.addEventListener('change',ev=>{
  if(S.kind==='sleep'&&(ev.target.id==='when'||ev.target.id==='end'))updateSleepTotal();
  if(ev.target.id==='restoreFile'&&ev.target.files[0])restoreBackup(ev.target.files[0]);
  if(ev.target.id==='photoInput'&&ev.target.files[0]){const f=ev.target.files[0];ev.target.value='';const box=sheetBody.querySelector('#photoBox');if(box)box.innerHTML='<p class="hint">Preparing photo…</p>';
    compress(f).then(d=>{S.photo=d;refreshPhotoBox()}).catch(()=>{toast('That photo couldn’t be opened. Try another.');refreshPhotoBox()})}
});
setInterval(()=>{const n=Date.now();
  document.querySelectorAll('[data-clock]').forEach(el=>el.textContent=clock(n-+el.dataset.clock));
  if(n%30000<1000)document.querySelectorAll('[data-since]').forEach(el=>el.textContent=dur(n-+el.dataset.since));
  if(dlg.open&&S.kind==='sleep')updateSleepTotal();
},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&screen==='app'&&!dlg.open&&!(document.activeElement&&document.activeElement.id==='quickNote'))render()});
initStore();
