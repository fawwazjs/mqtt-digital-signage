# Laporan Projek Implementasi MQTT - Pulsar: Sistem Kontrol Papan Reklame Digital

## Anggota

| Nama | NRP|
|-------------------------------|---------------|
| Ahmad Wildan Fawwaz| 5027241001 |
| Muhammad Rakha Hananditya R.| 5027241015 |

## Deskripsi Projek

<p align="justify">
<b>Pulsar</b> adalah simulasi implementasi dari sistem perangkat lunak pengontrol papan reklame digital atau <i>Digital Signage</i> terdistribusi yang didukung oleh protokol komunikasi <b>MQTT</b>. Pulsar juga didukung dengan implementasi <i>dashboard</i> yang dapat digunakan untuk memanajemen dan melihat secara visual reklame digital yang ditangani dalam suatu area, mendapatkan data analitik yang meliputi posisi status, kesehatan, <i>viewership</i>, dan apa yang sedang ditayangkan reklame tersebut dengan menggunakan integrasi <b>WebSocket</b> yang terhubung langsung dengan sistem MQTT. Di mana melalui penerapan terpusat ini, sistem diharapkan mampu menjalankan koordinasi tersinkronisasi, pemantauan <i>real-time</i>, hingga penanganan kedaruratan dengan lebih efisien dan efektif.
</p>

## Arsitektur dan Aliran Data (Data Flow)

Sistem mengadopsi arsitektur **Decoupled Microservices**. Tidak ada satu pun layanan yang mengetahui keberadaan layanan lain secara langsung; semua interaksi dimediasi oleh MQTT Broker.

<img width="1802" height="589" alt="Image" src="https://github.com/user-attachments/assets/5ff28305-4f2f-44b3-9f42-efd95129b3de" />

### Skenario Aliran Data:
1.  **Update Konten**: Scheduler mengirimkan instruksi ke topik `content/zone/+/schedule`. Layar yang berlangganan pada zona tersebut akan segera mengganti konten yang ditampilkan.
2.  **Keadaan Darurat**: Emergency Manager mengirimkan pesan dengan **QoS 2** (Exactly Once) ke topik `alert/network/emergency`. Semua layar akan menghentikan konten komersial dan menampilkan instruksi evakuasi dalam hitungan milidetik.
3.  **Analitik Viewership**: Layar mengirimkan data penonton ke topik `analytics/zone/+/viewership`. Data ini dikonsumsi oleh sekelompok worker menggunakan **Shared Subscription** untuk memastikan efisiensi pemrosesan.

---

## Desain Hierarki Topik (Topic Tree)

### Visualisasi Topic Tree:

```text
root/
├── display/
│   └── {screen_id}/
│       ├── status                  # LWT/Koneksi (Retained)
│       ├── health                  # Telemetri Hardware (CPU, Temp)
│       ├── request/
│       │   └── playlist            # RPC Request (Client -> Scheduler)
│       └── response/
│           └── playlist            # RPC Response (Scheduler -> Client)
├── content/
│   ├── zone/
│   │   └── {zone_id}/
│   │       └── schedule            # Konten terjadwal per area
│   └── display/
│       └── {screen_id}/
│           └── override            # Konten khusus layar tertentu
├── alert/
│   ├── network/
│   │   ├── emergency               # Pesan evakuasi global (QoS 2)
│   │   └── maintenance             # Pemberitahuan sistem (QoS 1)
│   └── zone/
│       └── {zone_id}/
│           └── emergency           # Pesan darurat area spesifik
├── analytics/
│   └── zone/
│       └── {zone_id}/
│           └── viewership          # Data sensor penonton (Shared Sub)
└── environment/
    └── zone/
        └── {zone_id}/
            └── weather             # Informasi cuaca lokal
```

### Rincian Topik dan Parameter:

| Pola Topik | Deskripsi | QoS | Retain | Karakteristik |
| :--- | :--- | :--- | :--- | :--- |
| `display/{id}/status` | Status koneksi layar (Online/Offline) | 1 | Yes | Menggunakan **LWT** untuk deteksi kegagalan. |
| `display/{id}/health` | Telemetri (CPU, Temp, RAM, Uptime) | 0 | Yes | Data streaming cepat, kehilangan 1 pesan tidak krusial. |
| `display/{id}/request/playlist` | RPC: Layar meminta daftar putar | 1 | No | Menggunakan **Response Topic** dan **Correlation Data**. |
| `content/zone/{id}/schedule` | Instruksi konten berdasarkan zona | 1 | Yes | Memastikan layar baru menyala langsung mendapat konten. |
| `alert/network/#` | Peringatan global (Kebakaran, Gempa, dll) | 2 | Yes | Menjamin pesan sampai tepat satu kali ke semua layar. |
| `analytics/zone/{id}/viewership` | Data sensor penonton (Face Tracking) | 0 | No | Diolah menggunakan **Shared Subscriptions**. |
| `environment/zone/{id}/weather` | Data cuaca lokal untuk display info | 0 | No | Broadcast berkala. |

---

## Rincian Implementasi Fitur MQTT

<p align="justify">
Adapun, tabel di bawah ini merangkum kapabilitas protokol MQTT yang difungsikan dalam sistem beserta urgensi arsitektural dan letak implementasinya:
</p>

<table border="1" style="width:100%; border-collapse: collapse; text-align: justify; font-size: 14px;">
  <thead style="background-color: rgba(255,255,255,0.1);">
    <tr>
      <th style="padding: 10px;">No</th>
      <th style="padding: 10px; width: 15%;">Fitur MQTT</th>
      <th style="padding: 10px; width: 35%;">Fungsi dan Tujuan Implementasi</th>
      <th style="padding: 10px; width: 45%;">Detail Implementasi & Lokasi File</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding: 10px; text-align: center;">1</td>
      <td style="padding: 10px;"><b>Publish</b></td>
      <td style="padding: 10px;">Mengirimkan pesan melalui perantara broker. Pesan ini akan dialirkan kepada seluruh <i>subscriber</i> yang berlangganan pada rute topik yang sesuai.</td>
      <td style="padding: 10px;">Diimplementasikan melalui implementasi <code>publish()</code> pada <code>common.py</code>. Di mana digunakan dalam kode <code>emergency.py</code>, <code>scheduler.py</code>, <code>screen_client.py</code>, dan dashboard Pulsar.</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">2</td>
      <td style="padding: 10px;"><b>Subscribe</b></td>
      <td style="padding: 10px;">Mendaftarkan langganan untuk menerima pesan berdasarkan topik yang ditetapkan, serta mengarahkan rute broker untuk memanggil fungsi <i>callback</i> <code>on_message</code>.</td>
      <td style="padding: 10px;">Diimplementasikan pada <code>common.py</code>, layar <code>screen_client.py</code> yang berlangganan cuaca dan konten, serta pekerja analitik <code>analytics_worker.py</code>.</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">3</td>
      <td style="padding: 10px;"><b>QoS 0</b><br><small><i>(At-most-once)</i></small></td>
      <td style="padding: 10px;">Pengiriman asinkron tercepat tanpa <i>acknowledgment</i> (ACK). Digunakan ketika pesan hilang masih dapat ditoleransi karena tingginya volume pembaruan data.</td>
      <td style="padding: 10px;">Digunakan di <code>screen_client.py</code> untuk telemetri detak jantung (<i>heartbeat</i>) dan data estimasi analitik <i>viewership</i>. Keterlambatan/kehilangan paket satu detik tidak merusak integritas.</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">4</td>
      <td style="padding: 10px;"><b>QoS 1</b><br><small><i>(At-least-once)</i></small></td>
      <td style="padding: 10px;">Pesan disimpan sampai pengirim menerima ACK. Membawa kemungkinan pesan terduplikasi, sehingga hanya aman bagi aksi yang <i>idempotent</i>.</td>
      <td style="padding: 10px;">Diimplementasikan di <code>scheduler.py</code> untuk penggantian *playlist* layar. Menerima instruksi "putar konten X" dua kali tidak mendistorsi kondisi sistem yang sesungguhnya.</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">5</td>
      <td style="padding: 10px;"><b>QoS 2</b><br><small><i>(Exactly-once)</i></small></td>
      <td style="padding: 10px;">Ganti rugi waktu untuk kepastian presisi (proses jabat tangan empat arah). Menjamin pesan tidak hilang dan tidak terduplikasi sama sekali.</td>
      <td style="padding: 10px;">Eksklusif digunakan oleh <code>emergency.py</code> dan pengawas langganannya untuk instruksi peringatan kebencanaan. Pesan evakuasi yang hilang membahayakan keselamatan, sedangkan jika ganda membingungkan operator sistem.</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">6</td>
      <td style="padding: 10px;"><b>Topic Wildcards</b></td>
      <td style="padding: 10px;">Meningkatkan efisiensi filter pencocokan topik. Operator <code>+</code> merepresentasikan satu jenjang tingkat; <code>#</code> menyapu sisa tingkat secara hierarkis.</td>
      <td style="padding: 10px;">Krusial dalam pengumpulan intelijen secara holistik (*fleet-wide*). Contoh: <code>display/+/request/playlist</code> di <code>scheduler.py</code> atau <code>alert/network/#</code> di pengawasan dasbor (<code>dashboard_server.py</code>).</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">7</td>
      <td style="padding: 10px;"><b>Topic Alias</b></td>
      <td style="padding: 10px;">Optimisasi <i>header payload</i> yang mendaftarkan string rute topik panjang ke dalam integer (ID) 2-bita demi penghematan ukuran repetisi pesan di jaringan.</td>
      <td style="padding: 10px;">-</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">8</td>
      <td style="padding: 10px;"><b>User Properties</b></td>
      <td style="padding: 10px;">Keunggulan MQTT 5.0 yang menyisipkan data pasangan <i>Key-Value</i> khusus di dalam *header* Properties PUBLISH untuk memisahkan metadata operasional dengan badan (*body/payload*) pesan.</td>
      <td style="padding: 10px;">Melampirkan <code>alert_type</code> dan <code>severity</code> pada sinyal darurat (<code>emergency.py</code>). Di <code>scheduler.py</code> digunakan untuk menyematkan tipe berkas media (<code>content_type</code>). Dasbor otomatis merelai metadata ini tanpa intervensi manual.</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">9</td>
      <td style="padding: 10px;"><b>Retain Message</b></td>
      <td style="padding: 10px;">Klien baru (*Subscriber* yang terlambat bergabung) bisa langsung mendapat status sinkronisasi sistem terbaru yang disimpan *flag*-nya di broker.</td>
      <td style="padding: 10px;">Aktif pada pesan <i>emergency</i> dan konfigurasi kampanye statis (<code>scheduler.py</code>). Layar mati yang melakukan *reboot* otomatis kembali disuguhi antrean penayangan konten termutakhir tanpa harus me-*request* secara mandiri.</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">10</td>
      <td style="padding: 10px;"><b>Message Expiry Interval</b></td>
      <td style="padding: 10px;">Masa hidup pesan (TTL) agar pesan peringatan tidak menggantung sebagai memori mati di broker jika layar sedang tak terhubung.</td>
      <td style="padding: 10px;">Disetel bersamaan dengan peringatan retained pada <code>emergency.py</code> (<i>expiry=3600 detik</i>). Layar yang mati selama berhari-hari tidak akan tiba-tiba disuguhi peringatan evakuasi usang yang sudah kedaluwarsa sewaktu menyala.</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">11</td>
      <td style="padding: 10px;"><b>LWT</b><br><small><i>(Last Will and Testament)</i></small></td>
      <td style="padding: 10px;">Deteksi proaktif putusnya sesi TCP klien. Pesan peninggalan ini dikirim otomatis oleh Broker jika koneksi putus secara tak wajar.</td>
      <td style="padding: 10px;"><code>screen_client.py</code> mendaftarkan LWT yang memuat pesan "offline". Jika sebuah layar reklame kehilangan sumber daya/daya listrik mati mendadak, <code>maintenance_monitor.py</code> secara instan mendapat visibilitas terhadap pemutusan tersebut.</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">12</td>
      <td style="padding: 10px;"><b>Request-Response Pattern</b></td>
      <td style="padding: 10px;">Protokol panggilan RPC dua arah (*Remote Procedure Call*) MQTT 5.0 menggunakan atribut bawaan <code>ResponseTopic</code> dan data kolerasi biner pelacakan <code>CorrelationData</code>.</td>
      <td style="padding: 10px;">Digunakan saat <code>screen_client.py</code> memerlukan sekumpulan antrean media besar (*playlist*) yang tidak dapat disajikan murni oleh <i>Retained Messages</i>, untuk mendapatkan jawaban spesifik dan beridentitas ke <code>scheduler.py</code>.</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">13</td>
      <td style="padding: 10px;"><b>Shared Subscription</b></td>
      <td style="padding: 10px;">Pendistribusian beban klaster konsumsi secara hierarkis dan <i>round-robin</i> antar sekumpulan worker menggunakan awalan pola `$share/{group}/...`</td>
      <td style="padding: 10px;">Dihidupkan untuk meratakan banjir lalu-lintas data layar menuju <code>analytics_worker.py</code> dan <code>maintenance_monitor.py</code>, sehingga setiap data hanya dilahap secara spesifik oleh instansi server yang tidak terbebani secara ganda.</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">14</td>
      <td style="padding: 10px;"><b>Flow Control</b><br><small><i>(Backpressure)</i></small></td>
      <td style="padding: 10px;">Atribut parameter sambungan untuk membatasi jumlah pesan (QoS 1 & 2) yang membanjiri klien (*in-flight limit*) dalam satu waktu tertentu untuk menghindari kelumpuhan antrean memori.</td>
      <td style="padding: 10px;">Dikonfigurasi di fondasi kelas <code>common.py</code> (mendefinisikan paket penghubung <code>ReceiveMaximum=20</code>). Klien layar di perbatasan komputasi (Raspberry Pi/Low-Spec) terhindar dari pemadatan RAM apabila broker mem-<i>broadcast</i> badai peringatan massal.</td>
    </tr>
  </tbody>
</table>

<br>

---

## 4. Implementasi Fitur MQTT 5.0 (Deep Dive)

Sistem ini mendemonstrasikan keunggulan MQTT 5.0 melalui implementasi 9 fitur utama yang menjamin keandalan dan efisiensi jaringan:

### A. Topic Hierarchy & Wildcards
Struktur topik dirancang secara hierarkis untuk pemfilteran efisien menggunakan wildcard `+` (single-level) dan `#` (multi-level).
```python
# Contoh penggunaan di Database Logger (db_logger.py)
# Berlangganan ke SELURUH trafik jaringan menggunakan wildcard '#'
self.subscribe("#", qos=0)

# Contoh di Dashboard Server (dashboard_server.py)
# Berlangganan ke health seluruh layar tanpa peduli ID layarnya
self.subscribe("display/+/health", qos=0)
```

### B. Retained Messages
Menyimpan pesan terakhir di broker sehingga layar yang baru menyala (*late-joiner*) langsung mendapatkan status terbaru tanpa menunggu publikasi berikutnya.
```python
# Lokasi: scheduler.py
# Menyimpan jadwal konten terakhir agar layar yang reboot langsung tahu apa yang harus diputar
self.publish(f"content/zone/{zone_id}/schedule", payload, qos=1, retain=True)
```

### C. Message Expiry Interval
Menetapkan masa berlaku pesan agar instruksi yang sudah basi (seperti peringatan cuaca atau darurat lama) tidak diterima oleh layar yang baru aktif setelah sekian lama.
```python
# Lokasi: emergency.py
# Pesan darurat hanya berlaku selama 1 jam (3600 detik)
self.publish("alert/network/emergency", payload, qos=2, expiry=3600)
```

### D. User Properties (Metadata)
Menyisipkan pasangan kunci-nilai (Key-Value) kustom pada header pesan untuk metadata operasional tanpa mengubah payload JSON utama.
```python
# Lokasi: screen_client.py
# Mengirim tipe zona sebagai metadata analitik
user_props = [("zone_type", "campus_area"), ("priority", "high")]
self.publish(topic, payload, user_properties=user_props)
```

### E. Topic Alias
*Konsep:* Mengurangi overhead bandwidth dengan mengganti string topik yang panjang menjadi ID integer (2-byte) setelah pengiriman pertama.
*(Catatan: Fitur ini ditangani secara otomatis oleh library paho-mqtt jika dikonfigurasi, sangat krusial untuk koneksi seluler/low-bandwidth).*

### F. Last Will and Testament (LWT)
Mekanisme "Pesan Wasiat" yang dikirim otomatis oleh broker jika layar terputus secara tidak wajar (misal: crash atau kehilangan daya).
```python
# Lokasi: screen_client.py
lwt = {
    "topic": f"display/{self.screen_id}/status",
    "payload": json.dumps({"status": "offline", "reason": "Connection Lost"}),
    "qos": 1,
    "retain": True,
}
self.connect(last_will=lwt)
```

### G. Request-Response Pattern
Menggunakan atribut `ResponseTopic` dan `CorrelationData` untuk pola komunikasi dua arah (RPC) murni di atas MQTT.
```python
# Lokasi: screen_client.py (Request)
self.publish(
    "display/request/playlist", 
    payload, 
    response_topic=f"display/{self.screen_id}/response",
    correlation_data=b"req_v1_001"
)
```

### H. Shared Subscriptions
Mendistribusikan beban konsumsi pesan ke sekelompok worker secara *round-robin* untuk menghindari kelebihan beban pada satu instansi.
```python
# Lokasi: analytics_worker.py
# Menggunakan format $share/{group_id}/{topic}
self.subscribe("$share/analytics_cluster/analytics/zone/+/viewership", qos=0)
```

### I. Flow Control (Receive Maximum)
Membatasi jumlah pesan QoS 1/2 yang "in-flight" (sedang diproses) untuk mencegah *flooding* pada memori perangkat layar dengan spesifikasi rendah.
```python
# Lokasi: common.py
# Membatasi maksimal 20 pesan in-flight secara bersamaan
properties = Properties(PacketTypes.CONNECT)
properties.ReceiveMaximum = 20
self.client.connect(host, port, properties=properties)
```

---

Sistem Dasbor dan Visualisasi

### A. Web Dashboard (High-End Operations Center)
Dibangun menggunakan teknologi web modern untuk memberikan visibilitas total bagi operator.
*   **Dashboard Server (`dashboard_server.py`)**: Jembatan asinkron antara MQTT dan WebSockets. Mempertahankan "State Snapshot" untuk sinkronisasi instan saat halaman dimuat.
*   **Visualisasi Geografis**: Integrasi **Leaflet.js** untuk memetakan lokasi layar. Status online/offline divisualisasikan dengan warna dinamis.
*   **Grid Telemetri**: Menampilkan performa hardware layar yang diperbarui secara real-time.
*   **Content Management**: Antarmuka untuk mengunggah media dan memantau antrean pemutaran.

### B. Terminal UI (TUI - Admin Tool)
Dibangun menggunakan library **Textual** dan **Rich**, memberikan alat debugging yang sangat kuat bagi pengembang.
*   **9-Panel Grid**: Menampilkan status dari seluruh microservices (Weather, Scheduler, Bidder, dll) dalam satu tampilan.
*   **Real-time Event Log**: Monitor setiap paket MQTT (Publish, Subscribe, Connect) dengan pewarnaan sintaksis yang jelas.
*   **Lifecycle Manager**: Memungkinkan kontrol penuh atas proses simulasi dari dalam terminal.

---

## Petunjuk Pengoperasian Program (Run Demo)

Untuk mencoba skenario terintegrasi, pastikan manajemen dependensi paket telah siap (melalui `uv`) dan *MQTT broker daemon* aktif di mesin Anda:

1. **Sinkronisasi Package Lingkungan Python**
   ```bash
   uv sync
   source .venv/bin/activate
   ```

2. **Eksekusi Demonstrasi**
   ```bash
   ./run_demo.sh
   ```
   Skrip ini secara otomatis akan menjalankan MQTT *broker* (apabila *Docker Desktop/Compose* telah berjalan) lalu membangun instansi antarmuka simulasi sistem (Terminal TUI) untuk mendemonstrasikan status lalu-lintas lintas pub/sub. Bersamaan dengan hal itu, peladen dasbor Web beroperasi secara dinamis pada port lokal.

3. **Membuka Dasbor Pemantauan (Web GUI)**
   Buka peramban Web (*Browser*) favorit Anda lalu navigasikan ke tautan berikut:
   **[http://localhost:8080/](http://localhost:8080/)**

</div>
