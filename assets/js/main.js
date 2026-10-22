
(function () {
  'use strict';
  const PHONE = '919701167899';
  const STORAGE_KEY = 'powerplay_demo_bookings_v1';
  const STAFF_TOKEN_KEY = 'powerplay_staff_token';
  const getApiBase = () => {
    if (window.POWERPLAY_API_BASE) return window.POWERPLAY_API_BASE;
    const loc = window.location;
    if (!loc.protocol.startsWith('http')) {
      return 'http://127.0.0.1:8000';
    }
    if (loc.port === '8000') {
      return '';
    }
    if (
      loc.hostname === 'localhost' ||
      loc.hostname === '127.0.0.1' ||
      loc.hostname === '0.0.0.0' ||
      /^192\.168\./.test(loc.hostname) ||
      /^10\./.test(loc.hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(loc.hostname)
    ) {
      return `http://${loc.hostname}:8000`;
    }
    return '';
  };
  const API_BASE = getApiBase();
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const localTomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const bookingDateInput = $('#bookingDate');
  if (bookingDateInput) {
    bookingDateInput.min = localToday();
    if (!bookingDateInput.value || bookingDateInput.value < localToday()) {
      bookingDateInput.value = localToday();
    }
    bookingDateInput.addEventListener('change', () => {
      if (bookingDateInput.value < localToday()) {
        bookingDateInput.value = localToday();
        showToast('Past dates cannot be booked. Date reset to today.');
      }
    });
  }
  const menuToggle = $('#menuToggle');
  const navLinks = $('#navLinks');
  if (menuToggle && navLinks) {
    const closeMobileNav = () => {
      navLinks.classList.remove('open');
      menuToggle.setAttribute('aria-expanded', 'false');
    };
    menuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !navLinks.classList.contains('open');
      navLinks.classList.toggle('open', willOpen);
      menuToggle.setAttribute('aria-expanded', String(willOpen));
    });
    $$('#navLinks a').forEach((a) =>
      a.addEventListener('click', () => {
        closeMobileNav();
      })
    );
    document.addEventListener('click', (e) => {
      if (
        navLinks.classList.contains('open') &&
        !navLinks.contains(e.target) &&
        !menuToggle.contains(e.target)
      ) {
        closeMobileNav();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navLinks.classList.contains('open')) {
        closeMobileNav();
        menuToggle.focus();
      }
    });
  }
  $$('[data-type]').forEach((el) => {
    el.addEventListener('click', () => {
      const v = el.dataset.type;
      const typeSelect = $('#bookingType');
      if (v && typeSelect) {
        typeSelect.value = v;
        renderSlots();
      }
    });
  });
  function dateToInputVal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function setDateChip(val) {
    const input = $('#bookingDate');
    if (!input) return;
    input.value = val;
    $$('.date-chip').forEach((c) => c.classList.remove('active'));
    const matched = Array.from($$('.date-chip')).find((c) => c._targetDate === val);
    if (matched) matched.classList.add('active');
    renderSlots();
  }
  function setupDateChips() {
    const today = new Date();
    const todayVal = dateToInputVal(today);
    const todayBtn = $('#qs-today');
    if (todayBtn) {
      todayBtn._targetDate = todayVal;
      todayBtn.addEventListener('click', () => setDateChip(todayVal));
    }
    const tmr = new Date(today); tmr.setDate(today.getDate() + 1);
    const tmrVal = dateToInputVal(tmr);
    const tmrBtn = $('#qs-tomorrow');
    if (tmrBtn) {
      tmrBtn._targetDate = tmrVal;
      tmrBtn.addEventListener('click', () => setDateChip(tmrVal));
    }
    const weekendDay = new Date(today);
    const daysToSat = (6 - today.getDay() + 7) % 7 || 7;
    weekendDay.setDate(today.getDate() + daysToSat);
    const weekendVal = dateToInputVal(weekendDay);
    const weekendBtn = $('#qs-weekend');
    if (weekendBtn) {
      weekendBtn._targetDate = weekendVal;
      weekendBtn.addEventListener('click', () => setDateChip(weekendVal));
    }
    const nextMon = new Date(today);
    const daysToMon = (8 - today.getDay()) % 7 || 7;
    nextMon.setDate(today.getDate() + daysToMon);
    const nextWeekVal = dateToInputVal(nextMon);
    const nextWeekBtn = $('#qs-nextweek');
    if (nextWeekBtn) {
      nextWeekBtn._targetDate = nextWeekVal;
      nextWeekBtn.addEventListener('click', () => setDateChip(nextWeekVal));
    }
    if (todayBtn && $('#bookingDate') && $('#bookingDate').value === todayVal) {
      todayBtn.classList.add('active');
    }
    if ($('#bookingDate')) {
      $('#bookingDate').addEventListener('change', () => {
        const cur = $('#bookingDate').value;
        $$('.date-chip').forEach((c) => {
          c.classList.toggle('active', c._targetDate === cur);
        });
      });
    }
  }
  setupDateChips();
  function showToast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function getBookings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }
  function saveBookings(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }
  const formatHour = (h) => {
    const hour = h % 24;
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const display = hour % 12 || 12;
    return `${display}:00 ${suffix}`;
  };
  function getSlotPrice(date, time) {
    const d = new Date(`${date}T12:00:00`);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const hour = Number(time.split(':')[0]);
    const isNight = hour >= 18 || hour < 6;
    if (!isNight) return 800;
    return weekend ? 1200 : 1000;
  }
  let selectedSlots = [];
  function updateSelectionPill(pricePill, isCricket) {
    if (!pricePill) return;
    if (selectedSlots.length === 0) {
      pricePill.textContent = 'Select a slot';
    } else if (isCricket) {
      const total = selectedSlots.reduce((sum, s) => sum + s.price, 0);
      pricePill.textContent = `${selectedSlots.length} slot${selectedSlots.length > 1 ? 's' : ''} selected · ₹${total.toLocaleString('en-IN')} total`;
    } else {
      pricePill.textContent = `${selectedSlots.length} slot${selectedSlots.length > 1 ? 's' : ''} selected · Custom Quote`;
    }
  }
  function renderEventFields(date, type) {
    const grid = $('#slotGrid');
    const pricePill = $('#selectedPrice');
    const dayHint = $('#dayHint');
    const bookingTimeInput = $('#bookingTime');
    if (!grid) return;
    bookingTimeInput.removeAttribute('required');
    bookingTimeInput.value = 'event-planning';
    if (pricePill) pricePill.textContent = 'Custom Quote';
    const d = new Date(`${date}T12:00:00`);
    const dayName = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    if (dayHint) {
      dayHint.textContent = `${dayName} · Fill in your event details below. Our team will reach out with a custom quote.`;
    }
    const eventLabels = {
      'Event booking': 'Birthday / Private Event',
      'Tournament enquiry': 'Tournament Enquiry',
      'General enquiry': 'Other Enquiry',
    };
    const label = eventLabels[type] || type;
    grid.innerHTML = `
      <div class="event-plan-panel">
        <div class="event-plan-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>Event Planning — ${label}</span>
        </div>
        <div class="event-plan-row">
          <div class="event-plan-field">
            <label for="ep_startTime">Preferred Start Time</label>
            <select id="ep_startTime">
              <option value="">— Flexible —</option>
              ${Array.from({length: 24}, (_, h) => `<option value="${String(h).padStart(2,'0')}:00">${formatHour(h)}</option>`).join('')}
            </select>
          </div>
          <div class="event-plan-field">
            <label for="ep_duration">Estimated Duration</label>
            <select id="ep_duration">
              <option value="1 hour">1 Hour</option>
              <option value="2 hours" selected>2 Hours</option>
              <option value="3 hours">3 Hours</option>
              <option value="4 hours">4 Hours</option>
              <option value="Half Day (6 hrs)">Half Day (6 hrs)</option>
              <option value="Full Day">Full Day</option>
              <option value="Multi-Day">Multi-Day</option>
            </select>
          </div>
        </div>
        <div id="ep_multiday_row" class="event-plan-row" style="display:none">
          <div class="event-plan-field full">
            <label for="ep_endDate">End Date <small style="opacity:.6">(for multi-day events)</small></label>
            <input type="date" id="ep_endDate" min="${date}">
          </div>
        </div>
        <div class="event-plan-field" style="margin-top:12px">
          <label>Add-On Services <small style="opacity:.6">(select all that apply)</small></label>
          <div class="addon-chips">
            <label class="addon-chip"><input type="checkbox" value="Sound System"> 🎵 Sound System</label>
            <label class="addon-chip"><input type="checkbox" value="Catering / Snacks"> 🍽 Catering / Snacks</label>
            <label class="addon-chip"><input type="checkbox" value="Decorations"> 🎉 Decorations</label>
            <label class="addon-chip"><input type="checkbox" value="Photography"> 📷 Photography</label>
            <label class="addon-chip"><input type="checkbox" value="Live Streaming"> 📡 Live Streaming</label>
            <label class="addon-chip"><input type="checkbox" value="Trophy & Certificates"> 🏆 Trophy &amp; Certificates</label>
            <label class="addon-chip"><input type="checkbox" value="Umpire Provided"> 🧑‍⚖️ Umpire Provided</label>
            <label class="addon-chip"><input type="checkbox" value="Equipment Rental"> 🏏 Equipment Rental</label>
          </div>
        </div>
        <div class="event-plan-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Pricing is custom-quoted based on your event. We'll confirm costs on WhatsApp within minutes.
        </div>
      </div>
    `;
    const durationSel = $('#ep_duration');
    const multidayRow = $('#ep_multiday_row');
    if (durationSel && multidayRow) {
      durationSel.addEventListener('change', () => {
        multidayRow.style.display = durationSel.value === 'Multi-Day' ? '' : 'none';
      });
    }
  }
  let isFetchingAvailability = false;
  async function renderSlots() {
    const dateInput = $('#bookingDate');
    const typeInput = $('#bookingType');
    const grid = $('#slotGrid');
    const pricePill = $('#selectedPrice');
    const dayHint = $('#dayHint');
    const bookingTimeInput = $('#bookingTime');
    const bookingPriceInput = $('#bookingPrice');
    if (!dateInput || !grid) return;
    selectedSlots = [];
    bookingTimeInput.value = '';
    bookingTimeInput.removeAttribute('required');
    bookingPriceInput.value = '';
    if (pricePill) pricePill.textContent = 'Select a slot';
    const date = dateInput.value;
    const type = typeInput ? typeInput.value : 'Cricket booking';
    const isCricket = type === 'Cricket booking';
    if (date && date < localToday()) {
      dateInput.value = localToday();
      showToast('Past dates cannot be booked. Date reset to today.');
      return renderSlots();
    }
    if (!date) {
      if (dayHint) dayHint.textContent = 'Select a date to view available slots.';
      grid.innerHTML = '<div class="slot-empty">Choose a date above to see available slots.</div>';
      return;
    }
    if (!isCricket) {
      renderEventFields(date, type);
      return;
    }
    const d = new Date(`${date}T12:00:00`);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const dayName = d.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    if (dayHint) {
      dayHint.textContent = `${dayName} · ${weekend ? 'Weekend rates apply' : 'Weekday rates apply'}. Day ₹800/hr · Night ₹${weekend ? '1,200' : '1,000'}/hr. Tap slots to select multiple.`;
    }
    let serverSlots = null;
    grid.innerHTML = '<div class="slot-empty" style="opacity:0.7;">Checking central database availability…</div>';
    try {
      const res = await fetch(`${API_BASE}/api/availability?date=${encodeURIComponent(date)}`);
      if (res.ok) {
        const data = await res.json();
        serverSlots = data.slots;
      }
    } catch (err) {
      console.warn('Central API unavailable, falling back to local availability calculation.', err);
    }
    let html = '';
    const now = new Date();
    const currentHour = now.getHours();
    const isToday = date === localToday();
    if (serverSlots && Array.isArray(serverSlots)) {
      const allBooked = serverSlots.length > 0 && serverSlots.every((s) => !s.available);
      if (dayHint) {
        if (allBooked) {
          dayHint.innerHTML = `<span style="color:var(--red);font-weight:700;">⚠️ ${dayName} — The venue is reserved for a confirmed event/party on this date.</span>`;
        } else {
          dayHint.textContent = `${dayName} · ${weekend ? 'Weekend rates apply' : 'Weekday rates apply'}. Day ₹800/hr · Night ₹${weekend ? '1,200' : '1,000'}/hr. Tap slots to select multiple.`;
        }
      }
      for (const s of serverSlots) {
        const h = s.hour;
        const time = s.time;
        const price = s.price;
        const available = s.available;
        const isHeld = s.status === 'held';
        const isBooked = s.status === 'booked';
        const isPast = s.status === 'past';
        const statusLabel = isPast ? 'Past' : isHeld ? 'Temporarily Held' : isBooked ? 'Booked' : 'Available';
        const isNight = s.is_night;
        const tagText = `₹${price}/hr`;
        html += `
          <button type="button"
            class="slot-btn ${isNight ? 'is-night' : ''} ${isHeld ? 'is-held' : ''}"
            data-slot="${time}"
            data-price="${price}"
            ${!available ? 'disabled' : ''}
            aria-label="${formatHour(h)}, ${tagText}, ${statusLabel}">
            <span class="slot-time">${formatHour(h)}</span>
            <span class="slot-meta">${tagText}</span>
            ${!available ? `<span class="slot-status-tag ${isHeld ? 'tag-held' : ''}">${statusLabel}</span>` : ''}
          </button>
        `;
      }
    } else {
      const allConfirmed = getBookings().filter((b) => {
        const bDate = b.booking_date || b.date;
        const bStatus = (b.status || '').toLowerCase();
        return bDate === date && (bStatus === 'confirmed' || bStatus === 'booked');
      });
      const confirmedEvent = allConfirmed.find((b) => {
        const t = (b.booking_type || b.type || '').toLowerCase();
        return t !== 'cricket' && t !== 'cricket booking';
      });
      if (dayHint) {
        if (confirmedEvent) {
          dayHint.innerHTML = `<span style="color:var(--red);font-weight:700;">⚠️ ${dayName} — The venue is reserved for a confirmed event/party on this date.</span>`;
        } else {
          dayHint.textContent = `${dayName} · ${weekend ? 'Weekend rates apply' : 'Weekday rates apply'}. Day ₹800/hr · Night ₹${weekend ? '1,200' : '1,000'}/hr. Tap slots to select multiple.`;
        }
      }
      for (let h = 0; h < 24; h++) {
        const time = `${String(h).padStart(2, '0')}:00`;
        const price = getSlotPrice(date, time);
        let occupied = false;
        if (confirmedEvent) {
          const evTimeStr = confirmedEvent.booked_slots || confirmedEvent.slots || confirmedEvent.time || '';
          if (!evTimeStr || evTimeStr.toLowerCase().includes('event') || evTimeStr.toLowerCase().includes('flexible') || (evTimeStr.includes('00:00') && evTimeStr.includes('23:00'))) {
            occupied = true;
          } else {
            occupied = evTimeStr.includes(time);
          }
        }
        if (!occupied) {
          occupied = allConfirmed.some((b) => {
            const bTimeStr = b.booked_slots || b.slots || b.time || b.start_time || '';
            return bTimeStr.includes(time);
          });
        }
        const past = isToday && h < currentHour;
        const disabled = occupied || past;
        const isNight = h >= 18 || h < 6;
        const reason = occupied ? 'Booked' : past ? 'Past' : 'Available';
        const tagText = `₹${price}/hr`;
        html += `
          <button type="button"
            class="slot-btn ${isNight ? 'is-night' : ''}"
            data-slot="${time}"
            data-price="${price}"
            ${disabled ? 'disabled' : ''}
            aria-label="${formatHour(h)}, ${tagText}, ${reason}">
            <span class="slot-time">${formatHour(h)}</span>
            <span class="slot-meta">${tagText}</span>
            ${disabled ? `<span class="slot-status-tag">${reason}</span>` : ''}
          </button>
        `;
      }
    }
    grid.innerHTML =
      html +
      `
      <div class="slot-legend">
        <span><i class="legend-dot available"></i> Available — tap to select multiple</span>
        <span><i class="legend-dot night"></i> Night Rate (6 PM–6 AM)</span>
        <span><i class="legend-dot held"></i> Temporarily Held</span>
        <span><i class="legend-dot booked"></i> Booked / Past</span>
      </div>
    `;
    grid.querySelectorAll('[data-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slotTime = btn.dataset.slot;
        const slotPrice = Number(btn.dataset.price);
        const alreadySelected = selectedSlots.some((s) => s.time === slotTime);
        if (alreadySelected) {
          selectedSlots = selectedSlots.filter((s) => s.time !== slotTime);
          btn.classList.remove('selected');
        } else {
          selectedSlots.push({ time: slotTime, price: slotPrice });
          btn.classList.add('selected');
        }
        if (selectedSlots.length > 0) {
          const sorted = [...selectedSlots].sort((a, b) => a.time.localeCompare(b.time));
          bookingTimeInput.value = sorted.map((s) => s.time).join(',');
          bookingPriceInput.value = sorted.reduce((sum, s) => sum + s.price, 0);
        } else {
          bookingTimeInput.value = '';
          bookingPriceInput.value = '';
        }
        updateSelectionPill(pricePill, true);
        const slotHour = Number(slotTime.slice(0, 2));
        const total = selectedSlots.reduce((sum, s) => sum + s.price, 0);
        if (selectedSlots.length === 0) {
          showToast(`${formatHour(slotHour)} deselected.`);
        } else {
          showToast(
            alreadySelected
              ? `${formatHour(slotHour)} removed.`
              : `${formatHour(slotHour)} added · ${selectedSlots.length} slot${selectedSlots.length > 1 ? 's' : ''} · ₹${total.toLocaleString('en-IN')} total`
          );
        }
      });
    });
  }
  if (bookingDateInput) bookingDateInput.addEventListener('change', renderSlots);
  const bookingTypeSelect = $('#bookingType');
  if (bookingTypeSelect) bookingTypeSelect.addEventListener('change', renderSlots);
  renderSlots();
  const bookingForm = $('#bookingForm');
  const confirmModal = $('#bookingConfirmModal');
  const confirmClose = $('#confirmClose');
  if (confirmClose && confirmModal) {
    confirmClose.addEventListener('click', () => confirmModal.classList.remove('open'));
    confirmModal.addEventListener('click', (e) => {
      if (e.target === confirmModal) confirmModal.classList.remove('open');
    });
  }
  if (bookingForm) {
    bookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const date = $('#bookingDate').value;
      const type = $('#bookingType').value;
      const name = $('#customerName').value.trim();
      const phone = $('#customerPhone').value.trim();
      const guests = $('#guestCount').value;
      const notes = $('#notes') ? $('#notes').value.trim() : '';
      const isCricket = type === 'Cricket booking';
      if (!name || !phone || !date) {
        showToast('Please complete all required fields.');
        return;
      }
      if (date < localToday()) {
        showToast('Past dates cannot be booked. Please select today or a future date.');
        return;
      }
      if (isCricket && selectedSlots.length === 0) {
        showToast('Please select at least one available time slot.');
        return;
      }
      let waWindow = null;
      try {
        waWindow = window.open('about:blank', '_blank');
      } catch (_) {}
      showToast('Contacting central booking server…');
      const sortedSlots = [...selectedSlots].sort((a, b) => a.time.localeCompare(b.time));
      const slotsPayload = sortedSlots.map((s) => s.time);
      let eventDetails = {};
      if (!isCricket) {
        const startTime = ($('#ep_startTime') ? $('#ep_startTime').value : '') || 'Flexible';
        const duration = ($('#ep_duration') ? $('#ep_duration').value : '') || '2 Hours';
        const endDate = ($('#ep_endDate') ? $('#ep_endDate').value : '') || '';
        const checkedAddons = Array.from($$('#slotGrid .addon-chip input:checked')).map((cb) => cb.value);
        eventDetails = {
          start_time: startTime,
          duration: duration,
          end_date: endDate,
          addons: checkedAddons
        };
      }
      const payload = {
        booking_type: isCricket ? 'cricket' : (type.toLowerCase().includes('tournament') ? 'tournament' : 'event'),
        customer_name: name,
        customer_phone: phone,
        booking_date: date,
        slots: slotsPayload,
        player_count: guests,
        notes: notes,
        event_details: eventDetails,
        idempotency_key: 'idemp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      };
      try {
        const response = await fetch(`${API_BASE}/api/bookings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData.detail?.message || errData.detail || 'Booking request failed.';
          if (waWindow) waWindow.close();
          showToast(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
          renderSlots();
          return;
        }
        const data = await response.json();
        const ref = data.booking.reference;
        const waUrl = data.whatsapp.url;
        if (waWindow) {
          waWindow.location.href = waUrl;
        }
        if (confirmModal) {
          $('#confirmRef').textContent = ref;
          $('#confirmType').textContent = isCricket ? 'Box Cricket' : type;
          $('#confirmDate').textContent = date;
          $('#confirmTime').textContent = isCricket
            ? sortedSlots.map(s => formatHour(Number(s.time.slice(0, 2)))).join(', ')
            : (eventDetails.duration || 'Custom Event');
          $('#confirmPrice').textContent = data.booking.quote_required
            ? 'Custom Quote on Request'
            : `₹${Number(data.booking.total_price).toLocaleString('en-IN')}`;
          const waLink = $('#confirmWaLink');
          if (waLink) waLink.href = waUrl;
          confirmModal.classList.add('open');
        }
        const bookings = getBookings();
        const newRecord = {
          id: ref,
          reference: ref,
          type: type,
          booking_type: type,
          name: name,
          customer_name: name,
          phone: phone,
          customer_phone: phone,
          guests: guests,
          player_count: guests,
          date: date,
          booking_date: date,
          time: slotsPayload.join(', ') || 'Event',
          booked_slots: slotsPayload.join(', ') || 'Event',
          start_time: sortedSlots[0]?.time || '10:00:00',
          price: data.booking.total_price,
          total_price: data.booking.total_price,
          notes: notes,
          status: 'pending_confirmation',
          created_at: new Date().toISOString(),
          createdAt: new Date().toISOString()
        };
        bookings.unshift(newRecord);
        saveBookings(bookings);
        showToast(`Request ${ref} recorded! Please tap 'Send' in WhatsApp.`);
        selectedSlots = [];
        renderSlots();
        if (sessionStorage.getItem(STAFF_TOKEN_KEY)) {
          fetchAdminBookings();
        }
      } catch (networkErr) {
        console.warn('Network error reaching backend, falling back to direct WhatsApp handoff.', networkErr);
        const fallbackRef = 'PP-' + Date.now().toString().slice(-7);
        const slotsLabel = sortedSlots.map((s) => `  • ${formatHour(Number(s.time.slice(0, 2)))} (₹${s.price})`).join('\n');
        const fallbackPrice = sortedSlots.reduce((sum, s) => sum + s.price, 0);
        const fallbackMessage =
          `Hello PowerPlay Club!\n\n` +
          `Booking Request: ${fallbackRef}\n` +
          `Name: ${name}\n` +
          `Phone: ${phone}\n` +
          `Date: ${date}\n` +
          (isCricket ? `Slots:\n${slotsLabel}\nEstimated Price: ₹${fallbackPrice}\n` : `Experience: ${type}\nEstimated Price: Custom Quote\n`) +
          `Notes: ${notes || 'None'}\n\n` +
          `Please verify availability and confirm my booking.`;
        const fallbackWaUrl = `https://wa.me/${PHONE}?text=${encodeURIComponent(fallbackMessage)}`;
        if (waWindow) {
          waWindow.location.href = fallbackWaUrl;
        } else {
          window.open(fallbackWaUrl, '_blank', 'noopener');
        }
        if (confirmModal) {
          $('#confirmRef').textContent = fallbackRef;
          $('#confirmType').textContent = type;
          $('#confirmDate').textContent = date;
          $('#confirmTime').textContent = sortedSlots.map(s => formatHour(Number(s.time.slice(0, 2)))).join(', ') || 'Event';
          $('#confirmPrice').textContent = isCricket ? `₹${fallbackPrice.toLocaleString('en-IN')}` : 'Custom Quote';
          const waLink = $('#confirmWaLink');
          if (waLink) waLink.href = fallbackWaUrl;
          confirmModal.classList.add('open');
        }
        const bookings = getBookings();
        const fallbackBooking = {
          id: fallbackRef,
          reference: fallbackRef,
          type: type,
          booking_type: type,
          name: name,
          customer_name: name,
          phone: phone,
          customer_phone: phone,
          guests: guests,
          player_count: guests,
          date: date,
          booking_date: date,
          time: sortedSlots.map(s => s.time).join(', ') || 'Event',
          booked_slots: sortedSlots.map(s => s.time).join(', ') || 'Event',
          start_time: sortedSlots[0]?.time || '10:00:00',
          price: fallbackPrice,
          total_price: fallbackPrice,
          notes: notes,
          status: 'pending_confirmation',
          created_at: new Date().toISOString(),
          createdAt: new Date().toISOString()
        };
        bookings.unshift(fallbackBooking);
        saveBookings(bookings);
        showToast(`Request recorded. Please tap 'Send' in WhatsApp.`);
        renderSlots();
        if (sessionStorage.getItem(STAFF_TOKEN_KEY)) {
          fetchAdminBookings();
        }
      }
    });
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }
  async function fetchAdminBookings() {
    const target = $('#bookingTableContainer');
    if (!target) return;
    const token = sessionStorage.getItem(STAFF_TOKEN_KEY);
    const dateVal = $('#adminFilterDate')?.value || '';
    const statusVal = $('#adminFilterStatus')?.value || '';
    const searchVal = $('#adminSearchQuery')?.value || '';
    target.innerHTML = '<div class="empty-state">Loading live database records…</div>';
    // If logged in via offline token, read directly from local storage with filtering
    if (token === 'offline_staff_token') {
      let list = getBookings();
      if (dateVal) {
        list = list.filter(b => (b.booking_date || b.date) === dateVal);
      }
      if (statusVal) {
        list = list.filter(b => (b.status || 'pending_confirmation').toLowerCase() === statusVal.toLowerCase());
      }
      if (searchVal) {
        const s = searchVal.toLowerCase();
        list = list.filter(b => 
          (b.reference || b.id || '').toLowerCase().includes(s) ||
          (b.customer_name || b.name || '').toLowerCase().includes(s) ||
          (b.customer_phone || b.phone || '').includes(s)
        );
      }
      renderLiveBookingsTable(list);
      return;
    }
    try {
      const params = new URLSearchParams();
      if (dateVal) params.append('date', dateVal);
      if (statusVal) params.append('status', statusVal);
      if (searchVal) params.append('search', searchVal);
      const res = await fetch(`${API_BASE}/api/admin/bookings?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        if (res.status === 401) {
          sessionStorage.removeItem(STAFF_TOKEN_KEY);
          renderStaffAuthView();
          return;
        }
        throw new Error('Failed to load bookings');
      }
      const list = await res.json();
      renderLiveBookingsTable(list);
    } catch (err) {
      console.warn('Central admin API error, showing local records.', err);
      // Fallback: Show local records if backend not reachable
      let list = getBookings();
      if (dateVal) {
        list = list.filter(b => (b.booking_date || b.date) === dateVal);
      }
      if (statusVal) {
        list = list.filter(b => (b.status || 'pending_confirmation').toLowerCase() === statusVal.toLowerCase());
      }
      if (searchVal) {
        const s = searchVal.toLowerCase();
        list = list.filter(b => 
          (b.reference || b.id || '').toLowerCase().includes(s) ||
          (b.customer_name || b.name || '').toLowerCase().includes(s) ||
          (b.customer_phone || b.phone || '').includes(s)
        );
      }
      renderLiveBookingsTable(list);
    }
  }
  function getStatusBadge(st, holdExp) {
    switch (st) {
      case 'pending_confirmation':
      case 'pending':
      case 'new':
        return '<span class="badge badge-pending">Pending Review</span>';
      case 'awaiting_advance':
        return `<span class="badge badge-hold">Awaiting Advance</span>${holdExp ? `<small class="hold-timer">Hold exp: ${holdExp}</small>` : ''}`;
      case 'payment_received':
        return '<span class="badge badge-payment">Payment Received</span>';
      case 'confirmed':
        return '<span class="badge badge-confirmed">Confirmed (Booked)</span>';
      case 'rejected':
        return '<span class="badge badge-rejected">Rejected</span>';
      case 'cancelled':
        return '<span class="badge badge-cancelled">Cancelled</span>';
      case 'expired':
        return '<span class="badge badge-expired">Expired Hold</span>';
      default:
        return `<span class="badge badge-pending">${escapeHtml(st)}</span>`;
    }
  }
  function showActionConfirmDialog({ title, message, warning, confirmText, isDanger, onConfirm }) {
    const modal = $('#actionConfirmModal');
    if (!modal) {
      if (window.confirm(`${message}${warning ? '\n\n' + warning : ''}`)) {
        onConfirm();
      }
      return;
    }
    const titleEl = $('#confirmActionTitle');
    const msgEl = $('#confirmActionMessage');
    const warnEl = $('#confirmActionWarning');
    const proceedBtn = $('#confirmActionProceedBtn');
    const cancelBtn = $('#confirmActionCancelBtn');
    const closeBtn = $('#confirmActionCloseBtn');

    if (titleEl) titleEl.textContent = title || 'CONFIRM ACTION';
    if (msgEl) msgEl.textContent = message || 'Are you sure you want to proceed?';
    if (warnEl) {
      if (warning) {
        warnEl.textContent = warning;
        warnEl.style.display = 'block';
      } else {
        warnEl.style.display = 'none';
      }
    }
    if (proceedBtn) {
      proceedBtn.textContent = confirmText || 'Proceed';
      if (isDanger) {
        proceedBtn.style.background = '#dc2626';
        proceedBtn.style.borderColor = '#dc2626';
        proceedBtn.style.color = '#ffffff';
      } else {
        proceedBtn.style.background = 'var(--green)';
        proceedBtn.style.borderColor = 'var(--green)';
        proceedBtn.style.color = '#07090a';
      }
    }

    modal.style.display = 'flex';
    modal.classList.add('open');

    function closeDialog() {
      modal.style.display = 'none';
      modal.classList.remove('open');
      if (proceedBtn) proceedBtn.onclick = null;
      if (cancelBtn) cancelBtn.onclick = null;
      if (closeBtn) closeBtn.onclick = null;
    }

    if (cancelBtn) cancelBtn.onclick = closeDialog;
    if (closeBtn) closeBtn.onclick = closeDialog;
    if (proceedBtn) {
      proceedBtn.onclick = () => {
        closeDialog();
        onConfirm();
      };
    }
  }

  function renderLiveBookingsTable(list) {
    const target = $('#bookingTableContainer');
    if (!target) return;
    if (!list || !list.length) {
      target.innerHTML = '<div class="empty-state">No matching booking records found.</div>';
      return;
    }

    const items = list.map((b) => {
      const id = b.id;
      const ref = b.reference || b.id;
      const createdAt = (b.created_at || b.createdAt || '').slice(0, 16).replace('T', ' ');
      const name = b.customer_name || b.name || '';
      const phone = b.customer_phone || b.phone || '';
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      const type = b.booking_type || b.type || '';
      const date = b.booking_date || b.date || '';
      const isEvent = type && type.toLowerCase() !== 'cricket' && type.toLowerCase() !== 'cricket booking';
      let time = '';
      if (isEvent) {
        let ev = {};
        try {
          ev = typeof b.event_details === 'string' ? JSON.parse(b.event_details) : (b.event_details || {});
        } catch (_) {}
        const evStart = ev.start_time || '';
        const evDur = ev.duration || (b.duration_hours ? `${b.duration_hours} hrs` : 'Event');
        if (!evStart || evStart === '00:00:00' || evStart === 'Flexible') {
          time = `Private Event (${evDur})`;
        } else {
          const m = evStart.match(/^(\d{1,2}):/);
          const startFmt = m ? formatHour(parseInt(m[1], 10)) : evStart;
          time = `${startFmt} (${evDur})`;
        }
      } else {
        const rawTime = b.booked_slots || b.slots || b.start_time || b.time || '';
        time = String(rawTime).split(',')
          .map(t => {
            const tr = t.trim();
            const m = tr.match(/^(\d{1,2}):/);
            if (m) return formatHour(parseInt(m[1], 10));
            return tr;
          })
          .join(', ');
      }
      const price = b.total_price || b.price;
      const curStatus = (b.status || 'pending_confirmation').toLowerCase();
      const isVerified = Boolean(b.payment_verified);
      const advAmt = b.advance_amount;
      const advMethod = b.payment_method || 'UPI';
      const advRef = b.payment_reference || '';
      const holdExp = b.hold_expires_at ? b.hold_expires_at.slice(11, 16) : null;
      const waUrl = `https://wa.me/${cleanPhone}?text=Hi%20${encodeURIComponent(name)}!%20This%20is%20PowerPlay%20Club%20regarding%20booking%20${encodeURIComponent(ref)}.`;

      return {
        id, ref, createdAt, name, phone, cleanPhone, type, date, time,
        price, curStatus, isVerified, advAmt, advMethod, advRef, holdExp, waUrl,
        raw: b
      };
    });

    target.innerHTML = `
      <!-- Desktop Table View -->
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Ref / Status</th>
              <th>Customer</th>
              <th>Booking / Slots</th>
              <th>Pricing &amp; Advance</th>
              <th>Status Select</th>
              <th>Owner Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((b) => `
              <tr>
                <td data-label="Ref / Status">
                  <b>${escapeHtml(b.ref)}</b>
                  <br><small style="color:var(--muted);">${escapeHtml(b.createdAt)}</small>
                  <div style="margin-top:6px;">${getStatusBadge(b.curStatus, b.holdExp)}</div>
                </td>
                <td data-label="Customer">
                  <b>${escapeHtml(b.name)}</b>
                  <br><small style="color:var(--muted);">${escapeHtml(b.phone)}</small>
                </td>
                <td data-label="Booking / Slots">
                  <b>${escapeHtml(b.date)}</b>
                  <br><small style="color:var(--green);font-weight:600;">${escapeHtml(b.time)}</small>
                  <div style="opacity:0.8;font-size:0.75rem;margin-top:2px;">${escapeHtml(b.type)} · ${escapeHtml(b.raw.player_count || b.raw.guests || 'Squad')}</div>
                </td>
                <td data-label="Price / Advance">
                  <div><b>Rate: ${b.price ? '₹' + Number(b.price).toLocaleString('en-IN') : 'Quote'}</b></div>
                  ${b.advAmt ? `
                    <div style="font-size:0.78rem;margin-top:4px;">
                      Adv: <b>₹${Number(b.advAmt).toLocaleString('en-IN')}</b> (${escapeHtml(b.advMethod)})<br>
                      <small style="color:var(--muted);">Ref: ${escapeHtml(b.advRef || 'N/A')}</small>
                      <br>${b.isVerified ? '<span class="badge-verified">✓ Verified</span>' : '<span class="badge-unverified">Unverified</span>'}
                    </div>
                  ` : '<div style="font-size:0.75rem;color:var(--muted);margin-top:4px;">No advance recorded</div>'}
                  <button type="button" class="btn btn-xs btn-ghost btn-adv-modal"
                    data-id="${escapeHtml(b.id)}"
                    data-ref="${escapeHtml(b.ref)}"
                    data-amt="${b.advAmt ?? ''}"
                    data-method="${escapeHtml(b.advMethod)}"
                    data-txref="${escapeHtml(b.advRef)}"
                    data-verified="${b.isVerified ? '1' : '0'}"
                    style="margin-top:6px;">
                    ${b.advAmt ? 'Edit Advance' : '+ Record Advance'}
                  </button>
                </td>
                <td data-label="Change Status">
                  <select class="status-select" data-booking-id="${escapeHtml(b.id)}">
                    <option value="pending_confirmation" ${b.curStatus === 'pending_confirmation' || b.curStatus === 'pending' || b.curStatus === 'new' ? 'selected' : ''}>Pending Confirmation</option>
                    <option value="awaiting_advance" ${b.curStatus === 'awaiting_advance' ? 'selected' : ''}>Awaiting Advance</option>
                    <option value="payment_received" ${b.curStatus === 'payment_received' ? 'selected' : ''}>Payment Received</option>
                    <option value="confirmed" ${b.curStatus === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                    <option value="cancelled" ${b.curStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                    <option value="rejected" ${b.curStatus === 'rejected' ? 'selected' : ''}>Rejected</option>
                  </select>
                </td>
                <td data-label="Actions">
                  <div style="display:flex;flex-direction:column;gap:6px;">
                    ${b.curStatus !== 'confirmed' && b.curStatus !== 'cancelled' && b.curStatus !== 'rejected' ? `
                      <div style="display:flex;gap:4px;flex-wrap:wrap;">
                        <button type="button" class="btn btn-xs btn-primary btn-confirm-action"
                          data-id="${escapeHtml(b.id)}"
                          data-ref="${escapeHtml(b.ref)}"
                          data-name="${escapeHtml(b.name)}"
                          data-verified="${b.isVerified ? '1' : '0'}">
                          ✓ Confirm Booking
                        </button>
                        <button type="button" class="btn btn-xs btn-ghost btn-hold-action"
                          data-id="${escapeHtml(b.id)}"
                          data-ref="${escapeHtml(b.ref)}"
                          data-name="${escapeHtml(b.name)}">
                          Hold 15m
                        </button>
                      </div>
                      <div style="display:flex;gap:4px;flex-wrap:wrap;">
                        <button type="button" class="btn btn-xs btn-ghost btn-reject-action"
                          data-id="${escapeHtml(b.id)}"
                          data-ref="${escapeHtml(b.ref)}"
                          data-name="${escapeHtml(b.name)}"
                          style="color:var(--red);">
                          Reject
                        </button>
                        <a class="btn btn-xs btn-ghost" href="${escapeHtml(b.waUrl)}" target="_blank" rel="noopener">
                          WhatsApp
                        </a>
                      </div>
                    ` : b.curStatus === 'confirmed' ? `
                      <div style="display:flex;gap:4px;flex-wrap:wrap;">
                        <button type="button" class="btn btn-xs btn-ghost btn-cancel-action"
                          data-id="${escapeHtml(b.id)}"
                          data-ref="${escapeHtml(b.ref)}"
                          data-name="${escapeHtml(b.name)}"
                          style="color:var(--red);">
                          Cancel Booking
                        </button>
                        <a class="btn btn-xs btn-ghost" href="${escapeHtml(b.waUrl)}" target="_blank" rel="noopener">
                          WhatsApp
                        </a>
                      </div>
                    ` : `
                      <a class="btn btn-xs btn-ghost" href="${escapeHtml(b.waUrl)}" target="_blank" rel="noopener">
                        WhatsApp
                      </a>
                    `}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Mobile & Tablet Responsive Booking Cards View -->
      <div class="admin-booking-cards">
        ${items.map((b) => `
          <div class="admin-card">
            <div class="admin-card-head">
              <div>
                <span class="admin-card-ref">#${escapeHtml(b.ref)}</span>
                <span class="admin-card-date">${escapeHtml(b.createdAt)}</span>
              </div>
              <div>${getStatusBadge(b.curStatus, b.holdExp)}</div>
            </div>

            <div class="admin-card-customer">
              <div class="admin-card-cust-info">
                <span class="admin-card-cust-name">${escapeHtml(b.name)}</span>
                <span class="admin-card-cust-phone">${escapeHtml(b.phone)}</span>
              </div>
              <div class="admin-card-cust-actions">
                ${b.cleanPhone ? `
                  <a class="btn btn-ghost" href="tel:${escapeHtml(b.cleanPhone)}" title="Call customer" aria-label="Call customer">
                    📞 Call
                  </a>
                  <a class="btn btn-ghost" href="${escapeHtml(b.waUrl)}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp customer">
                    💬 Chat
                  </a>
                ` : ''}
              </div>
            </div>

            <div class="admin-card-grid">
              <div class="admin-card-grid-item">
                <span class="admin-card-label">Date &amp; Slots</span>
                <span class="admin-card-value">${escapeHtml(b.date)}<br><small style="color:var(--green);">${escapeHtml(b.time)}</small></span>
              </div>
              <div class="admin-card-grid-item">
                <span class="admin-card-label">Type &amp; Squad</span>
                <span class="admin-card-value">${escapeHtml(b.type)}<br><small style="color:var(--muted);">${escapeHtml(b.raw.player_count || b.raw.guests || 'Squad')}</small></span>
              </div>
              <div class="admin-card-grid-item">
                <span class="admin-card-label">Total Rate</span>
                <span class="admin-card-value" style="color:var(--green);font-size:0.95rem;">${b.price ? '₹' + Number(b.price).toLocaleString('en-IN') : 'Quote'}</span>
              </div>
              <div class="admin-card-grid-item">
                <span class="admin-card-label">Advance Payment</span>
                <span class="admin-card-value">
                  ${b.advAmt ? `₹${Number(b.advAmt).toLocaleString('en-IN')} (${escapeHtml(b.advMethod)})` : 'None'}
                  <br>${b.advAmt ? (b.isVerified ? '<span class="badge-verified">✓ Verified</span>' : '<span class="badge-unverified">Unverified</span>') : ''}
                </span>
              </div>
            </div>

            <div class="admin-card-status-row">
              <label for="status_${escapeHtml(b.id)}">Status:</label>
              <select id="status_${escapeHtml(b.id)}" class="status-select" data-booking-id="${escapeHtml(b.id)}">
                <option value="pending_confirmation" ${b.curStatus === 'pending_confirmation' || b.curStatus === 'pending' || b.curStatus === 'new' ? 'selected' : ''}>Pending Confirmation</option>
                <option value="awaiting_advance" ${b.curStatus === 'awaiting_advance' ? 'selected' : ''}>Awaiting Advance</option>
                <option value="payment_received" ${b.curStatus === 'payment_received' ? 'selected' : ''}>Payment Received</option>
                <option value="confirmed" ${b.curStatus === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                <option value="cancelled" ${b.curStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                <option value="rejected" ${b.curStatus === 'rejected' ? 'selected' : ''}>Rejected</option>
              </select>
            </div>

            <div class="admin-card-actions">
              <div class="admin-card-actions-row">
                <button type="button" class="btn btn-ghost btn-adv-modal"
                  data-id="${escapeHtml(b.id)}"
                  data-ref="${escapeHtml(b.ref)}"
                  data-amt="${b.advAmt ?? ''}"
                  data-method="${escapeHtml(b.advMethod)}"
                  data-txref="${escapeHtml(b.advRef)}"
                  data-verified="${b.isVerified ? '1' : '0'}">
                  ${b.advAmt ? '✏️ Edit Advance' : '➕ Record Advance'}
                </button>
                ${b.curStatus !== 'confirmed' && b.curStatus !== 'cancelled' && b.curStatus !== 'rejected' ? `
                  <button type="button" class="btn btn-ghost btn-hold-action"
                    data-id="${escapeHtml(b.id)}"
                    data-ref="${escapeHtml(b.ref)}"
                    data-name="${escapeHtml(b.name)}">
                    ⏱️ Hold 15m
                  </button>
                ` : ''}
              </div>

              ${b.curStatus !== 'confirmed' && b.curStatus !== 'cancelled' && b.curStatus !== 'rejected' ? `
                <div class="admin-card-actions-row">
                  <button type="button" class="btn btn-primary btn-confirm-action"
                    data-id="${escapeHtml(b.id)}"
                    data-ref="${escapeHtml(b.ref)}"
                    data-name="${escapeHtml(b.name)}"
                    data-verified="${b.isVerified ? '1' : '0'}">
                    ✓ Confirm Booking
                  </button>
                  <button type="button" class="btn btn-ghost btn-reject-action"
                    data-id="${escapeHtml(b.id)}"
                    data-ref="${escapeHtml(b.ref)}"
                    data-name="${escapeHtml(b.name)}"
                    style="color:var(--red);border-color:rgba(220,38,38,0.3);">
                    ✕ Reject
                  </button>
                </div>
              ` : b.curStatus === 'confirmed' ? `
                <div class="admin-card-actions-row">
                  <button type="button" class="btn btn-ghost btn-cancel-action"
                    data-id="${escapeHtml(b.id)}"
                    data-ref="${escapeHtml(b.ref)}"
                    data-name="${escapeHtml(b.name)}"
                    style="color:var(--red);border-color:rgba(220,38,38,0.3);">
                    Cancel Booking
                  </button>
                </div>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // Hook status dropdown change on both views
    target.querySelectorAll('.status-select').forEach((select) => {
      select.addEventListener('change', async () => {
        const bookingId = select.dataset.bookingId;
        const newStatus = select.value;
        const token = sessionStorage.getItem(STAFF_TOKEN_KEY);
        try {
          const res = await fetch(`${API_BASE}/api/admin/bookings/${bookingId}/status`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ status: newStatus })
          });
          if (res.ok) {
            showToast(`Status updated to ${newStatus}.`);
            fetchAdminBookings();
            renderSlots();
          } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || 'Failed to update status on server.');
          }
        } catch (err) {
          showToast('Status update failed.');
        }
      });
    });

    // Hook Hold action on both views
    target.querySelectorAll('.btn-hold-action').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bookingId = btn.dataset.id;
        const ref = btn.dataset.ref;
        const name = btn.dataset.name || 'customer';
        const token = sessionStorage.getItem(STAFF_TOKEN_KEY);

        showActionConfirmDialog({
          title: 'PLACE 15-MINUTE HOLD',
          message: `Place a 15-minute temporary hold for booking ${ref} (${name})?`,
          warning: 'This will temporarily block slot availability for other users while awaiting payment.',
          confirmText: 'Place Hold',
          isDanger: false,
          onConfirm: async () => {
            try {
              const res = await fetch(`${API_BASE}/api/admin/bookings/${bookingId}/hold`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ hold_duration_minutes: 15 })
              });
              if (res.ok) {
                showToast(`Temporary hold placed for 15 minutes on ${ref}.`);
                fetchAdminBookings();
                renderSlots();
              } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || 'Failed to place hold.');
              }
            } catch (_) {
              showToast('Failed to connect to server.');
            }
          }
        });
      });
    });

    // Hook Confirm action on both views
    target.querySelectorAll('.btn-confirm-action').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bookingId = btn.dataset.id;
        const ref = btn.dataset.ref;
        const name = btn.dataset.name || 'customer';
        const isVerified = btn.dataset.verified === '1';
        const token = sessionStorage.getItem(STAFF_TOKEN_KEY);

        showActionConfirmDialog({
          title: 'CONFIRM BOOKING',
          message: `Are you sure you want to CONFIRM booking ${ref} (${name})?`,
          warning: isVerified ? 'Slot will be permanently reserved and closed to other customers.' : 'Warning: Advance payment has NOT been marked as verified yet. Confirming will permanently lock this slot.',
          confirmText: '✓ Confirm & Lock Slot',
          isDanger: false,
          onConfirm: async () => {
            try {
              const res = await fetch(`${API_BASE}/api/admin/bookings/${bookingId}/confirm`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ notes: 'Confirmed by owner after advance verification' })
              });
              if (res.ok) {
                showToast(`Booking ${ref} CONFIRMED! Slot is now permanently locked.`);
                fetchAdminBookings();
                renderSlots();
              } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || 'Failed to confirm booking.');
              }
            } catch (_) {
              showToast('Failed to connect to server.');
            }
          }
        });
      });
    });

    // Hook Reject action on both views
    target.querySelectorAll('.btn-reject-action').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bookingId = btn.dataset.id;
        const ref = btn.dataset.ref;
        const name = btn.dataset.name || 'customer';
        const token = sessionStorage.getItem(STAFF_TOKEN_KEY);

        showActionConfirmDialog({
          title: 'REJECT BOOKING REQUEST',
          message: `Reject booking request ${ref} from ${name}?`,
          warning: 'This releases any hold on the slot and marks the request as Rejected.',
          confirmText: 'Reject Request',
          isDanger: true,
          onConfirm: async () => {
            try {
              const res = await fetch(`${API_BASE}/api/admin/bookings/${bookingId}/status`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ status: 'rejected' })
              });
              if (res.ok) {
                showToast(`Booking ${ref} rejected. Slot remains available.`);
                fetchAdminBookings();
                renderSlots();
              } else {
                showToast('Failed to reject booking on server.');
              }
            } catch (_) {
              showToast('Failed to connect to server.');
            }
          }
        });
      });
    });

    // Hook Cancel action on both views
    target.querySelectorAll('.btn-cancel-action').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bookingId = btn.dataset.id;
        const ref = btn.dataset.ref;
        const name = btn.dataset.name || 'customer';
        const token = sessionStorage.getItem(STAFF_TOKEN_KEY);

        showActionConfirmDialog({
          title: 'CANCEL CONFIRMED BOOKING',
          message: `Cancel confirmed booking ${ref} (${name})?`,
          warning: 'This will permanently release the locked slot back to public availability for all customers.',
          confirmText: 'Cancel Booking',
          isDanger: true,
          onConfirm: async () => {
            try {
              const res = await fetch(`${API_BASE}/api/admin/bookings/${bookingId}/status`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ status: 'cancelled' })
              });
              if (res.ok) {
                showToast(`Booking ${ref} cancelled and slot released.`);
                fetchAdminBookings();
                renderSlots();
              } else {
                showToast('Failed to cancel booking on server.');
              }
            } catch (_) {
              showToast('Failed to connect to server.');
            }
          }
        });
      });
    });

    // Hook Open Advance Modal on both views
    target.querySelectorAll('.btn-adv-modal').forEach((btn) => {
      btn.addEventListener('click', () => {
        const advModal = $('#advancePaymentModal');
        if (!advModal) return;
        $('#advBookingId').value = btn.dataset.id;
        $('#advAmount').value = btn.dataset.amt || '';
        $('#advMethod').value = btn.dataset.method || 'UPI';
        $('#advReference').value = btn.dataset.txref || '';
        $('#advVerified').checked = btn.dataset.verified === '1' || !btn.dataset.amt;
        $('#advModalTitle').textContent = `ADVANCE: ${btn.dataset.ref}`;
        advModal.classList.add('open');
      });
    });
  }
  function renderStaffAuthView() {
    const loginSection = $('#adminLoginSection');
    const dashSection = $('#adminDashboardSection');
    const token = sessionStorage.getItem(STAFF_TOKEN_KEY);
    if (token) {
      if (loginSection) loginSection.style.display = 'none';
      if (dashSection) dashSection.style.display = 'block';
      fetchAdminBookings();
    } else {
      if (loginSection) loginSection.style.display = 'block';
      if (dashSection) dashSection.style.display = 'none';
    }
  }
  const adminModal = $('#adminModal');
  const adminOpen = $('#adminOpen');
  const adminClose = $('#adminClose');
  const adminLoginBtn = $('#adminLoginBtn');
  const adminLogoutBtn = $('#adminLogoutBtn');
  const adminRefreshBtn = $('#adminRefreshBtn');
  const exportBookingsBtn = $('#exportBookings');
  if (adminOpen && adminModal) {
    adminOpen.addEventListener('click', () => {
      adminModal.classList.add('open');
      renderStaffAuthView();
    });
  }
  if (adminClose && adminModal) {
    adminClose.addEventListener('click', () => adminModal.classList.remove('open'));
  }
  if (adminModal) {
    adminModal.addEventListener('click', (e) => {
      if (e.target === adminModal) adminModal.classList.remove('open');
    });
  }
  const adminEmailInput    = $('#adminEmailInput');
  const adminPasswordInput = $('#adminPasswordInput');
  // Standard Email + Password Login via Server
  if (adminLoginBtn) {
    adminLoginBtn.addEventListener('click', async () => {
      const email    = adminEmailInput?.value?.trim();
      const password = adminPasswordInput?.value?.trim();
      if (!email || !password) {
        showToast('Please enter your Gmail address and password.');
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        if (res.ok) {
          const data = await res.json();
          sessionStorage.setItem(STAFF_TOKEN_KEY, data.token);
          showToast('Booking Manager unlocked.');
          if (adminEmailInput)    adminEmailInput.value    = '';
          if (adminPasswordInput) adminPasswordInput.value = '';
          renderStaffAuthView();
        } else {
          showToast('Invalid email or password. Please try again.');
        }
      } catch (err) {
        showToast('Unable to reach server. Please check your network connection.');
      }
    });
    // Enter key auto-submit on password field
    if (adminPasswordInput) {
      adminPasswordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          adminLoginBtn.click();
        }
      });
    }
    // Enter key auto-submit on email field
    if (adminEmailInput) {
      adminEmailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          adminLoginBtn.click();
        }
      });
    }
  }
  if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem(STAFF_TOKEN_KEY);
      showToast('Staff session locked.');
      renderStaffAuthView();
    });
  }
  // ─── ADMIN DASHBOARD TABS ────────────────────────────────────────────────
  function switchAdminTab(tabName) {
    ['bookings', 'walkin', 'slotmgr'].forEach((t) => {
      const panel = $(`#adminTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
      // fix capitalisation for our IDs
      const panelMap = { bookings: '#adminTabBookings', walkin: '#adminTabWalkin', slotmgr: '#adminTabSlotMgr' };
      const p = $(panelMap[t]);
      if (p) p.style.display = (t === tabName) ? '' : 'none';
    });
    $$('.admin-tab-btn').forEach((btn) => {
      const isActive = btn.dataset.tab === tabName;
      btn.style.borderColor = isActive ? 'var(--green)' : '';
      btn.style.color = isActive ? 'var(--green)' : '';
    });
    if (tabName === 'walkin') initWalkinSlotGrid();
    if (tabName === 'slotmgr') {
      const smDateInput = $('#smDate');
      if (smDateInput) {
        if (!smDateInput.value) smDateInput.value = localToday();
        smCurrentDate = smDateInput.value;
        loadSmSlots(smDateInput.value);
      }
    }
  }
  $$('.admin-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchAdminTab(btn.dataset.tab));
  });
  // ─── WALK-IN BOOKING ─────────────────────────────────────────────────────
  let wiSelectedSlots = new Set();
  function initWalkinSlotGrid() {
    const grid = $('#wiSlotGrid');
    if (!grid) return;
    // Set date default to today
    const wiDate = $('#wiDate');
    if (wiDate && !wiDate.value) wiDate.value = localToday();
    grid.innerHTML = '';
    for (let h = 0; h < 24; h++) {
      const t = `${String(h).padStart(2, '0')}:00`;
      const isNight = h >= 18 || h < 6;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.textContent = t;
      cell.dataset.slot = t;
      cell.style.cssText = `
        padding:6px 4px;font-size:0.72rem;border-radius:7px;border:1px solid #2e3c27;
        background:${isNight ? 'rgba(100,80,200,0.12)' : 'rgba(184,255,53,0.06)'};
        color:var(--muted);cursor:pointer;transition:all 0.15s;font-weight:600;
      `;
      cell.addEventListener('click', () => {
        if (wiSelectedSlots.has(t)) {
          wiSelectedSlots.delete(t);
          cell.style.background = isNight ? 'rgba(100,80,200,0.12)' : 'rgba(184,255,53,0.06)';
          cell.style.borderColor = '#2e3c27';
          cell.style.color = 'var(--muted)';
        } else {
          wiSelectedSlots.add(t);
          cell.style.background = 'rgba(184,255,53,0.25)';
          cell.style.borderColor = 'var(--green)';
          cell.style.color = 'var(--green)';
        }
      });
      grid.appendChild(cell);
    }
  }
  const wiSubmitBtn = $('#wiSubmitBtn');
  if (wiSubmitBtn) {
    wiSubmitBtn.addEventListener('click', async () => {
      const name    = $('#wiName')?.value?.trim();
      const phone   = $('#wiPhone')?.value?.trim();
      const date    = $('#wiDate')?.value;
      const type    = $('#wiType')?.value || 'cricket';
      const price   = parseFloat($('#wiPrice')?.value || '0') || 0;
      const advance = parseFloat($('#wiAdvance')?.value || '0') || 0;
      const method  = $('#wiMethod')?.value || 'Cash';
      const ref     = $('#wiRef')?.value?.trim() || '';
      const notes   = $('#wiNotes')?.value?.trim() || '';
      const slots   = [...wiSelectedSlots].sort();
      if (!name) { showToast('Please enter customer name.'); return; }
      if (!phone || phone.length < 10) { showToast('Please enter a valid phone number.'); return; }
      if (!date) { showToast('Please select a booking date.'); return; }
      if (!slots.length) { showToast('Please select at least one time slot.'); return; }
      const token = sessionStorage.getItem(STAFF_TOKEN_KEY);
      wiSubmitBtn.disabled = true;
      wiSubmitBtn.textContent = 'Saving…';
      try {
        const res = await fetch(`${API_BASE}/api/admin/manual-booking`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            booking_type: type, customer_name: name, customer_phone: phone,
            booking_date: date, slots, total_price: price,
            player_count: 'Walk-in', notes, advance_amount: advance,
            payment_method: method, payment_reference: ref
          })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          const bk = data.booking;
          const resultEl = $('#wiResult');
          if (resultEl) {
            resultEl.style.display = 'block';
            resultEl.innerHTML = `
              <div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:10px;padding:14px;">
                <strong style="color:#22c55e;">✅ Booking Confirmed!</strong>
                <div style="font-size:0.82rem;margin-top:8px;color:var(--muted);">
                  Ref: <strong style="color:var(--white);">${bk.reference}</strong> · 
                  Slots: <strong style="color:var(--white);">${slots.join(', ')}</strong> · 
                  ${date}
                </div>
              </div>`;
          }
          showToast(`Walk-in booking ${bk.reference} confirmed & slots locked!`);
          // Reset form
          wiSelectedSlots.clear();
          initWalkinSlotGrid();
          ['#wiName','#wiPhone','#wiPrice','#wiAdvance','#wiRef','#wiNotes'].forEach(id => { const el = $(id); if(el) el.value = ''; });
          fetchAdminBookings();
          renderSlots();
        } else {
          showToast(data.detail || 'Failed to create manual booking.');
        }
      } catch (_) {
        showToast('Server offline. Manual booking requires server connection.');
      }
      wiSubmitBtn.disabled = false;
      wiSubmitBtn.innerHTML = '✅ Confirm Walk-in Booking &amp; Lock Slots';
    });
  }
  // ─── SLOT MANAGER ─────────────────────────────────────────────────────────
  let smCurrentDate = '';
  let smSlotStatus = {}; // time -> {status, blocked}
  let smSelectedCells = new Set();
  function renderSmGrid(slots) {
    const container = $('#smSlotGridCells');
    if (!container) return;
    container.innerHTML = '';
    smSelectedCells.clear();
    smSlotStatus = {};
    slots.forEach((s) => {
      smSlotStatus[s.time] = s;
      const isBlocked  = s.status === 'blocked';
      const isBooked   = s.status === 'booked' || s.status === 'held';
      const isPast     = s.status === 'past';
      const isNight    = s.is_night;
      let bg = isBooked ? 'rgba(245,158,11,0.18)' :
               isBlocked ? 'rgba(220,38,38,0.22)' :
               isPast ? 'rgba(55,65,81,0.4)' :
               isNight ? 'rgba(100,80,200,0.12)' : 'rgba(34,197,94,0.1)';
      let bdr = isBooked ? '#f59e0b' : isBlocked ? '#dc2626' : isPast ? '#374151' : isNight ? '#6450c8' : '#22c55e';
      let clr = isBooked ? '#f59e0b' : isBlocked ? '#f87171' : isPast ? '#6b7280' : isNight ? '#a78bfa' : '#22c55e';
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.dataset.slot = s.time;
      cell.dataset.status = s.status;
      cell.title = isBlocked ? `Blocked: ${s.block_reason || 'Owner'}` : isBooked ? 'Booked/Held' : isPast ? 'Past' : 'Available';
      cell.style.cssText = `
        padding:7px 4px;font-size:0.72rem;border-radius:7px;border:1px solid ${bdr};
        background:${bg};color:${clr};cursor:${isPast||isBooked?'default':'pointer'};
        transition:all 0.15s;font-weight:700;position:relative;
      `;
      cell.innerHTML = `<span style="display:block;">${s.time}</span>
        <span style="font-size:0.6rem;opacity:0.8;">${isBlocked?'🔒':isBooked?'📅':isPast?'—':'✓'}</span>`;
      if (!isPast && !isBooked) {
        cell.addEventListener('click', () => {
          if (smSelectedCells.has(s.time)) {
            smSelectedCells.delete(s.time);
            cell.style.outline = 'none';
            cell.style.boxShadow = 'none';
          } else {
            smSelectedCells.add(s.time);
            cell.style.outline = '2px solid white';
            cell.style.boxShadow = '0 0 0 3px rgba(255,255,255,0.25)';
          }
        });
      }
      container.appendChild(cell);
    });
    $('#smSlotGrid').style.display = 'block';
    $('#smEmptyMsg').style.display = 'none';
  }
  async function loadSmSlots(date) {
    const token = sessionStorage.getItem(STAFF_TOKEN_KEY);
    try {
      const res = await fetch(`${API_BASE}/api/availability?date=${date}`);
      if (res.ok) {
        const data = await res.json();
        // Merge blocked reason info
        let blockedMap = {};
        try {
          const bRes = await fetch(`${API_BASE}/api/admin/blocked-slots?date=${date}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (bRes.ok) {
            const bd = await bRes.json();
            (bd.blocked || []).forEach(b => { blockedMap[b.slot_time] = b.reason; });
          }
        } catch(_) {}
        const slotsList = Array.isArray(data) ? data : (data.slots || []);
        const merged = slotsList.map(s => ({
          ...s,
          block_reason: blockedMap[s.time] || s.block_reason
        }));
        renderSmGrid(merged);
      } else {
        showToast('Failed to load slot availability.');
      }
    } catch (err) {
      console.error('Error loading slots in Slot Manager:', err);
      showToast('Could not load slots. Server may be offline.');
    }
  }
  const smLoadBtn = $('#smLoadBtn');
  if (smLoadBtn) {
    smLoadBtn.addEventListener('click', () => {
      const date = $('#smDate')?.value;
      if (!date) { showToast('Please select a date.'); return; }
      smCurrentDate = date;
      loadSmSlots(date);
    });
  }
  // Quick-select buttons
  if ($('#smSelectAll')) {
    $('#smSelectAll').addEventListener('click', () => {
      $$('#smSlotGridCells button').forEach(btn => {
        if (btn.dataset.status !== 'past' && btn.dataset.status !== 'booked' && btn.dataset.status !== 'held') {
          smSelectedCells.add(btn.dataset.slot);
          btn.style.outline = '2px solid white';
          btn.style.boxShadow = '0 0 0 3px rgba(255,255,255,0.25)';
        }
      });
    });
  }
  if ($('#smSelectNone')) {
    $('#smSelectNone').addEventListener('click', () => {
      smSelectedCells.clear();
      $$('#smSlotGridCells button').forEach(btn => {
        btn.style.outline = 'none';
        btn.style.boxShadow = 'none';
      });
    });
  }
  if ($('#smSelectNight')) {
    $('#smSelectNight').addEventListener('click', () => {
      $$('#smSlotGridCells button').forEach(btn => {
        const h = parseInt(btn.dataset.slot);
        if ((h >= 18 || h < 6) && btn.dataset.status !== 'past' && btn.dataset.status !== 'booked' && btn.dataset.status !== 'held') {
          smSelectedCells.add(btn.dataset.slot);
          btn.style.outline = '2px solid white';
          btn.style.boxShadow = '0 0 0 3px rgba(255,255,255,0.25)';
        }
      });
    });
  }
  if ($('#smSelectDay')) {
    $('#smSelectDay').addEventListener('click', () => {
      $$('#smSlotGridCells button').forEach(btn => {
        const h = parseInt(btn.dataset.slot);
        if (h >= 6 && h < 18 && btn.dataset.status !== 'past' && btn.dataset.status !== 'booked' && btn.dataset.status !== 'held') {
          smSelectedCells.add(btn.dataset.slot);
          btn.style.outline = '2px solid white';
          btn.style.boxShadow = '0 0 0 3px rgba(255,255,255,0.25)';
        }
      });
    });
  }
  if ($('#smBlockBtn')) {
    $('#smBlockBtn').addEventListener('click', async () => {
      if (!smCurrentDate) { showToast('Please load a date first.'); return; }
      const selected = [...smSelectedCells];
      if (!selected.length) { showToast('Select at least one slot to block.'); return; }
      const reason = $('#smReason')?.value?.trim() || 'Blocked by Owner';
      const token = sessionStorage.getItem(STAFF_TOKEN_KEY);
      try {
        const res = await fetch(`${API_BASE}/api/admin/block-slots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ slot_date: smCurrentDate, slot_times: selected, reason })
        });
        if (res.ok) {
          showToast(`${selected.length} slot(s) blocked: ${reason}`);
          loadSmSlots(smCurrentDate);
          renderSlots();
        } else {
          showToast('Failed to block slots.');
        }
      } catch(_) { showToast('Server offline.'); }
    });
  }
  if ($('#smUnblockBtn')) {
    $('#smUnblockBtn').addEventListener('click', async () => {
      if (!smCurrentDate) { showToast('Please load a date first.'); return; }
      const selected = [...smSelectedCells];
      if (!selected.length) { showToast('Select at least one slot to unblock.'); return; }
      const token = sessionStorage.getItem(STAFF_TOKEN_KEY);
      try {
        const res = await fetch(`${API_BASE}/api/admin/unblock-slots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ slot_date: smCurrentDate, slot_times: selected })
        });
        if (res.ok) {
          showToast(`${selected.length} slot(s) unblocked.`);
          loadSmSlots(smCurrentDate);
          renderSlots();
        } else {
          showToast('Failed to unblock slots.');
        }
      } catch(_) { showToast('Server offline.'); }
    });
  }
  if ($('#smUnblockAllBtn')) {
    $('#smUnblockAllBtn').addEventListener('click', async () => {
      if (!smCurrentDate) { showToast('Please load a date first.'); return; }
      if (!window.confirm(`Remove ALL blocked slots for ${smCurrentDate}?`)) return;
      const token = sessionStorage.getItem(STAFF_TOKEN_KEY);
      try {
        const res = await fetch(`${API_BASE}/api/admin/unblock-slots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ slot_date: smCurrentDate, slot_times: null })
        });
        if (res.ok) {
          showToast(`All blocks cleared for ${smCurrentDate}.`);
          loadSmSlots(smCurrentDate);
          renderSlots();
        } else {
          showToast('Failed to clear blocks.');
        }
      } catch(_) { showToast('Server offline.'); }
    });
  }
  if (adminRefreshBtn) {
    adminRefreshBtn.addEventListener('click', fetchAdminBookings);
  }
  ['#adminFilterDate', '#adminFilterStatus'].forEach((selector) => {
    const el = $(selector);
    if (el) el.addEventListener('change', fetchAdminBookings);
  });
  const searchEl = $('#adminSearchQuery');
  if (searchEl) {
    let debounceTimer;
    searchEl.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fetchAdminBookings, 300);
    });
  }
  if (exportBookingsBtn) {
    exportBookingsBtn.addEventListener('click', async () => {
      const token = sessionStorage.getItem(STAFF_TOKEN_KEY);
      const dateVal = $('#adminFilterDate')?.value || '';
      const statusVal = $('#adminFilterStatus')?.value || '';
      try {
        const params = new URLSearchParams();
        if (dateVal) params.append('date', dateVal);
        if (statusVal) params.append('status', statusVal);
        const res = await fetch(`${API_BASE}/api/admin/export?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `powerplay-bookings-${localToday()}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          showToast('Live bookings exported to CSV.');
          return;
        }
      } catch (_) {}
      // Fallback local export
      const list = getBookings();
      if (!list.length) {
        showToast('No bookings to export.');
        return;
      }
      const keys = ['id', 'createdAt', 'type', 'name', 'phone', 'guests', 'date', 'time', 'duration', 'price', 'notes', 'status'];
      const csv = [
        keys.join(','),
        ...list.map((b) => keys.map((k) => '"' + String(b[k] ?? '').replace(/"/g, '""') + '"').join(',')),
      ].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      a.download = `powerplay-bookings-${localToday()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('Bookings exported to CSV.');
    });
  }
  // --- ADVANCE PAYMENT MODAL EVENT HANDLERS ---
  const advModal = $('#advancePaymentModal');
  const advModalClose = $('#advanceModalClose');
  const advSaveBtn = $('#advSaveBtn');
  if (advModalClose && advModal) {
    advModalClose.addEventListener('click', () => advModal.classList.remove('open'));
    advModal.addEventListener('click', (e) => {
      if (e.target === advModal) advModal.classList.remove('open');
    });
  }
  if (advSaveBtn) {
    advSaveBtn.addEventListener('click', async () => {
      const bookingId = $('#advBookingId')?.value;
      const amount = Number($('#advAmount')?.value);
      const method = $('#advMethod')?.value || 'UPI';
      const reference = $('#advReference')?.value?.trim() || '';
      const verified = Boolean($('#advVerified')?.checked);
      const token = sessionStorage.getItem(STAFF_TOKEN_KEY);
      if (!bookingId) {
        showToast('No booking selected.');
        return;
      }
      if (isNaN(amount) || amount < 0) {
        showToast('Please enter a valid advance amount.');
        return;
      }
      if (!reference) {
        showToast('Please enter a transaction reference or UTR.');
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/admin/bookings/${bookingId}/advance`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            advance_amount: amount,
            payment_method: method,
            payment_reference: reference,
            payment_verified: verified
          })
        });
        if (res.ok) {
          showToast('Advance details recorded. Status updated to payment_received.');
          if (advModal) advModal.classList.remove('open');
          fetchAdminBookings();
        } else {
          const err = await res.json().catch(() => ({}));
          showToast(err.detail || 'Failed to save advance details.');
        }
      } catch (_) {
        showToast('Failed to connect to server.');
      }
    });
  }
  // --- GALLERY FILTER & FULLSCREEN LIGHTBOX ---
  const galleryItems = [
    {
      id: 1,
      category: 'cricket',
      src: 'assets/images/Cirket.jpeg',
      title: 'PowerPlay Floodlit Arena',
      subtitle: 'Tournament-spec enclosed box cricket under high-power LED floodlights with synthetic turf and 360° safety netting.',
      tag: 'Box Cricket · Night Match',
    },
    {
      id: 2,
      category: 'celebrations',
      src: 'assets/images/Birthday.jpeg',
      title: 'Turfside Birthday Celebrations',
      subtitle: 'Cake cutting, sparklers, and squad cricket — celebrate your special day right on the pitch.',
      tag: 'Birthday Celebrations',
    },
    {
      id: 3,
      category: 'tournaments',
      src: 'assets/images/Tournment.mp4',
      isVideo: true,
      title: 'Championship Glory',
      subtitle: 'Weekend tournaments, corporate cups, and squad leagues — compete for the PowerPlay trophy.',
      tag: 'Tournaments & Leagues',
    },
    {
      id: 4,
      category: 'events',
      src: 'assets/images/Movie promotion.jpeg',
      title: 'Star-Studded Events',
      subtitle: 'PowerPlay Club — the go-to venue for movie promotions, fan meets, and entertainment events in Bhimavaram.',
      tag: 'Movie Promotions',
    },
    {
      id: 5,
      category: 'events',
      src: 'assets/images/Event.mp4',
      isVideo: true,
      title: 'Your Event. Your Turf.',
      subtitle: 'From corporate gatherings to private parties — book the entire venue for an exclusive PowerPlay experience.',
      tag: 'Private Events',
    },
  ];
  let currentLightboxIndex = 0;
  let activeFilteredList = [...galleryItems];
  function filterGallery(category) {
    if (category === 'all') {
      activeFilteredList = [...galleryItems];
    } else {
      activeFilteredList = galleryItems.filter((item) => item.category === category);
    }
    // Toggle active tab class
    $$('.gallery-filter-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.filter === category);
    });
    // Animate tiles
    $$('.gallery-masonry-item').forEach((tile) => {
      const tileCat = tile.dataset.category;
      if (category === 'all' || tileCat === category) {
        tile.style.display = '';
        setTimeout(() => (tile.style.opacity = '1'), 20);
      } else {
        tile.style.opacity = '0';
        setTimeout(() => (tile.style.display = 'none'), 250);
      }
    });
  }
  $$('.gallery-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      filterGallery(btn.dataset.filter);
    });
  });
  // Lightbox Implementation
  const lightbox = $('#galleryLightbox');
  const lightboxImg = $('#lightboxImg');
  const lightboxTitle = $('#lightboxTitle');
  const lightboxSubtitle = $('#lightboxSubtitle');
  const lightboxTag = $('#lightboxTag');
  const lightboxCounter = $('#lightboxCounter');
  const lightboxClose = $('#lightboxClose');
  const lightboxPrev = $('#lightboxPrev');
  const lightboxNext = $('#lightboxNext');
  function openLightbox(index) {
    if (!lightbox) return;
    currentLightboxIndex = index;
    updateLightbox();
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  }
  function updateLightbox() {
    const item = activeFilteredList[currentLightboxIndex];
    if (!item) return;
    const imgWrap = lightboxImg ? lightboxImg.closest('.lightbox-img-wrap') : null;
    if (item.isVideo) {
      // Swap in a <video> element for video slides
      if (imgWrap) {
        imgWrap.innerHTML = `
          <video autoplay muted loop playsinline
            style="max-height:68vh;max-width:100%;object-fit:contain;"
            aria-label="${item.title}">
            <source src="${item.src}" type="video/mp4">
          </video>`;
      }
    } else {
      // Restore <img> if a previous slide was video
      if (imgWrap && !imgWrap.querySelector('img')) {
        imgWrap.innerHTML = '<img id="lightboxImg" src="" alt="">';
      }
      const img = imgWrap ? imgWrap.querySelector('img') : lightboxImg;
      if (img) { img.src = item.src; img.alt = item.title; }
    }
    if (lightboxTitle)    lightboxTitle.textContent    = item.title;
    if (lightboxSubtitle) lightboxSubtitle.textContent = item.subtitle;
    if (lightboxTag)      lightboxTag.textContent      = item.tag;
    if (lightboxCounter) {
      lightboxCounter.textContent = `${currentLightboxIndex + 1} / ${activeFilteredList.length}`;
    }
  }
  function prevLightbox() {
    currentLightboxIndex = (currentLightboxIndex - 1 + activeFilteredList.length) % activeFilteredList.length;
    updateLightbox();
  }
  function nextLightbox() {
    currentLightboxIndex = (currentLightboxIndex + 1) % activeFilteredList.length;
    updateLightbox();
  }
  if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
  if (lightboxPrev) lightboxPrev.addEventListener('click', prevLightbox);
  if (lightboxNext) lightboxNext.addEventListener('click', nextLightbox);
  if (lightbox) {
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox || e.target.classList.contains('lightbox-backdrop')) {
        closeLightbox();
      }
    });
  }
  // Keyboard Navigation for Lightbox
  window.addEventListener('keydown', (e) => {
    if (!lightbox || !lightbox.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') prevLightbox();
    if (e.key === 'ArrowRight') nextLightbox();
  });
  // Touch Swipe for Lightbox on Mobile
  let touchStartX = 0;
  if (lightbox) {
    lightbox.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].clientX;
    });
    lightbox.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      if (touchStartX - touchEndX > 50) nextLightbox();
      if (touchEndX - touchStartX > 50) prevLightbox();
    });
  }
  // Attach click listener to gallery items
  $$('.gallery-masonry-item').forEach((item) => {
    item.addEventListener('click', () => {
      const id = Number(item.dataset.id);
      const idx = activeFilteredList.findIndex((x) => x.id === id);
      if (idx !== -1) openLightbox(idx);
    });
  });
  // --- HERO GALLERY AUTO-SCROLLING CAROUSEL (3-SECOND AUTO SCROLL) ---
  const heroCarousel = $('#heroCarousel');
  const track = $('#heroCarouselTrack');
  const timerBar = $('#carouselTimerBar');
  const counter = $('#carouselCounter');
  const dotsContainer = $('#carouselDots');
  const prevBtn = $('#carouselPrev');
  const nextBtn = $('#carouselNext');
  if (heroCarousel && track) {
    const slides = Array.from(track.querySelectorAll('.carousel-slide'));
    const totalSlides = slides.length;
    let currentSlide = 0;
    const intervalDuration = 3000; // 3 seconds
    let progress = 0;
    let isPaused = false;
    let progressInterval = null;
    // Create pagination dots
    if (dotsContainer) {
      dotsContainer.innerHTML = '';
      slides.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = `carousel-dot ${i === 0 ? 'active' : ''}`;
        dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          goToSlide(i);
        });
        dotsContainer.appendChild(dot);
      });
    }
    function updateDots() {
      if (!dotsContainer) return;
      const dots = dotsContainer.querySelectorAll('.carousel-dot');
      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === currentSlide);
      });
    }
    function updateCounter() {
      if (counter) {
        counter.textContent = `${String(currentSlide + 1).padStart(2, '0')} / ${String(totalSlides).padStart(2, '0')}`;
      }
    }
    function goToSlide(index) {
      currentSlide = (index + totalSlides) % totalSlides;
      track.style.transform = `translateX(-${currentSlide * 100}%)`;
      updateDots();
      updateCounter();
      resetTimer();
    }
    function nextSlide() {
      goToSlide(currentSlide + 1);
    }
    function prevSlide() {
      goToSlide(currentSlide - 1);
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        prevSlide();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        nextSlide();
      });
    }
    // Auto-scroll loop every 3 seconds
    function resetTimer() {
      progress = 0;
      if (timerBar) timerBar.style.width = '0%';
    }
    function startTimer() {
      clearInterval(progressInterval);
      const stepMs = 50;
      const stepPercent = (stepMs / intervalDuration) * 100;
      progressInterval = setInterval(() => {
        if (!isPaused) {
          progress += stepPercent;
          if (progress >= 100) {
            nextSlide();
          } else if (timerBar) {
            timerBar.style.width = `${progress}%`;
          }
        }
      }, stepMs);
    }
    // Pause auto-scroll on hover, resume on leave
    heroCarousel.addEventListener('mouseenter', () => {
      isPaused = true;
    });
    heroCarousel.addEventListener('mouseleave', () => {
      isPaused = false;
    });
    // Mobile touch swipe gestures
    let carouselTouchStartX = 0;
    heroCarousel.addEventListener('touchstart', (e) => {
      carouselTouchStartX = e.changedTouches[0].clientX;
    }, { passive: true });
    heroCarousel.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      const diff = carouselTouchStartX - touchEndX;
      if (diff > 45) {
        nextSlide();
      } else if (diff < -45) {
        prevSlide();
      }
    }, { passive: true });
    // Open Lightbox when clicking slide or expand button
    slides.forEach((slide) => {
      slide.addEventListener('click', () => {
        const id = Number(slide.dataset.lightboxId);
        const idx = activeFilteredList.findIndex((x) => x.id === id);
        if (idx !== -1) {
          openLightbox(idx);
        }
      });
    });
    // Start auto-scroll
    updateCounter();
    startTimer();
  }
  // --- SCROLL REVEAL OBSERVER ---
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1 }
  );
  $$('.reveal').forEach((el) => observer.observe(el));
})();
  // --- VIDEO HERO — all screen sizes ---
  // Mobile browsers (Chrome Android, Safari iOS) allow autoplay only when
  // the video is muted + playsinline, both of which are set on the <video>
  // element and in JS properties. If autoplay is rejected (e.g. iOS Low Power Mode),
  // we hide the video element so no native play button renders over the turf.
  (function initHeroVideo() {
    const heroVideo = document.querySelector('.hero-video');
    if (!heroVideo) return;
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      try { heroVideo.pause(); } catch (_) {}
      heroVideo.style.display = 'none';
      return;
    }
    heroVideo.muted = true;
    heroVideo.defaultMuted = true;
    heroVideo.playsInline = true;
    heroVideo.setAttribute('muted', '');
    heroVideo.setAttribute('playsinline', '');
    heroVideo.setAttribute('webkit-playsinline', '');
    heroVideo.setAttribute('preload', 'metadata');

    function attemptPlay() {
      const p = heroVideo.play();
      if (p !== undefined) {
        p.then(() => {
          heroVideo.style.display = 'block';
        }).catch(() => {
          // Autoplay blocked (e.g. iOS Low Power Mode) — hide video element so no native play button appears!
          // The CSS background-image fallback on .hero displays cleanly.
          heroVideo.style.display = 'none';
        });
      }
    }

    // Try resuming playback on user interaction if autoplay was initially blocked
    const resumeOnInteraction = () => {
      if (heroVideo.paused) {
        heroVideo.play().then(() => {
          heroVideo.style.display = 'block';
        }).catch(() => {});
      }
    };
    window.addEventListener('touchstart', resumeOnInteraction, { once: true, passive: true });
    window.addEventListener('click', resumeOnInteraction, { once: true, passive: true });

    if (heroVideo.readyState >= 2) {
      attemptPlay();
    } else {
      heroVideo.addEventListener('loadeddata', attemptPlay, { once: true });
      heroVideo.addEventListener('canplay', attemptPlay, { once: true });
    }

    // Handle error gracefully by showing background image
    heroVideo.addEventListener('error', () => {
      heroVideo.style.display = 'none';
    }, { once: true });
  }());
  /* ====================================================
     PRELOADER / LOADING ANIMATION CONTROLLER
     ==================================================== */
  (function initPreloader() {
    const preloader = document.getElementById('preloader');
    if (!preloader) return;
    const video = document.getElementById('preloaderVideo');
    let dismissed = false;
    function dismissPreloader() {
      if (dismissed) return;
      dismissed = true;
      preloader.classList.add('fade-out');
      setTimeout(() => {
        preloader.style.display = 'none';
        try {
          if (video) video.pause();
        } catch (_) {}
      }, 400);
    }
    // Tap anywhere to skip straight to home page immediately
    preloader.addEventListener('click', dismissPreloader);
    if (video) {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');

      // Handle video error or stall by dismissing immediately
      video.addEventListener('error', dismissPreloader, { once: true });
      video.addEventListener('stalled', () => {
        if (video.currentTime === 0) dismissPreloader();
      }, { once: true });

      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // If autoplay is blocked on mobile (e.g. iOS Low Power Mode),
          // dismiss preloader immediately so screen is never stuck!
          dismissPreloader();
        });
      }
      // Transition smoothly as soon as animation finishes
      video.addEventListener('ended', () => {
        setTimeout(dismissPreloader, 100);
      }, { once: true });
    }
    // Fallback: Ensure home page always opens within 2.8s max even if video stalls
    setTimeout(dismissPreloader, 2800);
  }());
