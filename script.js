// ------------------------------------------------------------------
// 1. IMPORTURI FIREBASE
// ------------------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, setDoc, onSnapshot, query, orderBy, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ------------------------------------------------------------------
// 2. CONFIGURARE (Datele Tale)
// ------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyA3uDKfPBvMfuqTk3Z1tLyLOwP40zFtohs",
  authDomain: "spalatoriep20-b123d.firebaseapp.com",
  projectId: "spalatoriep20-b123d",
  storageBucket: "spalatoriep20-b123d.firebasestorage.app",
  messagingSenderId: "899577919587",
  appId: "1:899577919587:web:7e32821c02144ce61a6056"
};

// Inițializare aplicație
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const bookingsCollection = collection(db, "rezervari");

// ------------------------------------------------------------------
// 3. LOGICA APLICATIEI
// ------------------------------------------------------------------

let localBookings = [];
let deleteId = null;
let isAdmin = false;

// HASH PAROLA: P20adminsup34
const ADMIN_HASH = '541a120b1cc8b470e8ff181003f923704512d6dfc00c3eee5ea02b626db9f174';

const utils = {
    async sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },
    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        if (toast) {
            toast.textContent = message;
            toast.className = `toast ${type} show`;
            setTimeout(() => toast.classList.remove('show'), 3000);
        } else {
            alert(message);
        }
    },
    formatDateRO(dateStr) {
        const options = { weekday: 'long', day: 'numeric', month: 'long' };
        // Adaugam T12:00:00 pentru a evita probleme de timezone
        return new Date(dateStr + 'T12:00:00').toLocaleDateString('ro-RO', options);
    },
    timeToMins(time) { 
        if(!time) return 0;
        const [h, m] = time.split(':').map(Number); 
        return h * 60 + m; 
    },
    minsToTime(mins) { 
        let h = Math.floor(mins / 60); 
        const m = mins % 60; 
        if (h >= 24) h = h - 24; 
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`; 
    },
    
    capitalize(str) {
        if (!str) return '';
        return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }
};

const logic = {
    machines: { 'masina1': 'Mașină Spălat 1', 'masina2': 'Mașină Spălat 2', 'uscator1': 'Uscător 1', 'uscator2': 'Uscător 2' },
    
    // Generăm sloturi de 30 minute pentru vizualizare 24h
    generateSlots(startHour = 0, endHour = 24) {
        const slots = [];
        for (let h = startHour; h < endHour; h++) { 
            slots.push(`${h.toString().padStart(2, '0')}:00`); 
            slots.push(`${h.toString().padStart(2, '0')}:30`); 
        }
        return slots;
    },

    isSlotFree(machine, date, start, duration) {
        const bookings = localBookings.filter(b => b.machineType === machine && b.date === date);
        const reqStart = utils.timeToMins(start);
        const reqEnd = reqStart + parseInt(duration);
        
        return !bookings.some(b => {
            const bStart = utils.timeToMins(b.startTime);
            const bEnd = bStart + parseInt(b.duration);
            return (reqStart < bEnd && reqEnd > bStart);
        });
    },

    canUserBook(userName) {
        // --- MODIFICARE AICI: Limita schimbată la 4 ---
        const limit = 4; 
        const today = new Date().toISOString().split('T')[0];
        // Numaram doar rezervarile active (de azi inainte)
        const userBookings = localBookings.filter(b => 
            b.userName.toLowerCase() === userName.toLowerCase() && b.date >= today
        );
        return userBookings.length < limit;
    }
};

const ui = {
    currentDate: new Date().toISOString().split('T')[0],
    
    init() {
        this.setupEventListeners();
        
        const dateInput = document.getElementById('bookingDate');
        const today = new Date().toISOString().split('T')[0];
        dateInput.min = today;
        dateInput.value = this.currentDate;
        
        this.updateDateDisplay();
        
        // --- VERIFICARE MIEZUL NOPȚII ---
        this.startMidnightWatcher();

        // Calculam data de ieri pentru a incarca doar rezervarile recente
        const d = new Date(); 
        d.setDate(d.getDate() - 1); 
        const yesterday = d.toISOString().split('T')[0];

        // 1. ASCULTARE REZERVARI
        const q = query(bookingsCollection, where("date", ">=", yesterday), orderBy("date"), orderBy("startTime"));
        onSnapshot(q, (snapshot) => {
            localBookings = [];
            snapshot.docs.forEach(doc => localBookings.push({ ...doc.data(), id: doc.id }));
            
            const loader = document.getElementById('appLoader');
            if(loader) {
                loader.style.opacity = '0';
                setTimeout(() => loader.style.display = 'none', 500);
            }

            this.renderAll();
        }, (error) => { 
            console.error("Eroare Firebase:", error); 
            utils.showToast("Eroare conectare. Reîncarcă pagina.", "error"); 
        });

        // 2. ASCULTARE SETARI (MENTENANTA)
        onSnapshot(doc(db, "settings", "appState"), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                const maintenanceMode = data.maintenance || false;
                
                // Actualizam Switch-ul din admin panel
                document.getElementById('maintenanceToggle').checked = maintenanceMode;
                
                // Aratam/Ascundem overlay-ul
                // Daca e mentenanta SI nu suntem logati ca admin, blocam ecranul
                const overlay = document.getElementById('maintenanceOverlay');
                if (maintenanceMode && !isAdmin) {
                    overlay.style.display = 'flex';
                } else {
                    overlay.style.display = 'none';
                }
            }
        });
    },

    // Funcția care verifică fiecare minut dacă data s-a schimbat
    startMidnightWatcher() {
        setInterval(() => {
            const realToday = new Date().toISOString().split('T')[0];
            const dateInput = document.getElementById('bookingDate');
            
            // Dacă data minimă (azi) nu mai corespunde cu realitatea
            if (dateInput.min !== realToday) {
                dateInput.min = realToday;
                
                // Dacă utilizatorul era pe ziua de "ieri", îl mutăm pe "azi"
                if (this.currentDate < realToday) {
                    this.currentDate = realToday;
                    dateInput.value = realToday;
                    this.updateDateDisplay();
                    this.renderAll();
                    utils.showToast('Zi nouă! Calendarul s-a actualizat.');
                }
            }
        }, 60000); // 60000 ms = 1 minut
    },

    setupEventListeners() {
        document.getElementById('bookingForm').addEventListener('submit', this.handleBooking.bind(this));
        
        document.getElementById('prevDay').onclick = () => this.changeDate(-1);
        document.getElementById('nextDay').onclick = () => this.changeDate(1);
        
        // Verificare vizuală la schimbarea orei manuale
        const timeInput = document.getElementById('startTime');
        if (timeInput) {
            timeInput.addEventListener('change', () => {
                const machine = document.getElementById('machineType').value;
                const date = document.getElementById('bookingDate').value;
                const start = timeInput.value;
                const duration = document.getElementById('duration').value;

                if (machine && date && start) {
                    if (!logic.isSlotFree(machine, date, start, duration)) {
                        utils.showToast('⚠️ Ora selectată se suprapune!', 'error');
                        timeInput.style.borderColor = 'var(--danger)';
                    } else {
                        timeInput.style.borderColor = 'var(--success)';
                    }
                }
            });
        }
        
        document.getElementById('bookingDate').onchange = (e) => { 
            this.currentDate = e.target.value; 
            this.updateDateDisplay(); 
            this.renderAll(); 
        };
        
        document.getElementById('machineType').onchange = () => {
             document.getElementById('startTime').style.borderColor = 'var(--border)';
        };

        document.getElementById('userName').oninput = () => this.renderMyBookings();
        
        document.querySelectorAll('.modal-close').forEach(btn => btn.onclick = () => {
            document.getElementById('modalOverlay').style.display = 'none';
            document.getElementById('confirmModal').style.display = 'none';
            document.getElementById('adminModal').style.display = 'none';
        });

        // Admin Maintenance Toggle
        document.getElementById('maintenanceToggle').onchange = async (e) => {
            const isChecked = e.target.checked;
            try {
                // Salvam starea in baza de date 'settings/appState'
                await setDoc(doc(db, "settings", "appState"), { maintenance: isChecked });
                utils.showToast(isChecked ? "Mentenanță ACTIVATĂ" : "Mentenanță DEZACTIVATĂ");
            } catch (err) {
                console.error(err);
                utils.showToast("Eroare la salvarea setării.", "error");
                e.target.checked = !isChecked; // Revert switch on error
            }
        };

        // Butonul secret de pe ecranul de mentenanta
        document.getElementById('maintenanceAdminBtn').onclick = () => {
             document.getElementById('modalOverlay').style.display = 'flex';
             document.getElementById('adminModal').style.display = 'block';
             document.getElementById('phoneModal').style.display = 'none';
             document.getElementById('confirmModal').style.display = 'none';
        };
        
        const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        if(cancelDeleteBtn) cancelDeleteBtn.onclick = () => {
            document.getElementById('modalOverlay').style.display = 'none';
            document.getElementById('confirmModal').style.display = 'none';
            deleteId = null;
        };

        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        if(confirmDeleteBtn) confirmDeleteBtn.onclick = async () => {
            if (deleteId) {
                try {
                    await deleteDoc(doc(db, "rezervari", deleteId));
                    utils.showToast('Rezervare ștearsă.');
                } catch (e) {
                    console.error(e);
                    utils.showToast('Eroare la ștergere', 'error');
                }
                document.getElementById('modalOverlay').style.display = 'none';
                document.getElementById('confirmModal').style.display = 'none';
                deleteId = null;
            }
        };

        document.getElementById('adminToggleBtn').onclick = () => { 
            document.getElementById('modalOverlay').style.display = 'flex'; 
            document.getElementById('phoneModal').style.display = 'none'; 
            document.getElementById('confirmModal').style.display = 'none';
            document.getElementById('adminModal').style.display = 'block'; 
        };
        document.getElementById('adminLoginBtn').onclick = this.handleAdminLogin.bind(this);
        document.getElementById('adminLogoutBtn').onclick = () => { 
            isAdmin = false;
            document.getElementById('adminContent').style.display = 'none'; 
            document.getElementById('adminLoginForm').style.display = 'block'; 
            document.getElementById('adminPassword').value = ''; 
            
            // Daca e mentenanta, re-afisam overlay-ul cand face logout
            const toggle = document.getElementById('maintenanceToggle');
            if(toggle && toggle.checked) {
                document.getElementById('maintenanceOverlay').style.display = 'flex';
                document.getElementById('modalOverlay').style.display = 'none';
            }
        };
    },

    changeDate(days) {
        const date = new Date(this.currentDate);
        date.setDate(date.getDate() + days);
        const newDateStr = date.toISOString().split('T')[0];
        
        const today = new Date().toISOString().split('T')[0];
        if (newDateStr < today) {
            utils.showToast('Nu poți vedea programul din trecut.', 'error');
            return;
        }

        this.currentDate = newDateStr;
        document.getElementById('bookingDate').value = this.currentDate;
        this.updateDateDisplay(); 
        this.renderAll(); 
    },

    updateDateDisplay() { 
        const display = document.getElementById('currentDateDisplay'); 
        const today = new Date().toISOString().split('T')[0]; 
        display.textContent = (this.currentDate === today) ? "Astăzi" : utils.formatDateRO(this.currentDate); 
    },

    async handleBooking(e) {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn.innerHTML;
        
        // Dezactivare buton
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0;display:inline-block;"></div> Procesare...';

        try {
            let userName = document.getElementById('userName').value.trim();
            const phone = document.getElementById('phoneNumber').value.trim();
            const machine = document.getElementById('machineType').value;
            const start = document.getElementById('startTime').value;
            const duration = parseInt(document.getElementById('duration').value);

            if (!start) {
                utils.showToast('Te rog selectează ora!', 'error');
                return;
            }

            userName = utils.capitalize(userName);

            // Curatam numarul de telefon
            const cleanPhone = phone.replace(/\D/g, '');

            if (cleanPhone.length !== 10) { 
                utils.showToast('Număr invalid (10 cifre)', 'error'); 
                return; 
            }
            
            if (!logic.canUserBook(userName)) {
                // --- MODIFICARE AICI: Mesajul de eroare actualizat ---
                utils.showToast('Ai atins limita de 4 rezervări active!', 'error');
                return;
            }

            if (!logic.isSlotFree(machine, this.currentDate, start, duration)) { 
                utils.showToast('Slot ocupat! Verifică orarul.', 'error'); 
                return; 
            }

            await addDoc(bookingsCollection, { 
                userName, 
                phoneNumber: cleanPhone, 
                machineType: machine, 
                date: this.currentDate, 
                startTime: start, 
                duration: duration, 
                createdAt: new Date().toISOString() 
            });
            utils.showToast('Rezervare salvată!');
            e.target.reset(); 
            document.getElementById('userName').value = userName; 
            document.getElementById('bookingDate').value = this.currentDate;
            document.getElementById('startTime').style.borderColor = 'var(--border)';
            // Eliminam selectia vizuala
            document.querySelectorAll('.selected-slot').forEach(el => el.classList.remove('selected-slot'));
            
        } catch (error) { 
            console.error(error); 
            utils.showToast('Eroare server.', 'error'); 
        } finally {
            // Reactivare buton
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
        }
    },

    renderAll() { this.renderSchedule(); this.renderMyBookings(); this.renderUpcoming(); if (document.getElementById('adminContent').style.display === 'block') { this.renderAdminList(); } },

    renderSchedule() {
        const grid = document.getElementById('scheduleGrid'); grid.innerHTML = '';
        const slots = logic.generateSlots();
        const bookings = localBookings.filter(b => b.date === this.currentDate);

        Object.keys(logic.machines).forEach(machineKey => {
            const col = document.createElement('div'); col.className = 'machine-column';
            const header = document.createElement('div'); header.className = 'machine-header';
            header.innerHTML = `<small>${machineKey.includes('masina') ? '🧺' : '🌬️'}</small><br>${logic.machines[machineKey]}`; col.appendChild(header);

            slots.forEach(slot => {
                const slotMins = utils.timeToMins(slot); 
                const nextSlotMins = slotMins + 30; 

                const booking = bookings.find(b => {
                    if (b.machineType !== machineKey) return false;
                    const bStart = utils.timeToMins(b.startTime);
                    const bEnd = bStart + parseInt(b.duration);   
                    return (bStart < nextSlotMins && bEnd > slotMins);
                });

                const div = document.createElement('div'); div.className = `time-slot ${booking ? 'occupied' : 'available'}`;
                
                if (booking) {
                    const bStart = utils.timeToMins(booking.startTime);
                    const bEnd = bStart + parseInt(booking.duration);
                    
                    const isStartOfBookingInGrid = (bStart >= slotMins && bStart < nextSlotMins) || (bStart < slotMins && slotMins === 0);

                    if (bStart >= slotMins) div.classList.add('booking-start'); 
                    if (bEnd <= nextSlotMins) div.classList.add('booking-end'); 
                    if (bStart < slotMins && bEnd > nextSlotMins) div.classList.add('booking-middle');

                    if (isStartOfBookingInGrid) { 
                        const endTime = utils.minsToTime(bEnd); 
                        div.innerHTML = `<div class="slot-content"><span class="slot-time">${booking.startTime} - ${endTime}</span><span class="slot-name">${booking.userName}</span></div>`; 
                    }
                    div.title = `Rezervat: ${booking.userName} (${booking.startTime})`; 
                    div.onclick = () => this.showPhoneModal(booking);
                } else {
                    div.textContent = slot;
                    div.onclick = (e) => {
                        document.getElementById('machineType').value = machineKey; 
                        document.getElementById('duration').value = "60"; 
                        document.getElementById('startTime').value = slot; 
                        
                        document.querySelector('.booking-card').scrollIntoView({behavior: 'smooth', block: 'center'}); 
                        document.querySelector('.booking-card').classList.add('highlight-pulse'); 
                        setTimeout(() => document.querySelector('.booking-card').classList.remove('highlight-pulse'), 1000); 

                        // Visual selection
                        document.querySelectorAll('.selected-slot').forEach(el => el.classList.remove('selected-slot'));
                        e.target.classList.add('selected-slot');
                    };
                }
                col.appendChild(div);
            });
            grid.appendChild(col);
        });
    },

    showPhoneModal(booking) { 
        document.getElementById('modalUserName').textContent = booking.userName; 
        document.getElementById('modalPhoneNumber').textContent = booking.phoneNumber; 
        document.getElementById('callPhoneBtn').href = `tel:${booking.phoneNumber}`; 
        document.getElementById('copyPhoneBtn').onclick = () => { 
            navigator.clipboard.writeText(booking.phoneNumber).then(() => { utils.showToast('Număr copiat!'); }); 
        }; 
        document.getElementById('adminModal').style.display = 'none'; 
        document.getElementById('confirmModal').style.display = 'none';
        document.getElementById('modalOverlay').style.display = 'flex'; 
        document.getElementById('phoneModal').style.display = 'block'; 
    },

    confirmDelete(id) {
        deleteId = id;
        document.getElementById('modalOverlay').style.display = 'flex';
        document.getElementById('phoneModal').style.display = 'none';
        document.getElementById('adminModal').style.display = 'none';
        document.getElementById('confirmModal').style.display = 'block';
    },

    renderMyBookings() { 
        const container = document.getElementById('myBookings'); 
        const currentUser = document.getElementById('userName').value.trim().toLowerCase(); 
        if (!currentUser) { container.innerHTML = '<div class="empty-state">Introdu numele pentru a vedea rezervările.</div>'; return; } 
        const bookings = localBookings.filter(b => b.userName.toLowerCase().includes(currentUser)).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime)); 
        container.innerHTML = bookings.length ? bookings.map(b => {
             const endMins = utils.timeToMins(b.startTime) + parseInt(b.duration);
             const endTime = utils.minsToTime(endMins);
             return `<div class="booking-item"><div class="booking-info"><strong>${logic.machines[b.machineType]}</strong><span>${utils.formatDateRO(b.date)} • ${b.startTime} - ${endTime}</span></div><button class="btn-delete" onclick="window.app.confirmDelete('${b.id}')">Anulează</button></div>`;
        }).join('') : '<div class="empty-state">Nu am găsit rezervări.</div>'; 
    },

    renderUpcoming() { 
        const container = document.getElementById('upcomingBookings'); 
        const today = new Date().toISOString().split('T')[0]; 
        const bookings = localBookings.filter(b => b.date > today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5); 
        container.innerHTML = bookings.length ? bookings.map(b => `<div class="booking-item"><div class="booking-info"><strong>${b.userName}</strong><span>${utils.formatDateRO(b.date)} • ${logic.machines[b.machineType]}</span></div></div>`).join('') : '<div class="empty-state">Nimic planificat.</div>'; 
    },

    async handleAdminLogin() { 
        const input = document.getElementById('adminPassword').value; 
        const hash = await utils.sha256(input); 
        
        if (hash === ADMIN_HASH) { 
            isAdmin = true;
            document.getElementById('adminLoginForm').style.display = 'none'; 
            document.getElementById('adminContent').style.display = 'block'; 
            // ASCUNDE MENTENANTA PENTRU ADMIN
            document.getElementById('maintenanceOverlay').style.display = 'none';
            this.renderAdminList(); 
            utils.showToast('Login admin reușit!'); 
        } else { 
            utils.showToast('Parolă greșită', 'error'); 
        } 
    },

    renderAdminList() { 
        const list = document.getElementById('adminBookingsList'); 
        const bookings = [...localBookings].sort((a, b) => b.date.localeCompare(a.date)); 
        list.innerHTML = bookings.length ? bookings.map(b => {
             const endMins = utils.timeToMins(b.startTime) + parseInt(b.duration);
             const endTime = utils.minsToTime(endMins);
             return `<div class="booking-item"><div class="booking-info"><strong>${b.userName} (${b.phoneNumber})</strong><span>${b.date} • ${b.startTime} - ${endTime} • ${logic.machines[b.machineType]}</span></div><button class="btn-delete" onclick="window.app.confirmDelete('${b.id}')">Șterge</button></div>`;
        }).join('') : '<div class="empty-state">Nu sunt rezervări.</div>'; 
    }
};

window.app = ui; 
document.addEventListener('DOMContentLoaded', () => ui.init());