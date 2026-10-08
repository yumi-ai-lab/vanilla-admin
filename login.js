"use strict";
const form = document.getElementById("login-form");
const errorText = document.getElementById("login-error");
form?.addEventListener("submit", async event => {
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  errorText.textContent = "";
  try {
    const response = await (window.VIBAdminAPI?.request || fetch)("/api/admin/login", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: document.getElementById("password").value })
    });
    if (!response.ok) {
      errorText.textContent = response.status === 429 ? "少し時間をおいてから、もう一度お試しください。" : "パスワードを確認してください。";
      return;
    }
    if (window.VIBAdminAPI?.remote) window.VIBAdminAPI.save(await response.json());
    document.getElementById("password").value = "";
    location.replace(window.VIBAdminAPI?.homePath || "/admin/");
  } catch { errorText.textContent = "接続できませんでした。もう一度お試しください。"; }
  finally { button.disabled = false; }
});
