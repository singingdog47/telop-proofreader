const state = {
  profile: null,
  members: [],
  rules: [],
  proper: [],
  glyphCautions: [],
  readingCautions: [],
  officialNameCautions: [],
  registrationOpen: true
};

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function showMessage(text, type=""){
  const el=document.getElementById("systemMessage");
  el.textContent=text;
  el.className=`system-message ${type}`.trim();
}

function clearMessage(){
  document.getElementById("systemMessage").classList.add("hidden");
}

async function loadAll(){
  clearMessage();
  const dict = await Backend.dictionaries();
  state.rules = dict.rules;
  state.proper = dict.proper;
  state.glyphCautions = dict.glyphCautions;
  state.readingCautions = dict.readingCautions;
  state.officialNameCautions = dict.officialNameCautions;
  state.members = await Backend.members();
  state.registrationOpen = await Backend.registrationStatus();
  render();
}

function render(){
  const toggle=document.getElementById("registrationToggle");
  const label=document.getElementById("registrationLabel");
  if(toggle && label){
    toggle.checked = state.registrationOpen;
    label.textContent = state.registrationOpen ? "新規登録を受付中" : "新規登録を停止中";
  }

  const mb=document.getElementById("membersBody"); mb.innerHTML="";
  state.members.forEach(m=>{
    const self = m.id === state.profile.id;
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${escapeHtml(m.display_name || "")}${self ? ' <span class="self-mark">自分</span>' : ''}</td>
      <td>${escapeHtml(m.email || "")}</td>
      <td>
        <select data-role-user="${m.id}" ${self ? "disabled" : ""}>
          <option value="operator" ${m.role==="operator"?"selected":""}>運用者</option>
          <option value="admin" ${m.role==="admin"?"selected":""}>管理者</option>
        </select>
      </td>
      <td>${escapeHtml(new Date(m.created_at).toLocaleString("ja-JP"))}</td>
      <td>${self ? "" : `<button data-save-role="${m.id}">権限を保存</button>`}</td>`;
    mb.appendChild(tr);
  });

  const pb=document.getElementById("properBody"); pb.innerHTML="";
  state.proper.forEach(p=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(p.variant)}</td><td>${escapeHtml(p.canonical)}</td>
      <td><button class="small-delete" data-kind="proper" data-id="${p.id}">削除</button></td>`;
    pb.appendChild(tr);
  });

  const rb=document.getElementById("rulesBody"); rb.innerHTML="";
  state.rules.forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(r.wrong)}</td><td>${escapeHtml(r.correct)}</td>
      <td><button class="small-delete" data-kind="rules" data-id="${r.id}">削除</button></td>`;
    rb.appendChild(tr);
  });

  const gb=document.getElementById("glyphBody"); gb.innerHTML="";
  state.glyphCautions.forEach(g=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(g.term)}</td><td>${escapeHtml(g.note)}</td>
      <td><button class="small-delete" data-kind="glyphCautions" data-id="${g.id}">削除</button></td>`;
    gb.appendChild(tr);
  });

  const reb=document.getElementById("readingBody"); reb.innerHTML="";
  state.readingCautions.forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(r.term)}</td><td>${escapeHtml(r.reading)}</td><td>${escapeHtml(r.note || "")}</td>
      <td><button class="small-delete" data-kind="readingCautions" data-id="${r.id}">削除</button></td>`;
    reb.appendChild(tr);
  });

  const ob=document.getElementById("officialNameBody"); ob.innerHTML="";
  state.officialNameCautions.forEach(n=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(n.variant)}</td><td>${escapeHtml(n.official)}</td><td>${escapeHtml(n.note || "")}</td>
      <td><button class="small-delete" data-kind="officialNameCautions" data-id="${n.id}">削除</button></td>`;
    ob.appendChild(tr);
  });
}

async function add(kind, record){
  try{
    await Backend.insertDictionary(kind, record);
    await loadAll();
    showMessage("追加しました。", "success");
  }catch(e){
    showMessage(`追加できませんでした: ${e.message}`, "error");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if(!Backend.configured()){
    location.href="./auth.html";
    return;
  }
  Backend.init();
  const s=await Backend.requireSession();
  if(!s) return;

  try{
    state.profile=await Backend.profile();
    if(state.profile.role!=="admin"){
      location.href="./index.html";
      return;
    }
    document.getElementById("userBadge").textContent=`${state.profile.display_name || state.profile.email} / 管理者`;
    await loadAll();
  }catch(e){
    showMessage(`初期化できませんでした: ${e.message}`, "error");
    return;
  }

  document.getElementById("logoutButton").onclick=()=>Backend.signOut();

  document.getElementById("registrationToggle").onchange = async (e) => {
    const desired = e.target.checked;
    e.target.disabled = true;
    try{
      await Backend.setRegistrationStatus(desired);
      state.registrationOpen = desired;
      render();
      showMessage(desired ? "新規登録を受付中にしました。" : "新規登録を停止しました。", "success");
    }catch(err){
      e.target.checked = !desired;
      showMessage(`新規登録設定を変更できませんでした: ${err.message}`, "error");
    }finally{
      e.target.disabled = false;
    }
  };

  document.getElementById("addProper").onclick=()=>{
    const variant=document.getElementById("properWrong").value.trim();
    const canonical=document.getElementById("properCorrect").value.trim();
    if(!variant||!canonical)return;
    add("proper",{variant,canonical}).then(()=>{
      document.getElementById("properWrong").value="";
      document.getElementById("properCorrect").value="";
    });
  };

  document.getElementById("addRule").onclick=()=>{
    const wrong=document.getElementById("ruleWrong").value.trim();
    const correct=document.getElementById("ruleCorrect").value.trim();
    if(!wrong||!correct)return;
    add("rules",{wrong,correct}).then(()=>{
      document.getElementById("ruleWrong").value="";
      document.getElementById("ruleCorrect").value="";
    });
  };

  document.getElementById("addGlyph").onclick=()=>{
    const term=document.getElementById("glyphTerm").value.trim();
    const note=document.getElementById("glyphNote").value.trim();
    if(!term||!note)return;
    add("glyphCautions",{term,note}).then(()=>{
      document.getElementById("glyphTerm").value="";
      document.getElementById("glyphNote").value="";
    });
  };

  document.getElementById("addReading").onclick=()=>{
    const term=document.getElementById("readingTerm").value.trim();
    const reading=document.getElementById("readingValue").value.trim();
    const note=document.getElementById("readingNote").value.trim();
    if(!term||!reading)return;
    add("readingCautions",{term,reading,note}).then(()=>{
      document.getElementById("readingTerm").value="";
      document.getElementById("readingValue").value="";
      document.getElementById("readingNote").value="";
    });
  };

  document.getElementById("addOfficialName").onclick=()=>{
    const variant=document.getElementById("officialVariant").value.trim();
    const official=document.getElementById("officialName").value.trim();
    const note=document.getElementById("officialNote").value.trim();
    if(!variant||!official)return;
    add("officialNameCautions",{variant,official,note}).then(()=>{
      document.getElementById("officialVariant").value="";
      document.getElementById("officialName").value="";
      document.getElementById("officialNote").value="";
    });
  };

  document.body.addEventListener("click", async e=>{
    const del=e.target.closest("[data-kind]");
    if(del){
      if(!confirm("この登録を削除しますか？")) return;
      try{
        await Backend.deleteDictionary(del.dataset.kind, Number(del.dataset.id));
        await loadAll();
        showMessage("削除しました。", "success");
      }catch(err){
        showMessage(`削除できませんでした: ${err.message}`, "error");
      }
      return;
    }

    const roleButton=e.target.closest("[data-save-role]");
    if(roleButton){
      const userId=roleButton.dataset.saveRole;
      const select=document.querySelector(`[data-role-user="${userId}"]`);
      try{
        await Backend.updateRole(userId, select.value);
        await loadAll();
        showMessage("権限を更新しました。", "success");
      }catch(err){
        showMessage(`権限を更新できませんでした: ${err.message}`, "error");
      }
    }
  });
});
