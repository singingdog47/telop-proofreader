(() => {
  let client = null;

  function configured(){
    const cfg = window.APP_CONFIG || {};
    return Boolean(
      cfg.supabaseUrl &&
      cfg.supabasePublishableKey &&
      !cfg.supabaseUrl.includes("PASTE_") &&
      !cfg.supabasePublishableKey.includes("PASTE_")
    );
  }

  function init(){
    if(!configured()) throw new Error("Supabaseの接続情報が未設定です。src/config.js を設定してください。");
    if(!window.supabase) throw new Error("Supabaseライブラリを読み込めませんでした。ネットワーク接続を確認してください。");
    client = window.supabase.createClient(
      window.APP_CONFIG.supabaseUrl,
      window.APP_CONFIG.supabasePublishableKey,
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
    );
    return client;
  }

  function getClient(){
    if(!client) return init();
    return client;
  }

  async function session(){
    const { data, error } = await getClient().auth.getSession();
    if(error) throw error;
    return data.session;
  }

  async function requireSession(){
    const s = await session();
    if(!s){
      location.href = "./auth.html";
      return null;
    }
    return s;
  }

  async function profile(){
    const s = await session();
    if(!s) return null;
    const { data, error } = await getClient()
      .from("profiles")
      .select("id,email,display_name,role,created_at")
      .eq("id", s.user.id)
      .single();
    if(error) throw error;
    return data;
  }

  async function signOut(){
    await getClient().auth.signOut();
    location.href = "./auth.html";
  }

  async function registrationStatus(){
    const { data, error } = await getClient()
      .from("app_settings")
      .select("allow_registration")
      .eq("id", 1)
      .single();
    if(error) throw error;
    return Boolean(data?.allow_registration);
  }

  async function setRegistrationStatus(enabled){
    const { error } = await getClient()
      .from("app_settings")
      .update({ allow_registration: Boolean(enabled) })
      .eq("id", 1);
    if(error) throw error;
  }

  async function dictionaries(){
    const db = getClient();
    const [
      rulesRes, properRes, glyphRes, readingRes, officialRes
    ] = await Promise.all([
      db.from("rules").select("id,wrong,correct").eq("enabled", true).order("id"),
      db.from("proper_nouns").select("id,variant,canonical").eq("enabled", true).order("id"),
      db.from("glyph_cautions").select("id,term,note").eq("enabled", true).order("id"),
      db.from("reading_cautions").select("id,term,reading,note").eq("enabled", true).order("id"),
      db.from("official_name_cautions").select("id,variant,official,note").eq("enabled", true).order("id")
    ]);
    for(const r of [rulesRes, properRes, glyphRes, readingRes, officialRes]){
      if(r.error) throw r.error;
    }
    return {
      rules: rulesRes.data || [],
      proper: properRes.data || [],
      glyphCautions: glyphRes.data || [],
      readingCautions: readingRes.data || [],
      officialNameCautions: officialRes.data || []
    };
  }

  async function addOperationLog({ lineCount, issueCount, operatorName }){
    const s = await session();
    if(!s) throw new Error("ログインが必要です。");
    const { error } = await getClient().from("operation_logs").insert({
      user_id: s.user.id,
      operator_name: operatorName,
      line_count: lineCount,
      issue_count: issueCount
    });
    if(error) throw error;
  }

  async function postalPlaceReadings(lines){
    const { data, error } = await getClient().functions.invoke("postal-place-readings", {
      body: { lines }
    });
    if(error) throw error;
    if(data?.error) throw new Error(data.error);
    return data || { matches:[] };
  }

  async function logs(limit=50){
    const { data, error } = await getClient()
      .from("operation_logs")
      .select("id,operator_name,line_count,issue_count,created_at")
      .order("created_at", { ascending:false })
      .limit(limit);
    if(error) throw error;
    return data || [];
  }

  async function members(){
    const { data, error } = await getClient()
      .from("profiles")
      .select("id,email,display_name,role,created_at")
      .order("created_at", { ascending:true });
    if(error) throw error;
    return data || [];
  }

  async function updateRole(userId, role){
    const { error } = await getClient().from("profiles").update({ role }).eq("id", userId);
    if(error) throw error;
  }

  async function deleteMember(userId){
    const { data, error } = await getClient().rpc("admin_delete_user", { target_user_id: userId });
    if(error) throw error;
    return data;
  }

  const tableMap = {
    rules: "rules",
    proper: "proper_nouns",
    glyphCautions: "glyph_cautions",
    readingCautions: "reading_cautions",
    officialNameCautions: "official_name_cautions"
  };

  async function insertDictionary(kind, record){
    const table = tableMap[kind];
    if(!table) throw new Error("未知の辞書種別です。");
    const { error } = await getClient().from(table).insert(record);
    if(error) throw error;
  }

  async function deleteDictionary(kind, id){
    const table = tableMap[kind];
    if(!table) throw new Error("未知の辞書種別です。");
    const { error } = await getClient().from(table).delete().eq("id", id);
    if(error) throw error;
  }

  window.Backend = {
    configured, init, getClient, session, requireSession, profile, signOut,
    registrationStatus, setRegistrationStatus,
    dictionaries, addOperationLog, postalPlaceReadings, logs, members, updateRole, deleteMember,
    insertDictionary, deleteDictionary
  };
})();
