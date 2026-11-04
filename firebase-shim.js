// Claude artifact এর claude.use('user' | 'db' | 'downloads') কে Firebase দিয়ে চালানোর সেতু
(function () {
  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const fs = firebase.firestore();
  const OWNER = String(window.OWNER_EMAIL || '').toLowerCase();

  let me = null;
  const ready = new Promise(res => auth.onAuthStateChanged(u => { me = u; res(u); }));
  const isOwner = () => !!(me && me.emailVerified && (me.email || '').toLowerCase() === OWNER);

  async function myRole() {
    if (!me) return null;
    try {
      const s = await fs.doc('roles/' + me.uid).get();
      return s.exists ? s.data().role : null;
    } catch (e) { return null; }
  }

  const userApi = {
    id: async () => { if (!me) throw new Error('not signed in'); return me.uid; },
    role: async () => { if (!me) return null; if (isOwner()) return 'admin'; return await myRole(); },
    canEdit: async () => { if (!me) return false; if (isOwner()) return true; return (await myRole()) === 'admin'; },
    profiles: async (ids) => {
      const out = {};
      for (const id of ids) {
        if (me && id === me.uid) { out[id] = { email: me.email, name: me.displayName || '', displayName: me.displayName || '' }; continue; }
        try { const s = await fs.doc('requests/' + id).get(); out[id] = s.exists ? { email: s.data().email || '', name: s.data().name || '' } : {}; }
        catch (e) { out[id] = {}; }
      }
      return out;
    }
  };

  const dbApi = {
    collection: c => fs.collection(c),
    doc: path => {
      const ref = fs.doc(path);
      return {
        get: () => ref.get(),
        onSnapshot: (a, b) => ref.onSnapshot(a, b),
        delete: () => ref.delete(),
        acquire: async () => ({ acquired: true }),
        set: async d => {
          if (path.startsWith('requests/') && me) d = Object.assign({}, d, { email: me.email || '' });
          return ref.set(d);
        },
        update: async d => {
          await ref.update(d);
          // মালিক অনুরোধ approve করলে সেই ব্যক্তিকে admin role দেওয়া হয়
          if (path.startsWith('requests/') && isOwner() && d.status) {
            const uid = path.split('/')[1];
            if (d.status === 'approved') await fs.doc('roles/' + uid).set({ role: 'admin' });
            else if (d.status === 'viewer') await fs.doc('roles/' + uid).set({ role: 'viewer' });
            else if (d.status === 'declined') { try { await fs.doc('roles/' + uid).delete(); } catch (e) {} }
          }
        }
      };
    }
  };

  const downloadsApi = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data], { type: /\.json$/.test(filename) ? 'application/json' : /\.csv$/.test(filename) ? 'text/csv;charset=utf-8' : 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return true;
    }
  };

  window.claude = {
    use: async name => {
      await ready;
      if (name === 'user') return userApi;
      if (name === 'db') return me ? dbApi : null;
      if (name === 'downloads') return downloadsApi;
      return null;
    }
  };

  // লগইন বাটনে (Continue) চাপলে Google sign-in চালু হবে
  document.addEventListener('click', async e => {
    const b = e.target.closest && e.target.closest('#gl-b');
    if (!b || me) return;
    e.preventDefault(); e.stopPropagation();
    const p = new firebase.auth.GoogleAuthProvider();
    try { await auth.signInWithPopup(p); location.reload(); }
    catch (err) {
      if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) auth.signInWithRedirect(p);
      else alert('Login hoyni: ' + (err.message || err.code));
    }
  }, true);
})();
