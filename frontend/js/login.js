/* Sign in / Create account page */
(function () {
  // Already signed in? go straight to the app
  if (Auth.token() && Auth.user()) {
    window.location.replace("app.html");
    return;
  }

  let mode = "login";
  let role = "student";

  const $ = (id) => document.getElementById(id);
  const errBox = $("authError");
  const submitBtn = $("submitBtn");

  function showError(msg) {
    errBox.textContent = msg;
    errBox.classList.remove("hidden");
  }
  function clearError() {
    errBox.classList.add("hidden");
  }

  function setMode(m) {
    mode = m;
    clearError();
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === m));
    const reg = m === "register";
    $("nameBlock").classList.toggle("hidden", !reg);
    $("roleBlock").classList.toggle("hidden", !reg);
    $("confirmBlock").classList.toggle("hidden", !reg);
    $("password").placeholder = reg ? "At least 6 characters" : "Enter your password";
    $("password").autocomplete = reg ? "new-password" : "current-password";
    submitBtn.textContent = reg ? "Create Account" : "Sign In";
  }

  document.querySelectorAll(".auth-tab").forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode)));

  document.querySelectorAll("#roleRow .seg-opt").forEach((opt) =>
    opt.addEventListener("click", () => {
      document.querySelectorAll("#roleRow .seg-opt").forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
      role = opt.dataset.role;
    })
  );

  $("pwToggle").addEventListener("click", () => {
    const show = $("password").type === "password";
    $("password").type = show ? "text" : "password";
    $("confirm").type = show ? "text" : "password";
    $("pwToggle").textContent = show ? "Hide" : "Show";
  });

  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const email = $("email").value.trim();
    const password = $("password").value;

    if (!email || !password) return showError("Please enter your email and password.");

    if (mode === "register") {
      const name = $("name").value.trim();
      if (name.length < 2) return showError("Please enter your full name.");
      if (password.length < 6) return showError("Password must be at least 6 characters.");
      if (password !== $("confirm").value) return showError("Passwords do not match.");
    }

    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = "Please wait…";

    try {
      const payload = mode === "register" ? { name: $("name").value.trim(), email, password, role } : { email, password };
      const data = await api(mode === "register" ? "/auth/register" : "/auth/login", { method: "POST", body: payload });
      Auth.save(data.token, data.user);
      window.location.href = "app.html";
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });
})();
