(function(){
  const dbKey = "schoolmanager_db_v16_1";
  const RULES = { mediaMin: 6.0, freqMin: 75 };

  const initialData = {
    users: [
      { id: "u1", role: "admin", name: "Admin Master", email: "admin@school.local", password: "admin123" },
      { id: "u2", role: "prof", name: "Prof. Ana", email: "ana@school.local", password: "prof123", disciplinaId: "d1", profTurmas: ["t1"] },
      { id: "u3", role: "aluno", name: "Carlos Silva", email: "carlos@school.local", password: "aluno123", turmaIdSeed: "t1" }
    ],
    turmas: [
      { id: "t1", nome: "1ºA", ano: 2025, turno: "Manhã" },
      { id: "t2", nome: "2ºB", ano: 2025, turno: "Tarde" }
    ],
    disciplinas: [
      { id: "d1", nome: "Matemática" },
      { id: "d2", nome: "Português" },
      { id: "d3", nome: "História" }
    ],
    matriculas: [],
    notas: [], presencas: [],
    comunicados: [{ id: "c1", autorId: "u2", titulo: "Bem-vindos!", corpo: "Aulas começam dia 05/02.", dataISO: new Date().toISOString() }],
    session: null,
    updatedAt: Date.now() // importante para resolver corrida de cache
  };
  initialData.users.forEach(u=>{ if(u.role==='aluno' && u.turmaIdSeed){ initialData.matriculas.push({ id:'m'+Math.random().toString(16).slice(2), alunoId:u.id, turmaId:u.turmaIdSeed }); delete u.turmaIdSeed; } });

  function getDB(){
    const raw = localStorage.getItem(dbKey);
    if(!raw){ localStorage.setItem(dbKey, JSON.stringify(initialData)); return JSON.parse(JSON.stringify(initialData)); }
    try{ return JSON.parse(raw); } catch(e){ localStorage.setItem(dbKey, JSON.stringify(initialData)); return JSON.parse(JSON.stringify(initialData)); }
  }
  function setDB(db){
    db.updatedAt = Date.now(); // marca data de atualização
    const s = JSON.stringify(db);
    localStorage.setItem(dbKey, s);
    idbSet(IDB_KEY, s).catch(err=>console.warn('Falha ao gravar no IDB', err));
  }
  function uid(p){ return p+Math.random().toString(16).slice(2); }

  // ===== IndexedDB adapter + boot sync =====
  const IDB_NAME = 'schoolmanager_idb';
  const IDB_STORE = 'kv';
  const IDB_KEY = dbKey;

  function idbOpen(){
    return new Promise((res,rej)=>{
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { try{ req.result.createObjectStore(IDB_STORE); }catch(e){} };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function idbGet(key){
    const db = await idbOpen();
    return new Promise((res,rej)=>{
      const tx = db.transaction(IDB_STORE,'readonly').objectStore(IDB_STORE).get(key);
      tx.onsuccess = () => res(tx.result||null);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function idbSet(key, val){
    const db = await idbOpen();
    return new Promise((res,rej)=>{
      const tx = db.transaction(IDB_STORE,'readwrite').objectStore(IDB_STORE).put(val, key);
      tx.onsuccess = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  }

  // Boot: escolher sempre o estado mais novo e preservar sessão
  (async function bootIDB(){
    try{
      const localRaw = localStorage.getItem(dbKey);
      const fromLocal = localRaw ? JSON.parse(localRaw) : null;
      const fromIDB = await idbGet(IDB_KEY);
      const parsedIDB = fromIDB ? JSON.parse(fromIDB) : null;

      const pickNewest = (a,b)=>{
        if(a && b){
          const au = a.updatedAt || 0, bu = b.updatedAt || 0;
          return au >= bu ? a : b;
        }
        return a || b || null;
      };

      let chosen = pickNewest(fromLocal, parsedIDB) || initialData;

      // Se local tinha sessão e o escolhido não, preserve a sessão
      if(fromLocal?.session && !chosen.session){
        chosen.session = fromLocal.session;
        chosen.updatedAt = Date.now();
      }

      // Persistir escolhido nos dois
      const s = JSON.stringify(chosen);
      localStorage.setItem(dbKey, s);
      await idbSet(IDB_KEY, s);
    }catch(e){
      console.warn('IndexedDB indisponível, usando somente localStorage', e);
      if(!localStorage.getItem(dbKey)){
        localStorage.setItem(dbKey, JSON.stringify(initialData));
      }
    }
  })();

  const A = {
    RULES,
    signIn(email, password){
      const db=getDB();
      const u=db.users.find(x=>x.email===email && x.password===password);
      if(!u) return null;
      db.session={ userId:u.id, ts:Date.now() };
      setDB(db); return u;
    },
    signOut(){
      const db=getDB(); db.session=null; setDB(db);
      try{ sessionStorage.clear(); }catch(e){}
    },
    currentUser(){ const db=getDB(); if(!db.session) return null; return db.users.find(u=>u.id===db.session.userId)||null; },
    listUsers(){ return getDB().users; },
    getTurmaOfAluno(alunoId){
      const db=getDB(); const m=db.matriculas.find(x=>x.alunoId===alunoId); return m? m.turmaId : null;
    },
    alunosByTurma(turmaId){
      const db=getDB();
      const alunosIds = db.matriculas.filter(m=>m.turmaId===turmaId).map(m=>m.alunoId);
      return db.users.filter(u=>u.role==='aluno' && alunosIds.includes(u.id));
    },
    createUser(u){
      const db=getDB(); u.id=uid('u'); 
      if(u.role==='prof' && u.profTurmas && !Array.isArray(u.profTurmas)){ u.profTurmas=[u.profTurmas]; }
      db.users.push(u);
      if(u.role==='aluno' && u.turmaId){
        db.matriculas.push({ id: uid('m'), alunoId: u.id, turmaId: u.turmaId });
      }
      setDB(db); return u;
    },
    updateUser(id, patch){
      const db=getDB(); const i=db.users.findIndex(u=>u.id===id); if(i<0) return null;
      const prev=db.users[i];
      const merged = {...prev, ...patch};
      if(merged.role==='prof' && merged.profTurmas && !Array.isArray(merged.profTurmas)){ merged.profTurmas=[merged.profTurmas]; }
      db.users[i]=merged;
      if(db.users[i].role==='aluno' && patch.turmaId!==undefined){
        const mIdx = db.matriculas.findIndex(m=>m.alunoId===id);
        if(mIdx>=0) db.matriculas[mIdx].turmaId = patch.turmaId;
        else db.matriculas.push({ id: uid('m'), alunoId: id, turmaId: patch.turmaId });
      }
      setDB(db); return db.users[i];
    },
    deleteUser(id){ const db=getDB(); db.users=db.users.filter(u=>u.id!==id);
      db.matriculas=db.matriculas.filter(m=>m.alunoId!==id);
      db.notas=db.notas.filter(n=>n.alunoId!==id && n.profId!==id);
      db.presencas=db.presencas.filter(p=>p.alunoId!==id && p.profId!==id);
      setDB(db);
    },
    turmas: { list(){ return getDB().turmas; },
      create(t){ const db=getDB(); t.id=uid('t'); db.turmas.push(t); setDB(db); return t; },
      remove(id){ const db=getDB(); db.turmas=db.turmas.filter(t=>t.id!==id); db.matriculas=db.matriculas.filter(m=>m.turmaId!==id); setDB(db); } },
    disciplinas: { list(){ return getDB().disciplinas; },
      create(d){ const db=getDB(); d.id=uid('d'); db.disciplinas.push(d); setDB(db); return d; },
      remove(id){ const db=getDB(); db.disciplinas=db.disciplinas.filter(d=>d.id!==id);
        db.users=db.users.map(u=> u.role==='prof' && u.disciplinaId===id ? {...u, disciplinaId:undefined} : u);
        setDB(db);
      } },
    matriculas: { list(){ return getDB().matriculas; } },
    notas: { list(){ return getDB().notas; }, create(n){ const db=getDB(); n.id=uid('n'); db.notas.push(n); setDB(db); return n; }, listByAluno(id){ return getDB().notas.filter(n=>n.alunoId===id); } },
    presencas: {
      list(){ return getDB().presencas; },
      marcarBatch(lista){ const db=getDB(); for(const p of lista){ db.presencas.push({ id:uid('p'), ...p }); } setDB(db); },
      marcar(p){ const db=getDB(); p.id=uid('p'); db.presencas.push(p); setDB(db); return p; },
      listByAluno(id){ return getDB().presencas.filter(p=>p.alunoId===id); },
      resumoPorDisciplina(alunoId){
        const db=getDB();
        const porDisc = {};
        for(const p of db.presencas.filter(x=>x.alunoId===alunoId)){
          if(!porDisc[p.disciplinaId]) porDisc[p.disciplinaId]={P:0,F:0,total:0};
          if(p.status==='P') porDisc[p.disciplinaId].P++; else porDisc[p.disciplinaId].F++;
          porDisc[p.disciplinaId].total++;
        }
        return porDisc;
      }
    },
    comunicados: { list(){ return getDB().comunicados.sort((a,b)=>new Date(b.dataISO)-new Date(a.dataISO)); },
      publicar(c){ const db=getDB(); c.id=uid('c'); c.dataISO=new Date().toISOString(); db.comunicados.push(c); setDB(db); return c; } },

    calcMediaAlunoDisciplina(alunoId, disciplinaId){
      const db=getDB();
      const itens = db.notas.filter(n=>n.alunoId===alunoId && n.disciplinaId===disciplinaId);
      if(!itens.length) return null;
      const media = itens.reduce((a,b)=>a+b.valor,0)/itens.length;
      return Math.round(media*100)/100;
    },
    calcFreqAlunoDisciplina(alunoId, disciplinaId){
      const r = A.presencas.resumoPorDisciplina(alunoId)[disciplinaId];
      if(!r || !r.total) return 0; return Math.round((r.P/r.total)*100);
    },
    situacaoAlunoDisciplina(alunoId, disciplinaId){
      const m = A.calcMediaAlunoDisciplina(alunoId, disciplinaId);
      const f = A.calcFreqAlunoDisciplina(alunoId, disciplinaId);
      if(m===null) return {status:'Sem nota', klass:'warn', media:null, freq:f};
      if(m>=RULES.mediaMin && f>=RULES.freqMin) return {status:'Aprovado', klass:'ok', media:m, freq:f};
      if(m< RULES.mediaMin && f< RULES.freqMin) return {status:'Reprovado', klass:'bad', media:m, freq:f};
      return {status:'Recuperação', klass:'warn', media:m, freq:f};
    },

    guard(roles){
      const u=A.currentUser();
      if(!u){ location.href='index.html'; return; }
      if(roles && !roles.includes(u.role)){ alert('Acesso negado.'); location.href='index.html'; }
    },
    headerHTML(){
      const u=A.currentUser();
      const roleName = u ? (u.role==='admin'?'Administrador':u.role==='prof'?'Professor':'Aluno') : '';
      const menus = {
        admin:[['admin.html','Dashboard'],['usuarios.html','Usuários'],['turmas.html','Turmas'],['disciplinas.html','Disciplinas'],['comunicados.html','Comunicados']],
        prof:[['professor.html','Dashboard'],['comunicados.html','Comunicados']],
        aluno:[['aluno.html','Minha Área'],['comunicados.html','Comunicados']]
      };
      const nav = u ? (menus[u.role]||[]) : [];
      return `<header class="header"><div class="nav container">
        <div class="brand"><span class="logo"></span><span>SchoolManager</span></div>
        <nav style="display:flex;gap:10px;flex-wrap:wrap">
          ${nav.map(([h,l])=>`<a class="btn ghost" href="${h}">${l}</a>`).join('')}
        </nav>
        <div style="display:flex;align-items:center;gap:10px">
          ${u? `<div style="text-align:right"><div style="font-weight:600">${u.name}</div><div style="font-size:12px">${roleName}</div></div>`:''}
          ${u? `<button class="btn secondary" id="logoutBtn">Sair</button>`:`<a class="btn" href="index.html">Entrar</a>`}
        </div>
      </div></header>`;
    },
    mountHeader(){
      const hdr=document.getElementById('hdr');
      if(hdr){
        hdr.innerHTML=A.headerHTML();
        const b=document.getElementById('logoutBtn');
        if(b){ b.onclick=()=>{ A.signOut(); location.replace('index.html'); }; }
      }
    },

    download(filename, content, mime='text/plain'){
      const blob = new Blob([content], {type: mime});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click();
      setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 500);
    },

    openBoletimAlunoPrint(alunoId){
      const db=getDB();
      const user = db.users.find(u=>u.id===alunoId);
      const turmaId = (db.matriculas.find(m=>m.alunoId===alunoId)||{}).turmaId;
      const turma = db.turmas.find(t=>t.id===turmaId);
      const discList = db.disciplinas;
      const discMap = Object.fromEntries(discList.map(d=>[d.id,d.nome]));

      function cardResumo(did){
        const dName = discMap[did];
        const m = A.calcMediaAlunoDisciplina(alunoId, did);
        const f = A.calcFreqAlunoDisciplina(alunoId, did);
        const sit = A.situacaoAlunoDisciplina(alunoId, did);
        const icon = sit.status==='Aprovado'?'✓':(sit.status==='Recuperação'?'!':'✕');
        const color = sit.klass==='ok' ? '#10b981' : (sit.klass==='warn' ? '#fb923c' : '#ef4444');
        return `<div class="box ${sit.klass}">
          <div class="headrow">
            <strong>${dName}</strong>
            <span class="pill" style="border-color:${color};color:${color}"><span class="ico">${icon}</span>${sit.status}</span>
          </div>
          <div class="row"><span>Média</span><b>${m??'-'}</b></div>
          <div class="row"><span>Frequência</span><b>${f}%</b></div>
          <div class="bar"><div style="width:${f}%;background:${color}"></div></div>
        </div>`;
      }

      const w=window.open('','_blank','width=900,height=1200');
      const html=`<!doctype html><html><head><meta charset="utf-8"><title>Boletim - ${user.name}</title>
        <style>
          :root{ --ok:#10b981; --warn:#fb923c; --bad:#ef4444 }
          body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;margin:28px;color:#111}
          .brand{display:flex;align-items:center;gap:10px;font-weight:800}
          .logo{width:24px;height:24px;border-radius:6px;background:conic-gradient(from 0deg,#c1121f,#f97316,#06b6d4,#8b5cf6,#c1121f)}
          .top{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #c1121f;padding-bottom:10px;margin-bottom:16px}
          .meta{font-size:12px;color:#555}
          .grid{display:grid;gap:12px;grid-template-columns:repeat(3,minmax(0,1fr))}
          @media print {.no-print{display:none} .grid{grid-template-columns:repeat(3,1fr)}}
          .box{border:1px solid #eaeaf0;border-radius:12px;padding:12px;background:#fff}
          .box.ok{border-left:4px solid var(--ok)} .box.warn{border-left:4px solid var(--warn)} .box.bad{border-left:4px solid var(--bad)}
          .headrow{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
          .pill{display:inline-flex;align-items:center;gap:6px;border:1px solid;border-radius:999px;padding:2px 8px;font-size:12px}
          .ico{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:999px;background:#0001}
          .row{display:flex;justify-content:space-between;margin:2px 0;color:#222}
          .bar{height:8px;background:#eee;border-radius:999px;overflow:hidden;margin-top:6px}
          .bar>div{height:100%}
          .section{margin-top:14px}
        </style>
      </head><body>
        <div class="top">
          <div class="brand"><span class="logo"></span> SchoolManager</div>
          <div><strong>Boletim (Resumo)</strong><div class="meta">${new Date().toLocaleString()}</div></div>
        </div>
        <div class="section">
          <div class="row" style="display:flex;gap:18px">
            <div><strong>Aluno:</strong> ${user.name}</div>
            <div><strong>Turma:</strong> ${turma? turma.nome+' ('+turma.turno+')' : '-'}</div>
          </div>
        </div>
        <div class="section">
          <h3 style="margin:10px 0 8px">Resumo por Disciplina</h3>
          <div class="grid">
            ${discList.map(d=>cardResumo(d.id)).join('')}
          </div>
        </div>
        <div style="margin-top:24px;text-align:right" class="no-print">
          <button onclick="window.print()" style="background:#c1121f;color:#fff;padding:10px 14px;border:none;border-radius:10px;cursor:pointer">Imprimir / Salvar como PDF</button>
        </div>
        <script>setTimeout(()=>window.print(), 500)</script>
      </body></html>`;
      w.document.open(); w.document.write(html); w.document.close();
    },

    openBoletimTurmaPrint(turmaId, disciplinaId){
      const db=getDB();
      const turma = db.turmas.find(t=>t.id===turmaId);
      const alunos = A.alunosByTurma(turmaId);
      const discMap = Object.fromEntries(db.disciplinas.map(d=>[d.id,d.nome]));
      const w=window.open('','_blank','width=900,height=1200');
      function pageAluno(a){
        const dIds = db.disciplinas.filter(d=>!disciplinaId || d.id===disciplinaId).map(d=>d.id);
        const cards = dIds.map(did=>{
          const m=A.calcMediaAlunoDisciplina(a.id, did);
          const f=A.calcFreqAlunoDisciplina(a.id, did);
          const sit=A.situacaoAlunoDisciplina(a.id, did);
          return `<div style="border:1px solid #ddd;border-radius:12px;padding:10px">
              <div style="display:flex;justify-content:space-between"><strong>${discMap[did]}</strong><span>${sit.status==='Aprovado'?'✓':(sit.status==='Recuperação'?'!':'✕')} ${sit.status}</span></div>
              <div style="font-size:12px;color:#555;margin:4px 0">Média: ${m??'-'} • Frequência: ${f}%</div>
              <div style="height:8px;background:#eee;border-radius:999px;overflow:hidden"><div style="height:100%;background:#c1121f;width:${f}%"></div></div>
            </div>`;
        }).join('');
        return `<section style="page-break-after:always">
          <h2 style="margin:0 0 8px">${a.name}</h2>
          <div style="display:grid;gap:12px;grid-template-columns:repeat(3,minmax(0,1fr))">${cards}</div>
        </section>`;
      }
      const html=`<!doctype html><html><head><meta charset="utf-8"><title>Boletim Turma ${turma.nome}</title>
      <style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;margin:24px;color:#111}
        .head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #c1121f;padding-bottom:10px;margin-bottom:16px}
        .brand{display:flex;align-items:center;gap:8px;font-weight:800}
        .logo{width:24px;height:24px;border-radius:6px;background:#c1121f;display:inline-block}
        .grid{display:grid;gap:12px;grid-template-columns:repeat(3,minmax(0,1fr))}
        @media print {.no-print{display:none}}
      </style></head><body>
        <div class="head">
          <div class="brand"><span class="logo"></span> SchoolManager</div>
          <div><strong>Boletim da Turma</strong><div style="font-size:12px;color:#555">${new Date().toLocaleString()}</div></div>
        </div>
        <div style="margin-bottom:10px"><strong>Turma:</strong> ${turma.nome} • <strong>Disciplina:</strong> ${disciplinaId? discMap[disciplinaId]:'Todas'}</div>
        ${alunos.map(pageAluno).join('')}
        <div style="text-align:right" class="no-print"><button onclick="window.print()" style="background:#c1121f;color:#fff;padding:10px 14px;border:none;border-radius:10px;cursor:pointer">Imprimir / Salvar como PDF</button></div>
        <script>setTimeout(()=>window.print(), 600)</script>
      </body></html>`;
      w.document.open(); w.document.write(html); w.document.close();
    }
  };

  // Toasts
  function ensureToastWrap(){ let w=document.querySelector('.toast-wrap'); if(!w){ w=document.createElement('div'); w.className='toast-wrap'; document.body.appendChild(w); } return w; }
  function showToast(msg, type='ok'){
    const wrap=ensureToastWrap(); const el=document.createElement('div'); el.className='toast '+type;
    const icon= type==='ok'?'✓':(type==='warn'?'!':'✕'); el.innerHTML = `<span class="icon">${icon}</span><span>${msg}</span>`;
    wrap.appendChild(el); setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(6px)'; el.style.transition='all .3s'; }, 3000);
    setTimeout(()=>{ el.remove(); }, 3400);
  }
  A.toast = showToast;

  window.App = A;
})();
