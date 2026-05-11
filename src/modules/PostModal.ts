// ─── POST MODAL ───────────────────────────────────────────────────────────────
// src/modules/PostModal.ts
//
// Bottom-sheet for creating a text/photo post shown in the Home feed.
// Stored locally in IndexedDB (postsFeed table) + localStorage fallback.

import { savePost, type PostRecord } from './db.js';
import { CS, uploadMediaFile } from './cloudSync.js';
import { getJoinedClubs, addToClubFeed } from './SearchView.js';

// ── Build HTML ────────────────────────────────────────────────────────────────

function buildHTML(): string {
  return `
  <div class="pm-overlay" id="postModalOverlay" role="dialog" aria-modal="true">
    <div class="pm-sheet" id="postModalSheet">
      <div class="pm-handle"></div>

      <div class="pm-header">
        <h2 class="pm-header__title">New Post</h2>
        <button class="pm-close" id="pmClose" aria-label="Close">✕</button>
      </div>

      <div class="pm-body">

        <div class="pm-field">
          <label class="pm-label" for="pmTitle">Title</label>
          <input class="pm-input" id="pmTitle" type="text"
            placeholder="What's your post about?" maxlength="20" autocomplete="off"/>
        </div>

        <div class="pm-field">
          <label class="pm-label" for="pmDesc">
            Description
            <span class="pm-char-count" id="pmDescCount">0/500</span>
          </label>
          <textarea class="pm-textarea" id="pmDesc" rows="5"
            maxlength="500" placeholder="Share your story, thoughts or experience…"></textarea>
        </div>

        <div class="pm-field">
          <label class="pm-label">Photo / Video <span class="pm-optional">(optional)</span></label>
          <label class="pm-photo-zone" id="pmPhotoZone" for="pmPhotoInput">
            <input type="file" accept="image/*,video/*" id="pmPhotoInput" class="pm-photo-input"/>
            <div class="pm-photo-placeholder" id="pmPhotoPlaceholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28">
                <rect x="3" y="3" width="18" height="18" rx="3"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21,15 16,10 5,21"/>
              </svg>
              <span>Add photo or video</span>
            </div>
            <img class="pm-photo-preview hidden" id="pmPhotoPreview" alt="Preview"/>
            <video class="pm-photo-preview hidden" id="pmVideoPreview" playsinline muted controls preload="metadata"></video>
            <button class="pm-photo-remove hidden" id="pmPhotoRemove" aria-label="Remove media">✕</button>
          </label>
          <span class="sam-media-hint">Max 10 MB for photos · 500 MB for videos</span>
        </div>

      </div>

      <div class="pm-share-clubs" id="pmShareClubs"></div>
      <div class="pm-footer">
        <button class="pm-btn pm-btn--cancel" id="pmCancel">Cancel</button>
        <button class="pm-btn pm-btn--post" id="pmPost">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          Post
        </button>
      </div>
    </div>
  </div>`;
}

// ── PostModal class ───────────────────────────────────────────────────────────

export class PostModal {
  private _el: HTMLElement | null = null;
  private _photoB64:    string | null = null;
  private _mediaFile:   File | null   = null;
  private _mediaIsVideo: boolean       = false;
  private _touchStartY = 0;

  constructor(private _onSave: (post: PostRecord) => void) {}

  open(): void {
    document.getElementById('postModalOverlay')?.remove();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildHTML();
    const el = wrapper.firstElementChild as HTMLElement;
    document.body.appendChild(el);
    this._el = el;

    requestAnimationFrame(() => {
      el.classList.add('pm-overlay--visible');
      setTimeout(() => el.querySelector<HTMLElement>('.pm-sheet')?.classList.add('pm-sheet--open'), 10);
    });

    this._bindEvents(el);
  }

  close(): void {
    if (!this._el) return;
    this._el.querySelector<HTMLElement>('.pm-sheet')?.classList.remove('pm-sheet--open');
    this._el.classList.remove('pm-overlay--visible');
    setTimeout(() => { this._el?.remove(); this._el = null; }, 350);
  }

  private _bindEvents(el: HTMLElement): void {
    el.querySelector('#pmClose')?.addEventListener('click', () => this.close());
    el.querySelector('#pmCancel')?.addEventListener('click', () => this.close());
    el.addEventListener('click', e => { if (e.target === el) this.close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); }, { once: true });

    // Char count
    const desc  = el.querySelector<HTMLTextAreaElement>('#pmDesc')!;
    const count = el.querySelector<HTMLElement>('#pmDescCount')!;
    desc.addEventListener('input', () => { count.textContent = `${desc.value.length}/500`; });

    // Photo
    const zone      = el.querySelector<HTMLElement>('#pmPhotoZone')!;
    const input     = el.querySelector<HTMLInputElement>('#pmPhotoInput')!;
    const preview   = el.querySelector<HTMLImageElement>('#pmPhotoPreview')!;
    const placeholder = el.querySelector<HTMLElement>('#pmPhotoPlaceholder')!;
    const removeBtn = el.querySelector<HTMLButtonElement>('#pmPhotoRemove')!;

    const videoPreview = el.querySelector<HTMLVideoElement>('#pmVideoPreview')!;

    zone.addEventListener('click', e => {
      // Prevent label from reopening file picker when clicking remove button
      if ((e.target as HTMLElement).closest('#pmPhotoRemove')) e.preventDefault();
    });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const isVid     = file.type.startsWith('video/');
      const MAX_IMAGE = 10 * 1024 * 1024;
      const MAX_VIDEO = 850 * 1024 * 1024;
      if (!isVid && file.size > MAX_IMAGE) {
        alert(`Photo too large. Max 10 MB (your file: ${(file.size/1024/1024).toFixed(1)} MB)`);
        input.value = ''; return;
      }
      if (isVid && file.size > MAX_VIDEO) {
        alert(`Video too large. Max 500 MB (your file: ${(file.size/1024/1024).toFixed(0)} MB)`);
        input.value = ''; return;
      }
      this._mediaFile    = file;
      this._mediaIsVideo = isVid;
      const url          = URL.createObjectURL(file);
      if (isVid) {
        preview.classList.add('hidden'); preview.src = '';
        videoPreview.src = url; videoPreview.classList.remove('hidden');
        this._photoB64 = null;
      } else {
        videoPreview.classList.add('hidden'); videoPreview.src = '';
        const reader = new FileReader();
        reader.onload = () => {
          this._photoB64 = reader.result as string;
          preview.src    = this._photoB64;
          preview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
      }
      placeholder.classList.add('hidden');
      removeBtn.classList.remove('hidden');
      zone.classList.add('pm-photo-zone--filled');
    });
    removeBtn.addEventListener('click', () => {
      this._photoB64     = null;
      this._mediaFile    = null;
      this._mediaIsVideo = false;
      preview.src        = ''; preview.classList.add('hidden');
      videoPreview.src   = ''; videoPreview.classList.add('hidden');
      placeholder.classList.remove('hidden');
      removeBtn.classList.add('hidden');
      zone.classList.remove('pm-photo-zone--filled');
      input.value = '';
    });

    // Post
    el.querySelector('#pmPost')?.addEventListener('click', () => void this._submit(el));

    // Share to club checkboxes
    const pmShareWrap = el.querySelector<HTMLElement>('#pmShareClubs');
    if (pmShareWrap) {
      const clubs = getJoinedClubs();
      if (clubs.length > 0) {
        pmShareWrap.innerHTML = `
          <div class="sam-share-clubs__inner">
            <div class="sam-share-clubs__title">Share to club</div>
            ${clubs.map(c => `
              <label class="sam-share-clubs__item">
                <input type="checkbox" class="pm-club-check" data-club-id="${c.id}" data-club-name="${c.name}"/>
                <span class="sam-share-clubs__check-icon"></span>
                <span class="sam-share-clubs__name">${c.name}</span>
              </label>`).join('')}
          </div>`;
      }
    }

    // Swipe to close
    const handle = el.querySelector<HTMLElement>('.pm-handle')!;
    const sheet  = el.querySelector<HTMLElement>('.pm-sheet')!;
    handle.addEventListener('touchstart', e => { this._touchStartY = e.touches[0].clientY; }, { passive: true });
    handle.addEventListener('touchmove', e => {
      const d = e.touches[0].clientY - this._touchStartY;
      if (d > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${d}px)`; }
    }, { passive: true });
    handle.addEventListener('touchend', e => {
      sheet.style.transition = '';
      if (e.changedTouches[0].clientY - this._touchStartY > 100) this.close();
      else sheet.style.transform = '';
    });
  }

  private async _submit(el: HTMLElement): Promise<void> {
    const title = el.querySelector<HTMLInputElement>('#pmTitle')?.value.trim() ?? '';
    const desc  = el.querySelector<HTMLTextAreaElement>('#pmDesc')?.value.trim() ?? '';

    if (!title && !desc) {
      el.querySelector<HTMLInputElement>('#pmTitle')?.focus();
      el.querySelector<HTMLInputElement>('#pmTitle')?.classList.add('pm-input--error');
      return;
    }

    const btn = el.querySelector<HTMLButtonElement>('#pmPost')!;
    btn.disabled = true;
    btn.innerHTML = `
      <span style="display:flex;align-items:center;justify-content:center;gap:8px">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="animation:pm-spin 0.8s linear infinite">
          <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" stroke-width="2.5"/>
          <path d="M8 2a6 6 0 0 1 6 6" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <span>${this._mediaFile?.type.startsWith('video/') ? 'Compressing…' : 'Posting…'}</span>
      </span>`;
    if (!document.querySelector('#pm-spin-style')) {
      const s = document.createElement('style');
      s.id = 'pm-spin-style';
      s.textContent = '@keyframes pm-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }

    // Upload media via multipart with progress feedback
    let finalPhotoUrl: string | null = this._photoB64;
    let finalMediaType: 'image' | 'video' | null = null;
    let _publicId: string | null = null;
    if (this._mediaFile) {
      const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
      const isVid  = this._mediaFile.type.startsWith('video/');
      try {
        const up = await uploadMediaFile(
          this._mediaFile, userId, 'posts', undefined,
          (pct, phase) => {
            if (phase === 'uploading') {
              btn.innerHTML = `
                <span style="display:flex;align-items:center;justify-content:center;gap:8px">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="animation:pm-spin 0.8s linear infinite">
                    <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" stroke-width="2.5"/>
                    <path d="M8 2a6 6 0 0 1 6 6" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
                  </svg>
                  <span>Uploading ${pct}%</span>
                </span>`;
            } else {
              btn.innerHTML = `
                <span style="display:flex;align-items:center;justify-content:center;gap:8px">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="animation:pm-spin 0.8s linear infinite">
                    <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" stroke-width="2.5"/>
                    <path d="M8 2a6 6 0 0 1 6 6" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
                  </svg>
                  <span>${isVid ? 'Compressing…' : 'Processing…'}</span>
                </span>`;
            }
          }
        );
        if (up) { finalPhotoUrl = up.url; finalMediaType = up.mediaType; _publicId = up.publicId; }
      } catch {}
    }

    const post: PostRecord = {
      id:        String(Date.now()),
      type:      'post',
      date:      Date.now(),
      title:     title || desc.slice(0, 60),
      body:      desc,
      photoUrl:      finalPhotoUrl,
      photoPublicId: _publicId ?? undefined,
      mediaType:     finalMediaType ?? undefined,
      authorName:    localStorage.getItem('mapyou_userName') ?? 'Athlete',
      avatarB64:  localStorage.getItem('mapyou_avatar') ?? null,
    };

    // Share to selected clubs — set clubIds BEFORE saving
    const checkedClubs = el.querySelectorAll<HTMLInputElement>('.pm-club-check:checked');
    if (checkedClubs.length > 0) {
      post.clubIds = [...checkedClubs].map(cb => cb.dataset.clubId!);
    }

    await CS.savePost(post);

    this.close();
    this._onSave(post);
  }
}

export function openPostModal(onSave: (post: PostRecord) => void): void {
  new PostModal(onSave).open();
}
