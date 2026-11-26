# ⚡ NEXUS // Quantum Futuristic Web Chat

Aplikasi web chat real-time dengan tampilan **Elegan Futuristik (Cyberpunk HUD / Sci-Fi Glassmorphism)** dibangun menggunakan **Node.js, Express, Socket.IO, Multer, dan WebRTC Mesh**.

![Nexus Chat Architecture](https://img.shields.io/badge/Architecture-WebRTC%20Mesh%20%2B%20Socket.IO-00f0ff?style=for-the-badge)
![Node Version](https://img.shields.io/badge/Node.js-v20%2B-green?style=for-the-badge)

---

## 🚀 Fitur Utama

### 1. 📁 Upload & Pratinjau File, Gambar, dan Video
- **Gambar (Images)**: Pratinjau langsung di dalam bubble chat dengan efek zoom, dan mode **Fullscreen Lightbox** resolusi tinggi saat diklik.
- **Video**: Pemutar video terintegrasi di dalam bubble chat (MP4, WebM, OGG, dll).
- **Audio / Voice Notes**: Pemutar audio interaktif dengan visualisasi status.
- **Dokumen & File**: Kartu lampiran dengan ikon tipe file, indikator ukuran file (KB/MB), dan tombol unduh instan.
- **Drag & Drop**: Seret file langsung ke area obrolan untuk pengunggahan cepat.

### 2. 👥 Obrolan Bersama (Group Chat & Sektor Kustom)
- Obrolan grup real-time berkecepatan tinggi dengan latensi rendah melalui Socket.IO.
- **Sektor Bawaan**:
  - `# General Nexus` (Saluran komunikasi utama multi-sektor)
  - `# Cyber Lounge` (Ruang santai & diskusi informal)
  - `# Tech Core` (Arsitektur sistem & teknologi)
  - `# Command Center` (Koordinasi operasi strategis)
- **Buat Sektor Kustom**: Tombol `+` untuk membuat grup sektor obrolan baru secara dinamis.
- **Indikator Real-time**: Indikator pengetikan (*Agent is transmitting data...*), reaksi emoji (*🔥, 👍, ❤️, ⚡, 🚀*), dan daftar agen yang sedang aktif di setiap sektor.

### 3. 🎙️ Voice Call & 📹 Video Call (WebRTC Mesh)
- **Multi-Peer Group Calling**: Mendukung panggilan grup antar banyak pengguna dalam satu sektor secara simultan tanpa server media eksternal berat (WebRTC Peer-to-Peer Mesh).
- **Voice Call Mode**: Dilengkapi dengan **Realtime Audio Waveform Visualizer (Canvas)** dengan spektrum gelombang neon futuristik.
- **Video Call Mode**: Menampilkan matriks grid video peserta dengan sudut HUD holo-bracket cybernetic.
- **Kontrol Panggilan Lengkap**:
  - Matikan / Nyalakan Mikrofon (Mute/Unmute)
  - Matikan / Nyalakan Kamera (Camera Toggle)
  - **Berbagi Layar (Screen Sharing)**: Presentasikan dokumen, jendela, atau layar penuh kepada seluruh anggota panggilan.
  - Akhiri panggilan dengan feedback suara.

### 4. 🔮 Tampilan Elegan Futuristik
- **Cyberpunk HUD & Glassmorphism**: Latar belakang nebula obsidian gelap, aksen neon cyan (`#00f0ff`), electric purple (`#9d4edd`), dan emerald (`#00ff88`).
- **Sci-Fi Audio Synthesizer**: Suara transmisi futuristik dihasilkan langsung di browser melalui **Web Audio API** (tanpa ketergantungan file audio eksternal yang berat atau rusak):
  - Suara kirim pesan
  - Suara pesan masuk
  - Suara agen bergabung
  - Radar ringtone panggilan
  - Suara koneksi terhubung & pemutusan panggilan
  - Tombol toggle untuk membisukan audio kapan saja
- **Kustomisasi Profil Agen**: Ganti Call Sign (nama agen) dan pilih dari beragam avatar cybernetic.

---

## 📂 Struktur Proyek

```
HelloWord/
├── package.json          # Konfigurasi dependensi (express, socket.io, multer, cors)
├── server.js             # Server backend Node.js (Express, Multer, Socket.IO & WebRTC signaling)
├── public/               # File frontend client-side
│   ├── index.html        # Struktur HTML5 antarmuka Cyberpunk HUD
│   ├── css/
│   │   └── style.css     # Styling glassmorphism, animasi neon, & tata letak responsif
│   ├── js/
│   │   ├── app.js        # Logika aplikasi chat, event listener, upload file & sektor
│   │   ├── webrtc.js     # Engine Voice & Video Call, screen sharing, & audio visualizer
│   │   └── audio-fx.js   # Synthesizer audio Web Audio API (efek suara futuristik)
│   └── uploads/          # Direktori penyimpanan media (gambar, video, file)
└── README.md             # Dokumentasi lengkap
```

---

## 🛠️ Cara Menjalankan Aplikasi

1. **Pastikan Node.js terinstal** (versi 18 ke atas disarankan).
2. Di dalam direktori proyek ini, jalankan:
   ```bash
   npm start
   ```
   *atau:*
   ```bash
   node server.js
   ```
3. Buka browser Anda dan kunjungi:
   ```
   http://localhost:3000
   ```

4. **Untuk Menguji Fitur Obrolan & Panggilan Multi-User**:
   - Buka dua tab atau dua jendela browser yang berbeda (misalnya satu di jendela normal, satu di Incognito / Browser lain).
   - Di tab 1, masuk dengan nama misalnya `Agent_Alpha`.
   - Di tab 2, masuk dengan nama misalnya `Agent_Bravo`.
   - Coba kirim pesan teks, upload gambar/video/file.
   - Klik tombol **Voice Call** atau **Video Call** di tab 1, lalu terima izin kamera/mikrofon. Tab 2 akan dapat bergabung dan terhubung secara instan!

---

## 🔒 Solusi Akses Kamera/Mikrofon di IP Publik (`getUserMedia`)

Jika Anda mengakses server menggunakan IP Publik (misalnya `http://103.52.212.131:3000`) dan muncul pesan:
> `Cannot read properties of undefined (reading 'getUserMedia')`

Hal ini terjadi karena kebijakan keamanan browser modern (**Secure Contexts**) yang **secara otomatis menonaktifkan kamera dan mikrofon pada koneksi HTTP tanpa SSL**.

### ✅ Solusi 1: Aktifkan Bendera Chrome/Edge (Paling Cepat & Mudah)
1. Buka tab baru di Chrome / Edge dan kunjungi:
   ```
   chrome://flags/#unsafely-treat-insecure-origin-as-secure
   ```
2. Pada kolom input yang muncul, masukkan URL server Anda:
   ```
   http://103.52.212.131:3000
   ```
3. Ubah dropdown menjadi **Enabled**.
4. Klik tombol **Relaunch** di bagian bawah browser. Selesai! Kamera dan mikrofon langsung aktif.

---

### ✅ Solusi 2: Jalankan dengan Mode HTTPS (Sudah Didukung Bawaan)
1. Buat sertifikat SSL mandiri (cukup sekali):
   ```bash
   npm run ssl
   ```
2. Jalankan server:
   ```bash
   npm start
   ```
3. Buka browser melalui alamat HTTPS:
   ```
   https://103.52.212.131:3000
   ```
4. Saat muncul peringatan *"Your connection is not private"* (karena menggunakan self-signed cert), klik **Advanced / Tingkat Lanjut** lalu pilih **Proceed to 103.52.212.131 (unsafe)**. WebRTC akan langsung berfungsi!
