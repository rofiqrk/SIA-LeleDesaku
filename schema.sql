-- =====================================================================
-- LeleDesaku - Sistem Informasi Akuntansi Pembesaran Lele
-- PostgreSQL untuk Supabase. Jalankan di: SQL Editor > New query > Run
-- ERD 3 entitas: kolam (1) --< transaksi >-- (1) kategori_akun
-- Jalankan SEKALI pada database kosong. Jika muncul error 'already exists', tabel sudah pernah dibuat.
-- =====================================================================

-- ENTITAS 1: kolam = satu periode pemeliharaan lele
create table kolam (
  id bigint generated always as identity primary key,
  kode_kolam varchar(20) unique not null,
  nama text not null,
  tanggal_tebar date not null default current_date,
  jumlah_benih int not null check (jumlah_benih > 0),      -- ekor
  harga_benih numeric(14,2) not null default 0,            -- Rp per ekor
  modal_awal numeric(14,2) not null default 0,             -- modal awal pemilik (untuk posisi keuangan)
  status text not null default 'aktif' check (status in ('aktif','selesai')),
  created_at timestamptz default now()
);

-- ENTITAS 2: kategori_akun = daftar akun
--   biaya      : pakan, obat, gaji, dll          (menambah biaya)
--   pendapatan : penjualan hasil panen            (menambah pendapatan)
--   mortalitas : kematian ikan (tanpa nilai Rp)   (mengurangi jumlah ikan hidup)
--   pelunasan  : pembayaran utang usaha            (mengurangi utang)
create table kategori_akun (
  id bigint generated always as identity primary key,
  kode varchar(10) unique not null,
  nama text not null,
  tipe text not null check (tipe in ('biaya','pendapatan','mortalitas','pelunasan'))
);

-- ENTITAS 3: transaksi = semua catatan keuangan & populasi
--   jumlah   : nilai Rupiah (0 untuk kematian)
--   qty_ekor : jumlah ikan (panen / kematian)
--   berat_kg : pakan -> kg pelet ; panen -> kg hasil panen
create table transaksi (
  id bigint generated always as identity primary key,
  kolam_id bigint not null references kolam(id) on delete cascade,
  kategori_id bigint not null references kategori_akun(id) on delete restrict,
  tanggal date not null default current_date,
  jumlah numeric(14,2) not null default 0 check (jumlah >= 0),
  qty_ekor int not null default 0 check (qty_ekor >= 0),
  berat_kg numeric(12,2) not null default 0 check (berat_kg >= 0),
  keterangan text,
  cara_bayar text not null default 'tunai' check (cara_bayar in ('tunai','kredit')),  -- kredit = utang usaha (khusus biaya)
  created_at timestamptz default now()
);
create index on transaksi (kolam_id);
create index on transaksi (kategori_id);

insert into kategori_akun (kode, nama, tipe) values
 ('4-001','Penjualan Lele (Panen)','pendapatan'),
 ('5-001','Pakan (Pelet)','biaya'),            -- kode 5-001 dipakai untuk menghitung FCR
 ('5-002','Obat, Probiotik & Kapur','biaya'),
 ('5-003','Tenaga Kerja','biaya'),
 ('5-004','Listrik & Air','biaya'),
 ('5-005','Sewa Lahan','biaya'),
 ('5-006','Lain-lain','biaya'),
 ('2-001','Pelunasan Utang Usaha','pelunasan'),
 ('6-001','Kematian Ikan','mortalitas');

-- Ringkasan per kolam (dipakai dashboard).
-- Total biaya sudah termasuk modal benih (jumlah_benih x harga_benih).
create view v_ringkasan_kolam with (security_invoker = true) as
select k.id, k.kode_kolam, k.nama, k.status, k.jumlah_benih,
  coalesce(t.mati,0)       as mati,
  coalesce(t.ekor_panen,0) as ekor_panen,
  coalesce(t.kg_panen,0)   as kg_panen,
  coalesce(t.kg_pakan,0)   as kg_pakan,
  k.jumlah_benih - coalesce(t.mati,0) - coalesce(t.ekor_panen,0) as ekor_hidup,
  k.jumlah_benih * k.harga_benih + coalesce(t.biaya,0) as total_biaya,
  coalesce(t.pendapatan,0) as total_pendapatan
from kolam k
left join lateral (
  select sum(x.qty_ekor) filter (where c.tipe = 'mortalitas')  as mati,
         sum(x.qty_ekor) filter (where c.tipe = 'pendapatan')  as ekor_panen,
         sum(x.berat_kg) filter (where c.tipe = 'pendapatan')  as kg_panen,
         sum(x.berat_kg) filter (where c.kode = '5-001')       as kg_pakan,
         sum(x.jumlah)   filter (where c.tipe = 'biaya')       as biaya,
         sum(x.jumlah)   filter (where c.tipe = 'pendapatan')  as pendapatan
  from transaksi x join kategori_akun c on c.id = x.kategori_id
  where x.kolam_id = k.id) t on true;

-- ---------------------------------------------------------------------
-- AKUNTANSI (semua berupa VIEW, jadi ERD tetap 3 entitas)
-- Akun: 1-001 Kas | 1-002 Persediaan Ikan dalam Pemeliharaan | 2-001 Utang Usaha
--       3-001 Modal Pemilik | 4-001 Penjualan Lele | 5-100 Harga Pokok Penjualan (HPP)
-- Biaya produksi (benih, pakan, obat, gaji, dll) DIKAPITALISASI ke persediaan,
-- lalu dibebankan sebagai HPP saat panen/jual (matching principle).
-- ---------------------------------------------------------------------
drop view if exists v_jurnal_umum;
drop view if exists v_hpp_panen;

-- HPP tiap transaksi panen = (biaya terkumpul - HPP panen sebelumnya) x ekor panen / ekor hidup sebelum panen
-- (metode biaya rata-rata; ikan mati tidak dibebankan tersendiri, biayanya ikut ikan yang tersisa)
create view v_hpp_panen with (security_invoker = true) as
with recursive h as (
  select x.id, x.kolam_id, x.tanggal, x.qty_ekor::numeric as q,
         row_number() over (partition by x.kolam_id order by x.tanggal, x.id) as rn
  from transaksi x join kategori_akun c on c.id = x.kategori_id where c.tipe = 'pendapatan'
), hc as (
  select h.id, h.kolam_id, h.q, h.rn,
    (case when k.tanggal_tebar <= h.tanggal then k.jumlah_benih * k.harga_benih else 0 end)
    + coalesce((select sum(t.jumlah) from transaksi t join kategori_akun c on c.id = t.kategori_id
                where c.tipe = 'biaya' and t.kolam_id = h.kolam_id and t.tanggal <= h.tanggal), 0) as cost_cum,
    k.jumlah_benih
    - coalesce((select sum(t.qty_ekor) from transaksi t join kategori_akun c on c.id = t.kategori_id
                where c.tipe = 'mortalitas' and t.kolam_id = h.kolam_id and t.tanggal <= h.tanggal), 0)
    - coalesce((select sum(h2.q) from h h2 where h2.kolam_id = h.kolam_id and h2.rn < h.rn), 0) as alive
  from h join kolam k on k.id = h.kolam_id
), r as (
  select id, kolam_id, rn, coalesce(round(cost_cum * q / nullif(alive, 0), 2), 0) as hpp,
         coalesce(round(cost_cum * q / nullif(alive, 0), 2), 0) as hpp_cum
  from hc where rn = 1
  union all
  select hc.id, hc.kolam_id, hc.rn,
         coalesce(round((hc.cost_cum - r.hpp_cum) * hc.q / nullif(hc.alive, 0), 2), 0),
         r.hpp_cum + coalesce(round((hc.cost_cum - r.hpp_cum) * hc.q / nullif(hc.alive, 0), 2), 0)
  from hc join r on r.kolam_id = hc.kolam_id and hc.rn = r.rn + 1
)
select id as transaksi_id, kolam_id, hpp from r;

-- JURNAL UMUM otomatis (double-entry):
--   Modal awal         : Dr Kas / Cr Modal Pemilik
--   Benih & biaya      : Dr Persediaan Ikan / Cr Kas (tunai) atau Cr Utang Usaha (kredit)
--   Pelunasan utang    : Dr Utang Usaha / Cr Kas
--   Panen & jual       : Dr Kas / Cr Penjualan ; Dr HPP / Cr Persediaan Ikan
--   Kolam 'selesai'    : sisa persediaan dibebankan (5-200 Beban Sisa Persediaan)
--   Kematian ikan      : tidak dijurnal (tidak ada nilai Rp)
create view v_jurnal_umum with (security_invoker = true) as
with b as (
  select x.id, x.kolam_id, x.tanggal, x.jumlah, x.cara_bayar, c.nama as cn, c.tipe,
         c.nama || coalesce(' - ' || x.keterangan, '') as ket
  from transaksi x join kategori_akun c on c.id = x.kategori_id
), s as (
  select k.id as kolam_id,
    greatest(k.tanggal_tebar, coalesce((select max(t.tanggal) from transaksi t where t.kolam_id = k.id), k.tanggal_tebar)) as tgl,
    k.jumlah_benih * k.harga_benih
    + coalesce((select sum(t.jumlah) from transaksi t join kategori_akun c on c.id = t.kategori_id
                where c.tipe = 'biaya' and t.kolam_id = k.id), 0)
    - coalesce((select sum(p.hpp) from v_hpp_panen p where p.kolam_id = k.id), 0) as sisa
  from kolam k where k.status = 'selesai'
)
select j.*, k.kode_kolam from (
  select id as kolam_id, tanggal_tebar as tanggal, 'Setoran modal pemilik'::text as keterangan, '1-001 Kas'::text as akun,
         modal_awal as debit, 0::numeric as credit, 1 as urutan, ('K' || id || 'a')::text as ref, null::text as kategori
    from kolam where modal_awal > 0
  union all
  select id, tanggal_tebar, 'Setoran modal pemilik', '3-001 Modal Pemilik', 0, modal_awal, 2, 'K' || id || 'a', null
    from kolam where modal_awal > 0
  union all
  select id, tanggal_tebar, 'Pembelian benih ' || nama, '1-002 Persediaan Ikan dalam Pemeliharaan', jumlah_benih * harga_benih, 0, 1, 'K' || id || 'b', 'Benih'
    from kolam where jumlah_benih * harga_benih > 0
  union all
  select id, tanggal_tebar, 'Pembelian benih ' || nama, '1-001 Kas', 0, jumlah_benih * harga_benih, 2, 'K' || id || 'b', null
    from kolam where jumlah_benih * harga_benih > 0
  union all
  select kolam_id, tanggal, ket, '1-002 Persediaan Ikan dalam Pemeliharaan', jumlah, 0, 1, 'T' || id, cn from b where tipe = 'biaya' and jumlah > 0
  union all
  select kolam_id, tanggal, ket, case when cara_bayar = 'kredit' then '2-001 Utang Usaha' else '1-001 Kas' end, 0, jumlah, 2, 'T' || id, null
    from b where tipe = 'biaya' and jumlah > 0
  union all
  select kolam_id, tanggal, ket, '2-001 Utang Usaha', jumlah, 0, 1, 'T' || id, null from b where tipe = 'pelunasan' and jumlah > 0
  union all
  select kolam_id, tanggal, ket, '1-001 Kas', 0, jumlah, 2, 'T' || id, null from b where tipe = 'pelunasan' and jumlah > 0
  union all
  select kolam_id, tanggal, ket, '1-001 Kas', jumlah, 0, 1, 'T' || id, null from b where tipe = 'pendapatan' and jumlah > 0
  union all
  select kolam_id, tanggal, ket, '4-001 Penjualan Lele', 0, jumlah, 2, 'T' || id, null from b where tipe = 'pendapatan' and jumlah > 0
  union all
  select b.kolam_id, b.tanggal, 'HPP ' || b.ket, '5-100 Harga Pokok Penjualan', p.hpp, 0, 3, 'T' || b.id, null
    from b join v_hpp_panen p on p.transaksi_id = b.id where b.tipe = 'pendapatan' and p.hpp > 0
  union all
  select b.kolam_id, b.tanggal, 'HPP ' || b.ket, '1-002 Persediaan Ikan dalam Pemeliharaan', 0, p.hpp, 4, 'T' || b.id, null
    from b join v_hpp_panen p on p.transaksi_id = b.id where b.tipe = 'pendapatan' and p.hpp > 0
  union all
  select kolam_id, tgl, 'Sisa persediaan kolam selesai', '5-200 Beban Sisa Persediaan', sisa, 0, 1, 'Z' || kolam_id, null from s where sisa > 0
  union all
  select kolam_id, tgl, 'Sisa persediaan kolam selesai', '1-002 Persediaan Ikan dalam Pemeliharaan', 0, sisa, 2, 'Z' || kolam_id, null from s where sisa > 0
) j join kolam k on k.id = j.kolam_id;

-- RLS (MODE TANPA LOGIN / DEVELOPMENT): pemegang anon key bisa baca-tulis.
-- Untuk produksi, tambahkan Supabase Auth lalu ganti 'anon' menjadi 'authenticated'.
alter table kolam enable row level security;
alter table kategori_akun enable row level security;
alter table transaksi enable row level security;
create policy "dev all" on kolam for all to anon, authenticated using (true) with check (true);
create policy "dev all" on kategori_akun for all to anon, authenticated using (true) with check (true);
create policy "dev all" on transaksi for all to anon, authenticated using (true) with check (true);
