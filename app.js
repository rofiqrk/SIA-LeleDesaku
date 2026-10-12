// ===== Helper =====
const $ = s => document.querySelector(s);
const rp = n => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
const nf = n => (+n || 0).toLocaleString('id-ID', {maximumFractionDigits: 2});
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = new Date().toISOString().slice(0, 10);
let kolam = [], kategori = [], rows = [], editId = null, page = 'ringkasan', charts = [], filterKolam = '';

// ===== Konfigurasi CRUD: dipakai halaman Kolam & Transaksi =====
// field: k=kolom, l=label, t=tipe, o=opsi select, num=kirim sebagai angka, req=wajib
const CFG = {
  kolam: {table: 'kolam', title: '🌊 Data Kolam', order: 'tanggal_tebar', fields: [
    {k:'kode_kolam', l:'Kode kolam', t:'text', req:1}, {k:'nama', l:'Nama kolam', t:'text', req:1},
    {k:'tanggal_tebar', l:'Tanggal tebar benih', t:'date', req:1},
    {k:'jumlah_benih', l:'Jumlah benih (ekor)', t:'number', req:1},
    {k:'harga_benih', l:'Harga benih / ekor (Rp)', t:'number', req:1},
    {k:'modal_awal', l:'Modal awal pemilik (Rp, 0 jika tidak ada)', t:'number'},
    {k:'status', l:'Status (selesai = sisa persediaan dibebankan)', t:'select', o:() => [['aktif','aktif'],['selesai','selesai']]}],
    cols: [['Kode', r => r.kode_kolam], ['Nama', r => r.nama], ['Tgl tebar', r => r.tanggal_tebar], ['Benih', r => nf(r.jumlah_benih)],
      ['Harga benih', r => rp(r.harga_benih)], ['Modal awal', r => rp(r.modal_awal)], ['Status', r => r.status]]},
  transaksi: {table: 'transaksi', title: '🧾 Transaksi', order: 'tanggal', select: '*, kolam(kode_kolam), kategori_akun(nama,tipe)', fields: [
    {k:'kolam_id', l:'Kolam', t:'select', num:1, req:1, o:() => kolam.map(x => [x.id, x.kode_kolam + ' - ' + x.nama])},
    {k:'kategori_id', l:'Kategori akun', t:'select', num:1, req:1, o:() => kategori.map(x => [x.id, x.kode + ' ' + x.nama + ' (' + x.tipe + ')'])},
    {k:'tanggal', l:'Tanggal', t:'date', req:1},
    {k:'jumlah', l:'Nilai (Rp) - isi 0 untuk kematian', t:'number', req:1},
    {k:'cara_bayar', l:'Cara bayar (kredit = utang, khusus biaya)', t:'select', o:() => [['tunai','tunai'],['kredit','kredit (utang)']]},
    {k:'qty_ekor', l:'Jumlah ikan (ekor) - panen / kematian', t:'number'},
    {k:'berat_kg', l:'Berat (kg) - pakan: kg pelet, panen: kg hasil', t:'number'},
    {k:'keterangan', l:'Keterangan', t:'text'}],
    cols: [['Tanggal', r => r.tanggal], ['Kolam', r => r.kolam?.kode_kolam], ['Kategori', r => r.kategori_akun?.nama], ['Nilai', r => rp(r.jumlah)],
      ['Bayar', r => r.cara_bayar], ['Ekor', r => nf(r.qty_ekor)], ['Kg', r => nf(r.berat_kg)], ['Keterangan', r => r.keterangan]]}
};
const MENU = [['ringkasan','📊','Ringkasan & Grafik'], ['kolam','🌊','Kolam'], ['transaksi','🧾','Transaksi'], ['utang','💳','Utang Usaha'],
  ['jurnal','📒','Jurnal Umum'], ['labarugi','📈','Laba Rugi'], ['posisi','🏦','Posisi Keuangan']];

async function loadRefs() {
  if (SUPABASE_URL.includes('XXXX')) alert('Isi SUPABASE_URL & SUPABASE_KEY di js/config.js dulu.');
  const [k, c] = await Promise.all([db.from('kolam').select('*').order('tanggal_tebar', {ascending: false}), db.from('kategori_akun').select('*').order('kode')]);
  const err = k.error || c.error;
  if (err) alert('Gagal terhubung ke database: ' + err.message + '\n(Pastikan SQL sudah dijalankan & URL/key benar)');
  kolam = k.data || []; kategori = c.data || [];
}
function go(p) { page = p; editId = null; render(); }
function render() {
  charts.forEach(c => c.destroy()); charts = [];
  $('#nav').innerHTML = MENU.map(([k, i, n]) => `<button class="${k === page ? 'on' : ''}" onclick="go('${k}')"><span>${i}</span>${n}</button>`).join('');
  CFG[page] ? crud(CFG[page]) : PAGES[page]();
}

// ===== Sumber laporan: view v_jurnal_umum =====
async function getJurnal(kid) {
  let q = db.from('v_jurnal_umum').select('*').order('tanggal').order('ref').order('urutan');
  if (kid) q = q.eq('kolam_id', kid);
  const {data, error} = await q; if (error) alert(error.message);
  return data || [];
}
// saldo akun berawalan "p": sign 1 = saldo debit (aset/beban), -1 = saldo kredit (utang/modal/pendapatan)
const tot = (j, p, sign) => j.filter(x => x.akun.startsWith(p)).reduce((t, x) => t + sign * (+x.debit - +x.credit), 0);
function perAkun(j, p, sign) {
  const m = {}; j.filter(x => x.akun.startsWith(p)).forEach(x => m[x.akun] = (m[x.akun] || 0) + sign * (+x.debit - +x.credit));
  return Object.entries(m).sort();
}
const sumBy = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
const tr = (a, b, cls = '') => `<tr class="${cls}"><td>${a}</td><td class="r">${b}</td></tr>`;
const filterBar = () => `<div class="filter"><label>Kolam:</label><select onchange="filterKolam=this.value;render()"><option value="">Semua kolam</option>
  ${kolam.map(k => `<option value="${k.id}" ${filterKolam == k.id ? 'selected' : ''}>${esc(k.kode_kolam)} - ${esc(k.nama)}</option>`).join('')}</select></div>`;
const card = (c, i, l, v) => `<div class="card ${c}" data-i="${i}"><small>${l}</small><b>${v}</b></div>`;

// ===== Ringkasan & Grafik =====
/* Biaya produksi/kg = Total biaya produksi / Kg panen.  FCR = Kg pakan / Kg panen.
   Laba/Rugi = Penjualan - HPP. HPP dihitung otomatis di database (v_hpp_panen):
   biaya produksi dikapitalisasi ke persediaan, dibebankan ke HPP saat panen sebanding ekor yang dipanen. */
async function ringkasan() {
  const [r1, j] = await Promise.all([db.from('v_ringkasan_kolam').select('*').order('id'), getJurnal('')]);
  if (r1.error) return $('#main').innerHTML = '<p class="minus">' + esc(r1.error.message) + '</p>';
  const data = r1.data || [], pend = tot(j, '4', -1), hpp = tot(j, '5', 1);
  $('#main').innerHTML = `<h2>📊 Ringkasan Semua Kolam</h2><div class="cards">
    ${card('c1', '🐟', 'Ikan hidup', nf(sumBy(data, r => +r.ekor_hidup)) + ' ekor')}
    ${card('c4', '📦', 'Persediaan ikan', rp(tot(j, '1-002', 1)))}
    ${card('c5', '💳', 'Utang usaha', rp(tot(j, '2-001', -1)))}
    ${card('c3', '💰', 'Penjualan', rp(pend))}
    ${card('c2', pend - hpp >= 0 ? '📈' : '📉', pend - hpp >= 0 ? 'Laba bersih' : 'Rugi bersih', rp(pend - hpp))}</div>
    <h2>Laporan per Kolam</h2><div class="scroll"><table>
    <tr><th>Kolam</th><th>Status</th><th class="r">Ikan hidup</th><th class="r">Mortalitas</th><th class="r">Biaya produksi</th><th class="r">Penjualan</th><th class="r">Laba/Rugi</th><th class="r">Persediaan</th><th class="r">Biaya/kg panen</th><th class="r">FCR</th></tr>
    ${data.map(r => { const a = j.filter(x => x.kolam_id === r.id), l = tot(a, '4', -1) - tot(a, '5', 1), kg = +r.kg_panen;
      return `<tr><td>${esc(r.kode_kolam)} - ${esc(r.nama)}</td><td><span class="badge ${r.status}">${r.status}</span></td><td class="r">${nf(r.ekor_hidup)}</td>
      <td class="r">${nf(r.mati / r.jumlah_benih * 100)}%</td><td class="r">${rp(r.total_biaya)}</td><td class="r">${rp(r.total_pendapatan)}</td>
      <td class="r ${l >= 0 ? 'plus' : 'minus'}">${rp(l)}</td><td class="r">${rp(tot(a, '1-002', 1))}</td>
      <td class="r">${kg > 0 ? rp(r.total_biaya / kg) : '-'}</td><td class="r">${kg > 0 ? nf(r.kg_pakan / kg) : '-'}</td></tr>`; }).join('')}</table></div>
    <p class="hint">Biaya produksi (benih, pakan, obat, dll) ditampung di Persediaan Ikan dan baru menjadi HPP saat panen.</p>
    <h2>📈 Grafik</h2><div class="charts"><div><h3>Biaya produksi vs Penjualan per Kolam</h3><canvas id="g1"></canvas></div>
    <div><h3>Komposisi Biaya Produksi</h3><canvas id="g2"></canvas></div><div><h3>Tren Bulanan</h3><canvas id="g3"></canvas></div></div>`;
  const C = (id, cfg) => charts.push(new Chart($(id), cfg));
  C('#g1', {type: 'bar', data: {labels: data.map(r => r.kode_kolam), datasets: [
    {label: 'Biaya produksi', data: data.map(r => +r.total_biaya), backgroundColor: '#5b4636'}, {label: 'Penjualan', data: data.map(r => +r.total_pendapatan), backgroundColor: '#0f766e'}]}});
  const kat = {}; j.filter(x => x.kategori).forEach(x => kat[x.kategori] = (kat[x.kategori] || 0) + +x.debit);
  C('#g2', {type: 'doughnut', data: {labels: Object.keys(kat), datasets: [{data: Object.values(kat), backgroundColor: ['#0f766e', '#f2b632', '#5b4636', '#5eb8a8', '#c9a27a', '#d99a0b', '#8fb9a8']}]}});
  const bln = {};
  j.forEach(x => { const b = x.tanggal.slice(0, 7); bln[b] ??= {p: 0, c: 0};
    if (x.akun.startsWith('4')) bln[b].p += +x.credit - +x.debit; if (x.kategori) bln[b].c += +x.debit; });
  const ks = Object.keys(bln).sort();
  C('#g3', {type: 'line', data: {labels: ks, datasets: [
    {label: 'Penjualan', data: ks.map(k => bln[k].p), borderColor: '#0f766e', backgroundColor: '#0f766e', tension: .3},
    {label: 'Biaya produksi', data: ks.map(k => bln[k].c), borderColor: '#d99a0b', backgroundColor: '#d99a0b', tension: .3}]}});
}

// ===== Utang Usaha =====
async function utang() {
  const j = (await getJurnal('')).filter(x => x.akun.startsWith('2-001')), m = {};
  j.forEach(x => { m[x.kode_kolam] ??= {u: 0, b: 0}; m[x.kode_kolam].u += +x.credit; m[x.kode_kolam].b += +x.debit; });
  const ks = Object.keys(m).sort();
  $('#main').innerHTML = `<h2>💳 Utang Usaha</h2><div class="cards">
    ${card('c5', '💳', 'Sisa utang', rp(sumBy(ks, k => m[k].u - m[k].b)))}${card('c2', '🧾', 'Total utang timbul', rp(sumBy(ks, k => m[k].u)))}${card('c1', '✅', 'Sudah dibayar', rp(sumBy(ks, k => m[k].b)))}</div>
    <table class="lap" style="max-width:none"><tr><th>Kolam</th><th class="r">Utang timbul</th><th class="r">Sudah dibayar</th><th class="r">Sisa utang</th></tr>
    ${ks.map(k => `<tr><td>${esc(k)}</td><td class="r">${rp(m[k].u)}</td><td class="r">${rp(m[k].b)}</td><td class="r minus">${rp(m[k].u - m[k].b)}</td></tr>`).join('')}</table>
    <h2 style="margin-top:20px">Riwayat</h2><div class="scroll"><table><tr><th>Tanggal</th><th>Kolam</th><th>Keterangan</th><th class="r">Utang timbul</th><th class="r">Pelunasan</th></tr>
    ${j.map(x => `<tr><td>${x.tanggal}</td><td>${esc(x.kode_kolam)}</td><td>${esc(x.keterangan)}</td><td class="r">${+x.credit ? rp(x.credit) : ''}</td><td class="r">${+x.debit ? rp(x.debit) : ''}</td></tr>`).join('')}</table></div>
    <p class="hint">Cara catat: di menu Transaksi, pilih "Cara bayar = kredit" saat membeli (misal pelet). Saat membayar, catat transaksi kategori "Pelunasan Utang Usaha" dengan nilai yang dibayar.</p>`;
}

// ===== Jurnal Umum =====
async function jurnalUmum() {
  const j = await getJurnal(filterKolam), D = sumBy(j, x => +x.debit), K = sumBy(j, x => +x.credit);
  $('#main').innerHTML = `<h2>📒 Jurnal Umum</h2>${filterBar()}<div class="scroll"><table>
    <tr><th>Tanggal</th><th>Kolam</th><th>Keterangan</th><th>Akun</th><th class="r">Debit</th><th class="r">Kredit</th></tr>
    ${j.map(x => `<tr><td>${x.tanggal}</td><td>${esc(x.kode_kolam)}</td><td>${esc(x.keterangan)}</td><td class="${+x.credit ? 'indent' : ''}">${esc(x.akun)}</td>
    <td class="r">${+x.debit ? rp(x.debit) : ''}</td><td class="r">${+x.credit ? rp(x.credit) : ''}</td></tr>`).join('')}
    <tr class="tot"><td colspan="4">Total ${Math.abs(D - K) < 1 ? '(seimbang ✓)' : '(TIDAK seimbang)'}</td><td class="r">${rp(D)}</td><td class="r">${rp(K)}</td></tr></table></div>
    <p class="hint">Dibuat otomatis dari data kolam & transaksi (tidak perlu input manual).</p>`;
}

// ===== Laba Rugi: Penjualan - HPP =====
async function labaRugi() {
  const j = await getJurnal(filterKolam), pend = perAkun(j, '4', -1), beban = perAkun(j, '5', 1);
  const tp = sumBy(pend, x => x[1]), tb = sumBy(beban, x => x[1]), laba = tp - tb, kat = {};
  j.filter(x => x.kategori).forEach(x => kat[x.kategori] = (kat[x.kategori] || 0) + +x.debit);
  $('#main').innerHTML = `<h2>📈 Laporan Laba Rugi</h2>${filterBar()}<table class="lap">
    ${tr('<b>PENJUALAN</b>', '', 'sub')}${pend.map(([a, v]) => tr('<span class="indent">' + esc(a) + '</span>', rp(v))).join('')}${tr('Total penjualan', rp(tp), 'tot')}
    ${tr('<b>HARGA POKOK PENJUALAN & BEBAN</b>', '', 'sub')}${beban.map(([a, v]) => tr('<span class="indent">' + esc(a) + '</span>', '(' + rp(v) + ')')).join('')}${tr('Total HPP & beban', '(' + rp(tb) + ')', 'tot')}
    ${tr(laba >= 0 ? '<b>LABA BERSIH</b>' : '<b>RUGI BERSIH</b>', rp(laba), 'tot ' + (laba >= 0 ? 'plus' : 'minus'))}</table>
    <h2 style="margin-top:22px">Rincian Biaya Produksi (dikapitalisasi ke persediaan)</h2><table class="lap">
    ${Object.entries(kat).map(([k, v]) => tr(esc(k), rp(v))).join('')}${tr('Total biaya produksi', rp(sumBy(Object.values(kat), v => v)), 'tot')}</table>
    <p class="hint">HPP hanya mencakup biaya ikan yang sudah dipanen. Biaya ikan yang belum dipanen masih berada di Persediaan (lihat Posisi Keuangan).</p>`;
}

// ===== Laporan Posisi Keuangan =====
// Aset = Kas + Persediaan Ikan | Liabilitas = Utang Usaha | Ekuitas = Modal + Laba/Rugi berjalan
async function posisiKeuangan() {
  const j = await getJurnal(filterKolam), kas = tot(j, '1-001', 1), ps = tot(j, '1-002', 1), ut = tot(j, '2-001', -1), modal = tot(j, '3-001', -1);
  const laba = tot(j, '4', -1) - tot(j, '5', 1), eq = modal + laba, ok = Math.abs(kas + ps - ut - eq) < 1;
  $('#main').innerHTML = `<h2>🏦 Laporan Posisi Keuangan</h2>${filterBar()}<table class="lap">
    ${tr('<b>ASET</b>', '', 'sub')}${tr('<span class="indent">Kas</span>', rp(kas))}${tr('<span class="indent">Persediaan ikan dalam pemeliharaan</span>', rp(ps))}${tr('Total aset', rp(kas + ps), 'tot')}
    ${tr('<b>LIABILITAS</b>', '', 'sub')}${tr('<span class="indent">Utang usaha</span>', rp(ut))}${tr('Total liabilitas', rp(ut), 'tot')}
    ${tr('<b>EKUITAS</b>', '', 'sub')}${tr('<span class="indent">Modal pemilik</span>', rp(modal))}${tr('<span class="indent">Laba/rugi berjalan</span>', rp(laba))}${tr('Total ekuitas', rp(eq), 'tot')}
    ${tr('Total liabilitas + ekuitas', rp(ut + eq), 'tot')}</table>
    <p class="${ok ? 'plus' : 'minus'}">${ok ? 'Seimbang ✓ (Aset = Liabilitas + Ekuitas)' : 'Tidak seimbang - periksa data'}</p>
    <p class="hint">Isi "Modal awal" di menu Kolam agar kas tidak negatif. Penjualan dianggap tunai (belum ada piutang).</p>`;
}

// ===== CRUD generik: tambah, edit, hapus =====
async function crud(c) {
  if (page === 'transaksi' && !kolam.length) return $('#main').innerHTML = '<p>Tambah data kolam dulu di menu 🌊 Kolam.</p>';
  const {data, error} = await db.from(c.table).select(c.select || '*').order(c.order, {ascending: false});
  if (error) alert(error.message);
  rows = data || [];
  const inp = f => `<div><label>${f.l}</label>` + (f.t === 'select'
    ? `<select name="${f.k}">${f.o().map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>`
    : `<input name="${f.k}" type="${f.t}" step="any" ${f.req ? 'required' : ''} ${f.t === 'date' ? `value="${today}"` : ''}>`) + '</div>';
  $('#main').innerHTML = `<h2>${c.title}</h2><form id="ff" onsubmit="save(event)">${c.fields.map(inp).join('')}
    <div class="btns"><button class="btn" id="bs">+ Simpan</button><button type="button" class="btn gray" id="bc" hidden onclick="editId=null;render()">Batal</button></div></form>
    <div class="scroll"><table><tr>${c.cols.map(x => `<th>${x[0]}</th>`).join('')}<th></th></tr>
    ${rows.map(r => `<tr>${c.cols.map(x => `<td>${esc(x[1](r))}</td>`).join('')}<td><button class="edit" onclick="edit(${r.id})">Edit</button><button class="del" onclick="del(${r.id})">Hapus</button></td></tr>`).join('')}</table></div>`;
}
function edit(id) {
  const r = rows.find(x => x.id === id), f = $('#ff').elements; editId = id;
  CFG[page].fields.forEach(x => f[x.k].value = r[x.k] ?? '');
  $('#bs').textContent = '✓ Update'; $('#bc').hidden = false; scrollTo({top: 0, behavior: 'smooth'});
}
async function save(e) {
  e.preventDefault(); const c = CFG[page], o = {};
  c.fields.forEach(x => { const v = e.target.elements[x.k].value; o[x.k] = x.t === 'number' ? (v === '' ? 0 : +v) : x.num ? +v : (v === '' ? null : v); });
  const {error} = editId ? await db.from(c.table).update(o).eq('id', editId) : await db.from(c.table).insert(o);
  if (error) return alert(error.message);
  editId = null; if (page === 'kolam') await loadRefs(); render();
}
async function del(id) {
  if (!confirm('Hapus data ini?' + (page === 'kolam' ? ' Semua transaksi kolam ini ikut terhapus.' : ''))) return;
  const {error} = await db.from(CFG[page].table).delete().eq('id', id);
  if (error) return alert(error.message);
  if (page === 'kolam') await loadRefs(); render();
}

const PAGES = {ringkasan, utang, jurnal: jurnalUmum, labarugi: labaRugi, posisi: posisiKeuangan};
(async () => { await loadRefs(); render(); })();
