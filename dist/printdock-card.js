/*
 * PrintDock Cards for Home Assistant
 *
 *   type: custom:printdock-card            one printer (status, camera, temperatures, filament, controls)
 *   entity: sensor.<printer>_status
 *
 *   type: custom:printdock-overview-card   all printers + queue, orders, low spools, maintenance
 *   entity: sensor.printdock_overview      (optional – found automatically)
 *
 * Data comes from PrintDock's MQTT discovery entities; commands are sent via mqtt.publish.
 * https://github.com/Codegulasch/printdock
 */
(() => {
  const VERSION = '0.7.6';

  // ------------------------------------------------------------------ texts
  const TXT = {
    de: {
      left: 'noch', eta: 'fertig um', layer: 'Schicht', temps: 'TEMPERATUREN', fans: 'LÜFTER', filament: 'FILAMENT', controls: 'STEUERUNG',
      next: 'Als Nächstes', queued: 'eingeplant', noJob: 'Kein aktiver Druck', plateClear: 'Platte ist frei', confirmPlate: 'Druckplatte geräumt? Danach kann der nächste Druck starten.',
      pause: 'Pause', resume: 'Weiter', stop: 'Stopp', confirmStop: 'Druck wirklich abbrechen?', light: 'Licht', power: 'Strom', open: 'In PrintDock öffnen',
      empty: 'leer', printers: 'Drucker', queue: 'Warteschlange', orders: 'Aufträge', spools: 'Spulen knapp', maintenance: 'Wartung',
      nothing: 'Nichts eingeplant', noOrders: 'Keine offenen Aufträge', noSpools: 'Alle Spulen ausreichend', noMaint: 'Keine Wartung fällig',
      due: 'fällig', soon: 'bald', late: 'überfällig', of: 'von', free: 'frei', run: 'druckt', wait: 'wartet', fault: 'Störung', off: 'offline',
      notFound: 'PrintDock-Entität nicht gefunden. Sind in PrintDock die MQTT-Geräte eingeschaltet?', messages: 'Meldungen', camera: 'Kamera', camShow: 'Kamera zeigen', camHide: 'Kamera ausblenden', cameraOpen: 'Kamera anfangs zeigen',
      entity: 'Drucker (Status-Sensor)', showCamera: 'Kamera', showTemps: 'Temperaturen', showFans: 'Lüfter', showFilament: 'Filament', showControls: 'Steuerung', compact: 'Kompakt',
      overviewEntity: 'PrintDock-Übersicht', title: 'Titel', sections: 'Bereiche', maxItems: 'Einträge je Bereich', more: 'weitere',
    },
    en: {
      left: 'left', eta: 'ETA', layer: 'Layer', temps: 'TEMPERATURES', fans: 'FANS', filament: 'FILAMENT', controls: 'CONTROLS',
      next: 'Up next', queued: 'queued', noJob: 'No active print', plateClear: 'Plate is clear', confirmPlate: 'Build plate cleared? The next print can start afterwards.',
      pause: 'Pause', resume: 'Resume', stop: 'Stop', confirmStop: 'Really cancel the print?', light: 'Light', power: 'Power', open: 'Open in PrintDock',
      empty: 'empty', printers: 'Printers', queue: 'Queue', orders: 'Orders', spools: 'Spools low', maintenance: 'Maintenance',
      nothing: 'Nothing scheduled', noOrders: 'No open orders', noSpools: 'All spools sufficient', noMaint: 'No maintenance due',
      due: 'due', soon: 'soon', late: 'overdue', of: 'of', free: 'idle', run: 'printing', wait: 'waiting', fault: 'fault', off: 'offline',
      notFound: 'PrintDock entity not found. Are MQTT devices enabled in PrintDock?', messages: 'messages', camera: 'Camera', camShow: 'Show camera', camHide: 'Hide camera', cameraOpen: 'Show camera initially',
      entity: 'Printer (status sensor)', showCamera: 'Camera', showTemps: 'Temperatures', showFans: 'Fans', showFilament: 'Filament', showControls: 'Controls', compact: 'Compact',
      overviewEntity: 'PrintDock overview', title: 'Title', sections: 'Sections', maxItems: 'Items per section', more: 'more',
    },
  };
  const tx = (hass) => TXT[String(hass?.locale?.language || hass?.language || 'en').startsWith('de') ? 'de' : 'en'];

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hm = (min) => (min == null ? '–' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`);
  const clock = (iso, hass) => {
    if (!iso) return '–';
    try { return new Date(iso).toLocaleTimeString(hass?.locale?.language || undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return '–'; }
  };

  // Icons (Material Design paths)
  const ICON = {
    cam: 'M4,4H7L9,2H15L17,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M12,7A5,5 0 0,0 7,12A5,5 0 0,0 12,17A5,5 0 0,0 17,12A5,5 0 0,0 12,7M12,9A3,3 0 0,1 15,12A3,3 0 0,1 12,15A3,3 0 0,1 9,12A3,3 0 0,1 12,9Z',
    light: 'M12,2A7,7 0 0,0 5,9C5,11.38 6.19,13.47 8,14.74V17A1,1 0 0,0 9,18H15A1,1 0 0,0 16,17V14.74C17.81,13.47 19,11.38 19,9A7,7 0 0,0 12,2M9,21A1,1 0 0,0 10,22H14A1,1 0 0,0 15,21V20H9V21Z',
    power: 'M16.56,5.44L15.11,6.89C16.84,7.94 18,9.83 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12C6,9.83 7.16,7.94 8.88,6.88L7.44,5.44C5.36,6.88 4,9.28 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12C20,9.28 18.64,6.88 16.56,5.44M13,3H11V13H13',
    pause: 'M14,19H18V5H14M6,19H10V5H6V19Z',
    play: 'M8,5.14V19.14L19,12.14L8,5.14Z',
    stop: 'M18,18H6V6H18V18Z',
    open: 'M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z',
    check: 'M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z',
    thermo: 'M15 13V5A3 3 0 0 0 9 5V13A5 5 0 1 0 15 13M12 4A1 1 0 0 1 13 5V8H11V5A1 1 0 0 1 12 4Z',
    fan: 'M12,11A1,1 0 0,0 11,12A1,1 0 0,0 12,13A1,1 0 0,0 13,12A1,1 0 0,0 12,11M12.5,2C17,2 17.11,5.57 14.75,6.75C13.76,7.24 13.32,8.29 13.13,9.22C13.61,9.42 14.03,9.73 14.35,10.13C18.05,8.13 22.03,8.92 22.03,12.5C22.03,17 18.46,17.1 17.28,14.73C16.78,13.74 15.72,13.3 14.79,13.11C14.59,13.59 14.28,14 13.88,14.34C15.87,18.03 15.08,22 11.5,22C7,22 6.91,18.42 9.27,17.24C10.25,16.75 10.69,15.71 10.89,14.79C10.4,14.59 9.97,14.27 9.65,13.87C5.96,15.85 2,15.07 2,11.5C2,7 5.56,6.89 6.74,9.26C7.24,10.25 8.29,10.68 9.22,10.87C9.41,10.39 9.73,9.97 10.14,9.65C8.15,5.96 8.94,2 12.5,2Z',
    alert: 'M13,14H11V10H13M13,18H11V16H13M1,21H23L12,2L1,21Z',
    printer: 'M19,8C20.66,8 22,9.34 22,11V17H18V21H6V17H2V11C2,9.34 3.34,8 5,8H19M16,19V14H8V19H16M18,3V7H6V3H18Z',
  };
  const svg = (p, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path fill="currentColor" d="${p}"/></svg>`;

  // ------------------------------------------------------------------ shared styles
  const BASE_CSS = `
    :host{--pd-free:#22C55E;--pd-run:#3B82F6;--pd-run2:#93C5FD;--pd-wait:#EAB308;--pd-fault:#EF4444;--pd-off:#94A3B8;
      --pd-panel:var(--secondary-background-color,rgba(127,127,127,.1));--pd-muted:var(--secondary-text-color);--pd-line:var(--divider-color,rgba(127,127,127,.25));--pd-accent:var(--primary-color)}
    ha-card{overflow:hidden;position:relative}
    .bar{height:5px;background:var(--c,var(--pd-off))}
    .free{--c:var(--pd-free)} .run{--c:var(--pd-run)} .wait{--c:var(--pd-wait)} .fault{--c:var(--pd-fault)} .off{--c:var(--pd-off)}
    .bar.free{box-shadow:0 0 12px 1px var(--pd-free)}
    .bar.run{background:repeating-linear-gradient(-45deg,var(--pd-run) 0 12px,var(--pd-run2) 12px 24px);background-size:34px 34px;animation:pdrun 1s linear infinite}
    .bar.wait{animation:pdsoft 1.4s ease-in-out infinite} .bar.fault{animation:pdhard .9s steps(1,end) infinite}
    @keyframes pdrun{to{background-position:34px 0}} @keyframes pdsoft{50%{opacity:.2}} @keyframes pdhard{50%{opacity:.15}} @keyframes pdspin{to{transform:rotate(360deg)}}
    .led{display:inline-block;width:10px;height:10px;border-radius:50%;flex:none;background:var(--c,var(--pd-off))}
    .led.free{box-shadow:0 0 0 3px rgba(34,197,94,.25),0 0 9px 2px var(--pd-free)}
    .led.run{background:conic-gradient(var(--pd-run) 0 70%,var(--pd-run2) 70% 100%);box-shadow:0 0 8px 1px var(--pd-run);animation:pdspin 1s linear infinite}
    .led.wait{box-shadow:0 0 8px 1px var(--pd-wait);animation:pdsoft 1.4s ease-in-out infinite}
    .led.fault{box-shadow:0 0 9px 2px var(--pd-fault);animation:pdhard .9s steps(1,end) infinite}
    .lamp{display:inline-flex;align-items:center;gap:7px;border-radius:14px;padding:3px 10px 3px 8px;font-weight:600;font-size:13.5px;white-space:nowrap;border:1px solid var(--pd-line);background:var(--pd-panel)}
    .lamp.fault{background:var(--pd-fault);color:#fff;border-color:var(--pd-fault)} .lamp.fault .led{background:#fff;box-shadow:0 0 6px 2px #fff}
    .prog{height:8px;border-radius:4px;background:var(--pd-line);overflow:hidden;flex:1}
    .prog i{display:block;height:100%;border-radius:4px;background:var(--pd-off)}
    .prog.run i{background:repeating-linear-gradient(-45deg,var(--pd-run) 0 8px,var(--pd-run2) 8px 16px);background-size:23px 23px;animation:pdrun 1s linear infinite}
    .prog.wait i{background:var(--pd-wait)} .prog.fault i{background:var(--pd-fault)}
    .muted{color:var(--pd-muted)}
    button{font:inherit;color:inherit;cursor:pointer}
    .btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--pd-line);background:var(--pd-panel);border-radius:8px;padding:6px 12px;min-height:36px;font-weight:600;font-size:14px}
    .btn:hover{border-color:var(--pd-accent)}
    .btn.go{background:var(--pd-accent);border-color:var(--pd-accent);color:var(--text-primary-color,#fff)}
    .btn.danger{color:var(--pd-fault);border-color:var(--pd-fault);background:transparent}
    .ibtn{width:36px;height:36px;border-radius:8px;border:1px solid var(--pd-line);background:var(--pd-panel);display:inline-flex;align-items:center;justify-content:center;color:var(--pd-muted)}
    .ibtn.on{color:#B07D00;background:rgba(234,179,8,.18);border-color:var(--pd-wait)}
    .ibtn.pwr{color:var(--pd-free);border-color:var(--pd-free)}
    .sect{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:700;letter-spacing:.06em;color:var(--pd-muted);margin:12px 0 6px}
    .sect::after{content:"";flex:1;height:1px;background:var(--pd-line)}
    .sw{display:inline-block;width:12px;height:12px;border-radius:50%;border:1px solid var(--pd-line);flex:none}
    .warn{padding:16px;color:var(--pd-muted)}
    @media (prefers-reduced-motion:reduce){.bar,.led,.prog i{animation-duration:3s!important}}
  `;

  /** Entities belonging to the same device (for the camera image). */
  function deviceEntity(hass, entityId, domain) {
    const dev = hass.entities?.[entityId]?.device_id;
    if (!dev) return null;
    return Object.values(hass.entities).find((e) => e.device_id === dev && e.entity_id.startsWith(`${domain}.`))?.entity_id || null;
  }

  function moreInfo(el, entityId) {
    el.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId } }));
  }

  // ================================================================== printer card
  class PrintDockCard extends HTMLElement {
    static getConfigElement() {
      return document.createElement('printdock-card-editor');
    }

    static getStubConfig(hass) {
      const e = Object.keys(hass.states).find((id) => id.startsWith('sensor.') && hass.states[id].attributes?.printdock && hass.states[id].attributes?.cmd_topic);
      return { entity: e || 'sensor.printer_status', show_camera: true, show_temps: true, show_fans: false, show_filament: true, show_controls: true };
    }

    setConfig(config) {
      if (!config?.entity) throw new Error('entity is required (sensor.<printer>_status)');
      this.config = { show_camera: true, camera_open: false, show_temps: true, show_fans: false, show_filament: true, show_controls: true, compact: false, ...config };
      // Kamera an/aus merkt sich jeder Browser je Karte; Standard: aus
      let saved = null;
      try { saved = localStorage.getItem(`printdock-cam:${this.config.entity}`); } catch {}
      this.camOn = saved != null ? saved === '1' : Boolean(this.config.camera_open);
      if (!this.shadowRoot) {
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.addEventListener('click', (e) => this.onClick(e));
        this.shadowRoot.addEventListener('change', (e) => this.onChange(e));
      }
      this.sig = null;
      if (this._hass) this.render();
    }

    set hass(hass) {
      this._hass = hass;
      this.render();
    }

    getCardSize() {
      return this.config?.compact ? 3 : 8;
    }

    getGridOptions() {
      return { columns: 12, min_columns: 6 };
    }

    render() {
      const hass = this._hass;
      if (!hass || !this.config) return;
      const st = hass.states[this.config.entity];
      const camId = this.config.show_camera ? this.config.camera_entity || deviceEntity(hass, this.config.entity, 'image') : null;
      const cam = camId ? hass.states[camId] : null;
      const sig = JSON.stringify([st?.state, st?.attributes, this.camOn ? [cam?.attributes?.entity_picture, cam?.state] : 0, Boolean(cam), this.camOn, hass.locale?.language, this.config]);
      if (sig === this.sig) return;
      this.sig = sig;
      const t = tx(hass);
      if (!st || !st.attributes?.printdock) {
        this.shadowRoot.innerHTML = `<style>${BASE_CSS}</style><ha-card><div class="warn">${esc(t.notFound)}<br><code>${esc(this.config.entity)}</code></div></ha-card>`;
        return;
      }
      const a = st.attributes;
      const c = this.config;
      const cat = a.category || 'off';
      const active = a.printing;
      const pct = Math.max(0, Math.min(100, Number(a.progress) || 0));
      const title = c.name || a.printer_name || a.friendly_name;

      const head = `<div class="head">
        <div class="ttl"><div class="name">${esc(title)}</div><div class="muted sm">${esc(a.model || '')}${a.nozzle_diameter ? ` · ${a.nozzle_diameter} mm` : ''}</div></div>
        <span class="lamp ${cat}"><i class="led ${cat}"></i>${esc(a.lamp)}</span>
        ${a.can_power && a.power_entity ? `<button class="ibtn ${a.power === 'on' ? 'pwr' : ''}" data-act="power" title="${esc(t.power)}">${svg(ICON.power)}</button>` : ''}
        <a class="ibtn" href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(t.open)}">${svg(ICON.open)}</a>
      </div>`;

      const hms = a.hms ? `<div class="hms">${svg(ICON.alert, 16)} ${a.hms} ${esc(t.messages)}</div>` : '';
      const status = active || a.printer_state === 'error'
        ? `<div class="file">${esc(a.file || '–')}</div>${a.job_order ? `<div class="muted sm">${esc(a.job_order)}</div>` : ''}
          <div class="progrow"><div class="prog ${cat}"><i style="width:${pct}%"></i></div><b>${Math.floor(pct)} %</b></div>
          <div class="times muted">${a.remaining_min ? `<span>${esc(t.left)} <b>${hm(a.remaining_min)}</b></span><span>${esc(t.eta)} <b>${clock(a.finish_at, hass)}</b></span>` : ''}${a.layer != null && a.total_layers ? `<span>${esc(t.layer)} <b>${a.layer}/${a.total_layers}</b></span>` : ''}</div>`
        : a.needs_clear
          ? `<div class="file">${esc(a.file || '')}</div><button class="btn go" data-act="plate">${svg(ICON.check)}${esc(t.plateClear)}</button>`
          : `<div class="muted">${esc(a.message && a.printer_state === 'offline' ? a.message : t.noJob)}</div>`;
      const msg = a.message && (a.printer_state === 'error' || active) ? `<div class="msg ${a.printer_state === 'error' ? 'bad' : ''}">${esc(a.message)}</div>` : '';
      const next = a.next_job && !active ? `<div class="next muted">${esc(t.next)}: <b>${esc(a.next_job)}</b>${a.queued > 1 ? ` · +${a.queued - 1}` : ''}</div>` : '';

      const camBtn = cam ? `<button class="ibtn ${this.camOn ? 'on' : ''}" data-act="camToggle" title="${esc(this.camOn ? t.camHide : t.camShow)}">${svg(ICON.cam)}</button>` : '';
      const camImg = this.camOn && cam?.attributes?.entity_picture
        ? `<div class="cam" data-act="cam"><img src="${esc(cam.attributes.entity_picture)}${cam.attributes.entity_picture.includes('?') ? '&' : '?'}t=${encodeURIComponent(cam.state || '')}" alt="${esc(t.camera)}"></div>` : '';

      const temps = c.show_temps && !c.compact && a.temps?.length ? `<div class="sect">${esc(t.temps)}</div><div class="temps">${a.temps.map((x) => `<div class="tt ${x.active ? 'act' : ''} ${x.current > 45 ? 'hot' : ''}">
          <div class="tl">${svg(ICON.thermo, 13)}${esc(x.label)}</div><div class="tv">${x.current != null ? Math.round(x.current) : '–'}°${x.target ? `<small> / ${Math.round(x.target)}°</small>` : ''}</div></div>`).join('')}</div>` : '';
      const fans = c.show_fans && !c.compact && a.fans?.length ? `<div class="fans">${a.fans.map((f) => `<span class="fan ${f.pct > 0 ? 'spin' : ''}">${svg(ICON.fan, 14)}${esc(f.name)} <b>${f.pct} %</b></span>`).join('')}</div>` : '';

      let fil = '';
      if (c.show_filament && a.filament?.length && a.filament.some((x) => x.material)) {
        const groups = {};
        for (const sl of a.filament) (groups[sl.unit || ''] ||= []).push(sl);
        fil = `<div class="sect">${esc(t.filament)}</div><div class="units">${Object.entries(groups).map(([name, list]) => {
          const u = (a.filament_units || []).find((x) => x.name === name);
          const meta = u ? [u.humidity != null ? `${u.humidity} %` : '', u.temp != null ? `${Math.round(u.temp)} °C` : ''].filter(Boolean).join(' · ') : '';
          return `<div class="unit">${name || meta ? `<div class="uh"><span>${esc(name)}</span><span class="muted">${esc(meta)}</span></div>` : ''}<div class="slots">${list.map((sl) => `<div class="slot ${sl.active ? 'act' : ''} ${sl.low ? 'low' : ''}" title="${esc(sl.label)}${sl.spool ? ` · ${esc(sl.spool)}` : ''}">
            <span class="dot ${sl.color ? '' : 'nocolor'}" style="${sl.color ? `background:${esc(sl.color)}` : ''}"></span><b>${esc(sl.material || '–')}</b><small>${esc(sl.material ? sl.amount || '' : t.empty)}</small></div>`).join('')}</div></div>`;
        }).join('')}</div>`;
      }

      const showCtrls = c.show_controls && a.online;
      const ctrls = showCtrls || camBtn ? `<div class="ctrls">
          ${camBtn}
          ${showCtrls && a.can_light ? `<button class="ibtn ${a.light ? 'on' : ''}" data-act="light" title="${esc(t.light)}">${svg(ICON.light)}</button>` : ''}
          ${showCtrls && a.can_speed && !c.compact ? `<select data-act="speed" ${active ? '' : 'disabled'}>${(a.speed_options || []).map((o) => `<option ${o === a.speed ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : ''}
          <span class="grow"></span>
          ${showCtrls && active ? (a.printer_state === 'paused' ? `<button class="btn go" data-act="resume">${svg(ICON.play)}${esc(t.resume)}</button>` : `<button class="btn" data-act="pause">${svg(ICON.pause)}${esc(t.pause)}</button>`) + `<button class="btn danger" data-act="cancel">${svg(ICON.stop)}${esc(t.stop)}</button>` : ''}
        </div>` : '';

      this.shadowRoot.innerHTML = `<style>${BASE_CSS}${CARD_CSS}</style><ha-card class="${c.compact ? 'compact' : ''}">
        <div class="bar ${cat}"></div>
        <div class="body">${head}${hms}
          <div class="status">${status}${msg}${next}</div>
          ${temps}${fans}${fil}${ctrls}${camImg}
        </div></ha-card>`;
    }

    publish(payload) {
      const a = this._hass.states[this.config.entity]?.attributes;
      if (!a?.cmd_topic) return;
      this._hass.callService('mqtt', 'publish', { topic: a.cmd_topic, payload });
    }

    onClick(e) {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act;
      const t = tx(this._hass);
      const a = this._hass.states[this.config.entity]?.attributes || {};
      if (act === 'light') return this.publish(a.light ? 'light_off' : 'light_on');
      if (act === 'pause' || act === 'resume') return this.publish(act);
      if (act === 'cancel') { if (confirm(t.confirmStop)) this.publish('cancel'); return; }
      if (act === 'plate') { if (confirm(t.confirmPlate)) this.publish('plate_clear'); return; }
      if (act === 'power' && a.power_entity) return this._hass.callService('homeassistant', a.power === 'on' ? 'turn_off' : 'turn_on', { entity_id: a.power_entity });
      if (act === 'camToggle') {
        this.camOn = !this.camOn;
        try { localStorage.setItem(`printdock-cam:${this.config.entity}`, this.camOn ? '1' : '0'); } catch {}
        return this.render();
      }
      if (act === 'cam') {
        const cam = this.config.camera_entity || deviceEntity(this._hass, this.config.entity, 'image');
        if (cam) moreInfo(this, cam);
      }
    }

    onChange(e) {
      if (e.target.dataset.act === 'speed') this.publish(`speed_${e.target.value}`);
    }
  }

  const CARD_CSS = `
    .body{padding:12px 16px 14px}
    .head{display:flex;align-items:center;gap:8px}
    .ttl{flex:1;min-width:0}
    .name{font-size:20px;font-weight:700;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sm{font-size:13px}
    .hms{display:inline-flex;align-items:center;gap:5px;margin-top:8px;padding:2px 9px;border-radius:12px;background:rgba(239,68,68,.15);color:var(--pd-fault);font-size:13px;font-weight:600}
    .status{background:var(--pd-panel);border-radius:10px;padding:10px 12px;margin-top:10px}
    .file{font-weight:600;overflow-wrap:anywhere}
    .progrow{display:flex;align-items:center;gap:10px;margin-top:8px}
    .progrow b{min-width:44px;text-align:right;font-size:17px}
    .times{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:13px;margin-top:5px}
    .times b{color:var(--primary-text-color);font-size:15px}
    .msg{margin-top:8px;font-size:13.5px;padding:6px 9px;border-radius:7px;background:rgba(234,179,8,.15)}
    .msg.bad{background:rgba(239,68,68,.15);color:var(--pd-fault)}
    .next{margin-top:8px;font-size:13.5px;border-top:1px solid var(--pd-line);padding-top:7px}
    .next b{color:var(--primary-text-color)}
    .status .btn{margin-top:8px}
    .cam{margin-top:10px;border-radius:8px;overflow:hidden;background:#0d1117;aspect-ratio:16/9;cursor:zoom-in}
    .cam img{width:100%;height:100%;object-fit:contain;display:block}
    .temps{display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));gap:6px}
    .tt{background:var(--pd-panel);border-radius:8px;padding:6px 8px;text-align:center}
    .tt.act{box-shadow:inset 0 0 0 2px var(--pd-accent)}
    .tl{font-size:11.5px;color:var(--pd-muted);display:flex;align-items:center;justify-content:center;gap:3px;white-space:nowrap;overflow:hidden}
    .tl svg{color:#4C8DE0} .tt.hot .tl svg{color:#E8743B}
    .tv{font-size:19px;font-weight:700;white-space:nowrap}
    .tv small{font-size:12px;color:var(--pd-muted);font-weight:500}
    .fans{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
    .fan{display:inline-flex;align-items:center;gap:4px;background:var(--pd-panel);border-radius:7px;padding:4px 8px;font-size:12.5px;color:var(--pd-muted)}
    .fan b{color:var(--primary-text-color)}
    .fan.spin svg{animation:pdspin 1.2s linear infinite}
    .units{display:flex;flex-direction:column;gap:6px}
    .unit{background:var(--pd-panel);border-radius:9px;padding:6px 8px 8px}
    .uh{display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;margin-bottom:5px}
    .slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(62px,1fr));gap:5px}
    .slot{display:flex;flex-direction:column;align-items:center;gap:2px;border:1px solid transparent;border-radius:7px;padding:6px 2px 5px;background:var(--card-background-color,var(--ha-card-background));min-width:0}
    .slot.act{border-color:var(--pd-accent);box-shadow:inset 0 0 0 1px var(--pd-accent)}
    .slot.low{background:rgba(234,179,8,.18)}
    .slot .dot{width:22px;height:22px;border-radius:50%;border:2px solid var(--pd-line)}
    .slot .dot.nocolor{background:repeating-linear-gradient(45deg,transparent 0 4px,var(--pd-line) 4px 5px)}
    .slot b{font-size:12px;line-height:1.1;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .slot small{font-size:11px;color:var(--pd-muted);white-space:nowrap}
    .ctrls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}
    .ctrls .grow{flex:1}
    .ctrls select{min-height:36px;border-radius:8px;border:1px solid var(--pd-line);background:var(--pd-panel);color:inherit;padding:0 8px;font:inherit}
    ha-card.compact .status{margin-top:8px}
  `;

  // ================================================================== overview card
  class PrintDockOverviewCard extends HTMLElement {
    static getConfigElement() {
      return document.createElement('printdock-overview-card-editor');
    }

    static getStubConfig() {
      return { sections: ['printers', 'queue', 'orders', 'spools', 'maintenance'] };
    }

    setConfig(config) {
      this.config = { sections: ['printers', 'queue', 'orders', 'spools', 'maintenance'], max_items: 6, ...config };
      if (!this.shadowRoot) {
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.addEventListener('click', (e) => {
          const el = e.target.closest('[data-printer]');
          if (!el) return;
          const id = Object.keys(this._hass.states).find((k) => k.startsWith('sensor.') && this._hass.states[k].attributes?.printdock === el.dataset.printer && this._hass.states[k].attributes?.cmd_topic);
          if (id) moreInfo(this, id);
        });
      }
      this.sig = null;
      if (this._hass) this.render();
    }

    set hass(hass) {
      this._hass = hass;
      this.render();
    }

    getCardSize() {
      return 6;
    }

    entityId() {
      if (this.config.entity) return this.config.entity;
      return Object.keys(this._hass.states).find((id) => id.startsWith('sensor.') && Array.isArray(this._hass.states[id].attributes?.printers) && this._hass.states[id].attributes?.counts);
    }

    render() {
      const hass = this._hass;
      if (!hass || !this.config) return;
      const id = this.entityId();
      const st = id && hass.states[id];
      const sig = JSON.stringify([st?.attributes, hass.locale?.language, this.config]);
      if (sig === this.sig) return;
      this.sig = sig;
      const t = tx(hass);
      if (!st) {
        this.shadowRoot.innerHTML = `<style>${BASE_CSS}</style><ha-card><div class="warn">${esc(t.notFound)}</div></ha-card>`;
        return;
      }
      const a = st.attributes;
      const sec = new Set(this.config.sections);
      const counts = a.counts || {};
      const sum = ['free', 'run', 'wait', 'fault', 'off'].filter((k) => counts[k] || k === 'free' || k === 'run')
        .map((k) => `<span class="cnt"><i class="led ${counts[k] ? k : 'off'}"></i><b>${counts[k] || 0}</b> ${esc(t[k])}</span>`).join('');
      const printers = sec.has('printers') ? `<div class="list">${(a.printers || []).map((p) => `<div class="prow" data-printer="${esc(p.id)}">
          <i class="led ${p.category}"></i>
          <div class="pn"><b>${esc(p.name)}</b><span class="muted">${esc(p.file || p.lamp)}</span></div>
          ${p.progress != null ? `<div class="pp"><div class="prog ${p.category}"><i style="width:${p.progress}%"></i></div><span><b>${p.progress} %</b>${p.remaining_min ? ` · ${hm(p.remaining_min)}` : ''}</span></div>` : `<span class="lamp ${p.category}"><i class="led ${p.category}"></i>${esc(p.lamp)}</span>`}
        </div>`).join('')}</div>` : '';
      const max = Math.max(1, Number(this.config.max_items) || 6);
      const block = (key, title, items, emptyText, row, total = items?.length) => (sec.has(key) && Array.isArray(items)
        ? `<div class="sect">${esc(title)}${total ? ` · ${total}` : ''}</div>${items.length ? `<div class="mini">${items.slice(0, max).map(row).join('')}${total > max ? `<div class="more muted">+${total - max} ${esc(t.more)}</div>` : ''}</div>` : `<div class="muted sm">${esc(emptyText)}</div>`}` : '');
      const queue = block('queue', t.queue, a.queue, t.nothing, (q) => `<div class="mr"><span class="st ${q.status}">${esc(q.status_text)}</span><b>${esc(q.file)}</b><span class="muted">${esc(q.printer)}${q.order ? ` · ${esc(q.order)}` : ''}</span></div>`);
      const orders = block('orders', t.orders, a.orders, t.noOrders, (o) => `<div class="mr"><b>${esc(o.nr)}</b><span>${esc(o.title)}</span><span class="${o.late ? 'bad' : 'muted'}">${o.done}/${o.qty}${o.due ? ` · ${new Date(`${o.due}T12:00`).toLocaleDateString(hass.locale?.language, { day: '2-digit', month: '2-digit' })}` : ''}${o.late ? ` · ${esc(t.late)}` : ''}</span></div>`);
      const spools = block('spools', t.spools, a.spools_low, t.noSpools, (s) => `<div class="mr"><span class="sw" style="background:${esc(s.color || 'transparent')}"></span><b>${esc(s.nr)}</b><span>${esc(s.material)} ${esc(s.color_name || '')}</span><span class="warnc">${s.remaining} g</span></div>`);
      const maint = block('maintenance', t.maintenance, a.maintenance, t.noMaint, (m) => `<div class="mr"><b>${esc(m.printer)}</b><span>${esc(m.title)}</span><span class="${m.due ? 'bad' : 'warnc'}">${esc(m.due ? t.due : t.soon)}</span></div>`);
      this.shadowRoot.innerHTML = `<style>${BASE_CSS}${OV_CSS}</style><ha-card>
        <div class="body"><div class="top"><span class="ic">${svg(ICON.printer, 22)}</span><b class="title">${esc(this.config.title || 'PrintDock')}</b>
          <a class="ibtn" href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(t.open)}">${svg(ICON.open)}</a></div>
          <div class="sum">${sum}</div>${printers}${queue}${orders}${spools}${maint}</div></ha-card>`;
    }
  }

  const OV_CSS = `
    .body{padding:12px 16px 14px}
    .top{display:flex;align-items:center;gap:8px}
    .top .ic{color:var(--pd-accent);display:flex}
    .title{flex:1;font-size:19px}
    .sum{display:flex;flex-wrap:wrap;gap:4px 14px;margin:6px 0 4px;font-size:14px}
    .cnt{display:inline-flex;align-items:center;gap:6px}
    .list{display:flex;flex-direction:column;gap:6px;margin-top:8px}
    .prow{display:flex;align-items:center;gap:10px;background:var(--pd-panel);border-radius:9px;padding:8px 10px;cursor:pointer}
    .pn{flex:1;min-width:0;display:flex;flex-direction:column}
    .pn span{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pp{display:flex;flex-direction:column;align-items:flex-end;gap:3px;width:42%;max-width:180px;font-size:12.5px}
    .pp .prog{width:100%;flex:none}
    .mini{display:flex;flex-direction:column}
    .mr{display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid var(--pd-line);font-size:13.5px;min-width:0}
    .mr:first-child{border-top:0}
    .mr b{white-space:nowrap}
    .mr span:not(.sw):not(.st){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .mr>span:last-child{margin-left:auto;flex:none}
    .st{font-size:11.5px;font-weight:700;border-radius:5px;padding:1px 6px;background:var(--pd-panel);flex:none}
    .st.printing,.st.sending{color:var(--pd-run)}
    .bad{color:var(--pd-fault);font-weight:600} .warnc{color:#B07D00;font-weight:600}
    .sm{font-size:13px}
    .more{font-size:12.5px;padding:5px 0 0;border-top:1px solid var(--pd-line)}
  `;

  // ================================================================== editors (ha-form)
  class BaseEditor extends HTMLElement {
    setConfig(config) {
      this._config = config;
      this.paint();
    }

    set hass(hass) {
      this._hass = hass;
      this.paint();
    }

    paint() {
      if (!this._hass || !this._config) return;
      if (!this.form) {
        this.form = document.createElement('ha-form');
        this.form.computeLabel = (s) => this.labels()[s.name] || s.name;
        this.form.addEventListener('value-changed', (e) => {
          this._config = e.detail.value;
          this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
        });
        this.append(this.form);
      }
      this.form.hass = this._hass;
      this.form.schema = this.schema();
      this.form.data = { ...this.defaults(), ...this._config };
    }
  }

  class PrintDockCardEditor extends BaseEditor {
    defaults() {
      return { show_camera: true, camera_open: false, show_temps: true, show_fans: false, show_filament: true, show_controls: true, compact: false };
    }

    labels() {
      const t = tx(this._hass);
      return { entity: t.entity, name: 'Name', show_camera: t.showCamera, camera_open: t.cameraOpen, show_temps: t.showTemps, show_fans: t.showFans, show_filament: t.showFilament, show_controls: t.showControls, compact: t.compact };
    }

    schema() {
      const ids = Object.keys(this._hass.states).filter((id) => this._hass.states[id].attributes?.cmd_topic && this._hass.states[id].attributes?.printdock);
      return [
        { name: 'entity', required: true, selector: { entity: { include_entities: ids, domain: 'sensor' } } },
        { name: 'name', selector: { text: {} } },
        { type: 'grid', name: '', schema: ['show_camera', 'camera_open', 'show_temps', 'show_fans', 'show_filament', 'show_controls', 'compact'].map((n) => ({ name: n, selector: { boolean: {} } })) },
      ];
    }
  }

  class PrintDockOverviewEditor extends BaseEditor {
    defaults() {
      return { sections: ['printers', 'queue', 'orders', 'spools', 'maintenance'], max_items: 6 };
    }

    labels() {
      const t = tx(this._hass);
      return { entity: t.overviewEntity, title: t.title, sections: t.sections, max_items: t.maxItems };
    }

    schema() {
      const t = tx(this._hass);
      return [
        { name: 'title', selector: { text: {} } },
        { name: 'sections', selector: { select: { multiple: true, options: [['printers', t.printers], ['queue', t.queue], ['orders', t.orders], ['spools', t.spools], ['maintenance', t.maintenance]].map(([value, label]) => ({ value, label })) } } },
        { name: 'max_items', selector: { number: { min: 1, max: 20, mode: 'box' } } },
        { name: 'entity', selector: { entity: { domain: 'sensor' } } },
      ];
    }
  }

  const define = (name, cls) => { if (!customElements.get(name)) customElements.define(name, cls); };
  define('printdock-card', PrintDockCard);
  define('printdock-overview-card', PrintDockOverviewCard);
  define('printdock-card-editor', PrintDockCardEditor);
  define('printdock-overview-card-editor', PrintDockOverviewEditor);

  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === 'printdock-card')) {
    window.customCards.push(
      { type: 'printdock-card', name: 'PrintDock Card', description: 'One 3D printer: status light, progress, camera, temperatures, filament and controls.', preview: true, documentationURL: 'https://github.com/Codegulasch/printdock' },
      { type: 'printdock-overview-card', name: 'PrintDock Overview', description: 'All printers at a glance plus queue, orders, low spools and maintenance.', preview: true, documentationURL: 'https://github.com/Codegulasch/printdock' },
    );
  }
  console.info(`%c PRINTDOCK-CARD %c ${VERSION} `, 'background:#3F5BD8;color:#fff;font-weight:700', 'background:#eee;color:#333');
})();
