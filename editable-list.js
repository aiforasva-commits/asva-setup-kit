// editable-list.js
// Shared drag-to-reorder editor for a list of bullets or {title,url} sources.
// Used by goldenpath.html (admin review — agent recommendations, live ratings,
// member submissions) and scorecard.html (a member's own suggested edit), so
// suggesting or reviewing a rating edit is the same interaction everywhere on
// the site. Plain global script (not a module) so either page can drop it in
// with a single <script src="editable-list.js"></script> before its own inline
// script. Exposes window.ASVAEditableList = { editableList }.
//
// Markup/behaviour and CSS classes (.edit-list, .edit-item, .drag-handle, …)
// are shared too — see the "Editable, reorderable bullet / source lists"
// section of app.css. Do not rename a class here without updating that CSS.
(function () {

  // Pointer-based drag works with both mouse and touch. Markers (1. / a) / i))
  // are drawn by CSS counters, so they renumber automatically on reorder.
  //
  // A drag only starts from the dotted handle, and only once the pointer has
  // actually moved past a small threshold — so a plain click/tap on the handle
  // never reorders anything, and the item stays put until you deliberately drag
  // it up or down. Move/up are tracked on the document (not just the handle) so
  // the drag keeps following the pointer even when it strays off the handle.
  function makeReorderable(list) {
    list.addEventListener('pointerdown', function (e) {
      var handle = e.target.closest('.drag-handle');
      if (!handle) return;
      var item = handle.closest('.edit-item');
      if (!item) return;
      // Left button only for mouse; touch/pen have no button to check.
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      var pointerId = e.pointerId;
      var startY = e.clientY;
      var dragging = false;
      var THRESHOLD = 6; // px of movement before a hold turns into a drag

      // Stop the handle itself from starting a text selection / native drag,
      // but don't yet reorder — that waits until the pointer clears THRESHOLD.
      e.preventDefault();

      function afterElement(y) {
        var els = [].slice.call(list.querySelectorAll('.edit-item:not(.dragging)'));
        var best = { offset: -Infinity, el: null };
        els.forEach(function (child) {
          var box = child.getBoundingClientRect();
          var offset = y - box.top - box.height / 2;
          if (offset < 0 && offset > best.offset) best = { offset: offset, el: child };
        });
        return best.el;
      }
      function startDrag() {
        dragging = true;
        item.classList.add('dragging');
        list.classList.add('reordering');
        try { handle.setPointerCapture(pointerId); } catch (_) {}
      }
      function move(ev) {
        if (ev.pointerId !== pointerId) return;
        if (!dragging) {
          if (Math.abs(ev.clientY - startY) < THRESHOLD) return;
          startDrag();
        }
        ev.preventDefault(); // keep the page from scrolling mid-drag on touch
        var after = afterElement(ev.clientY);
        if (after == null) list.appendChild(item);
        else if (after !== item) list.insertBefore(item, after);
      }
      function up(ev) {
        if (ev && ev.pointerId !== pointerId) return;
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        if (dragging) {
          item.classList.remove('dragging');
          list.classList.remove('reordering');
          try { handle.releasePointerCapture(pointerId); } catch (_) {}
        }
      }
      document.addEventListener('pointermove', move, { passive: false });
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });
  }

  // Returns a DOM element with a .getValues() method. kind = 'bullets' | 'srcs'.
  function editableList(kind, items) {
    var isSrc = kind === 'srcs';
    var ul = document.createElement('ul');
    ul.className = 'edit-list ' + kind;

    function addRow(data) {
      var li = document.createElement('li');
      li.className = 'edit-item';
      if (isSrc) {
        li.innerHTML =
          '<span class="drag-handle" title="Drag to reorder" aria-label="Drag to reorder">⠿</span>' +
          '<div class="edit-body">' +
            '<div class="edit-line"><span class="edit-marker src-title-marker" aria-hidden="true"></span>' +
              '<span class="editable src-title" contenteditable="true" role="textbox" data-placeholder="Source title"></span></div>' +
            '<div class="edit-line"><span class="edit-marker src-url-marker" aria-hidden="true"></span>' +
              '<a class="src-url-link" target="_blank" rel="noopener noreferrer"></a>' +
              '<span class="editable url src-url" contenteditable="true" role="textbox" data-placeholder="https://…"></span>' +
              '<button class="src-url-edit" type="button" title="Edit address" aria-label="Edit address">✎</button></div>' +
          '</div>' +
          '<button class="edit-remove" type="button" title="Remove source" aria-label="Remove source">×</button>';
        li.querySelector('.src-title').textContent = (data && data.title) || '';
        var srcUrl = li.querySelector('.src-url');
        var srcLink = li.querySelector('.src-url-link');
        var srcPen = li.querySelector('.src-url-edit');
        srcUrl.textContent = (data && data.url) || '';
        // Mirror the editable text onto the clickable link (href gets a scheme
        // if the user left one off, so plain "example.com/x" is still clickable).
        function syncLink() {
          var u = srcUrl.textContent.trim();
          srcLink.textContent = u;
          srcLink.href = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : ('https://' + u);
        }
        // editing = show the field; otherwise show the link. An empty URL has
        // nothing to link to, so it always stays in edit mode.
        function setEditing(on) {
          on = on || !srcUrl.textContent.trim();
          syncLink();
          srcUrl.hidden = !on;
          srcLink.hidden = on;
          srcPen.classList.toggle('editing', on);
          srcPen.title = on ? 'Done editing address' : 'Edit address';
          srcPen.setAttribute('aria-label', srcPen.title);
          if (on) {
            srcUrl.focus();
            var r = document.createRange(); r.selectNodeContents(srcUrl); r.collapse(false);
            var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
          }
        }
        srcPen.addEventListener('click', function () { setEditing(srcUrl.hidden); });
        srcUrl.addEventListener('blur', function () { if (srcUrl.textContent.trim()) setEditing(false); });
        setEditing(false);
      } else {
        li.innerHTML =
          '<span class="drag-handle" title="Drag to reorder" aria-label="Drag to reorder">⠿</span>' +
          '<span class="edit-marker bullet-marker" aria-hidden="true"></span>' +
          '<span class="editable bullet-text" contenteditable="true" role="textbox" data-placeholder="Short justification phrase"></span>' +
          '<button class="edit-remove" type="button" title="Remove bullet" aria-label="Remove bullet">×</button>';
        li.querySelector('.bullet-text').textContent = (data && data.text) || '';
      }
      li.querySelector('.edit-remove').addEventListener('click', function () { li.remove(); });
      // Enter commits the field rather than inserting a newline.
      [].forEach.call(li.querySelectorAll('.editable'), function (ed) {
        ed.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ed.blur(); }
        });
      });
      ul.appendChild(li);
      return li;
    }

    (items || []).forEach(function (it) { addRow(isSrc ? it : { text: it }); });
    makeReorderable(ul);

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'edit-add';
    addBtn.textContent = isSrc ? '+ Add source' : '+ Add bullet';
    addBtn.addEventListener('click', function () {
      var li = addRow(isSrc ? { title: '', url: '' } : { text: '' });
      var first = li.querySelector('.editable');
      if (first) first.focus();
    });

    var wrap = document.createElement('div');
    wrap.appendChild(ul);
    wrap.appendChild(addBtn);
    wrap.getValues = function () {
      var out = [];
      [].forEach.call(ul.querySelectorAll('.edit-item'), function (li) {
        if (isSrc) {
          var t = li.querySelector('.src-title').textContent.trim();
          var u = li.querySelector('.src-url').textContent.trim();
          if (u) out.push({ title: t, url: u });
        } else {
          var v = li.querySelector('.bullet-text').textContent.trim();
          if (v) out.push(v);
        }
      });
      return out;
    };
    return wrap;
  }

  window.ASVAEditableList = { editableList: editableList };
})();
