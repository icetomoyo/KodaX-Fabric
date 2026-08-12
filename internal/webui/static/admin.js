const orig = location.origin;
document.getElementById("orig").textContent = orig;
async function j(url, opt) {
  const r = await fetch(url, Object.assign({ credentials: "include", headers: { "Content-Type": "application/json" } }, opt || {}));
  const t = await r.text();
  let d;
  try { d = JSON.parse(t); } catch (e) { d = { raw: t, status: r.status }; }
  if (!r.ok) throw d;
  return d;
}
async function login() {
  try {
    const d = await j("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ phone: phone.value, password: pw.value }) });
    who.textContent = d.data.phone + " / " + d.data.role;
    login.style.display = "none";
    app.style.display = "block";
    await refresh();
  } catch (e) { lmsg.textContent = JSON.stringify(e); }
}
function tab(rows, cols) {
  if (!rows || !rows.length) return "<tr><td>空</td></tr>";
  return "<tr>" + cols.map(function (c) { return "<th>" + c + "</th>"; }).join("") + "</tr>" +
    rows.map(function (r) { return "<tr>" + cols.map(function (c) { return "<td>" + (r[c] == null ? "" : r[c]) + "</td>"; }).join("") + "</tr>"; }).join("");
}
async function refresh() {
  const P = await j("/api/v1/providers");
  pt.innerHTML = tab(P.data, ["id", "code", "name", "default_base_url"]);
  const K = await j("/api/v1/provider-keys");
  kt.innerHTML = tab(K.data, ["id", "provider_code", "label", "status"]);
  const O = await j("/api/v1/pools");
  pot.innerHTML = tab(O.data, ["id", "name", "group_name"]);
  const C = await j("/api/v1/channels");
  ct.innerHTML = tab(C.data, ["id", "pool_id", "provider_key_id", "protocol", "base_url", "status", "priority", "weight"]);
  const V = await j("/api/v1/virtual-keys");
  vt.innerHTML = tab(V.data, ["id", "key_prefix", "name", "pool_id", "status", "rpm_limit", "monthly_token_limit", "monthly_tokens_used"]);
  const A = await j("/api/v1/vk-applications");
  at.innerHTML = tab(A.data, ["id", "operator_id", "pool_id", "name", "status", "created_vk_prefix"]);
  (A.data || []).filter(function (x) { return x.status === "pending"; }).forEach(function (x) {
    const b = document.createElement("button");
    b.textContent = "批准 " + x.id;
    b.onclick = function () { appr(x.id); };
    at.parentNode.appendChild(b);
  });
}
async function addP() { await j("/api/v1/providers", { method: "POST", body: JSON.stringify({ code: pcode.value, name: pname.value, default_base_url: pbase.value }) }); refresh(); }
async function addK() { await j("/api/v1/provider-keys", { method: "POST", body: JSON.stringify({ provider_code: kcode.value, label: klabel.value, secret: ksec.value }) }); ksec.value = ""; refresh(); }
async function addPool() { await j("/api/v1/pools", { method: "POST", body: JSON.stringify({ name: pname2.value, group_name: pgrp.value }) }); refresh(); }
async function addCh() { await j("/api/v1/channels", { method: "POST", body: JSON.stringify({ pool_id: +cpid.value, provider_key_id: +ckid.value, protocol: cproto.value, base_url: cbase.value, priority: +cpri.value, weight: +cw.value }) }); refresh(); }
async function addVK() {
  const d = await j("/api/v1/virtual-keys", { method: "POST", body: JSON.stringify({ name: vn.value, pool_id: +vpid.value, rpm_limit: +vrpm.value, monthly_token_limit: +vbud.value, model_scope: vmod.value }) });
  vonce.textContent = "仅显示一次: " + d.data.virtual_key;
  refresh();
}
async function appr(id) { const d = await j("/api/v1/vk-applications/" + id + "/approve", { method: "POST" }); alert("已签发 " + d.data.virtual_key); refresh(); }
