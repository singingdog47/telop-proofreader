const state = {
  rules: [],
  proper: [],
  glyphCautions: [],
  readingCautions: [],
  officialNameCautions: [],
  lastResults: [],
  lastTargets: [],
  profile: null
};

function normalize(s){
  return String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function extractTwTargets(source){
  const rawLines = String(source ?? "").split(/\r?\n/);
  const targets = [];
  let inTwBlock = false;

  rawLines.forEach((rawLine, index) => {
    const normalized = String(rawLine ?? "").normalize("NFKC");
    const trimmed = normalized.trim();

    if(!trimmed){
      inTwBlock = false;
      return;
    }

    // 「4桁の数字 + TW」で始まる行をテロップ開始行として扱う。
    // 全角数字・全角英字も NFKC 正規化後に判定する。
    const tw = trimmed.match(/^(\d{4})\s+TW(?:\s+|$)(.*)$/i);
    if(tw){
      inTwBlock = true;
      const body = (tw[2] || "").trim();
      if(body){
        targets.push({
          lineNo:index + 1,
          telopNo:tw[1],
          text:body,
          isContinuation:false
        });
      }
      return;
    }

    // 別の4桁管理番号が始まったら、TWブロックを終了。
    if(/^\d{4}(?:\s|$)/.test(trimmed)){
      inTwBlock = false;
      return;
    }

    // << ... >>、【...】、※... など明らかな管理・注記行で終了。
    if(/^(?:<<|【|※)/.test(trimmed)){
      inTwBlock = false;
      return;
    }

    // TW行の直後に続く改行テロップも同じ検証対象に含める。
    // 添付例の「Directed by ...」のような継続行を想定。
    if(inTwBlock){
      targets.push({
        lineNo:index + 1,
        telopNo:"",
        text:trimmed,
        isContinuation:true
      });
    }
  });

  return {targets, rawLineCount:rawLines.filter(x=>x.trim()).length};
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function showSystemMessage(text, type=""){
  const el = document.getElementById("systemMessage");
  el.textContent = text;
  el.className = `system-message ${type}`.trim();
}

function clearSystemMessage(){
  document.getElementById("systemMessage").classList.add("hidden");
}

function isKnownProperCandidate(candidate){
  const c = normalize(candidate);
  if(!c) return false;
  return state.proper.some(p => {
    const a = normalize(p.wrong);
    const b = normalize(p.correct);
    return c === a || c === b || a.includes(c) || b.includes(c) || c.includes(a) || c.includes(b);
  });
}

function detectRoleAndPersonCandidates(text){
  const normalized = normalize(text);
  const out = [];

  const rolePattern = /([一-龠々ヶヵぁ-んァ-ヶーA-Za-z0-9・]+?(?:アドバイザー|コンサルタント|ジャーナリスト|アナウンサー|キャスター|ディレクター|プロデューサー|フォトグラファー|デザイナー|評論家|専門家|研究家|料理研究家|気象予報士|教授|准教授|講師|医師|医者|弁護士|税理士|会計士|建築士|作家|脚本家|監督|社長|会長|代表|店主|院長))/;
  const roleMatch = normalized.match(rolePattern);

  // 日本語名は「漢字のみ」に限定しない。カタカナ+漢字、漢字+カタカナにも対応。
  const jpNameCore = "[一-龠々ァ-ヶー]{2,16}";
  const honorificRe = new RegExp(`(${jpNameCore})(先生|氏|さん|様|博士)(?:\\s|$|[、。,.!！?？])`);
  const honorificMatch = normalized.match(honorificRe);

  let roleNameMatch = null;
  if(roleMatch){
    const tail = normalized.slice((roleMatch.index || 0) + roleMatch[0].length).trim();
    roleNameMatch = tail.match(new RegExp(`^(${jpNameCore})(先生|氏|さん|様|博士)?(?:\\s|$|[、。,.!！?？])`));
  }

  if(roleMatch){
    out.push({
      type:"肩書き候補",
      value:roleMatch[1],
      confidence:"中",
      why:"人名の前に置かれる肩書き・職種表記の可能性があります。肩書きの正式表記や番組内表記ルールを確認してください。"
    });
  }

  const person = honorificMatch
    ? {value:honorificMatch[1], honorific:honorificMatch[2], confidence:"高"}
    : roleNameMatch
      ? {value:roleNameMatch[1], honorific:roleNameMatch[2] || "", confidence:roleNameMatch[2] ? "高" : "中"}
      : null;

  if(person){
    out.push({
      type:"人名候補",
      value:person.value,
      confidence:person.confidence,
      why:person.honorific
        ? `「${person.honorific}」が付いているため人名の可能性が高いです。姓名の漢字・カナを含む正式表記を確認してください。`
        : "肩書きの直後にあるため人名の可能性があります。姓名の漢字・カナを含む正式表記を確認してください。"
    });
  }

  return out;
}

function detectCreditStructure(text){
  const normalized = normalize(text);
  const knownCredits = [
    "Directed by","Produced by","Written by","Music by","Edited by",
    "Created by","Narrated by","Photography by","Presented by"
  ];

  // 正しいクレジット表現なら、その英語部分は固有名詞候補から除外し、後続を人名候補として扱う。
  for(const credit of knownCredits){
    const re = new RegExp(`^${credit.replace(" ", "\\s+")}\\s+(.+)$`, "i");
    const m = normalized.match(re);
    if(m){
      return {credit, rawCredit:normalized.slice(0, normalized.length - m[1].length).trim(), name:m[1].trim(), spellingIssue:null};
    }
  }

  // "Driected by" など、既知のクレジット表現に近い綴りも検出。
  const lead = normalized.match(/^([A-Za-z]+)\s+([A-Za-z]+)\s+(.+)$/);
  if(lead && lead[2].toLowerCase() === "by"){
    const raw = `${lead[1]} ${lead[2]}`;
    let best = null;
    for(const credit of knownCredits){
      const d = levenshtein(raw.toLowerCase(), credit.toLowerCase());
      if(!best || d < best.d) best = {credit, d};
    }
    if(best && best.d > 0 && best.d <= 2){
      return {
        credit:best.credit,
        rawCredit:raw,
        name:lead[3].trim(),
        spellingIssue:{wrong:raw, correct:best.credit}
      };
    }
  }
  return null;
}

function looksLikePersonName(value){
  const v = normalize(value).replace(/(?:先生|氏|さん|様|博士)$/,"").trim();
  if(!v) return false;
  if(/^[一-龠々ァ-ヶー]{2,16}$/.test(v) && /[一-龠々]/.test(v)) return true;
  if(/^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}$/.test(v)) return true;
  return false;
}

function detectParentheticalIdentity(text){
  const normalized = normalize(text);
  const m = normalized.match(/^([^（）()]{2,24})[（(]([^（）()]{2,30})[）)]$/);
  if(!m) return [];

  const left = m[1].trim();
  const right = m[2].trim();
  const out = [];

  // 左側は「氏名 + （所属/グループ）」のテロップで人名になりやすい。
  // ひらがな・カタカナを含む芸名にも対応。ただし断定せず候補扱い。
  if(/^[一-龠々ぁ-んァ-ヶー・]{2,20}$/.test(left)){
    out.push({
      type:"人名候補",
      value:left,
      confidence:/[一-龠々]/.test(left) ? "中" : "低",
      why:"括弧の外側にあり、人物名＋所属・グループ表記の構造で使われる可能性があります。正式な氏名・芸名表記を確認してください。"
    });
  }

  // 括弧内は所属・団体・コンビ名等で使われることが多い。
  // 何者かまではルールだけで断定しない。
  if(/^[一-龠々ぁ-んァ-ヶーA-Za-z0-9・&＆\s]{2,30}$/.test(right)){
    out.push({
      type:"所属・団体候補",
      value:right,
      confidence:"中",
      why:"人物名の後ろの括弧内にあり、所属・団体名・コンビ名などの可能性があります。正式表記を確認してください。"
    });
  }

  return out;
}

function detectUnknownProperCandidates(text, exclusions=[]){
  const candidates = [];
  const controlTokens = ["TW","T.W.","TEL","TEXT","テロップ"];
  exclusions = [...exclusions, ...controlTokens];
  const add = (value, confidence, why) => {
    const v = value.trim();
    if(!v || v.length < 2 || isKnownProperCandidate(v)) return;
    if(exclusions.some(e => {
      const x = normalize(e);
      return x && (x === v || x.includes(v) || v.includes(x));
    })) return;
    if(candidates.some(x => x.value === v)) return;
    candidates.push({value:v, confidence, why});
  };

  const geoOrg = text.match(/[一-龠々ヶヵぁ-んァ-ヶーA-Za-z0-9・.＆&]+(?:都|道|府|県|市|区|町|村|郡|駅|空港|公園|通り|川|河|山|岳|湖|湾|島|大学|高校|中学校|小学校|病院|銀行|証券|放送|テレビ|新聞|庁|省|局|協会|連盟|研究所|センター|ホテル|ホール|劇場|美術館|博物館)/g) || [];
  geoOrg.forEach(v => add(v, "高", "地名・組織・施設名で使われやすい接尾辞を含みます。"));

  // 通常の英文先頭語を固有名詞扱いしない。略語・CamelCase・記号を含む名称を中心に拾う。
  const latin = text.match(/\b(?:[A-Z]{2,}|[A-Za-z]+[A-Z][A-Za-z0-9]*|[A-Za-z0-9]+(?:[.\-][A-Za-z0-9]+)+)\b/g) || [];
  latin.forEach(v => add(v, "中", "英字の略語・ブランド名・団体名などの可能性があります。"));

  const kata = text.match(/[ァ-ヶー]{4,}/g) || [];
  const genericRoleWords = new Set([
    "アドバイザー","コンサルタント","ジャーナリスト","アナウンサー","キャスター",
    "ディレクター","プロデューサー","フォトグラファー","デザイナー"
  ]);
  kata.forEach(v => {
    if(genericRoleWords.has(v)) return;
    add(v, "低", "カタカナの固有名詞・商品名・人名等の可能性があります。");
  });

  const quoted = [...text.matchAll(/[「『“"]([^」』”"]{2,30})[」』”"]/g)].map(m=>m[1]);
  quoted.forEach(v => add(v, "低", "かぎ括弧内の名称・作品名等の可能性があります。"));

  return candidates;
}

function levenshtein(a,b){
  a = normalize(a); b = normalize(b);
  const dp = Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++) dp[i][0]=i;
  for(let j=0;j<=b.length;j++) dp[0][j]=j;
  for(let i=1;i<=a.length;i++){
    for(let j=1;j<=b.length;j++){
      const c = a[i-1]===b[j-1]?0:1;
      dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+c);
    }
  }
  return dp[a.length][b.length];
}

function checkLine(line, lineNo){
  const out = [];
  const text = line.trim();
  if(!text) return out;

  for(const r of state.rules){
    if(text.includes(r.wrong)){
      out.push({
        line:lineNo, verdict:"NG", type:"表記ルール", confidence:"高", source:text,
        suggestion:text.split(r.wrong).join(r.correct),
        reason:`「${r.wrong}」は登録済みNG表記です。`
      });
    }
  }

  for(const p of state.proper){
    if(text.includes(p.wrong)){
      out.push({
        line:lineNo, verdict:"注意", type:"固有名詞", confidence:"高", source:text,
        suggestion:text.split(p.wrong).join(p.correct),
        reason:`登録済み正式表記「${p.correct}」と異なります。`
      });
    }
  }

  for(const n of state.officialNameCautions){
    if(text.includes(n.variant)){
      out.push({
        line:lineNo, verdict:"注意", type:"正式名称注意", confidence:"高", source:text,
        suggestion:text.split(n.variant).join(n.official),
        reason:`「${n.variant}」は「${n.official}」の可能性があります。${n.note || "正式名称を確認してください。"}`
      });
    }
  }

  for(const r of state.readingCautions){
    if(text.includes(r.term)){
      out.push({
        line:lineNo, verdict:"注意", type:"読み・ルビ注意", confidence:"高", source:text,
        suggestion:`${r.term}（${r.reading}）`,
        reason:`「${r.term}」の読みは「${r.reading}」です。${r.note || "読み・ルビを確認してください。"}`
      });
    }
  }

  for(const g of state.glyphCautions){
    if(text.includes(g.term)){
      out.push({
        line:lineNo, verdict:"注意", type:"字体注意", confidence:"高", source:text,
        suggestion:"",
        reason:`「${g.term}」: ${g.note}`
      });
    }
  }

  const exclusions = [];

  const parentheticalCandidates = detectParentheticalIdentity(text);
  parentheticalCandidates.forEach(c => exclusions.push(c.value));
  for(const c of parentheticalCandidates){
    if(isKnownProperCandidate(c.value)) continue;
    out.push({
      line:lineNo,
      verdict:"注意",
      type:c.type,
      confidence:c.confidence,
      source:text,
      suggestion:"",
      reason:`「${c.value}」は${c.type === "人名候補" ? "人名" : "所属・団体"}として確認すべき候補です。${c.why}`
    });
  }

  const creditStructure = detectCreditStructure(text);
  if(creditStructure){
    exclusions.push(creditStructure.credit, creditStructure.rawCredit, creditStructure.name);

    if(creditStructure.spellingIssue){
      out.push({
        line:lineNo,
        verdict:"NG",
        type:"英文スペル",
        confidence:"高",
        source:text,
        suggestion:text.replace(creditStructure.spellingIssue.wrong, creditStructure.spellingIssue.correct),
        reason:`クレジット表現「${creditStructure.spellingIssue.wrong}」は「${creditStructure.spellingIssue.correct}」の綴り違いの可能性が高いです。`
      });
    }

    if(looksLikePersonName(creditStructure.name) && !isKnownProperCandidate(creditStructure.name)){
      out.push({
        line:lineNo,
        verdict:"注意",
        type:"人名候補",
        confidence:"高",
        source:text,
        suggestion:"",
        reason:`「${creditStructure.name}」は「${creditStructure.credit}」の後に置かれているため、人名として確認すべき候補です。正式な姓名表記を確認してください。`
      });
    }
  }

  const rolePersonCandidates = detectRoleAndPersonCandidates(text);
  rolePersonCandidates.forEach(c => exclusions.push(c.value));
  for(const c of rolePersonCandidates){
    const known = isKnownProperCandidate(c.value);
    if(known) continue;
    if(out.some(x => x.type === c.type && x.reason.includes(`「${c.value}」`))) continue;
    out.push({
      line:lineNo,
      verdict:"注意",
      type:c.type,
      confidence:c.confidence,
      source:text,
      suggestion:"",
      reason:`「${c.value}」は${c.type === "人名候補" ? "人名" : "肩書き"}として確認すべき候補です。${c.why}`
    });
  }

  const unknownProper = detectUnknownProperCandidates(text, exclusions);
  for(const c of unknownProper){
    out.push({
      line:lineNo, verdict:"注意", type:"未登録固有名詞", confidence:c.confidence, source:text,
      suggestion:"",
      reason:`「${c.value}」は固有名詞の可能性があります。${c.why} 正式表記を確認してください。`
    });
  }

  for(const c of unknownProper){
    const looksLikePlace = /(?:都|道|府|県|市|区|町|村|郡|駅|川|河|山|岳|湖|湾|島)$/.test(c.value);
    const hasRegisteredReading = state.readingCautions.some(r => r.term === c.value);
    if(looksLikePlace && !hasRegisteredReading){
      out.push({
        line:lineNo, verdict:"注意", type:"読み要確認",
        confidence:c.confidence === "高" ? "中" : "低",
        source:text, suggestion:"",
        reason:`「${c.value}」は地名の可能性があります。読み方・ルビは推測せず、自治体・公式資料などで確認してください。`
      });
    }
  }

  const tokens = text.split(/[、。,.!！?？「」『』（）()\s]+/).filter(Boolean);
  for(const token of tokens){
    if(token.length < 4) continue;
    let best = null;
    for(const p of state.proper){
      const d = levenshtein(token, p.correct);
      const threshold = Math.max(1, Math.floor(p.correct.length * 0.18));
      if(d > 0 && d <= threshold){
        if(!best || d < best.d) best = {d, correct:p.correct};
      }
    }
    if(best && !out.some(x=>x.type==="固有名詞" && x.suggestion.includes(best.correct))){
      out.push({
        line:lineNo, verdict:"注意", type:"固有名詞候補", confidence:"中", source:text,
        suggestion:best.correct,
        reason:`「${token}」は登録済み固有名詞「${best.correct}」に近い表記です。正式表記を確認してください。`
      });
    }
  }

  return out;
}

function confidenceClass(confidence){
  if(confidence === "高") return "confidence-high";
  if(confidence === "中") return "confidence-medium";
  return "confidence-low";
}

function confidenceDescription(confidence){
  if(confidence === "高") return "登録済み辞書・明示ルール等に基づく高確度の指摘";
  if(confidence === "中") return "類似判定・パターン判定に基づく確認推奨";
  return "推定要素が大きい候補。誤検出の可能性があるため目視確認";
}

function renderResults(results){
  const body = document.getElementById("resultsBody");
  body.innerHTML="";
  results.forEach(r=>{
    const tr=document.createElement("tr");
    const verdictCls = r.verdict==="NG"?"ng":"warn";
    const confidence = r.confidence || "低";
    const confCls = confidenceClass(confidence);
    tr.classList.add(confCls);
    tr.innerHTML = `
      <td>${r.line}</td>
      <td><span class="badge ${verdictCls}">${r.verdict}</span></td>
      <td>${escapeHtml(r.type)}</td>
      <td><span class="confidence-badge ${confCls}" title="${escapeHtml(confidenceDescription(confidence))}">確信度 ${confidence}</span></td>
      <td>${escapeHtml(r.source)}</td>
      <td>${escapeHtml(r.suggestion)}</td>
      <td>${escapeHtml(r.reason)}</td>`;
    body.appendChild(tr);
  });

  const counts = {高:0, 中:0, 低:0};
  results.forEach(r => counts[r.confidence || "低"]++);
  const summary = document.getElementById("summary");
  if(results.length){
    summary.innerHTML = `
      <strong>${results.length}件</strong>の注意・指摘があります。
      <span class="summary-count high">高 ${counts.高}</span>
      <span class="summary-count medium">中 ${counts.中}</span>
      <span class="summary-count low">低 ${counts.低}</span>
      ${counts.低 ? '<span class="low-note">※ 確信度「低」は誤検出の可能性があるため、特に目視確認してください。</span>' : ''}
    `;
  } else {
    summary.textContent = "検証対象内では、登録済みルールによる指摘はありません。";
  }
}

function renderLogs(logs){
  const body = document.getElementById("logBody");
  body.innerHTML="";
  logs.forEach(l=>{
    const tr=document.createElement("tr");
    const dt = new Date(l.created_at).toLocaleString("ja-JP");
    tr.innerHTML=`<td>${escapeHtml(dt)}</td><td>${escapeHtml(l.operator_name)}</td><td>${l.line_count}</td><td>${l.issue_count}</td>`;
    body.appendChild(tr);
  });
}

function makeAiPrompt(){
  const rows = state.lastResults.filter(x =>
    ["英文スペル","人名候補","肩書き候補","所属・団体候補","固有名詞候補","未登録固有名詞","字体注意","読み・ルビ注意","読み要確認","正式名称注意"].includes(x.type)
  );
  const src = state.lastTargets.map(t => `${t.lineNo}行目: ${t.text}`).join("\n");
  const focus = rows.map(r=>`- ${r.line}行目 [確信度:${r.confidence || "低"}]: ${r.source}\n  機械判定: ${r.reason}`).join("\n");
  return `あなたは映像テロップの校閲担当です。
以下の原稿を校閲してください。機械ルールで確定できない部分を中心に、
誤字脱字、誤変換、固有名詞、正式名称、読み・ルビ、字体、文脈上の不自然さを指摘してください。
断定できない場合は「要確認」とし、自動修正はしないでください。

【機械校閲でAI確認を推奨された箇所】
${focus || "なし"}

【原稿】
${src}

【出力形式】
行番号 / 判定（修正候補・要確認） / 確信度 / 原文 / 候補 / 理由
`;
}

function toCsv(){
  const rows=[["行","判定","種別","確信度","原文","候補","理由"]];
  state.lastResults.forEach(r=>rows.push([r.line,r.verdict,r.type,r.confidence || "低",r.source,r.suggestion,r.reason]));
  return rows.map(row=>row.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n");
}

async function reloadSharedData(){
  clearSystemMessage();
  try{
    const dict = await Backend.dictionaries();
    state.rules = dict.rules.map(x=>({id:x.id,wrong:x.wrong,correct:x.correct}));
    state.proper = dict.proper.map(x=>({id:x.id,wrong:x.variant,correct:x.canonical}));
    state.glyphCautions = dict.glyphCautions;
    state.readingCautions = dict.readingCautions;
    state.officialNameCautions = dict.officialNameCautions;

    const logs = await Backend.logs(50);
    renderLogs(logs);
  }catch(e){
    showSystemMessage(`共有データを読み込めませんでした: ${e.message}`, "error");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if(!Backend.configured()){
    location.href = "./auth.html";
    return;
  }
  Backend.init();
  const versionInfo = document.getElementById("versionInfo");
  if(versionInfo && window.APP_CONFIG){
    const version = window.APP_CONFIG.appVersion || "MVP";
    const updated = window.APP_CONFIG.updatedAt || "";
    versionInfo.textContent = updated ? `${version} / 最終更新: ${updated}` : version;
  }
  const s = await Backend.requireSession();
  if(!s) return;

  try{
    state.profile = await Backend.profile();
    const roleText = state.profile.role === "admin" ? "管理者" : "運用者";
    document.getElementById("userBadge").textContent = `${state.profile.display_name || state.profile.email} / ${roleText}`;
    if(state.profile.role === "admin"){
      document.getElementById("settingsLink").classList.remove("hidden");
      document.getElementById("logTitle").textContent = "3. 全体の運用ログ";
    }else{
      document.getElementById("logTitle").textContent = "3. 自分の運用ログ";
    }
  }catch(e){
    showSystemMessage(`ユーザー情報を取得できませんでした: ${e.message}`, "error");
  }

  await reloadSharedData();
  renderResults([]);

  document.getElementById("logoutButton").onclick = () => Backend.signOut();
  document.getElementById("refreshButton").onclick = reloadSharedData;
  document.getElementById("clearText").onclick = () => {
    document.getElementById("sourceText").value="";
    state.lastResults=[];
    state.lastTargets=[];
    renderResults([]);
  };

  document.getElementById("runCheck").onclick = async () => {
    const source = document.getElementById("sourceText").value;
    const {targets, rawLineCount} = extractTwTargets(source);
    const results = [];
    targets.forEach(t => results.push(...checkLine(t.text, t.lineNo)));
    state.lastTargets = targets;
    state.lastResults = results;
    renderResults(results);

    const targetStartCount = targets.filter(t => !t.isContinuation).length;
    if(targets.length === 0){
      showSystemMessage("検証対象が見つかりませんでした。「4桁の数字 + TW」で始まる行を確認してください。", "error");
      return;
    }
    showSystemMessage(`検証対象: TWテロップ ${targetStartCount}件 / 対象行 ${targets.length}行（入力全体 ${rawLineCount}行）`, "success");

    try{
      await Backend.addOperationLog({
        lineCount: targets.length,
        issueCount: results.length,
        operatorName: state.profile?.display_name || state.profile?.email || "未設定"
      });
      renderLogs(await Backend.logs(50));
    }catch(e){
      showSystemMessage(`校閲は完了しましたが、運用ログを保存できませんでした: ${e.message}`, "error");
    }
  };

  document.getElementById("copyAiPrompt").onclick = async () => {
    try{
      await navigator.clipboard.writeText(makeAiPrompt());
      showSystemMessage("AI確認用テキストをコピーしました。ChatGPTに貼り付けてください。", "success");
    }catch(e){
      showSystemMessage("クリップボードへコピーできませんでした。ブラウザの権限を確認してください。", "error");
    }
  };

  document.getElementById("downloadCsv").onclick = () => {
    const blob=new Blob(["\ufeff"+toCsv()],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`telop-proofread-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
});
