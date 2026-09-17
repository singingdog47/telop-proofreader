document.addEventListener("DOMContentLoaded", async () => {
  const configWarning = document.getElementById("configWarning");
  const authMessage = document.getElementById("authMessage");

  function showMessage(text, type=""){
    authMessage.textContent = text;
    authMessage.className = `system-message ${type}`.trim();
  }

  if(!Backend.configured()){
    configWarning.textContent = "Supabase接続情報が未設定です。src/config.js に Project URL と anon / publishable key を設定してください。";
    configWarning.classList.remove("hidden");
    document.querySelectorAll("form button").forEach(b => b.disabled = true);
    return;
  }

  Backend.init();

  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const showLogin = document.getElementById("showLogin");
  const showSignup = document.getElementById("showSignup");

  try{
    const open = await Backend.registrationStatus();
    showSignup.disabled = !open;
    if(!open){
      showSignup.title = "現在、新規登録は停止されています";
      signupForm.querySelectorAll("input,button").forEach(el => el.disabled = true);
    }
  }catch(e){
    // 設定テーブル未準備時はログイン処理を優先
  }

  const current = await Backend.session();
  if(current){
    location.href = "./index.html";
    return;
  }

  function selectTab(tab){
    const login = tab === "login";
    loginForm.classList.toggle("hidden", !login);
    signupForm.classList.toggle("hidden", login);
    showLogin.classList.toggle("active", login);
    showSignup.classList.toggle("active", !login);
    authMessage.classList.add("hidden");
  }

  showLogin.onclick = () => selectTab("login");
  showSignup.onclick = () => selectTab("signup");

  loginForm.onsubmit = async (e) => {
    e.preventDefault();
    showMessage("ログイン中...");
    const { error } = await Backend.getClient().auth.signInWithPassword({
      email: document.getElementById("loginEmail").value.trim(),
      password: document.getElementById("loginPassword").value
    });
    if(error){
      showMessage(`ログインできませんでした: ${error.message}`, "error");
      return;
    }
    location.href = "./index.html";
  };

  signupForm.onsubmit = async (e) => {
    e.preventDefault();
    showMessage("登録中...");
    const displayName = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;

    const redirectTo = new URL("./index.html", location.href).href;
    const { data, error } = await Backend.getClient().auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: redirectTo
      }
    });
    if(error){
      showMessage(`登録できませんでした: ${error.message}`, "error");
      return;
    }
    if(data.session){
      location.href = "./index.html";
    }else{
      showMessage("登録しました。確認メールが有効な場合は、メール内のリンクから認証してください。", "success");
    }
  };
});
