document.getElementById("o").textContent = location.origin;
async function j(u, o) {
  const r = await fetch(u, Object.assign({ credentials: "include", headers: { "Content-Type": "application/json" } }, o || {}));
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch (e) { d = { raw: t }; }
  if (!r.ok) throw d;
  return d;
}
async function login() {
  try { after(await j("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ phone: phone.value, password: pw.value }) })); }
  catch (e) { msg.textContent = JSON.stringify(e); }
}
async function reg() {
  try { after(await j("/api/v1/auth/register", { method: "POST", body: JSON.stringify({ phone: phone.value, password: pw.value, name: nm.value }) })); }
  catch (e) { msg.textContent = JSON.stringify(e); }
}
async function after(d) {
  auth.style.display = "none";
  box.style.display = "block";
  who.textContent = d.data.phone;
  const p = await j("/api/v1/pools");
  pool.innerHTML = (p.data || []).map(function (x) { return "<option value=\"" + x.id + "\">" + x.name + " (#" + x.id + ")</option>"; }).join("");
  load();
}
async function apply() {
  await j("/api/v1/me/vk-applications", { method: "POST", body: JSON.stringify({ pool_id: +pool.value, name: aname.value }) });
  load();
}
async function load() {
  const d = await j("/api/v1/me/vk-applications");
  apps.innerHTML = "<table>" + (d.data || []).map(function (a) {
    var btn = a.status === "approved" ? "<button onclick=\"rev(" + a.id + ")\">显示一次</button>" : "";
    return "<tr><td>" + a.id + "</td><td>" + a.name + "</td><td>" + a.status + "</td><td>" + (a.created_vk_prefix || "") + "</td><td>" + btn + "</td></tr>";
  }).join("") + "</table>";
}
async function rev(id) {
  const d = await j("/api/v1/me/vk-applications/" + id + "/reveal", { method: "POST" });
  revealed.textContent = "请立即保存: " + d.data.virtual_key;
}
