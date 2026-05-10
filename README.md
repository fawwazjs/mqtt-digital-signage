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

## Cara Menjalankan (Rekomendasi: Terminal Terpisah)

Agar Anda bisa melihat interaksi log antar komponen secara langsung (dengan warna log yang interaktif), sangat disarankan untuk membuka beberapa **Tab Terminal** atau **Split Terminal** di IDE Anda (misal: VS Code / Cursor).

1.  **Persiapan**:
    Pastikan Broker dan Virtual Environment sudah siap:
    ```bash
    docker compose up -d
    ```

2.  **Buka Terminal 1 (Maintenance Monitor)**:
    Jalankan komponen pemantau kesehatan:
    ```bash
    source venv/bin/activate
    python maintenance_monitor.py
    ```

3.  **Buka Terminal 2 & 3 (Analytics Workers - Subscriber)**:
    Jalankan worker untuk melihat bagaimana mereka membagi tugas menggunakan *Shared Subscriptions*:
    ```bash
    # Terminal 2
    source venv/bin/activate
    python analytics_worker.py 1
    
    # Terminal 3
    source venv/bin/activate
    python analytics_worker.py 2
    ```

4.  **Buka Terminal 4, 5, 6 (Screen Clients - Subscriber & Publisher)**:
    Jalankan layar di terminal yang berbeda-beda agar terlihat perubahan kontennya:
    ```bash
    # Terminal 4
    source venv/bin/activate
    python screen_client.py A101 Lobby
    
    # Terminal 5
    source venv/bin/activate
    python screen_client.py A102 Lobby
    
    # Terminal 6
    source venv/bin/activate
    python screen_client.py B201 Gate
    
    # Anda juga bisa membuka lebih banyak terminal untuk FoodCourt atau Parking:
    # python screen_client.py C301 FoodCourt
    # python screen_client.py D401 Parking
    ```

5.  **Buka Terminal 7 (Content Scheduler - Publisher)**:
    Jalankan pengatur jadwal untuk mulai mempublikasikan konten secara teratur ke layar:
    ```bash
    source venv/bin/activate
    python scheduler.py
    ```

6.  **Buka Terminal Tambahan untuk Publisher Baru**:
    Simulasikan injeksi data *real-time*:
    ```bash
    # Cuaca (Publisher ke environment/+/weather)
    source venv/bin/activate
    python weather_updater.py
    
    # Bidding Iklan (Publisher overriding dengan QoS 1 Retain)
    source venv/bin/activate
    python ad_bidder.py
    ```

7.  **Buka Terminal untuk Sinkronisasi DB (Subscriber Murni)**:
    Simulasikan backend database yang menyedot semua data (Wildcard `#`):
    ```bash
    source venv/bin/activate
    python db_logger.py
    ```

8.  **Buka Terminal Terakhir (Dashboard Web)**:
    Jalankan server lokal untuk membuka UI Dashboard interaktif:
    ```bash
    source venv/bin/activate
    cd dashboard && python3 -m http.server 8080
    ```
    Lalu akses `http://localhost:8080` di browser Anda.

### Simulasi Darurat (Emergency - Publisher)
Buka terminal kapan saja dan jalankan perintah ini untuk melihat bagaimana **QoS 2** dan **Wildcard** bereaksi memotong semua konten di layar seketika:
```bash
source venv/bin/activate
python emergency.py "EVAKUASI AREA LOBBY SEKARANG"
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