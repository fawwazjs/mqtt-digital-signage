<div style="text-align: justify; line-height: 1.6;">

# Laporan Implementasi MQTT 5.0: Jaringan Pengontrol Papan Reklame Digital

Proyek ini adalah implementasi nyata dari perangkat lunak pengontrol jaringan papan reklame digital (*Digital Signage*) terdistribusi yang didukung oleh protokol komunikasi MQTT versi 5.0. Melalui pemanfaatan standar *Internet of Things* (IoT) ini, sistem mampu menjalankan koordinasi tersinkronisasi, pemantauan *real-time*, hingga penanganan kedaruratan tanpa memerlukan perangkat keras fisik yang terdedikasi. 

Sistem secara penuh memanfaatkan dan mendemonstrasikan keunggulan arsitektur *Publish-Subscribe* modern. Seluruh layanan (*services*) beroperasi secara asinkron dan saling terhubung secara eksklusif melalui perantara MQTT broker. Sebagai bentuk pemenuhan kriteria teknis, kode ini telah mengimplementasikan **13 dari 14 fitur MQTT lanjutan** untuk memastikan ketahanan jaringan, reliabilitas pengiriman informasi, efisiensi lalu lintas data, serta fleksibilitas *monitoring*.

---

## Rincian Implementasi Fitur MQTT

Tabel di bawah ini merangkum kapabilitas protokol MQTT yang difungsikan dalam sistem beserta urgensi arsitektural dan letak berkas (file) implementasinya.

<table border="1" style="width:100%; border-collapse: collapse; text-align: left; font-size: 14px;">
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
      <td style="padding: 10px;">Mengirimkan pesan melalui perantara broker. Pesan ini akan dialirkan kepada seluruh klien (*subscriber*) yang berlangganan pada rute topik yang sesuai.</td>
      <td style="padding: 10px;">Diimplementasikan melalui metode *wrapper* dasar <code>publish()</code> pada <code>common.py</code>. Digunakan oleh seluruh modul seperti <code>emergency.py</code>, <code>scheduler.py</code>, <code>screen_client.py</code>, dan peladen dasbor (WebSocket).</td>
    </tr>
    <tr>
      <td style="padding: 10px; text-align: center;">2</td>
      <td style="padding: 10px;"><b>Subscribe</b></td>
      <td style="padding: 10px;">Mendaftarkan ketertarikan untuk menerima pesan berdasarkan pola topik, mengarahkan rute broker untuk memanggil fungsi <i>callback</i> <code>on_message</code>.</td>
      <td style="padding: 10px;">Terdapat di fungsi dasar <code>common.py</code>. Diaplikasikan di berbagai layanan; contohnya layar (<code>screen_client.py</code>) yang berlangganan cuaca dan konten, serta pekerja analitik (<code>analytics_worker.py</code>).</td>
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
      <td style="padding: 10px;"><b>Tidak diimplementasikan</b>. Ekosistem proyek berjalan di dalam arsitektur simulasi berskala menengah. Pemangkasan kompresi *overhead* tidak krusial dan belum memberikan nilai keandalan yang terukur jelas di konteks ini.</td>
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