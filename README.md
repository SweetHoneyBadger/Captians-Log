# Captain's log: setup guide

This puts your Captain's log on its own website. You sign in from any phone or computer, and your log syncs between them. It's private: only you can see your entries, even if someone else uses the same site.

**If you've already set up the baby log on GitHub and Firebase,** this takes about 10 minutes. It uses the same GitHub account and the same Firebase project, so you skip most of the setup. Follow the steps below.

**If you haven't set up the baby log,** follow steps 1 to 8 of the baby log's setup guide first, using this folder's files instead. Then come back here for step 5 below.

---

## 1. Make a new repository

1. On **github.com**, click the **+** in the top right, then **New repository**.
2. Name it `captains-log` and leave it **Public**. Only the app's code is public; your entries are stored in Firebase, never on GitHub.
3. Click **Create repository**.

## 2. Upload the files

1. Click **uploading an existing file**.
2. Unzip the download and drag **all the files** from the folder onto the page: `index.html`, `app.js`, `firebase-config.js`, `firestore.rules`, `manifest.webmanifest`, the three `.png` icons, and this `README.md`.
3. Click **Commit changes**.

## 3. Add your Firebase settings

You can reuse the exact same settings as the baby log.

1. In your **baby-log** repository, open `firebase-config.js` and copy everything in it.
2. In your new **captains-log** repository, open `firebase-config.js`, click the **pencil icon**, replace everything with what you copied, and click **Commit changes**.

## 4. Turn on GitHub Pages

1. In the **captains-log** repository, go to **Settings → Pages**.
2. Set **Source** to **Deploy from a branch**, the branch to **main**, and the folder to **/ (root)**. Click **Save**.
3. After a minute or two, your address appears, like `https://tori-smith.github.io/captains-log/`.

You don't need to add anything in Firebase's authorized domains. It's the same `github.io` address the baby log already uses.

## 5. Update the security rules

The rules file in this folder includes everything the baby log needs plus the Captain's log, so it replaces your current rules.

1. In Firebase, open **Firestore Database → Rules**.
2. Delete everything in the editor.
3. Copy all of `firestore.rules` from this folder, paste it in, and click **Publish**.

## 6. Start logging

1. Open your Captain's log address and sign in. If you use the same Google account or email as the baby log, you'll have one sign-in for both apps.
2. **Bring over what you've already logged:** in the Claude version, open settings and tap **Download backup**. Then in the new site, open settings and tap **Restore from backup**. Your entries and photos come with it.
3. **Put it on your home screen:**
   - **iPhone:** open it in Safari, tap **Share**, then **Add to Home Screen**.
   - **Android:** open it in Chrome, tap the **⋮** menu, then **Add to home screen**.

Entries you make with no signal are saved on your phone and sync when you're back online.

---

## If something goes wrong

- **"Almost there"** on the site: `firebase-config.js` still has `PASTE` values. Redo step 3, wait two minutes, and refresh.
- **Signed in, but the page stays on "Opening your log…" or nothing saves:** the rules weren't updated. Redo step 5.
- **"This web address isn't approved in Firebase yet":** in Firebase, go to **Authentication → Settings → Authorized domains** and add your `github.io` address (for example `tori-smith.github.io`).
- **Google sign-in doesn't work on iPhone:** use email and password instead.

## Updating the app later

Upload a new `app.js` or `index.html` to the repository the same way as step 2. Don't replace `firebase-config.js`.
