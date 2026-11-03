const out = document.getElementById('out');
const log = (x) => { out.textContent = typeof x === 'string' ? x : JSON.stringify(x, null, 2); };
const tokenEl = document.getElementById('token');
tokenEl.value = localStorage.getItem('hivenest_sessiond_token') || '';
document.getElementById('saveTok').onclick = () => {
  localStorage.setItem('hivenest_sessiond_token', tokenEl.value.trim());
  log('token saved in localStorage');
};
function headers(json) {
  const h = { 'X-HiveNest-Token': tokenEl.value.trim() };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}
async function api(path, opts={}) {
  const r = await fetch(path, { ...opts, headers: { ...headers(!!opts.body), ...(opts.headers||{}) } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) throw Object.assign(new Error((body && body.error) || r.statusText), { body, status: r.status });
  return body;
}
let sessionId = null, lastProposal = null, term, ws;
document.getElementById('health').onclick = async () => log(await fetch('/health').then(r=>r.json()));
document.getElementById('listHosts').onclick = async () => {
  const d = await api('/v1/hosts');
  const sel = document.getElementById('hostSelect');
  sel.innerHTML = '';
  (d.hosts||[]).forEach(h => {
    const o = document.createElement('option');
    o.value = h.id;
    o.textContent = h.name + ' (' + h.user + '@' + h.host + ':' + h.port + ')';
    sel.appendChild(o);
  });
  log(d);
};
document.getElementById('addHost').onclick = async () => {
  const method = authMethod.value;
  const body = {
    name: name.value, host: host.value, port: Number(port.value)||22, user: user.value,
    auth_method: method,
    identity_file: method === 'password' ? '' : identity.value,
    use_agent: method === 'agent' ? true : agent.checked
  };
  log(await api('/v1/hosts', { method:'POST', body: JSON.stringify(body) }));
  document.getElementById('listHosts').click();
};
document.getElementById('openSess').onclick = async () => {
  const host_id = hostSelect.value;
  const password = sessionPassword.value;
  const payload = { host_id };
  if (password) payload.password = password;
  const d = await api('/v1/sessions', { method:'POST', body: JSON.stringify(payload) });
  sessionPassword.value = '';
  sessionId = d.id;
  sessLabel.textContent = 'session ' + sessionId;
  log(d);
};
document.getElementById('closeSess').onclick = async () => {
  if (!sessionId) return;
  await api('/v1/sessions/'+sessionId, { method:'DELETE' });
  sessLabel.textContent = 'no session';
  sessionId = null;
  log('closed');
};
document.getElementById('exec').onclick = async () => {
  log(await api('/v1/sessions/'+sessionId+'/exec', { method:'POST', body: JSON.stringify({ command: cmd.value, actor:'user' }) }));
};
document.getElementById('propose').onclick = async () => {
  lastProposal = await api('/v1/sessions/'+sessionId+'/proposals', { method:'POST', body: JSON.stringify({ command: cmd.value, reason:'smoke test' }) });
  log(lastProposal);
};
document.getElementById('approve').onclick = async () => {
  lastProposal = await api('/v1/proposals/'+lastProposal.id+'/approve', { method:'POST', body:'{}' });
  log(lastProposal);
};
document.getElementById('execApproved').onclick = async () => {
  log(await api('/v1/sessions/'+sessionId+'/exec', { method:'POST', body: JSON.stringify({
    command: lastProposal.command, proposal_id: lastProposal.id, approve_token: lastProposal.approve_token, actor:'agent'
  })}));
};
document.getElementById('attach').onclick = () => {
  if (!sessionId) return log('open a session first');
  if (!term) {
    term = new Terminal({ convertEol: true, fontSize: 13, theme: { background: '#0b0d12' } });
    term.open(document.getElementById('term'));
  }
  const q = new URLSearchParams({ token: tokenEl.value.trim(), cols: String(term.cols), rows: String(term.rows) });
  ws = new WebSocket('ws://' + location.host + '/v1/sessions/' + sessionId + '/ws?' + q.toString());
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') term.write(ev.data);
    else term.write(new Uint8Array(ev.data));
  };
  ws.onopen = () => term.focus();
  ws.onclose = () => log('PTY closed');
  term.onData(data => { if (ws && ws.readyState===1) ws.send(data); });
  term.onResize(({cols, rows}) => {
    if (ws && ws.readyState===1) ws.send(JSON.stringify({ type:'resize', cols, rows }));
  });
};
document.getElementById('detach').onclick = () => { if (ws) ws.close(); };
