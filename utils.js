
// Utility Functions

export const utils = {
    showToast(message, type = 'success') {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        setTimeout(() => toast.classList.remove('show'), 3000);
    },
    formatDateRO(dateStr) {
        const options = { weekday: 'long', day: 'numeric', month: 'long' };
        const lang = localStorage.getItem('lang') === 'en' ? 'en-US' : 'ro-RO';
        return new Date(dateStr + 'T12:00:00').toLocaleDateString(lang, options);
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
    addDays(dateStr, days) {
        const date = new Date(dateStr + 'T12:00:00');
        date.setDate(date.getDate() + days);
        return date.toISOString().split('T')[0];
    },
    capitalize(str) {
        if (!str) return '';
        return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    },
    escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
    escapeCsvCell(str) {
        if (str == null) return '';
        const s = String(str);
        if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    },
    /** Hash PIN cu SHA-256 + salt (bookingId) – nu stocăm niciodată PIN-ul în clar. */
    async hashPin(pin, salt = '') {
        if (!pin || typeof pin !== 'string') return '';
        const enc = new TextEncoder().encode(pin + salt);
        const buf = await crypto.subtle.digest('SHA-256', enc);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    /** Mapează machineType la cheia de traducere i18n. */
    getMachineKey(type) {
        const map = { masina1: 'machine1', masina2: 'machine2', uscator1: 'dryer1', uscator2: 'dryer2' };
        return map[type] || type;
    }
};
