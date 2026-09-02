import { supabase } from './supabase'

// Tambahkan rumus ini untuk menyulap teks kosong ("") menjadi null
export const toNull = (val) => (val === '' || val === undefined || val === null) ? null : val;

export async function fetchAllData() {
  // === 1. DATA MASTER (Diunduh 100% tanpa batas) ===
  const masterPromises = [
    supabase.from('branches').select('*').order('created_at', { ascending: true }),
    supabase.from('programs').select('*').order('created_at', { ascending: false }),
    supabase.from('users_safe').select('*').order('created_at', { ascending: false }),
    supabase.from('siswa').select('*').order('created_at', { ascending: false }) 
  ];

  // === 2. DATA TRANSAKSI (Batas 30 Hari Terakhir - HEMAT EGRESS) ===
  const cutoff30Days = new Date();
  cutoff30Days.setDate(cutoff30Days.getDate() - 30);
  const cutoff30Str = cutoff30Days.toISOString();

  const transactionPromises = [
    supabase.from('pembayaran').select('*').gte('created_at', cutoff30Str).order('created_at', { ascending: false }),
    supabase.from('employee_bonus_safe').select('*').gte('bonus_date', cutoff30Str).order('bonus_date', { ascending: false }),
    supabase.from('pengeluaran').select('*').gte('tanggal', cutoff30Str.slice(0, 10)).order('tanggal', { ascending: false }),
    supabase.from('inventory').select('*').order('nama', { ascending: true }),
    supabase.from('employee_reviews').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('employee_review_items').select('*').order('created_at', { ascending: true })
  ];

  // === 3. DATA HARIAN SANGAT BERAT (Batas 7 Hari Terakhir - HEMAT EGRESS) ===
  const cutoff7Days = new Date();
  cutoff7Days.setDate(cutoff7Days.getDate() - 7);
  const cutoff7Str = cutoff7Days.toISOString();

  const heavyPromises = [
    supabase.from('perkembangan').select('id, siswa_id, guru_id, tanggal, branch_id, created_at').gte('created_at', cutoff7Str).order('created_at', { ascending: false }),
    supabase.from('absensi_siswa').select('*').gte('created_at', cutoff7Str).order('created_at', { ascending: false }),
    supabase.from('absensi_karyawan').select('*').gte('created_at', cutoff7Str).order('created_at', { ascending: false })
  ];

  // Eksekusi semua secara paralel
  const results = await Promise.all([...masterPromises, ...transactionPromises, ...heavyPromises]);
  const firstError = results.find(r => r.error);
  if (firstError) throw firstError.error;

  const [
    branchesRes, programsRes, usersRes, siswaRes, 
    pembayaranRes, bonusRes, pengeluaranRes, inventoryRes, reviewRes, reviewItemsRes,
    perkembanganRes, absensiSiswaRes, absensiKaryawanRes
  ] = results;

  const branches = branchesRes.data || []
  const programs = programsRes.data || []
  const users = usersRes.data || []

  // Pemetaan ID ke objek utuh (Kamus)
  const branchMap = new Map(branches.map((item) => [item.id, item]))
  const programMap = new Map(programs.map((item) => [item.id, item]))
  const userMap = new Map(users.map((item) => [item.id, item]))

  const siswa = (siswaRes.data || []).map((item) => {
    const branch = branchMap.get(item.branch_id) || null
    const program = programMap.get(item.program_id) || null
    const guru = userMap.get(item.guru_id) || null
    return { ...item, branches: branch, programs: program, users: guru, branch_nama: branch?.nama || '-', guru_default_nama: guru?.nama || '-' }
  })
  const siswaMap = new Map(siswa.map((item) => [item.id, item]))

  const pembayaran = (pembayaranRes.data || []).map((item) => ({
    ...item,
    siswa: siswaMap.get(item.siswa_id) || null,
    programs: programMap.get(item.program_id) || null,
    users: userMap.get(item.kasir_id) || null,
    branch_id: (siswaMap.get(item.siswa_id) || {}).branch_id || (userMap.get(item.kasir_id) || {}).branch_id || null,
  }))

  const perkembangan = (perkembanganRes.data || []).map((item) => ({
    ...item,
    siswa: siswaMap.get(item.siswa_id) || null,
    users: userMap.get(item.guru_id) || null,
    branch_id: (siswaMap.get(item.siswa_id) || {}).branch_id || null,
  }))

  const absensiSiswa = (absensiSiswaRes.data || []).map((item) => ({
    ...item,
    siswa: siswaMap.get(item.siswa_id) || null,
    branch_id: (siswaMap.get(item.siswa_id) || {}).branch_id || null,
    guru_handle: userMap.get(item.guru_handle_id) || null,
  }))

  const absensiKaryawan = (absensiKaryawanRes.data || []).map((item) => ({
    ...item,
    users: userMap.get(item.user_id) || null,
    branch_id: (userMap.get(item.user_id) || {}).branch_id || null,
  }))

  const reviewItems = reviewItemsRes.data || []
  const reviews = (reviewRes.data || []).map((item) => ({
    ...item,
    user: userMap.get(item.user_id) || null,
    reviewer: userMap.get(item.reviewer_id) || null,
    branch_id: (userMap.get(item.user_id) || {}).branch_id || null,
    items: reviewItems.filter((row) => row.review_id === item.id),
  }))

  const pengeluaran = (pengeluaranRes.data || []).map((item) => ({
    ...item, branches: branchMap.get(item.branch_id) || null, users: userMap.get(item.user_id) || null,
  }))

  const inventory = (inventoryRes.data || []).map((item) => ({
    ...item, branches: branchMap.get(item.branch_id) || null,
  }))

  return {
    branches, programs, users, siswa, pembayaran, absensiSiswa, perkembangan,
    absensiKaryawan, bonusManual: bonusRes.data || [], reviews, pengeluaran, inventory,
  }
}

// =====================================================================
// ==================== FUNGSI MUTASI (SIMPAN/UPDATE) ==================
// =====================================================================

export async function upsertBranch(form, id) {
  const payload = { ...form }
  if (!payload.id) delete payload.id
  return id ? supabase.from('branches').update(payload).eq('id', id) : supabase.from('branches').insert(payload)
}

export async function upsertProgram(form, id) {
  const payload = { ...form }
  if (!payload.id) delete payload.id
  return id ? supabase.from('programs').update(payload).eq('id', id) : supabase.from('programs').insert(payload)
}

export async function removeById(table, id) {
  return supabase.from(table).delete().eq('id', id)
}

export async function upsertSiswa(form, id) {
  const payload = { 
    ...form,
    branch_id: toNull(form.branch_id),
    program_id: toNull(form.program_id),
    guru_id: toNull(form.guru_id),
    hari: toNull(form.hari),
    jam_mulai: toNull(form.jam_mulai)
  }
  if (!payload.id) delete payload.id 
  return id ? supabase.from('siswa').update(payload).eq('id', id) : supabase.from('siswa').insert(payload)
}

export async function savePerkembangan(payload) {
  const safePayload = { ...payload, siswa_id: toNull(payload.siswa_id), guru_id: toNull(payload.guru_id) }
  const existingRes = await supabase.from('perkembangan').select('id').eq('siswa_id', safePayload.siswa_id).eq('tanggal', safePayload.tanggal).limit(1)
  if (existingRes.error) return { error: existingRes.error }
  const existing = Array.isArray(existingRes.data) ? existingRes.data[0] : null
  if (existing?.id) {
    return supabase.from('perkembangan').update({ guru_id: safePayload.guru_id, catatan: safePayload.catatan, tanggal: safePayload.tanggal }).eq('id', existing.id)
  }
  return supabase.from('perkembangan').insert(safePayload)
}

export async function saveBonus(payload) { return supabase.from('employee_bonus').insert(payload) }

export async function saveReview(payload) {
  const { data, error } = await supabase.from('employee_reviews').insert({
    user_id: payload.user_id, reviewer_id: payload.reviewer_id, period_month: payload.period_month, period_year: payload.period_year, notes: payload.notes,
  }).select('id').single()
  if (error) return { error }
  const itemsPayload = payload.items.map((item) => ({ review_id: data.id, title: item.title, score: item.score, note: item.note }))
  const itemsRes = await supabase.from('employee_review_items').insert(itemsPayload)
  if (itemsRes.error) return { error: itemsRes.error }
  return { data }
}

export async function saveUserPermissions(userId, menuPermissions) {
  return supabase.from('users').update({ menu_permissions: menuPermissions }).eq('id', userId)
}

export async function upsertUserViaRpc(form, id) {
  return supabase.rpc('app_upsert_user', {
    p_id: toNull(id),
    p_nama: form.nama, p_email: form.email, p_password: toNull(form.password), p_akses: toNull(form.akses),
    p_branch_id: toNull(form.branch_id), p_no_telepon: toNull(form.no_telepon),
    p_salary_type: form.salary_type || 'fixed', p_salary_fixed: Number(form.salary_fixed) || 0,
    p_student_fee_daily: Number(form.student_fee_daily) || 0, p_monthly_bonus_target: Number(form.monthly_bonus_target) || 0,
    p_bonus_amount: Number(form.bonus_amount) || 0, p_menu_permissions: form.menu_permissions || [],
    p_trial_ends_at: toNull(form.trial_ends_at), p_batas_jam_masuk: toNull(form.batas_jam_masuk),
    p_batas_jam_pulang: toNull(form.batas_jam_pulang), p_availability: form.availability || [],
    p_programs_can_handle: form.programs_can_handle || []
  })
}

export async function saveKasirTransaction(payload) { return supabase.rpc('app_save_kasir_transaction', payload) }
export async function saveEmployeeAttendance(payload) { return supabase.rpc('app_scan_karyawan', payload) }
export async function saveEmployeeManualAttendance(payload) { return supabase.rpc('app_save_employee_manual', payload) }
export async function saveStudentAttendance(payload) { return supabase.rpc('app_save_student_attendance', payload) }

export async function saveStudentCheckout(payload) {
  return supabase.rpc('app_save_student_attendance', {
    p_siswa_id: payload.p_siswa_id, p_guru_handle_id: payload.p_guru_handle_id || null, p_tanggal: payload.p_tanggal, mode: 'pulang', p_status: 'hadir', p_catatan: payload.p_catatan, p_sumber: 'guru_scan_pulang',
  })
}

export async function updatePembayaran(id, payload) { return supabase.from('pembayaran').update(payload).eq('id', id) }
export async function savePengeluaran(payload) { return supabase.from('pengeluaran').insert(payload) }
export async function updatePengeluaran(id, payload) { return supabase.from('pengeluaran').update(payload).eq('id', id) }
export async function upsertInventory(form, id) {
  const payload = { ...form }
  if (!payload.id) delete payload.id
  return id ? supabase.from('inventory').update(payload).eq('id', id) : supabase.from('inventory').insert(payload)
}
export async function updateInventoryStock(id, newStock) { return supabase.from('inventory').update({ stok: newStock }).eq('id', id) }

// =====================================================================
// ==================== KHUSUS PORTAL ORANG TUA ========================
// =====================================================================

export async function loginWithBarcode(barcode) {
  // Cari siswa berdasarkan kode_qr atau ID
  const { data, error } = await supabase
    .from('siswa')
    .select('*')
    .or(`kode_qr.eq.${barcode},id.eq.${barcode}`)
    .single();

  if (error || !data) throw new Error('Barcode tidak ditemukan. Pastikan scan kode siswa yang benar.');

  // Buat "User Akun Bayangan" untuk sesi Orang Tua
  return {
    id: `ortu_${data.id}`,
    nama: `Wali dari ${data.nama}`,
    akses: 'orangtua',
    parent_siswa_id: data.id,
    branch_id: data.branch_id,
    menu_permissions: ['portal_orangtua'] 
  };
}

export async function fetchDataOrangTua(siswa_id) {
  const masterPromises = [
    supabase.from('branches').select('*').order('created_at', { ascending: true }),
    supabase.from('programs').select('*').order('created_at', { ascending: false }),
    supabase.from('siswa').select('*').eq('id', siswa_id), 
    supabase.from('users_safe').select('*') 
  ];

  const transactionPromises = [
    supabase.from('pembayaran').select('*').eq('siswa_id', siswa_id).order('created_at', { ascending: false }),
    supabase.from('perkembangan').select('*').eq('siswa_id', siswa_id).order('created_at', { ascending: false }),
    supabase.from('absensi_siswa').select('*').eq('siswa_id', siswa_id).order('created_at', { ascending: false })
  ];

  const results = await Promise.all([...masterPromises, ...transactionPromises]);
  const firstError = results.find(r => r.error);
  if (firstError) throw firstError.error;

  const [branchesRes, programsRes, usersRes, siswaRes, pembayaranRes, perkembanganRes, absensiSiswaRes] = results;

  const branchMap = new Map((branchesRes.data || []).map(item => [item.id, item]));
  const programMap = new Map((programsRes.data || []).map(item => [item.id, item]));
  const userMap = new Map((usersRes.data || []).map(item => [item.id, item]));

  const siswa = (siswaRes.data || []).map(item => ({
    ...item, branches: branchMap.get(item.branch_id) || null, programs: programMap.get(item.program_id) || null, users: userMap.get(item.guru_id) || null
  }));

  return {
    branches: branchesRes.data || [], programs: programsRes.data || [], users: usersRes.data || [], siswa,
    pembayaran: (pembayaranRes.data || []).map(item => ({...item, programs: programMap.get(item.program_id) || null})),
    perkembangan: (perkembanganRes.data || []).map(item => ({...item, users: userMap.get(item.guru_id) || null})),
    absensiSiswa: absensiSiswaRes.data || [],
    absensiKaryawan: [], bonusManual: [], reviews: [], pengeluaran: [], inventory: []
  };
  // =====================================================================
// ================= HITUNG RINGKASAN LAPORAN (HEMAT EGRESS) ==========
// =====================================================================

export async function fetchRingkasanLaporan(startDate, endDate, branchId = null) {
  try {
    const { data, error } = await supabase.rpc('get_laporan_ringkasan', {
      p_start_date: startDate,
      p_end_date: endDate,
      p_branch_id: branchId || null
    });

    if (error) {
      console.error('Error memanggil get_laporan_ringkasan:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Gagal mengambil ringkasan laporan:', err);
    return null;
  }
}
}
