
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, setDoc, onSnapshot, query, orderBy, where, runTransaction, writeBatch, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { FIREBASE_CONFIG } from './config.js';

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const analytics = getAnalytics(app);
let auth = null;
try {
    auth = getAuth(app);
} catch (e) {
    console.warn("Auth initialization failed:", e);
}
const bookingsCollection = collection(db, "rezervari");

export const firebaseService = {
    app,
    db,
    analytics,
    auth,
    bookingsCollection,
    logEvent,
    addDoc,
    deleteDoc,
    doc,
    setDoc,
    onSnapshot,
    query,
    orderBy,
    where,
    runTransaction,
    writeBatch,
    limit,
    getDocs,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
};
