const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

async function generate() {
  const sslDir = path.join(__dirname, 'ssl');
  if (!fs.existsSync(sslDir)) {
    fs.mkdirSync(sslDir, { recursive: true });
  }

  console.log('⚡ Generating self-signed SSL certificate for Secure Context (WebRTC)...');

  const attrs = [
    { name: 'commonName', value: '103.52.212.131' },
    { name: 'countryName', value: 'ID' },
    { shortName: 'ST', value: 'Jakarta' },
    { name: 'localityName', value: 'Jakarta' },
    { name: 'organizationName', value: 'Nexus Cyber Chat' }
  ];

  const pems = await selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256'
  });

  const certPath = path.join(sslDir, 'cert.pem');
  const keyPath = path.join(sslDir, 'key.pem');

  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(keyPath, pems.private);

  console.log('✅ Sertifikat SSL berhasil dibuat:');
  console.log('   - Cert: ' + certPath);
  console.log('   - Key:  ' + keyPath);
  console.log('🚀 Sekarang server dapat dijalankan dalam mode HTTPS!');
}

generate().catch(err => {
  console.error('Error generating SSL cert:', err);
  process.exit(1);
});
