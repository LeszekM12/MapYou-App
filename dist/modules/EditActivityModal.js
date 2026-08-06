// ─── EDYCJA TRENINGU ─────────────────────────────────────────────────────────
// src/modules/EditActivityModal.ts
//
// CO POZWALA ZMIENIC
//   • nazwe i opis (widoczne dla innych)
//   • notatke prywatna — pole `notes` w modelu, WYLACZNIE dla autora
//   • galerie zdjec — dosylanie kolejnych i usuwanie istniejacych
//
// DLACZEGO DOSYLANIE W OGOLE JEST POTRZEBNE
// Cloudinary przyjmuje jeden plik na zadanie, wiec przy zapisie treningu da
// sie dodac tylko jedno zdjecie. Reszta idzie tedy — kazde osobnym uploadem,
// po kolei.
//
// WYSYLKA W TLE
// Pliki nie ida stad bezposrednio. Trafiaja do `mediaQueue`, ktora:
//   • trzyma je w IndexedDB jako bajty (przezywa zamkniecie apki),
//   • wysyla, gdy jest siec i wazna sesja,
//   • podmienia adres zastepczy `mapyou-pending://` na prawdziwy w bazie
//     i w DOM, gdy plik doleci.
// Dzieki temu mozna zamknac ten ekran od razu po wybraniu zdjec.
//
// OGRANICZENIE, O KTORYM WARTO WIEDZIEC
// Przy CALKOWICIE zamknietej apce system usypia proces i wysylka staje.
// Wznawia sie przy nastepnym otwarciu. Prawdziwy transfer w tle wymaga
// natywnego mechanizmu (URLSession / WorkManager) — to osobny temat.
import { BACKEND_URL } from '../config.js';
import { dlog } from '../utils/log.js';
import { safeUrl } from '../utils/dom.js';
const MAX_NAME = 200;
const MAX_TEXT = 2000;
const MAX_PHOTOS = 20;
/** Otworz edycje. `onSaved` dostaje zaktualizowany rekord. */
export function openEditActivity(act, userId, onSaved) {
    document.getElementById('eaOverlay')?.remove();
    // Kopia robocza — dopóki uzytkownik nie zapisze, nic nie rusza oryginalu.
    let photos = [...(act.photos ?? [])];
    let cover = act.photoUrl;
    const ov = document.createElement('div');
    ov.id = 'eaOverlay';
    ov.className = 'ea-overlay';
    ov.innerHTML = `
    <div class="ea-sheet" role="dialog" aria-label="Edit activity">
      <div class="ea-head">
        <button class="ea-cancel" id="eaCancel">Cancel</button>
        <span class="ea-title">Edit activity</span>
        <button class="ea-save" id="eaSave">Save</button>
      </div>

      <div class="ea-body">
        <label class="ea-label" for="eaName">Title</label>
        <input class="ea-input" id="eaName" maxlength="${MAX_NAME}" placeholder="Morning run">
        <div class="ea-counter" id="eaNameCount"></div>

        <label class="ea-label" for="eaDesc">Description</label>
        <textarea class="ea-textarea" id="eaDesc" rows="3" maxlength="${MAX_TEXT}"
          placeholder="How did it go?"></textarea>

        <label class="ea-label" for="eaNotes">
          Private note
          <span class="ea-hint">Only you can see this</span>
        </label>
        <textarea class="ea-textarea" id="eaNotes" rows="3" maxlength="${MAX_TEXT}"
          placeholder="Felt strong on the last kilometre…"></textarea>

        <div class="ea-label">Photos <span class="ea-hint" id="eaPhotoCount"></span></div>
        <div class="ea-gallery" id="eaGallery"></div>
        <button class="ea-add" id="eaAdd">+ Add photos</button>
        <input type="file" id="eaFile" accept="image/*" multiple hidden>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const $ = (id) => ov.querySelector(`#${id}`);
    const nameEl = $('eaName');
    const descEl = $('eaDesc');
    const notesEl = $('eaNotes');
    const gallery = $('eaGallery');
    const fileEl = $('eaFile');
    nameEl.value = act.name ?? '';
    descEl.value = act.description ?? '';
    notesEl.value = act.notes ?? '';
    const refreshCount = () => {
        $('eaNameCount').textContent = `${nameEl.value.length}/${MAX_NAME}`;
        $('eaPhotoCount').textContent = `${photos.length + (cover ? 1 : 0)}/${MAX_PHOTOS}`;
    };
    nameEl.addEventListener('input', refreshCount);
    // ── Galeria ───────────────────────────────────────────────────────────────
    const renderGallery = () => {
        const all = [...(cover ? [cover] : []), ...photos];
        gallery.innerHTML = all.map((url, i) => {
            const pending = url.startsWith('mapyou-pending://');
            return `
        <div class="ea-thumb${pending ? ' ea-thumb--pending' : ''}" data-idx="${i}">
          ${pending
                ? '<span class="ea-thumb-pending">Uploading…</span>'
                : `<img src="${safeUrl(url)}" alt="">`}
          ${i === 0 ? '<span class="ea-cover">Cover</span>' : ''}
          <button class="ea-remove" data-remove="${i}" aria-label="Remove photo">×</button>
        </div>`;
        }).join('');
        refreshCount();
    };
    gallery.addEventListener('click', e => {
        const btn = e.target.closest('[data-remove]');
        if (!btn)
            return;
        const idx = Number(btn.dataset.remove);
        // Indeks 0 to okladka; reszta to galeria przesunieta o jeden.
        if (idx === 0) {
            // Usuniecie okladki awansuje pierwsze zdjecie z galerii — karta feedu
            // nie moze zostac bez obrazka, jesli jakiekolwiek jeszcze jest.
            cover = photos.shift() ?? null;
        }
        else {
            photos.splice(idx - 1, 1);
        }
        renderGallery();
    });
    // ── Dosyłanie ─────────────────────────────────────────────────────────────
    $('eaAdd').addEventListener('click', () => fileEl.click());
    fileEl.addEventListener('change', () => {
        const files = Array.from(fileEl.files ?? []);
        fileEl.value = '';
        if (!files.length)
            return;
        const room = MAX_PHOTOS - (photos.length + (cover ? 1 : 0));
        if (room <= 0) {
            alert(`Maximum ${MAX_PHOTOS} photos.`);
            return;
        }
        const take = files.slice(0, room);
        if (take.length < files.length) {
            alert(`Only ${take.length} of ${files.length} photos added — limit is ${MAX_PHOTOS}.`);
        }
        void (async () => {
            const { uploadMediaFile } = await import('./cloudSync.js');
            for (const f of take) {
                // `uploadMediaFile` sam odklada plik do kolejki, gdy siec zawiedzie,
                // i oddaje adres zastepczy. Nie musimy tu rozrozniac online/offline.
                const up = await uploadMediaFile(f, userId, 'activities');
                if (up?.url) {
                    if (!cover)
                        cover = up.url;
                    else
                        photos.push(up.url);
                    renderGallery();
                }
                else {
                    console.warn('[EditActivity] nie udalo sie dodac zdjecia:', f.name);
                }
            }
        })();
    });
    renderGallery();
    // ── Zapis ─────────────────────────────────────────────────────────────────
    const close = () => ov.remove();
    $('eaCancel').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov)
        close(); });
    $('eaSave').addEventListener('click', () => {
        const btn = $('eaSave');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        const payload = {
            userId,
            name: nameEl.value.trim().slice(0, MAX_NAME),
            description: descEl.value.trim().slice(0, MAX_TEXT),
            notes: notesEl.value.trim().slice(0, MAX_TEXT),
            photoUrl: cover,
            photos,
        };
        void fetch(`${BACKEND_URL}/enriched-activities/${encodeURIComponent(act.activityId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
            .then(r => r.json())
            .then(() => {
            // Odpowiedz moze byc zastepcza (zapis poszedl do kolejki offline) —
            // i tak stosujemy zmiany lokalnie, bo to one sa teraz prawda.
            onSaved({
                name: payload.name, description: payload.description,
                notes: payload.notes, photoUrl: cover, photos,
            });
            dlog('[EditActivity] zapisano');
            close();
        })
            .catch(e => {
            console.error('[EditActivity] zapis nieudany:', e instanceof Error ? e.message : e);
            btn.disabled = false;
            btn.textContent = 'Save';
            alert('Could not save. Check your connection and try again.');
        });
    });
}
//# sourceMappingURL=EditActivityModal.js.map