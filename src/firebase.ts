import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDSGnWe5lCYNZfYKj3r1NJ2eTrnLKSgDwc",
  authDomain: "clara-health-19fa3.firebaseapp.com",
  projectId: "clara-health-19fa3",
  storageBucket: "clara-health-19fa3.firebasestorage.app",
  messagingSenderId: "154401568827",
  appId: "1:154401568827:web:2b514ec0d2c1597f24041e",
  measurementId: "G-TN77J8SFCT"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const signOutUser = () => signOut(auth);
export { onAuthStateChanged, type User };
