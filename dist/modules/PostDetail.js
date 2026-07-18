// ─── POST DETAIL ─────────────────────────────────────────────────────────────
// X-style: the post up top, a comment composer, then comments below. Tapping a
// comment opens its options (reply, copy, delete-your-own). The author gets a
// visibility control and delete, mirroring the activity detail sheet so the two
// feel like one app.
//
// Comments reuse the existing /feed/comment endpoints, which already accept
// itemType: 'post' — so nothing new was needed on the comment side.
import { BACKEND_URL } from '../config.js';
import { getUserId } from './UserProfile.js';
import { loadProfileFromLocal } from './UserProfile.js';
const esc = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** "just now" · "4m" · "3h" · "2d" · date */
function ago(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)
        return 'just now';
    if (s < 3600)
        return `${Math.floor(s / 60)}m`;
    if (s < 86400)
        return `${Math.floor(s / 3600)}h`;
    if (s < 604800)
        return `${Math.floor(s / 86400)}d`;
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
const VIS_META = {
    everyone: { ic: '🌐', t: 'Everyone' },
    friends: { ic: '👥', t: 'Friends' },
    only_me: { ic: '🔒', t: 'Only me' },
};
// ── API ──────────────────────────────────────────────────────────────────────
async function fetchPost(postId) {
    try {
        const r = await fetch(`${BACKEND_URL}/posts/single/${encodeURIComponent(postId)}`, { cache: 'no-store' });
        const j = await r.json();
        return j.status === 'ok' ? j.data : null;
    }
    catch {
        return null;
    }
}
async function fetchComments(postId) {
    try {
        const r = await fetch(`${BACKEND_URL}/feed/comments/${encodeURIComponent(postId)}`, { cache: 'no-store' });
        const j = await r.json();
        return j.status === 'ok' ? j.data : [];
    }
    catch {
        return [];
    }
}
async function addComment(postId, text) {
    try {
        const prof = loadProfileFromLocal();
        const r = await fetch(`${BACKEND_URL}/feed/comment`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: getUserId(), authorName: prof?.name ?? 'Someone',
                itemId: postId, itemType: 'post', text,
            }),
        });
        return r.ok;
    }
    catch {
        return false;
    }
}
async function deleteComment(commentId) {
    try {
        const r = await fetch(`${BACKEND_URL}/feed/comment/${encodeURIComponent(commentId)}?userId=${encodeURIComponent(getUserId())}`, { method: 'DELETE' });
        return r.ok;
    }
    catch {
        return false;
    }
}
async function deletePost(postId) {
    try {
        const r = await fetch(`${BACKEND_URL}/posts/${encodeURIComponent(postId)}?userId=${encodeURIComponent(getUserId())}`, { method: 'DELETE' });
        return r.ok;
    }
    catch {
        return false;
    }
}
async function patchVisibility(postId, visibility) {
    try {
        const r = await fetch(`${BACKEND_URL}/posts/${encodeURIComponent(postId)}/visibility`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: getUserId(), visibility }),
        });
        return r.ok;
    }
    catch {
        return false;
    }
}
// ── Comment options sheet ────────────────────────────────────────────────────
function openCommentOptions(c, onDeleted) {
    const mine = c.userId === getUserId();
    const sheet = document.createElement('div');
    sheet.className = 'adm-overlay';
    sheet.innerHTML = `
    <div class="adm-sheet">
      <div class="adm-grab"></div>
      <button class="adm-row" id="pcReply">
        <span class="adm-ic">↩️</span>
        <span class="adm-txt"><span class="adm-t">Reply</span><span class="adm-s">Mention ${esc(c.authorName)}</span></span>
      </button>
      <button class="adm-row" id="pcCopy">
        <span class="adm-ic">📋</span>
        <span class="adm-txt"><span class="adm-t">Copy text</span></span>
      </button>
      ${mine ? `
        <div class="adm-divider"></div>
        <button class="adm-row adm-row--danger" id="pcDelete">
          <span class="adm-ic">🗑️</span>
          <span class="adm-txt"><span class="adm-t">Delete comment</span><span class="adm-s">This cannot be undone</span></span>
        </button>` : ''}
    </div>`;
    document.body.appendChild(sheet);
    const close = () => sheet.remove();
    sheet.addEventListener('click', e => { if (e.target === sheet)
        close(); });
    sheet.querySelector('#pcReply')?.addEventListener('click', () => {
        close();
        const input = document.getElementById('pdInput');
        if (input) {
            input.value = `@${c.authorName} `;
            input.focus();
        }
    });
    sheet.querySelector('#pcCopy')?.addEventListener('click', () => {
        void navigator.clipboard?.writeText(c.text).catch(() => { });
        close();
    });
    sheet.querySelector('#pcDelete')?.addEventListener('click', async () => {
        close();
        if (await deleteComment(c.commentId))
            onDeleted();
    });
}
// ── Post options (author): visibility + delete ───────────────────────────────
function openPostOptions(post, badgeEl, onDeleted) {
    const cur = post.visibility ?? 'everyone';
    const opts = ['everyone', 'friends', 'only_me'];
    const sheet = document.createElement('div');
    sheet.className = 'adm-overlay';
    sheet.innerHTML = `
    <div class="adm-sheet">
      <div class="adm-grab"></div>
      <div class="adm-section-title">Who can see this?</div>
      ${opts.map(v => `
        <button class="adm-row${v === cur ? ' adm-row--active' : ''}" data-vis="${v}">
          <span class="adm-ic">${VIS_META[v].ic}</span>
          <span class="adm-txt"><span class="adm-t">${VIS_META[v].t}</span></span>
          <span class="adm-check">${v === cur ? '✓' : ''}</span>
        </button>`).join('')}
      <div class="adm-divider"></div>
      <button class="adm-row adm-row--danger" id="pdDelete">
        <span class="adm-ic">🗑️</span>
        <span class="adm-txt"><span class="adm-t">Delete post</span><span class="adm-s">This cannot be undone</span></span>
      </button>
    </div>`;
    document.body.appendChild(sheet);
    const close = () => sheet.remove();
    sheet.addEventListener('click', e => { if (e.target === sheet)
        close(); });
    sheet.querySelectorAll('[data-vis]').forEach(b => {
        b.addEventListener('click', async () => {
            const v = b.dataset.vis;
            post.visibility = v;
            if (badgeEl)
                badgeEl.textContent = `${VIS_META[v].ic} ${VIS_META[v].t}`;
            close();
            await patchVisibility(post.postId, v);
        });
    });
    sheet.querySelector('#pdDelete')?.addEventListener('click', async () => {
        close();
        if (await deletePost(post.postId))
            onDeleted();
    });
}
// ── Main entry ───────────────────────────────────────────────────────────────
export async function openPostDetail(postId, onChange) {
    document.getElementById('postDetailOverlay')?.remove();
    const ov = document.createElement('div');
    ov.id = 'postDetailOverlay';
    ov.className = 'pd-overlay';
    ov.innerHTML = `<div class="pd-sheet"><div class="pd-loading">Loading…</div></div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('pd-overlay--visible'));
    const close = () => { ov.classList.remove('pd-overlay--visible'); setTimeout(() => ov.remove(), 240); };
    const post = await fetchPost(postId);
    const sheet = ov.querySelector('.pd-sheet');
    if (!post) {
        sheet.innerHTML = `<div class="pd-empty"><span>📡</span><p>Post not found</p><button class="ev-btn ev-btn--ghost" id="pdClose">Close</button></div>`;
        sheet.querySelector('#pdClose')?.addEventListener('click', close);
        return;
    }
    const isAuthor = post.userId === getUserId();
    const vis = post.visibility ?? 'everyone';
    const paintComments = (list) => `
    <div class="pd-comments-title">${list.length} ${list.length === 1 ? 'comment' : 'comments'}</div>
    ${list.map(c => `
      <button class="pd-comment" data-cid="${c.commentId}">
        <span class="pd-comment__avatar">${c.avatarB64 ? `<img src="${esc(c.avatarB64)}" alt=""/>` : '👤'}</span>
        <span class="pd-comment__body">
          <span class="pd-comment__top">
            <span class="pd-comment__name">${esc(c.authorName)}</span>
            <span class="pd-comment__time">${ago(Date.parse(c.createdAt))}</span>
          </span>
          <span class="pd-comment__text">${esc(c.text)}</span>
        </span>
      </button>`).join('') || `<div class="pd-empty pd-empty--sm"><p>No comments yet. Be the first.</p></div>`}`;
    const render = (comments) => {
        sheet.innerHTML = `
      <div class="pd-head">
        <button class="pd-back" id="pdBack" aria-label="Back">←</button>
        <span class="pd-head__title">Post</span>
        ${isAuthor ? `<button class="pd-opts" id="pdOpts" aria-label="Options">⋯</button>` : '<span style="width:36px"></span>'}
      </div>

      <div class="pd-scroll">
        <div class="pd-post">
          <div class="pd-post__author">
            <span class="pd-post__avatar">${post.avatarB64 ? `<img src="${esc(post.avatarB64)}" alt=""/>` : '👤'}</span>
            <div class="pd-post__meta">
              <span class="pd-post__name">${esc(post.authorName)}</span>
              <span class="pd-post__time">${ago(post.date)}${isAuthor ? ` · <span id="pdVisBadge">${VIS_META[vis].ic} ${VIS_META[vis].t}</span>` : ''}</span>
            </div>
          </div>
          ${post.title ? `<div class="pd-post__title">${esc(post.title)}</div>` : ''}
          ${post.body ? `<div class="pd-post__text">${esc(post.body)}</div>` : ''}
          ${post.photoUrl ? `<img class="pd-post__photo" src="${esc(post.photoUrl)}" alt=""/>` : ''}
        </div>

        <div class="pd-comments" id="pdComments">${paintComments(comments)}</div>
      </div>

      <div class="pd-composer">
        <input id="pdInput" type="text" maxlength="500" placeholder="Post your reply"/>
        <button id="pdSend" class="pd-send">Reply</button>
      </div>`;
        sheet.querySelector('#pdBack')?.addEventListener('click', close);
        sheet.querySelector('#pdOpts')?.addEventListener('click', () => openPostOptions(post, sheet.querySelector('#pdVisBadge'), () => { close(); onChange?.(); }));
        // Media which 404s → hide instead of a broken frame (same pattern as feeds).
        sheet.querySelector('.pd-post__photo')?.addEventListener('error', e => {
            e.target.style.display = 'none';
        });
        sheet.querySelectorAll('.pd-comment').forEach(el => {
            const c = comments.find(x => x.commentId === el.dataset.cid);
            if (c)
                el.addEventListener('click', () => openCommentOptions(c, () => void reload()));
        });
        const input = sheet.querySelector('#pdInput');
        const send = async () => {
            const text = input.value.trim();
            if (!text)
                return;
            input.value = '';
            if (await addComment(postId, text)) {
                await reload();
                onChange?.();
            }
        };
        sheet.querySelector('#pdSend')?.addEventListener('click', () => void send());
        input.addEventListener('keydown', e => { if (e.key === 'Enter')
            void send(); });
    };
    const reload = async () => { render(await fetchComments(postId)); };
    render(await fetchComments(postId));
}
//# sourceMappingURL=PostDetail.js.map