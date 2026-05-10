# MQTT Digital Signage Controller (MQTT 5.0 Demo)

Sistem ini adalah implementasi lengkap koordinasi Papan Reklame Digital menggunakan protokol MQTT 5.0, mencakup semua fitur canggih yang diminta.

## Fitur MQTT 5.0 yang Diimplementasikan

1.  **Publish/Subscribe & QoS**:
    - QoS 0: Audience Analytics (non-critical).
    - QoS 1: Content Updates (must arrive).
    - QoS 2: Emergency Alerts (exactly once delivery).
2.  **Wildcards**: Digunakan untuk berlangganan konten zona (`display/zone/+/content`) dan peringatan (`alert/#`).
3.  **Topic Alias**: Digunakan dalam Health Reports untuk mengurangi overhead bandwidth pada pengiriman berulang.
4.  **User Properties**: Metadata kampanye (content-type, duration, campaign-id) dikirim bersama pesan konten.
5.  **Retain**: Status konten terakhir disimpan di broker. Layar yang baru menyala (atau reboot) langsung mendapatkan konten tanpa menunggu jadwal berikutnya.
6.  **Expiry**: Pesan darurat disetel dengan Expiry Interval (1 jam) agar tidak dikirim ke layar yang sudah lama offline.
7.  **Last Will Testament (LWT)**: Jika layar kehilangan koneksi secara tiba-tiba, broker akan menerbitkan status "offline" ke topik kesehatan.
8.  **Request-Response**: Layar mengirim permintaan status awal saat boot, dan Maintenance Monitor merespons menggunakan properti `Response-Topic`.
9.  **Shared Subscription**: Data analitik diproses oleh sekumpulan worker menggunakan prefix `$share/`. Beban kerja terbagi rata di antara worker.
10. **Flow Control**: Client disetel dengan `Receive Maximum` untuk membatasi jumlah pesan in-flight (demonstrasi backpressure).

## Cara Menjalankan

### Persiapan (sekali)
```bash
uv sync
```
Pastikan Docker berjalan, lalu:

### Jalankan
```bash
./run_demo.sh
```
Skrip ini akan otomatis menjalankan MQTT broker via Docker Compose, lalu membuka **TUI Dashboard** interaktif di terminal yang sama.

Dashboard menampilkan 9 panel dalam grid 3×3 (Halaman 1) dan satu panel log penuh (Halaman 2):

```
┌─ ANALYTICS WORKERS ─┐┌─ DISPLAY MONITOR ──┐┌─ NOW DISPLAYING ──┐
│                     ││  ID    Status  Temp ││  Screen → Content │
├─────────────────────┤├────────────────────┤├───────────────────┤
│─ WEATHER SERVICE ───┐┌─ AD BIDDER ────────┐┌─ CONTENT SCHEDULER┐
│                     ││                    ││                   │
├─────────────────────┴┴────────────────────┴┴───────────────────┤
│─ PUBLISH EVENTS ──────────────┐┌─ SUBSCRIBE EVENTS ───────────┐│
│  ⬆ [SERVICE] topic → …       ││  ⬇ [SERVICE] heartbeat: …   ││
└───────────────────────────────┘└──────────────────────────────┘
  [1] DASHBOARD  [2] LOGS   [Tab] Switch Page   [Q] Quit
```

| Tombol | Fungsi |
|--------|--------|
| `Tab` | Ganti halaman |
| `1` / `2` | Langsung ke halaman |
| `Q` | Keluar (semua service dihentikan) |
| `Ctrl+C` | Force kill |

### Simulasi Darurat (terminal terpisah)
Buka terminal baru kapan saja dan jalankan:
```bash
source .venv/bin/activate
python emergency.py "EVAKUASI AREA LOBBY SEKARANG"
```
Perintah `--clear` untuk mengakhiri darurat:
```bash
python emergency.py --clear
```

## Arsitektur Simulasi
- **Content Scheduler**: Publisher (mengatur jadwal).
- **Emergency System**: Publisher (pesan darurat prioritas tinggi).
- **Weather Updater**: Publisher (update cuaca lokal per zona).
- **Ad Bidder**: Publisher (Bidding iklan real-time yang mem-bypass jadwal).
- **Screen Client**: Subscriber & Publisher (menerima konten & cuaca, mengirim health & analitik).
- **Maintenance Monitor**: Subscriber & Publisher (menangani LWT dan sinkronisasi boot).
- **Analytics Workers**: Subscriber (memproses data dengan *Shared Subscriptions* `$share/`).
- **Database Logger**: Subscriber Murni (menggunakan Wildcard `#` untuk sinkronisasi DB).