import { ui } from './ui.js';
import { i18n } from './i18n.js';

// Setup language button initial text
document.addEventListener('DOMContentLoaded', () => {
    const langBtn = document.getElementById('langToggleBtn');
    if (langBtn) {
        langBtn.textContent = i18n.currentLang === 'ro' ? 'EN' : 'RO';
        langBtn.onclick = () => {
            const newLang = i18n.currentLang === 'ro' ? 'en' : 'ro';
            i18n.setLang(newLang);
            langBtn.textContent = newLang === 'ro' ? 'EN' : 'RO';
            ui.applyTranslations(); // Apply dynamically
            ui.updateDateDisplay();
            ui.renderAll(); // Rerender dynamic lists
        };
    }
    
    // Initial translation application
    ui.applyTranslations();
});
