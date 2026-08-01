'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase' // Sesuaikan dengan lokasi file supabase Mas (bisa jadi '../lib/supabaseClient')
import { Html5QrcodeScanner } from 'html5-qrcode'
import {
  EMPLOYEE_GLOBAL_IN, EMPLOYEE_GLOBAL_OUT, INITIAL_BONUS_FORM, INITIAL_BRANCH_FORM,
  INITIAL_EMPLOYEE_MANUAL_FORM, INITIAL_KASIR_FORM, INITIAL_PERKEMBANGAN_FORM,
  INITIAL_PROGRAM_FORM, INITIAL_REVIEW_FORM, INITIAL_SISWA_FORM, INITIAL_STUDENT_ATTENDANCE_FORM,
  INITIAL_USER_FORM, INITIAL_AVAILABILITY, INITIAL_PENGELUARAN_FORM, INITIAL_INVENTORY_FORM, TODAY, allowedTabs, defaultPermissionsByRole, normalizePermissions, NOW_ISO
} from '../lib/constants'
import { formatMonthYear, formatRupiah, generateStudentBarcode, formatTanggal } from '../lib/format'
import { loginWithRpc } from '../lib/auth'
import {
  fetchAllData, removeById, saveBonus, saveEmployeeAttendance, saveEmployeeManualAttendance,
  saveKasirTransaction, savePerkembangan, saveReview, saveStudentAttendance,
  saveUserPermissions, upsertBranch, upsertProgram, upsertSiswa, upsertUserViaRpc,
  updatePembayaran, savePengeluaran, updatePengeluaran, upsertInventory, updateInventoryStock,
  toNull // <--- WAJIB TAMBAHKAN INI ✨
} from '../lib/data'
import { validateBonusForm, validateBranchForm, validateEmployeeManualForm, validatePerkembanganForm, validateProgramForm, validateReviewForm, validateSiswaForm, validateStudentAttendanceForm, validateUserForm } from '../lib/validation'
import { clearSession, readSession, saveSession } from '../lib/session'
import { downloadCsv, exportRows } from '../lib/export'
import { buildFinanceSummary, computeOverview, computePayroll, filterByUserBranch } from '../lib/reporting'
import { printBarcodeCard } from '../components/ui/BarcodePreview'
import QRCode from 'qrcode'

function normalizeUserPayload(row) {
  if (!row) return row;

  let dbPerms = row.menu_permissions;
  const normalizedAkses = String(row.akses || '').trim().toLowerCase();

  // === PENGAMAN BARU: Jika Supabase mengirim data sebagai Teks, kita ubah paksa jadi Array ===
  if (typeof dbPerms === 'string') {
    try {
      // Jika format dari postgres seperti "{overview,siswa}"
      if (dbPerms.startsWith('{')) {
        dbPerms = dbPerms.slice(1, -1).split(',').map(s => s.replace(/"/g, '').trim());
      } else {
        dbPerms = JSON.parse(dbPerms);
      }
    } catch (e) {
      dbPerms = [];
    }
  }

  // Cek apakah koper hak aksesnya ada isinya
  const hasCustomPerms = Array.isArray(dbPerms) && dbPerms.length > 0;

  // Jika ada isinya pakai data database. Jika kosong melompong, pakai bawaan pabrik.
  // Akses dinormalisasi ke huruf kecil supaya MASTER/ADMIN dari database tetap terbaca benar.
  const finalPerms = hasCustomPerms ? dbPerms : normalizePermissions(dbPerms, normalizedAkses);

  return { ...row, akses: normalizedAkses, menu_permissions: finalPerms };
}

function isPrivilegedBranchUser(user) {
  const akses = String(user?.akses || '').trim().toLowerCase();
  return ['master', 'admin', 'owner', 'super admin', 'super_admin'].includes(akses);
}


function isParentUser(user) {
  const akses = String(user?.akses || '').trim().toLowerCase();
  return ['orangtua', 'ortu', 'parent', 'wali'].includes(akses);
}

function normalizePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  if (digits.startsWith('8')) digits = '62' + digits;
  return digits;
}

function isStudentLinkedToParent(siswa, user) {
  if (!isParentUser(user)) return true;

  const userLinkedIds = [user?.siswa_id, user?.student_id, user?.parent_siswa_id, user?.anak_id]
    .filter(Boolean)
    .map((item) => String(item));
  if (userLinkedIds.length && userLinkedIds.includes(String(siswa?.id))) return true;

  const parentPhone = normalizePhone(user?.no_telepon || user?.no_hp || user?.phone || user?.telepon);
  if (!parentPhone) return false;

  const studentPhones = [siswa?.no_hp, siswa?.no_wa, siswa?.wa_ortu, siswa?.no_wa_ortu, siswa?.telepon_ortu]
    .map(normalizePhone)
    .filter(Boolean);

  return studentPhones.includes(parentPhone);
}

export function useBimbelApp() {
  const [user, setUser] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loadingLogin, setLoadingLogin] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [message, setMessage] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [loadingData, setLoadingData] = useState(false)

  const [branches, setBranches] = useState([])
  const [programs, setPrograms] = useState([])
  const [users, setUsers] = useState([])
  const [siswa, setSiswa] = useState([])
  const [pembayaran, setPembayaran] = useState([])
  const [absensiSiswa, setAbsensiSiswa] = useState([])
  const [perkembangan, setPerkembangan] = useState([])
  const [absensiKaryawan, setAbsensiKaryawan] = useState([])
  const [bonusManual, setBonusManual] = useState([])
  const [reviews, setReviews] = useState([])
  const [pengeluaran, setPengeluaran] = useState([])
  const [inventory, setInventory] = useState([])

  const [branchForm, setBranchForm] = useState(INITIAL_BRANCH_FORM)
  const [programForm, setProgramForm] = useState(INITIAL_PROGRAM_FORM)
  const [userForm, setUserForm] = useState(INITIAL_USER_FORM)
  const [siswaForm, setSiswaForm] = useState(INITIAL_SISWA_FORM)
  const [perkembanganForm, setPerkembanganForm] = useState(INITIAL_PERKEMBANGAN_FORM)
  const [kasirForm, setKasirForm] = useState(INITIAL_KASIR_FORM)
  const [bonusForm, setBonusForm] = useState(INITIAL_BONUS_FORM)
  const [employeeManualForm, setEmployeeManualForm] = useState(INITIAL_EMPLOYEE_MANUAL_FORM)
  const [studentAttendanceForm, setStudentAttendanceForm] = useState(INITIAL_STUDENT_ATTENDANCE_FORM)
  const [reviewForm, setReviewForm] = useState(INITIAL_REVIEW_FORM)
  const [pengeluaranForm, setPengeluaranForm] = useState(INITIAL_PENGELUARAN_FORM)
  const [inventoryForm, setInventoryForm] = useState(INITIAL_INVENTORY_FORM)

  const [permissionUserId, setPermissionUserId] = useState('')
  const [permissionDraft, setPermissionDraft] = useState([])
  const [scanStudentActive, setScanStudentActive] = useState(false)
  const [scanEmployeeActive, setScanEmployeeActive] = useState(false)
  const [employeeMode, setEmployeeMode] = useState('datang')
  const [studentScanText, setStudentScanText] = useState('')
  const [employeeScanText, setEmployeeScanText] = useState('')
  const [studentScanInfo, setStudentScanInfo] = useState('Belum ada hasil scan siswa.')
  const [employeeScanInfo, setEmployeeScanInfo] = useState('Belum ada hasil scan karyawan.')
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [selectedProgressStudent, setSelectedProgressStudent] = useState(null)
  const [exportType, setExportType] = useState('siswa')
  const [exportDateFrom, setExportDateFrom] = useState('')
  const [exportDateTo, setExportDateTo] = useState('')
  const [progressInputMode, setProgressInputMode] = useState('scan')
  const [lastReceipt, setLastReceipt] = useState(null)
  const [searchSiswa, setSearchSiswa] = useState('')
  const [searchTransaksi, setSearchTransaksi] = useState('')
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const [payrollMonth, setPayrollMonth] = useState(new Date().getMonth() + 1)
  const [payrollYear, setPayrollYear] = useState(new Date().getFullYear())

  const [showReceiptPopup, setShowReceiptPopup] = useState(false)
  const [editTransaksiForm, setEditTransaksiForm] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, table: '', id: '', label: '' })
  
  const [archiveState, setArchiveState] = useState({ show: false, forced: false, password: '', loading: false, months: 6 })

  const studentScannerRef = useRef(null)
  const employeeScannerRef = useRef(null)

  const visibleTabs = useMemo(() => allowedTabs(user?.akses, user?.menu_permissions), [user])

  // MASTER/ADMIN boleh melihat semua cabang.
  // User cabang seperti guru/kasir tetap dibatasi ke branch_id masing-masing.
  const canAccessAllBranches = useMemo(() => isPrivilegedBranchUser(user), [user])
  const branchScopedUser = useMemo(() => {
    if (!user) return user;
    return canAccessAllBranches ? { ...user, branch_id: null } : user;
  }, [user, canAccessAllBranches])

  const selectedBranch = useMemo(() => {
    if (selectedBranchId) return branches.find((item) => item.id === selectedBranchId) || null;
    if (!canAccessAllBranches && user?.branch_id) return branches.find((item) => item.id === user.branch_id) || null;
    return null; 
  }, [branches, selectedBranchId, user, canAccessAllBranches])

  // === TAMBAHKAN DUA BARIS INI TEPAT DI BAWAHNYA ===
  const employeeBarcodeIn = selectedBranch?.employee_barcode_in || EMPLOYEE_GLOBAL_IN;
  const employeeBarcodeOut = selectedBranch?.employee_barcode_out || EMPLOYEE_GLOBAL_OUT;


  const usersTampil = useMemo(() => {
    let rows = filterByUserBranch(users, branchScopedUser);
    if (selectedBranchId) {
      rows = rows.filter((item) => item.branch_id === selectedBranchId);
    }
    return rows;
  }, [users, branchScopedUser, selectedBranchId])
  const siswaScoped = useMemo(() => {
    const rows = filterByUserBranch(siswa, branchScopedUser)
    return isParentUser(user) ? rows.filter((item) => isStudentLinkedToParent(item, user)) : rows
  }, [siswa, branchScopedUser, user])

  const parentStudentIds = useMemo(
    () => new Set((siswaScoped || []).map((item) => String(item.id)).filter(Boolean)),
    [siswaScoped]
  )

  const filterRowsForParent = (rows, branchField = 'branch_id') => {
    const branchRows = filterByUserBranch(rows, branchScopedUser, branchField)
    if (!isParentUser(user)) return branchRows
    return branchRows.filter((item) => parentStudentIds.has(String(item.siswa_id || item.siswa?.id || '')))
  }

  const pembayaranScoped = useMemo(() => filterRowsForParent(pembayaran, 'branch_id'), [pembayaran, branchScopedUser, user, parentStudentIds])
  const absensiSiswaScoped = useMemo(() => filterRowsForParent(absensiSiswa, 'branch_id'), [absensiSiswa, branchScopedUser, user, parentStudentIds])
  const perkembanganScoped = useMemo(() => filterRowsForParent(perkembangan, 'branch_id'), [perkembangan, branchScopedUser, user, parentStudentIds])
  const absensiKaryawanScoped = useMemo(() => isParentUser(user) ? [] : filterByUserBranch(absensiKaryawan, branchScopedUser, 'branch_id'), [absensiKaryawan, branchScopedUser, user])
  const bonusManualScoped = useMemo(() => isParentUser(user) ? [] : filterByUserBranch(bonusManual, branchScopedUser, 'branch_id'), [bonusManual, branchScopedUser, user])
  const reviewsScoped = useMemo(() => isParentUser(user) ? [] : filterByUserBranch(reviews, branchScopedUser, 'branch_id'), [reviews, branchScopedUser, user])
  const pengeluaranScoped = useMemo(() => isParentUser(user) ? [] : filterByUserBranch(pengeluaran, branchScopedUser, 'branch_id'), [pengeluaran, branchScopedUser, user])
  const inventoryScoped = useMemo(() => isParentUser(user) ? [] : filterByUserBranch(inventory, branchScopedUser, 'branch_id'), [inventory, branchScopedUser, user])

  const siswaTampil = useMemo(() => {
    let rows = siswaScoped
    if (selectedBranchId) rows = rows.filter((item) => item.branch_id === selectedBranchId)
    // Guru boleh input perkembangan untuk semua siswa dalam cabangnya.
    // Jangan filter berdasarkan guru_id, karena beberapa siswa bisa diajar bergantian oleh guru lain.
    if (searchSiswa) {
      const q = searchSiswa.toLowerCase()
      rows = rows.filter(item => item.nama?.toLowerCase().includes(q) || item.no_hp?.includes(q))
    }
    return rows
  }, [siswaScoped, selectedBranchId, user, searchSiswa])

  const pembayaranTampil = useMemo(() => {
    let rows = selectedBranchId ? pembayaranScoped.filter((item) => item.branch_id === selectedBranchId) : pembayaranScoped;
    if (searchTransaksi) {
      const q = searchTransaksi.toLowerCase()
      rows = rows.filter(item => item.siswa?.nama?.toLowerCase().includes(q) || item.programs?.nama?.toLowerCase().includes(q) || item.keterangan?.toLowerCase().includes(q))
    }
    return rows;
  }, [pembayaranScoped, selectedBranchId, searchTransaksi])

  const perkembanganTampil = useMemo(() => selectedBranchId ? perkembanganScoped.filter((item) => item.siswa?.branch_id === selectedBranchId || item.users?.branch_id === selectedBranchId) : perkembanganScoped, [perkembanganScoped, selectedBranchId])
  const absensiKaryawanTampil = useMemo(() => selectedBranchId ? absensiKaryawanScoped.filter((item) => item.users?.branch_id === selectedBranchId) : absensiKaryawanScoped, [absensiKaryawanScoped, selectedBranchId])
  const bonusManualTampil = useMemo(() => selectedBranchId ? bonusManualScoped.filter((item) => item.branch_id === selectedBranchId) : bonusManualScoped, [bonusManualScoped, selectedBranchId])
  const absensiSiswaTampil = useMemo(() => selectedBranchId ? absensiSiswaScoped.filter((item) => item.branch_id === selectedBranchId) : absensiSiswaScoped, [absensiSiswaScoped, selectedBranchId])
  const reviewsTampil = useMemo(() => selectedBranchId ? reviewsScoped.filter((item) => item.branch_id === selectedBranchId) : reviewsScoped, [reviewsScoped, selectedBranchId])
  const pengeluaranTampil = useMemo(() => selectedBranchId ? pengeluaranScoped.filter((item) => item.branch_id === selectedBranchId) : pengeluaranScoped, [pengeluaranScoped, selectedBranchId])
  const inventoryTampil = useMemo(() => selectedBranchId ? inventoryScoped.filter((item) => item.branch_id === selectedBranchId) : inventoryScoped, [inventoryScoped, selectedBranchId])

  const perkembanganHistory = useMemo(() => {
    if (!perkembanganForm.siswa_id) return []
    return perkembanganTampil.filter((item) => item.siswa_id === perkembanganForm.siswa_id).sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal))).slice(0, 5)
  }, [perkembanganTampil, perkembanganForm.siswa_id])

  const guruOptions = useMemo(() => 
  usersTampil.filter((item) => item.akses && item.akses.toLowerCase().trim() === 'guru'), 
[usersTampil])
  const targetPayrollDate = useMemo(() => new Date(payrollYear, payrollMonth - 1, 1), [payrollMonth, payrollYear])
  
  // === SARINGAN KHUSUS PAYROLL (HANYA AMBIL DATA SESUAI BULAN & TAHUN YANG DIPILIH) ===
  const absKaryawanPayroll = useMemo(() => absensiKaryawanTampil.filter(item => item.tanggal && new Date(item.tanggal).getMonth() + 1 === payrollMonth && new Date(item.tanggal).getFullYear() === payrollYear), [absensiKaryawanTampil, payrollMonth, payrollYear]);
  const bonusPayroll = useMemo(() => bonusManualTampil.filter(item => item.bonus_date && new Date(item.bonus_date).getMonth() + 1 === payrollMonth && new Date(item.bonus_date).getFullYear() === payrollYear), [bonusManualTampil, payrollMonth, payrollYear]);
  const absSiswaPayroll = useMemo(() => absensiSiswaTampil.filter(item => item.tanggal && new Date(item.tanggal).getMonth() + 1 === payrollMonth && new Date(item.tanggal).getFullYear() === payrollYear), [absensiSiswaTampil, payrollMonth, payrollYear]);

  // Masukkan data yang SUDAH DISARING ke dalam mesin hitung Payroll
  const payrollRows = useMemo(() => computePayroll({ 
    users: usersTampil, 
    absensiSiswa: absSiswaPayroll, 
    absensiKaryawan: absKaryawanPayroll, 
    bonusManual: bonusPayroll, 
    targetDate: targetPayrollDate 
  }), [usersTampil, absSiswaPayroll, absKaryawanPayroll, bonusPayroll, targetPayrollDate])
  // ===================================================================================

  // Filter data khusus untuk Dashboard/Overview berdasarkan pilihan dropdown cabang
  const overview = useMemo(() => computeOverview({ 
    pembayaran: pembayaranTampil, 
    pengeluaran: pengeluaranTampil, 
    siswa: siswaTampil, 
    users: usersTampil, 
    branches: selectedBranchId ? branches.filter((b) => b.id === selectedBranchId) : branches, 
    payrollRows 
  }), [pembayaranTampil, pengeluaranTampil, siswaTampil, usersTampil, branches, selectedBranchId, payrollRows])

  const financeSummary = useMemo(() => buildFinanceSummary(
    pembayaranTampil, 
    pengeluaranTampil, 
    payrollRows, 
    bonusManualTampil, 
    selectedBranchId ? branches.filter((b) => b.id === selectedBranchId) : branches
  ), [pembayaranTampil, pengeluaranTampil, payrollRows, bonusManualTampil, branches, selectedBranchId])
  const stats = useMemo(() => ({ siswa: siswaTampil.length, pegawai: usersTampil.length, program: programs.length, pemasukan: pembayaranTampil.reduce((sum, item) => sum + Number(item.nominal || 0), 0) }), [siswaTampil, usersTampil, programs, pembayaranTampil])

  useEffect(() => { const cachedUser = readSession(); if (cachedUser) setUser(normalizeUserPayload(cachedUser)) }, [])
  useEffect(() => {
    if (!user) return;

    if (isParentUser(user) || user?.login_method === 'barcode_siswa') {
      loadParentData();
    } else {
      loadAllData();
    }
  }, [user])
  useEffect(() => {
    if (!user) return;

    // Jangan paksa MASTER/ADMIN ke branch_id tertentu.
    // Ini penyebab pilihan "Semua cabang" selalu balik ke cabang user.
    if (canAccessAllBranches || isParentUser(user)) return;

    if (user?.branch_id && !selectedBranchId) {
      setSelectedBranchId(user.branch_id);
    }
  }, [user, selectedBranchId, canAccessAllBranches])

  useEffect(() => {
    if (!permissionUserId) return setPermissionDraft([])
    const selected = usersTampil.find((item) => item.id === permissionUserId)
    
    // Langsung tampilkan apa adanya dari database, jangan difilter/direset lagi!
    const dbPerms = selected?.menu_permissions;
    const finalPerms = (dbPerms && dbPerms.length > 0) ? dbPerms : [];
    
    setPermissionDraft(finalPerms);
  }, [permissionUserId, usersTampil])

  useEffect(() => {
    if (!perkembanganForm.siswa_id) return setSelectedProgressStudent(null)
    const selected = siswaTampil.find((item) => item.id === perkembanganForm.siswa_id) || null
    setSelectedProgressStudent(selected)
  }, [perkembanganForm.siswa_id, siswaTampil])

  useEffect(() => {
    const hasMaintenanceAccess = user?.menu_permissions?.includes('maintenance') || user?.akses === 'master';
    if (hasMaintenanceAccess && (pembayaran.length > 0 || perkembanganTampil.length > 0)) {
      const now = new Date();
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 6, 1);
      const cutoffDate = cutoff.toISOString().slice(0, 10);
      if (pembayaran.filter(item => item.tanggal && item.tanggal < cutoffDate).length > 0 || perkembanganTampil.filter(item => item.tanggal && item.tanggal < cutoffDate).length > 0) {
        setArchiveState(prev => ({ ...prev, show: true, forced: true, months: 6 }))
      } else {
        setArchiveState(prev => ({ ...prev, show: false, forced: false }))
      }
    }
  }, [pembayaran, perkembanganTampil, user])

  useEffect(() => {
    if (!scanStudentActive) return undefined
    const scanner = new Html5QrcodeScanner('reader-siswa', { qrbox: { width: 220, height: 220 }, fps: 5, rememberLastUsedCamera: true }, false)
    studentScannerRef.current = scanner
    scanner.render(async (decodedText) => {
      setStudentScanText(decodedText)
      if (activeTab === 'perkembangan') await prosesScanPerkembangan(decodedText)
      else await prosesScanSiswa(decodedText)
      setScanStudentActive(false)
    }, () => {})
    return () => { scanner.clear().catch(() => {}); studentScannerRef.current = null }
  }, [scanStudentActive, activeTab, user, siswaTampil, perkembanganForm])

  useEffect(() => {
    if (!scanEmployeeActive) return undefined
    const scanner = new Html5QrcodeScanner('reader-karyawan', { qrbox: { width: 220, height: 220 }, fps: 5, rememberLastUsedCamera: true }, false)
    employeeScannerRef.current = scanner
    scanner.render(async (decodedText) => {
      setEmployeeScanText(decodedText)
      await prosesScanKaryawan(decodedText)
      setScanEmployeeActive(false)
    }, () => {})
    return () => { scanner.clear().catch(() => {}); employeeScannerRef.current = null }
  }, [scanEmployeeActive, employeeMode, user, employeeBarcodeIn, employeeBarcodeOut])

  // Load data khusus orangtua.
  // Sengaja dipisahkan dari loadAllData agar login barcode siswa
  // tidak menarik seluruh database Supabase.
  async function loadParentData() {
    try {
      setLoadingData(true);
      setErrorMsg('');

      const siswaId =
        user?.siswa_id ||
        user?.student_id ||
        user?.parent_siswa_id ||
        user?.anak_id;

      if (!siswaId) {
        throw new Error('Data siswa orangtua tidak ditemukan.');
      }

      const [
        siswaRes,
        perkembanganRes,
        absensiRes,
        pembayaranRes,
        branchesRes // <--- KITA TAMBAHKAN PEMANGGILAN CABANG DI SINI
      ] = await Promise.all([
        supabase
          .from('siswa')
          .select('*')
          .eq('id', siswaId)
          .limit(1)
          .maybeSingle(),

        supabase
          .from('perkembangan')
          .select('*')
          .eq('siswa_id', siswaId)
          .order('created_at', { ascending: false })
          .limit(50),

        supabase
          .from('absensi_siswa')
          .select('*')
          .eq('siswa_id', siswaId)
          .order('tanggal', { ascending: false })
          .limit(50),

        supabase
          .from('pembayaran')
          .select('*')
          .eq('siswa_id', siswaId)
          .order('created_at', { ascending: false })
          .limit(50),
          
        supabase
          .from('branches')
          .select('*') // <--- AGAR DATA REKENING BISA KETARIK
      ]);

      if (siswaRes.error) throw siswaRes.error;
      if (perkembanganRes.error) throw perkembanganRes.error;
      if (absensiRes.error) throw absensiRes.error;
      if (pembayaranRes.error) throw pembayaranRes.error;
      if (branchesRes.error) throw branchesRes.error;

      setSiswa(siswaRes.data ? [siswaRes.data] : []);
      setPerkembangan(perkembanganRes.data || []);
      setAbsensiSiswa(absensiRes.data || []);
      setPembayaran(pembayaranRes.data || []);
      setBranches(branchesRes.data || []); // <--- REKENING DISIMPAN DI SINI KEMBALI

      // Sisa data berat lainnya tetap dikosongkan agar cepat
      setPrograms([]);
      setUsers([]);
      setAbsensiKaryawan([]);
      setBonusManual([]);
      setReviews([]);
      setPengeluaran([]);
      setInventory([]);

    } catch (error) {
      setErrorMsg(error.message || 'Gagal mengambil data orangtua.');
    } finally {
      setLoadingData(false);
    }
  }

  async function loadAllData() {
    try {
      setLoadingData(true); setErrorMsg('')
      const data = await fetchAllData()
      setBranches(data.branches); setPrograms(data.programs); setUsers((data.users || []).map(normalizeUserPayload)); setSiswa(data.siswa); setPembayaran(data.pembayaran); setAbsensiSiswa(data.absensiSiswa); setPerkembangan(data.perkembangan); setAbsensiKaryawan(data.absensiKaryawan); setBonusManual(data.bonusManual); setReviews(data.reviews); setPengeluaran(data.pengeluaran || []); setInventory(data.inventory || [])
    } catch (error) { setErrorMsg(error.message || 'Gagal mengambil data.') } finally { setLoadingData(false) }
  }

  function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim())
  }

  async function cariSiswaDariBarcodeLogin(rawValue) {
    const kode = String(rawValue || '').trim()
    if (!kode) throw new Error('Barcode siswa belum terbaca.')

    const kolomDicoba = [
      { field: 'kode_qr', value: kode },
      { field: 'barcode', value: kode },
    ]

    if (isUuidLike(kode)) {
      kolomDicoba.push({ field: 'id', value: kode })
    }

    for (const item of kolomDicoba) {
      const { data, error } = await supabase
        .from('siswa')
        .select('*')
        .eq(item.field, item.value)
        .limit(1)
        .maybeSingle()

      if (error) {
        const pesanError = String(error.message || '').toLowerCase()

        if (
          pesanError.includes('does not exist') ||
          pesanError.includes('could not find') ||
          error.code === 'PGRST116'
        ) {
          continue
        }

        throw error
      }

      if (data) return data
    }

    throw new Error('Barcode siswa tidak ditemukan. Pastikan yang discan adalah barcode/QR siswa.')
  }

  async function loginDenganBarcodeSiswa(rawValue) {
    setLoadingLogin(true)
    setLoginError('')

    try {
      const siswaDitemukan = await cariSiswaDariBarcodeLogin(rawValue)

      const userOrangtua = normalizeUserPayload({
        id: `orangtua-barcode-${siswaDitemukan.id}`,
        nama: `Orang Tua ${siswaDitemukan.nama || ''}`.trim(),
        email: `barcode-siswa:${siswaDitemukan.kode_qr || siswaDitemukan.barcode || siswaDitemukan.id}`,
        akses: 'orangtua',
        branch_id: null,
        no_telepon: siswaDitemukan.no_hp || '',
        siswa_id: siswaDitemukan.id,
        student_id: siswaDitemukan.id,
        parent_siswa_id: siswaDitemukan.id,
        menu_permissions: ['portal_orangtua'],
        login_method: 'barcode_siswa',
      })

      setUser(userOrangtua)
      saveSession(userOrangtua)
      setSelectedBranchId('')
      setSearchSiswa('')
      setActiveTab('portal_orangtua')
      setMessage(`Akses orang tua dibuka untuk ananda ${siswaDitemukan.nama || 'siswa'}.`)
    } catch (error) {
      setLoginError(error.message || 'Barcode siswa tidak dikenali.')
    } finally {
      setLoadingLogin(false)
    }
  }

  async function login(eventOrBarcode, loginMode) {
    const barcodeInput = typeof eventOrBarcode === 'string' ? eventOrBarcode.trim() : ''

    if (loginMode === 'barcode_siswa' || barcodeInput) {
      return loginDenganBarcodeSiswa(barcodeInput)
    }

    setLoadingLogin(true); setLoginError('')
    try {
      const loggedInUser = normalizeUserPayload(await loginWithRpc(email, password))

      setSelectedBranchId((isPrivilegedBranchUser(loggedInUser) || isParentUser(loggedInUser)) ? '' : (loggedInUser.branch_id || ''));

      setUser(loggedInUser)
      saveSession(loggedInUser)
      setActiveTab(allowedTabs(loggedInUser?.akses, loggedInUser?.menu_permissions)?.[0] || 'overview')
      setMessage(`Login berhasil sebagai ${loggedInUser.akses}.`)
    } catch (error) { setLoginError(error.message || 'Login gagal.') } finally { setLoadingLogin(false) }
  }

  function logout() { setUser(null); setEmail(''); setPassword(''); setActiveTab('overview'); setSelectedBranchId(''); clearSession(); setMessage('Logout berhasil.') }

  async function submitBranch(event) { 
  event.preventDefault(); 
  try { 
    const res = await upsertBranch(validateBranchForm(branchForm), branchForm.id); 
    if (res.error) throw res.error; 

    // --- PERBAIKAN DI SINI ---
    // Kita gunakan spread operator {...} agar benar-benar jadi data baru
    setBranchForm({ ...INITIAL_BRANCH_FORM }); 
    
    setMessage('Cabang disimpan.'); 
    await loadAllData(); 
  } catch (error) { 
    setErrorMsg(error.message); 
  } 
}
  async function submitProgram(event) { event.preventDefault(); try { const res = await upsertProgram(validateProgramForm(programForm), programForm.id); if (res.error) throw res.error; setProgramForm(INITIAL_PROGRAM_FORM); setMessage('Program disimpan.'); await loadAllData() } catch (error) { setErrorMsg(error.message) } }
  async function submitUser(event) { 
    event.preventDefault(); 
    try { 
      const payload = validateUserForm({ 
        ...userForm, 
        menu_permissions: userForm.menu_permissions?.length ? userForm.menu_permissions : defaultPermissionsByRole(userForm.akses),
        // === TAMBAHKAN DUA BARIS INI ===
        availability: userForm.availability,
        programs_can_handle: userForm.programs_can_handle
        // ==============================
      
      }); 
      const res = await upsertUserViaRpc(payload, userForm.id); 
      if (res.error) throw res.error; 
      
      // === RESET FORM DENGAN MEMBERSIHKAN CHECKLIST ===
      setUserForm({
        ...INITIAL_USER_FORM,
        akses: '', // Agar kotak jadwal Guru otomatis sembunyi setelah simpan
        // Ini kunci utamanya: Kita fotokopi ulang jadwal agar semua centang (aktif) jadi false
        availability: INITIAL_AVAILABILITY.map(day => ({ ...day, aktif: false })),
        programs_can_handle: []
      });
    setUserForm(INITIAL_USER_FORM);
    // NOTIFIKASI DISINI:
    setMessage(userForm.id ? '✅ Data Karyawan berhasil diperbarui!' : '✅ Karyawan baru berhasil ditambahkan!');
      
      await loadAllData();
    } catch (error) { 
      setErrorMsg(error.message); 
    } 
  } 
  function generateStudentBarcodeAction() { const branchCode = branches.find((item) => item.id === siswaForm.branch_id)?.kode || selectedBranch?.kode || 'PUSAT'; setSiswaForm((prev) => ({ ...prev, kode_qr: generateStudentBarcode({ nama: prev.nama, kelas: prev.kelas, branchCode }) })) }
  // KODE BARU (SUDAH ADA PEMBERSIH NOMOR HP)
// KODE BARU (SUDAH ADA PEMBERSIH NOMOR HP, TANPA ALERT GANGGUAN)
  async function submitSiswa(event) {
    event.preventDefault();
    try {
      // 1. Cek apakah ini pendaftaran siswa baru
      const isSiswaBaru = !siswaForm.id;

      // 2. Bersihkan format nomor HP
      let cleanedHp = String(siswaForm.no_hp || '').replace(/\s+/g, '').replace(/-/g, '').replace(/\./g, '');
      if (cleanedHp.startsWith('0')) {
        cleanedHp = '+62' + cleanedHp.slice(1);
      } else if (cleanedHp.startsWith('62') && !cleanedHp.startsWith('+62')) {
        cleanedHp = '+' + cleanedHp;
      }

      // 3. Siapkan data siswa untuk disimpan
      const enriched = {
        ...siswaForm,
        no_hp: cleanedHp,
        hari: siswaForm.hari,
        jam_mulai: siswaForm.jam_mulai,
        kode_qr: siswaForm.kode_qr ? siswaForm.kode_qr : generateStudentBarcode({ nama: siswaForm.nama, kelas: siswaForm.kelas, branchCode: branches.find((item) => item.id === siswaForm.branch_id)?.kode })
      };
      
      // 4. Simpan ke database Supabase
      const res = await upsertSiswa({ 
        ...validateSiswaForm(enriched), 
        sesi_awal: Number(siswaForm.sesi_awal || 0) 
      }, siswaForm.id);
      if (res.error) throw res.error;

      // 5. KIRIM WA OTOMATIS KE SISWA BARU
      if (isSiswaBaru && cleanedHp) {
        const targetBranch = branches.find((b) => b.id === siswaForm.branch_id);
        const LINK_GRUP_WA = targetBranch?.link_grup || "https://chat.whatsapp.com/GrupBelumDiatur";

        const pesanWelcome = `Halo Ayah/Bunda dari ananda *${siswaForm.nama}*! Selamat datang dan selamat bergabung di Bimbel TOP PANGKALAN ya! ✨\n\n` +
          `Biar kita bisa komunikasi lebih enak dan Ayah/Bunda nggak ketinggalan info seru seputar jadwal serta kegiatan belajar mengajar, yuk langsung gabung ke Grup WhatsApp kita!\n\n` +
          `Tinggal klik link ini aja ya:\n` +
          `🔗 ${LINK_GRUP_WA}\n\n` +
          `Admin tunggu di dalam ya! Terima kasih 🥰`;

        await supabase.from('wa_queue').insert([
          { 
            no_wa: cleanedHp, 
            pesan: pesanWelcome, 
            status: 'pending',
            //cabang_id: siswaForm.branch_id || selectedBranchId // <--- TAMBAHAN INI
          }
        ]);
      }

      // 6. Reset form dan tampilkan notifikasi
      setSiswaForm({ ...INITIAL_SISWA_FORM, sesi_awal: 0 }); // <--- UBAH BARIS INI
      setMessage(isSiswaBaru ? 'Siswa baru disimpan & Undangan grup dikirim! 🚀' : 'Data siswa berhasil diupdate. ✅');
      
    } catch (error) {
      setErrorMsg(error.message);
    }
  }
  
  const deleteBranch = (id, label) => setDeleteConfirm({ show: true, table: 'branches', id, label })
  const deleteProgram = (id, label) => setDeleteConfirm({ show: true, table: 'programs', id, label })
  const deleteUser = (id, label) => setDeleteConfirm({ show: true, table: 'users', id, label })
  const deleteSiswa = (id, label) => setDeleteConfirm({ show: true, table: 'siswa', id, label })
  const deleteTransaksi = (id, label) => setDeleteConfirm({ show: true, table: 'pembayaran', id, label })
  const deletePengeluaran = (id, label) => setDeleteConfirm({ show: true, table: 'pengeluaran', id, label })
  const deleteInventory = (id, label) => setDeleteConfirm({ show: true, table: 'inventory', id, label })

  async function confirmDelete() {
    const { table, id, label } = deleteConfirm;
    try {
      if (table === 'pembayaran') {
        const trx = pembayaranTampil.find((t) => t.id === id);
        if (trx && trx.keterangan) {
          for (const inv of inventoryTampil) {
            const escapedName = inv.nama.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedName + '\\s*\\((\\d+)x\\)');
            const match = trx.keterangan.match(regex);
            if (match && match[1]) { await updateInventoryStock(inv.id, inv.stok + parseInt(match[1], 10)) }
          }
        }
      }
      
      const { error } = await removeById(table, id);
      if (error) throw error;
      
      setMessage(`Data ${label} berhasil dihapus.`);
      await loadAllData();
    } catch (error) { 
      setErrorMsg(error.message);
    } finally {
      setDeleteConfirm({ show: false, table: '', id: '', label: '' });
    }
  }

  function triggerManualArchive(months = 6) { setArchiveState({ show: true, forced: false, password: '', loading: false, months: months }) }
  function downloadBlobFile(blob, fileName) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = fileName; document.body.appendChild(link); link.click(); document.body.removeChild(link) }

  async function executeArchive() {
    if (!archiveState.password) return setErrorMsg('Password wajib diisi!')
    setArchiveState(prev => ({ ...prev, loading: true }))
    try {
      await loginWithRpc(user.email, archiveState.password)
      const now = new Date(); const bufferMonths = archiveState.months || 6; const cutoff = new Date(now.getFullYear(), now.getMonth() - bufferMonths, 1); const cutoffDate = cutoff.toISOString().slice(0, 10);
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"]; const fileLabel = `Sblm_${monthNames[cutoff.getMonth()]}_${cutoff.getFullYear()}`;
      const oldTrans = pembayaranTampil.filter(item => item.tanggal && item.tanggal < cutoffDate); const oldPerk = perkembanganTampil.filter(item => item.tanggal && item.tanggal < cutoffDate);
      if (oldTrans.length === 0 && oldPerk.length === 0) { setArchiveState({ show: false, forced: false, password: '', loading: false, months: 6 }); return setMessage(`Aman! Tidak ada data usang sebelum ${formatTanggal(cutoffDate)}.`) }
      if (oldTrans.length > 0) { const rowsT = oldTrans.map(item => [ item.tanggal, `"${item.siswa?.nama || '-'}"`, `"${item.keterangan || item.programs?.nama || '-'}"`, item.nominal, item.metode_bayar || 'cash', item.status || 'lunas' ].join(',')); const csvContentT = ['Tanggal,Siswa,Keterangan,Nominal,Metode,Status', ...rowsT].join('\n'); const blobT = new Blob([csvContentT], { type: 'text/csv;charset=utf-8;' }); downloadBlobFile(blobT, `Backup_Transaksi_${fileLabel}.csv`); }
      await new Promise(res => setTimeout(res, 500));
      if (oldPerk.length > 0) { const rowsP = oldPerk.map(item => [ item.tanggal, `"${item.siswa?.nama || '-'}"`, `"${item.users?.nama || '-'}"`, `"${(item.catatan || '').replace(/"/g, '""')}"` ].join(',')); const csvContentP = ['Tanggal,Siswa,Guru,Catatan', ...rowsP].join('\n'); const blobP = new Blob([csvContentP], { type: 'text/csv;charset=utf-8;' }); downloadBlobFile(blobP, `Backup_Perkembangan_${fileLabel}.csv`); }
      setMessage('Memproses penghapusan data dari sistem...')
      const delPromisesTrans = oldTrans.map(item => removeById('pembayaran', item.id)); const delPromisesPerk = oldPerk.map(item => removeById('perkembangan', item.id)); await Promise.all([...delPromisesTrans, ...delPromisesPerk])
      setMessage(`${oldTrans.length} Transaksi & ${oldPerk.length} Laporan Perkembangan (${bufferMonths} Bulan) berhasil dibersihkan!`)
      setArchiveState({ show: false, forced: false, password: '', loading: false, months: 6 }); await loadAllData()
    } catch (error) { const displayError = (error.message === 'Login gagal.' || error.message.includes('Invalid login')) ? 'Password Anda salah!' : error.message; setErrorMsg(displayError); setArchiveState(prev => ({ ...prev, loading: false })) }
  }

  function startEditTransaksi(item) { setEditTransaksiForm({ id: item.id, nominal: item.nominal, keterangan: item.keterangan || (item.programs ? item.programs.nama : ''), }) }
  async function submitEditTransaksi(event) { event.preventDefault(); try { const { error } = await updatePembayaran(editTransaksiForm.id, { nominal: Number(editTransaksiForm.nominal), keterangan: editTransaksiForm.keterangan }); if (error) throw error; setEditTransaksiForm(null); setMessage('Transaksi diupdate.'); await loadAllData() } catch (error) { setErrorMsg(error.message) } }
  async function submitPengeluaran(event) { event.preventDefault(); try { if (!pengeluaranForm.kategori || !pengeluaranForm.nominal) throw new Error('Kategori dan nominal wajib diisi.'); const payload = { tanggal: pengeluaranForm.tanggal, kategori: pengeluaranForm.kategori, keterangan: pengeluaranForm.keterangan, nominal: Number(pengeluaranForm.nominal), branch_id: pengeluaranForm.branch_id || null, user_id: user?.id }; let res; if (pengeluaranForm.id) { res = await updatePengeluaran(pengeluaranForm.id, payload) } else { res = await savePengeluaran(payload) } if (res.error) throw res.error; setPengeluaranForm(INITIAL_PENGELUARAN_FORM); setMessage('Pengeluaran disimpan.'); await loadAllData() } catch (error) { setErrorMsg(error.message) } }
  function startEditPengeluaran(item) { setPengeluaranForm({ id: item.id, tanggal: item.tanggal, kategori: item.kategori, keterangan: item.keterangan || '', nominal: item.nominal, branch_id: item.branch_id || '' }); setActiveTab('pengeluaran') }
  async function catatPengeluaranGaji(keterangan, nominal, branch_id) { try { const payload = { tanggal: TODAY(), kategori: 'Gaji Karyawan', keterangan, nominal: Number(nominal), branch_id: branch_id || null, user_id: user?.id }; const res = await savePengeluaran(payload); if (res.error) throw res.error; setMessage(`Slip gaji dibuat & Pengeluaran tercatat.`); await loadAllData() } catch (error) { setErrorMsg(error.message) } }
  async function submitInventory(event) { event.preventDefault(); try { const payload = { nama: inventoryForm.nama, harga: Number(inventoryForm.harga), stok: Number(inventoryForm.stok), branch_id: inventoryForm.branch_id || null }; const res = await upsertInventory(payload, inventoryForm.id); if (res.error) throw res.error; setInventoryForm(INITIAL_INVENTORY_FORM); setMessage('Barang disimpan.'); await loadAllData() } catch (error) { setErrorMsg(error.message) } }
  function startEditInventory(item) { setInventoryForm({ id: item.id, nama: item.nama, harga: item.harga, stok: item.stok, branch_id: item.branch_id || '' }); setActiveTab('inventory') }
  function printStudentBarcode(item) { const isAndroid = /Android/i.test(navigator.userAgent); if (isAndroid) { QRCode.toDataURL(item.kode_qr || item.id, { margin: 1, width: 300 }).then((url) => { const link = document.createElement('a'); link.href = url; link.download = `${item.nama}-barcode.png`; link.click(); alert('QR disimpan.') }); return } printBarcodeCard({ title: `Barcode ${item.nama}`, subtitle: `${item.branches?.nama || '-'} • ${item.kelas || ''}`, value: item.kode_qr || item.id }) }
  function buildStudentInfo(matched) { return { ...matched, nominal: matched.programs?.nominal || 0, guruNama: matched.users?.nama || '-', programNama: matched.programs?.nama || '-' } }




  async function submitPerkembangan(event, directData = null) { 
    if (event && event.preventDefault) event.preventDefault(); 
    try { 
      // 1. Terima data kiriman fisik (Quick Scan) ATAU data memori (Manual Form)
      const dataToProcess = directData || perkembanganForm;
      const payload = validatePerkembanganForm(dataToProcess); 

      const matched = siswaTampil.find((item) => item.id === payload.siswa_id); 
      if (!matched) throw new Error('Siswa tidak ditemukan.'); 

      const { guru_handle_id, ...cleanPayload } = payload; 
      
      // 2. Simpan ke database
      const res = await savePerkembangan({ 
        ...cleanPayload, 
        guru_id: user?.akses === 'guru' ? user.id : (dataToProcess.guru_handle_id || matched.guru_id || null),
        branch_id: matched.branch_id || selectedBranchId 
      }); 
      
      if (res.error) throw res.error; 
      
      // 3. Antrean WA
      if (!dataToProcess.id) {
          const nomorWAOrtu = matched.no_hp; 

          if (nomorWAOrtu) {
              const { error: errorWa } = await supabase
                  .from('wa_queue')
                  .insert([{ 
                      no_wa: nomorWAOrtu, 
                      pesan: dataToProcess.catatan,
                      status: 'pending'
                  }]);
                  
              if (errorWa) throw errorWa; 
          }
      }

      setPerkembanganForm((prev) => ({ 
        ...INITIAL_PERKEMBANGAN_FORM, 
        siswa_id: matched.id, 
        guru_handle_id: user?.akses === 'guru' ? user.id : (prev.guru_handle_id || matched.guru_id || ''), 
        tanggal: TODAY() 
      })); 
      
      setMessage('Laporan disimpan & masuk antrean WA!'); 
      await loadAllData();
    } catch (error) { 
      const pesanError = error.message || error.details || JSON.stringify(error);
      alert("⚠️ INFO: " + pesanError);
      setErrorMsg(pesanError);
    } 
  }
  async function prosesScanPerkembangan(decodedText) { 
    try { 
      const matched = siswaTampil.find((item) => item.kode_qr === decodedText || item.id === decodedText); 
      if (!matched) { 
        setSelectedProgressStudent(null); 
        setStudentScanInfo(`QR tidak dikenali`); 
        return; 
      } 
      
      // Update form tanpa panggil ensureStudentSession
      setPerkembanganForm((prev) => ({ 
        ...prev, 
        siswa_id: matched.id, 
        guru_handle_id: user?.akses === 'guru' ? user.id : (matched.guru_id || ''), 
        tanggal: prev.tanggal || TODAY() 
      })); 

      setSelectedProgressStudent(matched);
      setStudentScanInfo(`Siswa ${matched.nama} discan.`); 
      setMessage(`Sesi ${matched.nama} siap diinput.`); 
    } catch (error) { 
      setErrorMsg(error.message);
    } 
  }
  async function prosesScanSiswa(decodedText) { const matched = siswaTampil.find((item) => item.kode_qr === decodedText || item.id === decodedText); if (!matched) { setSelectedStudent(null); setStudentScanInfo(`QR tidak dikenali`); return } const info = buildStudentInfo(matched); setSelectedStudent(info); setKasirForm({ ...INITIAL_KASIR_FORM, cart: [] }); setStudentScanInfo(`Siswa: ${matched.nama}`) }
  async function selectProgressStudentById(id) { 
    try { 
      if (!id) { 
        setSelectedProgressStudent(null); 
        setPerkembanganForm((prev) => ({ ...prev, siswa_id: '' })); 
        return; 
      } 
      const matched = siswaTampil.find((item) => item.id === id); 
      if (!matched) return; 

      const guruHandleId = user?.akses === 'guru' ? user.id : (matched.guru_id || ''); 

      setPerkembanganForm((prev) => ({ 
        ...prev, 
        siswa_id: matched.id, 
        guru_handle_id: guruHandleId, 
        tanggal: prev.tanggal || TODAY() 
      })); 
      
      setSelectedProgressStudent(matched);
      setStudentScanInfo(`Sesi ${matched.nama} siap diinput.`); 
    } catch (error) { 
      setErrorMsg(error.message); 
    } 
  }
  function selectStudentById(id) { if (!id) return setSelectedStudent(null); const matched = siswaTampil.find((item) => item.id === id); if (!matched) return; const info = buildStudentInfo(matched); setSelectedStudent(info); setKasirForm({ ...INITIAL_KASIR_FORM, cart: [] }); setStudentScanInfo(`Siswa: ${matched.nama}`) }
  
  // === SUBMIT KASIR KERANJANG (CART) ===
  async function submitKasir(event) { 
    event.preventDefault(); 
    try { 
      if (!selectedStudent) throw new Error('Pilih siswa dulu.'); 
      const cart = kasirForm.cart || []; 
      if (cart.length === 0) throw new Error('Keranjang belanja masih kosong!'); 
      
      const subtotalCart = cart.reduce((sum, item) => sum + (item.harga * item.qty), 0); 
      
      let diskon = 0;
      if (kasirForm.diskon_tipe === 'persen') {
        diskon = subtotalCart * ((Number(kasirForm.diskon) || 0) / 100);
      } else {
        diskon = Number(kasirForm.diskon) || 0;
      }
      
      const totalBayar = Math.max(0, subtotalCart - diskon); 
      const nominalBayar = Number(kasirForm.nominal_bayar) || 0;

      if (kasirForm.status === 'lunas' && nominalBayar > 0 && nominalBayar < totalBayar) {
        throw new Error(`Uang yang dibayarkan kurang! Tagihan: ${formatRupiah(totalBayar)}`);
      }

      for (const item of cart) { 
        if (item.type === 'barang' && item.inventory_id) { 
          const invItem = inventoryTampil.find(i => i.id === item.inventory_id); 
          if (!invItem) throw new Error(`Barang ${item.nama} tidak ditemukan.`); 
          if (invItem.stok < item.qty) throw new Error(`Stok ${invItem.nama} tidak cukup.`); 
          await updateInventoryStock(invItem.id, invItem.stok - item.qty); 
        } 
      } 
      
      let details = cart.map(item => `${item.nama} (${item.qty}x)`).join(', '); 
      let finalKeterangan = details; 
      if (kasirForm.keterangan) finalKeterangan += ` | Catatan: ${kasirForm.keterangan}`; 
      
      const sppItem = cart.find(i => i.type === 'spp'); 
      const safeProgId = sppItem ? (selectedStudent.program_id || null) : null; 
      
      const res = await saveKasirTransaction({ 
        p_siswa_id: selectedStudent.id, 
        p_program_id: safeProgId, 
        p_kasir_id: user?.id, 
        p_tanggal: NOW_ISO(), 
        p_nominal: totalBayar, 
        p_status: kasirForm.status, 
        p_metode_bayar: kasirForm.metode_bayar, 
        p_keterangan: finalKeterangan 
      }); 
      if (res.error) throw res.error; 
      
      if (kasirForm.status === 'lunas') { 
        setLastReceipt({ 
          nama: selectedStudent.nama, 
          no_hp: selectedStudent.no_hp, 
          // --- KODE CABANG DIPERBAIKI DI SINI ---
          cabang: selectedStudent.branches?.nama || selectedBranch?.nama || 'Pusat', 
          cart: [...cart], 
          nominal: totalBayar, 
          subtotal: subtotalCart, 
          diskon: diskon, 
          nominal_bayar: nominalBayar,
          kembalian: nominalBayar > 0 ? nominalBayar - totalBayar : 0,
          metode_bayar: kasirForm.metode_bayar, 
          status: kasirForm.status 
        }); 
        setShowReceiptPopup(true); 
      }
      
      setMessage('Transaksi berhasil disimpan.'); 
      setSelectedStudent(null); 
      setKasirForm({ status: 'lunas', nominal: '', diskon: '', diskon_tipe: 'nominal', nominal_bayar: '', keterangan: '', metode_bayar: 'cash', program_id: '', jenis_transaksi: 'program', inventory_id: '', cart: [] }); 
      setStudentScanText(''); 
      setStudentScanInfo('Belum scan.'); 
      await loadAllData(); 
    } catch (error) { setErrorMsg(error.message) } 
  }
  
  async function submitStudentAttendance(event) { event.preventDefault(); try { const payload = validateStudentAttendanceForm(studentAttendanceForm); const res = await saveStudentAttendance({ p_siswa_id: payload.siswa_id, p_guru_handle_id: payload.guru_handle_id, p_tanggal: payload.tanggal, p_mode: payload.mode, p_status: payload.status, p_catatan: payload.catatan, p_sumber: 'manual' }); if (res.error) throw res.error; setStudentAttendanceForm(INITIAL_STUDENT_ATTENDANCE_FORM); setMessage('Absensi siswa disimpan.'); await loadAllData() } catch (error) { setErrorMsg(error.message) } }
    async function submitEmployeeManualAttendance(event) { 
    event.preventDefault(); 
    try { 
      const payload = validateEmployeeManualForm(employeeManualForm); 

      // --- FUNGSI PEMBERSIH JAM (Agar hanya HH:MM yang dikirim) ---
      const cleanTime = (val) => {
        if (!val) return null;
        // Jika formatnya ISO (ada huruf T), ambil jam setelah huruf T
        if (typeof val === 'string' && val.includes('T')) {
          return val.split('T')[1].substring(0, 5);
        }
        // Jika format jam murni, ambil 5 karakter pertama (HH:MM)
        return String(val).substring(0, 5);
      };

      const res = await saveEmployeeManualAttendance({ 
        p_user_id: payload.user_id, 
        p_tanggal: payload.tanggal, 
        p_status: payload.status, 
        // Kita bersihkan dulu jamnya di sini ✨
        p_jam_datang: cleanTime(payload.jam_datang), 
        p_jam_pulang: cleanTime(payload.jam_pulang), 
        p_catatan: payload.catatan 
      }); 

      if (res.error) throw res.error; 
      
      setEmployeeManualForm(INITIAL_EMPLOYEE_MANUAL_FORM); 
      setMessage('✅ Absensi manual berhasil disimpan!'); 
      await loadAllData();
    } catch (error) { 
      // Munculkan error di alert agar Mbak Evi bisa langsung lihat jika gagal
      alert("Gagal simpan manual: " + error.message);
      setErrorMsg(error.message);
    } 
  }

  
  function buildReceiptHtml(data, withAutoPrint = true) { 
    // === SABUK PENGAMAN ANTI CRASH ===
    if (!data) return ''; 

    const cartHtml = (data.cart || []).map(c => `<div class="row"><span>${c.nama} (${c.qty}x)</span><span>${formatRupiah(c.harga * c.qty)}</span></div>`).join('');
    const diskonHtml = (data.diskon && data.diskon > 0) ? `<div class="row" style="margin-top:5px; border-top:1px dashed #ddd; padding-top:5px"><span class="label">Subtotal:</span><span>${formatRupiah(data.subtotal || 0)}</span></div><div class="row"><span class="label">Diskon:</span><span>-${formatRupiah(data.diskon)}</span></div>` : '';
    
    let bayarHtml = '';
    if (data.nominal_bayar && data.nominal_bayar > 0) {
      bayarHtml = `<div class="line"></div><div class="row"><span class="label">Tunai Bayar:</span><span>${formatRupiah(data.nominal_bayar)}</span></div><div class="row"><span class="label">Kembalian:</span><span>${formatRupiah(data.kembalian || 0)}</span></div>`;
    }

    return `<!doctype html><html><head><meta charset="utf-8"><title>Bukti Bayar</title><meta name="viewport" content="width=device-width, initial-scale=1" /><style>body{font-family:Arial,sans-serif;width:72mm;margin:0 auto;padding:8px;color:#000;background:#fff}.receipt{text-align:left;font-size:12px;line-height:1.4}.center{text-align:center}.line{border-top:1px dashed #000;margin:8px 0}.row{display:flex;justify-content:space-between;gap:8px}.label{font-weight:bold}.big{font-size:16px;font-weight:bold}.help{margin-top:12px;font-size:11px;color:#374151;background:#f8fafc;padding:8px;border-radius:8px}@media print{body{width:72mm}}</style></head><body ${withAutoPrint ? 'onload=\"window.print();window.close()\"' : ''}><div class=\"receipt\"><div class=\"center big\">BIMBEL TOP PANGKALAN</div><div class=\"center\">Cabang: ${data.cabang || 'Pusat'}</div><div class=\"line\"></div><div class=\"center\">Bukti Pembayaran</div><div class=\"line\"></div><div><span class=\"label\">Tanggal:</span> ${new Date().toLocaleString('id-ID')}</div><div><span class=\"label\">Nama siswa:</span> ${data.nama || '-'}</div><div><span class=\"label\">Metode bayar:</span> ${(data.metode_bayar || 'cash').toUpperCase()}</div><div><span class=\"label\">Status:</span> ${(data.status || 'LUNAS').toUpperCase()}</div><div class=\"line\"></div><div class=\"center\" style=\"margin-bottom:8px\"><b>Rincian Pembelian:</b></div>${cartHtml}${diskonHtml}<div class=\"line\"></div><div class=\"row\"><span class=\"label\">Total Tagihan:</span><span class=\"big\">${formatRupiah(data.nominal || 0)}</span></div>${bayarHtml}<div class=\"line\"></div><div class=\"center\">Terima kasih</div>${withAutoPrint ? '' : '<div class=\"help\"><b>Cara print di Android:</b><br/>1. Buka menu browser<br/>2. Pilih Share atau bagikan ke aplikasi printer bluetooth<br/>3. Jika aplikasi printer mendukung print halaman web/teks, gunakan halaman ini sebagai sumber cetak.</div>'}</div></body></html>` 
  }
  function printThermalReceiptDesktop(receipt) { const data = receipt || lastReceipt; if (!data) return setErrorMsg('Belum ada pembayaran.'); const w = window.open('', '_blank', 'width=420,height=700'); if (!w) return setErrorMsg('Popup diblokir.'); w.document.write(buildReceiptHtml(data, true)); w.document.close() }
  function printThermalReceiptAndroid(receipt) { const data = receipt || lastReceipt; if (!data) return setErrorMsg('Belum ada pembayaran.'); const w = window.open('', '_blank'); if (!w) return setErrorMsg('Popup diblokir.'); w.document.write(buildReceiptHtml(data, false)); w.document.close() }
  function openSmartWA(phone, text) { if (!phone) { alert('Maaf, nomor HP belum tersimpan di sistem.'); return; } let formattedPhone = phone.startsWith('0') ? '62' + phone.substring(1) : phone; formattedPhone = formattedPhone.replace(/\D/g, ''); const encodedText = encodeURIComponent(text); const waLink = `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodedText}`; window.open(waLink, '_blank'); }
  function sendThermalReceiptWA() { 
    const data = lastReceipt; 
    
    // === SABUK PENGAMAN ANTI CRASH ===
    if (!data) return; 
    
    let text = `*BIMBEL TOP PANGKALAN*\nCabang: ${data.cabang || 'Pusat'}\n-----------------------------------\n*BUKTI PEMBAYARAN*\n\nTanggal: ${new Date().toLocaleString('id-ID')}\nNama Siswa: ${data.nama || '-'}\nMetode Bayar: ${(data.metode_bayar || 'cash').toUpperCase()}\nStatus: ${(data.status || 'LUNAS').toUpperCase()}\n\n*Rincian Pembelian:*\n`; 
    
    (data.cart || []).forEach(c => { 
      text += `- ${c.nama} (${c.qty}x): ${formatRupiah(c.harga * c.qty)}\n`; 
    }); 
    
    if (data.diskon && data.diskon > 0) { 
      text += `\nSubtotal: ${formatRupiah(data.subtotal || 0)}\nDiskon: -${formatRupiah(data.diskon)}\n`; 
    } 
    
    text += `\n*Total Tagihan: ${formatRupiah(data.nominal || 0)}*\n\nTerima kasih atas kepercayaannya.`; 
    
    if (typeof openSmartWA === 'function') {
      openSmartWA(data.no_hp || '', text); 
    }
  }
  function sendPerkembanganWA(item) { if (!item) return; let text = `Halo Ayah/Bunda,\nBerikut adalah laporan perkembangan dan kehadiran ananda *${item.siswa?.nama || '-'}* pada ${formatTanggal(item.tanggal)}:\n\n*Catatan Guru:*\n${item.catatan || 'Hadir mengikuti sesi pembelajaran dengan baik.'}\n\nSalam hangat,\nAdmin ${item.siswa?.branches?.nama || 'Bimbel TOP PANGKALAN'}`; openSmartWA(item.siswa?.no_hp, text); }  
  async function prosesScanKaryawan(decodedText) { 
    try { 
      const validCode = employeeMode === 'datang' ? employeeBarcodeIn : employeeBarcodeOut; 
      if (decodedText !== validCode) { 
        setEmployeeScanInfo(`Barcode ${employeeMode} tidak dikenali.`); 
        return; 
      } 
      
      // === KUNCI JAWABAN: Menerjemahkan bahasa aplikasi ke bahasa database ===
      const dbMode = employeeMode === 'datang' ? 'in' : 'out';

      const res = await saveEmployeeAttendance({ 
        p_user_id: user?.id, 
        p_tanggal: TODAY(), 
        p_mode: dbMode 
      }); 
      
      if (res.error) throw res.error; 

      // === MENCEGAH NOTIFIKASI PALSU ===
      if (res.data && res.data.success === false) {
        throw new Error(res.data.message);
      }

      setEmployeeScanInfo(`Scan ${employeeMode} berhasil untuk ${user?.nama}.`); 
      setMessage(res.data?.message || `Absensi ${employeeMode} disimpan.`); 
      await loadAllData();
    } catch (error) { 
      setErrorMsg(error.message);
    } 
  }

  async function submitBonus(event) { event.preventDefault(); try { const targetUser = usersTampil.find((item) => item.id === bonusForm.user_id); const res = await saveBonus({ user_id: bonusForm.user_id, branch_id: targetUser?.branch_id || null, bonus_date: bonusForm.bonus_date, amount: bonusForm.amount, description: bonusForm.description, created_by: user?.id || null }); if (res.error) throw res.error; setBonusForm(INITIAL_BONUS_FORM); setMessage('Bonus disimpan.'); await loadAllData() } catch (error) { setErrorMsg(error.message) } }
  function addReviewItem() { setReviewForm((prev) => ({ ...prev, items: [...prev.items, { title: '', score: '8', note: '' }] })) }
  function changeReviewItem(index, field, value) { setReviewForm((prev) => ({ ...prev, items: prev.items.map((item, i) => i === index ? { ...item, [field]: value } : item) })) }
  function removeReviewItem(index) { setReviewForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) })) }
  async function submitReview(event) { event.preventDefault(); try { const res = await saveReview({ ...validateReviewForm(reviewForm), reviewer_id: user?.id || null }); if (res.error) throw res.error; setReviewForm(INITIAL_REVIEW_FORM); setMessage('Review disimpan.'); await loadAllData() } catch (error) { setErrorMsg(error.message) } }
  function printEmployeeReview(review) { const avg = review.items?.length ? (review.items.reduce((sum, item) => sum + Number(item.score || 0), 0) / review.items.length).toFixed(1) : '0.0'; const rows = (review.items || []).map((item, index) => `<tr><td>${index + 1}</td><td>${item.title}</td><td style=\"text-align:center\">${item.score}</td><td>${item.note || '-'}</td></tr>`).join(''); const html = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Penilaian Karyawan</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#0f172a}h1,h2,p{margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #cbd5e1;padding:10px;font-size:12px;text-align:left}th{background:#f8fafc}.header{display:flex;justify-content:space-between;align-items:flex-start}.muted{color:#475569}.badge{display:inline-block;border:1px solid #cbd5e1;padding:4px 8px;border-radius:999px}.footer{margin-top:24px;font-size:12px;color:#475569}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:20px}.card{border:1px solid #e2e8f0;border-radius:16px;padding:14px;background:#fff}</style></head><body onload=\"window.print()\"><div class=\"header\"><div><h1>Form Penilaian Karyawan</h1><p class=\"muted\">Periode ${formatMonthYear(review.period_month, review.period_year)}</p></div><div class=\"badge\">Rata-rata ${avg}</div></div><div class=\"summary\"><div class=\"card\"><b>Nama Karyawan</b><div>${review.user?.nama || '-'}</div></div><div class=\"card\"><b>Cabang</b><div>${review.user?.branch_nama || '-'}</div></div><div class=\"card\"><b>Dinilai oleh</b><div>${review.reviewer?.nama || '-'}</div></div></div><table><thead><tr><th>No</th><th>Poin Penilaian</th><th>Nilai</th><th>Catatan</th></tr></thead><tbody>${rows}</tbody></table><div class=\"footer\"><b>Catatan Umum:</b><br />${review.notes || '-'}</div></body></html>`; const w = window.open('', '_blank', 'width=960,height=720'); if (!w) return setErrorMsg('Popup diblokir.'); w.document.write(html); w.document.close() }
  function togglePermissionDraft(menuKey) { setPermissionDraft((prev) => prev.includes(menuKey) ? prev.filter((item) => item !== menuKey) : [...prev, menuKey]) }
  function selectAllPermissions() { setPermissionDraft(visibleTabs.length ? Array.from(new Set([...permissionDraft, ...visibleTabs])) : permissionDraft) }
  function resetPermissionDraft(nextPermissions = []) { setPermissionDraft(nextPermissions) }
  async function savePermissions() { try { if (!permissionUserId) throw new Error('Pilih user.'); const res = await saveUserPermissions(permissionUserId, permissionDraft); if (res.error) throw res.error; if (user?.id === permissionUserId) { const updated = { ...user, menu_permissions: permissionDraft }; setUser(updated); saveSession(updated) } setMessage('Hak akses disimpan.'); await loadAllData() } catch (error) { setErrorMsg(error.message) } }
  function startEditBranch(item) {
    setBranchForm({
      id: item.id,
      nama: item.nama,
      kode: item.kode,
      alamat: item.alamat || '',
      employee_barcode_in: item.employee_barcode_in || EMPLOYEE_GLOBAL_IN,
      employee_barcode_out: item.employee_barcode_out || EMPLOYEE_GLOBAL_OUT,
      link_grup: item.link_grup || '',
      qris_image_url: item.qris_image_url || item.payment_qris_url || '',
      payment_qris_url: item.payment_qris_url || item.qris_image_url || '',
      qris_merchant_name: item.qris_merchant_name || '',
      bank_name: item.bank_name || '',
      bank_account_number: item.bank_account_number || item.no_rekening || '',
      bank_account_name: item.bank_account_name || item.atas_nama || '',
      payment_whatsapp: item.payment_whatsapp || item.no_wa_admin || '',
      payment_note: item.payment_note || '',
    });
    setActiveTab('cabang')
  }
  function startEditProgram(item) { setProgramForm({ id: item.id, nama: item.nama, deskripsi: item.deskripsi || '', nominal: item.nominal || '' }); setActiveTab('program') }
  function startEditUser(item) { 
    setUserForm({ 
      ...item, 
      password: '', 
      // Kita perbaiki logikanya: Jika availability kosong/null, gunakan INITIAL_AVAILABILITY
      availability: (item.availability && item.availability.length > 0) 
        ? item.availability 
        : INITIAL_AVAILABILITY, 
      programs_can_handle: item.programs_can_handle || []
    }); 
    setActiveTab('users');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function startEditSiswa(item) { 
    setSiswaForm({ 
      id: item.id, 
      nama: item.nama || '', 
      branch_id: item.branch_id || '', 
      program_id: item.program_id || '', 
      kelas: item.kelas || '', 
      nama_ortu: item.nama_ortu || '', 
      no_hp: item.no_hp || '', 
      alamat: item.alamat || '', 
      kode_qr: item.kode_qr || '', 
      guru_id: item.guru_id || '',
      // TAMBAHKAN 2 BARIS INI:
      hari: item.hari || '',
      jam_mulai: item.jam_mulai || '14:00',
      sesi_awal: item.sesi_awal || 0 // <--- TAMBAHKAN INI
    }); 
    setActiveTab('siswa');
    window.scrollTo({ top: 0, behavior: 'smooth' }); // Opsional: Scroll ke atas agar form terlihat
  }
  function setQuickExportRange(mode) { const today = TODAY(); if (mode === 'today') { setExportDateFrom(today); setExportDateTo(today); return } if (mode === 'week') { const now = new Date(); const day = now.getDay() || 7; now.setDate(now.getDate() - (day - 1)); setExportDateFrom(now.toISOString().slice(0, 10)); setExportDateTo(today); return } if (mode === 'month') { const now = new Date(); now.setDate(1); setExportDateFrom(now.toISOString().slice(0, 10)); setExportDateTo(today); return } setExportDateFrom(''); setExportDateTo('') }
  function handleDownload() { const rows = exportRows({ exportType, branches, siswa: siswaTampil, users: usersTampil, programs, pembayaran: pembayaranTampil, absensiSiswa: absensiSiswaTampil, absensiKaryawan: absensiKaryawanTampil, perkembangan: perkembanganTampil, payrollRows, dateFrom: exportDateFrom, dateTo: exportDateTo }); if (!rows.length) return setErrorMsg('Tidak ada data.'); downloadCsv(exportType, rows); setMessage(`Data ${exportType} didownload.`) }
// === FUNGSI KIRIM PENGINGAT MANUAL (JADWAL & TAGIHAN) ===
  function sendManualReminderWA(item, jenis, infoBayar = null) {
    if (!item.no_hp) return alert('Maaf, nomor HP siswa belum tersimpan.');

    let text = "";
    if (jenis === 'TAGIHAN') {
      text = `*PENGINGAT PEMBAYARAN BIMBEL TOP PANGKALAN* 💳\n\nHalo Ayah/Bunda,\nMengingatkan untuk administrasi ananda *${item.nama}* program *${item.programs?.nama}* sudah memasuki masa pembayaran (${infoBayar.info}).\n\nNominal: *${formatRupiah(item.programs?.nominal || 0)}*\n\nMohon kerjasamanya untuk kelancaran kegiatan belajar mengajar. Terima kasih! 🙏`;
    } else {
      const jamTarget = item.jam_mulai || '-';
      const programTarget = item.programs?.nama || '-';
      text = `*PENGINGAT JADWAL BIMBEL TOP PANGKALAN* 📚\n\nHalo Ayah/Bunda,\nMengingatkan jadwal ananda *${item.nama}* hari ini jam *${jamTarget}*.\n\nProgram: *${programTarget}*\n\nSampai jumpa di kelas! 🙏`;
    }
    openSmartWA(item.no_hp, text);
  }
  // === 1. FUNGSI WA DITARUH DI SINI (SEBELUM RETURN) ===
  const sendHistoryTransactionWA = (item) => {
    if (!item.siswa?.no_hp) {
      alert('Nomor HP siswa tidak ditemukan.');
      return;
    }

    const tgl = item.tanggal ? new Date(item.tanggal).toLocaleString('id-ID') : '-';
    const nominal = formatRupiah(item.nominal);
    const ket = item.keterangan || item.programs?.nama || '-';
    
    const text = `*BIMBEL TOP PANGKALAN - BUKTI TRANSAKSI*\n\n` +
                 `Tanggal: ${tgl}\n` +
                 `Siswa: ${item.siswa?.nama || '-'}\n` +
                 `Keterangan: ${ket}\n` +
                 `Total Bayar: *${nominal}*\n` +
                 `Metode: ${(item.metode_bayar || 'cash').toUpperCase()}\n` +
                 `Status: LUNAS\n\n` +
                 `Terima kasih sudah melakukan pembayaran.`;

    // Langsung pakai fungsi openSmartWA
    openSmartWA(item.siswa.no_hp, text);
  };

  // === 2. INI RETURN UTAMA (CUMA ADA SATU DI PALING BAWAH) ===
  return {
    state: {
      user, email, password, loginError, loadingLogin, activeTab, message, errorMsg, loadingData, branches, programs, users, siswa, pembayaran, absensiSiswa, perkembangan, absensiKaryawan, bonusManual, reviews, pengeluaranTampil, inventoryTampil, branchForm, programForm, userForm, siswaForm, perkembanganForm, kasirForm, bonusForm, employeeManualForm, studentAttendanceForm, reviewForm, pengeluaranForm, inventoryForm, permissionUserId, permissionDraft, scanStudentActive, scanEmployeeActive, employeeMode, studentScanText, employeeScanText, studentScanInfo, employeeScanInfo, selectedStudent, selectedProgressStudent, exportType, exportDateFrom, exportDateTo, lastReceipt, selectedBranchId, selectedBranch, canAccessAllBranches, employeeBarcodeIn, employeeBarcodeOut, progressInputMode, guruOptions, visibleTabs, usersTampil, siswaTampil, pembayaranTampil, perkembanganTampil, perkembanganHistory, absensiKaryawanTampil, bonusManualTampil, absensiSiswaTampil, reviewsTampil, overview, financeSummary, payrollRows, stats, searchSiswa, searchTransaksi, payrollMonth, payrollYear, showReceiptPopup, editTransaksiForm, deleteConfirm, archiveState
    },
    actions: {
      sendManualReminderWA, // <--- TAMBAHKAN INI DI SINI
      sendHistoryTransactionWA, // <--- NAMA FUNGSI SUDAH DIDAFTARKAN DI SINI DENGAN BENAR
      setUser, setEmail, setPassword, setActiveTab, setMessage, setErrorMsg, setSelectedBranchId, setBranchForm, setProgramForm, setUserForm, setSiswaForm, setPerkembanganForm, setKasirForm, setBonusForm, setEmployeeManualForm, setStudentAttendanceForm, setReviewForm, setPengeluaranForm, setInventoryForm, setPermissionUserId, setPermissionDraft, setScanStudentActive, setScanEmployeeActive, setEmployeeMode, setExportType, setExportDateFrom, setExportDateTo, setProgressInputMode, setPayrollMonth, setPayrollYear, setShowReceiptPopup, setEditTransaksiForm, submitEditTransaksi, login, loginDenganBarcodeSiswa, logout, loadAllData, setDeleteConfirm, confirmDelete, submitBranch, deleteBranch, submitProgram, deleteProgram, submitUser, deleteUser, submitSiswa, deleteSiswa, submitPengeluaran, deletePengeluaran, submitInventory, deleteInventory,
      deleteBonus: (id, label) => setDeleteConfirm({ show: true, table: 'employee_bonus', id, label }),
      deletePerkembangan: (id, label) => setDeleteConfirm({ show: true, table: 'perkembangan', id, label: `materi ${label}` }),
      submitPerkembangan, submitKasir, submitBonus, submitEmployeeManualAttendance, submitStudentAttendance, submitReview, prosesScanSiswa, prosesScanPerkembangan, prosesScanKaryawan, startEditBranch, startEditProgram, startEditUser, startEditSiswa, startEditPengeluaran, startEditInventory, handleDownload, printThermalReceiptDesktop, printThermalReceiptAndroid, selectStudentById, selectProgressStudentById, generateStudentBarcodeAction, printStudentBarcode, addReviewItem, changeReviewItem, removeReviewItem, printEmployeeReview, togglePermissionDraft, savePermissions, selectAllPermissions, resetPermissionDraft, setQuickExportRange, setSearchSiswa, setSearchTransaksi, deleteTransaksi, catatPengeluaranGaji, sendThermalReceiptWA, sendPerkembanganWA, openSmartWA, startEditTransaksi, setArchiveState, triggerManualArchive, executeArchive
    },
  }
}
