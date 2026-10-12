# SIA-LeleDesaku

LeleDesaku adalah aplikasi web sederhana untuk **membantu peternak lele** mencatat keuangan usahanya dengan rapi, tanpa perlu paham akuntansi yang rumit. Peternak cukup mencatat kegiatan harian (beli benih dan pakan, ikan mati, panen, dan penjualan), lalu aplikasi menyusun laporannya secara otomatis.

## 🔗 Demo Aplikasi
**Link demo:** [https://rofiqrk.github.io/LinkLeleDesaku/]

> Link ini diisi setelah aplikasi dipublikasikan. Lihat bagian "Cara membuat link demo" di bawah.

## 🎯 Manfaat untuk peternak
- Mengetahui **untung atau rugi** setiap kolam dan setiap periode panen.
- Mengetahui **biaya produksi per kg** ikan, sebagai dasar menentukan harga jual.
- Memantau **jumlah ikan hidup**, tingkat kematian (mortalitas), dan efisiensi pakan (FCR).
- Mencatat **utang** ke toko pakan atau benih, lengkap dengan pelunasannya.
- Melihat **nilai ikan yang masih dipelihara** (persediaan) sebagai bagian dari aset usaha.
- Laporan keuangan standar dibuat otomatis: **Jurnal Umum, Laba Rugi, dan Posisi Keuangan**, ditambah grafik ringkasan.

## ✨ Fitur
| Menu | Fungsi |
|---|---|
| 📊 Ringkasan & Grafik | Ikan hidup, persediaan, utang, penjualan, laba, dan 3 grafik |
| 🌊 Kolam | Tambah, edit, dan hapus data kolam dan tebar benih |
| 🧾 Transaksi | Catat biaya, panen, kematian, dan pelunasan utang |
| 💳 Utang Usaha | Sisa utang per kolam dan riwayatnya |
| 📒 Jurnal Umum | Jurnal debit-kredit otomatis |
| 📈 Laba Rugi | Penjualan dikurangi HPP, dengan rincian biaya produksi |
| 🏦 Posisi Keuangan | Aset = Liabilitas + Ekuitas |

## 🧰 Teknologi
- **Frontend:** HTML, CSS, JavaScript, Chart.js
- **Backend:** Supabase (PostgreSQL)

## 🗂️ Struktur Folder
```
LeleDesaku/
├── index.html          # halaman utama
├── css/style.css       # tampilan
├── js/
│   ├── config.js       # URL & key Supabase (satu-satunya file yang diedit)
│   └── app.js          # logika aplikasi
└── sql/schema.sql      # tabel, view akuntansi, kategori awal
```

## 🧱 Desain Database (3 entitas)
`kolam` (1) ──< `transaksi` >── (1) `kategori_akun`

Jurnal umum, HPP, dan ringkasan dihitung otomatis lewat *view* di database, jadi tidak ada input ganda.

## 🚀 Cara Menjalankan
1. **Supabase:** buat project, buka *SQL Editor*, tempel isi `sql/schema.sql`, lalu klik *Run* (harus *Success*).
2. **Kunci koneksi:** salin *Project URL* dan *anon/publishable key* dari *Project Settings > API Keys* ke `js/config.js`.
3. **VS Code:** buka folder proyek, pasang ekstensi **Live Server**, klik kanan `index.html`, lalu pilih *Open with Live Server*.
4. Tambah kolam di menu **Kolam**, catat transaksi di menu **Transaksi**, lalu lihat laporannya.

## 📝 Cara Mencatat Transaksi
| Kejadian | Kategori | Nilai (Rp) | Ekor | Kg |
|---|---|---|---|---|
| Beli pelet | 5-001 Pakan | total harga | - | kg pelet |
| Obat, gaji, listrik, dan lainnya | 5-002 s.d. 5-006 | nilai biaya | - | - |
| Ikan mati | 6-001 Kematian Ikan | 0 | jumlah mati | - |
| Panen dan jual | 4-001 Penjualan Lele | hasil penjualan | jumlah ikan | kg panen |
| Bayar utang | 2-001 Pelunasan Utang | jumlah dibayar | - | - |

Untuk pembelian berutang, pilih **Cara bayar = kredit** saat mencatat biaya.
