# How Snippet Book protects your data (Version 2)

[日本語](how-it-works.md) | **English**

This document describes the key handling and encryption inside `app/snippet-book.html`. In the code, this is the part between `/*<core>` and `/*</core>*/` and the "Passkey (WebAuthn PRF)" part below it.

## 1. Building blocks

- Only the browser's WebCrypto (`crypto.subtle`) and WebAuthn (`navigator.credentials`) are used. No external libraries.
- Encryption: AES-GCM (256-bit)
- Key derivation: HKDF-SHA256 (passkey, recovery key), PBKDF2-SHA256 (per-file passwords, old-format files)

## 2. Keys

1. **Data key (DK)**: 32 bytes generated once with `crypto.getRandomValues` (not on every unlock). Everything you register is encrypted with this key using AES-GCM. The DK itself is never stored. On lock it is erased from memory (overwritten with zeros).
2. **Wrapping with a passkey**
   - When a passkey is registered, a random 32-byte input for the PRF extension is chosen.
   - After user verification, the passkey returns a 32-byte PRF output. This value can only be produced by that passkey, on this domain (`snippet.eiwa-up.jp`), for that input.
   - A wrapping key is derived with `HKDF-SHA256(PRF output, salt = random 16 bytes, info = "snippet-book/v5/passkey")`, and the DK is encrypted (wrapped) with AES-GCM.
3. **Wrapping with the recovery key**
   - The recovery key is 25 characters chosen from the 32 characters of Crockford Base32: 5 bits × 25 = 125 bits (the low 5 bits of each random byte are used, so there is no bias).
   - When reading, lower case, spaces and `-` are accepted; `O` is read as `0`, and `I` and `L` as `1`.
   - A wrapping key is derived with `HKDF-SHA256(recovery key, salt = random 16 bytes, info = "snippet-book/v5/recovery")`, and the DK is wrapped.
   - With 125 random bits, brute force is not practical, so no slow key stretching (such as PBKDF2) is applied.

Unwrapping either wrap yields the same DK.

## 3. What is stored

On the device (localStorage):

```
snippet-book:v5:meta = {
  version: 5,
  vaultId: random 16 bytes (base64url),
  wraps: [
    { type: "recovery", salt, iv, ct, created },
    { type: "passkey", credId, prfSalt, label, salt, iv, ct, created },
    …
  ],
  data: { iv, ct },      // contents encrypted with the DK (in the same item since 2.00.008)
  revoked: [credId, …],  // removed passkeys (2.00.009+, also in backups)
  history: [{ at, device, browser, kind, how?, tag? }, …],  // 2.00.010+ backup (obk/bk) and open (open/view) history
  rev: integer           // 2.01.002+ update counter, +1 on every write
}
```

Backup file:

```
{ version: 5, enc: "aes-gcm", kdf: "dk-wrap", mode, role?, name, vaultId, wraps: [...], iv, ct, auth }
```

- `wraps` contains only the wrapped DK. **The PRF output and the recovery key itself are never stored anywhere.**
- A backup file alone therefore cannot be read; you need a passkey (including a synced one) or the recovery key.
- Because of AES-GCM, flipping even one bit of the contents makes them impossible to open.

## 4. Passkeys

- `rp.id` is the page's domain (`snippet.eiwa-up.jp`). Other domains cannot obtain this passkey's PRF output.
- Registration uses `residentKey: required`, `userVerification: required`, `attestation: none`.
- No server is involved. The challenge is created on the spot and nobody verifies it; the passkey is used only to "verify the user and obtain the PRF output".
- Some platforms do not return the PRF output at registration, so the app performs one user verification right after registering to obtain it.
- On platforms without PRF support, registration may appear to succeed but `prf.enabled` is `false`. In that case no wrap is created and the user is told it is not supported.
- Already registered credentials are passed in `excludeCredentials` to avoid registering the same device twice.

## 5. What is and is not protected

| Event | Result |
|---|---|
| A backup file is stolen and brute-forced | Not readable (the keys are long and random) |
| Someone watches or keylogs while you unlock | Nothing to capture when using a passkey (nothing is typed) |
| The device is taken while unlocked | Can be opened with the passkey (the device's screen lock matters) |
| Both the recovery key and a backup are taken | Readable (keep them in separate places) |
| A malicious script is injected into the page (XSS etc.) | The CSP allows exactly one script by hash, so injected scripts do not run (2.00.003+) |
| The served page itself is replaced | Readable. Cannot be prevented before opening; verify (hourly) notices afterwards. Mitigated by limiting who can update (the owner only) and protecting the publishing accounts (server, GitHub, domain) with two-factor authentication |
| A shared-set file is obtained and its password brute-forced | Since 2.00.003 the password is 20 characters (~99 bits) and not practically breakable. Files made with 2.00.002 or earlier (~24.5-bit passwords) could be broken in minutes to hours on a strong GPU |

## 6. Other files

- **Shared sets and per-file passwords**: the key is derived from the password with PBKDF2-SHA256. New files use 600,000 iterations, and the count is written into the file.
  - The shared-set password is generated by the app (2.00.003+): 20 characters from the 31 characters `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (~99.1 bits). Bytes from `crypto.getRandomValues` at or above 248 are discarded to remove bias, and groups of five are separated by `-` (the `-` is part of the password).
  - A password chosen by the user for a file must be at least 12 characters.
  - When reading, the iteration count must be an integer between 100,000 and 2,000,000 and the salt 16–64 bytes; this is checked before any computation (2.01.002+).
- **Version 1 files**: opened with PBKDF2-SHA256, 250,000 iterations (no count recorded). Used only for importing.

## 6-2. Protection while the app is open (2.00.004+)

- **Auto-lock**: after a chosen period without activity (1, 5, 15 or 30 minutes, or never; 5 minutes by default) the app locks and erases the data key from memory. Time spent in other tabs or apps counts as inactivity. It is checked every 10 seconds and when you return to the page. While the recovery key screen is shown, the app waits longer, but locks after at most 10 minutes (2.01.008+).
- **Clearing the screen on lock (2.00.005+)**: on lock (manual or automatic, both via `lockNow`), `wipeScreen` removes all plaintext from the page's DOM: cards and edit fields (including password fields), set names, the search text, the data name, status messages, toasts, the shared-password dialog, the backup-complete dialog, the key settings, the recovery key dialog and inputs, a recovery key typed into the file-open dialog, and the print area. Dialogs that are waiting are closed and their pending work is ended.
  - JavaScript strings are cleaned up by the browser later, so exactly when they leave memory cannot be controlled.
- **Lock order (2.01.004+)**: `lockNow` first advances the lock counter, blurs the focused field, disables interaction (`inert`), wipes the screen and shows only "locking…". Only then does it wait for saving (at most 5 seconds, `LOCK_SAVE_WAIT_MS`). If the latest edit could not be saved, it is encrypted with the DK and kept (at most 2 more seconds, `LOCK_STASH_WAIT_MS`), and the key is erased. The lock always completes within about 7 seconds (2.01.005+).
- **Work interrupted by a lock (2.00.006+)**: each lock advances a counter (`lockEpoch`). Long-running operations (sharing a set, full export, overwrite backup, import, copy, passkey registration) remember the counter when they start; if it changed after an `await`, they finish without showing anything, writing a file or changing data.
- **Key operations and locks (2.00.007+)**: passkey registration, recovery key regeneration, "recreate all keys" and initial creation do the slow computations (wrapping, encrypting) first without touching anything else, then check the lock counter and, without any intervening `await`, write data and keys and update the screen. A lock therefore cannot interrupt a half-written state.
- **Browser dialogs (2.01.008+, 2.01.009+)**: all `confirm` / `prompt` calls go through `askConfirm` / `askPrompt`. If the auto-lock time passed while such a dialog was open, the app locks and stops the operation instead of treating it as "Cancel".
- **Clipboard**: passwords, recovery keys and shared-set passwords are cleared from the clipboard after 30 seconds (or not, if you choose). Browsers cannot write to the clipboard from a page that is not in front, so in that case the clear is scheduled and done when you come back. **If you never come back, the value remains.** Clipboard history (Windows Win+V, clipboard managers) and shared clipboards cannot be cleared.
- **Single write for data and keys (2.00.008+)**: the key information (`wraps`) and the encrypted contents (`data`) are stored together in `snippet-book:v5:meta` and written with one `localStorage.setItem`. A single write either fully happens or does not happen, so they cannot get out of step. If writing fails (storage full, etc.), nothing changes and the user is told; the app switches keys and screens only after the write succeeded. If the contents cannot be decrypted, the app never overwrites them with sample data.
- **Passkey lists across devices (2.00.009+)**: the passkey list is per device. A backup of the same vault can be used to merge lists ("merge passkeys from another device" or "open from overwrite backup"). Only passkey wraps are merged; the recovery wrap of the current device is kept. Removed passkeys are kept in `revoked` (also in backups) so they never come back. Lists are merged only from files that open with the current DK and whose MAC verifies (2.01.008+: files opened with keys contained in the file itself are never merged).
- **Tamper-evident backups (2.00.010+)**: an HMAC-SHA256 key is derived from the DK with HKDF (info `snippet-book/v5/auth`), and `auth: { v:1, mac }` is computed over everything except `auth` (canonical JSON with sorted keys). Files whose MAC does not match are rejected. From files without a MAC (2.00.009 or earlier), only the decrypted contents are used; their outer key information (`wraps`, `revoked`) is never adopted (2.00.011+). History in backups is encrypted with the DK (`hist`).
- **File-name tag (2.00.010+)**: `name-date-time-obk-XXXXXXXXXX.enc.json`. The SHA-256 of the exact file text is MACed with another key derived from the DK (info `snippet-book/v5/filename`) and encoded as 10 characters of the recovery-key alphabet. If it does not match, the app warns "this file may have been tampered with" and asks whether to continue. A name with a tag but a file without `auth` is rejected as a stripped forgery.
- **Choosing where to save**: Chrome and Edge on computers use `showSaveFilePicker`; iPhone and iPad use Web Share (`navigator.share` with a file, then "Save to Files"). Otherwise the file is downloaded (2.01.001+).
- Preferences are stored in plain text in `localStorage` (`snippet-book:v5:prefs`) because they are not content.

## 6-3. Import checks (2.00.004+)

- Files larger than 5 MB are not read. At most 200 sets and 10,000 cards, on every import path (2.01.008+).
- Only strings and numbers are used, as text; anything else becomes empty, so a malformed file cannot break the screen. The same applies when reading from storage.
- Everything is normalized and checked first; if anything is wrong, nothing is added.
- Text is escaped when displayed, and the CSP also prevents injected scripts from running.

## 6-4. Multiple tabs and unsaved edits (2.01.002+)

- Only `writeVault` writes the vault. Just before writing it compares the stored `rev` with the one the change was based on and refuses if they differ (another tab wrote first, or an older operation in this tab finished late). After writing, `rev` is incremented.
- Writes happen one at a time: a queue within the tab and `navigator.locks` (Web Locks) across tabs. The new state is built from the current vault when its turn comes, so concurrent changes are not lost. Browsers without Web Locks do not write the vault at all (read-only, 2.01.003+).
- Normal saves (`persist`) are also serialized; if the key or the vault changed during encryption, ciphertext made with an old key is never written.
- When another tab changes the vault (`storage` event): if the contents are the same, the key list and history are taken over; otherwise this tab stops saving.
- Whether everything is saved is tracked with an edit counter (`editSeq`) and the last saved counter (`savedSeq`), so an edit made during a save is never marked as saved (2.01.003+).
- **Unsaved edits ("stash")**: edits that could not be saved before a lock are encrypted with the DK and kept in `snippet-book:v5:unsaved` (or only in the tab if storage fails). On the next unlock the user is asked whether to restore them.
  - The encrypted stash is placed in the tab first, then written to storage; a write that never returns cannot keep the key in memory (2.01.005+).
  - A stash is "saved" only if encryption succeeded; if neither saving nor stashing worked, the unlock screen says the changes could not be protected (without showing any content) (2.01.006+).
  - Reading, checking, writing and deleting the stored stash happen in one sequence inside a Web Lock shared by all tabs (`snippet-book-unsaved`), so another tab cannot slip in between (2.01.007+, 2.01.010+).
  - Each stash is identified by its ciphertext `ct` (unique because the IV is random) and carries the tab it came from (`tab`, random per page load) and a per-tab number (`seq`). Within one tab, newer means a higher `seq` (independent of the clock); across tabs, the time `at` is compared, and on a tie this tab's stash wins. Only the restored or discarded stash, and earlier stashes from the same tab, are deleted; stashes from other tabs are kept and offered later (2.01.009+, 2.01.010+).
  - In browsers without Web Locks, the stash is kept only inside the tab and never written to storage (2.01.011+).

## 7. Distribution

- Served from `https://snippet.eiwa-up.jp/`. The nginx configuration is [`deploy/snippet.conf`](../deploy/snippet.conf).
- The CSP is `default-src 'none'`, `script-src 'sha256-…'` (the hash of the single inline script), `style-src 'unsafe-inline'`, `font-src 'self'`, `img-src 'self' data:`, `connect-src 'none'`, `frame-ancestors 'none'`, and so on.
  - Whenever the script changes, the CSP hash is updated too (`tests/test-v2111.mjs` checks that they match).
  - Inline styles are allowed (used for the look of on-screen elements).
- Since 2.00.003 the font (IBM Plex Mono) is also served from the same site (`fonts/`). Nothing is loaded from other sites. Japanese text uses the fonts installed on the device.
- A CSP does not stop following links or navigating away. Because "no traffic at all" cannot be claimed, we say "there is no mechanism that sends your entries out".
- `.github/workflows/verify.yml` checks once an hour that the served files and the CSP match this repository.
