// Claude artifact এর claude.use('user' | 'db' | 'downloads') কে Firebase দিয়ে চালানোর সেতু
(function () {
  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const fs = firebase.firestore();
  // আগের বার দেখা ডেটা ফোনে জমা থাকে => পরের বার খুললে সাথে সাথে দেখায়, তারপর নতুন ডেটা আসে
  try { fs.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (e) {}
  const OWNER = String(window.OWNER_EMAIL || '').toLowerCase();

  let me = null;
  const ready = new Promise(res => auth.onAuthStateChanged(u => { me = u; if (u) setTimeout(() => { try { loadRole(); } catch (e) {} }, 0); res(u); }));
  const isOwner = () => !!(me && me.emailVerified && (me.email || '').toLowerCase() === OWNER);

  // admins/{uid} = admin, memberLogins/{uid} = linked member, roles/{uid} = old admin list (read only)
  // admins/{uid} = admin, memberLogins/{uid} = linked member, roles/{uid} = old admin list (read only)
  // তিনটা একসাথে (parallel) পড়া হয় এবং ফল একবারই জমা রাখা হয়
  let roleP = null, infoP = null;
  const safe = p => p.then(s => s, () => null);
  function loadRole() {
    if (!me) return Promise.resolve({ role: null, info: null });
    if (!roleP) {
      roleP = Promise.all([
        safe(fs.doc('admins/' + me.uid).get()),
        safe(fs.doc('memberLogins/' + me.uid).get()),
        safe(fs.doc('roles/' + me.uid).get())
      ]).then(([a, m, l]) => {
        if (a && a.exists) return { role: 'admin', info: null };
        if (m && m.exists) return { role: 'member', info: m.data() };
        if (l && l.exists && l.data().role === 'admin') return { role: 'admin', info: null };
        return { role: null, info: null };
      });
    }
    return roleP;
  }
  const myRole = async () => (await loadRole()).role;
  const myInfo = async () => (await loadRole()).info;

  const userApi = {
    info: async () => myInfo(),
    signOut: async () => { try { await auth.signOut(); } catch (e) {} try { await fs.terminate(); await fs.clearPersistence(); } catch (e) {} location.reload(); },
    email: async () => (me && me.email) || '',
    id: async () => { if (!me) throw new Error('not signed in'); return me.uid; },
    isOwner: async () => isOwner(),
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
          // মালিক অনুরোধ approve করলে "admins" এ সেই ব্যক্তির তথ্য (নাম, ইমেইল, ফোন) জমা হয়
          if (path.startsWith('requests/') && isOwner() && d.status) {
            const uid = path.split('/')[1];
            if (d.status === 'approved') {
              let q = {}; try { const s = await ref.get(); q = s.exists ? s.data() : {}; } catch (e) {}
              await fs.doc('admins/' + uid).set({ role: 'admin', name: q.name || '', email: q.email || '', phone: q.phone || '', at: new Date().toISOString() });
            } else if (d.status === 'declined') { try { await fs.doc('admins/' + uid).delete(); } catch (e) {} }
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
