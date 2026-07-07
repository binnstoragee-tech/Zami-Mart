// =============================================
// Zami Mart — Firebase Initialization (shared)
// Loaded as <script type="module"> on every page that
// needs real-time data (inquiries + chat).
// Exposes a small set of Firestore helpers on window.fb
// so plain (non-module) scripts like chat-system.js and
// inquiry-system.js can use them, and fires a "fb-ready"
// event once everything is wired up.
// =============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAnalytics, isSupported as analyticsIsSupported } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-analytics.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  where,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDFayXb4VTQPgHVreyeXBnDLqdbt_BS_RE",
  authDomain: "zami-mart.firebaseapp.com",
  projectId: "zami-mart",
  storageBucket: "zami-mart.firebasestorage.app",
  messagingSenderId: "596373642018",
  appId: "1:596373642018:web:e9dad8a8fdf813a3cfe37b",
  measurementId: "G-EJKKWMNKSX"
};

// =============================================
// VISIBLE ERROR BANNER
// Shows Firebase errors directly on the page (no devtools needed).
// Any script (module or plain) can call window.zmShowFbError(message).
// =============================================
window.zmShowFbError = function(message) {
  console.error('[Firebase]', message);
  let bar = document.getElementById('zmFbErrorBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'zmFbErrorBar';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#d63030;color:#fff;font-family:sans-serif;font-size:13px;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;box-shadow:0 2px 8px rgba(0,0,0,.3);';
    const text = document.createElement('div');
    text.id = 'zmFbErrorText';
    text.style.cssText = 'flex:1;line-height:1.4;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#fff;font-size:16px;cursor:pointer;flex-shrink:0;';
    closeBtn.onclick = () => bar.remove();
    bar.appendChild(text);
    bar.appendChild(closeBtn);
    (document.body || document.documentElement).appendChild(bar);
  }
  document.getElementById('zmFbErrorText').textContent = '⚠️ Firebase error: ' + message;
};

let app, db, auth, storage;
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  storage = getStorage(app);
} catch (e) {
  window.zmShowFbError('Hindi na-initialize ang Firebase — ' + (e && e.message ? e.message : e));
}

// Analytics only works on https/localhost and needs browser support — guard it
// so it never breaks the app on file:// or unsupported browsers.
analyticsIsSupported().then((ok) => { if (ok) { try { getAnalytics(app); } catch (e) {} } }).catch(() => {});

window.fb = {
  app, db,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  onSnapshot, query, orderBy, where, increment, serverTimestamp,
  auth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  storage, storageRef, uploadBytes, uploadBytesResumable, getDownloadURL
};

// =============================================
// GOOGLE SIGN-IN
// Plain (non-module) scripts like the login page's inline <script>
// can call window.zmSignInWithGoogle() — it returns the Firebase
// user object (displayName, email, photoURL, uid) on success.
// =============================================
window.zmSignInWithGoogle = async function () {
  if (!auth) throw new Error('Firebase Auth hindi pa ready.');
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
};

window.zmSignOutGoogle = function () {
  if (!auth) return Promise.resolve();
  return signOut(auth);
};

// Let any already-waiting non-module scripts know Firebase is ready.
window.dispatchEvent(new Event('fb-ready'));

// =============================================
// AUTO-SAVE USER TO FIRESTORE on sign-in
// When any user logs in (Google or email), save
// their basic info to Firestore users/{uid} so
// the admin panel can list registered users.
// =============================================
if (auth && db) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        displayName: user.displayName || '',
        email: user.email || '',
        photoURL: user.photoURL || '',
        createdAt: user.metadata.creationTime || new Date().toISOString(),
        lastLogin: new Date().toISOString(),
      }, { merge: true });
    } catch(e) { /* non-fatal */ }
  });
}

// =============================================
// CONNECTIVITY SELF-TEST
// Tries a real write the moment the page loads, so if Firestore rules,
// billing, or project setup are wrong, the user SEES the real error
// immediately instead of silently failing when they click "Send Inquiry".
// =============================================
if (db) {
  (async () => {
    try {
      await setDoc(doc(db, '_connectionTest', 'ping'), { at: new Date().toISOString() });
      const existingBar = document.getElementById('zmFbErrorBar');
      if (existingBar) existingBar.remove(); // clear any earlier error, connection is fine
    } catch (e) {
      const code = e && e.code ? e.code : '';
      let hint = '';
      if (code === 'permission-denied') {
        hint = ' (Firestore rules ang nag-block — i-check ang Rules tab sa Firebase Console, baka expired na ang test mode o naka-locked.)';
      } else if (code === 'unavailable') {
        hint = ' (Hindi maabot ang Firestore — check internet connection o baka naka-block ng firewall/extension ang Google domains.)';
      } else if (code === 'not-found') {
        hint = ' (Wala pang Firestore database na ginawa para sa project — gawin muna sa Firebase Console > Firestore Database > Create database.)';
      }
      window.zmShowFbError((e && e.message ? e.message : String(e)) + hint);
    }
  })();
}

// =============================================
// STORAGE CONNECTIVITY SELF-TEST
// Tries a tiny real upload the moment the page loads, so if Storage isn't
// provisioned or its Rules block writes — a very common gotcha, since chat
// visitors are NOT signed in to Firebase Auth — the user sees the real
// error immediately instead of only discovering it when a customer tries
// to send a photo/file and it just spins forever.
// =============================================
if (storage) {
  (async () => {
    try {
      const testRef = storageRef(storage, '_connectionTest/storage_ping.txt');
      await uploadBytes(testRef, new Blob(['ping'], { type: 'text/plain' }));
      await deleteObject(testRef).catch(() => {});
    } catch (e) {
      const code = e && e.code ? e.code : '';
      let hint = '';
      if (code === 'storage/unauthorized') {
        hint = ' (Storage Rules ang nag-block ng pag-upload — dahil hindi naka-login ang mga customer sa chat widget, kailangang payagan ng Rules ang writes papunta sa chatUploads/ kahit walang request.auth.)';
      } else if (code === 'storage/unknown' || code === 'storage/retry-limit-exceeded') {
        hint = ' (Baka wala pang Firebase Storage na na-provision para sa project na ito — puntahan ang Firebase Console > Storage > Get Started.)';
      } else if (code === 'storage/bucket-not-found' || code === 'storage/project-not-found') {
        hint = ' (Mali o wala pang Storage bucket na naka-setup para sa project.)';
      }
      window.zmShowFbError('Firebase Storage: ' + (e && e.message ? e.message : String(e)) + hint);
    }
  })();
}
