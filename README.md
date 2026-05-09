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

1.  **Persyaratan**: Docker & Python 3.12.
2.  **Jalankan Broker**:
    ```bash
    docker compose up -d
    ```
3.  **Jalankan Demo**:
    ```bash
    ./run_demo.sh
    ```
4.  **Buka Dashboard**:
    Akses `http://localhost:8080` di browser Anda.

## Arsitektur Simulasi
- **Content Scheduler**: Publisher yang mengatur jadwal konten.
- **Emergency System**: Publisher untuk pesan darurat prioritas tinggi.
- **Screen Client**: Simulasi layar fisik (A101, A102, B201).
- **Maintenance Monitor**: Menangani kesehatan layar dan Request-Response.
- **Analytics Workers**: Memproses data penonton secara terdistribusi.