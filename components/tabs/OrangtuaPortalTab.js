import { useMemo, useState } from 'react'
import { formatRupiah } from '../../lib/format'

const clean = (v) => String(v ?? '').trim()
const low = (v) => clean(v).toLowerCase()
const sameId = (a, b) => clean(a) && clean(b) && clean(a) === clean(b)

console.log("Data Cabang yang masuk ke aplikasi:", branches);
console.log("Siswa yang sedang dicek:", selectedSiswa);

function tanggal(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
}

function addMonth(value) {
  const d = value ? new Date(value) : new Date()
  if (Number.isNaN(d.getTime())) return null
  d.setMonth(d.getMonth() + 1)
  return d
}

function num(v) {
  const n = Number(v || 0)
  return Number.isFinite(n) ? n : 0
}

function dateOf(row) {
  return row?.tanggal || row?.tanggal_bayar || row?.created_at || row?.date || ''
}

function namaSiswa(row) {
  return row?.nama || row?.nama_siswa || row?.name || '-'
}

function namaProgram(row) {
  return row?.programs?.nama || row?.program_nama || row?.nama_program || row?.program || '-'
}

function deskripsiProgram(row) {
  return row?.programs?.deskripsi || row?.program_deskripsi || row?.deskripsi_program || ''
}

function namaCabang(row) {
  return row?.branches?.nama || row?.branch_nama || row?.nama_cabang || row?.cabang || '-'
}

function namaGuru(row) {
  return row?.users?.nama || row?.guru_default_nama || row?.guru_nama || row?.nama_guru || '-'
}

function nominalProgram(row) {
  return num(row?.programs?.nominal ?? row?.program_nominal ?? row?.nominal_program ?? row?.nominal ?? row?.harga ?? row?.biaya ?? 0)
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
  if (digits.startsWith('8')) digits = `62${digits}`
  return digits
}

function copyText(text, label = 'Data') {
  if (!text) return
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(String(text)).then(() => alert(`${label} berhasil disalin.`)).catch(() => alert(String(text)))
  } else {
    alert(String(text))
  }
}

function openWhatsApp(number, text) {
  const phone = normalizePhone(number)
  const encoded = encodeURIComponent(text)
  if (phone) {
    window.open(`https://wa.me/${phone}?text=${encoded}`, '_blank')
  } else {
    alert('Nomor WhatsApp admin pembayaran belum diatur di data cabang.')
  }
}

function InfoRow({ label, value, copyable = false }) {
  return (
    <div className="parent-info-row">
      <span className="text-muted">{label}</span>
      <b>
        {value || '-'}
        {copyable && value ? (
          <button type="button" className="parent-copy-btn" onClick={() => copyText(value, label)}>
            Salin
          </button>
        ) : null}
      </b>
    </div>
  )
}

function SummaryCard({ icon, label, value, note }) {
  return (
    <div className="parent-summary-card">
      <div className="parent-summary-icon">{icon}</div>
      <div>
        <div className="eyebrow">{label}</div>
        <h2 className="section-title" style={{ margin: '4px 0' }}>{value || '-'}</h2>
        {note ? <p className="text-muted" style={{ margin: 0 }}>{note}</p> : null}
      </div>
    </div>
  )
}

function AccordionSection({ id, icon, title, subtitle, openSections, toggleSection, children }) {
  const isOpen = openSections.includes(id)

  return (
    <section className="parent-accordion glass-card">
      <button type="button" className="parent-accordion-head" onClick={() => toggleSection(id)}>
        <span className="parent-accordion-icon">{icon}</span>
        <span className="parent-accordion-title-wrap">
          <b>{title}</b>
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
        <span className="parent-accordion-chevron">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen ? <div className="parent-accordion-body">{children}</div> : null}
    </section>
  )
}

function hitungPembayaran(siswa, pembayaran, perkembangan, absensiSiswa) {
  const bayar = pembayaran
    .filter((x) => sameId(x.siswa_id || x.id_siswa || x.student_id, siswa.id))
    .sort((a, b) => String(dateOf(b)).localeCompare(String(dateOf(a))))

  const terakhir = bayar[0] || null
  const namaPaket = `${namaProgram(siswa)} ${deskripsiProgram(siswa)}`
  const paketSesi = namaPaket.match(/(\d+)\s*x/i)
  const hadirPerkembangan = perkembangan.filter((x) => sameId(x.siswa_id || x.id_siswa || x.student_id, siswa.id)).length
  const hadirAbsensi = absensiSiswa.filter((x) => sameId(x.siswa_id || x.id_siswa || x.student_id, siswa.id) && !['alpha', 'tidak_hadir'].includes(low(x.status))).length
  const hadirAplikasi = Math.max(hadirPerkembangan, hadirAbsensi)
  const sesiAwal = num(siswa.sesi_awal)
  const totalHadir = sesiAwal + hadirAplikasi
  const nominal = nominalProgram(siswa)

  if (paketSesi) {
    const sesiPerPaket = Number(paketSesi[1]) || 0
    const paketTerbeli = bayar.filter((x) => !siswa.program_id || !x.program_id || x.program_id === siswa.program_id).length
    const kuotaLama = sesiAwal && sesiPerPaket ? Math.ceil(sesiAwal / sesiPerPaket) * sesiPerPaket : 0
    const totalKuota = kuotaLama + paketTerbeli * sesiPerPaket
    const sisa = Math.max(totalKuota - totalHadir, 0)
    return {
      mode: 'sesi',
      label: sisa <= 0 ? 'Kuota habis / perlu bayar' : `Sisa ${sisa} sesi`,
      detail: `Sudah hadir ${totalHadir} sesi dari estimasi kuota ${totalKuota || 0} sesi.`,
      terakhir,
      sisa,
      totalHadir,
      jatuhTempo: sisa <= 0 ? new Date() : null,
      nominal,
      perluBayar: sisa <= 0,
      kuota: totalKuota,
      sesiPerPaket
    }
  }

  const bulanan = low(namaPaket).includes('bulanan')
  if (bulanan) {
    const jatuhTempo = addMonth(dateOf(terakhir) || siswa.created_at)
    return {
      mode: 'bulanan',
      label: jatuhTempo ? `Jatuh tempo sekitar ${tanggal(jatuhTempo)}` : 'Jatuh tempo belum dapat dihitung',
      detail: terakhir ? `Pembayaran terakhir ${tanggal(dateOf(terakhir))}.` : 'Belum ada pembayaran tercatat.',
      terakhir,
      sisa: null,
      totalHadir,
      jatuhTempo,
      nominal,
      perluBayar: !terakhir || (jatuhTempo && jatuhTempo <= new Date())
    }
  }

  return {
    mode: 'umum',
    label: terakhir ? 'Pembayaran terakhir tercatat' : 'Belum ada riwayat pembayaran',
    detail: terakhir ? `Pembayaran terakhir ${tanggal(dateOf(terakhir))}.` : 'Silakan hubungi admin untuk info tagihan.',
    terakhir,
    sisa: null,
    totalHadir,
    jatuhTempo: null,
    nominal,
    perluBayar: !terakhir
  }
}

function getBranchPaymentSettings(selectedSiswa, branches) {
  const branchFromList = (Array.isArray(branches) ? branches : []).find((b) => sameId(b.id, selectedSiswa?.branch_id))
  const branch = branchFromList || selectedSiswa?.branches || selectedSiswa?.branch || {}

  return {
    qrisImageUrl: branch.qris_image_url || branch.payment_qris_url || branch.qris_url || selectedSiswa?.qris_image_url || '',
    qrisName: branch.qris_merchant_name || branch.nama || selectedSiswa?.qris_merchant_name || 'Bimbel',
    bankName: branch.bank_name || branch.nama_bank || selectedSiswa?.bank_name || '',
    bankAccountNumber: branch.bank_account_number || branch.no_rekening || selectedSiswa?.bank_account_number || '',
    bankAccountName: branch.bank_account_name || branch.atas_nama || selectedSiswa?.bank_account_name || '',
    paymentWhatsapp: branch.payment_whatsapp || branch.no_wa_admin || branch.no_telepon || selectedSiswa?.payment_whatsapp || '',
    paymentNote: branch.payment_note || branch.catatan_pembayaran || ''
  }
}

function PaymentBox({ selectedSiswa, payment, branches }) {
  const [paymentMethod, setPaymentMethod] = useState('qris')
  const settings = getBranchPaymentSettings(selectedSiswa, branches)
  const nominal = payment?.nominal || nominalProgram(selectedSiswa)
  const waText = [
    `Assalamu'alaikum Admin, saya orang tua dari ${namaSiswa(selectedSiswa)}.`,
    `Saya ingin konfirmasi pembayaran program ${namaProgram(selectedSiswa)}.`,
    nominal ? `Nominal: ${formatRupiah(nominal)}.` : '',
    `Metode: ${paymentMethod === 'qris' ? 'QRIS' : 'Transfer Bank'}.`,
    selectedSiswa?.kode_qr ? `Kode siswa: ${selectedSiswa.kode_qr}.` : '',
    '',
    'Saya akan kirim bukti pembayaran setelah ini.'
  ].filter(Boolean).join('\n')

  return (
    <div className="parent-payment-box">
      <div className="parent-payment-alert">
        <b>{payment?.label || 'Informasi pembayaran'}</b>
        <p>{payment?.detail || 'Silakan pilih metode pembayaran.'}</p>
      </div>

      <div className="parent-payment-total">
        <span>Nominal pembayaran</span>
        <strong>{nominal ? formatRupiah(nominal) : 'Hubungi admin'}</strong>
        {nominal ? <button type="button" onClick={() => copyText(nominal, 'Nominal')}>Salin nominal</button> : null}
      </div>

      <div className="parent-payment-tabs">
        <button type="button" className={paymentMethod === 'qris' ? 'active' : ''} onClick={() => setPaymentMethod('qris')}>QRIS</button>
        <button type="button" className={paymentMethod === 'transfer' ? 'active' : ''} onClick={() => setPaymentMethod('transfer')}>Transfer</button>
      </div>

      {paymentMethod === 'qris' ? (
        <div className="parent-qris-panel">
          {settings.qrisImageUrl ? (
            <>
              <img src={settings.qrisImageUrl} alt={`QRIS ${settings.qrisName}`} />
              <p className="text-muted">Scan QRIS di atas, lalu konfirmasi pembayaran ke admin.</p>
            </>
          ) : (
            <div className="parent-empty-payment">
              <b>QRIS belum diatur</b>
              <p>Admin perlu mengisi URL gambar QRIS di data cabang.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="parent-transfer-panel">
          <InfoRow label="Bank" value={settings.bankName || 'Belum diatur'} />
          <InfoRow label="Nomor Rekening" value={settings.bankAccountNumber || 'Belum diatur'} copyable={Boolean(settings.bankAccountNumber)} />
          <InfoRow label="Atas Nama" value={settings.bankAccountName || 'Belum diatur'} />
          <p className="text-muted" style={{ marginTop: 10 }}>Setelah transfer, kirim bukti pembayaran ke admin.</p>
        </div>
      )}

      {settings.paymentNote ? (
        <div className="parent-payment-note">{settings.paymentNote}</div>
      ) : null}

      <div className="parent-payment-actions">
        <button type="button" className="btn btn-primary" onClick={() => openWhatsApp(settings.paymentWhatsapp, waText)}>
          Konfirmasi via WhatsApp
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => copyText(waText, 'Pesan konfirmasi')}>
          Salin pesan
        </button>
      </div>
    </div>
  )
}

export function OrangtuaPortalTab({ user, siswa = [], perkembangan = [], absensiSiswa = [], pembayaran = [], branches = [] }) {
  const [query, setQuery] = useState('')
  const [selectedSiswaId, setSelectedSiswaId] = useState('')
  const [openSections, setOpenSections] = useState(['ringkasan', 'bayar'])

  const toggleSection = (id) => {
    setOpenSections((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id])
  }

  const isParent = ['orangtua', 'ortu', 'parent', 'wali'].includes(low(user?.akses)) || user?.login_method === 'barcode_siswa'
  const parentSiswaId = clean(user?.parent_siswa_id || user?.siswa_id || user?.student_id)

  const siswaOptions = useMemo(() => {
    const rows = Array.isArray(siswa) ? siswa : []
    const baseRows = isParent && parentSiswaId
      ? rows.filter((x) => sameId(x.id || x.siswa_id || x.student_id, parentSiswaId))
      : rows

    if (isParent && parentSiswaId) return baseRows

    const q = low(query)
    if (!q) return baseRows

    return baseRows.filter((x) => [x.nama, x.nama_ortu, x.no_hp, x.kode_qr, x.barcode, x.kelas, namaProgram(x), namaCabang(x)].map(low).join(' ').includes(q))
  }, [siswa, query, isParent, parentSiswaId])

  const selectedSiswa = useMemo(() => {
    if (isParent && parentSiswaId) return siswaOptions[0] || null
    if (selectedSiswaId) return siswaOptions.find((x) => sameId(x.id, selectedSiswaId)) || null
    return siswaOptions.length === 1 ? siswaOptions[0] : null
  }, [siswaOptions, selectedSiswaId, isParent, parentSiswaId])

  const perkembanganSiswa = useMemo(() => selectedSiswa ? perkembangan
    .filter((x) => sameId(x.siswa_id || x.id_siswa || x.student_id, selectedSiswa.id))
    .sort((a, b) => String(dateOf(b)).localeCompare(String(dateOf(a)))) : [], [perkembangan, selectedSiswa])

  const absensiSiswaTerpilih = useMemo(() => selectedSiswa ? absensiSiswa
    .filter((x) => sameId(x.siswa_id || x.id_siswa || x.student_id, selectedSiswa.id))
    .sort((a, b) => String(dateOf(b)).localeCompare(String(dateOf(a)))) : [], [absensiSiswa, selectedSiswa])

  const pembayaranSiswa = useMemo(() => selectedSiswa ? pembayaran
    .filter((x) => sameId(x.siswa_id || x.id_siswa || x.student_id, selectedSiswa.id))
    .sort((a, b) => String(dateOf(b)).localeCompare(String(dateOf(a)))) : [], [pembayaran, selectedSiswa])

  const payment = selectedSiswa ? hitungPembayaran(selectedSiswa, pembayaran, perkembangan, absensiSiswa) : null
  const hadirTerakhir = absensiSiswaTerpilih[0] || perkembanganSiswa[0]
  const catatanTerbaru = perkembanganSiswa[0]
  const jadwal = selectedSiswa ? `${selectedSiswa.hari || '-'}${selectedSiswa.jam_mulai ? `, ${selectedSiswa.jam_mulai}` : ''}` : '-'

  return (
    <div className="parent-portal-page">
      <style>{`
        .parent-portal-page {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .parent-hero {
          background: linear-gradient(135deg, rgba(37,99,235,.18), rgba(16,185,129,.12));
          border: 1px solid rgba(96,165,250,.20);
        }

        .parent-summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 12px;
          margin-top: 14px;
        }

        .parent-summary-card {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          padding: 16px;
          border-radius: 18px;
          background: rgba(15,23,42,.38);
          border: 1px solid rgba(148,163,184,.18);
        }

        .parent-summary-icon {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          background: rgba(59,130,246,.14);
          border: 1px solid rgba(96,165,250,.24);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          flex: 0 0 auto;
        }

        .parent-accordion {
          padding: 0 !important;
          overflow: hidden;
        }

        .parent-accordion-head {
          width: 100%;
          border: 0;
          background: transparent;
          color: inherit;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          text-align: left;
        }

        .parent-accordion-icon {
          width: 42px;
          height: 42px;
          border-radius: 16px;
          background: rgba(59,130,246,.14);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          flex: 0 0 auto;
        }

        .parent-accordion-title-wrap {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .parent-accordion-title-wrap b {
          font-size: 16px;
        }

        .parent-accordion-title-wrap small {
          color: #94a3b8;
          font-size: 12px;
          line-height: 1.35;
        }

        .parent-accordion-chevron {
          color: #94a3b8;
          font-size: 12px;
        }

        .parent-accordion-body {
          padding: 0 16px 16px;
        }

        .parent-info-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          border-bottom: 1px solid rgba(148,163,184,.18);
          padding: 9px 0;
        }

        .parent-info-row b {
          text-align: right;
        }

        .parent-copy-btn {
          margin-left: 8px;
          border: 1px solid rgba(148,163,184,.25);
          background: rgba(255,255,255,.06);
          color: inherit;
          border-radius: 8px;
          padding: 3px 7px;
          font-size: 11px;
          cursor: pointer;
        }

        .parent-table-wrap {
          width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        .parent-latest-box {
          margin: 12px 0;
          padding: 14px;
          border-radius: 14px;
          background: rgba(16,185,129,.10);
          border: 1px solid rgba(16,185,129,.22);
        }

        .parent-payment-box {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .parent-payment-alert {
          padding: 12px;
          border-radius: 14px;
          background: rgba(59,130,246,.10);
          border: 1px solid rgba(59,130,246,.25);
        }

        .parent-payment-alert p {
          margin: 6px 0 0;
          color: #94a3b8;
        }

        .parent-payment-total {
          padding: 14px;
          border-radius: 16px;
          background: rgba(16,185,129,.10);
          border: 1px solid rgba(16,185,129,.22);
          display: flex;
          gap: 10px;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
        }

        .parent-payment-total strong {
          font-size: 22px;
        }

        .parent-payment-total button {
          border: 1px solid rgba(148,163,184,.25);
          background: rgba(255,255,255,.06);
          color: inherit;
          border-radius: 10px;
          padding: 6px 10px;
          cursor: pointer;
        }

        .parent-payment-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          padding: 6px;
          border-radius: 16px;
          background: rgba(15,23,42,.34);
          border: 1px solid rgba(148,163,184,.18);
        }

        .parent-payment-tabs button {
          border: 0;
          border-radius: 12px;
          padding: 10px;
          cursor: pointer;
          color: #94a3b8;
          background: transparent;
          font-weight: 800;
        }

        .parent-payment-tabs button.active {
          color: white;
          background: linear-gradient(135deg, #2563eb, #10b981);
        }

        .parent-qris-panel,
        .parent-transfer-panel,
        .parent-empty-payment {
          padding: 14px;
          border-radius: 16px;
          background: rgba(255,255,255,.055);
          border: 1px solid rgba(148,163,184,.16);
        }

        .parent-qris-panel {
          text-align: center;
        }

        .parent-qris-panel img {
          width: min(100%, 280px);
          border-radius: 18px;
          background: white;
          padding: 10px;
          margin: 0 auto 10px;
          display: block;
        }

        .parent-payment-note {
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(234,179,8,.10);
          border: 1px solid rgba(234,179,8,.22);
          color: #fde68a;
        }

        .parent-payment-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        @media (max-width: 768px) {
          .parent-portal-page {
            gap: 10px;
          }

          .parent-hero {
            padding: 16px !important;
          }

          .parent-hero .hero-title {
            font-size: 22px !important;
            line-height: 1.2;
          }

          .parent-summary-grid {
            grid-template-columns: 1fr;
          }

          .parent-summary-card {
            padding: 14px;
          }

          .parent-accordion-head {
            padding: 14px;
          }

          .parent-accordion-body {
            padding: 0 14px 14px;
          }

          .parent-info-row {
            flex-direction: column;
            gap: 3px;
          }

          .parent-info-row b {
            text-align: left;
          }

          .parent-payment-total {
            align-items: flex-start;
            flex-direction: column;
          }

          .parent-payment-total strong {
            font-size: 20px;
          }

          .parent-payment-actions .btn {
            width: 100%;
          }

          table {
            min-width: 620px;
          }
        }
      `}</style>

      <div className="glass-card parent-hero">
        <div className="eyebrow">Portal Orang Tua</div>
        <h1 className="hero-title" style={{ marginBottom: 8 }}>Informasi Siswa</h1>
        <p className="text-muted" style={{ maxWidth: 780 }}>
          Orang tua bisa melihat jadwal masuk, hadir kapan saja, perkembangan belajar, informasi pembayaran, serta melakukan pembayaran via QRIS atau transfer.
        </p>

        {!isParent && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end', marginTop: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="text-muted">Cari nama siswa / kode QR / nomor HP</span>
              <input value={query} onChange={(e) => { setQuery(e.target.value); setSelectedSiswaId('') }} placeholder="Contoh: Aisyah / 628xxx / QR001" />
            </label>
            <button className="btn btn-secondary" type="button" onClick={() => { setQuery(''); setSelectedSiswaId('') }}>Reset</button>
          </div>
        )}

        {!isParent && siswaOptions.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <select value={selectedSiswaId} onChange={(e) => setSelectedSiswaId(e.target.value)}>
              <option value="">Pilih siswa</option>
              {siswaOptions.map((x) => <option key={x.id} value={x.id}>{namaSiswa(x)} • {namaProgram(x)} • {namaCabang(x)}</option>)}
            </select>
          </div>
        )}

        {siswaOptions.length === 0 && (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)' }}>
            Data siswa tidak ditemukan. Pastikan barcode yang discan adalah barcode siswa yang benar.
          </div>
        )}
      </div>

      {selectedSiswa && (
        <>
          <div className="parent-summary-grid">
            <SummaryCard icon="🎓" label="Nama Siswa" value={namaSiswa(selectedSiswa)} note={`${namaProgram(selectedSiswa)} • ${namaCabang(selectedSiswa)}`} />
            <SummaryCard icon="📅" label="Jadwal Masuk" value={jadwal} note={`Guru: ${namaGuru(selectedSiswa)}`} />
            <SummaryCard icon="✅" label="Hadir Terakhir" value={hadirTerakhir ? tanggal(dateOf(hadirTerakhir)) : '-'} note={hadirTerakhir ? (hadirTerakhir.status || 'hadir') : 'Belum ada data hadir'} />
            <SummaryCard icon="💳" label="Pembayaran" value={payment?.label || '-'} note={payment?.detail || '-'} />
          </div>

          <AccordionSection id="ringkasan" icon="📌" title="Ringkasan Siswa" subtitle="Profil, program, cabang, dan kode barcode" openSections={openSections} toggleSection={toggleSection}>
            <InfoRow label="Nama Siswa" value={namaSiswa(selectedSiswa)} />
            <InfoRow label="Program" value={namaProgram(selectedSiswa)} />
            <InfoRow label="Kelas" value={selectedSiswa.kelas || '-'} />
            <InfoRow label="Cabang" value={namaCabang(selectedSiswa)} />
            <InfoRow label="Guru" value={namaGuru(selectedSiswa)} />
            <InfoRow label="Kode QR" value={selectedSiswa.kode_qr || selectedSiswa.barcode || selectedSiswa.id || '-'} copyable />
          </AccordionSection>

          <AccordionSection id="jadwal" icon="📅" title="Jadwal Belajar" subtitle="Hari masuk, jam masuk, dan total sesi" openSections={openSections} toggleSection={toggleSection}>
            <InfoRow label="Hari" value={selectedSiswa.hari || '-'} />
            <InfoRow label="Jam Mulai" value={selectedSiswa.jam_mulai || '-'} />
            <InfoRow label="Sesi Awal" value={selectedSiswa.sesi_awal || '0'} />
            <InfoRow label="Total Hadir" value={payment?.totalHadir ?? '0'} />
            {payment?.mode === 'sesi' ? (
              <>
                <InfoRow label="Kuota Program" value={payment.kuota || '0'} />
                <InfoRow label="Sisa Sesi" value={payment.sisa ?? '0'} />
              </>
            ) : null}
          </AccordionSection>

          <AccordionSection id="bayar" icon="💳" title="Bayar Sekarang" subtitle="Pembayaran via QRIS atau transfer bank" openSections={openSections} toggleSection={toggleSection}>
            <PaymentBox selectedSiswa={selectedSiswa} payment={payment} branches={branches} />
          </AccordionSection>

          <AccordionSection id="perkembangan" icon="📝" title="Perkembangan Siswa" subtitle={`${perkembanganSiswa.length} catatan perkembangan`} openSections={openSections} toggleSection={toggleSection}>
            {catatanTerbaru && (
              <div className="parent-latest-box">
                <b>Catatan terbaru • {tanggal(dateOf(catatanTerbaru))}</b>
                <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{catatanTerbaru.catatan || '-'}</p>
              </div>
            )}

            <div className="parent-table-wrap">
              <table>
                <thead><tr><th>Tanggal</th><th>Guru</th><th>Catatan</th></tr></thead>
                <tbody>
                  {perkembanganSiswa.slice(0, 20).map((x) => (
                    <tr key={x.id}>
                      <td>{tanggal(dateOf(x))}</td>
                      <td>{x.users?.nama || x.guru_nama || '-'}</td>
                      <td style={{ whiteSpace: 'normal', minWidth: 260 }}>{x.catatan || '-'}</td>
                    </tr>
                  ))}
                  {perkembanganSiswa.length === 0 && <tr><td colSpan="3" className="text-muted">Belum ada catatan perkembangan.</td></tr>}
                </tbody>
              </table>
            </div>
          </AccordionSection>

          <AccordionSection id="kehadiran" icon="✅" title="Kehadiran" subtitle="Riwayat hadir siswa" openSections={openSections} toggleSection={toggleSection}>
            <div className="parent-table-wrap">
              <table>
                <thead><tr><th>Tanggal</th><th>Mode</th><th>Status</th><th>Catatan</th></tr></thead>
                <tbody>
                  {absensiSiswaTerpilih.slice(0, 20).map((x) => (
                    <tr key={x.id}>
                      <td>{tanggal(dateOf(x))}</td>
                      <td>{x.mode || '-'}</td>
                      <td>{x.status || 'hadir'}</td>
                      <td>{x.catatan || '-'}</td>
                    </tr>
                  ))}
                  {absensiSiswaTerpilih.length === 0 && perkembanganSiswa.slice(0, 10).map((x) => (
                    <tr key={`perkembangan-${x.id}`}>
                      <td>{tanggal(dateOf(x))}</td>
                      <td>Laporan belajar</td>
                      <td>hadir</td>
                      <td>Ada catatan perkembangan</td>
                    </tr>
                  ))}
                  {absensiSiswaTerpilih.length === 0 && perkembanganSiswa.length === 0 && <tr><td colSpan="4" className="text-muted">Belum ada data kehadiran.</td></tr>}
                </tbody>
              </table>
            </div>
          </AccordionSection>

          <AccordionSection id="riwayat-bayar" icon="🧾" title="Riwayat Pembayaran" subtitle={`${pembayaranSiswa.length} transaksi tercatat`} openSections={openSections} toggleSection={toggleSection}>
            <div className="parent-table-wrap">
              <table>
                <thead><tr><th>Tanggal</th><th>Keterangan</th><th>Nominal</th><th>Status</th></tr></thead>
                <tbody>
                  {pembayaranSiswa.slice(0, 20).map((x) => (
                    <tr key={x.id}>
                      <td>{tanggal(dateOf(x))}</td>
                      <td>{x.keterangan || x.programs?.nama || x.program_nama || '-'}</td>
                      <td>{formatRupiah(x.nominal || x.total || 0)}</td>
                      <td>{x.status || 'lunas'}</td>
                    </tr>
                  ))}
                  {pembayaranSiswa.length === 0 && <tr><td colSpan="4" className="text-muted">Belum ada riwayat pembayaran.</td></tr>}
                </tbody>
              </table>
            </div>
          </AccordionSection>
        </>
      )}
    </div>
  )
}
