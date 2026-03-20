import { utils } from './utils.js';
import { logic } from './logic.js';
import { firebaseService } from './firebase-service.js';
import { i18n } from './i18n.js';

let localBookings = [];
let historyBookings = [];
let deleteId = null;
let isAdmin = false;
let adminViewMode = 'active';
let brokenMachines = {};

export const ui = {
    currentDate: new Date().toISOString().split('T')[0],

    init() {
        this.setupEventListeners();

        // AUTO-FILL
        const savedName = localStorage.getItem('studentName');
        const savedPhone = localStorage.getItem('studentPhone');
        if (savedName) { const n = document.getElementById('userName'); if (n) n.value = savedName; }
        if (savedPhone && savedPhone !== '-') { const p = document.getElementById('phoneNumber'); if (p) p.value = savedPhone; }

        if (firebaseService.auth) this.setupAuthListener();

        setTimeout(() => {
            const loader = document.getElementById('appLoader');
            if (loader && loader.style.display !== 'none') {
                const text = document.getElementById('loaderText');
                if (text) text.textContent = i18n.t("connection_takes_long");
                const btn = document.getElementById('reloadBtn');
                if (btn) { btn.style.display = 'inline-block'; btn.onclick = () => window.location.reload(); }
            }
        }, 5000);

        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-mode');
            const icon = document.querySelector('#themeToggleBtn i');
            if (icon) icon.className = 'fa-solid fa-sun';
        }

        const dateInput = document.getElementById('bookingDate');
        const today = new Date().toISOString().split('T')[0];
        const maxDate = utils.addDays(today, 14);
        dateInput.min = today;
        dateInput.max = maxDate;
        dateInput.value = this.currentDate;
        this.updateDateDisplay();
        this.startMidnightWatcher();

        // Countdown every second
        this.updateMachineStatus();
        setInterval(() => this.updateMachineStatus(), 1000);

        // Firebase bookings listener
        const d = new Date(); d.setDate(d.getDate() - 1);
        const yesterday = d.toISOString().split('T')[0];
        const q = firebaseService.query(
            firebaseService.bookingsCollection,
            firebaseService.where("date", ">=", yesterday),
            firebaseService.orderBy("date"),
            firebaseService.orderBy("startTime")
        );
        firebaseService.onSnapshot(q, (snapshot) => {
            localBookings = [];
            snapshot.docs.forEach(doc => localBookings.push({ ...doc.data(), id: doc.id }));
            const loader = document.getElementById('appLoader');
            if (loader) { loader.style.opacity = '0'; setTimeout(() => loader.style.display = 'none', 500); }
            this.renderAll();
        }, (error) => {
            console.error("Firebase error:", error);
            const qF = firebaseService.query(firebaseService.bookingsCollection, firebaseService.where("date", ">=", yesterday), firebaseService.orderBy("date"));
            firebaseService.onSnapshot(qF, (snap) => {
                localBookings = [];
                snap.docs.forEach(doc => localBookings.push({ ...doc.data(), id: doc.id }));
                this.renderAll();
                const loader = document.getElementById('appLoader');
                if (loader) { loader.style.opacity = '0'; setTimeout(() => loader.style.display = 'none', 500); }
            });
        });

        // Maintenance + broken machines listener
        firebaseService.onSnapshot(firebaseService.doc(firebaseService.db, "settings", "appState"), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                const maintenanceMode = data.maintenance || false;
                brokenMachines = data.brokenMachines || {};
                const toggle = document.getElementById('maintenanceToggle');
                if (toggle) toggle.checked = maintenanceMode;
                const overlay = document.getElementById('maintenanceOverlay');
                if (maintenanceMode && !isAdmin) overlay.style.display = 'flex';
                else overlay.style.display = 'none';
                this.updateBrokenMachineVisuals();
                this.renderSchedule(); // re-render orar cu starea corectă a mașinilor
                this.updateMachineStatus();
            }
        });

    },

    // ─── BROKEN MACHINES ──────────────────────────────────────────────────────
    updateBrokenMachineVisuals() {
        Object.keys(logic.machines).forEach(key => {
            const card = document.querySelector(`.selector-card[data-value="${key}"]`);
            if (card) card.classList.toggle('broken', !!brokenMachines[key]);
        });
    },

    async toggleBrokenMachine(machineKey) {
        if (!firebaseService.auth || !firebaseService.auth.currentUser) return;
        const newBroken = { ...brokenMachines, [machineKey]: !brokenMachines[machineKey] };
        try {
            await firebaseService.setDoc(firebaseService.doc(firebaseService.db, "settings", "appState"), { brokenMachines: newBroken }, { merge: true });
            utils.showToast(newBroken[machineKey] ? i18n.t('broken_on_toast') : i18n.t('broken_off_toast'));
        } catch (e) { console.error(e); utils.showToast(i18n.t("error_generic"), "error"); }
    },

    startMidnightWatcher() {
        setInterval(() => {
            const realToday = new Date().toISOString().split('T')[0];
            const dateInput = document.getElementById('bookingDate');
            if (dateInput.min !== realToday) {
                dateInput.min = realToday;
                dateInput.max = utils.addDays(realToday, 14);
                if (this.currentDate < realToday) {
                    this.currentDate = realToday; dateInput.value = realToday;
                    this.updateDateDisplay(); this.renderAll();
                    utils.showToast(i18n.t("new_day_calendar_updated"));
                }
            }
        }, 60000);
    },

    applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.getAttribute('data-i18n'); if (i18n.t(k)) el.textContent = i18n.t(k); });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { const k = el.getAttribute('data-i18n-placeholder'); if (i18n.t(k)) el.setAttribute('placeholder', i18n.t(k)); });
        document.querySelectorAll('[data-i18n-title]').forEach(el => { const k = el.getAttribute('data-i18n-title'); if (i18n.t(k)) el.setAttribute('title', i18n.t(k)); });
    },

    // ─── LIVE MACHINE STATUS (every second) ───────────────────────────────────
    updateMachineStatus() {
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();
        const currentSecs = now.getSeconds();
        Object.keys(logic.machines).forEach(machineKey => {
            const statusEl = document.getElementById(`status-${machineKey}`);
            const card = document.querySelector(`.selector-card[data-value="${machineKey}"]`);
            if (!statusEl) return;
            if (brokenMachines[machineKey]) {
                statusEl.textContent = i18n.t('broken');
                statusEl.className = 'live-status broken';
                if (card) card.classList.remove('card-free');
                return;
            }
            const active = localBookings.find(b => {
                if (b.machineType !== machineKey || b.date !== today) return false;
                const sm = utils.timeToMins(b.startTime), em = sm + parseInt(b.duration);
                return currentMins >= sm && currentMins < em;
            });
            if (active) {
                const startMins = utils.timeToMins(active.startTime);
                const endMins = startMins + parseInt(active.duration);
                const totalSecsRaw = (endMins - currentMins) * 60 - currentSecs;
                const totalSecs = Math.max(0, totalSecsRaw);
                const mL = Math.floor(totalSecs / 60), sL = totalSecs % 60;
                const elapsed = currentMins - startMins;
                const progressPct = Math.min(100, Math.round((elapsed / parseInt(active.duration)) * 100));
                statusEl.className = 'live-status busy';
                statusEl.innerHTML = `<span class="busy-text">${i18n.t("busy")} – ${i18n.t("busy_remaining")} ${mL}:${sL.toString().padStart(2, '0')}</span><div class="status-progress-track"><div class="status-progress-fill" style="width:${progressPct}%"></div></div>`;
                if (card) card.classList.remove('card-free');
            } else {
                statusEl.textContent = i18n.t("free");
                statusEl.className = 'live-status free';
                if (card) card.classList.add('card-free');
            }
        });
    },

    // ─── EVENT LISTENERS ──────────────────────────────────────────────────────
    setupEventListeners() {
        document.getElementById('bookingForm').addEventListener('submit', this.handleBooking.bind(this));
        document.getElementById('prevDay').onclick = () => this.changeDate(-1);
        document.getElementById('nextDay').onclick = () => this.changeDate(1);

        const timeInput = document.getElementById('startTime');
        if (timeInput) {
            timeInput.addEventListener('change', () => {
                const machine = document.getElementById('machineType').value;
                const date = document.getElementById('bookingDate').value;
                const start = timeInput.value;
                const duration = document.getElementById('duration').value;
                if (machine && date && start) {
                    const ok = logic.isSlotFree(machine, date, start, duration, localBookings);
                    timeInput.style.borderColor = ok ? 'var(--success)' : 'var(--danger)';
                    if (!ok) utils.showToast(i18n.t("overlap_warning"), 'error');
                }
            });
        }

        document.getElementById('bookingDate').onchange = (e) => { this.currentDate = e.target.value; this.updateDateDisplay(); this.renderAll(); };
        document.getElementById('machineType').onchange = () => { document.getElementById('startTime').style.borderColor = 'var(--border)'; };

        const phoneInput = document.getElementById('phoneNumber');
        if (phoneInput) {
            phoneInput.addEventListener('input', () => {
                const raw = phoneInput.value.replace(/\D/g, '');
                phoneInput.value = raw.slice(0, 10);
                if (!raw.length) phoneInput.style.borderColor = '';
                else if (raw.length === 10 && raw.startsWith('07')) phoneInput.style.borderColor = 'var(--success)';
                else phoneInput.style.borderColor = raw.length >= 2 && !raw.startsWith('07') ? 'var(--danger)' : '';
            });
            phoneInput.addEventListener('blur', () => { if (!phoneInput.value) phoneInput.style.borderColor = ''; });
        }

        const skipCheck = document.getElementById('skipPhone');
        if (skipCheck && phoneInput) {
            skipCheck.addEventListener('change', () => {
                if (skipCheck.checked) { phoneInput.value = ''; phoneInput.disabled = true; phoneInput.style.borderColor = ''; phoneInput.placeholder = i18n.t("not_required"); }
                else { phoneInput.disabled = false; phoneInput.placeholder = i18n.t("phone_placeholder"); }
            });
        }

        document.querySelectorAll('.selector-card').forEach(card => {
            card.onclick = () => {
                document.querySelectorAll('.selector-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                const select = document.getElementById('machineType');
                select.value = card.dataset.value;
                select.dispatchEvent(new Event('change'));
            };
        });

        document.getElementById('userName').oninput = () => this.renderMyBookings();

        document.getElementById('myBookings').addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-delete');
            if (btn?.dataset.deleteId) this.requestDelete(btn.dataset.deleteId);
        });

        document.getElementById('adminContent').addEventListener('click', (e) => {
            const del = e.target.closest('.btn-delete-vip');
            if (del?.dataset.deleteId) this.confirmDelete(del.dataset.deleteId);
            const broken = e.target.closest('.broken-toggle');
            if (broken?.dataset.machine) this.toggleBrokenMachine(broken.dataset.machine);
        });

        document.querySelectorAll('.modal-close').forEach(btn => btn.onclick = () => {
            ['modalOverlay','confirmModal','adminModal','deletePinModal','successModal'].forEach(id => {
                const el = document.getElementById(id); if (el) el.style.display = 'none';
            });
        });

        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'modalOverlay') {
                ['modalOverlay','phoneModal','confirmModal','deletePinModal','successModal'].forEach(id => {
                    const el = document.getElementById(id); if (el) el.style.display = 'none';
                });
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const overlay = document.getElementById('modalOverlay');
                if (overlay && overlay.style.display !== 'none') {
                    ['modalOverlay','phoneModal','confirmModal','deletePinModal','successModal'].forEach(id => {
                        const el = document.getElementById(id); if (el) el.style.display = 'none';
                    });
                }
            }
        });

        const successClose = document.getElementById('successModalCloseBtn');
        if (successClose) successClose.onclick = () => { document.getElementById('successModal').style.display = 'none'; document.getElementById('modalOverlay').style.display = 'none'; };

        const reqDelBtn = document.getElementById('requestDeleteBtn');
        if (reqDelBtn) reqDelBtn.onclick = () => this.requestDelete();
        const confirmPinBtn = document.getElementById('confirmPinDeleteBtn');
        if (confirmPinBtn) confirmPinBtn.onclick = () => this.confirmPinDelete();
        const cancelPinBtn = document.getElementById('cancelPinDeleteBtn');
        if (cancelPinBtn) cancelPinBtn.onclick = () => { document.getElementById('deletePinModal').style.display = 'none'; };

        const pinInput = document.getElementById('deletePinInput');
        if (pinInput) pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.confirmPinDelete(); });

        document.getElementById('maintenanceToggle').onchange = async (e) => {
            if (!firebaseService.auth?.currentUser) { e.target.checked = !e.target.checked; return; }
            const isChecked = e.target.checked;
            const statusLabel = document.getElementById('maintenanceStatusLabel');
            if (statusLabel) { statusLabel.textContent = isChecked ? i18n.t("system_offline") : i18n.t("system_online"); isChecked ? statusLabel.classList.add('offline') : statusLabel.classList.remove('offline'); }
            try {
                await firebaseService.setDoc(firebaseService.doc(firebaseService.db, "settings", "appState"), { maintenance: isChecked, brokenMachines }, { merge: true });
                utils.showToast(isChecked ? i18n.t("maintenance_on") : i18n.t("maintenance_off"));
            } catch (err) { console.error(err); utils.showToast(i18n.t("error_generic"), "error"); e.target.checked = !isChecked; }
        };

        document.getElementById('maintenanceAdminBtn').onclick = () => {
            document.getElementById('modalOverlay').style.display = 'flex';
            document.getElementById('adminModal').style.display = 'block';
            document.getElementById('phoneModal').style.display = 'none';
            document.getElementById('confirmModal').style.display = 'none';
        };

        const themeBtn = document.getElementById('themeToggleBtn');
        if (themeBtn) themeBtn.onclick = () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            const icon = themeBtn.querySelector('i');
            if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        };

        document.getElementById('adminSearchInput').addEventListener('input', () => this.renderAdminDashboard());
        document.getElementById('adminDateFilter').addEventListener('change', () => this.renderAdminDashboard());

        document.getElementById('tabActive').onclick = () => {
            adminViewMode = 'active';
            document.getElementById('tabActive').classList.add('active');
            document.getElementById('tabHistory').classList.remove('active');
            document.getElementById('listTitle').textContent = i18n.t("active_bookings");
            this.renderAdminDashboard();
        };

        document.getElementById('tabHistory').onclick = async () => {
            adminViewMode = 'history';
            document.getElementById('tabHistory').classList.add('active');
            document.getElementById('tabActive').classList.remove('active');
            document.getElementById('listTitle').textContent = i18n.t("history_loading");
            const listEl = document.getElementById('adminBookingsList');
            listEl.innerHTML = `<div class="empty-state"><div class="spinner" style="width:32px;height:32px;border-width:3px;margin:0 auto 12px;"></div>${i18n.t("loading")}</div>`;
            const badgeEl = document.getElementById('listBadgeCount');
            if (badgeEl) badgeEl.textContent = '0';
            try {
                const d2 = new Date(); d2.setDate(d2.getDate() - 1);
                const yest = d2.toISOString().split('T')[0];
                const qH = firebaseService.query(firebaseService.bookingsCollection, firebaseService.where("date", "<", yest), firebaseService.orderBy("date", "desc"), firebaseService.limit(200));
                const snap = await firebaseService.getDocs(qH);
                historyBookings = [];
                snap.docs.forEach(doc => historyBookings.push({ ...doc.data(), id: doc.id }));
                document.getElementById('listTitle').textContent = i18n.t("history_bookings");
                this.renderAdminDashboard();
            } catch (e) {
                console.error(e);
                utils.showToast(i18n.t("history_error"), "error");
                document.getElementById('listTitle').textContent = i18n.t("history_bookings");
                listEl.innerHTML = `<div class="empty-state">${i18n.t("history_error")}</div>`;
            }
        };

        const exportBtn = document.getElementById('exportCsvBtn');
        if (exportBtn) exportBtn.onclick = () => {
            if (!firebaseService.auth?.currentUser) return;
            const data = adminViewMode === 'active' ? localBookings : historyBookings;
            if (!data.length) { utils.showToast(i18n.t("no_export_data"), "error"); return; }
            let csv = "\uFEFF";
            csv += "Data,Ora,Nume,Telefon,Masina,Durata\n";
            data.forEach(r => {
                csv += [r.date, r.startTime, r.userName, r.phoneNumber,
                    i18n.t(utils.getMachineKey(r.machineType)),
                    r.duration].map(v => utils.escapeCsvCell(v)).join(",") + "\n";
            });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `raport_${adminViewMode}.csv`);
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            URL.revokeObjectURL(url);
        };

        const exportPdfBtn = document.getElementById('exportPdfBtn');
        if (exportPdfBtn) exportPdfBtn.onclick = () => this.exportToPdf();

        const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        if (cancelDeleteBtn) cancelDeleteBtn.onclick = () => { document.getElementById('modalOverlay').style.display = 'none'; document.getElementById('confirmModal').style.display = 'none'; deleteId = null; };

        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        if (confirmDeleteBtn) confirmDeleteBtn.onclick = async () => { if (!firebaseService.auth?.currentUser) return; await this.performDelete(deleteId, true); };

        document.getElementById('adminToggleBtn').onclick = () => {
            ['phoneModal','confirmModal','deletePinModal'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
            document.getElementById('modalOverlay').style.display = 'flex';
            document.getElementById('adminModal').style.display = 'block';
        };
        document.getElementById('adminLoginBtn').onclick = this.handleAdminLogin.bind(this);
        document.getElementById('adminLogoutBtn').onclick = () => {
            if (!firebaseService.auth) return;
            firebaseService.signOut(firebaseService.auth).then(() => utils.showToast(i18n.t("logout_success"))).catch(e => { console.error(e); utils.showToast(i18n.t("logout_error"), "error"); });
        };
    },

    // ─── PDF EXPORT ───────────────────────────────────────────────────────────
    async exportToPdf() {
        if (!firebaseService.auth?.currentUser) return;
        const data = adminViewMode === 'active' ? localBookings : historyBookings;
        if (!data.length) { utils.showToast(i18n.t("no_export_data"), "error"); return; }
        utils.showToast(i18n.t("pdf_generating"));
        const loadScript = src => new Promise((res, rej) => {
            if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
            const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
        });
        try {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            doc.setFontSize(18); doc.setTextColor(79, 70, 229); doc.text('Spalatorie Camin', 14, 18);
            doc.setFontSize(11); doc.setTextColor(100, 100, 100);
            doc.text(`Raport ${adminViewMode === 'active' ? 'Active' : 'Istoric'} — ${new Date().toLocaleDateString('ro-RO')}`, 14, 26);
            doc.autoTable({
                head: [['Data', 'Interval', 'Nume', 'Telefon', 'Masina', 'Durata']],
                body: data.map(b => {
                    const end = utils.minsToTime(utils.timeToMins(b.startTime) + parseInt(b.duration));
                    return [b.date, `${b.startTime} - ${end}`, b.userName, b.phoneNumber || '-',
                        i18n.t(utils.getMachineKey(b.machineType)),
                        `${b.duration} min`];
                }),
                startY: 32,
                styles: { fontSize: 9, cellPadding: 4 },
                headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [245, 245, 255] },
                columnStyles: { 2: { fontStyle: 'bold' } }
            });
            doc.save(`raport_rezervari_${adminViewMode}.pdf`);
        } catch (err) { console.error(err); utils.showToast(i18n.t("pdf_error"), "error"); }
    },

    setupAuthListener() {
        firebaseService.onAuthStateChanged(firebaseService.auth, (user) => {
            if (user) {
                isAdmin = true;
                document.body.classList.add('admin-mode');
                document.getElementById('adminLoginForm').style.display = 'none';
                document.getElementById('adminContent').style.display = 'block';
                document.getElementById('maintenanceOverlay').style.display = 'none';
                this.renderAdminDashboard(); this.cleanupOldBookings();
            } else {
                isAdmin = false;
                document.body.classList.remove('admin-mode');
                document.getElementById('adminContent').style.display = 'none';
                document.getElementById('adminLoginForm').style.display = 'block';
                document.getElementById('adminPassword').value = '';
                document.getElementById('adminEmail').value = '';
                const toggle = document.getElementById('maintenanceToggle');
                if (toggle?.checked) { document.getElementById('maintenanceOverlay').style.display = 'flex'; document.getElementById('modalOverlay').style.display = 'none'; }
            }
        });
    },

    changeDate(days) {
        const date = new Date(this.currentDate);
        date.setDate(date.getDate() + days);
        const newDate = date.toISOString().split('T')[0];
        const today = new Date().toISOString().split('T')[0];
        if (newDate < today) { utils.showToast(i18n.t("cannot_see_past"), 'error'); return; }
        this.currentDate = newDate;
        document.getElementById('bookingDate').value = newDate;
        document.querySelectorAll('.selected-slot').forEach(el => el.classList.remove('selected-slot'));
        this.updateDateDisplay(); this.renderAll();
    },

    updateDateDisplay() {
        const display = document.getElementById('currentDateDisplay');
        const today = new Date().toISOString().split('T')[0];
        display.textContent = this.currentDate === today ? i18n.t("today_display") : utils.formatDateRO(this.currentDate);
    },

    // ─── SUCCESS MODAL ────────────────────────────────────────────────────────
    showSuccessModal(booking) {
        const modal = document.getElementById('successModal');
        if (!modal) return;
        const endMins = utils.timeToMins(booking.startTime) + parseInt(booking.duration);
        const machineName = i18n.t(utils.getMachineKey(booking.machineType));
        document.getElementById('successMachine').textContent = machineName;
        document.getElementById('successDate').textContent = utils.formatDateRO(booking.date);
        document.getElementById('successTime').textContent = `${booking.startTime} — ${utils.minsToTime(endMins)}`;
        document.getElementById('successDuration').textContent = `${booking.duration} min`;
        document.getElementById('successName').textContent = booking.userName;
        ['phoneModal','confirmModal','adminModal','deletePinModal'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        document.getElementById('modalOverlay').style.display = 'flex';
        modal.style.display = 'block';
        this.launchConfetti();
    },

    // ─── CONFETTI ─────────────────────────────────────────────────────────────
    launchConfetti() {
        const colors = ['#1A7A6E','#F59E0B','#EF4444','#3B82F6','#8B5CF6','#EC4899','#10B981','#F97316'];
        const container = document.createElement('div');
        container.className = 'confetti-container';
        document.body.appendChild(container);
        for (let i = 0; i < 55; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            const size = 6 + Math.random() * 8;
            piece.style.cssText = `
                left: ${Math.random() * 100}%;
                top: ${-10 - Math.random() * 30}px;
                width: ${size}px; height: ${size}px;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
                animation-duration: ${1.4 + Math.random() * 1.4}s;
                animation-delay: ${Math.random() * 0.7}s;
            `;
            container.appendChild(piece);
        }
        setTimeout(() => container.remove(), 3200);
    },

    // ─── HANDLE BOOKING ───────────────────────────────────────────────────────
    async handleBooking(e) {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const orig = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0;display:inline-block;"></div> ${i18n.t('verifying')}`;
        try {
            let userName = document.getElementById('userName').value.trim();
            const phone = document.getElementById('phoneNumber').value.trim();
            const pin = document.getElementById('userPin').value.trim();
            const machine = document.getElementById('machineType').value;
            const start = document.getElementById('startTime').value;
            const duration = parseInt(document.getElementById('duration').value);
            const bookingDate = document.getElementById('bookingDate').value;

            if (!start) throw new Error(i18n.t("select_time_err"));
            if (!machine) throw new Error(i18n.t("choose_machine_err"));
            if (userName.length < 3) throw new Error(i18n.t("short_name_err"));
            if (brokenMachines[machine]) throw new Error(i18n.t("machine_broken_err"));

            userName = utils.capitalize(userName);
            let cleanPhone = phone.replace(/\D/g, '');
            const phoneEl2 = document.getElementById('phoneNumber');
            const skipPhone = document.getElementById('skipPhone').checked || (phoneEl2 && phoneEl2.disabled);
            if (skipPhone) { cleanPhone = "-"; }
            else if (cleanPhone.length !== 10 || !cleanPhone.startsWith('07')) throw new Error(i18n.t("invalid_phone_err"));

            if (!pin || !/^\d{4}$/.test(pin)) throw new Error(i18n.t("pin_4_digits_err"));
            if (!logic.canUserBook(userName, localBookings)) throw new Error(i18n.t("limit_reached_err"));
            if (!logic.isSlotFree(machine, bookingDate, start, duration, localBookings)) throw new Error(i18n.t("slot_taken_err"));

            await firebaseService.runTransaction(firebaseService.db, async (transaction) => {
                const slotID = `${bookingDate}_${machine}_${start}`;
                const ref = firebaseService.doc(firebaseService.bookingsCollection, slotID);
                const existing = await transaction.get(ref);
                if (existing.exists()) throw i18n.t("slot_taken_transaction_err");
                const pinHash = await utils.hashPin(pin, slotID);
                transaction.set(ref, { userName, phoneNumber: cleanPhone, pinHash, machineType: machine, date: bookingDate, startTime: start, duration, createdAt: new Date().toISOString() });
            });

            localStorage.setItem('studentName', userName);
            if (cleanPhone !== '-') localStorage.setItem('studentPhone', cleanPhone);
            firebaseService.logEvent(firebaseService.analytics, 'rezervare_noua', { masina: machine, durata: duration });

            e.target.reset();
            document.getElementById('userName').value = userName;
            document.getElementById('bookingDate').value = bookingDate;
            document.getElementById('startTime').style.borderColor = 'var(--border)';
            // Reset phone input state explicitly — form.reset() resets checkbox but NOT disabled state
            const phoneEl = document.getElementById('phoneNumber');
            if (phoneEl) { phoneEl.disabled = false; phoneEl.style.borderColor = ''; phoneEl.placeholder = i18n.t("phone_placeholder"); }
            document.querySelectorAll('.selected-slot').forEach(el => el.classList.remove('selected-slot'));
            document.querySelectorAll('.selector-card').forEach(c => c.classList.remove('selected'));

            this.showSuccessModal({ userName, machineType: machine, date: bookingDate, startTime: start, duration });

        } catch (error) {
            console.error(error);
            let msg = i18n.t("server_error");
            if (typeof error === 'string') msg = error;
            else if (error.message) msg = error.message;
            utils.showToast(msg, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = orig;
        }
    },

    renderAll() {
        this.renderSchedule(); this.renderMyBookings(); this.renderUpcoming(); this.updateMachineStatus(); this.renderPeakHours();
        if (document.getElementById('adminContent').style.display === 'block') this.renderAdminDashboard();
    },

    // ─── SCHEDULE ─────────────────────────────────────────────────────────────
    renderSchedule() {
        const grid = document.getElementById('scheduleGrid');
        grid.innerHTML = '';
        const slots = logic.generateSlots();
        const prevDate = utils.addDays(this.currentDate, -1);
        const allBookings = [
            ...localBookings.filter(b => b.date === this.currentDate),
            ...localBookings.filter(b => b.date === prevDate && (utils.timeToMins(b.startTime) + parseInt(b.duration)) > 1440)
        ];

        Object.keys(logic.machines).forEach(machineKey => {
            const col = document.createElement('div');
            const isBroken = !!brokenMachines[machineKey];
            col.className = `machine-column${isBroken ? ' machine-column-broken' : ''}`;
            const header = document.createElement('div');
            header.className = `machine-header${isBroken ? ' machine-header-broken' : ''}`;
            const label = i18n.t(utils.getMachineKey(machineKey));
            if (isBroken) {
                header.innerHTML = `<span class="broken-badge-header">🔧 ${i18n.t('broken').replace('🔧 ', '')}</span><br><span style="font-weight:700">${label}</span>`;
            } else {
                header.innerHTML = `<small>${machineKey.includes('masina') ? '🧺' : '🌬️'}</small><br>${label}`;
            }
            col.appendChild(header);

            slots.forEach(slot => {
                const slotMins = utils.timeToMins(slot);
                const nextSlotMins = slotMins + 30;
                const booking = allBookings.find(b => {
                    if (b.machineType !== machineKey) return false;
                    let bS = utils.timeToMins(b.startTime), bE = bS + parseInt(b.duration);
                    if (b.date === prevDate) { bS = 0; bE -= 1440; }
                    return bS < nextSlotMins && bE > slotMins;
                });
                const div = document.createElement('div');
                div.className = `time-slot ${booking ? 'occupied' : isBroken ? 'broken-slot' : 'available'}`;
                if (booking) {
                    let bS = utils.timeToMins(booking.startTime), bE = bS + parseInt(booking.duration);
                    let isSpill = false;
                    if (booking.date === prevDate) { isSpill = true; bS = 0; bE -= 1440; }
                    if (bS >= slotMins) div.classList.add('booking-start');
                    if (bE <= nextSlotMins) div.classList.add('booking-end');
                    if (bS < slotMins && bE > nextSlotMins) div.classList.add('booking-middle');
                    const isStart = bS >= slotMins && bS < nextSlotMins;
                    if (isStart) {
                        const timeText = isSpill ? `... - ${utils.minsToTime(bE)}` : (() => {
                            const realEnd = bS + parseInt(booking.duration);
                            return `${booking.startTime} - ${realEnd > 1440 ? utils.minsToTime(realEnd - 1440) + ` (${i18n.t("tomorrow")})` : utils.minsToTime(realEnd)}`;
                        })();
                        div.innerHTML = `<div class="slot-content"><span class="slot-time">${utils.escapeHtml(timeText)}</span><span class="slot-name">${utils.escapeHtml(booking.userName)}</span></div>`;
                    }
                    div.title = `${i18n.t("reserved")} ${booking.userName}`;
                    div.onclick = () => this.showPhoneModal(booking);
                } else if (isBroken) {
                    div.innerHTML = `<span class="broken-slot-label">🔧</span>`;
                    div.title = i18n.t('broken');
                } else {
                    div.textContent = slot;
                    div.onclick = (ev) => {
                        document.getElementById('machineType').value = machineKey;
                        document.getElementById('duration').value = "60";
                        document.getElementById('startTime').value = slot;
                        // Fix: sync visual selector
                        document.querySelectorAll('.selector-card').forEach(c => c.classList.remove('selected'));
                        const card = document.querySelector(`.selector-card[data-value="${machineKey}"]`);
                        if (card) card.classList.add('selected');
                        document.querySelector('.booking-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
                        document.querySelector('.booking-card').classList.add('highlight-pulse');
                        setTimeout(() => document.querySelector('.booking-card').classList.remove('highlight-pulse'), 1000);
                        document.querySelectorAll('.selected-slot').forEach(el => el.classList.remove('selected-slot'));
                        ev.target.classList.add('selected-slot');
                    };
                }
                col.appendChild(div);
            });
            grid.appendChild(col);
        });

        // Auto-scroll to current time
        const today = new Date().toISOString().split('T')[0];
        if (this.currentDate === today) {
            requestAnimationFrame(() => {
                const now = new Date();
                const slotIndex = Math.max(0, Math.floor((now.getHours() * 60 + now.getMinutes()) / 30) - 1);
                const sc = document.querySelector('.schedule-container');
                const firstCol = grid.querySelector('.machine-column');
                if (sc && firstCol) {
                    const target = firstCol.querySelectorAll('.time-slot')[slotIndex];
                    if (target) sc.scrollTop = target.offsetTop - 60;
                }
            });
        }
    },

    showPhoneModal(booking) {
        deleteId = booking.id;
        document.getElementById('modalUserName').textContent = booking.userName;
        const phoneEl = document.getElementById('modalPhoneNumber');
        const callBtn = document.getElementById('callPhoneBtn');
        const copyBtn = document.getElementById('copyPhoneBtn');
        if (booking.phoneNumber === '-' || booking.phoneNumber === 'Nu este necesar') {
            phoneEl.textContent = i18n.t("phone_on_paper");
            phoneEl.style.cssText = 'font-style:italic;font-size:0.9rem;color:var(--text-2);';
            callBtn.style.display = 'none'; copyBtn.style.display = 'none';
        } else {
            phoneEl.textContent = booking.phoneNumber;
            phoneEl.style.cssText = '';
            callBtn.style.display = 'inline-block'; copyBtn.style.display = 'inline-block';
            callBtn.href = `tel:${booking.phoneNumber}`;
            copyBtn.onclick = () => navigator.clipboard.writeText(booking.phoneNumber).then(() => utils.showToast(i18n.t("phone_copied")));
        }
        ['adminModal','confirmModal','deletePinModal','successModal'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        document.getElementById('modalOverlay').style.display = 'flex';
        document.getElementById('phoneModal').style.display = 'block';
    },

    requestDelete(id) {
        if (id) deleteId = id;
        document.getElementById('phoneModal').style.display = 'none';
        document.getElementById('deletePinModal').style.display = 'block';
        const input = document.getElementById('deletePinInput');
        input.value = ''; input.focus();
    },

    async confirmPinDelete() {
        const input = document.getElementById('deletePinInput');
        const enteredPin = input.value.trim();
        const booking = [...localBookings, ...historyBookings].find(b => b.id === deleteId);
        if (!booking) { utils.showToast(i18n.t("booking_not_found_err"), "error"); document.getElementById('modalOverlay').style.display = 'none'; return; }
        // Admin sare direct fara PIN
        if (firebaseService.auth?.currentUser) { await this.performDelete(deleteId); document.getElementById('deletePinModal').style.display = 'none'; return; }
        if (!enteredPin || !/^\d{4}$/.test(enteredPin)) { utils.showToast(i18n.t("enter_4_pin_err"), "error"); return; }
        const hasPin = booking.pinHash || booking.code;
        if (!hasPin) { utils.showToast(i18n.t("old_booking_no_pin_err"), "error"); return; }
        let pinOk = booking.pinHash ? (await utils.hashPin(enteredPin, booking.id)) === booking.pinHash : booking.code === enteredPin;
        if (pinOk) { await this.performDelete(deleteId); document.getElementById('deletePinModal').style.display = 'none'; }
        else { utils.showToast(i18n.t("wrong_pin_err"), "error"); input.value = ''; input.style.borderColor = "var(--danger)"; }
    },

    async performDelete(id, isAdminDelete = false) {
        if (!id) return;
        if (isAdminDelete && !firebaseService.auth?.currentUser) return;
        const btn = document.getElementById('confirmPinDeleteBtn');
        if (btn) btn.disabled = true;
        try {
            const booking = [...localBookings, ...historyBookings].find(b => b.id === id);
            if (booking) {
                try { await firebaseService.deleteDoc(firebaseService.doc(firebaseService.db, "slots_lock", `${booking.date}_${booking.machineType}_${booking.startTime}`)); }
                catch (le) { console.warn("Lock delete failed:", le); }
            }
            await firebaseService.deleteDoc(firebaseService.doc(firebaseService.db, "rezervari", id));
            localBookings = localBookings.filter(b => b.id !== id);
            historyBookings = historyBookings.filter(b => b.id !== id);
            utils.showToast(i18n.t("delete_success"));
            this.renderAll();
            ['modalOverlay','confirmModal','deletePinModal'].forEach(modalId => { const el = document.getElementById(modalId); if (el) el.style.display = 'none'; });
        } catch (e) {
            console.error("Delete error:", e);
            utils.showToast(e.code === 'permission-denied' ? i18n.t("permission_denied_err") : 'Eroare: ' + e.message, 'error');
        } finally { if (btn) btn.disabled = false; deleteId = null; }
    },

    confirmDelete(id) {
        if (!firebaseService.auth?.currentUser) return;
        deleteId = id;
        document.getElementById('modalOverlay').style.display = 'flex';
        document.getElementById('phoneModal').style.display = 'none';
        document.getElementById('adminModal').style.display = 'none';
        document.getElementById('confirmModal').style.display = 'block';
    },

    renderMyBookings() {
        const container = document.getElementById('myBookings');
        const currentUser = document.getElementById('userName').value.trim().toLowerCase();
        if (!currentUser) { container.innerHTML = `<div class="empty-state">${i18n.t("enter_name_to_see_bookings")}</div>`; return; }
        const bookings = localBookings.filter(b => b.userName.toLowerCase() === currentUser).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
        container.innerHTML = bookings.length ? bookings.map(b => {
            const end = utils.minsToTime(utils.timeToMins(b.startTime) + parseInt(b.duration));
            return `<div class="booking-item"><div class="booking-info"><strong>${utils.escapeHtml(i18n.t(utils.getMachineKey(b.machineType)))}</strong><span>${utils.escapeHtml(utils.formatDateRO(b.date))} • ${utils.escapeHtml(b.startTime)} - ${utils.escapeHtml(end)}</span></div></div>`;
        }).join('') + `<p class="delete-hint"><i class="fa-solid fa-circle-info"></i> ${i18n.t('delete_hint')}</p><p class="delete-hint" style="margin-top:4px;"><i class="fa-solid fa-phone"></i> ${i18n.t('call_hint')}</p>` : `<div class="empty-state">${i18n.t("no_bookings_found")}</div>`;
    },

    // ─── ORE DE VÂRF ──────────────────────────────────────────────────────────
    renderPeakHours() {
        const container = document.getElementById('peakHoursContainer');
        if (!container) return;

        // Filtrăm doar ultimele 3 zile (fără viitor)
        const today = new Date().toISOString().split('T')[0];
        const cutoff = utils.addDays(today, -3);
        const recentBookings = localBookings.filter(b => b.date >= cutoff && b.date <= today);

        // Grupăm după ora de start (0-23)
        const byHour = new Array(24).fill(0);
        recentBookings.forEach(b => {
            const h = parseInt((b.startTime || '0').split(':')[0]);
            if (h >= 0 && h < 24) byHour[h]++;
        });

        const totalBookings = byHour.reduce((a, b) => a + b, 0);
        if (totalBookings === 0) {
            container.innerHTML = `<p class="peak-summary" style="color:var(--text-3)">${i18n.t('peak_no_data')}</p>`;
            return;
        }

        const maxVal = Math.max(...byHour, 1);

        // Afișăm 6:00–23:00
        const startH = 6, endH = 23;
        const displayHours = [];
        for (let h = startH; h <= endH; h++) displayHours.push(h);

        // Găsim top ore
        const sorted = [...byHour.map((v, i) => ({ h: i, v }))]
            .filter(x => x.h >= startH && x.h <= endH && x.v > 0)
            .sort((a, b) => b.v - a.v);
        const top = sorted.slice(0, 3);
        const topHours = new Set(top.map(x => x.h));

        const bars = displayHours.map(h => {
            const val = byHour[h];
            const heightPct = val > 0 ? Math.max(8, Math.round((val / maxVal) * 100)) : 4;
            let cls = 'peak-low';
            if (topHours.has(h)) {
                cls = sorted[0].h === h ? 'peak-high' : 'peak-medium';
            }
            return `<div class="peak-bar-wrap" title="${h}:00 — ${val} ${i18n.t('peak_bookings')}">
                <div class="peak-bar ${cls}" style="height:${heightPct}%"></div>
            </div>`;
        }).join('');

        const labels = displayHours.map(h => {
            return `<span class="peak-hour-label">${h % 4 === 0 ? h + 'h' : ''}</span>`;
        }).join('');

        let summaryText = '';
        if (top.length > 0) {
            // Găsim fereastra de 3 ore consecutive cu cele mai multe rezervări
            let bestStart = top[0].h, bestCount = 0;
            for (let h = startH; h <= endH - 2; h++) {
                const count = byHour[h] + byHour[h + 1] + byHour[h + 2];
                if (count > bestCount) { bestCount = count; bestStart = h; }
            }
            const peakEnd = bestStart + 3;
            summaryText = i18n.currentLang === 'ro'
                ? `🔥 Cel mai aglomerat: <strong>${bestStart}:00–${peakEnd}:00</strong>`
                : `🔥 Busiest window: <strong>${bestStart}:00–${peakEnd}:00</strong>`;
        }

        container.innerHTML = `
            <div class="peak-hours-bars">${bars}</div>
            <div class="peak-hour-labels">${labels}</div>
            ${summaryText ? `<p class="peak-summary">${summaryText}</p>` : ''}
        `;
    },

    renderUpcoming() {
        const container = document.getElementById('upcomingBookings');
        const today = new Date().toISOString().split('T')[0];
        const bookings = localBookings.filter(b => b.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
        container.innerHTML = bookings.length ? bookings.map(b => `<div class="booking-item"><div class="booking-info"><strong>${utils.escapeHtml(b.userName)}</strong><span>${utils.escapeHtml(utils.formatDateRO(b.date))} • ${utils.escapeHtml(i18n.t(utils.getMachineKey(b.machineType)))}</span></div></div>`).join('') : `<div class="empty-state">${i18n.t("nothing_planned")}</div>`;
    },

    async handleAdminLogin() {
        if (!firebaseService.auth) { utils.showToast(i18n.t("auth_unavailable_err"), "error"); return; }
        const email = document.getElementById('adminEmail').value.trim();
        const password = document.getElementById('adminPassword').value;
        if (!email || !password) { utils.showToast(i18n.t("enter_email_pass_err"), "error"); return; }
        const btn = document.getElementById('adminLoginBtn');
        if (btn) { btn.disabled = true; btn.textContent = i18n.t("logging_in"); }
        try {
            await firebaseService.signInWithEmailAndPassword(firebaseService.auth, email, password);
            utils.showToast(i18n.t("login_success"));
        } catch (error) {
            const c = error.code || '';
            let msg = i18n.t('login_err_default');
            if (c === 'auth/user-not-found') msg = i18n.t('login_err_not_found');
            else if (c === 'auth/wrong-password') msg = i18n.t('login_err_wrong_pass');
            else if (c === 'auth/invalid-credential') msg = i18n.t('login_err_default');
            else if (c === 'auth/invalid-email') msg = i18n.t('login_err_invalid_email');
            else if (c === 'auth/operation-not-allowed') msg = i18n.t('login_err_not_allowed');
            else if (error.message) msg = error.message;
            utils.showToast(msg, 'error');
        } finally { if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> ${i18n.t('login')}`; } }
    },

    async cleanupOldBookings() {
        if (!firebaseService.auth?.currentUser) return;
        try {
            const d = new Date(); d.setDate(d.getDate() - 30);
            const cutoff = d.toISOString().split('T')[0];
            const q = firebaseService.query(firebaseService.bookingsCollection, firebaseService.where("date", "<", cutoff), firebaseService.limit(200));
            const snap = await firebaseService.getDocs(q);
            if (!snap.empty) {
                const batch = firebaseService.writeBatch(firebaseService.db);
                snap.docs.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
                console.log(`[Cleanup] Sterse ${snap.size} rezervari mai vechi de 30 zile.`);
            }
        } catch (e) { console.error("[Cleanup Error]", e); }
    },

    // ─── ADMIN DASHBOARD ──────────────────────────────────────────────────────
    renderAdminDashboard() {
        if (!firebaseService.auth?.currentUser) return;
        const today = new Date().toISOString().split('T')[0];
        const elT = document.getElementById('statToday'); if (elT) elT.textContent = localBookings.filter(b => b.date === today).length;
        const elA = document.getElementById('statTotal'); if (elA) elA.textContent = localBookings.length;

        this.renderBrokenMachineToggles();
        this.renderHistogram();

        const source = adminViewMode === 'active' ? localBookings : historyBookings;
        const searchTerm = (document.getElementById('adminSearchInput')?.value || '').toLowerCase();
        const filterDate = document.getElementById('adminDateFilter')?.value || '';
        const filtered = source.filter(b => {
            const nm = b.userName.toLowerCase().includes(searchTerm);
            const pm = (b.phoneNumber || '').includes(searchTerm);
            const dm = filterDate ? b.date === filterDate : true;
            return (nm || pm) && dm;
        });

        const badge = document.getElementById('listBadgeCount'); if (badge) badge.textContent = filtered.length;
        const toggle = document.getElementById('maintenanceToggle');
        const statusLabel = document.getElementById('maintenanceStatusLabel');
        if (toggle && statusLabel) { statusLabel.textContent = toggle.checked ? i18n.t("system_offline") : i18n.t("system_online"); toggle.checked ? statusLabel.classList.add('offline') : statusLabel.classList.remove('offline'); }

        const bookings = [...filtered].sort((a, b) => adminViewMode === 'history' ? b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime) : a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
        document.getElementById('adminBookingsList').innerHTML = bookings.length ? bookings.map(b => {
            const end = utils.minsToTime(utils.timeToMins(b.startTime) + parseInt(b.duration));
            return `<div class="admin-list-item"><div class="admin-item-info"><strong>${utils.escapeHtml(b.userName)}</strong><span><i class="fa-solid fa-phone"></i> ${utils.escapeHtml(b.phoneNumber)}</span><span><i class="fa-regular fa-calendar"></i> ${utils.escapeHtml(utils.formatDateRO(b.date))} • ${utils.escapeHtml(b.startTime)}-${utils.escapeHtml(end)}</span><span><i class="fa-solid fa-soap"></i> ${utils.escapeHtml(i18n.t(utils.getMachineKey(b.machineType)))}</span></div><button class="btn-delete-vip" data-delete-id="${utils.escapeHtml(b.id)}" title="Șterge"><i class="fa-solid fa-trash"></i></button></div>`;
        }).join('') : `<div class="empty-state">${i18n.t("no_bookings_search")}</div>`;
    },

    renderBrokenMachineToggles() {
        const container = document.getElementById('brokenMachinesSection');
        if (!container) return;
        const icons = { masina1: '🧺', masina2: '🧺', uscator1: '🌬️', uscator2: '🌬️' };
        container.innerHTML = `<h4 style="margin:0 0 10px;font-size:0.82rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.5px;"><i class="fa-solid fa-screwdriver-wrench"></i> ${i18n.t('machine_status_title')}</h4><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">${Object.keys(logic.machines).map(key => {
            const isBroken = !!brokenMachines[key];
            return `<div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg2);padding:8px 10px;border-radius:8px;border:1px solid ${isBroken ? 'var(--danger)' : 'var(--border)'};">
                <span style="font-size:0.85rem;">${icons[key]} ${i18n.t(utils.getMachineKey(key))}</span>
                <button class="broken-toggle" data-machine="${key}" style="font-size:0.75rem;padding:3px 8px;border-radius:4px;cursor:pointer;border:1px solid ${isBroken ? 'var(--danger)' : 'var(--success)'};background:${isBroken ? 'rgba(220,38,38,0.1)' : 'rgba(34,197,94,0.1)'};color:${isBroken ? 'var(--danger)' : 'var(--success)'};">${isBroken ? i18n.t('broken_toggle_off') : i18n.t('broken_toggle_on')}</button>
            </div>`;
        }).join('')}</div>`;
    },

    renderHistogram() {
        const container = document.getElementById('histogramSection');
        if (!container) return;
        const today = new Date().toISOString().split('T')[0];
        const source = adminViewMode === 'active' ? localBookings : historyBookings;
        const byMachine = {};
        Object.keys(logic.machines).forEach(k => byMachine[k] = 0);
        source.forEach(b => { if (byMachine[b.machineType] !== undefined) byMachine[b.machineType]++; });
        const maxM = Math.max(...Object.values(byMachine), 1);
        const byHour = new Array(24).fill(0);
        const hourSrc = adminViewMode === 'active' ? localBookings.filter(b => b.date === today) : historyBookings;
        hourSrc.forEach(b => { const h = parseInt((b.startTime || '0').split(':')[0]); if (h >= 0 && h < 24) byHour[h]++; });
        const maxH = Math.max(...byHour, 1);
        const colors = { masina1: '#4f46e5', masina2: '#7c3aed', uscator1: '#0891b2', uscator2: '#0284c7' };
        container.innerHTML = `
            <h4 style="margin:0 0 10px;font-size:0.82rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.5px;"><i class="fa-solid fa-chart-bar"></i> ${i18n.t('stats_by_machine')}</h4>
            <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:20px;">
                ${Object.keys(logic.machines).map(key => `<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:0.8rem;min-width:75px;color:var(--text-2);">${i18n.t(utils.getMachineKey(key))}</span><div style="flex:1;background:var(--bg2);border-radius:4px;height:22px;overflow:hidden;"><div style="width:${byMachine[key]/maxM*100}%;height:100%;background:${colors[key]};border-radius:4px;transition:width 0.6s ease;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;min-width:${byMachine[key]>0?'22px':'0'};"> ${byMachine[key]>0?`<span style="color:#fff;font-size:0.75rem;font-weight:700;">${byMachine[key]}</span>`:''}</div></div></div>`).join('')}
            </div>
            <h4 style="margin:0 0 10px;font-size:0.82rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.5px;"><i class="fa-solid fa-clock"></i> ${i18n.t('stats_by_hour')} ${adminViewMode==='active'?'(azi)':'(istoric)'}</h4>
            <div style="overflow-x:auto;padding-bottom:4px;">
            <div style="display:flex;align-items:flex-end;gap:2px;height:60px;min-width:360px;">
                ${byHour.map((c, h) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;" title="${h}:00 — ${c}"><div style="width:100%;background:${c>0?'#2EB5A5':'var(--border)'};height:${c>0?Math.max(c/maxH*44,5):3}px;border-radius:2px 2px 0 0;transition:height 0.4s;"></div><span style="font-size:0.55rem;color:var(--text-3);margin-top:2px;white-space:nowrap;">${h%4===0?h+'h':''}</span></div>`).join('')}
            </div>
            </div>`;
    }
};

document.addEventListener('DOMContentLoaded', () => ui.init());
