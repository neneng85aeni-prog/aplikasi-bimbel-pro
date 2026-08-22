import { useState, useEffect } from 'react';

export function LaporanGuruTab({ users, perkembanganTampil, siswaTampil }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Perbaikan: Menggunakan toLocaleDateString('en-CA') agar format YYYY-MM-DD 
  // mengikuti timezone lokal (WIB) dan tidak mundur ke UTC.
  useEffect(() => {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toLocaleDateString('en-CA');
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toLocaleDateString('en-CA');
    
    setStartDate(firstDay);
    setEndDate(lastDay);
  }, []);

  const laporanGuru = users
    .filter(u => u.akses?.toLowerCase() === 'guru')
    .map(guru => {
      // A. TOTAL TERDAFTAR (Sesuai kolom 'guru_id' di tabel siswa)
      const terdaftar = (siswaTampil || []).filter(s => s.guru_id === guru.id).length;

      // B. TOTAL SISWA UNIK (Sesuai kolom 'guru_id' di tabel perkembangan)
      const uniqueSiswaIds = (perkembanganTampil || [])
        .filter(p => {
          const matchGuru = p.guru_id === guru.id; 
          const matchDate = p.tanggal >= startDate && p.tanggal <= endDate;
          return matchGuru && matchDate;
        })
        .map(p => p.siswa_id);
      const totalSiswaUnik = [...new Set(uniqueSiswaIds)].length;

      // C. TOTAL SESI (Dihitung langsung dari jumlah baris perkembangan)
      const totalSesi = (perkembanganTampil || []).filter(p => {
        const matchGuru = p.guru_id === guru.id; 
        const matchDate = p.tanggal >= startDate && p.tanggal <= endDate;
        return matchGuru && matchDate;
      }).length;

      return {
        nama: guru.nama,
        terdaftar: terdaftar,
        siswaUnik: totalSiswaUnik,
        totalSesi: totalSesi,
        selisih: terdaftar - totalSiswaUnik
      }
    })
    .filter(g => g.nama.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>Laporan Performa & Sesi Guru</h2>
          <p className="text-muted" style={{ fontSize: '13px' }}>Periode: <b>{startDate}</b> s/d <b>{endDate}</b></p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
             <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ background: 'transparent', border: 'none', color: 'inherit', outline: 'none', fontSize: '13px' }} />
             <span style={{ fontSize: '12px', color: '#94a3b8' }}>-</span>
             <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ background: 'transparent', border: 'none', color: 'inherit', outline: 'none', fontSize: '13px' }} />
          </div>
          <input 
            type="text" 
            placeholder="🔍 Cari Guru..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.05)', color: 'white' }}
          />
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nama Guru</th>
              <th style={{ textAlign: 'center' }}>Siswa Terdaftar (Profil)</th>
              <th style={{ textAlign: 'center' }}>Siswa Aktif (Unik)</th>
              <th style={{ textAlign: 'center', background: 'rgba(59, 130, 246, 0.1)' }}>Total Sesi (Aktif)</th>
              <th style={{ textAlign: 'center' }}>Status Keaktifan</th>
            </tr>
          </thead>
          <tbody>
            {laporanGuru.map((g, i) => (
              <tr key={i}>
                <td><b>{g.nama}</b></td>
                <td style={{ textAlign: 'center' }}>{g.terdaftar} Anak</td>
                <td style={{ textAlign: 'center' }}>{g.siswaUnik} Anak</td>
                <td style={{ textAlign: 'center', fontSize: '18px', fontWeight: 'bold', color: '#60a5fa' }}>
                  {g.totalSesi} <span style={{fontSize: '12px'}}>Sesi</span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  {g.siswaUnik >= g.terdaftar && g.terdaftar > 0 ? (
                    <span style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>Full Output</span>
                  ) : (
                    <span style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>{g.selisih} Belum Terjamah</span>
                  )}
                </td>
              </tr>
            ))}
            {laporanGuru.length === 0 && (
              <tr><td colSpan="5" style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>Tidak ada data guru untuk periode ini.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
