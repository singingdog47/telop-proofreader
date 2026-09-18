const state = {
  rules: [],
  proper: [],
  glyphCautions: [],
  readingCautions: [],
  officialNameCautions: [],
  lastResults: [],
  lastTargets: [],
  postalPlaceMatches: [],
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

  // ルールだけで比較的根拠を持てる地名・組織・施設系だけを拾う。
  // カタカナ一般語、英字単語、数字、括弧だけを理由に固有名詞とは判定しない。
  const geoOrg = text.match(/[一-龠々ヶヵぁ-んァ-ヶーA-Za-z0-9・.＆&]+(?:都|道|府|県|市|区|町|村|郡|駅|空港|公園|通り|川|河|山|岳|湖|湾|島|大学|高校|中学校|小学校|病院|銀行|証券|放送|テレビ|新聞|庁|省|局|協会|連盟|研究所|センター|ホテル|ホール|劇場|美術館|博物館)/g) || [];
  geoOrg.forEach(v => add(v, "高", "地名・組織・施設名で使われやすい接尾辞を含みます。"));

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

function postalReadingRows(matches){
  const rows=[];
  for(const m of matches || []){
    for(const p of m.places || []){
      const readings=(p.readings || []).map(r=>r.roman).filter(Boolean);
      if(!readings.length) continue;
      rows.push({
        line:m.line,
        verdict:"参照",
        type:"地名読み参照",
        confidence:"高",
        source:m.text,
        suggestion:readings.join(" / "),
        reason:`日本郵便の住所郵便番号（ローマ字）データで「${p.term}」を照合しました。読み確認の参考にしてください。`
      });
    }
  }
  return rows;
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
    const verdictCls = r.verdict==="NG" ? "ng" : (r.verdict==="参照" ? "info" : "warn");
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
  const semanticTypes = [
    "人名候補","肩書き候補","所属・団体候補","固有名詞候補","未登録固有名詞",
    "正式名称注意","読み・ルビ注意","読み要確認","字体注意","英文スペル"
  ];
  const rows = state.lastResults.filter(x => semanticTypes.includes(x.type));
  const targets = state.lastTargets.map(t => ({
    line:t.lineNo,
    text:t.text
  }));

  const machineFindings = rows.map(r => ({
    line:r.line,
    type:r.type,
    confidence:r.confidence || "低",
    source:r.source,
    suggestion:r.suggestion || "",
    reason:r.reason
  }));

  const postalRefs = (state.postalPlaceMatches || []).flatMap(m =>
    (m.places || []).map(p => ({
      line:m.line,
      term:p.term,
      roman:(p.readings || []).map(r=>r.roman).filter(Boolean)
    }))
  );

  return `あなたはテレビ・映像制作向けのテロップ校閲担当です。
以下は、機械ルールで一次チェック済みの「検証対象テロップだけ」です。
あなたの役割は、ルールでは難しい意味理解と、文字・字体・フォント依存のリスク確認を行うことです。人名・肩書き・所属・団体名・作品名・商品名・施設名・一般英文などを文脈で分類したうえで、表記と字形の両面から校閲してください。

【重要方針】
- 原文にない情報を作らない。
- 人名、団体名、作品名、商品名などは、確証がなければ「要確認」とする。
- 「TW」「T.W.」「テロップ」などの管理記号は校閲対象の固有名詞として扱わない。
- "Directed by" "Produced by" など一般的な英文クレジット表現は、固有名詞ではなく英文として扱う。
- 英文はスペル・大文字小文字・語法の不自然さを確認する。
- 「人物名（所属/コンビ/団体）」のような構造は、人物名と括弧内の所属・団体を分けて評価する。ただし括弧があるだけで人物名・団体名と断定しない。
- 「肩書き + 人名 + 敬称」の構造は、肩書きと人名を分けて評価する。
- 「トリキリ」「右上」「左上」「右下」「左下」「サイドロゴ」「サイドマスコット」「エンドロール」「オフラインミス」などは制作指示・制作メモの可能性を先に検討する。
- 年齢・日付・画面位置・一般名詞・鳴き声・見出し・造語を、数字・カタカナ・英字という理由だけで固有名詞扱いしない。
- "ART" のような英単語は文脈で一般語か固有名詞かを判断する。
- "Awakey?" のような番組固有表現は、一般英語のスペル規則だけで修正しない。
- "Directed by" などの後ろは人物とは限らず、ユニット名・団体名の可能性もあるため、主体種別を文脈で判定する。
- 固有名詞の正式表記を断定できない場合は、推測で修正候補を作らず「要確認」とする。
- 機械判定が誤っていると思われる場合は、その旨を明示する。
- すべての検証対象について、辞書登録の有無に関係なく「字体・字形・フォント依存」の注意点がないか確認する。
- 旧字体・異体字・俗字・フォントによって字形差が出やすい漢字、JIS/IVS等で見え方が変わり得る文字は、修正を断定せず「フォント要確認」とする。
- 例として「鯖江市」の「鯖」は、採用フォントによって魚へんの右側が「青」のように見える字形差が起こり得る。このようなケースは、既知辞書に未登録でも検出対象とする。
- 実際の採用フォントを見ないと確定できない字形問題は、誤字と断定せず「採用フォントで目視確認」とする。

【検証対象テロップ】
${targets.map(t => `${t.line}行目: ${t.text}`).join("\n") || "対象なし"}

【日本郵便 地名・ローマ字読み参照】
${postalRefs.length
  ? postalRefs.map(p => `- ${p.line}行目: ${p.term} → ${p.roman.join(" / ")}`).join("\n")
  : "該当なし"}

この地名データは、漢字表記と読みの照合用の一次資料として優先してください。
ただし、郵便番号データの町域表記と番組上の地名表記が常に完全一致するとは限らないため、文脈と公式自治体表記も考慮してください。

【機械一次チェック結果】
${machineFindings.length
  ? machineFindings.map(f => `- ${f.line}行目 / ${f.type} / 確信度:${f.confidence}\n  原文: ${f.source}\n  候補: ${f.suggestion || "なし"}\n  理由: ${f.reason}`).join("\n")
  : "機械判定なし"}

【あなたに行ってほしいこと】
1. 各テロップを意味単位に分解する。
   例：肩書き / 人名 / 所属・団体 / 作品名 / 商品名 / 一般英文 / その他
2. 機械一次チェックの誤検出を指摘する。特に「一般語・制作指示・数字・日付を固有名詞扱いしていないか」を確認する。
3. 誤字脱字、誤変換、スペル、大文字小文字、正式名称、人物名、団体名、読み・ルビの要確認箇所を抽出する。
4. 全テロップを対象に、フォントによる字形差・異体字・旧字体などの表示リスクを確認する。
5. 確証のない固有名詞は「要確認」とする。
6. 問題がない部分は無理に指摘しない。

【出力形式】
行番号 | 判定（修正候補 / 要確認 / フォント要確認 / 問題なし / 機械誤検出） | 種別 | 確信度（高/中/低） | 対象語 | 修正候補 | 理由

最後に、
- 「機械ルールで十分だった指摘」
- 「AI意味理解が必要だった指摘」
- 「人による最終確認が必要な指摘（採用フォントでの字形確認を含む）」
の3分類で短くまとめてください。
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
    state.postalPlaceMatches=[];
    renderResults([]);
  };

  document.getElementById("runCheck").onclick = async () => {
    const source = document.getElementById("sourceText").value;
    const {targets, rawLineCount} = extractTwTargets(source);
    let results = [];
    targets.forEach(t => results.push(...checkLine(t.text, t.lineNo)));
    state.lastTargets = targets;

    try{
      const postal = await Backend.postalPlaceReadings(targets.map(t=>({line:t.lineNo,text:t.text})));
      state.postalPlaceMatches = postal.matches || [];

      // 日本郵便データで読みが確認できた行については、一般的な「読み要確認」を置き換える。
      results = results.filter(r => {
        if(r.type !== "読み要確認") return true;
        const match = state.postalPlaceMatches.find(m => m.line === r.line);
        if(!match) return true;
        return !(match.places || []).some(p => r.source.includes(p.term));
      });
      results.push(...postalReadingRows(state.postalPlaceMatches));
    }catch(e){
      state.postalPlaceMatches = [];
      showSystemMessage(`地名読みデータの照合に失敗しました。通常の校閲は続行します: ${e.message}`, "error");
    }

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
        issueCount: results.filter(r=>r.verdict!=="参照").length,
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
      showSystemMessage("AI総合チェック用テキストをコピーしました。ChatGPTに貼り付けてください。", "success");
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
